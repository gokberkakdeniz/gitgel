// The History list (SPEC §16): Uncommitted, day labels, commits and the base line, in order.
import type { HistoryCommit } from '../../lib/types';

export type HistoryRow =
  | { kind: 'wip' }
  | { kind: 'day'; label: string }
  | { kind: 'base'; base: string; mergeBase: string | null }
  | { kind: 'commit'; commit: HistoryCommit };

/**
 * Rows for a page: the Uncommitted row first (when there is one), a day label whenever the day
 * changes, and the base line before the first commit already in the base (only when the branch
 * has commits of its own).
 */
export function historyRows(
  commits: HistoryCommit[],
  opts: { wip: boolean; base: string | null; ahead: number | null; mergeBase: string | null; now?: Date },
): HistoryRow[] {
  const now = opts.now ?? new Date();
  const rows: HistoryRow[] = opts.wip ? [{ kind: 'wip' }] : [];
  let day = '';
  let baseShown = !opts.base || !opts.ahead;
  for (const c of commits) {
    if (!baseShown && c.inBase) {
      rows.push({ kind: 'base', base: opts.base!, mergeBase: opts.mergeBase });
      baseShown = true;
    }
    const label = dayLabel(c.committedAt, now);
    if (label !== day) {
      rows.push({ kind: 'day', label });
      day = label;
    }
    rows.push({ kind: 'commit', commit: c });
  }
  return rows;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar days between the day of `unix` and today (0 = today, 1 = yesterday). */
function daysAgo(unix: number, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(unix * 1000))) / DAY_MS);
}

function monthDay(d: Date, now: Date): string {
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.getFullYear() === now.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

/** "Today", "Yesterday", "Oct 2" (this year) or "Oct 2, 2025". */
export function dayLabel(unix: number, now: Date = new Date()): string {
  const n = daysAgo(unix, now);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return monthDay(new Date(unix * 1000), now);
}

/** "today 11:42", "yesterday 11:42", "Oct 2, 11:42" (this year) or "Oct 2, 2025". */
export function whenLabel(unix: number, now: Date = new Date()): string {
  const d = new Date(unix * 1000);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const n = daysAgo(unix, now);
  if (n === 0) return `today ${time}`;
  if (n === 1) return `yesterday ${time}`;
  return d.getFullYear() === now.getFullYear() ? `${monthDay(d, now)}, ${time}` : monthDay(d, now);
}

export function isBot(author: string): boolean {
  return author.includes('[bot]');
}

/** The avatar's letters: "BOT" for a bot, else the first letters of the first two words. */
export function initials(author: string): string {
  if (isBot(author)) return 'BOT';
  const words = author.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toLocaleUpperCase('en-US')).join('') || '?';
}
