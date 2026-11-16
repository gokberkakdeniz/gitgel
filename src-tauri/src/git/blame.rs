//! Who last changed each line of a file (`git blame`).

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::Path;

use git2::{BlameOptions, Oid, Repository, RepositoryOpenFlags};

use crate::error::AppError;
use crate::model::{Blame, BlameCommit, BlameHunk};

/// The lines of `path` as `commit` has it, each run of them with the commit that last changed
/// it. With `content` (what the diff shows: the index's or the working tree's version) the lines
/// are that text's, and the ones `commit` does not have carry no commit. A file `commit` does not
/// have gives no hunks.
///
/// Opens the repository at `repo_path` on its own: a blame of a long history takes seconds, and
/// the pooled handle's lock would hold every other read of the repository up meanwhile.
pub fn blame(
    repo_path: &Path,
    commit: &str,
    path: &str,
    content: Option<&str>,
) -> Result<Blame, AppError> {
    let repo = Repository::open_ext(repo_path, RepositoryOpenFlags::NO_SEARCH, &[] as &[&OsStr])?;
    let mut options = BlameOptions::new();
    options.newest_commit(Oid::from_str(commit)?);
    let committed = match repo.blame_file(Path::new(path), Some(&mut options)) {
        Ok(b) => b,
        Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(Blame::default()),
        Err(e) => return Err(e.into()),
    };
    let buffered = match content {
        Some(text) => Some(committed.blame_buffer(text.as_bytes())?),
        None => None,
    };
    let blame = buffered.as_ref().unwrap_or(&committed);

    let mut out = Blame::default();
    let mut index: HashMap<Oid, u32> = HashMap::new();
    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        let commit = if oid.is_zero() {
            None
        } else if let Some(i) = index.get(&oid) {
            Some(*i)
        } else {
            let c = repo.find_commit(oid)?;
            let sha = oid.to_string();
            let message = String::from_utf8_lossy(c.message_bytes()).into_owned();
            out.commits.push(BlameCommit {
                short_sha: sha[..7].to_string(),
                sha,
                subject: message
                    .trim()
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .to_string(),
                author: String::from_utf8_lossy(c.author().name_bytes()).into_owned(),
                committed_at: c.time().seconds(),
            });
            let i = out.commits.len() as u32 - 1;
            index.insert(oid, i);
            Some(i)
        };
        let (start, lines) = (hunk.final_start_line() as u32, hunk.lines_in_hunk() as u32);
        // Neighbouring runs of the same commit read as one.
        match out.hunks.last_mut() {
            Some(last) if last.commit == commit && last.start + last.lines == start => {
                last.lines += lines
            }
            _ => out.hunks.push(BlameHunk {
                start,
                lines,
                commit,
            }),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testutil::TestRepo;

    fn subjects(b: &Blame) -> Vec<(u32, u32, Option<&str>)> {
        b.hunks
            .iter()
            .map(|h| {
                (
                    h.start,
                    h.lines,
                    h.commit.map(|i| b.commits[i as usize].subject.as_str()),
                )
            })
            .collect()
    }

    #[test]
    fn blames_each_line_on_its_commit() {
        let t = TestRepo::new();
        t.commit_on("main", &[("f", Some(b"a\nb\nc\nd\n"))], "first", 3);
        let mid = t.commit_on("main", &[("f", Some(b"a\nB\nc\nd\n"))], "second", 2);
        let tip = t.commit_on(
            "main",
            &[("f", Some(b"a\nB\nc\nd\ne\n"))],
            "third\n\nbody",
            1,
        );

        let b = blame(t.path(), &tip.to_string(), "f", None).unwrap();
        assert_eq!(
            subjects(&b),
            [
                (1, 1, Some("first")),
                (2, 1, Some("second")),
                (3, 2, Some("first")),
                (5, 1, Some("third"))
            ]
        );
        assert_eq!(b.commits.len(), 3);
        assert_eq!(b.commits[0].author, "Test");

        // At an older commit the newer ones are not there.
        let b = blame(t.path(), &mid.to_string(), "f", None).unwrap();
        assert_eq!(
            subjects(&b),
            [
                (1, 1, Some("first")),
                (2, 1, Some("second")),
                (3, 2, Some("first"))
            ]
        );
    }

    #[test]
    fn lines_not_committed_carry_no_commit() {
        let t = TestRepo::new();
        let tip = t.commit_on("main", &[("f", Some(b"a\nb\nc\n"))], "first", 1);
        let b = blame(t.path(), &tip.to_string(), "f", Some("a\nnew\nb\nc\n")).unwrap();
        assert_eq!(
            subjects(&b),
            [(1, 1, Some("first")), (2, 1, None), (3, 2, Some("first"))]
        );
    }

    #[test]
    fn a_file_the_commit_lacks_has_no_blame() {
        let t = TestRepo::new();
        let tip = t.commit_on("main", &[("f", Some(b"a\n"))], "first", 1);
        let b = blame(t.path(), &tip.to_string(), "nope", Some("x\n")).unwrap();
        assert!(b.hunks.is_empty());
    }
}
