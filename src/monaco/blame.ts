// Blame of the diff's new side (SPEC §5 "Blame"): the commit behind a line and the text shown
// after it.
import { t } from '../i18n';
import { agoText } from '../lib/format';
import type { Blame, BlameCommit } from '../lib/types';

/** The longest subject shown after a line. */
const SUBJECT = 72;

/** The commit that last changed `line` (from 1); null: not committed yet; undefined: the blame
 * does not reach the line. */
export function blameAt(blame: Blame, line: number): BlameCommit | null | undefined {
  const hunk = blame.hunks.find((h) => line >= h.start && line < h.start + h.lines);
  if (!hunk) return undefined;
  return hunk.commit === null ? null : (blame.commits[hunk.commit] ?? undefined);
}

/** `Ada, 3d ago · Fix the token refresh`. */
export function blameText(commit: BlameCommit | null, now?: number): string {
  if (!commit) return t('diff.notCommitted');
  const subject = commit.subject.length > SUBJECT ? `${commit.subject.slice(0, SUBJECT - 1)}…` : commit.subject;
  return `${commit.author}, ${agoText(commit.committedAt, now)} · ${subject}`;
}
