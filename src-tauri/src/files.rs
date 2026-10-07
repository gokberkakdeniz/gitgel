//! Reading both sides of a changed file for the diff view.

use std::path::{Component, Path, PathBuf};

use crate::config;
use crate::error::AppError;
use crate::git::{diff, worktrees};
use crate::model::{FileChange, FileKind, FilePair};
use crate::state::{lock, AppState};

/// Larger files are not shown.
const MAX_BYTES: usize = 1024 * 1024;
/// Like git, a NUL in the first 8000 bytes means binary.
const SNIFF_BYTES: usize = 8000;

/// Left side from `oldOid`; right side from `newOid`, or from the working tree at `worktree_path`
/// when `newOid` is null. Blobs are read from the main repository, whose object database
/// worktrees share.
pub fn read_file_pair(
    state: &AppState,
    repo_id: &str,
    worktree_path: Option<&str>,
    change: &FileChange,
) -> Result<FilePair, AppError> {
    let started = std::time::Instant::now();
    let pair = read_pair(state, repo_id, worktree_path, change);
    if let Ok(p) = &pair {
        log::info!(
            "file {}: {:.1} ms ({})",
            change.path,
            started.elapsed().as_secs_f64() * 1000.0,
            if p.binary {
                "binary".to_string()
            } else if p.too_large {
                "too large".to_string()
            } else {
                format!("{} B → {} B", p.original.len(), p.modified.len())
            }
        );
    }
    pair
}

/// The GitHub page of the repository's remote (`https://github.com/<owner>/<repo>`), for a link
/// to a file at a commit; `None` for no remote or another host. `origin` if there is one.
pub fn github_url(state: &AppState, repo_id: &str) -> Result<Option<String>, AppError> {
    let config = config::snapshot(state);
    let repo_cfg = config
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))?;
    let shared = state.pool.get(Path::new(&repo_cfg.path))?;
    let repo = lock(&shared);
    let name = if repo.find_remote("origin").is_ok() {
        Some("origin".to_string())
    } else {
        repo.remotes().ok().and_then(|n| n.iter().flatten().flatten().next().map(str::to_string))
    };
    let url = name
        .and_then(|n| repo.find_remote(&n).ok())
        .and_then(|r| r.url().ok().map(str::to_string));
    Ok(url.as_deref().and_then(web_url))
}

/// `git@github.com:o/r.git`, `ssh://git@github.com/o/r` and `https://github.com/o/r.git` all
/// become `https://github.com/o/r`.
fn web_url(remote: &str) -> Option<String> {
    let rest = if let Some((_, rest)) = remote.split_once("://") {
        rest.to_string()
    } else {
        remote.split_once('@').map_or(remote, |(_, r)| r).replacen(':', "/", 1)
    };
    let rest = rest.split_once('@').map_or(rest.as_str(), |(_, r)| r);
    let (host, path) = rest.split_once('/')?;
    let host = host.split(':').next()?;
    let path = path.trim_end_matches('/').trim_end_matches(".git");
    (host == "github.com" && path.split('/').count() == 2).then(|| format!("https://{host}/{path}"))
}

fn read_pair(
    state: &AppState,
    repo_id: &str,
    worktree_path: Option<&str>,
    change: &FileChange,
) -> Result<FilePair, AppError> {
    let config = config::snapshot(state);
    let repo_cfg = config
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))?;
    let shared = state.pool.get(Path::new(&repo_cfg.path))?;
    let repo = lock(&shared);

    let empty = |binary: bool, too_large: bool| FilePair {
        original: String::new(),
        modified: String::new(),
        binary,
        too_large,
    };
    if change.binary {
        return Ok(empty(true, false));
    }
    for oid in [&change.old_oid, &change.new_oid].into_iter().flatten() {
        if diff::blob_size(&repo, oid)? > MAX_BYTES {
            return Ok(empty(false, true));
        }
    }

    let from_disk = change.new_oid.is_none() && change.kind != FileKind::D;
    let disk = if from_disk {
        let wt = worktree_path
            .ok_or_else(|| AppError::Forbidden(format!("{} needs a working tree", change.path)))?;
        // Only folders git itself lists as this repository's worktrees.
        let wt = PathBuf::from(wt)
            .canonicalize()
            .map_err(|_| AppError::Forbidden(format!("unknown worktree {wt}")))?;
        let known = worktrees::list_worktrees(&state.pool, &repo)?
            .into_iter()
            .any(|w| w.path == wt);
        if !known {
            return Err(AppError::Forbidden(format!(
                "{} is not a worktree of this repository",
                wt.display()
            )));
        }
        match read_in_worktree(&wt, &change.path)? {
            WorktreeFile::TooLarge => return Ok(empty(false, true)),
            WorktreeFile::Bytes(bytes) => Some(bytes),
        }
    } else {
        None
    };

    let original = match &change.old_oid {
        Some(oid) => diff::blob_bytes(&repo, oid)?,
        None => Vec::new(),
    };
    let modified = match (&change.new_oid, disk) {
        (Some(oid), _) => diff::blob_bytes(&repo, oid)?,
        (None, Some(bytes)) => bytes,
        // Deleted: nothing on the right.
        (None, None) => Vec::new(),
    };
    if is_binary(&original) || is_binary(&modified) {
        return Ok(empty(true, false));
    }
    Ok(FilePair {
        original: String::from_utf8_lossy(&original).into_owned(),
        modified: String::from_utf8_lossy(&modified).into_owned(),
        binary: false,
        too_large: false,
    })
}

#[derive(Debug, PartialEq, Eq)]
enum WorktreeFile {
    /// File content; for a symlink, the link text. Empty if the file was just deleted.
    Bytes(Vec<u8>),
    TooLarge,
}

/// Reads `rel` inside the canonical worktree folder `wt`, refusing anything that resolves
/// outside it (`..`, absolute paths, symlinked folders pointing elsewhere).
fn read_in_worktree(wt: &Path, rel: &str) -> Result<WorktreeFile, AppError> {
    let forbidden = || AppError::Forbidden(format!("{rel} is outside the worktree"));
    let rel_path = Path::new(rel);
    if rel_path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(forbidden());
    }
    let full = wt.join(rel_path);
    let meta = match std::fs::symlink_metadata(&full) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorktreeFile::Bytes(Vec::new()))
        }
        Err(e) => return Err(e.into()),
    };
    // Its parent folders must not lead out of the worktree either.
    let parent = full.parent().ok_or_else(forbidden)?;
    if !parent.canonicalize()?.starts_with(wt) {
        return Err(forbidden());
    }
    // Git stores a symlink as its target text; show that, not the target's content.
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(&full)?;
        return Ok(WorktreeFile::Bytes(
            target.to_string_lossy().into_owned().into_bytes(),
        ));
    }
    if !full.canonicalize()?.starts_with(wt) {
        return Err(forbidden());
    }
    if meta.len() as usize > MAX_BYTES {
        return Ok(WorktreeFile::TooLarge);
    }
    Ok(WorktreeFile::Bytes(std::fs::read(&full)?))
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(SNIFF_BYTES)].contains(&0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let wt = dir.path().canonicalize().unwrap().join("wt");
        std::fs::create_dir_all(wt.join("src")).unwrap();
        std::fs::write(wt.join("src/a.ts"), "hello\n").unwrap();
        std::fs::write(dir.path().join("secret.txt"), "secret").unwrap();
        (dir, wt)
    }

    #[test]
    fn reads_files_inside_the_worktree() {
        let (_dir, wt) = setup();
        assert_eq!(
            read_in_worktree(&wt, "src/a.ts").unwrap(),
            WorktreeFile::Bytes(b"hello\n".to_vec())
        );
        // Just deleted.
        assert_eq!(
            read_in_worktree(&wt, "src/gone.ts").unwrap(),
            WorktreeFile::Bytes(Vec::new())
        );
    }

    #[test]
    fn refuses_paths_leading_outside() {
        let (_dir, wt) = setup();
        for bad in [
            "../secret.txt",
            "src/../../secret.txt",
            "/etc/passwd",
            "./src/a.ts",
        ] {
            assert!(
                matches!(read_in_worktree(&wt, bad), Err(AppError::Forbidden(_))),
                "{bad}"
            );
        }
        // A folder symlinked out of the worktree.
        std::os::unix::fs::symlink(wt.parent().unwrap(), wt.join("out")).unwrap();
        assert!(matches!(
            read_in_worktree(&wt, "out/secret.txt"),
            Err(AppError::Forbidden(_))
        ));
    }

    #[test]
    fn symlinks_show_their_target_text() {
        let (_dir, wt) = setup();
        std::os::unix::fs::symlink("../secret.txt", wt.join("link")).unwrap();
        assert_eq!(
            read_in_worktree(&wt, "link").unwrap(),
            WorktreeFile::Bytes(b"../secret.txt".to_vec())
        );
    }

    #[test]
    fn nul_in_the_first_8000_bytes_is_binary() {
        assert!(is_binary(b"PNG\0data"));
        assert!(!is_binary(b"plain text\n"));
        let mut late = vec![b'a'; SNIFF_BYTES];
        late.push(0);
        assert!(!is_binary(&late));
    }

    #[test]
    fn github_remotes_become_web_urls() {
        for url in [
            "git@github.com:o/r.git",
            "ssh://git@github.com/o/r.git",
            "ssh://git@github.com:22/o/r",
            "https://github.com/o/r.git",
            "https://user@github.com/o/r/",
        ] {
            assert_eq!(web_url(url).as_deref(), Some("https://github.com/o/r"), "{url}");
        }
        assert_eq!(web_url("git@gitlab.com:o/r.git"), None);
        assert_eq!(web_url("/Users/me/repo"), None);
    }
}
