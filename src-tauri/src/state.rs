//! `AppState`: repository pool, config, cache and stored scan shared by commands.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::AppHandle;

use crate::cache::Cache;
use crate::git::pool::RepoPool;
use crate::model::{Config, RepoScan};
use crate::scan::RepoLayout;
use crate::scripts::run::Runs;
use crate::watch::Watcher;

#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

pub struct Inner {
    /// Used to emit events from outside command handlers.
    pub app: AppHandle,
    pub pool: RepoPool,
    pub config: Mutex<Config>,
    pub config_path: PathBuf,
    pub cache: Mutex<Cache>,
    /// Latest scan per repo id.
    pub last_scan: Mutex<HashMap<String, RepoScan>>,
    /// Git dir and worktrees per repo id, from the latest scan.
    pub layouts: Mutex<HashMap<String, RepoLayout>>,
    pub watch: Watcher,
    /// Scripts running or recently finished.
    pub runs: Mutex<Runs>,
}

impl AppState {
    pub fn new(app: AppHandle, config: Config, config_path: PathBuf) -> Self {
        AppState(Arc::new(Inner {
            app,
            pool: RepoPool::default(),
            config: Mutex::new(config),
            config_path,
            cache: Mutex::new(Cache::default()),
            last_scan: Mutex::new(HashMap::new()),
            layouts: Mutex::new(HashMap::new()),
            watch: Watcher::default(),
            runs: Mutex::new(Runs::default()),
        }))
    }
}

impl std::ops::Deref for AppState {
    type Target = Inner;

    fn deref(&self) -> &Inner {
        &self.0
    }
}

/// Locks a mutex, recovering the data if another thread panicked while holding it.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
