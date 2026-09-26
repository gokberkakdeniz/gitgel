//! Resolving a picked folder to its main repository (flow A2).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use git2::Repository;

use crate::git::refs::resolve_default_base;
use crate::model::{Config, DuplicateOf, FolderCheck, FolderKind, ResolvedVia};

/// Checks each picked folder in order. Repositories are opened temporarily, not pooled.
/// A folder whose main repository is already in `config`, or already appeared earlier in
/// `paths`, is reported as a duplicate.
pub fn inspect_folders(paths: &[String], config: &Config) -> Vec<FolderCheck> {
    let known: HashSet<PathBuf> = config
        .repos
        .iter()
        .map(|r| canonical(Path::new(&r.path)))
        .collect();
    let mut seen = HashSet::new();
    paths
        .iter()
        .map(|input| inspect_one(input, config, &known, &mut seen))
        .collect()
}

fn inspect_one(
    input: &str,
    config: &Config,
    known: &HashSet<PathBuf>,
    seen: &mut HashSet<PathBuf>,
) -> FolderCheck {
    let not_git = FolderCheck {
        input: input.to_string(),
        kind: FolderKind::NotGit,
        repo_path: None,
        via: None,
        duplicate_of: None,
        default_base: None,
    };
    let Ok(dir) = Path::new(input).canonicalize() else {
        return not_git;
    };
    if !dir.is_dir() {
        return not_git;
    }
    // `discover` searches upwards, so a subfolder resolves to its repository.
    let Ok(repo) = Repository::discover(&dir) else {
        return not_git;
    };
    if repo.is_bare() {
        return not_git;
    }
    let Some(main_root) = main_root(&repo) else {
        return not_git;
    };

    let via = if repo.is_worktree() {
        Some(ResolvedVia::Worktree)
    } else if repo.workdir().map(canonical).as_deref() != Some(dir.as_path()) {
        Some(ResolvedVia::Subdir)
    } else {
        None
    };
    let duplicate_of = if known.contains(&main_root) {
        Some(DuplicateOf::Config)
    } else if !seen.insert(main_root.clone()) {
        Some(DuplicateOf::Batch)
    } else {
        None
    };
    let kind = match (duplicate_of, via) {
        (Some(_), _) => FolderKind::Duplicate,
        (None, Some(_)) => FolderKind::Resolved,
        (None, None) => FolderKind::Repo,
    };
    let default_base = Repository::open(&main_root)
        .ok()
        .and_then(|main| resolve_default_base(&main, &config.settings.default_base_order))
        .map(|(name, _)| name);

    FolderCheck {
        input: input.to_string(),
        kind,
        repo_path: Some(main_root.to_string_lossy().into_owned()),
        via,
        duplicate_of,
        default_base,
    }
}

/// Root of the main working tree: the parent of the common `.git` dir, which a linked worktree
/// shares with its main repository.
fn main_root(repo: &Repository) -> Option<PathBuf> {
    let common = repo.commondir();
    let root = if common.file_name().is_some_and(|n| n == ".git") {
        common.parent()?.to_path_buf()
    } else {
        repo.workdir()?.to_path_buf()
    };
    Some(canonical(&root))
}

fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;
    use crate::model::RepoConfig;

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    fn repo_with_worktree() -> (TestRepo, PathBuf) {
        let t = TestRepo::new();
        let oid = t.commit_on("main", &[("src/a.ts", Some(b"a"))], "init", 1);
        t.checkout_main();
        t.branch_from("feature", oid);
        let wt = t.add_worktree("feature", "feature");
        (t, wt)
    }

    #[test]
    fn classifies_repo_worktree_subdir_and_plain_folder() {
        let (t, wt) = repo_with_worktree();
        let plain = t.root().join("plain");
        std::fs::create_dir(&plain).unwrap();
        let root = s(t.path());

        let checks = inspect_folders(
            &[
                s(t.path()),
                s(&wt),
                s(&t.path().join("src")),
                s(&plain),
                s(&t.root().join("missing")),
            ],
            &Config::default(),
        );

        assert_eq!(checks[0].kind, FolderKind::Repo);
        assert_eq!(checks[0].repo_path.as_deref(), Some(root.as_str()));
        assert_eq!(checks[0].via, None);
        assert_eq!(checks[0].default_base.as_deref(), Some("main"));

        // Both resolve to the repo that was already listed first.
        assert_eq!(checks[1].kind, FolderKind::Duplicate);
        assert_eq!(checks[1].via, Some(ResolvedVia::Worktree));
        assert_eq!(checks[1].duplicate_of, Some(DuplicateOf::Batch));
        assert_eq!(checks[1].repo_path.as_deref(), Some(root.as_str()));
        assert_eq!(checks[2].kind, FolderKind::Duplicate);
        assert_eq!(checks[2].via, Some(ResolvedVia::Subdir));

        assert_eq!(checks[3].kind, FolderKind::NotGit);
        assert_eq!(checks[3].repo_path, None);
        assert_eq!(checks[4].kind, FolderKind::NotGit);
    }

    #[test]
    fn worktree_and_subdir_resolve_to_main_root() {
        let (t, wt) = repo_with_worktree();
        let root = s(t.path());

        let from_wt = inspect_folders(&[s(&wt)], &Config::default());
        assert_eq!(from_wt[0].kind, FolderKind::Resolved);
        assert_eq!(from_wt[0].via, Some(ResolvedVia::Worktree));
        assert_eq!(from_wt[0].repo_path.as_deref(), Some(root.as_str()));

        let from_sub = inspect_folders(&[s(&t.path().join("src"))], &Config::default());
        assert_eq!(from_sub[0].kind, FolderKind::Resolved);
        assert_eq!(from_sub[0].via, Some(ResolvedVia::Subdir));
        assert_eq!(from_sub[0].repo_path.as_deref(), Some(root.as_str()));
    }

    #[test]
    fn same_folder_twice_in_a_batch() {
        let (t, _) = repo_with_worktree();
        let checks = inspect_folders(&[s(t.path()), s(t.path())], &Config::default());
        assert_eq!(checks[0].kind, FolderKind::Repo);
        assert_eq!(checks[1].kind, FolderKind::Duplicate);
        assert_eq!(checks[1].duplicate_of, Some(DuplicateOf::Batch));
        assert_eq!(checks[1].via, None);
    }

    #[test]
    fn already_configured_repo_is_a_duplicate() {
        let (t, wt) = repo_with_worktree();
        let mut config = Config::default();
        config.repos.push(RepoConfig {
            id: "r_1".into(),
            path: s(t.path()),
        });
        let checks = inspect_folders(&[s(&wt)], &config);
        assert_eq!(checks[0].kind, FolderKind::Duplicate);
        assert_eq!(checks[0].duplicate_of, Some(DuplicateOf::Config));
        assert_eq!(checks[0].via, Some(ResolvedVia::Worktree));
    }

    #[test]
    fn default_base_comes_from_origin_head() {
        let t = TestRepo::new();
        let oid = t.commit_on("main", &[("a", Some(b"a"))], "init", 0);
        t.branch_from("master", oid);
        t.set_origin_head("main");
        let mut config = Config::default();
        config.settings.default_base_order = vec!["master".into()];
        assert_eq!(
            inspect_folders(&[s(t.path())], &config)[0]
                .default_base
                .as_deref(),
            Some("master")
        );
        config.settings.default_base_order = vec!["origin/HEAD".into(), "master".into()];
        assert_eq!(
            inspect_folders(&[s(t.path())], &config)[0]
                .default_base
                .as_deref(),
            Some("main")
        );
    }
}
