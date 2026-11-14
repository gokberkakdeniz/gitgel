// Staging picked lines of a diff (SPEC §15 "Stage"): the changes Monaco shows, cut down to the
// lines picked, make the file's new staged version from the two texts on screen. Pure.
import type { Hunk } from './changeNav';

export type Side = 'original' | 'modified';

/** Lines picked in one editor: `from`–`to` (inclusive) of a side with `lines` lines. */
export interface LinePick {
  side: Side;
  from: number;
  to: number;
  lines: number;
}

/** Lines `s` up to `e` (exclusive); empty (s = e) is the place between lines s - 1 and s. */
interface Span {
  s: number;
  e: number;
}

/** A change to take: the original lines `o` become the modified lines `m`. */
export interface Cut {
  o: Span;
  m: Span;
}

const span = (start: number, end: number): Span =>
  end === 0 ? { s: start + 1, e: start + 1 } : { s: start, e: end + 1 };

/** The whole change. */
export const wholeCut = (h: Hunk): Cut => ({
  o: span(h.originalStart, h.originalEnd),
  m: span(h.modifiedStart, h.modifiedEnd),
});

/** The change with lines on `side` at `line`. */
export function hunkAt(hunks: Hunk[], side: Side, line: number): Hunk | null {
  return (
    hunks.find((h) => {
      const r = side === 'original' ? span(h.originalStart, h.originalEnd) : span(h.modifiedStart, h.modifiedEnd);
      return line >= r.s && line < r.e;
    }) ?? null
  );
}

/** Unified layout: the change whose removed lines are the view zone after modified line `after`. */
export function hunkAtZone(hunks: Hunk[], after: number): Hunk | null {
  return (
    hunks.find(
      (h) => h.originalEnd > 0 && (h.modifiedEnd === 0 ? h.modifiedStart === after : h.modifiedStart === after + 1),
    ) ?? null
  );
}

/** A missing file (an empty side: added, untracked or deleted) still shows one empty line, which
 * a change then replaces; its changes become pure insertions / deletions instead. */
export function withoutEmptySide(hunks: Hunk[], original: string, modified: string): Hunk[] {
  return hunks.map((h) => ({
    ...h,
    ...(original === '' && h.originalEnd > 0 && { originalStart: 0, originalEnd: 0 }),
    ...(modified === '' && h.modifiedEnd > 0 && { modifiedStart: 0, modifiedEnd: 0 }),
  }));
}

/** The changes the pick touches, each cut down to the picked lines. Where both sides of a change
 * have as many lines, the picked lines pair up one to one; otherwise the picked lines go with
 * the other side whole. A change with no lines on the picked side is taken whole when the pick
 * spans the place it sits at. */
export function cutHunks(hunks: Hunk[], pick: LinePick): Cut[] {
  const cuts: Cut[] = [];
  for (const h of hunks) {
    const whole = wholeCut(h);
    const [a, b] = pick.side === 'original' ? [whole.o, whole.m] : [whole.m, whole.o];
    let a2: Span;
    let b2: Span;
    if (a.s === a.e) {
      const above = Math.max(a.s - 1, 1);
      const below = Math.min(a.s, pick.lines);
      if (pick.from > above || pick.to < below) continue;
      a2 = a;
      b2 = b;
    } else {
      const s = Math.max(pick.from, a.s);
      const e = Math.min(pick.to + 1, a.e);
      if (s >= e) continue;
      a2 = { s, e };
      b2 = a.e - a.s === b.e - b.s ? { s: b.s + (s - a.s), e: b.s + (e - a.s) } : b;
    }
    cuts.push(pick.side === 'original' ? { o: a2, m: b2 } : { o: b2, m: a2 });
  }
  return cuts;
}

/** A text as Monaco numbers it: line i is `texts[i - 1]`, ended by `ends[i - 1]` (the last
 * line has no end). An empty text has no lines (Monaco's one empty line stands for nothing). */
function split(text: string): { texts: string[]; ends: string[] } {
  const texts: string[] = [];
  if (text === '') return { texts, ends: [] };
  const ends: string[] = [];
  const re = /\r\n|\r|\n/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    texts.push(text.slice(at, m.index));
    ends.push(m[0]);
    at = m.index + m[0].length;
  }
  texts.push(text.slice(at));
  return { texts, ends };
}

/** `base` with the cuts (base lines `o` → target lines `m`) applied. */
function apply(baseText: string, targetText: string, cuts: Cut[]): string {
  const base = split(baseText);
  const target = split(targetText);
  const eol = base.ends[0] ?? target.ends[0] ?? '\n';
  const out: { text: string; end: string | undefined }[] = [];
  const take = (from: typeof base, s: number, e: number) => {
    for (let i = s; i < e; i++) out.push({ text: from.texts[i - 1], end: from.ends[i - 1] });
  };
  let pos = 1;
  for (const c of [...cuts].sort((x, y) => x.o.s - y.o.s)) {
    take(base, pos, c.o.s);
    take(target, c.m.s, c.m.e);
    pos = c.o.e;
  }
  take(base, pos, base.texts.length + 1);
  // A line that was last in its text gets an end when another follows it.
  return out.map((l, i) => l.text + (l.end ?? (i === out.length - 1 ? '' : eol))).join('');
}

/** The file's new staged version. Staging (an Unstaged diff: index → working tree) applies the
 * cuts to the original; unstaging (a Staged diff: HEAD → index) takes them back out of the
 * modified. */
export function stagedContent(original: string, modified: string, cuts: Cut[], unstage: boolean): string {
  return unstage
    ? apply(
        modified,
        original,
        cuts.map((c) => ({ o: c.m, m: c.o })),
      )
    : apply(original, modified, cuts);
}
