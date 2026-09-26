//! File watching, event classification and targeted recomputation. No polling: FSEvents tells
//! us what changed, only the affected repo or worktree is recomputed, and the result is pushed
//! to the frontend as `repo-updated`.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify_debouncer_full::notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

use crate::config;
use crate::git::worktrees;
use crate::model::UpdateReason;
use crate::scan::{self, RepoLayout};
use crate::state::{lock, AppState};

const DEBOUNCE: Duration = Duration::from_millis(300);

// ---- Pure part: roots and classification ----

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RootKind {
    /// A repository's common git dir (`<repo>/.git`).
    GitDir {
        repo_id: String,
        main_worktree: Option<PathBuf>,
        /// Linked worktree name (`worktrees/<name>`) -> folder.
        linked: HashMap<String, PathBuf>,
    },
    /// A worktree folder (main or linked).
    Worktree { repo_id: String, path: PathBuf },
}

#[derive(Debug, Clone, Default)]
pub struct WatchIndex {
    /// Canonical paths.
    roots: Vec<(PathBuf, RootKind)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Change {
    /// Branches, HEADs or the worktree list changed: rescan the repo.
    Refs { repo_id: String },
    /// Something in a worktree changed. `rel` is relative to the worktree; empty when the
    /// worktree's index changed.
    Worktree {
        repo_id: String,
        path: PathBuf,
        rel: PathBuf,
    },
}

/// Every git dir and worktree folder, from the repos' layouts.
pub fn desired_roots(layouts: &[(String, RepoLayout)]) -> Vec<(PathBuf, RootKind)> {
    let mut roots = Vec::new();
    for (repo_id, layout) in layouts {
        roots.push((
            layout.git_dir.clone(),
            RootKind::GitDir {
                repo_id: repo_id.clone(),
                main_worktree: layout
                    .worktrees
                    .iter()
                    .find(|(name, _)| name.is_none())
                    .map(|(_, p)| p.clone()),
                linked: layout
                    .worktrees
                    .iter()
                    .filter_map(|(name, p)| Some((name.clone()?, p.clone())))
                    .collect(),
            },
        ));
        for (_, path) in &layout.worktrees {
            roots.push((
                path.clone(),
                RootKind::Worktree {
                    repo_id: repo_id.clone(),
                    path: path.clone(),
                },
            ));
        }
    }
    roots
}

/// The folders to actually watch: a root inside another root is covered by it (the main
/// worktree already contains `.git/`).
pub fn watch_set(roots: &[(PathBuf, RootKind)]) -> Vec<PathBuf> {
    let mut paths: Vec<&PathBuf> = roots.iter().map(|(p, _)| p).collect();
    paths.sort_by_key(|p| p.components().count());
    let mut out: Vec<PathBuf> = Vec::new();
    for p in paths {
        if !out.iter().any(|w| p.starts_with(w)) {
            out.push(p.clone());
        }
    }
    out
}

impl WatchIndex {
    pub fn new(roots: Vec<(PathBuf, RootKind)>) -> Self {
        WatchIndex { roots }
    }
}

/// Classifies an event path by the longest root containing it (`<repo>/.git/…` belongs to the
/// git dir, not the main worktree). `None`: nothing to do.
pub fn classify(index: &WatchIndex, path: &Path) -> Option<Change> {
    let (root, kind) = index
        .roots
        .iter()
        .filter(|(root, _)| path.starts_with(root))
        .max_by_key(|(root, _)| root.components().count())?;
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<&str> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect();
    if parts.is_empty() {
        return None;
    }
    match kind {
        RootKind::GitDir {
            repo_id,
            main_worktree,
            linked,
        } => {
            if parts.last()?.ends_with(".lock") {
                return None;
            }
            let refs = || {
                Some(Change::Refs {
                    repo_id: repo_id.clone(),
                })
            };
            let worktree = |path: &PathBuf| {
                Some(Change::Worktree {
                    repo_id: repo_id.clone(),
                    path: path.clone(),
                    rel: PathBuf::new(),
                })
            };
            match parts.as_slice() {
                ["HEAD"] | ["packed-refs"] => refs(),
                ["refs", ..] => refs(),
                ["index"] => worktree(main_worktree.as_ref()?),
                // A worktree was added or removed.
                ["worktrees", _] => refs(),
                ["worktrees", _, "HEAD"] => refs(),
                ["worktrees", name, "index"] => match linked.get(*name) {
                    Some(path) => worktree(path),
                    None => refs(),
                },
                _ => None,
            }
        }
        RootKind::Worktree { repo_id, path } => {
            // `.git` of a linked worktree is a file pointing at the git dir.
            if parts[0] == ".git" {
                return None;
            }
            Some(Change::Worktree {
                repo_id: repo_id.clone(),
                path: path.clone(),
                rel: rel.to_path_buf(),
            })
        }
    }
}

// ---- Runtime: watcher, worker and sync ----

#[derive(Default)]
pub struct Watcher {
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>,
    index: Mutex<WatchIndex>,
    watched: Mutex<HashSet<PathBuf>>,
}

/// Starts the debouncer and the worker thread. Folders are added by `sync_watches`.
pub fn start(state: &AppState) {
    let (tx, rx) = channel();
    match new_debouncer(DEBOUNCE, None, tx) {
        Ok(debouncer) => *lock(&state.watch.debouncer) = Some(debouncer),
        Err(e) => {
            log::warn!("file watching unavailable: {e}");
            return;
        }
    }
    let state = state.clone();
    if let Err(e) = std::thread::Builder::new()
        .name("watch".into())
        .spawn(move || worker(state, rx))
    {
        log::warn!("file watching unavailable: cannot start its thread: {e}");
    }
}

fn worker(state: AppState, rx: Receiver<DebounceEventResult>) {
    // Blocks until a batch arrives, then drains everything already queued into the same round.
    while let Ok(first) = rx.recv() {
        let started = Instant::now();
        let mut paths = Vec::new();
        for result in std::iter::once(first).chain(rx.try_iter()) {
            match result {
                Ok(events) => {
                    for event in events {
                        if !matches!(event.kind, EventKind::Access(_)) {
                            paths.extend(event.paths.iter().cloned());
                        }
                    }
                }
                Err(errors) => {
                    for e in errors {
                        log::warn!("watch error: {e}");
                    }
                }
            }
        }
        let jobs = process(&state, &paths);
        // Rounds that did work reach the release log; ignored-only rounds stay at debug.
        let level = if jobs > 0 {
            log::Level::Info
        } else {
            log::Level::Debug
        };
        log::log!(
            level,
            "watch: {} events, {} jobs, {} ms",
            paths.len(),
            jobs,
            started.elapsed().as_millis()
        );
    }
}

/// Reduces a round of event paths to jobs and runs them. Returns the number of jobs.
fn process(state: &AppState, paths: &[PathBuf]) -> usize {
    let index = lock(&state.watch.index).clone();
    let mut refs: HashSet<String> = HashSet::new();
    let mut touched: HashSet<(String, PathBuf)> = HashSet::new();
    // Per worktree: relative path -> ignored.
    let mut ignore_cache: HashMap<PathBuf, HashMap<PathBuf, bool>> = HashMap::new();

    for path in paths {
        match classify(&index, path) {
            Some(Change::Refs { repo_id }) => {
                refs.insert(repo_id);
            }
            Some(Change::Worktree { repo_id, path, rel }) => {
                if touched.contains(&(repo_id.clone(), path.clone())) {
                    continue;
                }
                let cache = ignore_cache.entry(path.clone()).or_default();
                if rel.as_os_str().is_empty() || !is_ignored(state, &path, &rel, cache) {
                    // Its cached status is stale, even when a refs rescan follows.
                    lock(&state.cache).invalidate_workdir(&path);
                    touched.insert((repo_id, path));
                }
            }
            None => {}
        }
    }
    // A full rescan of the repo covers its worktrees.
    touched.retain(|(repo_id, _)| !refs.contains(repo_id));

    let mut layout_changed = false;
    for repo_id in &refs {
        log::debug!("watch job: refs {repo_id}");
        layout_changed |= scan::rescan_repo(state, repo_id, UpdateReason::Refs, None);
    }
    for (repo_id, path) in &touched {
        log::debug!("watch job: worktree {}", path.display());
        update_worktree(state, repo_id, path);
    }
    if layout_changed {
        sync_watches(state);
    }
    refs.len() + touched.len()
}

fn is_ignored(
    state: &AppState,
    worktree: &Path,
    rel: &Path,
    cache: &mut HashMap<PathBuf, bool>,
) -> bool {
    match state.pool.get(worktree) {
        Ok(shared) => worktrees::is_ignored(&lock(&shared), rel, cache),
        Err(_) => false,
    }
}

/// Recomputes the uncommitted state of one worktree in the stored scan and emits the repo if an
/// entry is checked out there.
fn update_worktree(state: &AppState, repo_id: &str, worktree: &Path) {
    let config = config::snapshot(state);
    let Some(mut scan) = lock(&state.last_scan).get(repo_id).cloned() else {
        return;
    };
    match scan::refresh_worktree(&state.pool, &state.cache, &config, &mut scan, worktree) {
        // Emitted even when the counts did not change: an open review shows the file contents.
        Ok(Some(_)) => {
            lock(&state.last_scan).insert(repo_id.to_string(), scan.clone());
            scan::emit_repo_updated(
                state,
                scan,
                UpdateReason::Worktree,
                Some(worktree.to_string_lossy().into_owned()),
            );
        }
        // The base branch's worktree (listed only while it holds work): rescan the repo.
        Ok(None) => {
            if scan::rescan_repo(
                state,
                repo_id,
                UpdateReason::Worktree,
                Some(worktree.to_string_lossy().into_owned()),
            ) {
                sync_watches(state);
            }
        }
        Err(e) => log::warn!("refresh of {} failed: {e}", worktree.display()),
    }
}

/// Watches the git dir and worktrees of every scanned repo, and nothing else.
pub fn sync_watches(state: &AppState) {
    let layouts: Vec<(String, RepoLayout)> = lock(&state.layouts)
        .iter()
        .map(|(id, l)| (id.clone(), l.clone()))
        .collect();
    let roots: Vec<_> = desired_roots(&layouts)
        .into_iter()
        .filter(|(p, _)| p.exists())
        .collect();
    let want: HashSet<PathBuf> = watch_set(&roots).into_iter().collect();

    let mut debouncer = lock(&state.watch.debouncer);
    let Some(debouncer) = debouncer.as_mut() else {
        return;
    };
    let mut watched = lock(&state.watch.watched);
    for path in watched.difference(&want).cloned().collect::<Vec<_>>() {
        if let Err(e) = debouncer.unwatch(&path) {
            log::warn!("cannot unwatch {}: {e}", path.display());
        }
        watched.remove(&path);
    }
    for path in want.difference(&watched.clone()) {
        match debouncer.watch(path, RecursiveMode::Recursive) {
            Ok(()) => {
                watched.insert(path.clone());
            }
            // Only focus and manual refresh keep this folder current.
            Err(e) => log::warn!("cannot watch {}: {e}", path.display()),
        }
    }
    *lock(&state.watch.index) = WatchIndex::new(roots);
    log::info!("watching {} folders", watched.len());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    /// Repo `/r/app` with its main worktree and a linked worktree `feat` at `/wt/feat`.
    fn index() -> (Vec<(PathBuf, RootKind)>, WatchIndex) {
        let layout = RepoLayout {
            git_dir: p("/r/app/.git"),
            worktrees: vec![(None, p("/r/app")), (Some("feat".into()), p("/wt/feat"))],
        };
        let roots = desired_roots(&[("r_1".into(), layout)]);
        (roots.clone(), WatchIndex::new(roots))
    }

    fn refs() -> Option<Change> {
        Some(Change::Refs {
            repo_id: "r_1".into(),
        })
    }

    fn wt(path: &str, rel: &str) -> Option<Change> {
        Some(Change::Worktree {
            repo_id: "r_1".into(),
            path: p(path),
            rel: p(rel),
        })
    }

    #[test]
    fn git_dir_table() {
        let (_, ix) = index();
        let c = |s: &str| classify(&ix, &p(s));
        assert_eq!(c("/r/app/.git/HEAD"), refs());
        assert_eq!(c("/r/app/.git/packed-refs"), refs());
        assert_eq!(c("/r/app/.git/refs/heads/feat/x"), refs());
        assert_eq!(c("/r/app/.git/index"), wt("/r/app", ""));
        assert_eq!(c("/r/app/.git/worktrees/feat/HEAD"), refs());
        assert_eq!(c("/r/app/.git/worktrees/feat/index"), wt("/wt/feat", ""));
        assert_eq!(c("/r/app/.git/worktrees/new"), refs());
        assert_eq!(c("/r/app/.git/worktrees/new/index"), refs());
        for dropped in [
            "/r/app/.git/objects/ab/cdef",
            "/r/app/.git/logs/HEAD",
            "/r/app/.git/index.lock",
            "/r/app/.git/refs/heads/x.lock",
            "/r/app/.git/FETCH_HEAD",
            "/r/app/.git/worktrees/feat/ORIG_HEAD",
            "/r/app/.git",
        ] {
            assert_eq!(c(dropped), None, "{dropped}");
        }
    }

    #[test]
    fn worktree_paths() {
        let (_, ix) = index();
        let c = |s: &str| classify(&ix, &p(s));
        assert_eq!(c("/r/app/src/a.ts"), wt("/r/app", "src/a.ts"));
        assert_eq!(c("/wt/feat/src/a.ts"), wt("/wt/feat", "src/a.ts"));
        // The `.git` file of a linked worktree.
        assert_eq!(c("/wt/feat/.git"), None);
        assert_eq!(c("/elsewhere/x"), None);
        assert_eq!(c("/r/application/x"), None);
    }

    #[test]
    fn nested_roots_are_watched_once() {
        let (roots, _) = index();
        assert_eq!(roots.len(), 3);
        let mut set = watch_set(&roots);
        set.sort();
        assert_eq!(set, [p("/r/app"), p("/wt/feat")]);
    }

    #[test]
    fn git_dir_outside_the_worktree_is_watched_separately() {
        let layout = RepoLayout {
            git_dir: p("/git/app.git"),
            worktrees: vec![(None, p("/r/app"))],
        };
        let mut set = watch_set(&desired_roots(&[("r_1".into(), layout)]));
        set.sort();
        assert_eq!(set, [p("/git/app.git"), p("/r/app")]);
    }
}
