//! Merge-base, ahead count, revwalk, ancestry, stacked candidates.

use std::collections::{HashMap, HashSet};

use git2::{BranchType, ErrorCode, Oid, Repository, Sort};

use crate::error::AppError;
use crate::git::diff::{self, NewSide};
use crate::model::{CommitInfo, StackHint};

/// Commits reachable from `tip` but not from `base`, newest first (topological), at most `limit`.
pub fn commits(
    repo: &Repository,
    base: &str,
    tip: &str,
    limit: usize,
) -> Result<Vec<CommitInfo>, AppError> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    walk.push(Oid::from_str(tip)?)?;
    walk.hide(Oid::from_str(base)?)?;
    let mut out = Vec::new();
    for oid in walk.take(limit) {
        let commit = repo.find_commit(oid?)?;
        let sha = commit.id().to_string();
        out.push(CommitInfo {
            short_sha: sha[..7].to_string(),
            sha,
            subject: commit
                .summary()
                .ok()
                .flatten()
                .unwrap_or_default()
                .to_string(),
            committed_at: commit.time().seconds(),
            from_branch: None,
        });
    }
    Ok(out)
}

/// Whether `ancestor` is `descendant` or one of its ancestors.
pub fn is_ancestor(repo: &Repository, ancestor: &str, descendant: &str) -> Result<bool, AppError> {
    let (a, d) = (Oid::from_str(ancestor)?, Oid::from_str(descendant)?);
    Ok(a == d || repo.graph_descendant_of(d, a)?)
}

/// Branches that likely should be the base instead (a stacked branch): local branches reachable
/// from the entry's tip but not merged into the default base, ranked by how many of the listed
/// commits (tip minus base) they contain. Read-only equivalent of
/// `git for-each-ref refs/heads --merged=<tip> --no-merged=<default-base>`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Stack {
    /// `contains > 0`, most first.
    pub suggested: Vec<StackHint>,
    /// Listed commit SHA -> the first suggested branch that contains it.
    pub from_branch: HashMap<String, String>,
}

pub fn stack(
    repo: &Repository,
    entry_branch: Option<&str>,
    tip: &str,
    base: &str,
    default_base_tip: Option<&str>,
) -> Result<Stack, AppError> {
    let tip_oid = Oid::from_str(tip)?;
    let base_oid = Oid::from_str(base)?;
    let default_tip = default_base_tip.map(Oid::from_str).transpose()?;
    let listed = reachable(repo, tip_oid, base_oid)?;
    let listed_set: HashSet<Oid> = listed.iter().copied().collect();

    let mut ranked: Vec<(StackHint, HashSet<Oid>)> = Vec::new();
    for branch in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = branch?;
        let (Ok(Some(name)), Some(c)) = (branch.name(), branch.get().target()) else {
            continue;
        };
        if Some(name) == entry_branch || c == tip_oid {
            continue;
        }
        let from_tip = repo.graph_descendant_of(tip_oid, c)?;
        let merged = match default_tip {
            Some(d) => c == d || repo.graph_descendant_of(d, c)?,
            None => false,
        };
        if !from_tip || merged {
            continue;
        }
        let shared: HashSet<Oid> = reachable(repo, c, base_oid)?
            .into_iter()
            .filter(|o| listed_set.contains(o))
            .collect();
        if shared.is_empty() {
            continue;
        }
        ranked.push((
            StackHint {
                branch: name.to_string(),
                contains: shared.len() as u32,
                total: listed.len() as u32,
            },
            shared,
        ));
    }
    ranked.sort_by(|a, b| {
        b.0.contains
            .cmp(&a.0.contains)
            .then(a.0.branch.cmp(&b.0.branch))
    });

    let mut from_branch = HashMap::new();
    for oid in &listed {
        if let Some((hint, _)) = ranked.iter().find(|(_, set)| set.contains(oid)) {
            from_branch.insert(oid.to_string(), hint.branch.clone());
        }
    }
    Ok(Stack {
        suggested: ranked.into_iter().map(|(h, _)| h).collect(),
        from_branch,
    })
}

/// Commits reachable from `tip` but not from `base`.
fn reachable(repo: &Repository, tip: Oid, base: Oid) -> Result<Vec<Oid>, AppError> {
    let mut walk = repo.revwalk()?;
    walk.push(tip)?;
    walk.hide(base)?;
    Ok(walk.collect::<Result<Vec<_>, _>>()?)
}

/// What a branch adds on top of its base. Depends only on the two tips, so it is cached by
/// `(repo, tip, base)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedStats {
    /// `None`: tip and base have no common ancestor; the other fields are then zero.
    pub merge_base: Option<String>,
    pub ahead: u32,
    pub files: u32,
    pub add: u32,
    pub del: u32,
    /// The branch's changes are already in base although its commits are not (squash merge).
    pub squash_merged: bool,
}

pub fn committed_stats(
    repo: &Repository,
    tip: &str,
    base: &str,
) -> Result<CommittedStats, AppError> {
    let (tip, base) = (Oid::from_str(tip)?, Oid::from_str(base)?);
    let merge_base = match repo.merge_base(base, tip) {
        Ok(oid) => oid,
        Err(e) if e.code() == ErrorCode::NotFound => {
            return Ok(CommittedStats {
                merge_base: None,
                ahead: 0,
                files: 0,
                add: 0,
                del: 0,
                squash_merged: false,
            })
        }
        Err(e) => return Err(e.into()),
    };
    let ahead = repo.graph_ahead_behind(tip, base)?.0 as u32;

    let mut branch_diff = diff::tree_diff(repo, merge_base, tip)?;
    diff::find_renames(&mut branch_diff)?;
    let changes = diff::changes(&branch_diff, NewSide::Tree)?;
    let add = changes.iter().filter_map(|c| c.add).sum();
    let del = changes.iter().filter_map(|c| c.del).sum();

    // Squash merge: base already has the branch's version of every file the branch touched.
    let squash_merged = ahead > 0 && {
        let paths = diff::changed_paths(&branch_diff);
        !paths.is_empty()
            && diff::delta_count(&diff::tree_diff_paths(repo, base, tip, &paths)?) == 0
    };

    Ok(CommittedStats {
        merge_base: Some(merge_base.to_string()),
        ahead,
        files: changes.len() as u32,
        add,
        del,
        squash_merged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;

    #[test]
    fn commits_newest_first_excluding_base() {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a", Some(b"a"))], "init", 5);
        t.branch_from("feature", base);
        let mut shas = Vec::new();
        for (i, name) in ["one", "two", "three"].iter().enumerate() {
            shas.push(t.commit_on("feature", &[(name, Some(b"x"))], name, 3 - i as i64));
        }
        let main = t.commit_on("main", &[("m", Some(b"m"))], "main moves", 1);

        let list = commits(&t.repo, &main.to_string(), &shas[2].to_string(), 200).unwrap();
        let subjects: Vec<_> = list.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["three", "two", "one"]);
        assert_eq!(list[0].sha, shas[2].to_string());
        assert_eq!(list[0].short_sha.len(), 7);
        assert!(list[0].committed_at > list[2].committed_at);
        assert_eq!(
            commits(&t.repo, &main.to_string(), &shas[2].to_string(), 2)
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn stacked_branch_suggests_its_parent() {
        let t = TestRepo::new();
        let root = t.commit_on("master", &[("a", Some(b"a"))], "init", 10);
        t.branch_from("job-queue", root);
        for (i, f) in ["q1", "q2", "q3"].iter().enumerate() {
            t.commit_on("job-queue", &[(f, Some(b"q"))], f, 8 - i as i64);
        }
        let parent = t.repo.revparse_single("job-queue").unwrap().id();
        t.branch_from("rotation", parent);
        t.commit_on("rotation", &[("r1", Some(b"r"))], "r1", 3);
        let tip = t
            .commit_on("rotation", &[("r2", Some(b"r"))], "r2", 2)
            .to_string();
        // Unrelated and merged branches are not candidates.
        t.branch_from("other", root);
        t.commit_on("other", &[("o", Some(b"o"))], "o", 1);
        let master = root.to_string();

        let s = stack(&t.repo, Some("rotation"), &tip, &master, Some(&master)).unwrap();
        assert_eq!(
            s.suggested,
            [StackHint {
                branch: "job-queue".into(),
                contains: 3,
                total: 5
            }]
        );
        assert_eq!(s.from_branch.len(), 3);
        assert!(s.from_branch.values().all(|b| b == "job-queue"));

        // With the parent as base nothing is left to suggest.
        let s = stack(
            &t.repo,
            Some("rotation"),
            &tip,
            &parent.to_string(),
            Some(&master),
        )
        .unwrap();
        assert!(s.suggested.is_empty() && s.from_branch.is_empty());
    }

    #[test]
    fn ancestry() {
        let t = TestRepo::new();
        let a = t
            .commit_on("main", &[("a", Some(b"a"))], "a", 2)
            .to_string();
        let b = t
            .commit_on("main", &[("b", Some(b"b"))], "b", 1)
            .to_string();
        assert!(is_ancestor(&t.repo, &a, &b).unwrap());
        assert!(is_ancestor(&t.repo, &a, &a).unwrap());
        assert!(!is_ancestor(&t.repo, &b, &a).unwrap());
    }

    #[test]
    fn unmerged_branch_counts() {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a.txt", Some(b"1\n2\n"))], "init", 5);
        t.branch_from("feature", base);
        t.commit_on("feature", &[("a.txt", Some(b"1\nX\n3\n"))], "edit", 3);
        let tip = t.commit_on("feature", &[("b.txt", Some(b"new\n"))], "add", 2);
        // main moves on independently.
        let main = t.commit_on("main", &[("c.txt", Some(b"c\n"))], "main", 1);

        let s = committed_stats(&t.repo, &tip.to_string(), &main.to_string()).unwrap();
        assert_eq!(s.merge_base, Some(base.to_string()));
        assert_eq!((s.ahead, s.files, s.add, s.del), (2, 2, 3, 1));
        assert!(!s.squash_merged);
    }

    #[test]
    fn fast_forwarded_branch_is_not_ahead() {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a", Some(b"a"))], "init", 3);
        t.branch_from("feature", base);
        let tip = t.commit_on("feature", &[("b", Some(b"b"))], "b", 2);
        t.set_branch("main", tip);
        let s = committed_stats(&t.repo, &tip.to_string(), &tip.to_string()).unwrap();
        assert_eq!((s.ahead, s.files), (0, 0));
    }

    #[test]
    fn squash_merged_branch_is_detected() {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a", Some(b"a\n"))], "init", 5);
        t.branch_from("feature", base);
        t.commit_on("feature", &[("b", Some(b"b\n"))], "b", 4);
        let tip = t.commit_on("feature", &[("a", Some(b"A\n"))], "a", 3);
        // One commit on main with the same result, plus an unrelated later change.
        t.commit_on(
            "main",
            &[("a", Some(b"A\n")), ("b", Some(b"b\n"))],
            "squash",
            2,
        );
        let main = t.commit_on("main", &[("z", Some(b"z\n"))], "later", 1);

        let s = committed_stats(&t.repo, &tip.to_string(), &main.to_string()).unwrap();
        assert_eq!(s.ahead, 2);
        assert!(s.squash_merged);
    }

    #[test]
    fn unrelated_histories_have_no_merge_base() {
        let t = TestRepo::new();
        let main = t.commit_on("main", &[("a", Some(b"a"))], "a", 1);
        let orphan = t.commit_on("orphan", &[("b", Some(b"b"))], "b", 1);
        let s = committed_stats(&t.repo, &orphan.to_string(), &main.to_string()).unwrap();
        assert_eq!(s.merge_base, None);
    }
}
