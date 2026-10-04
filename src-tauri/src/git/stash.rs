//! Stashes, read from the `refs/stash` reflog (never `stash_foreach`, which needs a mutable
//! repository). The stack is shared by every worktree of a repository.

use git2::{Oid, Repository};

use crate::error::AppError;
use crate::git::diff::{self, NewSide};
use crate::model::{FileChange, FileKind, StashChanges};

/// One `stash@{n}` as the reflog records it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawStash {
    /// `n` in `stash@{n}`; 0 is the newest.
    pub index: u32,
    pub sha: String,
    /// "debug logging" for `On <branch>: debug logging`; the whole text for a `WIP on …` one.
    pub message: String,
    /// The branch it was taken on; `None` on a detached HEAD.
    pub branch: Option<String>,
    pub created_at: i64,
}

/// The stack, newest first; empty without `refs/stash`.
pub fn list(repo: &Repository) -> Result<Vec<RawStash>, AppError> {
    if repo.find_reference("refs/stash").is_err() {
        return Ok(Vec::new());
    }
    let reflog = repo.reflog("refs/stash")?;
    Ok(reflog
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let text = String::from_utf8_lossy(e.message_bytes().unwrap_or_default());
            let (branch, message) = parse_message(&text);
            RawStash {
                index: i as u32,
                sha: e.id_new().to_string(),
                message,
                branch,
                created_at: e.committer().when().seconds(),
            }
        })
        .collect())
}

/// The SHA `stash@{index}` points at now; `None` past the end of the stack. Checked before a
/// git action names a stash by its index (SPEC §15 "Writing stashes").
pub fn sha_at(repo: &Repository, index: u32) -> Result<Option<String>, AppError> {
    if repo.find_reference("refs/stash").is_err() {
        return Ok(None);
    }
    let reflog = repo.reflog("refs/stash")?;
    Ok(reflog.get(index as usize).map(|e| e.id_new().to_string()))
}

/// Splits `WIP on <branch>: <sha> <subject>` / `On <branch>: <message>`.
fn parse_message(msg: &str) -> (Option<String>, String) {
    let msg = msg.trim_end();
    let (rest, wip) = match (msg.strip_prefix("WIP on "), msg.strip_prefix("On ")) {
        (Some(rest), _) => (rest, true),
        (None, Some(rest)) => (rest, false),
        _ => return (None, msg.to_string()),
    };
    // A ref name cannot hold ':', so the first ": " ends the branch.
    let Some((branch, text)) = rest.split_once(": ") else {
        return (None, msg.to_string());
    };
    let branch = (branch != "(no branch)").then(|| branch.to_string());
    let message = if wip {
        msg.to_string()
    } else {
        text.to_string()
    };
    (branch, message)
}

/// What a stash holds, against the commit it was taken on (its first parent): the tracked
/// changes (staged and unstaged, as the working tree had them), then the untracked files when it
/// kept them (the third parent).
pub fn changes(repo: &Repository, sha: &str) -> Result<StashChanges, AppError> {
    let stash = repo.find_commit(Oid::from_str(sha)?)?;
    let base = stash.parent_id(0)?;
    let mut d = diff::tree_diff(repo, base, stash.id())?;
    diff::find_renames(&mut d)?;
    let mut files = diff::changes(&d, NewSide::Tree)?;
    if let Ok(untracked) = stash.parent(2) {
        let tree = untracked.tree()?;
        let d = repo.diff_tree_to_tree(None, Some(&tree), None)?;
        files.extend(
            diff::changes(&d, NewSide::Tree)?
                .into_iter()
                .map(|f| FileChange {
                    kind: FileKind::U,
                    ..f
                }),
        );
    }
    Ok(StashChanges {
        sha: stash.id().to_string(),
        base: base.to_string(),
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;

    #[test]
    fn parses_both_message_forms() {
        assert_eq!(
            parse_message("On session-token-refresh: debug logging"),
            (Some("session-token-refresh".into()), "debug logging".into())
        );
        assert_eq!(
            parse_message("WIP on feat/x: e02b7d1 Schedule rotation"),
            (
                Some("feat/x".into()),
                "WIP on feat/x: e02b7d1 Schedule rotation".into()
            )
        );
        assert_eq!(
            parse_message("WIP on (no branch): 71be0c2 Try"),
            (None, "WIP on (no branch): 71be0c2 Try".into())
        );
        assert_eq!(parse_message("odd"), (None, "odd".into()));
    }

    #[test]
    fn no_stash_ref_is_an_empty_stack() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 1);
        assert_eq!(list(&t.repo).unwrap(), Vec::new());
    }

    #[test]
    fn sha_at_follows_the_stack() {
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 1);
        t.checkout_main();
        assert_eq!(sha_at(&t.repo, 0).unwrap(), None);
        t.write_file(t.path(), "a.txt", b"one\n");
        let first = t.stash(false, "first");
        t.write_file(t.path(), "a.txt", b"two\n");
        let second = t.stash(false, "second");
        assert_eq!(sha_at(&t.repo, 0).unwrap(), Some(second.to_string()));
        assert_eq!(sha_at(&t.repo, 1).unwrap(), Some(first.to_string()));
        assert_eq!(sha_at(&t.repo, 2).unwrap(), None);
    }

    #[test]
    fn lists_newest_first_with_changes_and_untracked() {
        let t = TestRepo::new();
        let base = t.commit_on(
            "main",
            &[("a.txt", Some(b"a\n")), ("b.txt", Some(b"b\n"))],
            "base",
            1,
        );
        t.checkout_main();
        t.write_file(t.path(), "a.txt", b"a\nmore\n");
        t.stash(false, "first");
        t.write_file(t.path(), "b.txt", b"B\n");
        t.write_file(t.path(), "new.txt", b"new\n");
        t.stash(true, "second");

        let stack = list(&t.repo).unwrap();
        assert_eq!(stack.len(), 2);
        assert_eq!(stack[0].index, 0);
        assert_eq!(stack[0].message, "second");
        assert_eq!(stack[0].branch.as_deref(), Some("main"));
        assert_eq!(stack[1].message, "first");

        let c = changes(&t.repo, &stack[0].sha).unwrap();
        assert_eq!(c.base, base.to_string());
        let kinds: Vec<_> = c.files.iter().map(|f| (f.path.as_str(), f.kind)).collect();
        assert_eq!(kinds, [("b.txt", FileKind::M), ("new.txt", FileKind::U)]);
        // Both sides come from the object database.
        assert!(c.files.iter().all(|f| f.new_oid.is_some()));

        let c = changes(&t.repo, &stack[1].sha).unwrap();
        assert_eq!(c.files.len(), 1);
        assert_eq!((c.files[0].add, c.files[0].del), (Some(1), Some(0)));
    }
}
