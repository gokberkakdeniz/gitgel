//! Notes on diff lines (SPEC §5 Review "Notes"): local to this machine, in `notes.json` next to
//! `config.json`, one list per branch (its entry key); never written to a repository.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::config;
use crate::error::AppError;
use crate::state::{lock, AppState};

pub const NOTES_CHANGED: &str = "notes-changed";

/// Larger files are not read for a note's place.
const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteSide {
    /// The diff's old side (removed lines).
    Old,
    /// The new side.
    New,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// The file, relative to the repository (its new path).
    pub path: String,
    pub side: NoteSide,
    /// 1-based, inclusive: where the lines were when the note was written.
    pub from: u32,
    pub to: u32,
    /// The lines' text when the note was written: where it is found again, and it is outdated
    /// once the file no longer has them.
    pub lines: Vec<String>,
    pub text: String,
    /// Unix milliseconds.
    pub created_at: i64,
    #[serde(default)]
    pub resolved: bool,
}

/// Entry key → its notes, in the order they were written.
pub type Notes = BTreeMap<String, Vec<Note>>;

pub struct NoteStore {
    path: PathBuf,
    notes: Mutex<Notes>,
}

impl NoteStore {
    pub fn load(app: &AppHandle) -> Result<Self, AppError> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Io(e.to_string()))?;
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("notes.json");
        let notes = read(&path);
        Ok(NoteStore {
            path,
            notes: Mutex::new(notes),
        })
    }

    pub fn all(&self) -> Notes {
        lock(&self.notes).clone()
    }

    /// Applies `f`, saves and emits `notes-changed`; nothing changes when the save fails.
    pub fn update(&self, app: &AppHandle, f: impl FnOnce(&mut Notes)) -> Result<(), AppError> {
        let next = {
            let mut current = lock(&self.notes);
            let mut next = current.clone();
            f(&mut next);
            next.retain(|_, list| !list.is_empty());
            if next == *current {
                return Ok(());
            }
            save(&self.path, &next)?;
            *current = next.clone();
            next
        };
        if let Err(e) = app.emit(NOTES_CHANGED, &next) {
            log::warn!("cannot emit {NOTES_CHANGED}: {e}");
        }
        Ok(())
    }
}

/// A missing file is no notes; an unreadable one is set aside as `notes.broken-<unix>.json`.
fn read(path: &Path) -> Notes {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Notes::new(),
        Err(e) => {
            log::warn!("cannot read {}: {e}", path.display());
            return Notes::new();
        }
    };
    match serde_json::from_str(&text) {
        Ok(notes) => notes,
        Err(e) => {
            log::warn!("cannot parse {}: {e}", path.display());
            let broken = path.with_file_name(format!(
                "notes.broken-{}.json",
                chrono::Utc::now().timestamp()
            ));
            if let Err(e) = std::fs::rename(path, &broken) {
                log::warn!("cannot move the broken notes aside: {e}");
            }
            Notes::new()
        }
    }
}

/// Writes to `notes.json.tmp`, then renames over `notes.json`.
fn save(path: &Path, notes: &Notes) -> Result<(), AppError> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(notes)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Drops the notes of every branch of a repository (it was removed from Gitgel).
pub fn forget_repo(app: &AppHandle, repo_id: &str) {
    let Some(store) = app.try_state::<NoteStore>() else {
        return;
    };
    let prefix = format!("{repo_id}:");
    if let Err(e) = store.update(app, |notes| notes.retain(|k, _| !k.starts_with(&prefix))) {
        log::warn!("cannot drop the notes of {repo_id}: {e}");
    }
}

/// The files as they are now, for the notes' places: from the worktree when the branch is
/// checked out, else at `rev`. `None` for a file that is missing, binary, too large or not
/// UTF-8.
pub fn current_files(
    state: &AppState,
    repo_id: &str,
    worktree_path: Option<&str>,
    rev: &str,
    paths: &[String],
) -> Result<Vec<Option<String>>, AppError> {
    if let Some(wt) = worktree_path {
        return Ok(paths
            .iter()
            .map(|p| read_worktree(Path::new(wt), p))
            .collect());
    }
    let config = config::snapshot(state);
    let repo_cfg = config
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))?;
    let shared = state.pool.get(Path::new(&repo_cfg.path))?;
    let repo = lock(&shared);
    let tree = repo.revparse_single(rev)?.peel_to_commit()?.tree()?;
    Ok(paths
        .iter()
        .map(|p| {
            let entry = tree.get_path(Path::new(p)).ok()?;
            let blob = repo.find_blob(entry.id()).ok()?;
            if blob.size() as u64 > MAX_BYTES || blob.is_binary() {
                return None;
            }
            String::from_utf8(blob.content().to_vec()).ok()
        })
        .collect())
}

fn read_worktree(root: &Path, path: &str) -> Option<String> {
    // Only paths inside the worktree.
    if Path::new(path)
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return None;
    }
    let file = root.join(path);
    if std::fs::metadata(&file).ok()?.len() > MAX_BYTES {
        return None;
    }
    let bytes = std::fs::read(file).ok()?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str) -> Note {
        Note {
            id: id.into(),
            path: "src/a.ts".into(),
            side: NoteSide::New,
            from: 2,
            to: 3,
            lines: vec!["a".into(), "b".into()],
            text: "Why?".into(),
            created_at: 1,
            resolved: false,
        }
    }

    #[test]
    fn saves_and_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.json");
        let mut notes = Notes::new();
        notes.insert("r_1:main".into(), vec![note("n1")]);
        save(&path, &notes).unwrap();
        assert_eq!(read(&path), notes);
    }

    #[test]
    fn a_broken_file_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.json");
        std::fs::write(&path, "{ nope").unwrap();
        assert!(read(&path).is_empty());
        assert!(!path.exists());
    }

    #[test]
    fn reads_worktree_files_inside_it_only() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x\ny\n").unwrap();
        assert_eq!(
            read_worktree(dir.path(), "a.txt").as_deref(),
            Some("x\ny\n")
        );
        assert_eq!(read_worktree(dir.path(), "../a.txt"), None);
        assert_eq!(read_worktree(dir.path(), "missing.txt"), None);
    }
}
