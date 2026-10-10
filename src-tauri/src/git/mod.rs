//! The only place git2 is used. Nothing here writes to a repository; `clippy.toml` bans the
//! write APIs (only `testutil` may use them, inside its own temp folder).

pub mod diff;
pub mod history;
pub mod inspect;
pub mod operation;
pub mod pool;
pub mod refs;
pub mod stash;
#[cfg(test)]
pub mod testutil;
pub mod worktrees;

use crate::error::AppError;

/// Opaque repository handle for modules outside `git/`: they get it from the pool and pass it
/// to functions here, never calling git2 themselves.
pub type Repo = git2::Repository;

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        AppError::Git(format!("{} ({:?}/{:?})", e.message(), e.class(), e.code()))
    }
}

/// libgit2's object cache across all repositories: `(in use, limit)` in MB.
pub fn object_cache_mb() -> (i64, i64) {
    // SAFETY: reads two process-wide counters; no repository is touched.
    match unsafe { git2::opts::get_cached_memory() } {
        Ok((used, max)) => (used as i64 >> 20, max as i64 >> 20),
        Err(_) => (-1, -1),
    }
}

/// Version of the bundled libgit2, e.g. "1.9.1".
pub fn libgit2_version() -> String {
    let (major, minor, patch) = git2::Version::get().libgit2_version();
    format!("{major}.{minor}.{patch}")
}
