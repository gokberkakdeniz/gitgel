//! All `#[tauri::command]`s, as thin wrappers over the other modules.

use tauri::{AppHandle, State};

use crate::config;
use crate::error::AppError;
use crate::git::inspect;
use crate::model::{
    BaseOptions, CommitChanges, Config, EntryRef, FileChange, FilePair, FolderCheck, OpenApp,
    ProjectConfig, ProjectView, ReviewData, ReviewTarget, ScanResult, ScriptConfig, ScriptRun,
    Settings, StashChanges, TerminalOption,
};
use crate::state::AppState;
use crate::{apps, base, files, projects, repos, review, scan, scripts, updates, watch};

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
pub async fn get_stash_changes(
    state: State<'_, AppState>,
    repo_id: String,
    sha: String,
) -> Result<StashChanges, AppError> {
    blocking(&state, move |state| {
        review::get_stash_changes(state, &repo_id, &sha)
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

/// Terminal, iTerm2 and WezTerm with their install state, for the Settings dropdown.
#[tauri::command]
pub async fn get_terminal_options(
    state: State<'_, AppState>,
) -> Result<Vec<TerminalOption>, AppError> {
    blocking(&state, |_| Ok(apps::terminal_options())).await
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

/// The update found by the last check, if any (§12 "Updates").
#[tauri::command]
pub fn get_update(app: AppHandle) -> Option<updates::UpdateInfo> {
    updates::current(&app)
}

/// Downloads and installs the update found by the last check, then restarts the app.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), AppError> {
    updates::install(app).await
}

// ---- Scripts (SPEC §14) ----

/// Adds a script (empty `id`) or replaces the one with that id.
#[tauri::command]
pub async fn save_script(
    state: State<'_, AppState>,
    script: ScriptConfig,
) -> Result<Config, AppError> {
    blocking(&state, move |state| scripts::save_script(state, script)).await
}

#[tauri::command]
pub async fn delete_script(
    state: State<'_, AppState>,
    script_id: String,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        scripts::delete_script(state, &script_id)
    })
    .await
}

#[tauri::command]
pub async fn reorder_scripts(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Config, AppError> {
    blocking(&state, move |state| scripts::reorder_scripts(state, &ids)).await
}

#[tauri::command]
pub async fn export_scripts(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    blocking(&state, move |state| {
        scripts::export_scripts(state, std::path::Path::new(&path))
    })
    .await
}

#[tauri::command]
pub async fn read_scripts_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<ScriptConfig>, AppError> {
    blocking(&state, move |_| {
        scripts::read_scripts_file(std::path::Path::new(&path))
    })
    .await
}

/// `replace`: names whose existing script is replaced; other name clashes are kept as both.
#[tauri::command]
pub async fn import_scripts(
    state: State<'_, AppState>,
    scripts: Vec<ScriptConfig>,
    replace: Vec<String>,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        scripts::import_scripts(state, scripts, &replace)
    })
    .await
}

/// Starts a script for an entry (SPEC §14 "Running"); `inputs` holds only the shown inputs.
#[tauri::command]
pub async fn run_script(
    state: State<'_, AppState>,
    script: ScriptConfig,
    entry: EntryRef,
    inputs: std::collections::BTreeMap<String, String>,
    context: scripts::run::RunContext,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::run::run_script(state, script, entry, inputs, context)
    })
    .await
}

/// Typed text for a running script.
#[tauri::command]
pub async fn write_script_input(
    state: State<'_, AppState>,
    run_id: String,
    data: String,
) -> Result<(), AppError> {
    blocking(&state, move |state| {
        scripts::run::write_input(state, &run_id, &data)
    })
    .await
}

#[tauri::command]
pub async fn stop_script(state: State<'_, AppState>, run_id: String) -> Result<(), AppError> {
    blocking(&state, move |state| scripts::run::stop(state, &run_id)).await
}

/// A run with its output so far.
#[tauri::command]
pub async fn get_script_run(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| scripts::run::get_run(state, &run_id)).await
}

/// The output panel's terminal size, for the run's pty.
#[tauri::command]
pub async fn resize_script(
    state: State<'_, AppState>,
    run_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    blocking(&state, move |state| {
        scripts::run::resize(state, &run_id, cols, rows)
    })
    .await
}
