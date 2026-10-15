//! All `#[tauri::command]`s, as thin wrappers over the other modules.

use tauri::{AppHandle, State};

use crate::config;
use crate::error::AppError;
use crate::git::inspect;
use crate::model::{
    BaseOptions, BranchLoss, CheckoutProblem, CheckoutTarget, CommitChanges, Config, EntryRef,
    FileChange, FilePair, FolderCheck, HistoryPage, NewBranchCheckout, NewBranchProblem, OpenApp,
    ProjectConfig, ProjectView, RemoteInfo, ReviewData, ReviewTarget, ScanResult, ScriptConfig,
    ScriptRun, Settings, StashChanges, TerminalOption,
};
use crate::state::AppState;
use crate::{
    ai, apps, base, files, history, projects, repos, review, scan, scripts, updates, watch,
};

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
pub async fn set_repo_pinned(
    state: State<'_, AppState>,
    repo_id: String,
    pinned: bool,
) -> Result<Config, AppError> {
    blocking(&state, move |state| {
        repos::set_repo_pinned(state, &repo_id, pinned)
    })
    .await
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

/// A page of a branch's history (§16).
#[tauri::command]
pub async fn get_history(
    state: State<'_, AppState>,
    repo_id: String,
    rev: String,
    base: Option<String>,
    query: String,
    limit: usize,
) -> Result<HistoryPage, AppError> {
    blocking(&state, move |state| {
        history::get_history(state, &repo_id, &rev, base.as_deref(), &query, limit)
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

/// The web page of a repository's remote, if it has one (for links to a commit or a file).
#[tauri::command]
pub async fn get_remote_url(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Option<RemoteInfo>, AppError> {
    blocking(&state, move |state| files::remote_url(state, &repo_id)).await
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

/// Opens a file of a worktree (or repository) folder in one of `get_open_apps` (Finder reveals
/// it; an editor goes to `line` and `column` when given).
#[tauri::command]
pub async fn open_file(
    state: State<'_, AppState>,
    folder: String,
    file: String,
    app: String,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<(), AppError> {
    let at = line.map(|l| (l, column.unwrap_or(1)));
    blocking(&state, move |_| apps::open_file(&folder, &file, &app, at)).await
}

/// The update found by the last check, if any (§12 "Updates").
#[tauri::command]
pub fn get_update(app: AppHandle) -> Option<updates::UpdateInfo> {
    updates::current(&app)
}

/// Checks now, as Gitgel › Check for Updates… does; the answer arrives as `update-check`.
#[tauri::command]
pub fn check_for_updates(app: AppHandle) {
    updates::check_now(&app);
}

/// Downloads and installs the update found by the last check, then restarts the app.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), AppError> {
    updates::install(app).await
}

/// The Software Update window's state when it opens (§7): the last `update-check`.
#[tauri::command]
pub fn get_update_check(app: AppHandle) -> Option<updates::UpdateCheck> {
    updates::last_answer(&app)
}

/// Opens (or brings forward) About Gitgel, Software Update or What's New (`windows.rs`).
#[tauri::command]
pub async fn open_window(app: AppHandle, label: String) -> Result<(), AppError> {
    let aux = crate::windows::Aux::from_label(&label)
        .ok_or_else(|| AppError::NotFound(format!("no window {label}")))?;
    crate::windows::open(&app, aux);
    Ok(())
}

/// A window's page has drawn: show it (and attach a small one to the main window, `windows.rs`).
/// Sync, so it runs on the main thread, which AppKit needs.
#[tauri::command]
pub fn reveal_window(window: tauri::WebviewWindow) {
    crate::windows::reveal(&window);
}

/// Saves an SSH key's passphrase in the Keychain (§15 "SSH passphrase"), after ssh accepted it.
#[tauri::command]
pub async fn remember_ssh_key(key: String, passphrase: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || crate::ssh::remember(&key, &passphrase))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

/// Opens a remote link (a commit or file page) in the browser; anything but `https://` is refused.
#[tauri::command]
pub fn open_remote_link(url: String) -> Result<(), AppError> {
    if !url.starts_with("https://") {
        return Err(AppError::Forbidden(format!("not a remote link: {url}")));
    }
    crate::menu::open_url(&url);
    Ok(())
}

/// About Gitgel's "Report an Issue": the issues page, as Help › Search or Report an Issue.
#[tauri::command]
pub fn report_issue() {
    crate::menu::open_url(crate::menu::ISSUES_URL);
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

/// Git actions (SPEC §15 "Writing stashes"): `git stash push` in each entry's worktree (all its
/// changes, or the files picked).
#[tauri::command]
pub async fn stash_push(
    state: State<'_, AppState>,
    entries: Vec<scripts::git::StashPush>,
    message: String,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::stash_push(state, entries, message)
    })
    .await
}

/// `git stash apply` (or `pop`) of `stash@{index}`, which must still be `sha`, in a worktree.
#[tauri::command]
pub async fn stash_apply(
    state: State<'_, AppState>,
    repo_id: String,
    index: u32,
    sha: String,
    worktree_path: String,
    pop: bool,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::stash_apply(state, &repo_id, index, &sha, &worktree_path, pop)
    })
    .await
}

/// `git stash drop` of `stash@{index}`, which must still be `sha`.
#[tauri::command]
pub async fn stash_drop(
    state: State<'_, AppState>,
    repo_id: String,
    index: u32,
    sha: String,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::stash_drop(state, &repo_id, index, &sha)
    })
    .await
}

/// Sync (W4a): `git fetch --all --prune` in the repository.
#[tauri::command]
pub async fn git_fetch(state: State<'_, AppState>, repo_id: String) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| scripts::git::fetch(state, &repo_id)).await
}

/// Sync (W4a): `git pull` (or `--rebase`) in the entry's worktree.
#[tauri::command]
pub async fn git_pull(
    state: State<'_, AppState>,
    entry: EntryRef,
    rebase: bool,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::pull(state, entry, rebase)
    })
    .await
}

/// Sync: the entry's branch rebased on its base (fresh from the base's remote when it has one).
#[tauri::command]
pub async fn git_rebase_on_base(
    state: State<'_, AppState>,
    entry: EntryRef,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::rebase_on_base(state, entry)
    })
    .await
}

/// Continue or abort the rebase, merge, cherry-pick or revert stopped in the entry's worktree.
#[tauri::command]
pub async fn git_operation(
    state: State<'_, AppState>,
    entry: EntryRef,
    abort: bool,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::operation(state, entry, abort)
    })
    .await
}

/// Delete Branch: `git branch -D` of a branch whose tip is still `sha`, after switching its
/// checkout to the base or removing its worktree (its changes stashed with `stash`); with
/// `remote`, its branch on the remote first.
#[tauri::command]
pub async fn git_delete_branch(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    sha: String,
    remote: bool,
    stash: bool,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::delete_branch(state, &repo_id, &branch, &sha, remote, stash)
    })
    .await
}

/// New Branch: `branch` from `base`, with no upstream, checked out as `checkout` says.
#[tauri::command]
pub async fn git_create_branch(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    base: String,
    checkout: NewBranchCheckout,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::create_branch(state, &repo_id, &branch, &base, checkout)
    })
    .await
}

/// New Branch's checks as the dialog is filled in.
#[tauri::command]
pub async fn check_new_branch(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    base: String,
    checkout: NewBranchCheckout,
) -> Result<Option<NewBranchProblem>, AppError> {
    blocking(&state, move |state| {
        scripts::git::check_new_branch(state, &repo_id, &branch, &base, &checkout)
    })
    .await
}

/// Checkout Branch: a local branch checked out nowhere, or with `remote` a remote branch as a
/// local one tracking it, checked out where `target` says.
#[tauri::command]
pub async fn git_checkout_branch(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    remote: bool,
    target: CheckoutTarget,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::checkout_branch(state, &repo_id, &branch, remote, target)
    })
    .await
}

/// Checkout Branch's checks as the dialog is filled in.
#[tauri::command]
pub async fn check_checkout(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    remote: bool,
    target: CheckoutTarget,
) -> Result<Option<CheckoutProblem>, AppError> {
    blocking(&state, move |state| {
        scripts::git::check_checkout(state, &repo_id, &branch, remote, &target)
    })
    .await
}

/// Commit (W1a): the checked files of the entry's worktree, with the message.
#[tauri::command]
pub async fn git_commit(
    state: State<'_, AppState>,
    entry: EntryRef,
    files: scripts::git::CommitFiles,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        scripts::git::commit(state, entry, files)
    })
    .await
}

/// Generate message (SPEC §15 "Generate message"): an agent CLI writes a commit message for
/// the entry's checked files, as a run; the answer arrives as `generate-finished`.
#[tauri::command]
pub async fn generate_message_start(
    state: State<'_, AppState>,
    entry: EntryRef,
    include: Vec<String>,
    provider: ai::Provider,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| {
        ai::start(state, entry, include, provider)
    })
    .await
}

/// Whether each agent CLI is installed (Settings › AI, the commit menu).
#[tauri::command]
pub async fn get_ai_status(
    state: State<'_, AppState>,
) -> Result<Vec<ai::ProviderStatus>, AppError> {
    blocking(&state, move |_| Ok(ai::status())).await
}

/// The prompt sent without one of its own (the edit modal prefills it).
#[tauri::command]
pub async fn get_default_prompt() -> Result<String, AppError> {
    Ok(ai::DEFAULT_PROMPT.into())
}

/// Discard (Hi8, D12): the files go back to HEAD in each entry's worktree, a copy of each to the
/// Trash first.
#[tauri::command]
pub async fn git_discard(
    state: State<'_, AppState>,
    entries: Vec<scripts::git::DiscardFiles>,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| scripts::git::discard(state, entries)).await
}

/// Delete Branch's note: the branch's commits on no other branch, tag or remote-tracking branch.
#[tauri::command]
pub async fn get_branch_loss(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
) -> Result<BranchLoss, AppError> {
    blocking(&state, move |state| {
        scripts::git::branch_loss(state, &repo_id, &branch)
    })
    .await
}

/// The paths git's index has staged in the entry's worktree (Uncommitted's boxes start checked).
#[tauri::command]
pub async fn get_staged_paths(
    state: State<'_, AppState>,
    entry: EntryRef,
) -> Result<Vec<String>, AppError> {
    blocking(&state, move |state| {
        scripts::git::staged_paths(state, &entry)
    })
    .await
}

/// Sync (W4a): `git push` of the entry's branch to its remote; `force`: `--force-with-lease`.
#[tauri::command]
pub async fn git_push(
    state: State<'_, AppState>,
    entry: EntryRef,
    force: bool,
) -> Result<ScriptRun, AppError> {
    blocking(&state, move |state| scripts::git::push(state, entry, force)).await
}
