//! Throwaway repositories for unit tests. Test-only: everything happens inside the test's own
//! `TempDir`, so the write APIs banned in `clippy.toml` are allowed here and nowhere else.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use git2::build::{CheckoutBuilder, TreeUpdateBuilder};
use git2::{BranchType, Commit, FileMode, Oid, Repository, Signature, Time, WorktreeAddOptions};
use tempfile::TempDir;

pub struct TestRepo {
    /// Canonical temp root; the repo lives in `root/repo`, worktrees in `root/wt-<name>`.
    root: PathBuf,
    workdir: PathBuf,
    pub repo: Repository,
    _dir: TempDir,
}

impl Default for TestRepo {
    fn default() -> Self {
        Self::new()
    }
}

impl TestRepo {
    /// A fresh non-bare repository whose HEAD points at (unborn) `main`.
    pub fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let workdir = root.join("repo");
        let repo = Repository::init(&workdir).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        TestRepo {
            root,
            workdir,
            repo,
            _dir: dir,
        }
    }

    /// Canonical path of the main working directory (no trailing slash).
    pub fn path(&self) -> &Path {
        &self.workdir
    }

    /// Temp root that holds the repo and its worktrees.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Commits on `branch` (created if missing, then with no parent). Each file is written
    /// (`Some`) or deleted (`None`) relative to the branch tip's tree. Only the ref moves; no
    /// working directory is touched.
    pub fn commit_on(
        &self,
        branch: &str,
        files: &[(&str, Option<&[u8]>)],
        msg: &str,
        days_ago: i64,
    ) -> Oid {
        self.commit_with(branch, None, files, msg, days_ago)
    }

    /// A merge commit on `branch` with `other`'s tip as second parent. The tree is `branch`'s
    /// with `files` applied (write the merged result explicitly).
    pub fn merge_on(
        &self,
        branch: &str,
        other: &str,
        files: &[(&str, Option<&[u8]>)],
        msg: &str,
    ) -> Oid {
        self.commit_with(branch, Some(other), files, msg, 1)
    }

    fn commit_with(
        &self,
        branch: &str,
        merge: Option<&str>,
        files: &[(&str, Option<&[u8]>)],
        msg: &str,
        days_ago: i64,
    ) -> Oid {
        let repo = &self.repo;
        let refname = format!("refs/heads/{branch}");
        let parent = repo
            .find_reference(&refname)
            .ok()
            .and_then(|r| r.peel_to_commit().ok());
        let base_tree = match &parent {
            Some(c) => c.tree().unwrap(),
            None => {
                let empty = repo.treebuilder(None).unwrap().write().unwrap();
                repo.find_tree(empty).unwrap()
            }
        };
        let mut update = TreeUpdateBuilder::new();
        for (path, content) in files {
            match content {
                Some(bytes) => {
                    let blob = repo.blob(bytes).unwrap();
                    update.upsert(*path, blob, FileMode::Blob);
                }
                None => {
                    update.remove(*path);
                }
            }
        }
        let tree = repo
            .find_tree(update.create_updated(repo, &base_tree).unwrap())
            .unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let sig = Signature::new(
            "Test",
            "test@example.com",
            &Time::new(now - days_ago * 86400, 0),
        )
        .unwrap();
        let other = merge.map(|b| {
            repo.find_reference(&format!("refs/heads/{b}"))
                .unwrap()
                .peel_to_commit()
                .unwrap()
        });
        let parents: Vec<&Commit> = parent.iter().chain(other.iter()).collect();
        repo.commit(Some(&refname), &sig, &sig, msg, &tree, &parents)
            .unwrap()
    }

    pub fn branch_from(&self, name: &str, oid: Oid) {
        let commit = self.repo.find_commit(oid).unwrap();
        self.repo.branch(name, &commit, false).unwrap();
    }

    /// Points a lightweight tag at `oid`, moving it if it exists.
    pub fn tag(&self, name: &str, oid: Oid) {
        self.repo
            .reference(&format!("refs/tags/{name}"), oid, true, "test")
            .unwrap();
    }

    /// Moves a branch to `oid` (simulates a fast-forward merge).
    pub fn set_branch(&self, name: &str, oid: Oid) {
        self.repo
            .reference(&format!("refs/heads/{name}"), oid, true, "test")
            .unwrap();
    }

    pub fn delete_branch(&self, name: &str) {
        self.repo
            .find_branch(name, BranchType::Local)
            .unwrap()
            .delete()
            .unwrap();
    }

    /// Creates `refs/remotes/origin/<branch>` at the local branch's tip and a symbolic
    /// `refs/remotes/origin/HEAD` pointing at it.
    pub fn set_origin_head(&self, branch: &str) {
        let tip = self
            .repo
            .find_branch(branch, BranchType::Local)
            .unwrap()
            .get()
            .target()
            .unwrap();
        let remote_ref = format!("refs/remotes/origin/{branch}");
        self.repo.reference(&remote_ref, tip, true, "test").unwrap();
        self.repo
            .reference_symbolic("refs/remotes/origin/HEAD", &remote_ref, true, "test")
            .unwrap();
    }

    /// Points the remote-tracking branch `name` (e.g. `origin/main`) at `oid`.
    pub fn set_remote(&self, name: &str, oid: Oid) {
        self.repo
            .reference(&format!("refs/remotes/{name}"), oid, true, "test")
            .unwrap();
    }

    /// Points the main HEAD at `branch` without touching the working directory.
    pub fn point_head(&self, branch: &str) {
        self.repo.set_head(&format!("refs/heads/{branch}")).unwrap();
    }

    /// Adds `origin` to the config (once).
    pub fn add_origin(&self) {
        if self.repo.find_remote("origin").is_err() {
            self.repo
                .remote("origin", "https://example.invalid/repo.git")
                .unwrap();
        }
    }

    /// Adds the remote `name` to the config.
    pub fn add_remote(&self, name: &str) {
        self.repo
            .remote(name, "https://example.invalid/other.git")
            .unwrap();
    }

    /// Sets `branch`'s upstream to the branch of the same name at `url`, as `gh pr checkout`
    /// does for a fork's branch.
    pub fn set_upstream_url(&self, branch: &str, url: &str) {
        let mut cfg = self.repo.config().unwrap();
        cfg.set_str(&format!("branch.{branch}.remote"), url)
            .unwrap();
        cfg.set_str(
            &format!("branch.{branch}.merge"),
            &format!("refs/heads/{branch}"),
        )
        .unwrap();
    }

    /// Makes `branch` track the remote-tracking branch `upstream` (e.g. `origin/main`).
    pub fn set_upstream(&self, branch: &str, upstream: &str) {
        // libgit2 needs the remote to exist in the config.
        self.add_origin();
        self.repo
            .find_branch(branch, BranchType::Local)
            .unwrap()
            .set_upstream(Some(upstream))
            .unwrap();
    }

    /// Fills the main working directory from HEAD.
    pub fn checkout_main(&self) {
        self.repo
            .checkout_head(Some(CheckoutBuilder::new().force()))
            .unwrap();
    }

    /// Adds a linked worktree at `root/wt-<name>` with `branch` checked out.
    pub fn add_worktree(&self, name: &str, branch: &str) -> PathBuf {
        let path = self.root.join(format!("wt-{name}"));
        let reference = self
            .repo
            .find_reference(&format!("refs/heads/{branch}"))
            .unwrap();
        let mut opts = WorktreeAddOptions::new();
        opts.reference(Some(&reference));
        self.repo.worktree(name, &path, Some(&opts)).unwrap();
        path
    }

    /// Adds a linked worktree at `root/wt-<name>` with a detached HEAD at `oid`.
    pub fn add_detached_worktree(&self, name: &str, oid: Oid) -> PathBuf {
        let temp = format!("tmp-detached-{name}");
        self.branch_from(&temp, oid);
        let path = self.add_worktree(name, &temp);
        let wt = Repository::open(&path).unwrap();
        wt.set_head_detached(oid).unwrap();
        wt.checkout_head(Some(CheckoutBuilder::new().force()))
            .unwrap();
        self.delete_branch(&temp);
        path
    }

    pub fn write_file(&self, dir: &Path, rel_path: &str, bytes: &[u8]) {
        let path = dir.join(rel_path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    /// Adds a file to the index of the worktree at `worktree_dir` and writes the index.
    pub fn stage(&self, worktree_dir: &Path, rel_path: &str) {
        let repo = Repository::open(worktree_dir).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(rel_path)).unwrap();
        index.write().unwrap();
    }

    /// What `git rebase` leaves when it stops in the worktree at `worktree_dir`: HEAD detached at
    /// `at`, and `rebase-merge/` naming the branch (`None`: a detached HEAD) and the progress.
    pub fn fake_rebase(
        &self,
        worktree_dir: &Path,
        branch: Option<&str>,
        at: Oid,
        step: u32,
        total: u32,
    ) {
        let repo = Repository::open(worktree_dir).unwrap();
        let dir = repo.path().join("rebase-merge");
        std::fs::create_dir_all(&dir).unwrap();
        let head = branch.map_or("detached HEAD".to_string(), |b| format!("refs/heads/{b}"));
        std::fs::write(dir.join("head-name"), format!("{head}\n")).unwrap();
        std::fs::write(dir.join("onto"), format!("{at}\n")).unwrap();
        std::fs::write(dir.join("msgnum"), format!("{step}\n")).unwrap();
        std::fs::write(dir.join("end"), format!("{total}\n")).unwrap();
        repo.set_head_detached(at).unwrap();
    }

    /// `git stash push -m <msg>` in the main working directory (`-u` with `untracked`).
    pub fn stash(&self, untracked: bool, msg: &str) -> Oid {
        let mut repo = Repository::open(&self.workdir).unwrap();
        let sig = Signature::now("Test", "test@example.com").unwrap();
        let flags = untracked.then_some(git2::StashFlags::INCLUDE_UNTRACKED);
        repo.stash_save(&sig, msg, flags).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_branch_with_a_worktree() {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a.txt", Some(b"a\n"))], "init", 3);
        t.branch_from("feature", base);
        t.commit_on("feature", &[("b.txt", Some(b"b\n"))], "add b", 2);
        let tip = t.commit_on("feature", &[("a.txt", None)], "drop a", 1);

        let feature = t.repo.find_commit(tip).unwrap();
        assert_eq!(feature.parent(0).unwrap().parent_id(0).unwrap(), base);
        let tree = feature.tree().unwrap();
        assert!(tree.get_name("b.txt").is_some());
        assert!(tree.get_name("a.txt").is_none());

        let wt = t.add_worktree("feature", "feature");
        assert!(wt.starts_with(t.root()));
        assert_eq!(std::fs::read(wt.join("b.txt")).unwrap(), b"b\n");
        assert!(!wt.join("a.txt").exists());
        let wt_repo = Repository::open(&wt).unwrap();
        assert!(wt_repo.is_worktree());
        assert_eq!(
            wt_repo.head().unwrap().name().unwrap(),
            "refs/heads/feature"
        );

        let detached = t.add_detached_worktree("old", base);
        let d = Repository::open(&detached).unwrap();
        assert!(d.head_detached().unwrap());
        assert_eq!(d.head().unwrap().target(), Some(base));
        assert!(t
            .repo
            .find_branch("tmp-detached-old", BranchType::Local)
            .is_err());
    }
}
