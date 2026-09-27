//! One `Repository` per path, each behind its own `Mutex`.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use git2::{Repository, RepositoryOpenFlags};

use crate::error::AppError;

pub type SharedRepo = Arc<Mutex<Repository>>;

#[derive(Default)]
pub struct RepoPool {
    repos: Mutex<HashMap<PathBuf, SharedRepo>>,
}

impl RepoPool {
    /// Opens the repository (or worktree) at exactly `path`, or returns the pooled one. Does not
    /// search parent folders.
    pub fn get(&self, path: &Path) -> Result<SharedRepo, AppError> {
        let path = path.canonicalize().map_err(|e| {
            log::warn!("cannot open repository {}: {e}", path.display());
            AppError::NotFound(path.display().to_string())
        })?;
        if let Some(repo) = self.lock().get(&path) {
            return Ok(repo.clone());
        }
        let repo = Repository::open_ext(&path, RepositoryOpenFlags::NO_SEARCH, &[] as &[&OsStr])
            .map_err(|e| {
                log::warn!("cannot open repository {}: {}", path.display(), e.message());
                AppError::from(e)
            })?;
        // Another thread may have opened it meanwhile; keep whichever got in first.
        let repo = self
            .lock()
            .entry(path)
            .or_insert_with(|| Arc::new(Mutex::new(repo)))
            .clone();
        Ok(repo)
    }

    pub fn forget(&self, path: &Path) {
        let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        self.lock().remove(&path);
    }

    /// Closes every pooled repository, freeing libgit2's object cache and pack windows; they
    /// reopen on the next request. Holders of a repository keep theirs until they drop it.
    pub fn clear(&self) {
        self.lock().clear();
    }

    /// Drops repositories whose folder no longer exists.
    pub fn retain_existing(&self) {
        self.lock().retain(|path, _| path.exists());
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, SharedRepo>> {
        self.repos.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;

    #[test]
    fn same_path_returns_same_repo() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a"))], "init", 0);
        let pool = RepoPool::default();
        let a = pool.get(t.path()).unwrap();
        // A non-canonical spelling of the same folder hits the same entry.
        let b = pool.get(&t.path().join("..").join("repo")).unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(pool.len(), 1);
    }

    #[test]
    fn subfolder_is_not_searched_upwards() {
        let t = TestRepo::new();
        t.write_file(t.path(), "src/a.txt", b"a");
        let pool = RepoPool::default();
        assert!(pool.get(&t.path().join("src")).is_err());
        assert_eq!(pool.len(), 0);
    }

    #[test]
    fn missing_path_is_an_error() {
        let pool = RepoPool::default();
        assert!(pool.get(Path::new("/nonexistent/gitgel/repo")).is_err());
    }

    #[test]
    fn retain_existing_drops_deleted_folders() {
        let t = TestRepo::new();
        let oid = t.commit_on("main", &[("a.txt", Some(b"a"))], "init", 0);
        t.branch_from("side", oid);
        let wt = t.add_worktree("gone", "side");
        let pool = RepoPool::default();
        pool.get(t.path()).unwrap();
        pool.get(&wt).unwrap();
        assert_eq!(pool.len(), 2);

        std::fs::remove_dir_all(&wt).unwrap();
        pool.retain_existing();
        assert_eq!(pool.len(), 1);

        pool.forget(t.path());
        assert_eq!(pool.len(), 0);
    }
}
