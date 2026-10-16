//! Git actions (SPEC §0, §15 "Writing stashes"): Gitgel's own writes, made by the user's `git`
//! on the scripts' runner. The command text is fixed here; values (folders, the message) go in
//! `GITGEL_*` variables, quoted, so nothing typed or read from disk is ever run as shell. Folders
//! come from the repository's worktree list, never from the frontend, except the new worktree
//! folder of New Branch and Checkout Branch (checked first).

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::config;
use crate::config::new_id;
use crate::error::AppError;
use crate::git::{diff, operation, refs, stash, worktrees};
use crate::model::{
    entry_key, BranchLoss, CheckoutProblem, CheckoutTarget, EntryRef, NewBranchCheckout,
    NewBranchProblem, OperationKind, ScriptRun, UpdateReason,
};
use crate::scan;
use crate::state::{lock, AppState};

use super::run::{self, Launch};

/// `script_id` of every git action's run; the rest names the action.
pub const ACTION_PREFIX: &str = "git:";
const ICON: &str = "package";
const SYNC_ICON: &str = "upload";
/// Before a sync: the passphrases saved in the Keychain into the agent (SPEC §15 "SSH
/// passphrase"), silently; it fails quietly without Apple's ssh-add.
const LOAD_KEYS: &str = "/usr/bin/ssh-add --apple-load-keychain >/dev/null 2>&1; ";

/// A repository as a git action needs it.
struct Repo {
    id: String,
    name: String,
    /// As configured; the pool's key.
    path: PathBuf,
    /// The main worktree's folder.
    main: PathBuf,
    trees: Vec<worktrees::WorktreeInfo>,
}

fn open_repo(state: &AppState, repo_id: &str) -> Result<Repo, AppError> {
    let config = config::snapshot(state);
    let cfg = config
        .repos
        .iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {repo_id}")))?;
    let shared = state.pool.get(Path::new(&cfg.path))?;
    let repo = lock(&shared);
    let trees = worktrees::list_worktrees(&state.pool, &repo)?;
    let main = trees
        .iter()
        .find(|w| w.name.is_none())
        .map(|w| w.path.clone())
        .unwrap_or_else(|| PathBuf::from(&cfg.path));
    Ok(Repo {
        id: repo_id.to_string(),
        name: Path::new(&cfg.path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: PathBuf::from(&cfg.path),
        main,
        trees,
    })
}

impl Repo {
    /// The worktree an entry is checked out in: by branch, or by folder for a detached HEAD.
    fn tree_of(&self, entry: &EntryRef) -> Option<&worktrees::WorktreeInfo> {
        let wanted = entry
            .worktree_path
            .as_deref()
            .and_then(|p| Path::new(p).canonicalize().ok());
        self.trees.iter().find(|w| match &entry.branch {
            Some(b) => w.branch.as_deref() == Some(b.as_str()),
            None => Some(&w.path) == wanted.as_ref(),
        })
    }

    /// `web-app / feat/x` (the short SHA when detached).
    fn label(&self, tree: &worktrees::WorktreeInfo) -> String {
        let branch = tree
            .branch
            .clone()
            .unwrap_or_else(|| tree.head.chars().take(7).collect());
        format!("{} / {branch}", self.name)
    }

    fn not_busy(&self, state: &AppState) -> Result<(), AppError> {
        if run::git_action_running(state, &self.id) {
            return Err(AppError::Invalid(format!(
                "Another git action is running in {}.",
                self.name
            )));
        }
        Ok(())
    }

    /// `stash@{index}` must still be the stash the screen showed; if not, the screen is behind,
    /// so the repo is rescanned too.
    fn check_stash(&self, state: &AppState, index: u32, sha: &str) -> Result<(), AppError> {
        let now = {
            let shared = state.pool.get(&self.path)?;
            let repo = lock(&shared);
            stash::sha_at(&repo, index)?
        };
        if now.as_deref() != Some(sha) {
            scan::rescan_repo(state, &self.id, UpdateReason::Rescan, None);
            return Err(AppError::Invalid(
                "The stash list changed. Pick the stash again.".into(),
            ));
        }
        Ok(())
    }
}

/// One entry of Stash changes (P4): what to stash in its worktree.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashPush {
    #[serde(flatten)]
    pub entry: EntryRef,
    /// The files picked, relative to the worktree (a rename's old path too); `None`: all of them.
    pub paths: Option<Vec<String>>,
    /// Untracked files go too (`--include-untracked`).
    pub untracked: bool,
}

/// How one `git stash push` of the command is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PushStep {
    pub untracked: bool,
    /// Pathspecs (`$GITGEL_PATH_<step>_<n>`); 0: the whole worktree.
    pub paths: usize,
    /// Staged files that were not picked (`$GITGEL_UNSTAGE_<step>_<n>`). git puts every staged
    /// change in a stash, so these are taken out of a copy of the index (`$GITGEL_INDEX_<step>`)
    /// that the stash is made from; the real index then drops the picked files only.
    pub unstage: usize,
}

/// `git stash push` in each entry's worktree, one after another, stopping at the first failure.
pub fn stash_push(
    state: &AppState,
    pushes: Vec<StashPush>,
    message: String,
) -> Result<ScriptRun, AppError> {
    if pushes.is_empty() {
        return Err(AppError::Invalid("Nothing to stash.".into()));
    }
    let mut repos: Vec<Repo> = Vec::new();
    let mut steps: Vec<(PathBuf, String, String)> = Vec::new(); // folder, label, entry key
    let mut env: Vec<(String, String)> = Vec::new();
    let mut shape: Vec<PushStep> = Vec::new();
    let mut temp: Vec<PathBuf> = Vec::new(); // index copies, removed when the run ends
    for (i, push) in pushes.iter().enumerate() {
        let entry = &push.entry;
        let paths = push.paths.as_deref().unwrap_or_default();
        if push.paths.is_some() && paths.is_empty() {
            return Err(AppError::Invalid("Pick at least one file.".into()));
        }
        if paths.iter().any(|p| p.is_empty() || p.contains('\0')) {
            return Err(AppError::Invalid("A picked file has no valid path.".into()));
        }
        for (j, path) in paths.iter().enumerate() {
            env.push((format!("GITGEL_PATH_{}_{}", i + 1, j + 1), path.clone()));
        }
        shape.push(PushStep {
            untracked: push.untracked,
            paths: paths.len(),
            unstage: 0,
        });
        if !repos.iter().any(|r| r.id == entry.repo_id) {
            let repo = open_repo(state, &entry.repo_id)?;
            repo.not_busy(state)?;
            repos.push(repo);
        }
        let repo = repos
            .iter()
            .find(|r| r.id == entry.repo_id)
            .expect("opened");
        let tree = repo.tree_of(entry).ok_or_else(|| {
            AppError::Invalid(format!(
                "{} / {} is not checked out.",
                repo.name,
                entry.branch.as_deref().unwrap_or("detached HEAD")
            ))
        })?;
        steps.push((
            tree.path.clone(),
            repo.label(tree),
            entry_key(
                &entry.repo_id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
        ));
        // Picked files with other staged changes: stash from a copy of the index without them.
        if !paths.is_empty() {
            let (staged, index) = {
                let shared = state.pool.get(&tree.path)?;
                let wt = lock(&shared);
                worktrees::staged(&wt)?
            };
            let keep: Vec<&String> = staged.iter().filter(|p| !paths.contains(p)).collect();
            if !keep.is_empty() {
                let copy = std::env::temp_dir().join(format!("gitgel-{}.index", new_id("stash")));
                std::fs::copy(&index, &copy)?;
                env.push((
                    format!("GITGEL_INDEX_{}", i + 1),
                    copy.to_string_lossy().into_owned(),
                ));
                for (k, p) in keep.iter().enumerate() {
                    env.push((format!("GITGEL_UNSTAGE_{}_{}", i + 1, k + 1), (*p).clone()));
                }
                shape[i].unstage = keep.len();
                temp.push(copy);
            }
        }
    }
    let message = message.trim().to_string();
    env.extend(steps.iter().enumerate().map(|(i, (folder, _, _))| {
        (
            format!("GITGEL_FOLDER_{}", i + 1),
            folder.to_string_lossy().into_owned(),
        )
    }));
    // Picked paths are file names, never pathspec magic (`:(glob)`, `*`).
    env.push(("GIT_LITERAL_PATHSPECS".into(), "1".into()));
    if !message.is_empty() {
        env.push(("GITGEL_MESSAGE".into(), message.clone()));
    }
    let one = steps.len() == 1;
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stash-push"),
            name: "Stash changes".into(),
            icon: ICON.into(),
            entry_key: if one {
                steps[0].2.clone()
            } else {
                format!("{ACTION_PREFIX}stash-push")
            },
            repo_label: if one {
                steps[0].1.clone()
            } else {
                format!("{} entries", steps.len())
            },
            repo_id: repos[0].id.clone(),
            also_rescan: repos[1..].iter().map(|r| r.id.clone()).collect(),
            folder: steps[0].0.clone(),
            command: push_command(&shape, !message.is_empty()),
            env: with_git_env(env),
            cleanup: temp,
        },
    )
}

/// `git stash apply` (or `pop`) of `stash@{index}` in one of the repository's worktrees.
pub fn stash_apply(
    state: &AppState,
    repo_id: &str,
    index: u32,
    sha: &str,
    worktree_path: &str,
    pop: bool,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    let wanted = Path::new(worktree_path).canonicalize()?;
    let tree = repo
        .trees
        .iter()
        .find(|w| w.path == wanted)
        .ok_or_else(|| {
            AppError::Invalid(format!(
                "{worktree_path} is not a worktree of {}.",
                repo.name
            ))
        })?;
    repo.check_stash(state, index, sha)?;
    let verb = if pop { "pop" } else { "apply" };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stash-{verb}"),
            name: format!("{} stash@{{{index}}}", if pop { "Pop" } else { "Apply" }),
            icon: ICON.into(),
            entry_key: entry_key(
                &repo.id,
                tree.branch.as_deref(),
                Some(&tree.path.to_string_lossy()),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: format!("git stash {verb} 'stash@{{{index}}}'"),
            env: with_git_env(Vec::new()),
            cleanup: Vec::new(),
        },
    )
}

/// `git stash drop` of `stash@{index}`, in the repository folder.
pub fn stash_drop(
    state: &AppState,
    repo_id: &str,
    index: u32,
    sha: &str,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    repo.check_stash(state, index, sha)?;
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stash-drop"),
            name: format!("Drop stash@{{{index}}}"),
            icon: ICON.into(),
            entry_key: repo.id.clone(),
            repo_label: repo.name.clone(),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: repo.main.clone(),
            command: format!("git stash drop 'stash@{{{index}}}'"),
            env: with_git_env(Vec::new()),
            cleanup: Vec::new(),
        },
    )
}

/// What a Commit (W1a) holds: the checked files of Uncommitted and the message.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFiles {
    /// Paths relative to the worktree (a rename's old path too): what goes into the commit.
    pub include: Vec<String>,
    pub summary: String,
    pub description: String,
    /// `--no-verify`: the commit hooks are skipped (the failed output panel's "Commit without
    /// hooks").
    pub no_verify: bool,
    /// Amend (Hi10): the SHA of the newest commit, which `--amend` replaces; refused when HEAD
    /// moved since. The files may then be none (only the message changes).
    #[serde(default)]
    pub amend: Option<String>,
}

/// How the one command of a Commit is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CommitShape {
    /// Paths to stage (`$GITGEL_PATH_<n>`).
    pub paths: usize,
    /// Staged paths that are not checked (`$GITGEL_UNSTAGE_<n>`), taken out of the index first.
    pub unstage: usize,
    pub body: bool,
    pub no_verify: bool,
    pub amend: bool,
}

/// Paths whose staged state differs from HEAD in the entry's worktree: the boxes of Uncommitted
/// start checked for them (W1a), as git's index has them. Read only.
pub fn staged_paths(state: &AppState, entry: &EntryRef) -> Result<Vec<String>, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    let tree = repo
        .tree_of(entry)
        .ok_or_else(|| AppError::Invalid(format!("{} is not checked out.", repo.name)))?;
    let shared = state.pool.get(&tree.path)?;
    let wt = lock(&shared);
    Ok(worktrees::staged(&wt)?.0)
}

/// What deleting `branch` loses (Delete Branch's note). Read only.
pub fn branch_loss(state: &AppState, repo_id: &str, branch: &str) -> Result<BranchLoss, AppError> {
    let repo = open_repo(state, repo_id)?;
    let shared = state.pool.get(&repo.path)?;
    let git = lock(&shared);
    refs::branch_loss(&git, branch)
}

/// Commit (W1a): the checked files of the entry's worktree become one commit. The index is made
/// to match the boxes (checked files staged whole, staged files left unchecked taken out), then
/// `git commit` runs with the user's hooks (husky, lefthook, `core.hooksPath`); `--amend` for an
/// Amend (Hi10).
pub fn commit(
    state: &AppState,
    entry: EntryRef,
    files: CommitFiles,
) -> Result<ScriptRun, AppError> {
    let summary = files.summary.trim().to_string();
    let body = files.description.trim().to_string();
    if summary.is_empty() {
        return Err(AppError::Invalid("Write a summary.".into()));
    }
    if files.include.is_empty() && files.amend.is_none() {
        return Err(AppError::Invalid("Pick at least one file.".into()));
    }
    if files
        .include
        .iter()
        .any(|p| p.is_empty() || p.contains('\0'))
    {
        return Err(AppError::Invalid("A picked file has no valid path.".into()));
    }
    let repo = open_repo(state, &entry.repo_id)?;
    repo.not_busy(state)?;
    let tree = repo.tree_of(&entry).ok_or_else(|| {
        AppError::Invalid(format!(
            "{} / {} is not checked out.",
            repo.name,
            entry.branch.as_deref().unwrap_or("detached HEAD")
        ))
    })?;
    let staged = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        if let Some(sha) = &files.amend {
            let head = wt.head().and_then(|h| h.peel_to_commit()).ok();
            if head.map(|c| c.id().to_string()).as_deref() != Some(sha.as_str()) {
                return Err(AppError::Invalid(
                    "The branch has a new commit; amend again.".into(),
                ));
            }
        }
        worktrees::staged(&wt)?.0
    };
    let unstage: Vec<&String> = staged
        .iter()
        .filter(|p| !files.include.contains(p))
        .collect();
    let mut env = vec![
        (
            "GITGEL_FOLDER".to_string(),
            tree.path.to_string_lossy().into_owned(),
        ),
        ("GITGEL_SUMMARY".to_string(), summary),
        // Picked paths are file names, never pathspec magic (`:(glob)`, `*`).
        ("GIT_LITERAL_PATHSPECS".to_string(), "1".to_string()),
    ];
    if !body.is_empty() {
        env.push(("GITGEL_BODY".into(), body.clone()));
    }
    for (i, p) in files.include.iter().enumerate() {
        env.push((format!("GITGEL_PATH_{}", i + 1), p.clone()));
    }
    for (i, p) in unstage.iter().enumerate() {
        env.push((format!("GITGEL_UNSTAGE_{}", i + 1), (*p).clone()));
    }
    let shape = CommitShape {
        paths: files.include.len(),
        unstage: unstage.len(),
        body: !body.is_empty(),
        no_verify: files.no_verify,
        amend: files.amend.is_some(),
    };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}commit"),
            name: if shape.amend { "Amend" } else { "Commit" }.into(),
            icon: ICON.into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: commit_command(shape),
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// One entry of a Discard (Hi8, D12): the files of its Uncommitted to put back to HEAD.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardFiles {
    #[serde(flatten)]
    pub entry: EntryRef,
    /// Relative to the worktree (a rename's old path too).
    pub paths: Vec<String>,
}

/// How one entry's step of a Discard is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct DiscardStep {
    /// Paths git knows (`$GITGEL_PATH_<step>_<n>`): `git restore` from HEAD.
    pub restore: usize,
    /// Untracked paths (`$GITGEL_CLEAN_<step>_<n>`): `git clean`.
    pub clean: usize,
}

/// Discard (SPEC §15 "Discard"): each entry's files go back to HEAD, staged and unstaged alike;
/// untracked ones are removed. A copy of every file still on disk goes to the Trash first; if one
/// cannot, nothing is discarded.
pub fn discard(state: &AppState, discards: Vec<DiscardFiles>) -> Result<ScriptRun, AppError> {
    if discards.is_empty() || discards.iter().any(|d| d.paths.is_empty()) {
        return Err(AppError::Invalid("Nothing to discard.".into()));
    }
    let mut repos: Vec<Repo> = Vec::new();
    let mut steps: Vec<(PathBuf, String, String)> = Vec::new(); // folder, label, entry key
    let mut env: Vec<(String, String)> = Vec::new();
    let mut shape: Vec<DiscardStep> = Vec::new();
    // What goes to the Trash: the file, its repo, branch and path (for the copy's name).
    let mut files: Vec<(PathBuf, String, String, String)> = Vec::new();
    for (i, d) in discards.iter().enumerate() {
        if d.paths.iter().any(|p| !valid_relative(p)) {
            return Err(AppError::Invalid("A picked file has no valid path.".into()));
        }
        let entry = &d.entry;
        if !repos.iter().any(|r| r.id == entry.repo_id) {
            let repo = open_repo(state, &entry.repo_id)?;
            repo.not_busy(state)?;
            repos.push(repo);
        }
        let repo = repos
            .iter()
            .find(|r| r.id == entry.repo_id)
            .expect("opened");
        let tree = repo.tree_of(entry).ok_or_else(|| {
            AppError::Invalid(format!(
                "{} / {} is not checked out.",
                repo.name,
                entry.branch.as_deref().unwrap_or("detached HEAD")
            ))
        })?;
        let known = {
            let shared = state.pool.get(&tree.path)?;
            let wt = lock(&shared);
            worktrees::tracked(&wt, &d.paths)?
        };
        let (mut restore, mut clean) = (0, 0);
        for (path, known) in d.paths.iter().zip(known) {
            let (name, n) = if known {
                restore += 1;
                ("PATH", restore)
            } else {
                clean += 1;
                ("CLEAN", clean)
            };
            env.push((format!("GITGEL_{name}_{}_{n}", i + 1), path.clone()));
            files.push((
                tree.path.join(path),
                repo.name.clone(),
                tree.branch
                    .clone()
                    .unwrap_or_else(|| tree.head.chars().take(7).collect()),
                path.clone(),
            ));
        }
        shape.push(DiscardStep { restore, clean });
        steps.push((
            tree.path.clone(),
            repo.label(tree),
            entry_key(
                &entry.repo_id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
        ));
    }
    let names = crate::trash::copy_names(
        &files
            .iter()
            .map(|(_, repo, branch, path)| crate::trash::Discarded { repo, branch, path })
            .collect::<Vec<_>>(),
        chrono::Local::now(),
    );
    for ((file, ..), name) in files.iter().zip(&names) {
        crate::trash::copy_to_trash(file, name)?;
    }
    env.extend(steps.iter().enumerate().map(|(i, (folder, _, _))| {
        (
            format!("GITGEL_FOLDER_{}", i + 1),
            folder.to_string_lossy().into_owned(),
        )
    }));
    // Picked paths are file names, never pathspec magic (`:(glob)`, `*`).
    env.push(("GIT_LITERAL_PATHSPECS".into(), "1".into()));
    let one = steps.len() == 1;
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}discard"),
            name: "Discard changes".into(),
            icon: "undo".into(),
            entry_key: if one {
                steps[0].2.clone()
            } else {
                format!("{ACTION_PREFIX}discard")
            },
            repo_label: if one {
                steps[0].1.clone()
            } else {
                format!("{} entries", steps.len())
            },
            repo_id: repos[0].id.clone(),
            also_rescan: repos[1..].iter().map(|r| r.id.clone()).collect(),
            folder: steps[0].0.clone(),
            command: discard_command(&shape),
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// A path inside the worktree: relative, no `..`, no NUL.
fn valid_relative(p: &str) -> bool {
    let path = Path::new(p);
    !p.is_empty()
        && !p.contains('\0')
        && path
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
}

/// Runs one sync command (W4a) in `folder` as a git action; values only in `GITGEL_*`.
#[allow(clippy::too_many_arguments)]
fn launch_sync(
    state: &AppState,
    action: &str,
    name: &str,
    repo: &Repo,
    folder: PathBuf,
    label: String,
    entry_key: String,
    command: String,
    env: Vec<(String, String)>,
) -> Result<ScriptRun, AppError> {
    repo.not_busy(state)?;
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}{action}"),
            name: name.into(),
            icon: SYNC_ICON.into(),
            entry_key,
            repo_label: label,
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder,
            command: format!("{LOAD_KEYS}{command}"),
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// Fetch (W4a): `git fetch --all --prune` in the repository folder.
pub fn fetch(state: &AppState, repo_id: &str) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    launch_sync(
        state,
        "fetch",
        "Fetch",
        &repo,
        repo.main.clone(),
        repo.name.clone(),
        repo.id.clone(),
        "git fetch --all --prune".into(),
        Vec::new(),
    )
}

/// A branch entry's repository, branch and where it syncs to.
fn tracked(state: &AppState, entry: &EntryRef) -> Result<(Repo, String, refs::Tracking), AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    let branch = entry
        .branch
        .clone()
        .ok_or_else(|| AppError::Invalid("A detached HEAD has no upstream.".into()))?;
    let tracking = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        refs::tracking(&git, &branch)
    }
    .ok_or_else(|| AppError::Invalid(format!("{} has no remote.", repo.name)))?;
    Ok((repo, branch, tracking))
}

/// Pull (W4a): `git pull [--rebase] <remote> refs/heads/<branch on the remote>` in the entry's
/// worktree, so a branch without a configured upstream pulls from the same name on the remote.
pub fn pull(state: &AppState, entry: EntryRef, rebase: bool) -> Result<ScriptRun, AppError> {
    let (repo, branch, tracking) = tracked(state, &entry)?;
    if tracking.tracking.is_none() {
        return Err(AppError::Invalid(format!(
            "{branch} is not on {}.",
            tracking.remote
        )));
    }
    let tree = repo.tree_of(&entry).ok_or_else(|| {
        AppError::Invalid(format!("{} / {branch} is not checked out.", repo.name))
    })?;
    let env = vec![
        ("GITGEL_REMOTE".into(), tracking.remote),
        (
            "GITGEL_MERGE".into(),
            format!("refs/heads/{}", tracking.branch),
        ),
    ];
    launch_sync(
        state,
        "pull",
        if rebase { "Pull (rebase)" } else { "Pull" },
        &repo,
        tree.path.clone(),
        repo.label(tree),
        entry_key(&repo.id, Some(&branch), Some(&tree.path.to_string_lossy())),
        download_command(rebase),
        env,
    )
}

/// Push (W4a): `git push <remote> refs/heads/<branch>:refs/heads/<on remote>`; a branch the
/// remote does not have yet gets it as its upstream (`--set-upstream`). Forced only when asked,
/// and then `--force-with-lease`: it overwrites only what the last fetch saw on the remote.
pub fn push(state: &AppState, entry: EntryRef, force: bool) -> Result<ScriptRun, AppError> {
    let (repo, branch, tracking) = tracked(state, &entry)?;
    if force && tracking.tracking.is_none() {
        return Err(AppError::Invalid(format!(
            "{branch} is not on {}.",
            tracking.remote
        )));
    }
    let tree = repo.tree_of(&entry);
    let new = tracking.tracking.is_none() && !tracking.configured;
    let env = vec![
        ("GITGEL_REMOTE".into(), tracking.remote),
        (
            "GITGEL_REFSPEC".into(),
            format!("refs/heads/{branch}:refs/heads/{}", tracking.branch),
        ),
    ];
    let key = entry_key(
        &repo.id,
        Some(&branch),
        tree.map(|t| t.path.to_string_lossy()).as_deref(),
    );
    launch_sync(
        state,
        "push",
        if force { "Force push" } else { "Push" },
        &repo,
        // Hooks (pre-push) see the worktree when there is one.
        tree.map_or_else(|| repo.main.clone(), |t| t.path.clone()),
        format!("{} / {branch}", repo.name),
        key,
        upload_command(new, force),
        env,
    )
}

/// Rebase on the base (SPEC §15 "Sync"): the entry's branch onto its base (the one in use: custom
/// or the repo's default), fresh from the base's remote when it has one there (`git pull --rebase
/// <remote> refs/heads/<base on the remote>`, like oh-my-zsh's `gupom` for the default base),
/// else onto the local base (`git rebase <base>`). In the entry's worktree.
pub fn rebase_on_base(state: &AppState, entry: EntryRef) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    let branch = entry
        .branch
        .clone()
        .ok_or_else(|| AppError::Invalid("A detached HEAD has no base to rebase on.".into()))?;
    let tree = repo.tree_of(&entry).ok_or_else(|| {
        AppError::Invalid(format!("{} / {branch} is not checked out.", repo.name))
    })?;
    let base = lock(&state.last_scan)
        .get(&repo.id)
        .and_then(|s| {
            s.active
                .iter()
                .find(|e| e.branch.as_deref() == Some(&branch))
        })
        .and_then(|e| e.base.clone())
        .ok_or_else(|| AppError::Invalid(format!("{branch} has no base.")))?;
    if base == branch {
        return Err(AppError::Invalid(format!("{branch} is its own base.")));
    }
    let upstream = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        base_upstream(&git, &base)
    };
    let (command, env) = match upstream {
        Some((remote, on_remote)) => (
            download_command(true),
            vec![
                ("GITGEL_REMOTE".into(), remote),
                ("GITGEL_MERGE".into(), format!("refs/heads/{on_remote}")),
            ],
        ),
        None => (
            "git rebase \"$GITGEL_BASE\"".to_string(),
            vec![("GITGEL_BASE".into(), base.clone())],
        ),
    };
    launch_sync(
        state,
        "rebase-base",
        &format!("Rebase on {base}"),
        &repo,
        tree.path.clone(),
        repo.label(tree),
        entry_key(&repo.id, Some(&branch), Some(&tree.path.to_string_lossy())),
        command,
        env,
    )
}

/// Continue or abort the operation stopped in the entry's worktree (SPEC §15 "Operations in
/// progress"): `git rebase --continue` / `--abort` (merge, cherry-pick, revert alike). Continue
/// stages the conflicted files first and keeps git's message (`GIT_EDITOR=true`); it is refused
/// while one of them still has git's markers.
pub fn operation(state: &AppState, entry: EntryRef, abort: bool) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    repo.not_busy(state)?;
    let tree = repo.tree_of(&entry).ok_or_else(|| {
        AppError::Invalid(format!(
            "{} / {} is not checked out.",
            repo.name,
            entry.branch.as_deref().unwrap_or("detached HEAD")
        ))
    })?;
    let (op, unmerged) = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        (operation::read(&wt), operation::unmerged(&wt)?)
    };
    let op = op.ok_or_else(|| {
        AppError::Invalid(format!("Nothing is in progress in {}.", repo.label(tree)))
    })?;
    if !abort && !operation::with_markers(&tree.path, &unmerged).is_empty() {
        return Err(AppError::Invalid("Resolve the conflicts first.".into()));
    }
    let (verb, title) = match op.kind {
        OperationKind::Rebase => ("rebase", "Rebase"),
        OperationKind::Merge => ("merge", "Merge"),
        OperationKind::CherryPick => ("cherry-pick", "Cherry-Pick"),
        OperationKind::Revert => ("revert", "Revert"),
    };
    let stage = if abort { 0 } else { unmerged.len() };
    let mut env = vec![
        (
            "GITGEL_FOLDER".to_string(),
            tree.path.to_string_lossy().into_owned(),
        ),
        // Conflicted paths are file names, never pathspec magic.
        ("GIT_LITERAL_PATHSPECS".to_string(), "1".to_string()),
    ];
    for (i, p) in unmerged.iter().take(stage).enumerate() {
        env.push((format!("GITGEL_PATH_{}", i + 1), p.clone()));
    }
    if !abort {
        // The commit keeps the message git prepared; no editor opens in the pty.
        env.push(("GIT_EDITOR".into(), "true".into()));
    }
    let action = if abort { "abort" } else { "continue" };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}{action}"),
            name: format!("{} {title}", if abort { "Abort" } else { "Continue" }),
            icon: "rebase".into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                Some(&tree.path.to_string_lossy()),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: operation_command(verb, abort, stage),
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// Cherry-Pick to (SPEC §16, Hi11): `git cherry-pick <sha>` (`-m 1` for a merge commit) in one of
/// the repository's worktrees. Refused while that worktree has an operation in progress; a
/// conflict stops git there, and the operation then shows on its entry (§15).
pub fn cherry_pick(
    state: &AppState,
    repo_id: &str,
    sha: &str,
    worktree_path: &str,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    let wanted = Path::new(worktree_path).canonicalize()?;
    let tree = repo
        .trees
        .iter()
        .find(|w| w.path == wanted)
        .ok_or_else(|| {
            AppError::Invalid(format!(
                "{worktree_path} is not a worktree of {}.",
                repo.name
            ))
        })?;
    let (merge, full) = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        if operation::read(&wt).is_some() || !operation::unmerged(&wt)?.is_empty() {
            return Err(AppError::Invalid(format!(
                "{} has an operation in progress.",
                repo.label(tree)
            )));
        }
        let commit = git2::Oid::from_str(sha)
            .and_then(|oid| wt.find_commit(oid))
            .map_err(|_| AppError::NotFound(format!("commit {sha}")))?;
        (commit.parent_count() > 1, commit.id().to_string())
    };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}cherry-pick"),
            name: format!("Cherry-Pick {}", &full[..7]),
            icon: "rebase".into(),
            entry_key: entry_key(
                &repo.id,
                tree.branch.as_deref(),
                Some(&tree.path.to_string_lossy()),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: cherry_pick_command(merge),
            env: with_git_env(vec![("GITGEL_COMMIT".into(), full)]),
            cleanup: Vec::new(),
        },
    )
}

/// Undo Commit (SPEC §16, Hi10): `git reset --soft <parent>` in the entry's worktree, so the newest
/// commit goes and its changes stay staged. Refused when HEAD is another commit by then, for a
/// root or merge commit, one already on the remote, or mid-operation.
pub fn undo_commit(state: &AppState, entry: EntryRef, sha: &str) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    repo.not_busy(state)?;
    let tree = repo.tree_of(&entry).ok_or_else(|| {
        AppError::Invalid(format!(
            "{} / {} is not checked out.",
            repo.name,
            entry.branch.as_deref().unwrap_or("detached HEAD")
        ))
    })?;
    let parent = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        if operation::read(&wt).is_some() || !operation::unmerged(&wt)?.is_empty() {
            return Err(AppError::Invalid(format!(
                "{} has an operation in progress.",
                repo.label(tree)
            )));
        }
        let head = wt
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|_| AppError::Invalid("The branch has no commit.".into()))?;
        if head.id().to_string() != sha {
            return Err(AppError::Invalid(
                "The branch has a new commit; undo again.".into(),
            ));
        }
        if head.parent_count() != 1 {
            return Err(AppError::Invalid(
                "Only a commit with one parent can be undone.".into(),
            ));
        }
        if let Some(remote) = entry
            .branch
            .as_deref()
            .and_then(|b| refs::tracking(&wt, b))
            .and_then(|t| t.tracking)
            .and_then(|r| wt.revparse_single(&r).ok())
            .map(|o| o.id())
        {
            if remote == head.id() || wt.graph_descendant_of(remote, head.id()).unwrap_or(false) {
                return Err(AppError::Invalid(
                    "The commit is on the remote already.".into(),
                ));
            }
        }
        head.parent_id(0)?.to_string()
    };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}undo-commit"),
            name: "Undo Commit".into(),
            icon: "undo".into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                Some(&tree.path.to_string_lossy()),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: UNDO_COMMIT_COMMAND.into(),
            env: with_git_env(vec![("GITGEL_PARENT".into(), parent)]),
            cleanup: Vec::new(),
        },
    )
}

/// Undo Commit's command: only fixed text and a quoted variable.
pub(super) const UNDO_COMMIT_COMMAND: &str = "git reset -q --soft \"$GITGEL_PARENT\"";

/// `git cherry-pick [-m 1] "$GITGEL_COMMIT"`: only fixed text and a quoted variable.
pub(super) fn cherry_pick_command(merge: bool) -> String {
    let mainline = if merge { " -m 1" } else { "" };
    format!("git cherry-pick{mainline} \"$GITGEL_COMMIT\"")
}

/// Where the branch Delete Branch removes is checked out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CheckedOut {
    No,
    /// The repository folder: it switches to the repo's base branch first.
    Main,
    /// A linked worktree: it is removed first.
    Linked,
}

/// Delete Branch (SPEC §15 "Delete branch"): `git branch -D` of a local branch whose tip is still
/// `sha` (what the confirmation showed), in the repository folder. Checked out in the repository
/// folder, that switches to the repo's base branch first; in a linked worktree, the worktree is
/// removed first. The checkout's uncommitted changes go to a stash with `stash`, else they are
/// dropped. With `remote`, `git push <remote> --delete` of the branch comes first of all, so a
/// refused push changes nothing.
pub fn delete_branch(
    state: &AppState,
    repo_id: &str,
    branch: &str,
    sha: &str,
    remote: bool,
    stash: bool,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    let base = lock(&state.last_scan)
        .get(&repo.id)
        .and_then(|s| s.base_branch.clone());
    if base.as_deref() == Some(branch) {
        return Err(AppError::Invalid(format!("{branch} is the base branch.")));
    }
    let tree = repo
        .trees
        .iter()
        .find(|w| w.branch.as_deref() == Some(branch));
    if let Some(tree) = tree {
        let shared = state.pool.get(&tree.path)?;
        if operation::read(&lock(&shared)).is_some() {
            return Err(AppError::Invalid(format!(
                "An operation is in progress in {}.",
                repo.label(tree)
            )));
        }
    }
    let (tip, tracking) = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        let tip = git
            .find_branch(branch, git2::BranchType::Local)
            .ok()
            .and_then(|b| b.get().target())
            .map(|o| o.to_string());
        (tip, refs::tracking(&git, branch))
    };
    if tip.as_deref() != Some(sha) {
        scan::rescan_repo(state, &repo.id, UpdateReason::Rescan, None);
        return Err(AppError::Invalid(format!(
            "{branch} changed. Look at it again."
        )));
    }
    let mut env = vec![("GITGEL_BRANCH".to_string(), branch.to_string())];
    let checked_out = match tree {
        None => CheckedOut::No,
        Some(t) => {
            env.push((
                "GITGEL_FOLDER".into(),
                t.path.to_string_lossy().into_owned(),
            ));
            env.push(("GITGEL_MESSAGE".into(), format!("Before deleting {branch}")));
            if t.name.is_none() {
                let base = base.ok_or_else(|| {
                    AppError::Invalid(format!("{} has no base branch to switch to.", repo.name))
                })?;
                env.push(("GITGEL_BASE".into(), base));
                CheckedOut::Main
            } else {
                CheckedOut::Linked
            }
        }
    };
    if remote {
        let t = tracking
            .filter(|t| t.tracking.is_some())
            .ok_or_else(|| AppError::Invalid(format!("{branch} is not on a remote.")))?;
        env.push(("GITGEL_REMOTE".into(), t.remote));
        env.push((
            "GITGEL_REMOTE_REF".into(),
            format!("refs/heads/{}", t.branch),
        ));
    }
    let command = delete_branch_command(remote, checked_out, stash);
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}delete-branch"),
            name: format!("Delete {branch}"),
            icon: "trash".into(),
            entry_key: entry_key(
                &repo.id,
                Some(branch),
                tree.map(|t| t.path.to_string_lossy()).as_deref(),
            ),
            repo_label: format!("{} / {branch}", repo.name),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: repo.main.clone(),
            command: if remote {
                format!("{LOAD_KEYS}{command}")
            } else {
                command
            },
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// `[git push "$GITGEL_REMOTE" --delete "$GITGEL_REMOTE_REF" &&] [<the checkout's changes> &&
/// <switch or remove> &&] git branch -D "$GITGEL_BRANCH"`: only fixed text and quoted variables.
/// The changes go to a stash (`stash push` of a clean checkout saves nothing and succeeds), or are
/// dropped (`reset --hard` and `clean -fd`; a linked worktree's `remove --force` drops them).
pub(super) fn delete_branch_command(remote: bool, checked_out: CheckedOut, stash: bool) -> String {
    let git = "git -C \"$GITGEL_FOLDER\"";
    let mut steps = Vec::new();
    if remote {
        steps.push("git push \"$GITGEL_REMOTE\" --delete \"$GITGEL_REMOTE_REF\"".to_string());
    }
    if checked_out != CheckedOut::No && stash {
        steps.push(format!(
            "{git} stash push --include-untracked --message \"$GITGEL_MESSAGE\""
        ));
    }
    match checked_out {
        CheckedOut::No => {}
        CheckedOut::Main => {
            if !stash {
                steps.push(format!("{git} reset -q --hard"));
                steps.push(format!("{git} clean -fdq"));
            }
            steps.push(format!("{git} switch -q \"$GITGEL_BASE\""));
        }
        CheckedOut::Linked => {
            steps.push("git worktree remove --force \"$GITGEL_FOLDER\"".to_string());
        }
    }
    steps.push("git branch -D \"$GITGEL_BRANCH\"".to_string());
    steps.join(" && ")
}

/// New Branch's checks (SPEC §15 "New branch"). Read only: the name is one git takes for a branch
/// (and not an option) and no local branch has it; the folder, when there is one, is absolute and
/// missing or empty (`git worktree add` makes it and its parents).
pub(super) fn new_branch_problem(
    git: &git2::Repository,
    branch: &str,
    folder: Option<&Path>,
) -> Option<NewBranchProblem> {
    if branch.starts_with('-')
        || branch == "HEAD"
        || branch == "@"
        || !git2::Branch::name_is_valid(branch).unwrap_or(false)
    {
        return Some(NewBranchProblem::BadName);
    }
    if git.find_branch(branch, git2::BranchType::Local).is_ok() {
        return Some(NewBranchProblem::Exists);
    }
    new_folder_issue(folder?).map(|issue| match issue {
        FolderIssue::Bad => NewBranchProblem::BadFolder,
        FolderIssue::NotEmpty => NewBranchProblem::FolderNotEmpty,
    })
}

/// What is wrong with a new worktree's folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FolderIssue {
    /// Not an absolute path, or a file.
    Bad,
    /// Something is in it.
    NotEmpty,
}

/// A new worktree's folder must be absolute and missing or empty (`git worktree add` makes it and
/// its parents).
fn new_folder_issue(folder: &Path) -> Option<FolderIssue> {
    if !folder.is_absolute() {
        return Some(FolderIssue::Bad);
    }
    match std::fs::read_dir(folder) {
        Ok(mut entries) => entries.next().is_some().then_some(FolderIssue::NotEmpty),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => Some(FolderIssue::Bad),
    }
}

/// Where New Branch checks the branch out (SPEC §15 "New branch").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NewBranchRun {
    /// A new linked worktree in `$GITGEL_FOLDER`.
    Worktree,
    /// The repository folder switches to it, its uncommitted changes coming along.
    Switch,
    /// The same, its uncommitted changes stashed first.
    StashSwitch,
    /// Nowhere: the branch only.
    Branch,
}

/// The repository folder's part of the checks, for checking out there: no operation in progress
/// or conflicts, and with `bring`, no uncommitted file that also differs between HEAD and the
/// base (`git switch` would refuse to carry it).
fn main_problem(
    state: &AppState,
    repo: &Repo,
    base: &str,
    bring: bool,
) -> Result<Option<NewBranchProblem>, AppError> {
    let shared = state.pool.get(&repo.main)?;
    let wt = lock(&shared);
    if operation::read(&wt).is_some() || !operation::unmerged(&wt)?.is_empty() {
        return Ok(Some(NewBranchProblem::MainBusy));
    }
    let Some(to) = refs::resolve_commit(&wt, base) else {
        return Ok(None);
    };
    if bring && diff::changes_block_switch(&wt, git2::Oid::from_str(&to)?)? {
        return Ok(Some(NewBranchProblem::CannotBring));
    }
    Ok(None)
}

/// New Branch's checks for the dialog, as it is filled in, and again before the run. Read only.
pub fn check_new_branch(
    state: &AppState,
    repo_id: &str,
    branch: &str,
    base: &str,
    checkout: &NewBranchCheckout,
) -> Result<Option<NewBranchProblem>, AppError> {
    let repo = open_repo(state, repo_id)?;
    let folder = match checkout {
        NewBranchCheckout::Worktree { folder } => Some(Path::new(folder.as_str())),
        _ => None,
    };
    {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        if let Some(problem) = new_branch_problem(&git, branch, folder) {
            return Ok(Some(problem));
        }
    }
    match checkout {
        NewBranchCheckout::Main { bring } => main_problem(state, &repo, base, *bring),
        _ => Ok(None),
    }
}

/// New Branch (SPEC §15 "New branch"): `branch` from the commit `base` resolves to now, with no
/// upstream, checked out as `checkout` says: in a new linked worktree, in the repository folder
/// (its uncommitted changes brought along or stashed first), or nowhere. Runs in the repository
/// folder. The worktree folder is the one path that comes from the frontend: it is checked as
/// above and only ever goes in a variable.
pub fn create_branch(
    state: &AppState,
    repo_id: &str,
    branch: &str,
    base: &str,
    checkout: NewBranchCheckout,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    if let Some(problem) = check_new_branch(state, repo_id, branch, base, &checkout)? {
        return Err(AppError::Invalid(match problem {
            NewBranchProblem::BadName => format!("{branch} is not a valid branch name."),
            NewBranchProblem::Exists => format!("{branch} already exists."),
            NewBranchProblem::BadFolder => "The folder is not a folder path.".into(),
            NewBranchProblem::FolderNotEmpty => "The folder is not empty.".into(),
            NewBranchProblem::MainBusy => {
                "The repository folder has an operation in progress.".into()
            }
            NewBranchProblem::CannotBring => {
                format!("The uncommitted changes conflict with {base}.")
            }
        }));
    }
    let sha = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        refs::resolve_commit(&git, base)
            .ok_or_else(|| AppError::Invalid(format!("{base} is not a commit.")))?
    };
    let mut env = vec![
        ("GITGEL_BRANCH".to_string(), branch.to_string()),
        ("GITGEL_BASE".to_string(), sha),
    ];
    let main = repo.main.to_string_lossy().into_owned();
    let (run, tree) = match checkout {
        NewBranchCheckout::Worktree { folder } => {
            env.push(("GITGEL_FOLDER".into(), folder.clone()));
            (NewBranchRun::Worktree, Some(folder))
        }
        NewBranchCheckout::Main { bring: true } => (NewBranchRun::Switch, Some(main)),
        NewBranchCheckout::Main { bring: false } => {
            env.push((
                "GITGEL_MESSAGE".into(),
                format!("Before switching to {branch}"),
            ));
            (NewBranchRun::StashSwitch, Some(main))
        }
        NewBranchCheckout::None => (NewBranchRun::Branch, None),
    };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}new-branch"),
            name: format!("Create {branch}"),
            icon: "branch".into(),
            entry_key: entry_key(&repo.id, Some(branch), tree.as_deref()),
            repo_label: format!("{} / {branch}", repo.name),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: repo.main.clone(),
            command: create_branch_command(run),
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// `git worktree add -b`, `git switch -c` (after `git stash push` for StashSwitch) or `git
/// branch`, each `--no-track` so a remote base does not become the upstream: only fixed text and
/// quoted variables.
pub(super) fn create_branch_command(run: NewBranchRun) -> String {
    let switch = r#"git switch --no-track -c "$GITGEL_BRANCH" "$GITGEL_BASE""#;
    match run {
        NewBranchRun::Worktree => {
            r#"git worktree add --no-track -b "$GITGEL_BRANCH" "$GITGEL_FOLDER" "$GITGEL_BASE""#
                .into()
        }
        NewBranchRun::Switch => switch.into(),
        NewBranchRun::StashSwitch => {
            format!(r#"git stash push --include-untracked --message "$GITGEL_MESSAGE" && {switch}"#)
        }
        NewBranchRun::Branch => r#"git branch --no-track "$GITGEL_BRANCH" "$GITGEL_BASE""#.into(),
    }
}

/// What Checkout Branch checks out: a local branch checked out nowhere, or a remote-tracking
/// branch (`origin/feat`) as a new local branch (`feat`) tracking it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CheckoutSource {
    /// The local branch.
    local: String,
    /// The remote-tracking ref it starts from (`refs/remotes/origin/feat`), for a remote branch.
    start: Option<String>,
    tip: git2::Oid,
}

/// The branch to check out, or what stops it. A local branch must not be checked out in any of
/// `trees`; a remote one's local name (after the remote, as Branches splits it) must be free.
/// Names starting with `-` are refused, as git would read them as options.
fn checkout_source(
    git: &git2::Repository,
    trees: &[worktrees::WorktreeInfo],
    branch: &str,
    remote: bool,
) -> Result<CheckoutSource, CheckoutProblem> {
    let found = |name: &str, kind| {
        git.find_branch(name, kind)
            .ok()
            .and_then(|b| b.get().target())
    };
    if remote {
        let local = branch
            .split_once('/')
            .map(|(_, b)| b)
            .filter(|b| !b.is_empty() && !b.starts_with('-'))
            .ok_or(CheckoutProblem::Unavailable)?;
        let tip = found(branch, git2::BranchType::Remote).ok_or(CheckoutProblem::Unavailable)?;
        if found(local, git2::BranchType::Local).is_some() {
            return Err(CheckoutProblem::Exists);
        }
        return Ok(CheckoutSource {
            local: local.to_string(),
            start: Some(format!("refs/remotes/{branch}")),
            tip,
        });
    }
    let tip = found(branch, git2::BranchType::Local)
        .filter(|_| !branch.starts_with('-'))
        .ok_or(CheckoutProblem::Unavailable)?;
    if trees.iter().any(|w| w.branch.as_deref() == Some(branch)) {
        return Err(CheckoutProblem::Unavailable);
    }
    Ok(CheckoutSource {
        local: branch.to_string(),
        start: None,
        tip,
    })
}

/// A Checkout Branch that passed its checks: the branch, the folder, and for an existing
/// worktree (which switches to it) whether its changes come along.
struct CheckoutPlan {
    source: CheckoutSource,
    folder: String,
    bring: Option<bool>,
}

/// Checkout Branch's checks (SPEC §15 "Checkout branch"). Read only. An existing worktree must be
/// one of the repo's, with no operation in progress or conflicts, and with `bring`, no uncommitted
/// file that also differs between its HEAD and the branch (`git switch` would refuse to carry
/// it). A new worktree's folder is checked as New Branch's.
fn plan_checkout(
    state: &AppState,
    repo: &Repo,
    branch: &str,
    remote: bool,
    target: &CheckoutTarget,
) -> Result<Result<CheckoutPlan, CheckoutProblem>, AppError> {
    let source = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        match checkout_source(&git, &repo.trees, branch, remote) {
            Ok(source) => source,
            Err(problem) => return Ok(Err(problem)),
        }
    };
    match target {
        CheckoutTarget::New { folder } => Ok(match new_folder_issue(Path::new(folder)) {
            Some(FolderIssue::Bad) => Err(CheckoutProblem::BadFolder),
            Some(FolderIssue::NotEmpty) => Err(CheckoutProblem::FolderNotEmpty),
            None => Ok(CheckoutPlan {
                source,
                folder: folder.clone(),
                bring: None,
            }),
        }),
        CheckoutTarget::Existing { folder, bring } => {
            let wanted = Path::new(folder).canonicalize().ok();
            let Some(tree) = repo.trees.iter().find(|w| Some(&w.path) == wanted.as_ref()) else {
                return Ok(Err(CheckoutProblem::NoWorktree));
            };
            let shared = state.pool.get(&tree.path)?;
            let wt = lock(&shared);
            if operation::read(&wt).is_some() || !operation::unmerged(&wt)?.is_empty() {
                return Ok(Err(CheckoutProblem::Busy));
            }
            if *bring && diff::changes_block_switch(&wt, source.tip)? {
                return Ok(Err(CheckoutProblem::CannotBring));
            }
            Ok(Ok(CheckoutPlan {
                source,
                folder: tree.path.to_string_lossy().into_owned(),
                bring: Some(*bring),
            }))
        }
    }
}

/// Checkout Branch's checks for the dialog, as it is filled in, and again before the run.
pub fn check_checkout(
    state: &AppState,
    repo_id: &str,
    branch: &str,
    remote: bool,
    target: &CheckoutTarget,
) -> Result<Option<CheckoutProblem>, AppError> {
    let repo = open_repo(state, repo_id)?;
    Ok(plan_checkout(state, &repo, branch, remote, target)?.err())
}

/// How Checkout Branch runs (SPEC §15 "Checkout branch").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CheckoutRun {
    /// The worktree in `$GITGEL_FOLDER` switches to the branch; `stash` its uncommitted changes
    /// first, else they come along.
    Switch { stash: bool, track: bool },
    /// A new linked worktree in `$GITGEL_FOLDER`.
    Worktree { track: bool },
}

/// Checkout Branch (SPEC §15 "Checkout branch"): a local branch checked out nowhere, or a remote
/// branch as a new local branch tracking it, checked out in one of the repo's worktrees (which
/// switches to it, its uncommitted changes brought along or stashed first) or in a new linked
/// worktree. Runs in the repository folder.
pub fn checkout_branch(
    state: &AppState,
    repo_id: &str,
    branch: &str,
    remote: bool,
    target: CheckoutTarget,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    let plan = match plan_checkout(state, &repo, branch, remote, &target)? {
        Ok(plan) => plan,
        Err(problem) => {
            scan::rescan_repo(state, &repo.id, UpdateReason::Rescan, None);
            return Err(AppError::Invalid(match problem {
                CheckoutProblem::Unavailable => format!("{branch} cannot be checked out now."),
                CheckoutProblem::Exists => format!("{branch} already exists here."),
                CheckoutProblem::NoWorktree => {
                    "The folder is not a worktree of the repository.".into()
                }
                CheckoutProblem::Busy => "The folder has an operation in progress.".into(),
                CheckoutProblem::CannotBring => {
                    format!("The uncommitted changes conflict with {branch}.")
                }
                CheckoutProblem::BadFolder => "The folder is not a folder path.".into(),
                CheckoutProblem::FolderNotEmpty => "The folder is not empty.".into(),
            }));
        }
    };
    let CheckoutPlan {
        source,
        folder,
        bring,
    } = plan;
    let local = source.local;
    let track = source.start.is_some();
    let mut env = vec![
        ("GITGEL_BRANCH".to_string(), local.clone()),
        ("GITGEL_FOLDER".to_string(), folder.clone()),
    ];
    if let Some(start) = source.start {
        env.push(("GITGEL_START".into(), start));
    }
    let run = match bring {
        Some(bring) => {
            if !bring {
                env.push((
                    "GITGEL_MESSAGE".into(),
                    format!("Before switching to {local}"),
                ));
            }
            CheckoutRun::Switch {
                stash: !bring,
                track,
            }
        }
        None => CheckoutRun::Worktree { track },
    };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}checkout-branch"),
            name: format!("Checkout {local}"),
            icon: "branch".into(),
            entry_key: entry_key(&repo.id, Some(&local), Some(&folder)),
            repo_label: format!("{} / {local}", repo.name),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: repo.main.clone(),
            command: checkout_command(run),
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// `[git -C "$GITGEL_FOLDER" stash push … &&] git -C "$GITGEL_FOLDER" switch …` or `git worktree
/// add …`; a remote branch becomes a local one tracking it (`--track -c` / `--track -b`, from
/// `$GITGEL_START`): only fixed text and quoted variables.
pub(super) fn checkout_command(run: CheckoutRun) -> String {
    let git = r#"git -C "$GITGEL_FOLDER""#;
    match run {
        CheckoutRun::Switch { stash, track } => {
            let switch = if track {
                format!(r#"{git} switch --track -c "$GITGEL_BRANCH" "$GITGEL_START""#)
            } else {
                format!(r#"{git} switch "$GITGEL_BRANCH""#)
            };
            if stash {
                format!(
                    r#"{git} stash push --include-untracked --message "$GITGEL_MESSAGE" && {switch}"#
                )
            } else {
                switch
            }
        }
        CheckoutRun::Worktree { track: true } => {
            r#"git worktree add --track -b "$GITGEL_BRANCH" "$GITGEL_FOLDER" "$GITGEL_START""#
                .into()
        }
        CheckoutRun::Worktree { track: false } => {
            r#"git worktree add "$GITGEL_FOLDER" "$GITGEL_BRANCH""#.into()
        }
    }
}

/// Where a base ref lives on a remote, as `(remote, branch on the remote)`: a local branch's
/// upstream when the remote has it, or a remote-tracking ref split at its remote (`origin/HEAD`
/// followed to the branch it points at). `None` for a base only here.
fn base_upstream(git: &git2::Repository, base: &str) -> Option<(String, String)> {
    if git.find_branch(base, git2::BranchType::Local).is_ok() {
        let t = refs::tracking(git, base)?;
        return t.tracking.is_some().then_some((t.remote, t.branch));
    }
    let reference = git.find_reference(&format!("refs/remotes/{base}")).ok()?;
    let target = reference
        .symbolic_target()
        .ok()
        .flatten()
        .and_then(|t| t.strip_prefix("refs/remotes/"))
        .unwrap_or(base)
        .to_string();
    let remotes = git.remotes().ok()?;
    let names: Vec<&str> = remotes.iter().filter_map(|r| r.ok().flatten()).collect();
    names
        .into_iter()
        .filter_map(|r| Some((r, target.strip_prefix(r)?.strip_prefix('/')?)))
        .max_by_key(|(r, _)| r.len())
        .map(|(r, rest)| (r.to_string(), rest.to_string()))
}

pub(super) fn download_command(rebase: bool) -> String {
    let rebase = if rebase { " --rebase" } else { "" };
    format!("git pull{rebase} \"$GITGEL_REMOTE\" \"$GITGEL_MERGE\"")
}

pub(super) fn upload_command(set_upstream: bool, force: bool) -> String {
    let upstream = if set_upstream { " --set-upstream" } else { "" };
    let force = if force { " --force-with-lease" } else { "" };
    format!("git push{upstream}{force} \"$GITGEL_REMOTE\" \"$GITGEL_REFSPEC\"")
}

/// `git -C "$GITGEL_FOLDER_1" stash push … [-- "$GITGEL_PATH_1_1" …] && git -C "$GITGEL_FOLDER_2" …`:
/// only fixed text and quoted variables, which sh, bash, zsh and fish all read the same way.
pub(super) fn push_command(steps: &[PushStep], message: bool) -> String {
    steps
        .iter()
        .enumerate()
        .map(|(i, step)| {
            let n = i + 1;
            let git = format!("git -C \"$GITGEL_FOLDER_{n}\"");
            let list = |name: &str, count: usize| {
                (1..=count)
                    .map(|j| format!(" \"${name}_{n}_{j}\""))
                    .collect::<String>()
            };
            let mut push = String::from(" stash push");
            if step.untracked {
                push.push_str(" --include-untracked");
            }
            if message {
                push.push_str(" --message \"$GITGEL_MESSAGE\"");
            }
            if step.paths > 0 {
                push.push_str(" --");
                push.push_str(&list("GITGEL_PATH", step.paths));
            }
            if step.unstage == 0 {
                return format!("{git}{push}");
            }
            // `env` sets the variable the same way in every shell.
            let copy = format!("env GIT_INDEX_FILE=\"$GITGEL_INDEX_{n}\" {git}");
            format!(
                "{copy} reset -q --{} && {copy}{push} && {git} reset -q --{}",
                list("GITGEL_UNSTAGE", step.unstage),
                list("GITGEL_PATH", step.paths)
            )
        })
        .collect::<Vec<_>>()
        .join(" && ")
}

/// `git -C "$GITGEL_FOLDER" reset -q -- "$GITGEL_UNSTAGE_1" … && git … add -A -- "$GITGEL_PATH_1" …
/// && git … commit [--no-verify] -m "$GITGEL_SUMMARY" [-m "$GITGEL_BODY"]`: only fixed text and
/// quoted variables.
pub(super) fn commit_command(shape: CommitShape) -> String {
    let git = "git -C \"$GITGEL_FOLDER\"";
    let list = |name: &str, count: usize| {
        (1..=count)
            .map(|j| format!(" \"${name}_{j}\""))
            .collect::<String>()
    };
    let mut steps = Vec::new();
    if shape.unstage > 0 {
        steps.push(format!(
            "{git} reset -q --{}",
            list("GITGEL_UNSTAGE", shape.unstage)
        ));
    }
    if shape.paths > 0 {
        steps.push(format!(
            "{git} add -A --{}",
            list("GITGEL_PATH", shape.paths)
        ));
    }
    let mut commit = format!("{git} commit");
    if shape.amend {
        commit.push_str(" --amend");
    }
    if shape.no_verify {
        commit.push_str(" --no-verify");
    }
    commit.push_str(" -m \"$GITGEL_SUMMARY\"");
    if shape.body {
        commit.push_str(" -m \"$GITGEL_BODY\"");
    }
    steps.push(commit);
    steps.join(" && ")
}

/// `git -C "$GITGEL_FOLDER" add -A -- "$GITGEL_PATH_1" … && git -C "$GITGEL_FOLDER" rebase
/// --continue` (no `add` without paths), or `… rebase --abort`: only fixed text and quoted
/// variables.
pub(super) fn operation_command(verb: &str, abort: bool, paths: usize) -> String {
    let git = "git -C \"$GITGEL_FOLDER\"";
    if abort {
        return format!("{git} {verb} --abort");
    }
    let run = format!("{git} {verb} --continue");
    if paths == 0 {
        return run;
    }
    let list: String = (1..=paths)
        .map(|j| format!(" \"$GITGEL_PATH_{j}\""))
        .collect();
    format!("{git} add -A --{list} && {run}")
}

/// `git -C "$GITGEL_FOLDER_1" restore --source=HEAD --staged --worktree -- "$GITGEL_PATH_1_1" … &&
/// git -C "$GITGEL_FOLDER_1" clean -f -q -- "$GITGEL_CLEAN_1_1" … && git -C "$GITGEL_FOLDER_2" …`:
/// only fixed text and quoted variables.
pub(super) fn discard_command(steps: &[DiscardStep]) -> String {
    steps
        .iter()
        .enumerate()
        .flat_map(|(i, step)| {
            let n = i + 1;
            let git = format!("git -C \"$GITGEL_FOLDER_{n}\"");
            let list = |name: &str, count: usize| {
                (1..=count)
                    .map(|j| format!(" \"${name}_{n}_{j}\""))
                    .collect::<String>()
            };
            let mut parts = Vec::new();
            if step.restore > 0 {
                parts.push(format!(
                    "{git} restore --source=HEAD --staged --worktree --{}",
                    list("GITGEL_PATH", step.restore)
                ));
            }
            if step.clean > 0 {
                parts.push(format!(
                    "{git} clean -f -q --{}",
                    list("GITGEL_CLEAN", step.clean)
                ));
            }
            parts
        })
        .collect::<Vec<_>>()
        .join(" && ")
}

/// git never waits on a pager in the pty.
fn with_git_env(mut env: Vec<(String, String)>) -> Vec<(String, String)> {
    env.push(("GIT_PAGER".into(), "cat".into()));
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_upstream_follows_the_base_to_its_remote() {
        let t = crate::git::testutil::TestRepo::new();
        let tip = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.branch_from("dev", tip);
        // No remote: only the local base.
        assert_eq!(base_upstream(&t.repo, "main"), None);
        t.add_origin();
        t.set_remote("origin/main", tip);
        t.set_origin_head("main");
        let main = Some(("origin".to_string(), "main".to_string()));
        assert_eq!(base_upstream(&t.repo, "main"), main);
        assert_eq!(base_upstream(&t.repo, "origin/main"), main);
        assert_eq!(base_upstream(&t.repo, "origin/HEAD"), main);
        // Not on the remote.
        assert_eq!(base_upstream(&t.repo, "dev"), None);
    }

    #[test]
    fn operation_commands_hold_no_values() {
        assert_eq!(
            operation_command("rebase", true, 0),
            r#"git -C "$GITGEL_FOLDER" rebase --abort"#
        );
        assert_eq!(
            operation_command("merge", false, 0),
            r#"git -C "$GITGEL_FOLDER" merge --continue"#
        );
        assert_eq!(
            operation_command("rebase", false, 2),
            r#"git -C "$GITGEL_FOLDER" add -A -- "$GITGEL_PATH_1" "$GITGEL_PATH_2" && git -C "$GITGEL_FOLDER" rebase --continue"#
        );
    }

    #[test]
    fn undo_commit_command_holds_no_values() {
        assert_eq!(
            UNDO_COMMIT_COMMAND,
            r#"git reset -q --soft "$GITGEL_PARENT""#
        );
    }

    #[test]
    fn cherry_pick_commands_hold_no_values() {
        assert_eq!(
            cherry_pick_command(false),
            r#"git cherry-pick "$GITGEL_COMMIT""#
        );
        assert_eq!(
            cherry_pick_command(true),
            r#"git cherry-pick -m 1 "$GITGEL_COMMIT""#
        );
    }

    #[test]
    fn create_branch_commands_hold_no_values() {
        assert_eq!(
            create_branch_command(NewBranchRun::Branch),
            r#"git branch --no-track "$GITGEL_BRANCH" "$GITGEL_BASE""#
        );
        assert_eq!(
            create_branch_command(NewBranchRun::Worktree),
            r#"git worktree add --no-track -b "$GITGEL_BRANCH" "$GITGEL_FOLDER" "$GITGEL_BASE""#
        );
        assert_eq!(
            create_branch_command(NewBranchRun::Switch),
            r#"git switch --no-track -c "$GITGEL_BRANCH" "$GITGEL_BASE""#
        );
        assert_eq!(
            create_branch_command(NewBranchRun::StashSwitch),
            r#"git stash push --include-untracked --message "$GITGEL_MESSAGE" && git switch --no-track -c "$GITGEL_BRANCH" "$GITGEL_BASE""#
        );
    }

    #[test]
    fn new_branch_problem_checks_the_name_and_folder() {
        let t = crate::git::testutil::TestRepo::new();
        t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        let p = |name: &str, folder: Option<&Path>| new_branch_problem(&t.repo, name, folder);
        assert_eq!(p("feat/x", None), None);
        for bad in ["", "-x", "HEAD", "a..b", "a b", "x.lock", "a/", "@"] {
            assert_eq!(p(bad, None), Some(NewBranchProblem::BadName), "{bad:?}");
        }
        assert_eq!(p("main", None), Some(NewBranchProblem::Exists));
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("wt/feat-x");
        assert_eq!(p("feat/x", Some(&missing)), None);
        assert_eq!(p("feat/x", Some(dir.path())), None);
        std::fs::write(dir.path().join("f"), "x").unwrap();
        assert_eq!(
            p("feat/x", Some(dir.path())),
            Some(NewBranchProblem::FolderNotEmpty)
        );
        assert_eq!(
            p("feat/x", Some(&dir.path().join("f"))),
            Some(NewBranchProblem::BadFolder)
        );
        assert_eq!(
            p("feat/x", Some(Path::new("rel/dir"))),
            Some(NewBranchProblem::BadFolder)
        );
    }

    #[test]
    fn checkout_commands_hold_no_values() {
        let switch = |stash, track| checkout_command(CheckoutRun::Switch { stash, track });
        assert_eq!(
            switch(false, false),
            r#"git -C "$GITGEL_FOLDER" switch "$GITGEL_BRANCH""#
        );
        assert_eq!(
            switch(true, false),
            r#"git -C "$GITGEL_FOLDER" stash push --include-untracked --message "$GITGEL_MESSAGE" && git -C "$GITGEL_FOLDER" switch "$GITGEL_BRANCH""#
        );
        assert_eq!(
            switch(false, true),
            r#"git -C "$GITGEL_FOLDER" switch --track -c "$GITGEL_BRANCH" "$GITGEL_START""#
        );
        assert_eq!(
            checkout_command(CheckoutRun::Worktree { track: false }),
            r#"git worktree add "$GITGEL_FOLDER" "$GITGEL_BRANCH""#
        );
        assert_eq!(
            checkout_command(CheckoutRun::Worktree { track: true }),
            r#"git worktree add --track -b "$GITGEL_BRANCH" "$GITGEL_FOLDER" "$GITGEL_START""#
        );
    }

    #[test]
    fn checkout_source_takes_free_branches() {
        let t = crate::git::testutil::TestRepo::new();
        let tip = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.branch_from("feat", tip);
        t.add_origin();
        t.set_remote("origin/main", tip);
        t.set_remote("origin/fix/x", tip);
        let trees = vec![worktrees::WorktreeInfo {
            path: t.path().to_path_buf(),
            name: None,
            head: tip.to_string(),
            branch: Some("main".into()),
        }];
        let src = |b: &str, remote| checkout_source(&t.repo, &trees, b, remote);
        let feat = src("feat", false).unwrap();
        assert_eq!((feat.local.as_str(), feat.start), ("feat", None));
        let fix = src("origin/fix/x", true).unwrap();
        assert_eq!(fix.local, "fix/x");
        assert_eq!(fix.start.as_deref(), Some("refs/remotes/origin/fix/x"));
        // Checked out already, or not there.
        assert_eq!(src("main", false), Err(CheckoutProblem::Unavailable));
        assert_eq!(src("nope", false), Err(CheckoutProblem::Unavailable));
        assert_eq!(src("origin/nope", true), Err(CheckoutProblem::Unavailable));
        // A local branch has its name.
        assert_eq!(src("origin/main", true), Err(CheckoutProblem::Exists));
    }

    #[test]
    fn delete_branch_commands_hold_no_values() {
        assert_eq!(
            delete_branch_command(false, CheckedOut::No, true),
            r#"git branch -D "$GITGEL_BRANCH""#
        );
        assert_eq!(
            delete_branch_command(true, CheckedOut::No, true),
            r#"git push "$GITGEL_REMOTE" --delete "$GITGEL_REMOTE_REF" && git branch -D "$GITGEL_BRANCH""#
        );
        assert_eq!(
            delete_branch_command(false, CheckedOut::Main, true),
            r#"git -C "$GITGEL_FOLDER" stash push --include-untracked --message "$GITGEL_MESSAGE" && git -C "$GITGEL_FOLDER" switch -q "$GITGEL_BASE" && git branch -D "$GITGEL_BRANCH""#
        );
        assert_eq!(
            delete_branch_command(false, CheckedOut::Main, false),
            r#"git -C "$GITGEL_FOLDER" reset -q --hard && git -C "$GITGEL_FOLDER" clean -fdq && git -C "$GITGEL_FOLDER" switch -q "$GITGEL_BASE" && git branch -D "$GITGEL_BRANCH""#
        );
        assert_eq!(
            delete_branch_command(true, CheckedOut::Linked, false),
            r#"git push "$GITGEL_REMOTE" --delete "$GITGEL_REMOTE_REF" && git worktree remove --force "$GITGEL_FOLDER" && git branch -D "$GITGEL_BRANCH""#
        );
    }

    #[test]
    fn sync_commands_hold_no_values() {
        assert_eq!(
            download_command(false),
            r#"git pull "$GITGEL_REMOTE" "$GITGEL_MERGE""#
        );
        assert_eq!(
            download_command(true),
            r#"git pull --rebase "$GITGEL_REMOTE" "$GITGEL_MERGE""#
        );
        assert_eq!(
            upload_command(false, false),
            r#"git push "$GITGEL_REMOTE" "$GITGEL_REFSPEC""#
        );
        assert_eq!(
            upload_command(true, false),
            r#"git push --set-upstream "$GITGEL_REMOTE" "$GITGEL_REFSPEC""#
        );
        assert_eq!(
            upload_command(false, true),
            r#"git push --force-with-lease "$GITGEL_REMOTE" "$GITGEL_REFSPEC""#
        );
    }

    #[test]
    fn push_commands_hold_no_values() {
        let all = PushStep {
            untracked: false,
            paths: 0,
            unstage: 0,
        };
        assert_eq!(
            push_command(&[all], false),
            r#"git -C "$GITGEL_FOLDER_1" stash push"#
        );
        let picked = PushStep {
            untracked: true,
            paths: 2,
            unstage: 0,
        };
        assert_eq!(
            push_command(&[picked, all], true),
            r#"git -C "$GITGEL_FOLDER_1" stash push --include-untracked --message "$GITGEL_MESSAGE" -- "$GITGEL_PATH_1_1" "$GITGEL_PATH_1_2" && git -C "$GITGEL_FOLDER_2" stash push --message "$GITGEL_MESSAGE""#
        );
        let around = PushStep {
            untracked: false,
            paths: 1,
            unstage: 1,
        };
        assert_eq!(
            push_command(&[around], false),
            r#"env GIT_INDEX_FILE="$GITGEL_INDEX_1" git -C "$GITGEL_FOLDER_1" reset -q -- "$GITGEL_UNSTAGE_1_1" && env GIT_INDEX_FILE="$GITGEL_INDEX_1" git -C "$GITGEL_FOLDER_1" stash push -- "$GITGEL_PATH_1_1" && git -C "$GITGEL_FOLDER_1" reset -q -- "$GITGEL_PATH_1_1""#
        );
    }

    #[test]
    fn discard_commands_hold_no_values() {
        let both = DiscardStep {
            restore: 2,
            clean: 1,
        };
        let untracked = DiscardStep {
            restore: 0,
            clean: 1,
        };
        assert_eq!(
            discard_command(&[both, untracked]),
            r#"git -C "$GITGEL_FOLDER_1" restore --source=HEAD --staged --worktree -- "$GITGEL_PATH_1_1" "$GITGEL_PATH_1_2" && git -C "$GITGEL_FOLDER_1" clean -f -q -- "$GITGEL_CLEAN_1_1" && git -C "$GITGEL_FOLDER_2" clean -f -q -- "$GITGEL_CLEAN_2_1""#
        );
    }

    #[test]
    fn discard_paths_stay_in_the_worktree() {
        assert!(valid_relative("src/a.ts"));
        assert!(valid_relative(".env"));
        assert!(!valid_relative("../a"));
        assert!(!valid_relative("src/../../a"));
        assert!(!valid_relative("/etc/hosts"));
        assert!(!valid_relative("./a"));
        assert!(!valid_relative(""));
    }

    #[test]
    fn commit_commands_hold_no_values() {
        let plain = CommitShape {
            paths: 2,
            unstage: 0,
            body: false,
            no_verify: false,
            amend: false,
        };
        assert_eq!(
            commit_command(plain),
            r#"git -C "$GITGEL_FOLDER" add -A -- "$GITGEL_PATH_1" "$GITGEL_PATH_2" && git -C "$GITGEL_FOLDER" commit -m "$GITGEL_SUMMARY""#
        );
        let full = CommitShape {
            paths: 1,
            unstage: 1,
            body: true,
            no_verify: true,
            amend: false,
        };
        assert_eq!(
            commit_command(full),
            r#"git -C "$GITGEL_FOLDER" reset -q -- "$GITGEL_UNSTAGE_1" && git -C "$GITGEL_FOLDER" add -A -- "$GITGEL_PATH_1" && git -C "$GITGEL_FOLDER" commit --no-verify -m "$GITGEL_SUMMARY" -m "$GITGEL_BODY""#
        );
        // Amend with no files: only the message changes.
        let amend = CommitShape {
            paths: 0,
            unstage: 1,
            body: false,
            no_verify: false,
            amend: true,
        };
        assert_eq!(
            commit_command(amend),
            r#"git -C "$GITGEL_FOLDER" reset -q -- "$GITGEL_UNSTAGE_1" && git -C "$GITGEL_FOLDER" commit --amend -m "$GITGEL_SUMMARY""#
        );
    }
}
