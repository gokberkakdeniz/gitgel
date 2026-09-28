//! All `#[tauri::command]`s, as thin wrappers over the other modules.

use tauri::State;

use crate::config;
use crate::error::AppError;
use crate::git::inspect;
use crate::model::{
    BaseOptions, CommitChanges, Config, EntryRef, FileChange, FilePair, FolderCheck, OpenApp,
    ProjectConfig, ProjectView, ReviewData, ReviewTarget, ScanResult, Settings,
};
use crate::state::AppState;
use crate::{apps, base, files, projects, repos, review, scan, watch};

/// Runs git or disk work off the async runtime.
pub async fn blocking<T, F>(state: &AppState, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> Result<T, AppError> + Send + 'static,
{
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || f(&state))
        .await
        .map_err(|e| AppError::Io(format!("background task failed: {e}")))?
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<Config, AppError> {
    Ok(config::snapshot(&state))
}

#[tauri::command]
pub async fn inspect_folders(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<FolderCheck>, AppError> {
    blocking(&state, move |state| {
        Ok(inspect::inspect_folders(&paths, &config::snapshot(state)))
    })
    .await
}

/// Adds the main repository of every `repo` / `resolved` folder; duplicates and non-repos are
/// skipped.
#[tauri::command]
pub async fn add_repos(state: State<'_, AppState>, paths: Vec<String>) -> Result<Config, AppError> {
    blocking(&state, move |state| repos::add_repos(state, &paths)).await
}

#[tauri::command]
pub async fn locate_repo(
    state: State<'_, AppState>,
    repo_id: String,
    path: String,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        repos::locate_repo(state, &repo_id, &path)
    })
    .await
}

#[tauri::command]
pub async fn remove_repo(state: State<'_, AppState>, repo_id: String) -> Result<Config, AppError> {
    blocking(&state, move |state| repos::remove_repo(state, &repo_id)).await
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Config, AppError> {
    blocking(&state, move |state| repos::update_settings(state, settings)).await
}

/// The stored scan; scans everything first if nothing was scanned yet.
#[tauri::command]
pub async fn get_scan(state: State<'_, AppState>) -> Result<ScanResult, AppError> {
    blocking(&state, |state| {
        Ok(match scan::stored_scan(state) {
            Some(result) => result,
            None => {
                let result = scan::scan_all(state);
                watch::sync_watches(state);
                result
            }
        })
    })
    .await
}

/// Always scans everything, and emits `repo-updated` for each repo so open screens refresh.
#[tauri::command]
/// `force` (the refresh button) also rereads every working tree; window focus relies on the
/// file watcher for those.
pub async fn rescan_all(state: State<'_, AppState>, force: bool) -> Result<ScanResult, AppError> {
    blocking(&state, move |state| {
        if force {
            crate::state::lock(&state.cache).invalidate_workdirs();
        }
        // scan_all emits each repo whose result changed.
        let result = scan::scan_all(state);
        watch::sync_watches(state);
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn get_review(
    state: State<'_, AppState>,
    target: ReviewTarget,
) -> Result<ReviewData, AppError> {
    blocking(&state, move |state| review::get_review(state, &target)).await
}

#[tauri::command]
pub async fn get_commit_changes(
    state: State<'_, AppState>,
    repo_id: String,
    sha: String,
) -> Result<CommitChanges, AppError> {
    blocking(&state, move |state| {
        review::get_commit_changes(state, &repo_id, &sha)
    })
    .await
}

#[tauri::command]
pub async fn read_file_pair(
    state: State<'_, AppState>,
    repo_id: String,
    worktree_path: Option<String>,
    change: FileChange,
) -> Result<FilePair, AppError> {
    blocking(&state, move |state| {
        files::read_file_pair(state, &repo_id, worktree_path.as_deref(), &change)
    })
    .await
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    name: String,
    entries: Vec<EntryRef>,
) -> Result<ProjectConfig, AppError> {
    blocking(&state, move |state| {
        projects::create_project(state, &name, &entries)
    })
    .await
}

#[tauri::command]
pub async fn rename_project(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        projects::rename_project(state, &project_id, &name)
    })
    .await
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        projects::delete_project(state, &project_id)
    })
    .await
}

#[tauri::command]
pub async fn add_entries(
    state: State<'_, AppState>,
    project_id: String,
    entries: Vec<EntryRef>,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        projects::add_entries(state, &project_id, &entries)
    })
    .await
}

#[tauri::command]
pub async fn remove_entries(
    state: State<'_, AppState>,
    project_id: String,
    keys: Vec<String>,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        projects::remove_entries(state, &project_id, &keys)
    })
    .await
}

#[tauri::command]
pub async fn get_project_view(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectView, AppError> {
    blocking(&state, move |state| {
        projects::project_view(state, &project_id)
    })
    .await
}

#[tauri::command]
pub async fn get_base_options(
    state: State<'_, AppState>,
    repo_id: String,
    key: String,
) -> Result<BaseOptions, AppError> {
    blocking(&state, move |state| {
        base::base_options(state, &repo_id, &key)
    })
    .await
}

#[tauri::command]
pub async fn set_branch_base(
    state: State<'_, AppState>,
    key: String,
    base: Option<String>,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        base::set_branch_base(state, &key, base.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn verify_ref(
    state: State<'_, AppState>,
    repo_id: String,
    rev: String,
) -> Result<Option<String>, AppError> {
    blocking(&state, move |state| base::verify_ref(state, &repo_id, &rev)).await
}

#[tauri::command]
pub async fn commit_exists(
    state: State<'_, AppState>,
    repo_id: String,
    sha: String,
) -> Result<bool, AppError> {
    blocking(&state, move |state| {
        base::commit_exists(state, &repo_id, &sha)
    })
    .await
}

#[tauri::command]
pub async fn repoint_entry(
    state: State<'_, AppState>,
    project_id: String,
    key: String,
    branch: String,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        projects::repoint_entry(state, &project_id, &key, &branch)
    })
    .await
}

#[tauri::command]
pub async fn get_open_apps(state: State<'_, AppState>) -> Result<Vec<OpenApp>, AppError> {
    blocking(&state, |state| {
        Ok(apps::installed(&config::snapshot(state).settings))
    })
    .await
}

/// Opens a worktree folder in one of `get_open_apps` (Finder included).
#[tauri::command]
pub async fn open_folder(
    state: State<'_, AppState>,
    path: String,
    app: String,
) -> Result<(), AppError> {
    blocking(&state, move |state| {
        apps::open_folder(&path, &app, &config::snapshot(state).settings)
    })
    .await
}
