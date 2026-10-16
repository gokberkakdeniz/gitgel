//! Merge-base, ahead count, revwalk, ancestry, stacked candidates.

use std::collections::{HashMap, HashSet};

use git2::{BranchType, ErrorCode, Oid, Repository, Sort};

use crate::error::AppError;
use crate::git::diff::{self, NewSide};
use crate::model::{CommitInfo, HistoryCommit, StackHint};

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
    // Commits of the entry not merged into the default base. Walking these (usually few)
    // commits replaces an ancestry check per branch, which is slow in long histories.
    let not_in_default: Option<HashSet<Oid>> = match default_tip {
        Some(d) if d == base_oid => Some(listed_set.clone()),
        Some(d) => Some(reachable(repo, tip_oid, d)?.into_iter().collect()),
        None => None,
    };

    let mut ranked: Vec<(StackHint, HashSet<Oid>)> = Vec::new();
    for branch in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = branch?;
        let (Ok(Some(name)), Some(c)) = (branch.name(), branch.get().target()) else {
            continue;
        };
        if Some(name) == entry_branch || c == tip_oid {
            continue;
        }
        // A branch sharing any listed commit is reachable from the tip and not from the base,
        // so its tip is itself a listed commit; it must not be merged into the default base.
        if !listed_set.contains(&c) || not_in_default.as_ref().is_some_and(|d| !d.contains(&c)) {
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

/// How a branch relates to the two forms of the default base (T13.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MbOrder {
    /// Both merge-bases are the same commit.
    Same,
    /// The remote's merge-base descends from the local's: the remote is nearer.
    RemoteNewer,
    LocalNewer,
    /// Neither descends from the other.
    Diverged,
}

/// Commits `tip` has on top of `candidate`, or `None` when they share no history.
pub fn ahead_of(repo: &Repository, tip: &str, candidate: &str) -> Result<Option<u32>, AppError> {
    let (tip, candidate) = (Oid::from_str(tip)?, Oid::from_str(candidate)?);
    match repo.merge_base(tip, candidate) {
        Ok(_) => Ok(Some(repo.graph_ahead_behind(tip, candidate)?.0 as u32)),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// `tip` against `other`: commits on each side and their merge-base; `None` when they share no
/// history.
pub fn ahead_behind(
    repo: &Repository,
    tip: &str,
    other: &str,
) -> Result<Option<(u32, u32, String)>, AppError> {
    let (tip, other) = (Oid::from_str(tip)?, Oid::from_str(other)?);
    let merge_base = match repo.merge_base(tip, other) {
        Ok(oid) => oid,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let (ahead, behind) = repo.graph_ahead_behind(tip, other)?;
    Ok(Some((ahead as u32, behind as u32, merge_base.to_string())))
}

/// How `tip`'s merge-bases with the local and the remote default relate. Only meaningful when
/// both share history with `tip`.
pub fn merge_base_order(
    repo: &Repository,
    tip: &str,
    local: &str,
    remote: &str,
) -> Result<MbOrder, AppError> {
    let tip = Oid::from_str(tip)?;
    let mb_local = repo.merge_base(tip, Oid::from_str(local)?)?;
    let mb_remote = repo.merge_base(tip, Oid::from_str(remote)?)?;
    Ok(if mb_local == mb_remote {
        MbOrder::Same
    } else if repo.graph_descendant_of(mb_remote, mb_local)? {
        MbOrder::RemoteNewer
    } else if repo.graph_descendant_of(mb_local, mb_remote)? {
        MbOrder::LocalNewer
    } else {
        MbOrder::Diverged
    })
}

/// Commits reachable from `tip` but not from `base`.
fn reachable(repo: &Repository, tip: Oid, base: Oid) -> Result<Vec<Oid>, AppError> {
    let mut walk = repo.revwalk()?;
    walk.push(tip)?;
    walk.hide(base)?;
    Ok(walk.collect::<Result<Vec<_>, _>>()?)
}

/// Which branch tips are merged into (reachable from) a base, remembered per repository so a
/// base that moved forward only needs its new commits walked.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MergedState {
    pub base: String,
    /// Tips answered at `base`.
    pub checked: HashSet<String>,
    /// The checked tips that are merged.
    pub merged: HashSet<String>,
}

/// Commit dates are not strictly ordered; walk this far past the oldest tip before giving up.
const DATE_SLACK: i64 = 86_400;

/// The merged walk reads a commit's date only every this many commits: a read parses the whole
/// commit into libgit2's object cache, which on a long history (vscode) cost a second and over
/// 100 MB. Walking up to this many commits past the cutoff is cheap.
const DATE_CHECK_EVERY: usize = 1024;

/// Answers "is this tip merged into `base`?" for every `(tip, commit time)`, reusing `prev`.
/// One history walk replaces an ancestry check per branch, which is slow in long histories.
pub fn merged_tips(
    repo: &Repository,
    base: &str,
    tips: &[(String, i64)],
    prev: Option<&MergedState>,
) -> Result<MergedState, AppError> {
    let base_oid = Oid::from_str(base)?;
    let mut state = MergedState {
        base: base.to_string(),
        ..MergedState::default()
    };
    match prev {
        Some(p) if p.base == base => {
            state.checked = p.checked.clone();
            state.merged = p.merged.clone();
        }
        // The base moved forward: only its new commits can merge more tips.
        Some(p)
            if repo
                .graph_descendant_of(base_oid, Oid::from_str(&p.base)?)
                .unwrap_or(false) =>
        {
            let new: HashSet<String> = reachable(repo, base_oid, Oid::from_str(&p.base)?)?
                .into_iter()
                .map(|o| o.to_string())
                .collect();
            state.checked = p.checked.clone();
            state.merged = p
                .checked
                .iter()
                .filter(|t| p.merged.contains(*t) || new.contains(*t))
                .cloned()
                .collect();
        }
        _ => {}
    }

    // Tips never answered: walk the base's history newest first until all are found or the
    // walk is older than the oldest of them.
    let mut unresolved: HashMap<Oid, (String, i64)> = HashMap::new();
    for (tip, time) in tips {
        if !state.checked.contains(tip) {
            unresolved.insert(Oid::from_str(tip)?, (tip.clone(), *time));
        }
    }
    if !unresolved.is_empty() {
        let cutoff = unresolved.values().map(|(_, t)| *t).min().unwrap_or(0) - DATE_SLACK;
        // Unsorted, so the walk can stop early: any sort mode first walks the whole graph (see
        // `walk`).
        let mut walk = repo.revwalk()?;
        walk.push(base_oid)?;
        let mut left = unresolved.len();
        for (i, oid) in walk.enumerate() {
            let oid = oid?;
            if let Some((tip, _)) = unresolved.get(&oid) {
                state.merged.insert(tip.clone());
                left -= 1;
                if left == 0 {
                    break;
                }
            }
            if i % DATE_CHECK_EVERY == 0 && repo.find_commit(oid)?.time().seconds() < cutoff {
                break;
            }
        }
        state
            .checked
            .extend(unresolved.into_values().map(|(tip, _)| tip));
    }

    // Forget branches that are gone.
    let current: HashSet<&String> = tips.iter().map(|(t, _)| t).collect();
    state.checked.retain(|t| current.contains(t));
    state.merged.retain(|t| current.contains(t));
    Ok(state)
}

/// What a branch adds on top of its base. Depends only on the two tips, so it is cached by
/// `(repo, tip, base)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedStats {
    /// `None`: tip and base have no common ancestor; the other fields are then zero.
    pub merge_base: Option<String>,
    pub ahead: u32,
    /// Base commits the branch does not have (it needs a rebase to catch up).
    pub behind: u32,
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
                behind: 0,
                files: 0,
                add: 0,
                del: 0,
                squash_merged: false,
            })
        }
        Err(e) => return Err(e.into()),
    };
    let (ahead, behind) = repo.graph_ahead_behind(tip, base)?;
    let (ahead, behind) = (ahead as u32, behind as u32);

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
        behind,
        files: changes.len() as u32,
        add,
        del,
        squash_merged,
    })
}

/// One page of a branch's history (§16).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Walked {
    pub commits: Vec<HistoryCommit>,
    /// The walk has more commits (or matches) past the page.
    pub more: bool,
}

/// What `base` does not hold of `tip`: the commits only on the tip side and the merge-base.
pub struct BaseSplit {
    pub ahead: HashSet<Oid>,
    pub merge_base: Option<String>,
}

pub fn base_split(repo: &Repository, tip: &str, base: &str) -> Result<BaseSplit, AppError> {
    let (tip, base) = (Oid::from_str(tip)?, Oid::from_str(base)?);
    let mut walk = repo.revwalk()?;
    walk.push(tip)?;
    walk.hide(base)?;
    let ahead = walk.collect::<Result<HashSet<_>, _>>()?;
    let merge_base = match repo.merge_base(tip, base) {
        Ok(oid) => Some(oid.to_string()),
        Err(e) if e.code() == ErrorCode::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    Ok(BaseSplit { ahead, merge_base })
}

/// Commits reachable from `tip`, newest first in `git log`'s order, at most `limit`. With
/// `terms` (lower-case words) only commits whose text or changed paths hold every term.
/// `ahead`: the commits not in the base; the others are `in_base`.
pub fn walk(
    repo: &Repository,
    tip: &str,
    ahead: Option<&HashSet<Oid>>,
    terms: &[String],
    limit: usize,
) -> Result<Walked, AppError> {
    // Unsorted: libgit2 then queues each commit's parents by committer date as it goes, which is
    // `git log`'s order. Any sort mode (`Sort::TIME` too) first walks the whole graph, a second
    // on vscode, before the first commit comes out.
    let mut walk = repo.revwalk()?;
    walk.push(Oid::from_str(tip)?)?;
    let mut commits = Vec::new();
    for oid in walk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        if !terms.is_empty() && !matches_terms(repo, &commit, terms)? {
            continue;
        }
        if commits.len() == limit {
            return Ok(Walked {
                commits,
                more: true,
            });
        }
        let in_base = ahead.is_some_and(|a| !a.contains(&oid));
        commits.push(history_commit(&commit, in_base));
    }
    Ok(Walked {
        commits,
        more: false,
    })
}

fn history_commit(commit: &git2::Commit, in_base: bool) -> HistoryCommit {
    let sha = commit.id().to_string();
    let message = String::from_utf8_lossy(commit.message_bytes()).into_owned();
    let (subject, body) = split_message(&message);
    let author = commit.author();
    HistoryCommit {
        short_sha: sha[..7].to_string(),
        sha,
        subject,
        body,
        author: String::from_utf8_lossy(author.name_bytes()).into_owned(),
        author_email: String::from_utf8_lossy(author.email_bytes()).into_owned(),
        committed_at: commit.time().seconds(),
        parents: commit.parent_count() as u32,
        in_base,
    }
}

/// The subject (the first paragraph, on one line, as git shows it) and the rest, trimmed.
fn split_message(message: &str) -> (String, String) {
    let message = message.trim();
    let (head, body) = message.split_once("\n\n").unwrap_or((message, ""));
    let subject = head.lines().map(str::trim).collect::<Vec<_>>().join(" ");
    (subject, body.trim().to_string())
}

/// Lower case, with `-`, `/`, `_`, `.` and white space as single spaces (the Branches filter
/// rule), so `token refresh` finds `token-refresh`.
pub fn search_words(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut space = true;
    for c in text.chars().flat_map(char::to_lowercase) {
        if c.is_whitespace() || matches!(c, '-' | '/' | '_' | '.') {
            if !space {
                out.push(' ');
                space = true;
            }
        } else {
            out.push(c);
            space = false;
        }
    }
    out.trim_end().to_string()
}

fn matches_terms(
    repo: &Repository,
    commit: &git2::Commit,
    terms: &[String],
) -> Result<bool, AppError> {
    let author = commit.author();
    let text = search_words(&format!(
        "{} {} {} {}",
        String::from_utf8_lossy(commit.message_bytes()),
        String::from_utf8_lossy(author.name_bytes()),
        String::from_utf8_lossy(author.email_bytes()),
        commit.id()
    ));
    let missing: Vec<&String> = terms
        .iter()
        .filter(|t| !text.contains(t.as_str()))
        .collect();
    if missing.is_empty() {
        return Ok(true);
    }
    // The paths are read only when the text alone does not match.
    let paths = search_words(&diff::commit_paths(repo, commit)?.join(" "));
    Ok(missing.iter().all(|t| paths.contains(t.as_str())))
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
    fn merged_tips_walks_once_and_follows_the_base() {
        let t = TestRepo::new();
        let root = t.commit_on("main", &[("a", Some(b"a"))], "init", 10);
        t.branch_from("done", root);
        let done = t.commit_on("done", &[("d", Some(b"d"))], "d", 9);
        t.set_branch("main", done); // fast-forward: `done` is merged
        let base1 = t.commit_on("main", &[("b", Some(b"b"))], "b", 8);
        t.branch_from("open", base1);
        let open = t.commit_on("open", &[("o", Some(b"o"))], "o", 7);
        let time = |oid: git2::Oid| t.repo.find_commit(oid).unwrap().time().seconds();
        let tips = vec![
            (done.to_string(), time(done)),
            (open.to_string(), time(open)),
        ];

        // First time: one walk answers both.
        let s1 = merged_tips(&t.repo, &base1.to_string(), &tips, None).unwrap();
        assert_eq!(s1.merged, HashSet::from([done.to_string()]));
        assert_eq!(s1.checked.len(), 2);

        // The base moves forward over `open`: only the new commits are looked at.
        t.set_branch("main", open);
        let base2 = t
            .commit_on("main", &[("c", Some(b"c"))], "c", 6)
            .to_string();
        let s2 = merged_tips(&t.repo, &base2, &tips, Some(&s1)).unwrap();
        assert_eq!(
            s2.merged,
            HashSet::from([done.to_string(), open.to_string()])
        );

        // Same base: answers are kept; branches that are gone are forgotten.
        let s3 = merged_tips(&t.repo, &base2, &tips[..1], Some(&s2)).unwrap();
        assert_eq!(s3.checked, HashSet::from([done.to_string()]));
        assert_eq!(s3.merged, HashSet::from([done.to_string()]));

        // A base that is not a descendant (reset) is answered from scratch.
        let s4 = merged_tips(&t.repo, &root.to_string(), &tips, Some(&s2)).unwrap();
        assert!(s4.merged.is_empty());
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
        assert_eq!((s.ahead, s.behind, s.files), (0, 0, 0));
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
        // Main got two commits after the branch started: the squash and a later one.
        assert_eq!((s.ahead, s.behind), (2, 2));
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

    fn subjects(w: &Walked) -> Vec<&str> {
        w.commits.iter().map(|c| c.subject.as_str()).collect()
    }

    #[test]
    fn history_walk_pages_newest_first() {
        let t = TestRepo::new();
        let root = t.commit_on("main", &[("a", Some(b"a"))], "init", 5);
        t.commit_on("main", &[("b", Some(b"b"))], "second\n\nwith a body\n", 3);
        let tip = t.commit_on("main", &[("c", Some(b"c"))], "third", 1);
        let tip = tip.to_string();

        let all = walk(&t.repo, &tip, None, &[], 200).unwrap();
        assert_eq!(subjects(&all), ["third", "second", "init"]);
        assert!(!all.more);
        assert_eq!(all.commits[1].body, "with a body");
        assert_eq!(all.commits[1].author_email, "test@example.com");
        assert_eq!(all.commits[2].parents, 0);
        assert_eq!(all.commits[2].sha, root.to_string());

        let page = walk(&t.repo, &tip, None, &[], 2).unwrap();
        assert_eq!(subjects(&page), ["third", "second"]);
        assert!(page.more);
    }

    #[test]
    fn history_marks_commits_in_the_base() {
        let t = TestRepo::new();
        let base = t.commit_on("main", &[("a", Some(b"a"))], "init", 5);
        t.branch_from("feature", base);
        t.commit_on("feature", &[("f", Some(b"f"))], "feature work", 2);
        t.commit_on("main", &[("m", Some(b"m"))], "main moves", 1);
        let tip = t.repo.revparse_single("feature").unwrap().id().to_string();
        let main = t.repo.revparse_single("main").unwrap().id().to_string();

        let split = base_split(&t.repo, &tip, &main).unwrap();
        assert_eq!(split.ahead.len(), 1);
        assert_eq!(split.merge_base, Some(base.to_string()));
        let w = walk(&t.repo, &tip, Some(&split.ahead), &[], 200).unwrap();
        let marks: Vec<_> = w
            .commits
            .iter()
            .map(|c| (c.subject.as_str(), c.in_base))
            .collect();
        assert_eq!(marks, [("feature work", false), ("init", true)]);
    }

    #[test]
    fn history_search_matches_text_sha_and_paths() {
        let t = TestRepo::new();
        t.commit_on("main", &[("README", Some(b"r"))], "init", 5);
        let fix = t.commit_on(
            "main",
            &[("src/auth/refresh.ts", Some(b"x"))],
            "Fix token-refresh",
            3,
        );
        t.commit_on(
            "main",
            &[("docs/guide.md", Some(b"g"))],
            "Write the guide",
            1,
        );
        t.merge_on("main", "main", &[], "Merge it");
        let tip = t.repo.revparse_single("main").unwrap().id().to_string();
        let find = |q: &str| {
            let terms: Vec<String> = search_words(q).split(' ').map(str::to_string).collect();
            let w = walk(&t.repo, &tip, None, &terms, 200).unwrap();
            subjects(&w)
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(find("token refresh"), ["Fix token-refresh"]);
        assert_eq!(find("guide.md"), ["Write the guide"]);
        assert_eq!(find("AUTH fix"), ["Fix token-refresh"]);
        assert_eq!(find(&fix.to_string()[..10]), ["Fix token-refresh"]);
        assert_eq!(find("test@example").len(), 4);
        assert!(find("nothing-like-this").is_empty());
        let merge = walk(&t.repo, &tip, None, &[], 1).unwrap();
        assert_eq!(merge.commits[0].parents, 2);
    }

    #[test]
    fn subject_joins_the_first_paragraph() {
        assert_eq!(
            split_message("Line one\nline two\n\nBody\n\nMore\n"),
            ("Line one line two".to_string(), "Body\n\nMore".to_string())
        );
        assert_eq!(split_message("Only\n"), ("Only".to_string(), String::new()));
    }
}
