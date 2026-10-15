//! Tree and workdir diffs, `FileChange` conversion, blob reads.

use git2::{Delta, Diff, DiffFindOptions, DiffOptions, Oid, Patch, Repository};

use crate::error::AppError;
use crate::model::{CommitChanges, FileChange, FileKind};

/// Where the right-hand side of a diff comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewSide {
    /// A tree: `newOid` is the blob id.
    Tree,
    /// The working tree: the content is read from disk, so `newOid` is always `null`.
    Workdir,
}

fn diff_options(workdir: bool) -> DiffOptions {
    let mut opts = DiffOptions::new();
    // Only counts are needed; no context makes patches cheaper.
    opts.context_lines(0)
        .include_typechange(true)
        .ignore_submodules(true);
    if workdir {
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
    }
    // Never `update_index`: it writes the index to disk.
    opts
}

pub fn find_renames(diff: &mut Diff) -> Result<(), AppError> {
    let mut find = DiffFindOptions::new();
    find.renames(true);
    diff.find_similar(Some(&mut find))?;
    Ok(())
}

/// Diff between the trees of two commits.
pub fn tree_diff<'r>(repo: &'r Repository, from: Oid, to: Oid) -> Result<Diff<'r>, AppError> {
    let from = repo.find_commit(from)?.tree()?;
    let to = repo.find_commit(to)?.tree()?;
    Ok(repo.diff_tree_to_tree(Some(&from), Some(&to), Some(&mut diff_options(false)))?)
}

/// Like `tree_diff`, limited to exactly `paths` (no glob matching).
pub fn tree_diff_paths<'r>(
    repo: &'r Repository,
    from: Oid,
    to: Oid,
    paths: &[String],
) -> Result<Diff<'r>, AppError> {
    let from = repo.find_commit(from)?.tree()?;
    let to = repo.find_commit(to)?.tree()?;
    let mut opts = diff_options(false);
    opts.disable_pathspec_match(true);
    for p in paths {
        opts.pathspec(p);
    }
    Ok(repo.diff_tree_to_tree(Some(&from), Some(&to), Some(&mut opts))?)
}

/// Diff from a commit's tree to the working tree of `wt_repo`, staged changes included.
pub fn workdir_diff(wt_repo: &Repository, from: Oid) -> Result<Diff<'_>, AppError> {
    // libgit2 does not notice on its own that the index changed on disk; this only re-reads it.
    wt_repo.index()?.read(false)?;
    let tree = wt_repo.find_commit(from)?.tree()?;
    Ok(wt_repo.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut diff_options(true)))?)
}

pub fn changes(diff: &Diff, side: NewSide) -> Result<Vec<FileChange>, AppError> {
    let mut out = Vec::new();
    for (i, delta) in diff.deltas().enumerate() {
        let kind = match delta.status() {
            Delta::Added | Delta::Copied => FileKind::A,
            Delta::Modified | Delta::Typechange => FileKind::M,
            Delta::Conflicted => FileKind::C,
            Delta::Renamed => FileKind::R,
            Delta::Deleted => FileKind::D,
            Delta::Untracked => FileKind::U,
            Delta::Unmodified | Delta::Ignored | Delta::Unreadable => continue,
        };
        let path_of = |f: git2::DiffFile| {
            f.path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        let path = if kind == FileKind::D {
            path_of(delta.old_file())
        } else {
            path_of(delta.new_file())
        };
        let old_path = matches!(delta.status(), Delta::Renamed | Delta::Copied)
            .then(|| path_of(delta.old_file()));
        let oid = |id: Oid| (!id.is_zero()).then(|| id.to_string());
        let old_oid = oid(delta.old_file().id());
        let new_oid = match side {
            NewSide::Tree => oid(delta.new_file().id()),
            // libgit2 may hash the file on disk, but that blob is not in the object database.
            NewSide::Workdir => None,
        };

        // Loading the patch also settles whether the file is binary.
        let (binary, add, del) = match Patch::from_diff(diff, i)? {
            Some(patch) if patch.delta().flags().is_binary() => (true, None, None),
            Some(patch) => {
                let (_, add, del) = patch.line_stats()?;
                (false, Some(add as u32), Some(del as u32))
            }
            None if delta.flags().is_binary() => (true, None, None),
            None => (false, Some(0), Some(0)),
        };

        out.push(FileChange {
            path,
            old_path,
            kind,
            add,
            del,
            binary,
            old_oid,
            new_oid,
        });
    }
    Ok(out)
}

/// Every path the diff touches; renames contribute both the old and the new path.
pub fn changed_paths(diff: &Diff) -> Vec<String> {
    let mut paths = Vec::new();
    for delta in diff.deltas() {
        for file in [delta.old_file(), delta.new_file()] {
            if let Some(p) = file.path() {
                let p = p.to_string_lossy().into_owned();
                if !paths.contains(&p) {
                    paths.push(p);
                }
            }
        }
    }
    paths
}

/// The paths a commit changed against its first parent (an empty tree for a root commit),
/// without patches or rename detection.
pub fn commit_paths(repo: &Repository, commit: &git2::Commit) -> Result<Vec<String>, AppError> {
    let from = match commit.parent(0) {
        Ok(p) => Some(p.tree()?),
        Err(_) => None,
    };
    let to = commit.tree()?;
    let diff = repo.diff_tree_to_tree(from.as_ref(), Some(&to), Some(&mut diff_options(false)))?;
    Ok(changed_paths(&diff))
}

/// Number of changed files, without generating patches.
pub fn delta_count(diff: &Diff) -> usize {
    diff.deltas()
        .filter(|d| {
            !matches!(
                d.status(),
                Delta::Unmodified | Delta::Ignored | Delta::Unreadable
            )
        })
        .count()
}

/// Files changed from commit `from` to commit `to`, renames detected.
pub fn committed_changes(
    repo: &Repository,
    from: &str,
    to: &str,
) -> Result<Vec<FileChange>, AppError> {
    let mut diff = tree_diff(repo, Oid::from_str(from)?, Oid::from_str(to)?)?;
    find_renames(&mut diff)?;
    changes(&diff, NewSide::Tree)
}

/// A commit's own changes: against its first parent (merge commits too), or against an empty
/// tree for a root commit. Renames detected.
pub fn commit_changes(repo: &Repository, sha: &str) -> Result<CommitChanges, AppError> {
    let commit = repo.find_commit(Oid::from_str(sha)?)?;
    let parent = commit.parent_id(0).ok();
    let from = match parent {
        Some(p) => Some(repo.find_commit(p)?.tree()?),
        None => None,
    };
    let to = commit.tree()?;
    let mut diff =
        repo.diff_tree_to_tree(from.as_ref(), Some(&to), Some(&mut diff_options(false)))?;
    find_renames(&mut diff)?;
    Ok(CommitChanges {
        sha: commit.id().to_string(),
        parent: parent.map(|p| p.to_string()),
        files: changes(&diff, NewSide::Tree)?,
    })
}

/// Files changed from commit `from` to the working tree of `wt_repo`, untracked included.
pub fn workdir_changes(wt_repo: &Repository, from: &str) -> Result<Vec<FileChange>, AppError> {
    let mut diff = workdir_diff(wt_repo, Oid::from_str(from)?)?;
    find_renames(&mut diff)?;
    changes(&diff, NewSide::Workdir)
}

/// Like `workdir_changes`, limited to exactly `paths`: the files that changed between `from` and
/// HEAD plus the uncommitted ones are the only candidates, so the rest of a large tree is skipped.
pub fn workdir_changes_paths(
    wt_repo: &Repository,
    from: &str,
    paths: &[String],
) -> Result<Vec<FileChange>, AppError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    wt_repo.index()?.read(false)?;
    let tree = wt_repo.find_commit(Oid::from_str(from)?)?.tree()?;
    let mut opts = diff_options(true);
    opts.disable_pathspec_match(true);
    for p in paths {
        opts.pathspec(p);
    }
    let mut diff = wt_repo.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut opts))?;
    find_renames(&mut diff)?;
    changes(&diff, NewSide::Workdir)
}

/// Size of a blob without loading its content.
pub fn blob_size(repo: &Repository, oid: &str) -> Result<usize, AppError> {
    Ok(repo.odb()?.read_header(Oid::from_str(oid)?)?.0)
}

pub fn blob_bytes(repo: &Repository, oid: &str) -> Result<Vec<u8>, AppError> {
    Ok(repo.find_blob(Oid::from_str(oid)?)?.content().to_vec())
}

fn head_diff(wt_repo: &Repository) -> Result<Diff<'_>, AppError> {
    let head = wt_repo.head()?.peel_to_commit()?.id();
    let mut diff = workdir_diff(wt_repo, head)?;
    find_renames(&mut diff)?;
    Ok(diff)
}

/// Uncommitted changes of a worktree: HEAD ↔ working tree, staged and untracked included.
pub fn uncommitted(wt_repo: &Repository) -> Result<Vec<FileChange>, AppError> {
    changes(&head_diff(wt_repo)?, NewSide::Workdir)
}

/// Same set as `uncommitted`, only counted.
pub fn uncommitted_count(wt_repo: &Repository) -> Result<usize, AppError> {
    Ok(delta_count(&head_diff(wt_repo)?))
}

/// Whether `git switch -c <new> <to>` in this worktree would refuse to carry its uncommitted
/// changes: a file changed here (staged, unstaged or untracked; a rename's old path too) also
/// differs between HEAD and `to`. Read only.
pub fn changes_block_switch(wt_repo: &Repository, to: Oid) -> Result<bool, AppError> {
    let head = wt_repo.head()?.peel_to_commit()?.id();
    if head == to {
        return Ok(false);
    }
    let paths: Vec<String> = uncommitted(wt_repo)?
        .into_iter()
        .flat_map(|c| std::iter::once(c.path).chain(c.old_path))
        .collect();
    if paths.is_empty() {
        return Ok(false);
    }
    Ok(tree_diff_paths(wt_repo, head, to, &paths)?.deltas().len() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;

    #[test]
    fn changes_block_switch_only_on_files_the_base_changes() {
        let t = TestRepo::new();
        let main = t.commit_on("main", &[("a", Some(b"a")), ("b", Some(b"b"))], "init", 3);
        t.branch_from("other", main);
        let other = t.commit_on("other", &[("b", Some(b"b2")), ("c", Some(b"c"))], "b c", 2);
        t.point_head("main");
        t.checkout_main();
        let block = |to| changes_block_switch(&t.repo, to).unwrap();
        assert!(!block(other));
        t.write_file(t.path(), "a", b"a2");
        assert!(!block(other));
        assert!(!block(main));
        t.write_file(t.path(), "b", b"b3");
        assert!(block(other));
        assert!(!block(main));
        t.write_file(t.path(), "b", b"b");
        t.write_file(t.path(), "c", b"mine");
        assert!(block(other));
    }

    fn find<'a>(changes: &'a [FileChange], path: &str) -> &'a FileChange {
        changes
            .iter()
            .find(|c| c.path == path)
            .unwrap_or_else(|| panic!("{path} not in {changes:?}"))
    }

    #[test]
    fn tree_diff_kinds_and_counts() {
        let t = TestRepo::new();
        let base = t.commit_on(
            "main",
            &[
                ("keep.txt", Some(b"a\nb\nc\n")),
                ("gone.txt", Some(b"bye\n")),
                ("old/name.txt", Some(b"one\ntwo\nthree\nfour\nfive\n")),
            ],
            "base",
            2,
        );
        t.branch_from("feature", base);
        let tip = t.commit_on(
            "feature",
            &[
                ("keep.txt", Some(b"a\nB\nc\nd\n")),
                ("gone.txt", None),
                ("old/name.txt", None),
                ("new/name.txt", Some(b"one\ntwo\nthree\nfour\nfive\n")),
                ("img.png", Some(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR")),
                ("dir with space/İçerik ğüş.md", Some(b"merhaba\n")),
            ],
            "change",
            1,
        );

        let mut diff = tree_diff(&t.repo, base, tip).unwrap();
        find_renames(&mut diff).unwrap();
        let c = changes(&diff, NewSide::Tree).unwrap();
        assert_eq!(c.len(), 5);

        let m = find(&c, "keep.txt");
        assert_eq!((m.kind, m.add, m.del), (FileKind::M, Some(2), Some(1)));
        assert!(m.old_oid.is_some() && m.new_oid.is_some());

        let d = find(&c, "gone.txt");
        assert_eq!((d.kind, d.add, d.del), (FileKind::D, Some(0), Some(1)));
        assert_eq!(d.new_oid, None);

        let r = find(&c, "new/name.txt");
        assert_eq!(r.kind, FileKind::R);
        assert_eq!(r.old_path.as_deref(), Some("old/name.txt"));
        assert_eq!((r.add, r.del), (Some(0), Some(0)));

        let b = find(&c, "img.png");
        assert_eq!(
            (b.kind, b.binary, b.add, b.del),
            (FileKind::A, true, None, None)
        );
        assert_eq!(b.old_oid, None);

        let u = find(&c, "dir with space/İçerik ğüş.md");
        assert_eq!((u.kind, u.add), (FileKind::A, Some(1)));

        assert_eq!(delta_count(&diff), 5);
        let paths = changed_paths(&diff);
        assert!(paths.contains(&"old/name.txt".to_string()));
        assert!(paths.contains(&"new/name.txt".to_string()));
    }

    #[test]
    fn commit_changes_against_first_parent() {
        let t = TestRepo::new();
        let root = t.commit_on(
            "main",
            &[
                ("a.txt", Some(b"1\n")),
                ("old.txt", Some(b"one\ntwo\nthree\nfour\n")),
            ],
            "root",
            3,
        );
        let second = t.commit_on(
            "main",
            &[
                ("a.txt", Some(b"1\n2\n")),
                ("old.txt", None),
                ("new.txt", Some(b"one\ntwo\nthree\nfour\n")),
            ],
            "second",
            2,
        );

        // Root commit: everything added, against an empty tree.
        let r = commit_changes(&t.repo, &root.to_string()).unwrap();
        assert_eq!(r.parent, None);
        assert_eq!(r.files.len(), 2);
        assert!(r
            .files
            .iter()
            .all(|f| f.kind == FileKind::A && f.old_oid.is_none()));

        // Only that commit's changes, rename detected.
        let c = commit_changes(&t.repo, &second.to_string()).unwrap();
        assert_eq!(c.parent, Some(root.to_string()));
        assert_eq!(c.files.len(), 2);
        let m = find(&c.files, "a.txt");
        assert_eq!((m.kind, m.add, m.del), (FileKind::M, Some(1), Some(0)));
        let rn = find(&c.files, "new.txt");
        assert_eq!(rn.kind, FileKind::R);
        assert_eq!(rn.old_path.as_deref(), Some("old.txt"));
    }

    #[test]
    fn commit_changes_of_a_merge_use_the_first_parent() {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 3);
        t.branch_from("side", base);
        t.commit_on("side", &[("side.txt", Some(b"side\n"))], "side", 2);
        let main = t.commit_on("main", &[("main.txt", Some(b"main\n"))], "main", 2);
        // The merge brings in side.txt and also edits a.txt itself.
        let merge = t.merge_on(
            "main",
            "side",
            &[("side.txt", Some(b"side\n")), ("a.txt", Some(b"a\nb\n"))],
            "merge side",
        );

        let c = commit_changes(&t.repo, &merge.to_string()).unwrap();
        assert_eq!(c.parent, Some(main.to_string()));
        let mut paths: Vec<_> = c.files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, ["a.txt", "side.txt"]);
        assert_eq!(find(&c.files, "side.txt").kind, FileKind::A);
    }

    #[test]
    fn tree_diff_paths_limits_to_exact_paths() {
        let t = TestRepo::new();
        let a = t.commit_on(
            "main",
            &[("a.txt", Some(b"1")), ("b.txt", Some(b"1"))],
            "a",
            2,
        );
        let b = t.commit_on(
            "main",
            &[("a.txt", Some(b"2")), ("b.txt", Some(b"2"))],
            "b",
            1,
        );
        let diff = tree_diff_paths(&t.repo, a, b, &["a.txt".into()]).unwrap();
        assert_eq!(delta_count(&diff), 1);
        // `*` is not a glob here.
        let diff = tree_diff_paths(&t.repo, a, b, &["*.txt".into()]).unwrap();
        assert_eq!(delta_count(&diff), 0);
    }

    #[test]
    fn workdir_changes_include_untracked_and_staged_but_not_ignored() {
        let t = TestRepo::new();
        let tip = t.commit_on(
            "main",
            &[
                (".gitignore", Some(b"build/\n")),
                ("src/a.ts", Some(b"a\n")),
                ("src/b.ts", Some(b"b\n")),
            ],
            "init",
            1,
        );
        t.branch_from("feature", tip);
        let wt = t.add_worktree("feature", "feature");
        t.write_file(&wt, "src/a.ts", b"a\nchanged\n");
        t.write_file(&wt, "notes/new file.md", b"one\ntwo\n");
        t.write_file(&wt, "build/out.js", b"ignored\n");
        t.write_file(&wt, "src/b.ts", b"b\nstaged\n");
        t.stage(&wt, "src/b.ts");

        let wt_repo = Repository::open(&wt).unwrap();
        let c = uncommitted(&wt_repo).unwrap();
        assert_eq!(c.len(), 3, "{c:?}");
        assert_eq!(find(&c, "src/a.ts").kind, FileKind::M);
        assert_eq!(find(&c, "src/b.ts").add, Some(1));
        let u = find(&c, "notes/new file.md");
        assert_eq!(
            (u.kind, u.add, u.old_oid.as_deref()),
            (FileKind::U, Some(2), None)
        );
        assert!(c.iter().all(|f| f.new_oid.is_none()));
        assert!(c.iter().all(|f| !f.path.starts_with("build/")));
        assert_eq!(uncommitted_count(&wt_repo).unwrap(), 3);
    }
}
