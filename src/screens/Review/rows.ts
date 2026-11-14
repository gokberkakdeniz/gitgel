// Review's list of one branch (SPEC §5, §16): Uncommitted, the commits, the origin line and the
// base line, in order.
import { getLocale, t } from '../../i18n';
import { formatDate, formatDateTime, getFmt } from '../../lib/format';
import type { HistoryCommit, Upstream } from '../../lib/types';

export type HistoryRow =
  | { kind: 'wip' }
  /** Above the newest commit the remote has, when newer ones are not pushed: `remote` names the
   * remote-tracking branch, `pushed` counts the branch's own commits it has. */
  | { kind: 'origin'; remote: string; pushed: number }
  /** After the branch's own commits; `mergeBase` is the newest commit already in the base. */
  | { kind: 'base'; base: string; mergeBase: string }
  | { kind: 'commit'; commit: HistoryCommit };

/**
 * Rows for a page: the Uncommitted row first (when there is one), the commits, the origin line
 * above the newest commit the upstream has (only when some above it are not pushed) and the base
 * line before the first commit already in the base (only when the branch has commits of its own).
 */
export function historyRows(
  commits: HistoryCommit[],
  opts: { wip: boolean; base: string | null; ahead: number | null; upstream?: Upstream | null },
): HistoryRow[] {
  const rows: HistoryRow[] = opts.wip ? [{ kind: 'wip' }] : [];
  const up = opts.upstream;
  const pushedAt = up?.name && up.mergeBase ? commits.findIndex((c) => c.sha === up.mergeBase) : -1;
  let baseShown = !opts.base || !opts.ahead;
  commits.forEach((c, i) => {
    if (i === pushedAt && i > 0) {
      const pushed = commits.slice(i).findIndex((x) => x.inBase);
      // None of the branch's own commits are on the remote: the line would sit on the base line
      // (a branch based on its own upstream, `master` on `origin/master`), which says it already.
      const onBase = pushed === 0 && !baseShown;
      if (!onBase) rows.push({ kind: 'origin', remote: up!.name!, pushed: pushed < 0 ? commits.length - i : pushed });
    }
    if (!baseShown && c.inBase) {
      rows.push({ kind: 'base', base: opts.base!, mergeBase: c.shortSha });
      baseShown = true;
    }
    rows.push({ kind: 'commit', commit: c });
  });
  return rows;
}

/** The rows a line picks (SPEC §5 "List column"): the origin line Uncommitted and what is not
 * pushed, the base line Uncommitted and every commit of the branch. */
export function lineRows(rows: HistoryRow[], line: 'origin' | 'base'): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.kind === line) return out;
    if (r.kind === 'wip') out.push('wip');
    if (r.kind === 'commit') out.push(r.commit.sha);
  }
  return [];
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar days between the day of `unix` and today (0 = today, 1 = yesterday). */
function daysAgo(unix: number, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(unix * 1000))) / DAY_MS);
}

/** The date locale: Turkish names in Turkish, otherwise exactly as before (en-US / en-GB). */
function dateLocaleTag(): 'tr' | 'en-US' {
  return getLocale() === 'tr' ? 'tr' : 'en-US';
}

function monthDay(d: Date, now: Date): string {
  const md = d.toLocaleDateString(dateLocaleTag(), { month: 'short', day: 'numeric' });
  return d.getFullYear() === now.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

/** "Today", "Yesterday", "Oct 2" (this year) or "Oct 2, 2025"; absolute mode always dates. */
export function dayLabel(unix: number, now: Date = new Date()): string {
  if (getFmt().absolute) return formatDate(unix);
  const n = daysAgo(unix, now);
  if (n === 0) return t('history.dayToday');
  if (n === 1) return t('history.dayYesterday');
  return monthDay(new Date(unix * 1000), now);
}

/** "today 11:42", "yesterday 11:42", "Oct 2, 11:42" (this year) or "Oct 2, 2025"; absolute mode dates. */
export function whenLabel(unix: number, now: Date = new Date()): string {
  if (getFmt().absolute) return formatDateTime(unix);
  const d = new Date(unix * 1000);
  const time = d.toLocaleTimeString(getLocale() === 'tr' ? 'tr' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const n = daysAgo(unix, now);
  if (n === 0) return t('history.whenToday', { time });
  if (n === 1) return t('history.whenYesterday', { time });
  return d.getFullYear() === now.getFullYear() ? `${monthDay(d, now)}, ${time}` : monthDay(d, now);
}

export function isBot(author: string): boolean {
  return author.includes('[bot]');
}

/** The avatar's letters: "BOT" for a bot, else the first letters of the first two words. */
export function initials(author: string): string {
  if (isBot(author)) return 'BOT';
  const words = author.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => w[0].toLocaleUpperCase('en-US'))
      .join('') || '?'
  );
}
