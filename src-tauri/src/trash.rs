//! Discard's safety copies (SPEC §15 "Discard"): before a file is put back to HEAD, a copy of it
//! goes to the Trash as GitHub Desktop does it, named `<file name> <HH-mm-ss-SSS><ext>`
//! (`x1.txt 20-42-56-018.txt`); files of one discard sharing a name get what tells them apart in
//! brackets (`x1.txt (api-server) 20-42-56-018.txt`). Gitgel's one write outside git: the copy is
//! made in the temp folder and moved to the Trash; the file itself is left for the git action.

use std::path::Path;

use chrono::{DateTime, Local};

use crate::config::new_id;
use crate::error::AppError;

/// `x1.txt` at 20:42:56.018 → `x1.txt 20-42-56-018.txt`; no extension, nothing after the time.
/// A `label` goes in brackets before the time: `x1.txt (api-server) 20-42-56-018.txt`.
pub fn copy_name(file_name: &str, label: Option<&str>, at: DateTime<Local>) -> String {
    let ext = Path::new(file_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let label = label.map(|l| format!(" ({l})")).unwrap_or_default();
    format!("{file_name}{label} {}{ext}", at.format("%H-%M-%S-%3f"))
}

/// One file of a discard: its repository, branch (or short SHA) and path in the worktree.
pub struct Discarded<'a> {
    pub repo: &'a str,
    pub branch: &'a str,
    pub path: &'a str,
}

/// The copies' names for one discard, in order. A name no other file of it has stays bare;
/// files sharing a name get the least that tells them apart: the repository, then its branch
/// (two worktrees of one repo), then its folder instead (`index.ts (web-app › src › auth) …`),
/// then both.
pub fn copy_names(files: &[Discarded], at: DateTime<Local>) -> Vec<String> {
    let name = |p: &str| p.rsplit('/').next().unwrap_or(p).to_string();
    // `/` cannot be in a file name; a branch keeps its look with a division slash.
    let branch = |b: &str| b.replace('/', "\u{2215}");
    // (with the branch, with the folder), from least to most.
    const LEVELS: [(bool, bool); 4] = [(false, false), (true, false), (false, true), (true, true)];
    let labels = |f: &Discarded, (with_branch, with_dir): (bool, bool)| -> String {
        let mut parts = vec![f.repo.to_string()];
        if with_branch {
            parts.push(branch(f.branch));
        }
        if with_dir {
            let dir = f.path.rsplit_once('/').map_or("", |(d, _)| d);
            parts.extend(dir.split('/').filter(|d| !d.is_empty()).map(str::to_string));
        }
        parts.join(" › ")
    };
    files
        .iter()
        .map(|f| {
            let own = name(f.path);
            let same: Vec<&Discarded> = files.iter().filter(|g| name(g.path) == own).collect();
            let label = (same.len() > 1).then(|| {
                LEVELS
                    .iter()
                    .map(|&level| (level, labels(f, level)))
                    .find(|(level, l)| same.iter().filter(|g| labels(g, *level) == *l).count() == 1)
                    .map_or_else(|| labels(f, (true, true)), |(_, l)| l)
            });
            copy_name(&own, label.as_deref(), at)
        })
        .collect()
}

/// Copies `file` into the Trash as `name`. A folder or a missing file is skipped.
pub fn copy_to_trash(file: &Path, name: &str) -> Result<(), AppError> {
    if !file.is_file() {
        return Ok(());
    }
    // A folder of its own, so two files of the same name never meet before the Trash.
    let dir = std::env::temp_dir().join(format!("gitgel-{}", new_id("discard")));
    std::fs::create_dir_all(&dir)?;
    let copy = dir.join(name);
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let moved = std::fs::copy(file, &copy)
        .map_err(AppError::from)
        .and_then(|_| move_to_trash(&copy));
    let _ = std::fs::remove_dir_all(&dir);
    moved.map_err(|e| {
        AppError::Invalid(format!(
            "Could not put a copy of {name} in the Trash, so nothing was discarded. {}",
            match e {
                AppError::Invalid(m) | AppError::Io(m) => m,
                other => other.to_string(),
            }
        ))
    })
}

#[cfg(target_os = "macos")]
fn move_to_trash(path: &Path) -> Result<(), AppError> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| AppError::Invalid(e.localizedDescription().to_string()))
}

#[cfg(not(target_os = "macos"))]
fn move_to_trash(_path: &Path) -> Result<(), AppError> {
    Err(AppError::Invalid("No Trash on this system.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn copy_names_carry_the_time_before_the_extension() {
        let at = Local
            .with_ymd_and_hms(2026, 10, 9, 20, 42, 56)
            .unwrap()
            .checked_add_signed(chrono::Duration::milliseconds(18))
            .unwrap();
        assert_eq!(copy_name("x1.txt", None, at), "x1.txt 20-42-56-018.txt");
        assert_eq!(copy_name("Makefile", None, at), "Makefile 20-42-56-018");
        assert_eq!(copy_name(".env", None, at), ".env 20-42-56-018");
        assert_eq!(
            copy_name("a.test.ts", None, at),
            "a.test.ts 20-42-56-018.ts"
        );
        assert_eq!(
            copy_name("x", Some("api-server"), at),
            "x (api-server) 20-42-56-018"
        );
    }

    #[test]
    fn shared_names_get_what_tells_them_apart() {
        let at = Local.with_ymd_and_hms(2026, 10, 9, 21, 20, 6).unwrap();
        let f = |repo, branch, path| Discarded { repo, branch, path };
        let names = copy_names(
            &[
                f("web-app", "main", "x"),
                f("api-server", "main", "x"),
                f("web-app", "main", "src/auth/index.ts"),
                f("web-app", "main", "src/api/index.ts"),
                f("api-server", "feat/a", "lib/y.rs"),
                f("api-server", "feat/b", "lib/y.rs"),
                f("web-app", "main", "README.md"),
            ],
            at,
        );
        assert_eq!(
            names,
            [
                "x (web-app) 21-20-06-000",
                "x (api-server) 21-20-06-000",
                "index.ts (web-app › src › auth) 21-20-06-000.ts",
                "index.ts (web-app › src › api) 21-20-06-000.ts",
                "y.rs (api-server › feat\u{2215}a) 21-20-06-000.rs",
                "y.rs (api-server › feat\u{2215}b) 21-20-06-000.rs",
                "README.md 21-20-06-000.md",
            ]
        );
    }
}
