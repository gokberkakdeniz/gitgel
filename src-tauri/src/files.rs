//! Reading both sides of a changed file for the diff view.

use std::path::{Component, Path, PathBuf};

use crate::config;
use crate::error::AppError;
use crate::git::{diff, worktrees};
use crate::model::{FileChange, FileKind, FilePair, ImagePair, RemoteInfo, RemoteKind};
use crate::state::{lock, AppState};

/// Larger files are not shown.
const MAX_BYTES: usize = 1024 * 1024;
/// Larger images are not shown.
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
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
            if let Some(image) = &p.image {
                format!(
                    "image, {} B → {} B",
                    image.original_size, image.modified_size
                )
            } else if p.binary {
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

/// The web page of the repository's remote, for links to a commit or a file at a commit;
/// `None` for no remote or a local path. `origin` if there is one.
pub fn remote_url(state: &AppState, repo_id: &str) -> Result<Option<RemoteInfo>, AppError> {
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
        repo.remotes()
            .ok()
            .and_then(|n| n.iter().flatten().flatten().next().map(str::to_string))
    };
    let url = name
        .and_then(|n| repo.find_remote(&n).ok())
        .and_then(|r| r.url().ok().map(str::to_string));
    Ok(url.as_deref().and_then(web_url))
}

/// `git@github.com:o/r.git`, `ssh://git@github.com/o/r` and `https://github.com/o/r.git` all
/// become `https://github.com/o/r`; other hosts keep their host (GitLab subgroups and all).
fn web_url(remote: &str) -> Option<RemoteInfo> {
    let rest = if let Some((_, rest)) = remote.split_once("://") {
        rest.to_string()
    } else {
        remote
            .split_once('@')
            .map_or(remote, |(_, r)| r)
            .replacen(':', "/", 1)
    };
    let rest = rest.split_once('@').map_or(rest.as_str(), |(_, r)| r);
    let (host, path) = rest.split_once('/')?;
    let host = host.split(':').next()?;
    let path = path.trim_end_matches('/').trim_end_matches(".git");
    if host.is_empty() || path.split('/').count() < 2 {
        return None;
    }
    let kind = if host == "github.com" {
        RemoteKind::GitHub
    } else if host == "gitlab.com" || host.contains("gitlab") {
        RemoteKind::GitLab
    } else if host == "bitbucket.org" {
        RemoteKind::Bitbucket
    } else {
        RemoteKind::Other
    };
    Some(RemoteInfo {
        base: format!("https://{host}/{path}"),
        kind,
    })
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
        lossy: false,
        image: None,
    };
    // An image the webview can draw is read even when binary, and up to a larger size.
    let old_mime = image_mime(change.old_path.as_deref().unwrap_or(&change.path));
    let new_mime = image_mime(&change.path);
    let image = old_mime.is_some() || new_mime.is_some();
    if change.binary && !image {
        return Ok(empty(true, false));
    }
    let max = if image { MAX_IMAGE_BYTES } else { MAX_BYTES };
    let mut large = false;
    for oid in [&change.old_oid, &change.new_oid].into_iter().flatten() {
        let size = diff::blob_size(&repo, oid)?;
        if size > max {
            return Ok(empty(false, true));
        }
        large |= size > MAX_BYTES;
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
        match read_in_worktree(&wt, &change.path, max)? {
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
    large |= modified.len() > MAX_BYTES;
    if change.binary || is_binary(&original) || is_binary(&modified) || large {
        if !image {
            return Ok(empty(!large, large));
        }
        let url = |mime: Option<&str>, bytes: &[u8], there: bool| {
            use base64::Engine;
            mime.filter(|_| there).map(|mime| {
                format!(
                    "data:{mime};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )
            })
        };
        return Ok(FilePair {
            image: Some(ImagePair {
                original: url(old_mime, &original, change.old_oid.is_some()),
                modified: url(new_mime, &modified, change.kind != FileKind::D),
                original_size: original.len(),
                modified_size: modified.len(),
            }),
            ..empty(true, false)
        });
    }
    Ok(FilePair {
        image: None,
        lossy: std::str::from_utf8(&original).is_err() || std::str::from_utf8(&modified).is_err(),
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
fn read_in_worktree(wt: &Path, rel: &str, max: usize) -> Result<WorktreeFile, AppError> {
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
    if meta.len() as usize > max {
        return Ok(WorktreeFile::TooLarge);
    }
    Ok(WorktreeFile::Bytes(std::fs::read(&full)?))
}

/// The media type of an image the webview draws in an `<img>`, by the path's extension.
fn image_mime(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" | "apng" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(SNIFF_BYTES)].contains(&0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn image_mime_goes_by_extension() {
        assert_eq!(image_mime("a/logo.PNG"), Some("image/png"));
        assert_eq!(image_mime("photo.jpeg"), Some("image/jpeg"));
        assert_eq!(image_mime("icon.svg"), Some("image/svg+xml"));
        for other in ["a.psd", "a.pdf", "png", "a.png/b", ".png"] {
            assert_eq!(image_mime(other), None, "{other}");
        }
    }

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
            read_in_worktree(&wt, "src/a.ts", MAX_BYTES).unwrap(),
            WorktreeFile::Bytes(b"hello\n".to_vec())
        );
        // Just deleted.
        assert_eq!(
            read_in_worktree(&wt, "src/gone.ts", MAX_BYTES).unwrap(),
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
                matches!(
                    read_in_worktree(&wt, bad, MAX_BYTES),
                    Err(AppError::Forbidden(_))
                ),
                "{bad}"
            );
        }
        // A folder symlinked out of the worktree.
        std::os::unix::fs::symlink(wt.parent().unwrap(), wt.join("out")).unwrap();
        assert!(matches!(
            read_in_worktree(&wt, "out/secret.txt", MAX_BYTES),
            Err(AppError::Forbidden(_))
        ));
    }

    #[test]
    fn symlinks_show_their_target_text() {
        let (_dir, wt) = setup();
        std::os::unix::fs::symlink("../secret.txt", wt.join("link")).unwrap();
        assert_eq!(
            read_in_worktree(&wt, "link", MAX_BYTES).unwrap(),
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
    fn remotes_become_web_urls() {
        for (url, base, kind) in [
            (
                "git@github.com:o/r.git",
                "https://github.com/o/r",
                RemoteKind::GitHub,
            ),
            (
                "ssh://git@github.com/o/r.git",
                "https://github.com/o/r",
                RemoteKind::GitHub,
            ),
            (
                "ssh://git@github.com:22/o/r",
                "https://github.com/o/r",
                RemoteKind::GitHub,
            ),
            (
                "https://github.com/o/r.git",
                "https://github.com/o/r",
                RemoteKind::GitHub,
            ),
            (
                "https://user@github.com/o/r/",
                "https://github.com/o/r",
                RemoteKind::GitHub,
            ),
            (
                "git@gitlab.com:o/r.git",
                "https://gitlab.com/o/r",
                RemoteKind::GitLab,
            ),
            (
                "https://gitlab.com/group/sub/r.git",
                "https://gitlab.com/group/sub/r",
                RemoteKind::GitLab,
            ),
            (
                "git@bitbucket.org:o/r.git",
                "https://bitbucket.org/o/r",
                RemoteKind::Bitbucket,
            ),
            (
                "https://codeberg.org/o/r.git",
                "https://codeberg.org/o/r",
                RemoteKind::Other,
            ),
            (
                "git@gitea.example.com:o/r.git",
                "https://gitea.example.com/o/r",
                RemoteKind::Other,
            ),
        ] {
            assert_eq!(
                web_url(url),
                Some(RemoteInfo {
                    base: base.to_string(),
                    kind
                }),
                "{url}"
            );
        }
        assert_eq!(web_url("/Users/me/repo"), None);
    }
}
