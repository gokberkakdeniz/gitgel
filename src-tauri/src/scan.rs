//! Branch and worktree discovery, entry summaries and the stored scan result.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use tauri::Emitter;

use crate::cache::Cache;
use crate::config;
use crate::error::AppError;
use crate::git::history::{self, CommittedStats};
use crate::git::pool::RepoPool;
use crate::git::refs::DefaultBase;
use crate::git::{diff, refs, worktrees, Repo};
use crate::model::{
    entry_key, Config, EntryState, EntrySummary, FileChange, OtherBranch, RepoConfig, RepoScan,
    RepoStatus, RepoUpdated, ScanResult, UpdateReason,
};
use crate::nearest;
use crate::state::{lock, AppState};
use crate::timing::Timings;

pub const REPO_UPDATED: &str = "repo-updated";

/// Where a repository keeps its git dir and worktrees; the watcher (T2.8) watches these.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoLayout {
    pub git_dir: PathBuf,
    /// `(linked worktree name, folder)`; the main worktree has no name.
    pub worktrees: Vec<(Option<String>, PathBuf)>,
}

pub struct RepoResult {
    pub scan: RepoScan,
    /// `None` when the repository could not be read.
    pub layout: Option<RepoLayout>,
}

/// Everything a summary needs about the repository being scanned.
struct RepoCtx<'a> {
    pool: &'a RepoPool,
    cache: &'a Mutex<Cache>,
    repo: &'a Repo,
    repo_cfg: &'a RepoConfig,
    repo_name: String,
    main_path: PathBuf,
    config: &'a Config,
    /// The default base, with its local and remote forms (T13.1).
    default: Option<DefaultBase>,
    /// Local name of the default base (e.g. `master`). Its own base is its upstream.
    base_branch: Option<String>,
    /// Default refs the entries ended up using (for the merged-state walks).
    used_defaults: RefCell<HashSet<String>>,
    /// Step durations for the log.
    timings: RefCell<Timings>,
}

impl RepoCtx<'_> {
    /// The base an entry uses unless one was saved for it, and whether not having one is a
    /// problem. The base branch is compared with its upstream (unpushed commits); without a
    /// usable upstream (none, or one with no common ancestor) it only shows uncommitted work.
    /// Other entries use the nearest default.
    fn fallback_base(&self, branch: Option<&str>, tip: Option<&str>) -> (Option<String>, bool) {
        match branch {
            Some(b) if Some(b) == self.base_branch.as_deref() => {
                let upstream = refs::upstream_of(self.repo, b).filter(|up| {
                    let up_tip = refs::resolve_commit(self.repo, up);
                    match (tip, up_tip) {
                        (Some(tip), Some(up_tip)) => {
                            !matches!(history::ahead_of(self.repo, tip, &up_tip), Ok(None))
                        }
                        _ => true,
                    }
                });
                (upstream, false)
            }
            _ => {
                let base = self.default.as_ref().map(|def| {
                    let started = std::time::Instant::now();
                    let r =
                        nearest::default_ref(self.cache, self.repo, &self.repo_cfg.id, def, tip);
                    self.timings.borrow_mut().add("nearest", started.elapsed());
                    r
                });
                (base, true)
            }
        }
    }
}

/// Scans one repository. Never fails: problems end up in `status` / `error` or in the state of
/// the affected entry.
pub fn scan_repo(
    pool: &RepoPool,
    cache: &Mutex<Cache>,
    repo_cfg: &RepoConfig,
    config: &Config,
    now: i64,
) -> RepoResult {
    let mut scan = RepoScan {
        repo: repo_cfg.clone(),
        name: repo_name(&repo_cfg.path),
        status: RepoStatus::Ok,
        error: None,
        default_base: None,
        default_base_source: None,
        active: Vec::new(),
        others: Vec::new(),
    };
    let path = Path::new(&repo_cfg.path);
    if !path.exists() {
        // If it comes back at the same path, open it afresh.
        pool.retain_existing();
        scan.status = RepoStatus::Missing;
        return RepoResult { scan, layout: None };
    }
    let shared = match pool.get(path) {
        Ok(shared) => shared,
        Err(e) => {
            scan.status = RepoStatus::Error;
            scan.error = Some(e.to_string());
            return RepoResult { scan, layout: None };
        }
    };
    let repo = lock(&shared);
    match fill(pool, cache, &repo, repo_cfg, config, now, &mut scan) {
        Ok(layout) => RepoResult {
            scan,
            layout: Some(layout),
        },
        Err(e) => {
            log::warn!("scan of {} failed: {e}", repo_cfg.path);
            scan.status = RepoStatus::Error;
            scan.error = Some(e.to_string());
            scan.active.clear();
            scan.others.clear();
            RepoResult { scan, layout: None }
        }
    }
}

fn fill(
    pool: &RepoPool,
    cache: &Mutex<Cache>,
    repo: &Repo,
    repo_cfg: &RepoConfig,
    config: &Config,
    now: i64,
    scan: &mut RepoScan,
) -> Result<RepoLayout, AppError> {
    let mut t = Timings::start();
    let default = t.time("base", || {
        refs::default_base(repo, &config.settings.default_base_order)
    });
    scan.default_base = default.as_ref().map(|d| d.name.clone());
    scan.default_base_source = default.as_ref().map(|d| d.source.clone());
    let base_branch = default
        .as_ref()
        .map(|d| refs::base_branch_name(repo, &d.name));

    let wts = t.time("worktrees", || worktrees::list_worktrees(pool, repo))?;
    let layout = RepoLayout {
        git_dir: worktrees::git_dir(repo),
        worktrees: wts
            .iter()
            .map(|w| (w.name.clone(), w.path.clone()))
            .collect(),
    };
    let checked_out: HashMap<&str, &Path> = wts
        .iter()
        .filter_map(|w| Some((w.branch.as_deref()?, w.path.as_path())))
        .collect();

    let ctx = RepoCtx {
        pool,
        cache,
        repo,
        repo_cfg,
        repo_name: scan.name.clone(),
        main_path: canonical(Path::new(&repo_cfg.path)),
        config,
        default: default.clone(),
        base_branch: base_branch.clone(),
        used_defaults: RefCell::new(HashSet::new()),
        timings: RefCell::new(t),
    };
    let horizon = i64::from(config.settings.active_days) * 86_400;
    let mut live_tips = HashSet::new();

    let branches = {
        let started = std::time::Instant::now();
        let branches = refs::local_branches(repo)?;
        ctx.timings.borrow_mut().add("branches", started.elapsed());
        branches
    };
    let mut other_tips: Vec<(String, i64)> = Vec::new();
    for branch in branches {
        live_tips.insert(branch.tip.clone());
        if Some(&branch.name) == base_branch.as_ref() {
            // Listed only while it holds work: unpushed commits or uncommitted changes.
            let worktree = checked_out
                .get(branch.name.as_str())
                .map(|p| p.to_path_buf());
            let summary = summarize(
                &ctx,
                Some(branch.name.clone()),
                worktree,
                Some(branch.tip.clone()),
                Some(branch.last_commit_at),
            );
            let has_work = summary.ahead.unwrap_or(0) > 0
                || summary.uncommitted.unwrap_or(0) > 0
                || summary.state == EntryState::GitError;
            if has_work {
                scan.active.push(summary);
            }
            continue;
        }
        let worktree = checked_out
            .get(branch.name.as_str())
            .map(|p| p.to_path_buf());
        if worktree.is_some() || now - branch.last_commit_at <= horizon {
            let checked = worktree.is_some();
            let summary = summarize(
                &ctx,
                Some(branch.name.clone()),
                worktree,
                Some(branch.tip.clone()),
                Some(branch.last_commit_at),
            );
            // Recent branches count only when they add something; a missing base or an error
            // is shown rather than hidden, and so is a branch whose base was picked by hand
            // (else a base at its own tip would hide it, with no way back to the menu).
            if checked || summary.ahead != Some(0) || summary.base_is_custom {
                scan.active.push(summary);
                continue;
            }
        }
        other_tips.push((branch.tip.clone(), branch.last_commit_at));
        scan.others.push(OtherBranch {
            repo_id: repo_cfg.id.clone(),
            repo_name: scan.name.clone(),
            branch: branch.name,
            last_commit_at: branch.last_commit_at,
            merged: false,
        });
    }
    // One pass per default form in use answers "merged into the default base?" for every other
    // branch: the configured default, plus the other form when some entry uses it (T13.1).
    let mut walked: Vec<String> = default.iter().map(|d| d.name.clone()).collect();
    for used in ctx.used_defaults.borrow().iter() {
        if !walked.contains(used) {
            walked.push(used.clone());
        }
    }
    for name in walked {
        let Some(base) = refs::resolve_commit(repo, &name) else {
            continue;
        };
        let started = std::time::Instant::now();
        let prev = lock(cache).merged(&repo_cfg.id, &name);
        match history::merged_tips(repo, &base, &other_tips, prev.as_ref()) {
            Ok(state) => {
                for (o, (tip, _)) in scan.others.iter_mut().zip(&other_tips) {
                    o.merged |= state.merged.contains(tip);
                }
                lock(cache).put_merged(&repo_cfg.id, &name, state);
            }
            Err(e) => log::warn!("merged check in {} failed: {e}", repo_cfg.path),
        }
        ctx.timings.borrow_mut().add("merged", started.elapsed());
    }

    for wt in wts.iter().filter(|w| w.branch.is_none()) {
        live_tips.insert(wt.head.clone());
        let at = refs::commit_time(repo, &wt.head).ok();
        scan.active.push(summarize(
            &ctx,
            None,
            Some(wt.path.clone()),
            Some(wt.head.clone()),
            at,
        ));
    }

    scan.active
        .sort_by_key(|e| std::cmp::Reverse(e.last_commit_at));
    scan.others
        .sort_by_key(|o| std::cmp::Reverse(o.last_commit_at));
    lock(cache).prune(&repo_cfg.id, &live_tips);
    log::info!(
        "scan {}: {} · {} active, {} others, {} worktrees",
        scan.name,
        ctx.timings.borrow(),
        scan.active.len(),
        scan.others.len(),
        layout.worktrees.len()
    );
    Ok(layout)
}

/// Summary of one entry: a branch (`branch` set) or a detached worktree (`branch` `None`).
/// `tip` `None` means the branch no longer exists.
fn summarize(
    ctx: &RepoCtx,
    branch: Option<String>,
    worktree_path: Option<PathBuf>,
    tip: Option<String>,
    last_commit_at: Option<i64>,
) -> EntrySummary {
    let worktree_str = worktree_path
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned());
    let key = entry_key(&ctx.repo_cfg.id, branch.as_deref(), worktree_str.as_deref());
    let custom = ctx.config.branch_bases.get(&key).cloned();
    let base_is_custom = custom.is_some();
    let (base, base_required) = match custom {
        Some(c) => (Some(c), true),
        None => {
            let (fallback, required) = ctx.fallback_base(branch.as_deref(), tip.as_deref());
            if let Some(f) = &fallback {
                ctx.used_defaults.borrow_mut().insert(f.clone());
            }
            (fallback, required)
        }
    };

    let mut s = EntrySummary {
        key,
        repo_id: ctx.repo_cfg.id.clone(),
        repo_name: ctx.repo_name.clone(),
        branch,
        worktree_path: worktree_str,
        head_sha: tip.clone(),
        short_sha: tip.as_ref().map(|t| t.chars().take(7).collect()),
        base: base.clone(),
        base_is_custom,
        ahead: None,
        behind: None,
        files: None,
        add: None,
        del: None,
        uncommitted: None,
        last_commit_at,
        state: EntryState::Ok,
        error: None,
    };
    let mut flags = StateFlags {
        detached: s.branch.is_none(),
        ..StateFlags::default()
    };
    let fail = |s: &mut EntrySummary, flags: &mut StateFlags, e: AppError| {
        log::warn!("{} in {}: {e}", s.key, ctx.repo_cfg.path);
        flags.git_error = true;
        s.error = Some(e.to_string());
    };

    let Some(tip) = tip else {
        flags.deleted = true;
        s.state = pick_state(&flags);
        return s;
    };

    if let Some(wt) = &worktree_path {
        match uncommitted_count(ctx, wt, &tip) {
            Ok(n) => s.uncommitted = Some(n),
            Err(e) => fail(&mut s, &mut flags, e),
        }
    }

    // `Err(None)`: nothing to compare with, which is fine (base branch without upstream).
    let stats = match base
        .as_deref()
        .map(|b| (b, refs::resolve_commit(ctx.repo, b)))
    {
        None if !base_required => Err(None),
        None => Err(Some("no default base found".to_string())),
        Some((b, None)) => Err(Some(format!("base {b} not found"))),
        Some((_, Some(base_tip))) => match cached_committed(ctx, &tip, &base_tip) {
            Ok(stats) if stats.merge_base.is_none() => Err(Some("no common ancestor".to_string())),
            Ok(stats) => Ok(stats),
            Err(e) => {
                fail(&mut s, &mut flags, e);
                Err(Some(String::new()))
            }
        },
    };
    match stats {
        Ok(stats) => {
            s.ahead = Some(stats.ahead);
            s.behind = Some(stats.behind);
            s.files = Some(stats.files);
            s.add = Some(stats.add);
            s.del = Some(stats.del);
            // A fresh worktree with only uncommitted work must not look merged.
            flags.merged =
                (stats.ahead == 0 || stats.squash_merged) && s.uncommitted.unwrap_or(0) == 0;
        }
        Err(Some(reason)) if !flags.git_error => {
            flags.base_missing = true;
            s.error = Some(reason);
        }
        Err(_) => {}
    }
    s.state = pick_state(&flags);
    s
}

/// Uncommitted file count of a worktree whose HEAD is `head`; cached until the watcher reports
/// a change in it or HEAD moves.
fn uncommitted_count(ctx: &RepoCtx, worktree: &Path, head: &str) -> Result<u32, AppError> {
    if let Some(w) = lock(ctx.cache).workdir(worktree, head) {
        let n = w.count.or(w.uncommitted.as_ref().map(|u| u.len() as u32));
        if let Some(n) = n {
            ctx.timings
                .borrow_mut()
                .add("status cached", std::time::Duration::ZERO);
            return Ok(n);
        }
    }
    let started = std::time::Instant::now();
    // The file list, not just the count: a review of this worktree then opens from the cache.
    // The main worktree is the repository already locked by the caller.
    let list = if worktree == ctx.main_path {
        cached_uncommitted(ctx.cache, ctx.repo, worktree, head)?
    } else {
        let shared = ctx.pool.get(worktree)?;
        let wt_repo = lock(&shared);
        cached_uncommitted(ctx.cache, &wt_repo, worktree, head)?
    };
    ctx.timings.borrow_mut().add("status", started.elapsed());
    Ok(list.len() as u32)
}

/// HEAD ↔ working tree file list of a worktree, cached like `uncommitted_count`.
pub fn cached_uncommitted(
    cache: &Mutex<Cache>,
    wt_repo: &Repo,
    worktree: &Path,
    head: &str,
) -> Result<Vec<FileChange>, AppError> {
    if let Some(list) = lock(cache)
        .workdir(worktree, head)
        .and_then(|w| w.uncommitted)
    {
        return Ok(list);
    }
    let list = diff::uncommitted(wt_repo)?;
    let n = list.len() as u32;
    lock(cache).update_workdir(worktree, head, |w| {
        w.count = Some(n);
        w.uncommitted = Some(list.clone());
    });
    Ok(list)
}

/// Merge-base ↔ working tree file list, limited to the paths that can differ (committed or
/// uncommitted changes), cached like `uncommitted_count`.
pub fn cached_all(
    cache: &Mutex<Cache>,
    wt_repo: &Repo,
    worktree: &Path,
    head: &str,
    merge_base: &str,
    committed: &[FileChange],
    uncommitted: &[FileChange],
) -> Result<Vec<FileChange>, AppError> {
    if let Some(list) = lock(cache)
        .workdir(worktree, head)
        .and_then(|w| w.all.get(merge_base).cloned())
    {
        return Ok(list);
    }
    let mut paths: Vec<String> = committed
        .iter()
        .chain(uncommitted)
        .flat_map(|c| std::iter::once(c.path.clone()).chain(c.old_path.clone()))
        .collect();
    paths.sort();
    paths.dedup();
    let list = diff::workdir_changes_paths(wt_repo, merge_base, &paths)?;
    lock(cache).update_workdir(worktree, head, |w| {
        w.all.insert(merge_base.to_string(), list.clone());
    });
    Ok(list)
}

fn cached_committed(ctx: &RepoCtx, tip: &str, base: &str) -> Result<CommittedStats, AppError> {
    let started = std::time::Instant::now();
    let stats = committed_stats(ctx.cache, &ctx.repo_cfg.id, ctx.repo, tip, base);
    ctx.timings.borrow_mut().add("stats", started.elapsed());
    stats
}

/// Committed stats of `tip` against `base`, from the cache when possible. The cache lock is not
/// held while git2 works.
pub fn committed_stats(
    cache: &Mutex<Cache>,
    repo_id: &str,
    repo: &Repo,
    tip: &str,
    base: &str,
) -> Result<CommittedStats, AppError> {
    if let Some(stats) = lock(cache).committed(repo_id, tip, base) {
        return Ok(stats);
    }
    let stats = history::committed_stats(repo, tip, base)?;
    lock(cache).put_committed(repo_id, tip, base, stats.clone());
    Ok(stats)
}

/// Summary of one entry outside a full scan (review, project view). `tip_override` reviews a
/// given commit instead of the branch's current tip.
pub fn summarize_one(
    pool: &RepoPool,
    cache: &Mutex<Cache>,
    repo_cfg: &RepoConfig,
    config: &Config,
    branch: Option<&str>,
    worktree_path: Option<&str>,
    tip_override: Option<&str>,
) -> EntrySummary {
    let path = Path::new(&repo_cfg.path);
    let bare = |flags: StateFlags, error: Option<String>| {
        let key = entry_key(&repo_cfg.id, branch, worktree_path);
        EntrySummary {
            base: config.branch_bases.get(&key).cloned(),
            base_is_custom: config.branch_bases.contains_key(&key),
            key,
            repo_id: repo_cfg.id.clone(),
            repo_name: repo_name(&repo_cfg.path),
            branch: branch.map(str::to_string),
            worktree_path: worktree_path.map(str::to_string),
            head_sha: None,
            short_sha: None,
            ahead: None,
            behind: None,
            files: None,
            add: None,
            del: None,
            uncommitted: None,
            last_commit_at: None,
            state: pick_state(&flags),
            error,
        }
    };
    if !path.exists() {
        return bare(
            StateFlags {
                repo_missing: true,
                ..StateFlags::default()
            },
            None,
        );
    }
    let result = pool.get(path).and_then(|shared| {
        let repo = lock(&shared);
        summarize_locked(
            pool,
            cache,
            &repo,
            repo_cfg,
            config,
            branch,
            worktree_path,
            tip_override,
        )
    });
    result.unwrap_or_else(|e| {
        log::warn!("summary of {branch:?} in {} failed: {e}", repo_cfg.path);
        bare(
            StateFlags {
                git_error: true,
                ..StateFlags::default()
            },
            Some(e.to_string()),
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn summarize_locked(
    pool: &RepoPool,
    cache: &Mutex<Cache>,
    repo: &Repo,
    repo_cfg: &RepoConfig,
    config: &Config,
    branch: Option<&str>,
    worktree_path: Option<&str>,
    tip_override: Option<&str>,
) -> Result<EntrySummary, AppError> {
    let default = refs::default_base(repo, &config.settings.default_base_order);
    let wts = worktrees::list_worktrees(pool, repo)?;
    let (worktree, mut tip, mut at) = match branch {
        Some(name) => {
            let local = refs::local_branches(repo)?
                .into_iter()
                .find(|b| b.name == name);
            let worktree = wts
                .iter()
                .find(|w| w.branch.as_deref() == Some(name))
                .map(|w| w.path.clone());
            (
                worktree,
                local.as_ref().map(|b| b.tip.clone()),
                local.map(|b| b.last_commit_at),
            )
        }
        None => {
            let wanted = worktree_path.map(|p| canonical(Path::new(p)));
            let wt = wts
                .iter()
                .find(|w| w.branch.is_none() && Some(&w.path) == wanted.as_ref());
            let at = wt.and_then(|w| refs::commit_time(repo, &w.head).ok());
            (
                wanted.filter(|_| wt.is_some()),
                wt.map(|w| w.head.clone()),
                at,
            )
        }
    };
    if let Some(t) = tip_override {
        tip = Some(t.to_string());
        at = refs::commit_time(repo, t).ok();
    }
    let ctx = RepoCtx {
        pool,
        cache,
        repo,
        repo_cfg,
        repo_name: repo_name(&repo_cfg.path),
        main_path: canonical(Path::new(&repo_cfg.path)),
        config,
        base_branch: default
            .as_ref()
            .map(|d| refs::base_branch_name(repo, &d.name)),
        default,
        used_defaults: RefCell::new(HashSet::new()),
        timings: RefCell::new(Timings::start()),
    };
    let mut s = summarize(&ctx, branch.map(str::to_string), worktree, tip, at);
    // A detached entry keeps its key even when its worktree is gone.
    if branch.is_none() && s.worktree_path.is_none() {
        s.worktree_path = worktree_path.map(str::to_string);
        s.key = entry_key(&repo_cfg.id, None, worktree_path);
    }
    Ok(s)
}

/// Summary of an entry whose repository is no longer in the config.
pub fn removed_repo_summary(e: &crate::model::EntryConfig, config: &Config) -> EntrySummary {
    let key = e.key();
    EntrySummary {
        base: config.branch_bases.get(&key).cloned(),
        base_is_custom: config.branch_bases.contains_key(&key),
        key,
        repo_id: e.repo_id.clone(),
        repo_name: e.repo_id.clone(),
        branch: e.branch.clone(),
        worktree_path: e.worktree_path.clone(),
        head_sha: None,
        short_sha: None,
        ahead: None,
        behind: None,
        files: None,
        add: None,
        del: None,
        uncommitted: None,
        last_commit_at: None,
        state: EntryState::RepoMissing,
        error: Some("repository removed from Gitgel".into()),
    }
}

/// Current tip of an entry: the branch's tip, or the HEAD of a detached worktree. `None` if it
/// no longer exists.
pub fn current_tip(
    pool: &RepoPool,
    repo_cfg: &RepoConfig,
    branch: Option<&str>,
    worktree_path: Option<&str>,
) -> Option<String> {
    let main = Path::new(&repo_cfg.path);
    let shared = pool.get(main).ok()?;
    let repo = lock(&shared);
    match (branch, worktree_path) {
        (Some(b), _) => refs::resolve_commit(&repo, &format!("refs/heads/{b}")),
        (None, Some(wt)) => {
            let wt = canonical(Path::new(wt));
            if wt == canonical(main) {
                return worktrees::head_sha(&repo).ok().flatten();
            }
            let wt_shared = pool.get(&wt).ok()?;
            let wt_repo = lock(&wt_shared);
            worktrees::head_sha(&wt_repo).ok().flatten()
        }
        (None, None) => None,
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct StateFlags {
    pub repo_missing: bool,
    pub git_error: bool,
    pub deleted: bool,
    pub base_missing: bool,
    pub detached: bool,
    pub merged: bool,
}

/// `repo_missing` > `git_error` > `branch_deleted` > `base_missing` > `detached` > `merged` > `ok`.
pub fn pick_state(f: &StateFlags) -> EntryState {
    if f.repo_missing {
        EntryState::RepoMissing
    } else if f.git_error {
        EntryState::GitError
    } else if f.deleted {
        EntryState::BranchDeleted
    } else if f.base_missing {
        EntryState::BaseMissing
    } else if f.detached {
        EntryState::Detached
    } else if f.merged {
        EntryState::Merged
    } else {
        EntryState::Ok
    }
}

/// Re-reads the uncommitted state of the entries checked out at `worktree` in a stored scan.
/// Committed stats come from the cache. `None`: no entry is checked out there; otherwise whether
/// an entry's summary changed. The base branch's worktree also gives `None`: whether it is
/// listed at all depends on its state, so the caller rescans the repo.
pub fn refresh_worktree(
    pool: &RepoPool,
    cache: &Mutex<Cache>,
    config: &Config,
    scan: &mut RepoScan,
    worktree: &Path,
) -> Result<Option<bool>, AppError> {
    let wt = worktree.to_string_lossy();
    if !scan
        .active
        .iter()
        .any(|e| e.worktree_path.as_deref() == Some(&*wt))
    {
        return Ok(None);
    }
    let shared = pool.get(Path::new(&scan.repo.path))?;
    let repo = lock(&shared);
    let base_branch = scan
        .default_base
        .as_deref()
        .map(|b| refs::base_branch_name(&repo, b));
    let on_base_branch = scan.active.iter().any(|e| {
        e.worktree_path.as_deref() == Some(&*wt) && e.branch.is_some() && e.branch == base_branch
    });
    if on_base_branch {
        return Ok(None);
    }
    let ctx = RepoCtx {
        pool,
        cache,
        repo: &repo,
        repo_cfg: &scan.repo,
        repo_name: scan.name.clone(),
        main_path: canonical(Path::new(&scan.repo.path)),
        config,
        default: refs::default_base(&repo, &config.settings.default_base_order),
        base_branch,
        used_defaults: RefCell::new(HashSet::new()),
        timings: RefCell::new(Timings::start()),
    };
    let mut changed = false;
    let mut updated = scan.active.clone();
    for entry in updated
        .iter_mut()
        .filter(|e| e.worktree_path.as_deref() == Some(&*wt))
    {
        let fresh = summarize(
            &ctx,
            entry.branch.clone(),
            Some(worktree.to_path_buf()),
            entry.head_sha.clone(),
            entry.last_commit_at,
        );
        if fresh != *entry {
            *entry = fresh;
            changed = true;
        }
    }
    scan.active = updated;
    Ok(Some(changed))
}

// ---- Stored scan and commands' helpers ----

/// Scans every configured repository in parallel and replaces the stored result.
/// Each repo is stored and, when its result changed, emitted as `repo-updated` as soon as it is
/// done, so the screen fills in repo by repo.
pub fn scan_all(state: &AppState) -> ScanResult {
    let started = Instant::now();
    let config = config::snapshot(state);
    state.pool.retain_existing();
    let now = chrono::Utc::now().timestamp();
    let (tx, rx) = std::sync::mpsc::channel::<(usize, RepoResult)>();
    let mut results: Vec<Option<RepoResult>> = config.repos.iter().map(|_| None).collect();
    std::thread::scope(|s| {
        for (i, r) in config.repos.iter().enumerate() {
            let tx = tx.clone();
            let config = &config;
            s.spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    scan_repo(&state.pool, &state.cache, r, config, now)
                }))
                .unwrap_or_else(|_| RepoResult {
                    scan: failed_scan(r, "scan panicked"),
                    layout: None,
                });
                let _ = tx.send((i, result));
            });
        }
        drop(tx);
        for (i, result) in rx {
            store(state, &result, UpdateReason::Rescan, None, false);
            results[i] = Some(result);
        }
    });
    let results: Vec<RepoResult> = results.into_iter().flatten().collect();

    // Forget repos that left the config.
    let ids: HashSet<&str> = config.repos.iter().map(|r| r.id.as_str()).collect();
    lock(&state.last_scan).retain(|id, _| ids.contains(id.as_str()));
    lock(&state.layouts).retain(|id, _| ids.contains(id.as_str()));
    let (cache, cache_max) = crate::git::object_cache_mb();
    log::info!(
        "scan: {} repos, {} ms · libgit2 object cache {cache}/{cache_max} MB",
        results.len(),
        started.elapsed().as_millis()
    );
    crate::memory::release(state);
    ScanResult {
        repos: results.into_iter().map(|r| r.scan).collect(),
        scanned_at: now,
    }
}

/// The stored result, in config order; `None` if nothing was scanned yet.
pub fn stored_scan(state: &AppState) -> Option<ScanResult> {
    let config = config::snapshot(state);
    let stored = lock(&state.last_scan);
    if stored.is_empty() && !config.repos.is_empty() {
        return None;
    }
    Some(ScanResult {
        repos: config
            .repos
            .iter()
            .filter_map(|r| stored.get(&r.id).cloned())
            .collect(),
        scanned_at: chrono::Utc::now().timestamp(),
    })
}

/// Rescans one repository, stores it and emits `repo-updated`. Returns whether its layout
/// (git dir or worktree list) changed.
pub fn rescan_repo(
    state: &AppState,
    repo_id: &str,
    reason: UpdateReason,
    worktree_path: Option<String>,
) -> bool {
    let config = config::snapshot(state);
    let Some(repo_cfg) = config.repos.iter().find(|r| r.id == repo_id) else {
        return false;
    };
    let result = scan_repo(
        &state.pool,
        &state.cache,
        repo_cfg,
        &config,
        chrono::Utc::now().timestamp(),
    );
    // A worktree change may alter file contents without changing the summary: always emit.
    let always = reason == UpdateReason::Worktree;
    store(state, &result, reason, worktree_path, always)
}

/// Stores a repo's scan and layout and emits `repo-updated` if the scan changed (or `always`).
/// Returns whether the layout (git dir, worktrees) changed.
fn store(
    state: &AppState,
    result: &RepoResult,
    reason: UpdateReason,
    worktree_path: Option<String>,
    always: bool,
) -> bool {
    let id = result.scan.repo.id.clone();
    let scan_changed = lock(&state.last_scan)
        .insert(id.clone(), result.scan.clone())
        .as_ref()
        != Some(&result.scan);
    let layout_changed = {
        let mut layouts = lock(&state.layouts);
        let changed = layouts.get(&id) != result.layout.as_ref();
        match &result.layout {
            Some(layout) => layouts.insert(id.clone(), layout.clone()),
            None => layouts.remove(&id),
        };
        changed
    };
    if scan_changed || always {
        emit_repo_updated(state, result.scan.clone(), reason, worktree_path);
    }
    layout_changed
}

pub fn emit_repo_updated(
    state: &AppState,
    scan: RepoScan,
    reason: UpdateReason,
    worktree_path: Option<String>,
) {
    let event = RepoUpdated {
        repo_id: scan.repo.id.clone(),
        scan,
        reason,
        worktree_path,
    };
    log::debug!("{REPO_UPDATED}: {} ({:?})", event.repo_id, event.reason);
    if let Err(e) = state.app.emit(REPO_UPDATED, &event) {
        log::warn!("cannot emit {REPO_UPDATED}: {e}");
    }
}

fn failed_scan(repo_cfg: &RepoConfig, error: &str) -> RepoScan {
    RepoScan {
        repo: repo_cfg.clone(),
        name: repo_name(&repo_cfg.path),
        status: RepoStatus::Error,
        error: Some(error.to_string()),
        default_base: None,
        default_base_source: None,
        active: Vec::new(),
        others: Vec::new(),
    }
}

pub fn repo_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;

    fn setup(t: &TestRepo) -> (RepoPool, Mutex<Cache>, RepoConfig, Config) {
        let repo_cfg = RepoConfig {
            id: "r_1".into(),
            path: t.path().to_string_lossy().into_owned(),
        };
        let mut config = Config::default();
        config.repos.push(repo_cfg.clone());
        (
            RepoPool::default(),
            Mutex::new(Cache::default()),
            repo_cfg,
            config,
        )
    }

    fn run(t: &TestRepo) -> RepoResult {
        let (pool, cache, repo_cfg, config) = setup(t);
        scan_repo(
            &pool,
            &cache,
            &repo_cfg,
            &config,
            chrono::Utc::now().timestamp(),
        )
    }

    fn active<'a>(scan: &'a RepoScan, branch: &str) -> &'a EntrySummary {
        scan.active
            .iter()
            .find(|e| e.branch.as_deref() == Some(branch))
            .unwrap_or_else(|| panic!("{branch} not active: {:?}", scan.active))
    }

    /// main (30d) ← feature (checked out, 2 commits) · recent (not checked out) · old (60d) ·
    /// ff (fast-forwarded) · squashed · detached worktree.
    fn fixture() -> TestRepo {
        let t = TestRepo::new();
        let root = t.commit_on("main", &[("a.txt", Some(b"a\n"))], "init", 30);
        t.checkout_main();

        t.branch_from("ff", root);
        let ff = t.commit_on("ff", &[("ff.txt", Some(b"ff\n"))], "ff", 20);
        t.set_branch("main", ff);

        t.branch_from("squashed", ff);
        t.commit_on("squashed", &[("s1", Some(b"1\n"))], "s1", 12);
        t.commit_on("squashed", &[("s2", Some(b"2\n"))], "s2", 11);
        t.commit_on(
            "main",
            &[("s1", Some(b"1\n")), ("s2", Some(b"2\n"))],
            "squash",
            10,
        );

        let main = t.repo.revparse_single("main").unwrap().id();
        t.branch_from("old", main);
        t.commit_on("old", &[("old.txt", Some(b"old\n"))], "old", 60);

        t.branch_from("recent", main);
        t.commit_on("recent", &[("r.txt", Some(b"r\n"))], "recent", 2);

        t.branch_from("feature", main);
        t.commit_on("feature", &[("a.txt", Some(b"a\nb\n"))], "f1", 3);
        t.commit_on("feature", &[("f.txt", Some(b"f\n"))], "f2", 1);
        let wt = t.add_worktree("feature", "feature");
        t.write_file(&wt, "a.txt", b"a\nb\nc\n");
        t.write_file(&wt, "untracked.txt", b"u\n");

        t.add_detached_worktree("detached", ff);
        t.checkout_main();
        t
    }

    #[test]
    fn scans_branches_worktrees_and_states() {
        let t = fixture();
        let RepoResult { scan, layout } = run(&t);
        assert_eq!(scan.status, RepoStatus::Ok);
        assert_eq!(scan.default_base.as_deref(), Some("main"));
        assert_eq!(scan.default_base_source.as_deref(), Some("main"));

        let names: Vec<_> = scan.active.iter().map(|e| e.branch.as_deref()).collect();
        assert_eq!(
            names,
            [Some("feature"), Some("recent"), Some("squashed"), None]
        );

        let f = active(&scan, "feature");
        assert_eq!(f.state, EntryState::Ok);
        assert_eq!(
            (f.ahead, f.files, f.add, f.del),
            (Some(2), Some(2), Some(2), Some(0))
        );
        assert_eq!(f.uncommitted, Some(2));
        assert!(f.worktree_path.as_deref().unwrap().ends_with("wt-feature"));
        assert_eq!(f.base.as_deref(), Some("main"));

        let r = active(&scan, "recent");
        assert_eq!(
            (r.state, r.uncommitted, r.worktree_path.as_deref()),
            (EntryState::Ok, None, None)
        );

        let s = active(&scan, "squashed");
        assert_eq!(s.state, EntryState::Merged);
        assert_eq!(s.ahead, Some(2));

        let d = scan.active.iter().find(|e| e.branch.is_none()).unwrap();
        assert_eq!(d.state, EntryState::Detached);
        assert!(d.key.starts_with("r_1:@"));

        let others: Vec<_> = scan
            .others
            .iter()
            .map(|o| (o.branch.as_str(), o.merged))
            .collect();
        assert_eq!(others, [("ff", true), ("old", false)]);

        let layout = layout.unwrap();
        assert_eq!(layout.git_dir, t.path().join(".git"));
        assert_eq!(layout.worktrees.len(), 3);
    }

    #[test]
    fn fast_forwarded_checked_out_branch_is_merged_unless_dirty() {
        let t = TestRepo::new();
        let root = t.commit_on("main", &[("a", Some(b"a\n"))], "init", 3);
        t.checkout_main();
        t.branch_from("done", root);
        let wt = t.add_worktree("done", "done");
        let scan = run(&t).scan;
        assert_eq!(active(&scan, "done").state, EntryState::Merged);

        // A fresh branch with only uncommitted work is not "merged".
        t.write_file(&wt, "new.txt", b"x\n");
        let scan = run(&t).scan;
        assert_eq!(active(&scan, "done").state, EntryState::Ok);
        assert_eq!(active(&scan, "done").uncommitted, Some(1));
    }

    #[test]
    fn custom_base_and_missing_base() {
        let t = fixture();
        let (pool, cache, repo_cfg, mut config) = setup(&t);
        config
            .branch_bases
            .insert("r_1:feature".into(), "recent".into());
        config
            .branch_bases
            .insert("r_1:recent".into(), "nope".into());
        let scan = scan_repo(
            &pool,
            &cache,
            &repo_cfg,
            &config,
            chrono::Utc::now().timestamp(),
        )
        .scan;
        let f = active(&scan, "feature");
        assert!(f.base_is_custom);
        assert_eq!(f.base.as_deref(), Some("recent"));
        assert_eq!(f.ahead, Some(2));
        let r = active(&scan, "recent");
        assert_eq!(r.state, EntryState::BaseMissing);
        assert_eq!(r.error.as_deref(), Some("base nope not found"));
    }

    #[test]
    fn unrelated_base_is_base_missing() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a", Some(b"a"))], "init", 2);
        t.checkout_main();
        t.commit_on("orphan", &[("b", Some(b"b"))], "b", 1);
        let scan = run(&t).scan;
        let o = active(&scan, "orphan");
        assert_eq!(o.state, EntryState::BaseMissing);
        assert_eq!(o.error.as_deref(), Some("no common ancestor"));
    }

    #[test]
    fn missing_folder_is_missing_status() {
        let (pool, cache) = (RepoPool::default(), Mutex::new(Cache::default()));
        let repo_cfg = RepoConfig {
            id: "r_1".into(),
            path: "/nonexistent/gitgel/repo".into(),
        };
        let r = scan_repo(&pool, &cache, &repo_cfg, &Config::default(), 0);
        assert_eq!(r.scan.status, RepoStatus::Missing);
        assert!(r.scan.active.is_empty() && r.layout.is_none());
    }

    #[test]
    fn second_scan_uses_the_cache() {
        let t = fixture();
        let (pool, cache, repo_cfg, config) = setup(&t);
        let now = chrono::Utc::now().timestamp();
        let first = scan_repo(&pool, &cache, &repo_cfg, &config, now).scan;
        // Poison the cached stats: a second scan must return them unchanged.
        let tip = active(&first, "feature").head_sha.clone().unwrap();
        let base = refs::resolve_commit(&t.repo, "main").unwrap();
        let mut stats = lock(&cache).committed("r_1", &tip, &base).unwrap();
        stats.files = 99;
        lock(&cache).put_committed("r_1", &tip, &base, stats);
        let second = scan_repo(&pool, &cache, &repo_cfg, &config, now).scan;
        assert_eq!(active(&second, "feature").files, Some(99));
    }

    #[test]
    fn refresh_worktree_updates_only_uncommitted_state() {
        let t = TestRepo::new();
        let root = t.commit_on("main", &[("a", Some(b"a\n"))], "init", 3);
        t.checkout_main();
        t.branch_from("done", root);
        let wt = t.add_worktree("done", "done");
        let (pool, cache, repo_cfg, config) = setup(&t);
        let mut scan = scan_repo(
            &pool,
            &cache,
            &repo_cfg,
            &config,
            chrono::Utc::now().timestamp(),
        )
        .scan;
        assert_eq!(active(&scan, "done").state, EntryState::Merged);

        // The cached status holds until the watcher reports the change.
        t.write_file(&wt, "new.txt", b"x\n");
        assert_eq!(
            refresh_worktree(&pool, &cache, &config, &mut scan, &wt).unwrap(),
            Some(false)
        );
        lock(&cache).invalidate_workdir(&wt);
        assert_eq!(
            refresh_worktree(&pool, &cache, &config, &mut scan, &wt).unwrap(),
            Some(true)
        );
        let e = active(&scan, "done");
        assert_eq!((e.uncommitted, e.state), (Some(1), EntryState::Ok));
        assert_eq!(
            refresh_worktree(&pool, &cache, &config, &mut scan, &wt).unwrap(),
            Some(false)
        );
        assert_eq!(
            refresh_worktree(&pool, &cache, &config, &mut scan, t.path()).unwrap(),
            None
        );
    }

    #[test]
    fn summarize_one_branch_detached_and_deleted() {
        let t = fixture();
        let (pool, cache, repo_cfg, config) = setup(&t);
        let f = summarize_one(
            &pool,
            &cache,
            &repo_cfg,
            &config,
            Some("feature"),
            None,
            None,
        );
        assert_eq!(
            (f.state, f.ahead, f.uncommitted),
            (EntryState::Ok, Some(2), Some(2))
        );
        assert!(f.worktree_path.as_deref().unwrap().ends_with("wt-feature"));

        let wt = t.root().join("wt-detached").to_string_lossy().into_owned();
        let d = summarize_one(&pool, &cache, &repo_cfg, &config, None, Some(&wt), None);
        assert_eq!(d.state, EntryState::Detached);
        assert_eq!(d.key, format!("r_1:@{wt}"));

        let gone = summarize_one(&pool, &cache, &repo_cfg, &config, Some("nope"), None, None);
        assert_eq!(gone.state, EntryState::BranchDeleted);

        // Reviewing an older commit of the branch.
        let first = refs::resolve_commit(&t.repo, "feature~1").unwrap();
        let o = summarize_one(
            &pool,
            &cache,
            &repo_cfg,
            &config,
            Some("feature"),
            None,
            Some(&first),
        );
        assert_eq!(
            (o.head_sha.as_deref(), o.ahead),
            (Some(first.as_str()), Some(1))
        );

        let missing = RepoConfig {
            id: "r_9".into(),
            path: "/nonexistent/x".into(),
        };
        let m = summarize_one(
            &pool,
            &cache,
            &missing,
            &config,
            Some("feature"),
            None,
            None,
        );
        assert_eq!(m.state, EntryState::RepoMissing);
    }

    #[test]
    fn corrupt_repo_is_an_error_not_a_crash() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a", Some(b"a"))], "init", 1);
        std::fs::write(t.path().join(".git/HEAD"), b"garbage\n").unwrap();
        let r = run(&t);
        assert_eq!(r.scan.status, RepoStatus::Error);
        assert!(r.scan.error.is_some());
        assert!(r.scan.active.is_empty());
    }

    #[test]
    fn base_branch_is_listed_only_with_unpushed_or_uncommitted_work() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "init", 3);
        t.checkout_main();
        t.set_origin_head("main");
        // Clean and pushed: not listed.
        assert!(run(&t).scan.active.is_empty());

        // Two unpushed commits.
        t.commit_on("main", &[("b.txt", Some(b"b\n"))], "b", 2);
        t.commit_on("main", &[("c.txt", Some(b"c\n"))], "c", 1);
        t.checkout_main();
        let scan = run(&t).scan;
        let m = active(&scan, "main");
        assert_eq!(m.base.as_deref(), Some("origin/main"));
        assert_eq!(
            (m.ahead, m.files, m.uncommitted),
            (Some(2), Some(2), Some(0))
        );
        assert_eq!(m.state, EntryState::Ok);
    }

    #[test]
    fn base_branch_without_upstream_shows_uncommitted_work() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "init", 3);
        t.checkout_main();
        assert!(run(&t).scan.active.is_empty());

        t.write_file(t.path(), "a.txt", b"a\nchanged\n");
        let (pool, cache, repo_cfg, config) = setup(&t);
        let mut scan = scan_repo(
            &pool,
            &cache,
            &repo_cfg,
            &config,
            chrono::Utc::now().timestamp(),
        )
        .scan;
        let m = active(&scan, "main");
        assert_eq!(
            (m.base.as_deref(), m.ahead, m.uncommitted),
            (None, None, Some(1))
        );
        assert_eq!(m.state, EntryState::Ok);
        // Its worktree is not refreshed in place: the caller rescans the repo.
        assert_eq!(
            refresh_worktree(&pool, &cache, &config, &mut scan, t.path()).unwrap(),
            None
        );
    }

    #[test]
    fn state_priority() {
        let all = StateFlags {
            repo_missing: true,
            git_error: true,
            deleted: true,
            base_missing: true,
            detached: true,
            merged: true,
        };
        let order = [
            EntryState::RepoMissing,
            EntryState::GitError,
            EntryState::BranchDeleted,
            EntryState::BaseMissing,
            EntryState::Detached,
            EntryState::Merged,
            EntryState::Ok,
        ];
        let mut f = all;
        for expected in order {
            assert_eq!(pick_state(&f), expected);
            // Clear the highest flag still set.
            let flags = [
                &mut f.repo_missing,
                &mut f.git_error,
                &mut f.deleted,
                &mut f.base_missing,
                &mut f.detached,
                &mut f.merged,
            ];
            if let Some(flag) = flags.into_iter().find(|f| **f) {
                *flag = false;
            }
        }
    }
}
