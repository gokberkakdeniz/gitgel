// Review file filter (flow D8): which files match the typed text, and what to highlight. Pure.
import type { FileChange } from '../../lib/types';

/** The typed text as lowercase terms, split on spaces. */
export function filterTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every term appears in the path (`dir/name`) or, for a rename, in the old path. */
export function fileMatches(f: Pick<FileChange, 'path' | 'oldPath'>, terms: string[]): boolean {
  const path = f.path.toLowerCase();
  const old = f.oldPath?.toLowerCase() ?? '';
  return terms.every((t) => path.includes(t) || old.includes(t));
}

/** The first term found in `text` (in term order), split as [before, hit, after]. */
export function firstHit(text: string, terms: string[]): [string, string, string] | null {
  const low = text.toLowerCase();
  for (const t of terms) {
    const at = low.indexOf(t);
    if (at >= 0) return [text.slice(0, at), text.slice(at, at + t.length), text.slice(at + t.length)];
  }
  return null;
}
