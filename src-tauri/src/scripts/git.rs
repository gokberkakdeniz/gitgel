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
    entry_key, BranchLoss, CheckoutProblem, CheckoutTarget, EntryRef, IndexChanges,
    NewBranchCheckout, NewBranchProblem, NewTagProblem, OperationKind, ScriptRun, UpdateReason,
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

/// One stash of an Apply, Pop or Drop: `stash@{index}`, which must still be `sha`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashRef {
    pub index: u32,
    pub sha: String,
}

/// `git stash <verb>` of each index, the highest first: a pop or drop renumbers only the stashes
/// above it, so the rest keep the numbers the screen showed (and the oldest is applied first).
pub(super) fn stash_command(verb: &str, indexes: &[u32]) -> String {
    let mut sorted = indexes.to_vec();
    sorted.sort_unstable_by(|a, b| b.cmp(a));
    sorted.dedup();
    sorted
        .iter()
        .map(|i| format!("git stash {verb} 'stash@{{{i}}}'"))
        .collect::<Vec<_>>()
        .join(" && ")
}

/// "Drop stash@{2}", "Drop 3 stashes".
fn stash_action_name(verb: &str, indexes: &[u32]) -> String {
    match indexes {
        [index] => format!("{verb} stash@{{{index}}}"),
        many => format!("{verb} {} stashes", many.len()),
    }
}

/// The stashes of one action, each still where the screen showed it.
fn checked_stashes(
    state: &AppState,
    repo: &Repo,
    stashes: &[StashRef],
) -> Result<Vec<u32>, AppError> {
    if stashes.is_empty() {
        return Err(AppError::Invalid("No stash picked.".into()));
    }
    for s in stashes {
        repo.check_stash(state, s.index, &s.sha)?;
    }
    Ok(stashes.iter().map(|s| s.index).collect())
}

/// `git stash apply` (or `pop`) of one or several stashes in one of the repository's worktrees.
pub fn stash_apply(
    state: &AppState,
    repo_id: &str,
    stashes: &[StashRef],
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
    let indexes = checked_stashes(state, &repo, stashes)?;
    let verb = if pop { "pop" } else { "apply" };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stash-{verb}"),
            name: stash_action_name(if pop { "Pop" } else { "Apply" }, &indexes),
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
            command: stash_command(verb, &indexes),
            env: with_git_env(Vec::new()),
            cleanup: Vec::new(),
        },
    )
}

/// `git stash drop` of one or several stashes, in the repository folder.
pub fn stash_drop(
    state: &AppState,
    repo_id: &str,
    stashes: &[StashRef],
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    let indexes = checked_stashes(state, &repo, stashes)?;
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stash-drop"),
            name: stash_action_name("Drop", &indexes),
            icon: ICON.into(),
            entry_key: repo.id.clone(),
            repo_label: repo.name.clone(),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: repo.main.clone(),
            command: stash_command("drop", &indexes),
            env: with_git_env(Vec::new()),
            cleanup: Vec::new(),
        },
    )
}

/// What a Commit (W1a) holds besides the index: the message.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFiles {
    pub summary: String,
    pub description: String,
    /// `--no-verify`: the commit hooks are skipped (the failed output panel's "Commit without
    /// hooks").
    pub no_verify: bool,
    /// Amend (Hi10): the SHA of the newest commit, which `--amend` replaces; refused when HEAD
    /// moved since. Nothing may be staged then (only the message changes).
    #[serde(default)]
    pub amend: Option<String>,
}

/// How the one command of a Commit is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CommitShape {
    pub body: bool,
    pub no_verify: bool,
    pub amend: bool,
}

/// The entry's uncommitted changes as git's index splits them: History's Staged and Unstaged
/// sections (W1a). Read only.
pub fn index_changes(state: &AppState, entry: &EntryRef) -> Result<IndexChanges, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    let tree = repo
        .tree_of(entry)
        .ok_or_else(|| AppError::Invalid(format!("{} is not checked out.", repo.name)))?;
    let shared = state.pool.get(&tree.path)?;
    let wt = lock(&shared);
    diff::index_changes(&wt)
}

/// What a Stage (History's sections) changes in git's index: whole files.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageFiles {
    /// Relative to the worktree (a rename's old path too): `git add -A`.
    pub stage: Vec<String>,
    /// `git restore --staged` (`git rm --cached` before the first commit).
    pub unstage: Vec<String>,
}

/// How the one command of a Stage is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct StageShape {
    /// `$GITGEL_STAGE_<n>`.
    pub stage: usize,
    /// `$GITGEL_UNSTAGE_<n>`.
    pub unstage: usize,
    /// No commit yet: nothing to restore from.
    pub unborn: bool,
}

/// Stage / Unstage (History's sections, SPEC §15 "Stage"): files go into git's index or out of
/// it, whole. A git action without toasts of its own; the History queue batches clicks into one.
pub fn stage(state: &AppState, entry: EntryRef, files: StageFiles) -> Result<ScriptRun, AppError> {
    if files.stage.is_empty() && files.unstage.is_empty() {
        return Err(AppError::Invalid("Nothing to stage.".into()));
    }
    if files
        .stage
        .iter()
        .chain(&files.unstage)
        .any(|p| !valid_relative(p))
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
    let unborn = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        let born = wt.head().and_then(|h| h.peel_to_commit()).is_ok();
        !born
    };
    let mut env = vec![
        (
            "GITGEL_FOLDER".to_string(),
            tree.path.to_string_lossy().into_owned(),
        ),
        // Picked paths are file names, never pathspec magic (`:(glob)`, `*`).
        ("GIT_LITERAL_PATHSPECS".to_string(), "1".to_string()),
    ];
    for (i, p) in files.stage.iter().enumerate() {
        env.push((format!("GITGEL_STAGE_{}", i + 1), p.clone()));
    }
    for (i, p) in files.unstage.iter().enumerate() {
        env.push((format!("GITGEL_UNSTAGE_{}", i + 1), p.clone()));
    }
    let shape = StageShape {
        stage: files.stage.len(),
        unstage: files.unstage.len(),
        unborn,
    };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stage"),
            name: if shape.stage > 0 { "Stage" } else { "Unstage" }.into(),
            icon: "plus".into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: stage_command(shape),
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// What a Stage of picked lines (the diff's menu) puts in git's index: one file's new staged
/// version, made from the lines shown.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageLines {
    /// Relative to the worktree.
    pub path: String,
    /// The file's whole new staged version.
    pub content: String,
    /// The staged blob the content was made from (none: the file is not in the index); refused
    /// when the index has another by now.
    pub expect: Option<String>,
    /// Only names the run: "Unstage" when the content takes changes out of the index.
    pub unstage: bool,
}

/// Stage / Unstage of picked lines (SPEC §15 "Stage"): the file's new staged version is written
/// as a blob and put in the index (`hash-object -w` + `update-index --cacheinfo`), the file's
/// mode kept. A git action without toasts of its own, queued with the whole-file ones.
pub fn stage_lines(
    state: &AppState,
    entry: EntryRef,
    lines: StageLines,
) -> Result<ScriptRun, AppError> {
    if !valid_relative(&lines.path) {
        return Err(AppError::Invalid("The file has no valid path.".into()));
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
    let mode = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        worktrees::stage_mode(&wt, &tree.path, &lines.path, lines.expect.as_deref())?
    };
    let blob = std::env::temp_dir().join(format!("gitgel-{}.blob", new_id("stage")));
    std::fs::write(&blob, lines.content.as_bytes())?;
    let env = vec![
        (
            "GITGEL_FOLDER".to_string(),
            tree.path.to_string_lossy().into_owned(),
        ),
        ("GITGEL_PATH".to_string(), lines.path.clone()),
        ("GITGEL_MODE".to_string(), mode),
        (
            "GITGEL_BLOB".to_string(),
            blob.to_string_lossy().into_owned(),
        ),
    ];
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stage"),
            name: if lines.unstage { "Unstage" } else { "Stage" }.into(),
            icon: "plus".into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: stage_lines_command(),
            env: with_git_env(env),
            cleanup: vec![blob],
        },
    )
}

/// What deleting `branch` loses (Delete Branch's note). Read only.
pub fn branch_loss(state: &AppState, repo_id: &str, branch: &str) -> Result<BranchLoss, AppError> {
    let repo = open_repo(state, repo_id)?;
    let shared = state.pool.get(&repo.path)?;
    let git = lock(&shared);
    refs::branch_loss(&git, branch)
}

/// Commit (W1a): what is staged in the entry's worktree becomes one commit: `git commit` runs
/// with the user's hooks (husky, lefthook, `core.hooksPath`); `--amend` for an Amend (Hi10).
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
    if staged.is_empty() && files.amend.is_none() {
        return Err(AppError::Invalid("Nothing is staged.".into()));
    }
    let mut env = vec![
        (
            "GITGEL_FOLDER".to_string(),
            tree.path.to_string_lossy().into_owned(),
        ),
        ("GITGEL_SUMMARY".to_string(), summary),
    ];
    if !body.is_empty() {
        env.push(("GITGEL_BODY".into(), body.clone()));
    }
    let shape = CommitShape {
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
    /// Those of `paths` whose unstaged part alone goes (History's Unstaged rows): back to the
    /// index, not to HEAD.
    #[serde(default)]
    pub keep_index: Vec<String>,
}

/// How one entry's step of a Discard is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct DiscardStep {
    /// Paths git knows (`$GITGEL_PATH_<step>_<n>`): `git restore` from HEAD.
    pub restore: usize,
    /// Paths in the index whose staged version stays (`$GITGEL_KEEP_<step>_<n>`): `git restore
    /// --worktree` from the index.
    pub keep: usize,
    /// Untracked paths (`$GITGEL_CLEAN_<step>_<n>`): `git clean`.
    pub clean: usize,
}

/// Discard (SPEC §15 "Discard"): each entry's files go back to HEAD, staged and unstaged alike,
/// or (`keep_index`) back to what is staged; untracked ones are removed. A copy of every file still on disk goes to the Trash first; if one
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
        let (known, staged) = {
            let shared = state.pool.get(&tree.path)?;
            let wt = lock(&shared);
            (
                worktrees::tracked(&wt, &d.paths)?,
                worktrees::in_index(&wt, &d.paths)?,
            )
        };
        let (mut restore, mut keep, mut clean) = (0, 0, 0);
        for ((path, known), staged) in d.paths.iter().zip(known).zip(staged) {
            let (name, n) = if d.keep_index.contains(path) && staged {
                keep += 1;
                ("KEEP", keep)
            } else if known && !d.keep_index.contains(path) {
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
        shape.push(DiscardStep {
            restore,
            keep,
            clean,
        });
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

/// What a Discard of picked lines (the diff's menu on an Unstaged row) writes: one file's new
/// working-tree version, made from the lines shown.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardLines {
    /// Relative to the worktree.
    pub path: String,
    /// The file's whole new content.
    pub content: String,
    /// The file's content the new one was made from; refused when the file holds another by now.
    pub expect: String,
}

/// Discard of picked lines (SPEC §15 "Discard"): the file in the working tree is written with the
/// picked changes taken out (back to what is staged), after a copy of it went to the Trash.
pub fn discard_lines(
    state: &AppState,
    entry: EntryRef,
    lines: DiscardLines,
) -> Result<ScriptRun, AppError> {
    let rel = lines.path.as_str();
    if !valid_relative(rel) {
        return Err(AppError::Invalid("The file has no valid path.".into()));
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
    let unmerged = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        operation::unmerged(&wt)?
    };
    if unmerged.iter().any(|p| p == rel) {
        return Err(AppError::Invalid(format!("{rel} has merge conflicts.")));
    }
    let file = tree.path.join(rel);
    let regular = std::fs::symlink_metadata(&file).is_ok_and(|m| m.is_file());
    let inside = file
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .is_some_and(|p| p.starts_with(&tree.path));
    if !regular || !inside {
        return Err(AppError::Invalid(format!(
            "{rel} is not a file in the worktree."
        )));
    }
    if std::fs::read(&file)? != lines.expect.as_bytes() {
        return Err(AppError::Invalid(format!(
            "{rel} changed. Pick the lines again."
        )));
    }
    let branch = tree
        .branch
        .clone()
        .unwrap_or_else(|| tree.head.chars().take(7).collect());
    let names = crate::trash::copy_names(
        &[crate::trash::Discarded {
            repo: &repo.name,
            branch: &branch,
            path: rel,
        }],
        chrono::Local::now(),
    );
    crate::trash::copy_to_trash(&file, &names[0])?;
    let blob = std::env::temp_dir().join(format!("gitgel-{}.blob", new_id("discard")));
    std::fs::write(&blob, lines.content.as_bytes())?;
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}discard"),
            name: "Discard changes".into(),
            icon: "undo".into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: DISCARD_LINES_COMMAND.into(),
            env: with_git_env(vec![
                (
                    "GITGEL_FOLDER".to_string(),
                    tree.path.to_string_lossy().into_owned(),
                ),
                ("GITGEL_PATH".to_string(), lines.path.clone()),
                (
                    "GITGEL_BLOB".to_string(),
                    blob.to_string_lossy().into_owned(),
                ),
            ]),
            cleanup: vec![blob],
        },
    )
}

/// The new content over the file (its mode stays); only fixed text and quoted variables.
pub(super) const DISCARD_LINES_COMMAND: &str =
    r#"cat "$GITGEL_BLOB" > "$GITGEL_FOLDER/$GITGEL_PATH""#;

/// What a Stash of picked lines (the diff's menu on an Unstaged row) writes: the file as the
/// stash holds it and as the working tree keeps it, both made from the lines shown.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashLines {
    /// Relative to the worktree.
    pub path: String,
    /// The file in the stash: what is staged with the picked changes.
    pub content: String,
    /// The file in the working tree afterwards: without the picked changes.
    pub rest: String,
    /// The file's content both were made from; refused when the file holds another by now.
    pub expect: String,
    /// The staged blob both were made from (none: not in the index); refused when the index has
    /// another by now.
    pub expect_index: Option<String>,
}

/// Stash of picked lines (SPEC §15 "Writing stashes"): a stash of the picked changes alone, built
/// with `commit-tree` from two temp indexes (HEAD with the file's staged version; HEAD with the
/// stashed one), based on HEAD or, when the file has staged changes, on a commit of them; put on
/// the stack with `stash store`, then the working tree loses those changes. The real index and
/// every other file stay as they are.
pub fn stash_lines(
    state: &AppState,
    entry: EntryRef,
    lines: StashLines,
    message: String,
) -> Result<ScriptRun, AppError> {
    let rel = lines.path.as_str();
    if !valid_relative(rel) {
        return Err(AppError::Invalid("The file has no valid path.".into()));
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
    let (mode, head, subject, on_index) = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        if !operation::unmerged(&wt)?.is_empty() {
            return Err(AppError::Invalid(format!(
                "{} has merge conflicts.",
                repo.label(tree)
            )));
        }
        let mode = worktrees::stage_mode(&wt, &tree.path, rel, lines.expect_index.as_deref())?;
        let commit = wt.head().and_then(|h| h.peel_to_commit()).map_err(|_| {
            AppError::Invalid("Nothing can be stashed before the first commit.".into())
        })?;
        let subject = commit
            .summary()
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_string();
        // Staged changes to the file: the stash is based on them, so it holds the picks alone.
        let in_head = commit
            .tree()?
            .get_path(Path::new(rel))
            .ok()
            .map(|e| e.id().to_string());
        let on_index = in_head != lines.expect_index;
        (mode, commit.id().to_string(), subject, on_index)
    };
    let file = tree.path.join(rel);
    let regular = std::fs::symlink_metadata(&file).is_ok_and(|m| m.is_file());
    let inside = file
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .is_some_and(|p| p.starts_with(&tree.path));
    if !regular || !inside {
        return Err(AppError::Invalid(format!(
            "{rel} is not a file in the worktree."
        )));
    }
    if std::fs::read(&file)? != lines.expect.as_bytes() {
        return Err(AppError::Invalid(format!(
            "{rel} changed. Pick the lines again."
        )));
    }
    // git's own stash messages.
    let branch = tree.branch.as_deref().unwrap_or("(no branch)");
    let short: String = head.chars().take(7).collect();
    let message = message.trim();
    let stash_message = if message.is_empty() {
        format!("WIP on {branch}: {short} {subject}")
    } else {
        format!("On {branch}: {message}")
    };
    let id = new_id("stash");
    let temp = |ext: &str| std::env::temp_dir().join(format!("gitgel-{id}.{ext}"));
    let (blob, rest, index, work, base) = (
        temp("blob"),
        temp("rest"),
        temp("index"),
        temp("work"),
        temp("base"),
    );
    std::fs::write(&blob, lines.content.as_bytes())?;
    std::fs::write(&rest, lines.rest.as_bytes())?;
    let path = |p: &Path| p.to_string_lossy().into_owned();
    let mut env = vec![
        ("GITGEL_FOLDER".to_string(), path(&tree.path)),
        ("GITGEL_PATH".to_string(), lines.path.clone()),
        ("GITGEL_MODE".to_string(), mode),
        ("GITGEL_HEAD".to_string(), head),
        ("GITGEL_INDEX".to_string(), path(&index)),
        ("GITGEL_WORK".to_string(), path(&work)),
        ("GITGEL_BASE".to_string(), path(&base)),
        ("GITGEL_BLOB".to_string(), path(&blob)),
        ("GITGEL_REST".to_string(), path(&rest)),
        ("GITGEL_MESSAGE".to_string(), stash_message),
        (
            "GITGEL_INDEX_MESSAGE".to_string(),
            format!("index on {branch}: {short} {subject}"),
        ),
    ];
    if let Some(oid) = &lines.expect_index {
        env.push(("GITGEL_STAGED".to_string(), oid.clone()));
    }
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}stash-push"),
            name: "Stash changes".into(),
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
            command: stash_lines_command(StashLinesShape {
                staged: lines.expect_index.is_some(),
                on_index,
            }),
            env: with_git_env(env),
            cleanup: vec![blob, rest, index, work, base],
        },
    )
}

/// How the command of a Stash of picked lines is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct StashLinesShape {
    /// The file is in the index (`$GITGEL_STAGED`); else it is left out of the index commit.
    pub staged: bool,
    /// Its staged version differs from HEAD's: the stash is based on a commit of HEAD with that
    /// version (written to `$GITGEL_BASE` first), so the stash holds only the picked changes and
    /// applies where they are staged or committed; else on HEAD, as git's own.
    pub on_index: bool,
}

/// The stash of picked lines (see `stash_lines`): the index commit (HEAD's tree with the file's
/// staged version) and the stash commit (HEAD's tree with the stashed version), then `stash
/// store`, then the rest over the file. Only fixed text and quoted variables; `env` sets the temp
/// indexes the same way in every shell, and nothing touches the working tree before the stash is
/// stored.
pub(super) fn stash_lines_command(shape: StashLinesShape) -> String {
    let git = "git -C \"$GITGEL_FOLDER\"";
    let index = format!("env GIT_INDEX_FILE=\"$GITGEL_INDEX\" {git}");
    let work = format!("env GIT_INDEX_FILE=\"$GITGEL_WORK\" {git}");
    let mut steps = vec![format!("{index} read-tree \"$GITGEL_HEAD\"")];
    steps.push(if shape.staged {
        format!(
            "{index} update-index --add --cacheinfo \"$GITGEL_MODE,$GITGEL_STAGED,$GITGEL_PATH\""
        )
    } else {
        format!("{index} update-index --force-remove -- \"$GITGEL_PATH\"")
    });
    let index_tree = format!("\"$({index} write-tree)\"");
    let base = if shape.on_index {
        steps.push(format!(
            "{git} commit-tree -p \"$GITGEL_HEAD\" -m \"$GITGEL_INDEX_MESSAGE\" {index_tree} > \"$GITGEL_BASE\""
        ));
        "\"$(cat \"$GITGEL_BASE\")\""
    } else {
        "\"$GITGEL_HEAD\""
    };
    let index_commit =
        format!("{git} commit-tree -p {base} -m \"$GITGEL_INDEX_MESSAGE\" {index_tree}");
    let stash_commit = format!(
        "{git} commit-tree -p {base} -p \"$({index_commit})\" -m \"$GITGEL_MESSAGE\" \"$({work} write-tree)\""
    );
    steps.extend([
        format!("{work} read-tree \"$GITGEL_HEAD\""),
        format!("{work} update-index --add --cacheinfo \"$GITGEL_MODE,$({git} hash-object -w --path=\"$GITGEL_PATH\" -- \"$GITGEL_BLOB\"),$GITGEL_PATH\""),
        format!("{git} stash store -m \"$GITGEL_MESSAGE\" \"$({stash_commit})\""),
        "cat \"$GITGEL_REST\" > \"$GITGEL_FOLDER/$GITGEL_PATH\"".to_string(),
    ]);
    steps.join(" && ")
}

/// Add to .gitignore (SPEC §15 "Ignore"): untracked files of one entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreFiles {
    #[serde(flatten)]
    pub entry: EntryRef,
    /// Relative to the worktree.
    pub paths: Vec<String>,
}

/// Appends a line per file (`/<path>`, escaped) to the worktree's top `.gitignore`, a git action
/// as the other writes are; lines already there are not added again.
pub fn ignore(state: &AppState, files: IgnoreFiles) -> Result<ScriptRun, AppError> {
    if files.paths.is_empty() {
        return Err(AppError::Invalid("Nothing to ignore.".into()));
    }
    if files
        .paths
        .iter()
        .any(|p| !valid_relative(p) || p.contains(['\n', '\r']))
    {
        return Err(AppError::Invalid("A picked file has no valid path.".into()));
    }
    let entry = &files.entry;
    let repo = open_repo(state, &entry.repo_id)?;
    repo.not_busy(state)?;
    let tree = repo.tree_of(entry).ok_or_else(|| {
        AppError::Invalid(format!(
            "{} / {} is not checked out.",
            repo.name,
            entry.branch.as_deref().unwrap_or("detached HEAD")
        ))
    })?;
    let existing = std::fs::read_to_string(tree.path.join(".gitignore")).unwrap_or_default();
    let lines = ignore_lines(&existing, &files.paths);
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}ignore"),
            name: "Add to .gitignore".into(),
            icon: ICON.into(),
            entry_key: entry_key(
                &entry.repo_id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: IGNORE_COMMAND.into(),
            env: vec![
                (
                    "GITGEL_FOLDER".into(),
                    tree.path.to_string_lossy().into_owned(),
                ),
                ("GITGEL_LINES".into(), lines),
            ],
            cleanup: Vec::new(),
        },
    )
}

/// What Add to .gitignore appends to `existing`: `/<path>` per new path (anchored, so only that
/// file), on a line of its own.
pub(super) fn ignore_lines(existing: &str, paths: &[String]) -> String {
    let have: Vec<&str> = existing.lines().map(str::trim_end).collect();
    let mut out = String::new();
    for p in paths {
        let line = ignore_pattern(p);
        if !have.contains(&line.as_str()) && !out.lines().any(|l| l == line) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    if !out.is_empty() && !existing.is_empty() && !existing.ends_with('\n') {
        out.insert(0, '\n');
    }
    out
}

/// `/<path>` with gitignore's wildcards and a trailing space escaped, so it names that path alone.
fn ignore_pattern(path: &str) -> String {
    let mut out = String::from("/");
    for c in path.chars() {
        if matches!(c, '\\' | '*' | '?' | '[') {
            out.push('\\');
        }
        out.push(c);
    }
    if out.ends_with(' ') {
        out.insert(out.len() - 1, '\\');
    }
    out
}

/// Only fixed text and quoted variables; reads the same in sh, bash, zsh and fish.
pub(super) const IGNORE_COMMAND: &str =
    r#"printf '%s' "$GITGEL_LINES" >> "$GITGEL_FOLDER/.gitignore""#;

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
    let urls = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        refs::url_tracked(&git)
    };
    let mut specs: Vec<(String, String)> = Vec::new();
    for t in urls {
        let spec = (t.remote.clone(), own_refspec(&t));
        if !specs.contains(&spec) {
            specs.push(spec);
        }
    }
    let env: Vec<(String, String)> = specs
        .into_iter()
        .enumerate()
        .flat_map(|(i, (remote, spec))| {
            let n = i + 1;
            [
                (format!("GITGEL_REMOTE_{n}"), remote),
                (format!("GITGEL_REFSPEC_{n}"), spec),
            ]
        })
        .collect();
    launch_sync(
        state,
        "fetch",
        "Fetch",
        &repo,
        repo.main.clone(),
        repo.name.clone(),
        repo.id.clone(),
        fetch_command(env.len() / 2),
        env,
    )
}

/// What fetches a branch on a URL into the ref Gitgel keeps for it, else its ref on the remote.
fn own_refspec(t: &refs::Tracking) -> String {
    match &t.own_ref {
        Some(own) => format!("+refs/heads/{}:{own}", t.branch),
        None => format!("refs/heads/{}", t.branch),
    }
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
            tracking.name
        )));
    }
    let tree = repo.tree_of(&entry).ok_or_else(|| {
        AppError::Invalid(format!("{} / {branch} is not checked out.", repo.name))
    })?;
    let merge = own_refspec(&tracking);
    let env = vec![
        ("GITGEL_REMOTE".into(), tracking.remote),
        ("GITGEL_MERGE".into(), merge),
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
            tracking.name
        )));
    }
    let tree = repo.tree_of(&entry);
    let new = tracking.tracking.is_none() && !tracking.configured;
    let own = tracking.own_ref.is_some();
    let mut env = vec![
        ("GITGEL_REMOTE".into(), tracking.remote),
        (
            "GITGEL_REFSPEC".into(),
            format!("refs/heads/{branch}:refs/heads/{}", tracking.branch),
        ),
    ];
    if let Some(own) = tracking.own_ref {
        env.push((
            "GITGEL_LEASE".into(),
            format!("refs/heads/{}:{own}", tracking.branch),
        ));
        env.push(("GITGEL_TRACKING".into(), own));
        env.push(("GITGEL_LOCAL".into(), format!("refs/heads/{branch}")));
    }
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
        upload_command(new, force, own),
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

/// Reset to Commit (SPEC §16 "Reset to Commit"): `git reset --soft <sha>` in the entry's worktree,
/// so the commits above `sha` go and their changes stay staged; with `hard`, `git reset --hard`,
/// which drops them and the uncommitted changes too. `tip` is the commit the menu showed as the
/// branch's newest. Refused when HEAD is another commit by then, when `sha` is HEAD or not
/// under it, or mid-operation.
pub fn reset_to(
    state: &AppState,
    entry: EntryRef,
    sha: &str,
    tip: &str,
    hard: bool,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    repo.not_busy(state)?;
    let tree = repo.tree_of(&entry).ok_or_else(|| {
        AppError::Invalid(format!(
            "{} / {} is not checked out.",
            repo.name,
            entry.branch.as_deref().unwrap_or("detached HEAD")
        ))
    })?;
    let full = {
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
            .map_err(|_| AppError::NotFound(format!("commit {sha}")))?
            .id();
        let head = wt
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|_| AppError::Invalid("The branch has no commit.".into()))?
            .id();
        if head.to_string() != tip {
            return Err(AppError::Invalid(
                "The branch has a new commit; reset again.".into(),
            ));
        }
        if head == commit || !wt.graph_descendant_of(head, commit).unwrap_or(false) {
            return Err(AppError::Invalid(
                "The branch has no commits above this one.".into(),
            ));
        }
        commit.to_string()
    };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}reset"),
            name: format!("Reset to {}", &full[..7]),
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
            command: reset_command(hard),
            env: with_git_env(vec![("GITGEL_COMMIT".into(), full)]),
            cleanup: Vec::new(),
        },
    )
}

/// `git reset -q --soft "$GITGEL_COMMIT"` (`--hard`): only fixed text and a quoted variable.
pub(super) fn reset_command(hard: bool) -> String {
    let mode = if hard { "--hard" } else { "--soft" };
    format!("git reset -q {mode} \"$GITGEL_COMMIT\"")
}

/// Revert Changes (SPEC §16): `git revert --no-edit <sha>` (`-m 1` for a merge commit) in
/// the entry's worktree, a new commit that undoes it. Refused mid-operation or for a commit the
/// branch does not have; a conflict stops git there, and the revert then shows on the entry (§15).
pub fn revert(state: &AppState, entry: EntryRef, sha: &str) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    repo.not_busy(state)?;
    let tree = repo.tree_of(&entry).ok_or_else(|| {
        AppError::Invalid(format!(
            "{} / {} is not checked out.",
            repo.name,
            entry.branch.as_deref().unwrap_or("detached HEAD")
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
        let head = wt
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|_| AppError::Invalid("The branch has no commit.".into()))?
            .id();
        if head != commit.id() && !wt.graph_descendant_of(head, commit.id()).unwrap_or(false) {
            return Err(AppError::Invalid(
                "The branch no longer has this commit.".into(),
            ));
        }
        (commit.parent_count() > 1, commit.id().to_string())
    };
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}revert"),
            name: format!("Revert {}", &full[..7]),
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
            command: revert_command(merge),
            env: with_git_env(vec![("GITGEL_COMMIT".into(), full)]),
            cleanup: Vec::new(),
        },
    )
}

/// `git revert --no-edit [-m 1] "$GITGEL_COMMIT"`: only fixed text and a quoted variable.
pub(super) fn revert_command(merge: bool) -> String {
    let mainline = if merge { " -m 1" } else { "" };
    format!("git revert --no-edit{mainline} \"$GITGEL_COMMIT\"")
}

/// Create Tag's checks (SPEC §16 "Create Tag"). Read only: the name is one git takes for a tag (and
/// not an option) and no tag has it.
pub(super) fn new_tag_problem(git: &git2::Repository, name: &str) -> Option<NewTagProblem> {
    let full = format!("refs/tags/{name}");
    if name.starts_with('-') || name == "HEAD" || !git2::Reference::is_valid_name(&full) {
        return Some(NewTagProblem::BadName);
    }
    git.find_reference(&full)
        .is_ok()
        .then_some(NewTagProblem::Exists)
}

/// Create Tag's checks for the dialog, as it is filled in, and again before the run. Read only.
pub fn check_new_tag(
    state: &AppState,
    repo_id: &str,
    name: &str,
) -> Result<Option<NewTagProblem>, AppError> {
    let repo = open_repo(state, repo_id)?;
    let shared = state.pool.get(&repo.path)?;
    let git = lock(&shared);
    Ok(new_tag_problem(&git, name))
}

/// Create Tag (SPEC §16 "Create Tag"): the tag `name` on the commit `sha`, annotated with
/// `message` when there is one, lightweight otherwise; with `push`, then on the remote too (as
/// Push Tag). Runs in the repository folder; the branch need not be checked out. `entry` only says
/// whose run it is.
pub fn create_tag(
    state: &AppState,
    entry: EntryRef,
    sha: &str,
    name: &str,
    message: &str,
    push: bool,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    repo.not_busy(state)?;
    let (full, on) = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        if let Some(problem) = new_tag_problem(&git, name) {
            return Err(AppError::Invalid(match problem {
                NewTagProblem::BadName => format!("{name} is not a valid tag name."),
                NewTagProblem::Exists => format!("{name} already exists."),
            }));
        }
        let commit = git2::Oid::from_str(sha)
            .and_then(|oid| git.find_commit(oid))
            .map_err(|_| AppError::NotFound(format!("commit {sha}")))?;
        let on = if push {
            Some(
                refs::default_remote(&git)
                    .ok_or_else(|| AppError::Invalid(format!("{} has no remote.", repo.name)))?,
            )
        } else {
            None
        };
        (commit.id().to_string(), on)
    };
    let message = message.trim();
    let mut env = vec![
        ("GITGEL_TAG".to_string(), name.to_string()),
        ("GITGEL_COMMIT".to_string(), full.clone()),
    ];
    if !message.is_empty() {
        env.push(("GITGEL_MESSAGE".into(), message.to_string()));
    }
    if let Some(on) = &on {
        env.push(("GITGEL_REMOTE".into(), on.clone()));
        env.push(("GITGEL_REMOTE_REF".into(), format!("refs/tags/{name}")));
    }
    let command = create_tag_command(!message.is_empty(), on.is_some());
    let label = entry
        .branch
        .clone()
        .unwrap_or_else(|| full.chars().take(7).collect());
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}create-tag"),
            name: format!("Create Tag {name}"),
            icon: "tag".into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
            repo_label: format!("{} / {label}", repo.name),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: repo.main.clone(),
            command: if on.is_some() {
                format!("{LOAD_KEYS}{command}")
            } else {
                command
            },
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// `git tag [-a -m "$GITGEL_MESSAGE"] "$GITGEL_TAG" "$GITGEL_COMMIT"`, with `push` then Push
/// Tag's command (a failed push keeps the tag): only fixed text and quoted variables.
pub(super) fn create_tag_command(annotated: bool, push: bool) -> String {
    let message = if annotated {
        r#" -a -m "$GITGEL_MESSAGE""#
    } else {
        ""
    };
    let push = if push {
        format!(" && {PUSH_TAG_COMMAND}")
    } else {
        String::new()
    };
    format!(r#"git tag{message} "$GITGEL_TAG" "$GITGEL_COMMIT"{push}"#)
}

/// Push Tag's command: the tag (`refs/tags/<name>`) to the remote, values from the environment.
pub(super) const PUSH_TAG_COMMAND: &str = r#"git push "$GITGEL_REMOTE" "$GITGEL_REMOTE_REF""#;

/// Push Tag (SPEC §16 "Push Tag"): the tag `name` to the repository's remote (`origin`, else the
/// only one), from the repository folder. A tag the remote has on the same commit ends "up to
/// date"; the remote's own tag of that name on another commit refuses it (no force). `entry`
/// only says whose run it is. Refused when the tag is gone already or there is no remote.
pub fn push_tag(state: &AppState, entry: EntryRef, name: &str) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    repo.not_busy(state)?;
    let full = format!("refs/tags/{name}");
    let on = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        if name.starts_with('-') || git.find_reference(&full).is_err() {
            drop(git);
            scan::rescan_repo(state, &repo.id, UpdateReason::Rescan, None);
            return Err(AppError::Invalid(format!("{name} is not a tag.")));
        }
        refs::default_remote(&git)
            .ok_or_else(|| AppError::Invalid(format!("{} has no remote.", repo.name)))?
    };
    let env = vec![
        ("GITGEL_REMOTE".to_string(), on),
        ("GITGEL_REMOTE_REF".to_string(), full),
    ];
    let label = entry
        .branch
        .clone()
        .unwrap_or_else(|| entry.worktree_path.clone().unwrap_or_default());
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}push-tag"),
            name: format!("Push Tag {name}"),
            icon: "arrow-up".into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
            repo_label: format!("{} / {label}", repo.name),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: repo.main.clone(),
            command: format!("{LOAD_KEYS}{PUSH_TAG_COMMAND}"),
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// Delete Tag's remote (SPEC §16 "Delete Tag"): where its "Also delete from" option deletes the
/// tag, `origin` or the only remote; none, no option. Read only.
pub fn tag_remote(state: &AppState, repo_id: &str) -> Result<Option<String>, AppError> {
    let repo = open_repo(state, repo_id)?;
    let shared = state.pool.get(&repo.path)?;
    let git = lock(&shared);
    Ok(refs::default_remote(&git))
}

/// Delete Tag (SPEC §16 "Delete Tag"): `git tag -d <name>` in the repository folder; with
/// `remote`, the tag on the remote first, when the remote has it. `entry` only says whose run it
/// is. Refused when the tag is gone already.
pub fn delete_tag(
    state: &AppState,
    entry: EntryRef,
    name: &str,
    remote: bool,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, &entry.repo_id)?;
    repo.not_busy(state)?;
    let full = format!("refs/tags/{name}");
    let on = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        if name.starts_with('-') || git.find_reference(&full).is_err() {
            drop(git);
            scan::rescan_repo(state, &repo.id, UpdateReason::Rescan, None);
            return Err(AppError::Invalid(format!("{name} is not a tag.")));
        }
        if remote {
            Some(
                refs::default_remote(&git)
                    .ok_or_else(|| AppError::Invalid(format!("{} has no remote.", repo.name)))?,
            )
        } else {
            None
        }
    };
    let mut env = vec![("GITGEL_TAG".to_string(), name.to_string())];
    if let Some(on) = &on {
        env.push(("GITGEL_REMOTE".into(), on.clone()));
        env.push(("GITGEL_REMOTE_REF".into(), full));
    }
    let label = entry
        .branch
        .clone()
        .unwrap_or_else(|| entry.worktree_path.clone().unwrap_or_default());
    let command = delete_tag_command(on.is_some());
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}delete-tag"),
            name: format!("Delete Tag {name}"),
            icon: "trash".into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
            repo_label: format!("{} / {label}", repo.name),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: repo.main.clone(),
            command: if on.is_some() {
                format!("{LOAD_KEYS}{command}")
            } else {
                command
            },
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// `git tag -d "$GITGEL_TAG"`; with `remote`, first `git push "$GITGEL_REMOTE" --delete
/// "$GITGEL_REMOTE_REF"` when `git ls-remote --exit-code` finds the tag there (status 2: the
/// remote does not have it, which is fine; any other failure stops the run and keeps the tag).
/// The remote form is one `/bin/sh -c '…'`, so the user's shell only reads a quoted string: only
/// fixed text, the values come from the environment.
pub(super) fn delete_tag_command(remote: bool) -> String {
    let local = r#"git tag -d "$GITGEL_TAG""#;
    if !remote {
        return local.into();
    }
    format!(
        r#"/bin/sh -c 'git ls-remote --exit-code "$GITGEL_REMOTE" "$GITGEL_REMOTE_REF" >/dev/null; s=$?; if [ $s -eq 0 ]; then git push "$GITGEL_REMOTE" --delete "$GITGEL_REMOTE_REF" || exit $?; elif [ $s -ne 2 ]; then exit $s; fi; {local}'"#
    )
}

/// Squash (SPEC §16, Hi13): consecutive commits of the entry's branch (`shas`, newest first, each
/// the first parent of the one before) become one commit with `summary` and `description`, the
/// oldest one's author and the newest one's tree, on the oldest one's parent (`git commit-tree`).
/// The branch then points at it (`git reset --soft`, so the index and the working tree stay), or,
/// with newer commits above, those are rebased onto it (`--autostash`, merges kept). Refused
/// mid-operation, for the branch's first commit, or once the branch no longer holds the commits.
pub fn squash(
    state: &AppState,
    entry: EntryRef,
    shas: Vec<String>,
    summary: String,
    description: String,
) -> Result<ScriptRun, AppError> {
    if shas.len() < 2 {
        return Err(AppError::Invalid("Pick at least two commits.".into()));
    }
    rewrite(state, entry, shas, summary, description, false)
}

/// Reword (SPEC §16 "Reword"): a commit of the entry's branch gets a new message, as a squash of
/// that one commit: the same tree, parent and author, the commits above it rebased onto it.
/// Refused for a merge commit or the branch's first commit, and as Squash.
pub fn reword(
    state: &AppState,
    entry: EntryRef,
    sha: String,
    summary: String,
    description: String,
) -> Result<ScriptRun, AppError> {
    rewrite(state, entry, vec![sha], summary, description, true)
}

/// Squash and Reword's run: `shas` (newest first) become one commit with the message.
fn rewrite(
    state: &AppState,
    entry: EntryRef,
    shas: Vec<String>,
    summary: String,
    description: String,
    reword: bool,
) -> Result<ScriptRun, AppError> {
    let summary = summary.trim().to_string();
    let body = description.trim().to_string();
    if summary.is_empty() {
        return Err(AppError::Invalid("Write a summary.".into()));
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
    let (mut env, rebase) = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        if operation::read(&wt).is_some() || !operation::unmerged(&wt)?.is_empty() {
            return Err(AppError::Invalid(format!(
                "{} has an operation in progress.",
                repo.label(tree)
            )));
        }
        let find = |sha: &str| {
            git2::Oid::from_str(sha)
                .and_then(|oid| wt.find_commit(oid))
                .map_err(|_| AppError::NotFound(format!("commit {sha}")))
        };
        let newest = find(&shas[0])?;
        // The new commit has one parent: a reworded merge would lose its other one.
        if reword && newest.parent_count() != 1 {
            return Err(AppError::Invalid(
                "Only a commit with one parent can be reworded.".into(),
            ));
        }
        let mut oldest = newest.clone();
        for sha in &shas[1..] {
            if oldest.parent_id(0).ok().map(|p| p.to_string()).as_deref() != Some(sha.as_str()) {
                return Err(AppError::Invalid(
                    "Only consecutive commits can be squashed.".into(),
                ));
            }
            oldest = find(sha)?;
        }
        let parent = oldest.parent_id(0).map_err(|_| {
            AppError::Invalid("The branch's first commit cannot be squashed.".into())
        })?;
        let head = wt
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|_| AppError::Invalid("The branch has no commit.".into()))?
            .id();
        if head != newest.id() && !wt.graph_descendant_of(head, newest.id()).unwrap_or(false) {
            return Err(AppError::Invalid(
                "The branch no longer has these commits; pick them again.".into(),
            ));
        }
        let author = oldest.author();
        let when = author.when();
        let offset = when.offset_minutes();
        let env = vec![
            ("GITGEL_TREE".to_string(), newest.tree_id().to_string()),
            ("GITGEL_PARENT".to_string(), parent.to_string()),
            ("GITGEL_NEWEST".to_string(), newest.id().to_string()),
            (
                "GITGEL_AUTHOR_NAME".to_string(),
                String::from_utf8_lossy(author.name_bytes()).into_owned(),
            ),
            (
                "GITGEL_AUTHOR_EMAIL".to_string(),
                String::from_utf8_lossy(author.email_bytes()).into_owned(),
            ),
            (
                "GITGEL_AUTHOR_DATE".to_string(),
                format!(
                    "@{} {}{:02}{:02}",
                    when.seconds(),
                    if offset < 0 { '-' } else { '+' },
                    offset.abs() / 60,
                    offset.abs() % 60
                ),
            ),
        ];
        (env, head != newest.id())
    };
    env.push(("GITGEL_SUMMARY".into(), summary));
    if !body.is_empty() {
        env.push(("GITGEL_BODY".into(), body.clone()));
    }
    run::launch(
        state,
        Launch {
            script_id: format!(
                "{ACTION_PREFIX}{}",
                if reword { "reword" } else { "squash" }
            ),
            name: if reword {
                format!("Reword {}", shas[0].chars().take(7).collect::<String>())
            } else {
                format!("Squash {} Commits", shas.len())
            },
            icon: if reword { "pencil" } else { "rebase" }.into(),
            entry_key: entry_key(
                &repo.id,
                entry.branch.as_deref(),
                Some(&tree.path.to_string_lossy()),
            ),
            repo_label: repo.label(tree),
            repo_id: repo.id.clone(),
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: squash_command(!body.is_empty(), rebase),
            env: with_git_env(env),
            cleanup: Vec::new(),
        },
    )
}

/// Reorder (SPEC §16 "Reorder"): the branch's newest commits in a new order. `order` (newest
/// first) must hold exactly the commits from HEAD down its first parents, each with one parent;
/// they are picked again in that order on the oldest one's parent (`git rebase -i`, its todo
/// written from `$GITGEL_TODO`). Refused mid-operation, for a merge or the branch's first
/// commit among them, or once HEAD's commits are no longer those.
pub fn reorder(
    state: &AppState,
    entry: EntryRef,
    order: Vec<String>,
) -> Result<ScriptRun, AppError> {
    if order.len() < 2 {
        return Err(AppError::Invalid("Pick at least two commits.".into()));
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
    let (parent, todo) = {
        let shared = state.pool.get(&tree.path)?;
        let wt = lock(&shared);
        if operation::read(&wt).is_some() || !operation::unmerged(&wt)?.is_empty() {
            return Err(AppError::Invalid(format!(
                "{} has an operation in progress.",
                repo.label(tree)
            )));
        }
        let mut at = wt
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|_| AppError::Invalid("The branch has no commit.".into()))?;
        let mut chain = Vec::with_capacity(order.len());
        let parent = loop {
            if at.parent_count() != 1 {
                return Err(AppError::Invalid(
                    "A merge commit or the branch's first commit cannot be moved.".into(),
                ));
            }
            chain.push(at.id().to_string());
            let parent = at.parent(0)?;
            if chain.len() == order.len() {
                break parent.id().to_string();
            }
            at = parent;
        };
        reorder_todo(&chain, &order).map(|todo| (parent, todo))
    }
    .ok_or_else(|| {
        AppError::Invalid("The branch no longer has these commits; move it again.".into())
    })?;
    run::launch(
        state,
        Launch {
            script_id: format!("{ACTION_PREFIX}reorder"),
            name: "Reorder Commits".into(),
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
            command: REORDER_COMMAND.into(),
            env: with_git_env(vec![
                ("GITGEL_PARENT".into(), parent),
                ("GITGEL_TODO".into(), todo),
                ("GIT_SEQUENCE_EDITOR".into(), REORDER_EDITOR.into()),
            ]),
            cleanup: Vec::new(),
        },
    )
}

/// Reorder's todo, oldest first: one `pick` per commit of `order` (newest first), which must be
/// `chain` (HEAD's commits, newest first) in another order; `None` otherwise.
pub(super) fn reorder_todo(chain: &[String], order: &[String]) -> Option<String> {
    let mut a: Vec<&String> = chain.iter().collect();
    let mut b: Vec<&String> = order.iter().collect();
    a.sort();
    b.sort();
    a.dedup();
    if a != b || a.len() != chain.len() || chain == order {
        return None;
    }
    Some(
        order
            .iter()
            .rev()
            .map(|sha| format!("pick {sha}"))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

/// Reorder's command: only fixed text and a quoted variable; the todo comes from the editor.
pub(super) const REORDER_COMMAND: &str = "git rebase -q -i --autostash \"$GITGEL_PARENT\"";
/// Reorder's `GIT_SEQUENCE_EDITOR`: git runs it with the todo file as its argument, and it
/// writes `$GITGEL_TODO` there. Fixed text.
pub(super) const REORDER_EDITOR: &str = r#"/bin/sh -c 'printf "%s\n" "$GITGEL_TODO" > "$1"' --"#;

/// Squash's command: the new commit made by `git commit-tree` (with the oldest commit's author)
/// goes into `git reset --soft`, or into `git rebase --onto` when newer commits sit above the
/// squashed ones. Only fixed text and quoted variables.
pub(super) fn squash_command(body: bool, rebase: bool) -> String {
    let mut make = String::from(
        "GIT_AUTHOR_NAME=\"$GITGEL_AUTHOR_NAME\" GIT_AUTHOR_EMAIL=\"$GITGEL_AUTHOR_EMAIL\" GIT_AUTHOR_DATE=\"$GITGEL_AUTHOR_DATE\" git commit-tree \"$GITGEL_TREE\" -p \"$GITGEL_PARENT\" -m \"$GITGEL_SUMMARY\"",
    );
    if body {
        make.push_str(" -m \"$GITGEL_BODY\"");
    }
    if rebase {
        format!("git rebase -q --autostash --rebase-merges --onto \"$({make})\" \"$GITGEL_NEWEST\"")
    } else {
        format!("git reset -q --soft \"$({make})\"")
    }
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
    let own = tracking.as_ref().and_then(|t| t.own_ref.clone());
    if let Some(own) = &own {
        env.push(("GITGEL_TRACKING".into(), own.clone()));
    }
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
    let command = delete_branch_command(remote, checked_out, stash, own.is_some());
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
pub(super) fn delete_branch_command(
    remote: bool,
    checked_out: CheckedOut,
    stash: bool,
    own: bool,
) -> String {
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
    // The ref Gitgel kept for a branch on a URL goes with it.
    if own {
        steps.push("git update-ref -d \"$GITGEL_TRACKING\"".to_string());
    }
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
/// branch (`origin/feat`) as a new local branch (`feat`) tracking it. Checkout Commit: a commit,
/// as a detached HEAD.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CheckoutSource {
    /// The local branch; a commit's short SHA.
    local: String,
    /// The remote-tracking ref it starts from (`refs/remotes/origin/feat`), for a remote branch.
    start: Option<String>,
    tip: git2::Oid,
    /// A commit: HEAD is detached at `tip`.
    detach: bool,
}

/// What a checkout was asked for.
#[derive(Debug, Clone, Copy)]
enum CheckoutOf<'a> {
    Branch { branch: &'a str, remote: bool },
    Commit(&'a str),
}

impl CheckoutOf<'_> {
    /// The name the refusals use: the branch, or the commit's short SHA.
    fn name(&self) -> String {
        match self {
            CheckoutOf::Branch { branch, .. } => branch.to_string(),
            CheckoutOf::Commit(sha) => sha.chars().take(7).collect(),
        }
    }
}

/// Checkout Commit's source: a commit the repository has, by its full SHA.
fn commit_source(git: &git2::Repository, sha: &str) -> Result<CheckoutSource, CheckoutProblem> {
    let tip = git2::Oid::from_str(sha)
        .ok()
        .filter(|oid| sha.len() == 40 && git.find_commit(*oid).is_ok())
        .ok_or(CheckoutProblem::Unavailable)?;
    Ok(CheckoutSource {
        local: sha[..7].to_string(),
        start: None,
        tip,
        detach: true,
    })
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
            detach: false,
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
        detach: false,
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
    of: CheckoutOf<'_>,
    target: &CheckoutTarget,
) -> Result<Result<CheckoutPlan, CheckoutProblem>, AppError> {
    let source = {
        let shared = state.pool.get(&repo.path)?;
        let git = lock(&shared);
        let source = match of {
            CheckoutOf::Branch { branch, remote } => {
                checkout_source(&git, &repo.trees, branch, remote)
            }
            CheckoutOf::Commit(sha) => commit_source(&git, sha),
        };
        match source {
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
    Ok(plan_checkout(state, &repo, CheckoutOf::Branch { branch, remote }, target)?.err())
}

/// Checkout Commit's checks for the dialog (SPEC §16 "Checkout Commit"), as Checkout Branch's.
pub fn check_checkout_commit(
    state: &AppState,
    repo_id: &str,
    sha: &str,
    target: &CheckoutTarget,
) -> Result<Option<CheckoutProblem>, AppError> {
    let repo = open_repo(state, repo_id)?;
    Ok(plan_checkout(state, &repo, CheckoutOf::Commit(sha), target)?.err())
}

/// How Checkout Branch runs (SPEC §15 "Checkout branch").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CheckoutRun {
    /// The worktree in `$GITGEL_FOLDER` switches to the branch; `stash` its uncommitted changes
    /// first, else they come along.
    Switch { stash: bool, track: bool },
    /// A new linked worktree in `$GITGEL_FOLDER`.
    Worktree { track: bool },
    /// The worktree in `$GITGEL_FOLDER` detaches its HEAD at `$GITGEL_COMMIT`; `stash` as Switch.
    Detach { stash: bool },
    /// A new linked worktree in `$GITGEL_FOLDER`, its HEAD detached at `$GITGEL_COMMIT`.
    DetachWorktree,
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
    checkout(
        state,
        repo_id,
        CheckoutOf::Branch { branch, remote },
        target,
    )
}

/// Checkout Commit (SPEC §16 "Checkout Commit"): a commit as a detached HEAD, in one of the repo's
/// worktrees (which switches to it, its uncommitted changes brought along or stashed first) or in
/// a new linked worktree. Runs in the repository folder.
pub fn checkout_commit(
    state: &AppState,
    repo_id: &str,
    sha: &str,
    target: CheckoutTarget,
) -> Result<ScriptRun, AppError> {
    checkout(state, repo_id, CheckoutOf::Commit(sha), target)
}

fn checkout(
    state: &AppState,
    repo_id: &str,
    of: CheckoutOf<'_>,
    target: CheckoutTarget,
) -> Result<ScriptRun, AppError> {
    let repo = open_repo(state, repo_id)?;
    repo.not_busy(state)?;
    let branch = of.name();
    let plan = match plan_checkout(state, &repo, of, &target)? {
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
    let detach = source.detach;
    let mut env = vec![("GITGEL_FOLDER".to_string(), folder.clone())];
    if detach {
        env.push(("GITGEL_COMMIT".into(), source.tip.to_string()));
    } else {
        env.push(("GITGEL_BRANCH".into(), local.clone()));
    }
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
            if detach {
                CheckoutRun::Detach { stash: !bring }
            } else {
                CheckoutRun::Switch {
                    stash: !bring,
                    track,
                }
            }
        }
        None if detach => CheckoutRun::DetachWorktree,
        None => CheckoutRun::Worktree { track },
    };
    run::launch(
        state,
        Launch {
            script_id: format!(
                "{ACTION_PREFIX}{}",
                if detach {
                    "checkout-commit"
                } else {
                    "checkout-branch"
                }
            ),
            name: format!("Checkout {local}"),
            icon: "branch".into(),
            entry_key: entry_key(&repo.id, (!detach).then_some(local.as_str()), Some(&folder)),
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
/// `$GITGEL_START`); a commit detaches HEAD (`switch --detach`, `worktree add --detach`): only
/// fixed text and quoted variables.
pub(super) fn checkout_command(run: CheckoutRun) -> String {
    let git = r#"git -C "$GITGEL_FOLDER""#;
    match run {
        CheckoutRun::Detach { stash } => {
            let switch = format!(r#"{git} switch --detach "$GITGEL_COMMIT""#);
            if stash {
                format!(
                    r#"{git} stash push --include-untracked --message "$GITGEL_MESSAGE" && {switch}"#
                )
            } else {
                switch
            }
        }
        CheckoutRun::DetachWorktree => {
            r#"git worktree add --detach "$GITGEL_FOLDER" "$GITGEL_COMMIT""#.into()
        }
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

/// `own`: the remote is a URL, so the push itself moves the ref Gitgel keeps for the branch
/// (`refs::Tracking::own_ref`), and a forced one names it as what the remote must still have.
pub(super) fn upload_command(set_upstream: bool, force: bool, own: bool) -> String {
    let upstream = if set_upstream { " --set-upstream" } else { "" };
    let force = match (force, own) {
        (false, _) => "",
        (true, false) => " --force-with-lease",
        (true, true) => " --force-with-lease=\"$GITGEL_LEASE\"",
    };
    let track = if own {
        " && git update-ref \"$GITGEL_TRACKING\" \"$GITGEL_LOCAL\""
    } else {
        ""
    };
    format!("git push{upstream}{force} \"$GITGEL_REMOTE\" \"$GITGEL_REFSPEC\"{track}")
}

/// `git fetch --all --prune`, then one fetch per branch on a URL (`refs::url_tracked`).
pub(super) fn fetch_command(urls: usize) -> String {
    let mut command = String::from("git fetch --all --prune");
    for n in 1..=urls {
        command.push_str(&format!(
            " && git fetch \"$GITGEL_REMOTE_{n}\" \"$GITGEL_REFSPEC_{n}\""
        ));
    }
    command
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

/// `git -C "$GITGEL_FOLDER" commit [--amend] [--no-verify] -m "$GITGEL_SUMMARY" [-m
/// "$GITGEL_BODY"]`: what is staged; only fixed text and quoted variables.
pub(super) fn commit_command(shape: CommitShape) -> String {
    let git = "git -C \"$GITGEL_FOLDER\"";
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
    commit
}

/// `git -C "$GITGEL_FOLDER" add -A -- "$GITGEL_STAGE_1" … && git … restore --staged --
/// "$GITGEL_UNSTAGE_1" …` (`rm --cached -q --` before the first commit), run once more after a
/// short wait if it fails (another git process held `index.lock`): only fixed text and quoted
/// variables.
pub(super) fn stage_command(shape: StageShape) -> String {
    let git = "git -C \"$GITGEL_FOLDER\"";
    let list = |name: &str, count: usize| {
        (1..=count)
            .map(|j| format!(" \"${name}_{j}\""))
            .collect::<String>()
    };
    let mut steps = Vec::new();
    if shape.stage > 0 {
        steps.push(format!(
            "{git} add -A --{}",
            list("GITGEL_STAGE", shape.stage)
        ));
    }
    if shape.unstage > 0 {
        let out = if shape.unborn {
            "rm --cached -q"
        } else {
            "restore --staged"
        };
        steps.push(format!(
            "{git} {out} --{}",
            list("GITGEL_UNSTAGE", shape.unstage)
        ));
    }
    let once = steps.join(" && ");
    format!("{{ {once}; }} || {{ sleep 0.5 && {once}; }}")
}

/// `git -C "$GITGEL_FOLDER" update-index --add --cacheinfo "$GITGEL_MODE,$(git -C
/// "$GITGEL_FOLDER" hash-object -w --path="$GITGEL_PATH" -- "$GITGEL_BLOB"),$GITGEL_PATH"`: the
/// blob is cleaned as `git add` would for that path (`--path`), run once more after a short wait
/// if it fails (`index.lock`); only fixed text and quoted variables.
pub(super) fn stage_lines_command() -> String {
    let git = "git -C \"$GITGEL_FOLDER\"";
    let once = format!(
        "{git} update-index --add --cacheinfo \"$GITGEL_MODE,$({git} hash-object -w --path=\"$GITGEL_PATH\" -- \"$GITGEL_BLOB\"),$GITGEL_PATH\""
    );
    format!("{{ {once}; }} || {{ sleep 0.5 && {once}; }}")
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
/// git -C "$GITGEL_FOLDER_1" restore --worktree -- "$GITGEL_KEEP_1_1" … && git -C "$GITGEL_FOLDER_1" clean -f -q -- "$GITGEL_CLEAN_1_1" … && git -C "$GITGEL_FOLDER_2" …`:
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
            if step.keep > 0 {
                parts.push(format!(
                    "{git} restore --worktree --{}",
                    list("GITGEL_KEEP", step.keep)
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
    fn create_tag_commands_hold_no_values() {
        assert_eq!(
            create_tag_command(false, false),
            r#"git tag "$GITGEL_TAG" "$GITGEL_COMMIT""#
        );
        assert_eq!(
            create_tag_command(true, false),
            r#"git tag -a -m "$GITGEL_MESSAGE" "$GITGEL_TAG" "$GITGEL_COMMIT""#
        );
        assert_eq!(
            create_tag_command(false, true),
            r#"git tag "$GITGEL_TAG" "$GITGEL_COMMIT" && git push "$GITGEL_REMOTE" "$GITGEL_REMOTE_REF""#
        );
    }

    #[test]
    fn push_tag_command_holds_no_values() {
        assert_eq!(
            PUSH_TAG_COMMAND,
            r#"git push "$GITGEL_REMOTE" "$GITGEL_REMOTE_REF""#
        );
    }

    #[test]
    fn new_tag_problem_checks_the_name() {
        let t = crate::git::testutil::TestRepo::new();
        let tip = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.tag("v1.0", tip);
        let p = |name: &str| new_tag_problem(&t.repo, name);
        assert_eq!(p("v1.1"), None);
        assert_eq!(p("release/2026"), None);
        for bad in ["", "-x", "HEAD", "a..b", "a b", "x.lock", "a/"] {
            assert_eq!(p(bad), Some(NewTagProblem::BadName), "{bad:?}");
        }
        assert_eq!(p("v1.0"), Some(NewTagProblem::Exists));
    }

    #[test]
    fn delete_tag_commands_hold_no_values() {
        assert_eq!(delete_tag_command(false), r#"git tag -d "$GITGEL_TAG""#);
        let remote = delete_tag_command(true);
        assert!(
            remote.starts_with("/bin/sh -c '") && remote.ends_with(r#"git tag -d "$GITGEL_TAG"'"#)
        );
        assert!(remote.contains(r#"git push "$GITGEL_REMOTE" --delete "$GITGEL_REMOTE_REF""#));
        // One quoted string for the user's shell: no quote of its own inside.
        assert_eq!(remote.matches('\'').count(), 2);
    }

    #[test]
    fn reorder_todo_picks_oldest_first() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let chain = s(&["c", "b", "a"]);
        assert_eq!(
            reorder_todo(&chain, &s(&["b", "c", "a"])).as_deref(),
            Some("pick a\npick c\npick b")
        );
        // The same order, other commits, a commit twice or one missing: nothing to run.
        for bad in [
            s(&["c", "b", "a"]),
            s(&["c", "b", "x"]),
            s(&["b", "b", "a"]),
            s(&["b", "c"]),
        ] {
            assert_eq!(reorder_todo(&chain, &bad), None, "{bad:?}");
        }
    }

    #[test]
    fn reset_commands_hold_no_values() {
        assert_eq!(
            reset_command(false),
            r#"git reset -q --soft "$GITGEL_COMMIT""#
        );
        assert_eq!(
            reset_command(true),
            r#"git reset -q --hard "$GITGEL_COMMIT""#
        );
    }

    #[test]
    fn revert_commands_hold_no_values() {
        assert_eq!(
            revert_command(false),
            r#"git revert --no-edit "$GITGEL_COMMIT""#
        );
        assert_eq!(
            revert_command(true),
            r#"git revert --no-edit -m 1 "$GITGEL_COMMIT""#
        );
    }

    #[test]
    fn squash_commands_hold_no_values() {
        let make = r#"GIT_AUTHOR_NAME="$GITGEL_AUTHOR_NAME" GIT_AUTHOR_EMAIL="$GITGEL_AUTHOR_EMAIL" GIT_AUTHOR_DATE="$GITGEL_AUTHOR_DATE" git commit-tree "$GITGEL_TREE" -p "$GITGEL_PARENT" -m "$GITGEL_SUMMARY""#;
        assert_eq!(
            squash_command(false, false),
            format!(r#"git reset -q --soft "$({make})""#)
        );
        assert_eq!(
            squash_command(true, true),
            format!(
                r#"git rebase -q --autostash --rebase-merges --onto "$({make} -m "$GITGEL_BODY")" "$GITGEL_NEWEST""#
            )
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
        assert_eq!(
            checkout_command(CheckoutRun::Detach { stash: false }),
            r#"git -C "$GITGEL_FOLDER" switch --detach "$GITGEL_COMMIT""#
        );
        assert_eq!(
            checkout_command(CheckoutRun::Detach { stash: true }),
            r#"git -C "$GITGEL_FOLDER" stash push --include-untracked --message "$GITGEL_MESSAGE" && git -C "$GITGEL_FOLDER" switch --detach "$GITGEL_COMMIT""#
        );
        assert_eq!(
            checkout_command(CheckoutRun::DetachWorktree),
            r#"git worktree add --detach "$GITGEL_FOLDER" "$GITGEL_COMMIT""#
        );
    }

    #[test]
    fn commit_source_takes_full_shas_of_commits() {
        let t = crate::git::testutil::TestRepo::new();
        let tip = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        let sha = tip.to_string();
        let source = commit_source(&t.repo, &sha).unwrap();
        assert_eq!(
            (source.local.as_str(), source.tip, source.detach),
            (&sha[..7], tip, true)
        );
        for bad in [
            "main",
            &sha[..7],
            "-x",
            "0000000000000000000000000000000000000000",
        ] {
            assert_eq!(
                commit_source(&t.repo, bad),
                Err(CheckoutProblem::Unavailable),
                "{bad}"
            );
        }
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
            delete_branch_command(false, CheckedOut::No, true, false),
            r#"git branch -D "$GITGEL_BRANCH""#
        );
        assert_eq!(
            delete_branch_command(true, CheckedOut::No, true, false),
            r#"git push "$GITGEL_REMOTE" --delete "$GITGEL_REMOTE_REF" && git branch -D "$GITGEL_BRANCH""#
        );
        assert_eq!(
            delete_branch_command(false, CheckedOut::Main, true, false),
            r#"git -C "$GITGEL_FOLDER" stash push --include-untracked --message "$GITGEL_MESSAGE" && git -C "$GITGEL_FOLDER" switch -q "$GITGEL_BASE" && git branch -D "$GITGEL_BRANCH""#
        );
        assert_eq!(
            delete_branch_command(false, CheckedOut::Main, false, false),
            r#"git -C "$GITGEL_FOLDER" reset -q --hard && git -C "$GITGEL_FOLDER" clean -fdq && git -C "$GITGEL_FOLDER" switch -q "$GITGEL_BASE" && git branch -D "$GITGEL_BRANCH""#
        );
        assert_eq!(
            delete_branch_command(true, CheckedOut::Linked, false, false),
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
            upload_command(false, false, false),
            r#"git push "$GITGEL_REMOTE" "$GITGEL_REFSPEC""#
        );
        assert_eq!(
            upload_command(true, false, false),
            r#"git push --set-upstream "$GITGEL_REMOTE" "$GITGEL_REFSPEC""#
        );
        assert_eq!(
            upload_command(false, true, false),
            r#"git push --force-with-lease "$GITGEL_REMOTE" "$GITGEL_REFSPEC""#
        );
        assert_eq!(
            upload_command(false, true, true),
            r#"git push --force-with-lease="$GITGEL_LEASE" "$GITGEL_REMOTE" "$GITGEL_REFSPEC" && git update-ref "$GITGEL_TRACKING" "$GITGEL_LOCAL""#
        );
        assert_eq!(fetch_command(0), "git fetch --all --prune");
        assert_eq!(
            fetch_command(1),
            r#"git fetch --all --prune && git fetch "$GITGEL_REMOTE_1" "$GITGEL_REFSPEC_1""#
        );
        assert_eq!(
            delete_branch_command(false, CheckedOut::No, true, true),
            r#"git branch -D "$GITGEL_BRANCH" && git update-ref -d "$GITGEL_TRACKING""#
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
    fn stash_commands_go_from_the_highest_index_down() {
        assert_eq!(stash_command("drop", &[2]), "git stash drop 'stash@{2}'");
        assert_eq!(
            stash_command("pop", &[0, 3, 1, 3]),
            "git stash pop 'stash@{3}' && git stash pop 'stash@{1}' && git stash pop 'stash@{0}'"
        );
        assert_eq!(stash_action_name("Apply", &[4]), "Apply stash@{4}");
        assert_eq!(stash_action_name("Apply", &[4, 1]), "Apply 2 stashes");
    }

    #[test]
    fn discard_commands_hold_no_values() {
        let both = DiscardStep {
            restore: 2,
            keep: 1,
            clean: 1,
        };
        let untracked = DiscardStep {
            restore: 0,
            keep: 0,
            clean: 1,
        };
        assert_eq!(
            discard_command(&[both, untracked]),
            r#"git -C "$GITGEL_FOLDER_1" restore --source=HEAD --staged --worktree -- "$GITGEL_PATH_1_1" "$GITGEL_PATH_1_2" && git -C "$GITGEL_FOLDER_1" restore --worktree -- "$GITGEL_KEEP_1_1" && git -C "$GITGEL_FOLDER_1" clean -f -q -- "$GITGEL_CLEAN_1_1" && git -C "$GITGEL_FOLDER_2" clean -f -q -- "$GITGEL_CLEAN_2_1""#
        );
    }

    #[test]
    fn ignore_lines_name_each_path_once() {
        let paths = |p: &[&str]| p.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(ignore_lines("", &paths(&["a.log"])), "/a.log\n");
        assert_eq!(
            ignore_lines("dist/\n/a.log\n", &paths(&["a.log", "b/c.txt"])),
            "/b/c.txt\n"
        );
        assert_eq!(ignore_lines("dist/", &paths(&["x"])), "\n/x\n");
        assert_eq!(ignore_lines("/x\n", &paths(&["x"])), "");
        assert_eq!(ignore_lines("", &paths(&["x", "x"])), "/x\n");
        assert_eq!(
            ignore_lines("", &paths(&["#a [1]*?.txt", r"b\c", "d "])),
            "/#a \\[1]\\*\\?.txt\n/b\\\\c\n/d\\ \n"
        );
        assert!(!IGNORE_COMMAND.contains('{'));
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
            body: false,
            no_verify: false,
            amend: false,
        };
        assert_eq!(
            commit_command(plain),
            r#"git -C "$GITGEL_FOLDER" commit -m "$GITGEL_SUMMARY""#
        );
        let full = CommitShape {
            body: true,
            no_verify: true,
            amend: true,
        };
        assert_eq!(
            commit_command(full),
            r#"git -C "$GITGEL_FOLDER" commit --amend --no-verify -m "$GITGEL_SUMMARY" -m "$GITGEL_BODY""#
        );
    }

    #[test]
    fn stage_commands_hold_no_values() {
        let both = StageShape {
            stage: 2,
            unstage: 1,
            unborn: false,
        };
        let once = r#"git -C "$GITGEL_FOLDER" add -A -- "$GITGEL_STAGE_1" "$GITGEL_STAGE_2" && git -C "$GITGEL_FOLDER" restore --staged -- "$GITGEL_UNSTAGE_1""#;
        assert_eq!(
            stage_command(both),
            format!("{{ {once}; }} || {{ sleep 0.5 && {once}; }}")
        );
        let unborn = StageShape {
            stage: 0,
            unstage: 1,
            unborn: true,
        };
        let once = r#"git -C "$GITGEL_FOLDER" rm --cached -q -- "$GITGEL_UNSTAGE_1""#;
        assert_eq!(
            stage_command(unborn),
            format!("{{ {once}; }} || {{ sleep 0.5 && {once}; }}")
        );
        let once = r#"git -C "$GITGEL_FOLDER" update-index --add --cacheinfo "$GITGEL_MODE,$(git -C "$GITGEL_FOLDER" hash-object -w --path="$GITGEL_PATH" -- "$GITGEL_BLOB"),$GITGEL_PATH""#;
        assert_eq!(
            stage_lines_command(),
            format!("{{ {once}; }} || {{ sleep 0.5 && {once}; }}")
        );
    }

    /// Picked lines: the index must still hold what they were picked from; the mode comes from
    /// the index, else HEAD, else the file.
    #[test]
    fn stage_mode_checks_the_index() {
        use crate::git::testutil::TestRepo;
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 1);
        t.checkout_main();
        let staged = t
            .repo
            .index()
            .unwrap()
            .get_path(Path::new("a.txt"), 0)
            .unwrap()
            .id
            .to_string();
        let mode =
            |rel: &str, expect: Option<&str>| worktrees::stage_mode(&t.repo, t.path(), rel, expect);
        assert_eq!(mode("a.txt", Some(&staged)).unwrap(), "100644");
        assert!(mode("a.txt", None).is_err());
        t.write_file(t.path(), "run.sh", b"echo\n");
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            t.path().join("run.sh"),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert_eq!(mode("run.sh", None).unwrap(), "100755");
        std::os::unix::fs::symlink("a.txt", t.path().join("link")).unwrap();
        assert!(mode("link", None).is_err());
    }
}
