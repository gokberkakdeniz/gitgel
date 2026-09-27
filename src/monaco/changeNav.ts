// Jumping between the changes of a diff and on into the neighbouring files (flow D4). Pure.

/** A change (hunk) of the diff, in both editors' line numbers (end 0: no lines on that side). */
export interface Hunk {
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
}

/** Where a jump lands: the editor side and line that start the hunk. */
export function hunkTarget(h: Hunk, unified = false): { side: 'original' | 'modified'; line: number } {
  // Unified shows only the modified editor (removed lines are zones in it): a deletion lands
  // on the line it sits at. Split lands a deletion on its first removed line.
  if (unified) return { side: 'modified', line: Math.max(1, h.modifiedStart) };
  return h.modifiedEnd === 0
    ? { side: 'original', line: h.originalStart }
    : { side: 'modified', line: h.modifiedStart };
}

export interface NavState {
  /** Current hunk (null before the first jump). */
  index: number | null;
  count: number;
  /** Flat file list: groups in order, then their files (collapsed groups included; only the
   * files the filter shows). */
  files: string[];
  /** -1: the current file is not in the list (filtered out). */
  fileIndex: number;
}

export type NavStep =
  | { kind: 'hunk'; index: number }
  | { kind: 'file'; key: string; land: 'first' | 'last' }
  | null;

export function next(s: NavState): NavStep {
  const i = s.index ?? -1;
  if (i + 1 < s.count) return { kind: 'hunk', index: i + 1 };
  const key = s.files[s.fileIndex + 1];
  return key ? { kind: 'file', key, land: 'first' } : null;
}

export function prev(s: NavState): NavStep {
  const i = s.index ?? 0;
  if (s.count > 0 && i > 0) return { kind: 'hunk', index: Math.min(i, s.count) - 1 };
  // From a file not in the list (filtered out), go to the last listed one.
  const key = s.fileIndex >= 0 ? s.files[s.fileIndex - 1] : s.files[s.files.length - 1];
  return key ? { kind: 'file', key, land: 'last' } : null;
}

/**
 * The hunk that counts as current after scrolling by hand: the first one ending at or after the
 * first visible line (modified side); past the last, the last one.
 */
export function hunkAtScroll(hunks: Hunk[], firstVisibleLine: number): number | null {
  if (hunks.length === 0) return null;
  const i = hunks.findIndex((h) => Math.max(h.modifiedEnd, h.modifiedStart) >= firstVisibleLine);
  return i >= 0 ? i : hunks.length - 1;
}
