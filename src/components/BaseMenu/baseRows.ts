import type { BaseCandidate, BaseOptions } from '../../lib/types';

export type BaseSection = 'Suggested' | 'Default' | 'Other Branches' | 'Remote Branches' | 'Tags' | 'Commit';

export interface BaseRow {
  section: BaseSection;
  /** What gets saved as the base; the Automatic row saves none. */
  value: string;
  label: string;
  /** Second line (Suggested, Automatic) or right-hand note. */
  sub?: string;
  note?: string;
  /** The Automatic row: picking it clears the stored base. */
  auto?: boolean;
  /** The base in use: the stored base, else Automatic. Shown as a check. */
  selected?: boolean;
  /** No common ancestor with the entry: shown, not choosable. */
  disabled?: boolean;
}

export const AUTO_TITLE = 'Uses whichever of the two shares the most history with this branch';

const commits = (n: number) => `${n} ${n === 1 ? 'commit' : 'commits'}`;

function candidateNote(c: BaseCandidate): string | undefined {
  if (c.unrelated) return 'no common ancestor';
  if (c.sameAs) return `same as ${c.sameAs}`;
  return c.ahead === null ? undefined : commits(c.ahead);
}

/**
 * Menu rows for the filter text `q`. `custom`: the entry has a stored base (`o.current`);
 * `branch`: the entry's own branch name. Tags only show up when filtering.
 */
export function baseRows(o: BaseOptions, q: string, custom: boolean, branch: string | null): BaseRow[] {
  const query = q.trim().toLowerCase();
  const match = (name: string) => !query || name.toLowerCase().includes(query);
  const rows: BaseRow[] = [];
  const suggestedNames = new Set(o.suggested.map((s) => s.branch));
  const candidates = o.defaults?.candidates ?? [];
  const defaultNames = new Set(candidates.map((c) => c.name));
  const stored = (name: string) => custom && name === o.current;

  for (const s of o.suggested) {
    if (match(s.branch)) {
      rows.push({
        section: 'Suggested',
        value: s.branch,
        label: s.branch,
        sub: `Contains ${s.contains} of the ${s.total} commits shown`,
        selected: stored(s.branch),
      });
    }
  }
  if (o.defaults) {
    const picked = candidates.find((c) => c.auto);
    if (match('automatic') || (picked && match(picked.name))) {
      rows.push({
        section: 'Default',
        value: '',
        label: 'Automatic',
        sub: picked ? `uses ${picked.name}` : undefined,
        note: picked?.ahead != null ? commits(picked.ahead) : undefined,
        auto: true,
        selected: !custom,
      });
    }
    // The forms themselves only when there is a choice between two.
    if (candidates.length > 1) {
      for (const c of candidates) {
        if (!match(c.name)) continue;
        rows.push({
          section: 'Default',
          value: c.name,
          label: c.name,
          note: candidateNote(c),
          selected: stored(c.name),
          disabled: c.unrelated,
        });
      }
    }
  }
  for (const b of o.branches) {
    if (defaultNames.has(b) || suggestedNames.has(b) || !match(b)) continue;
    rows.push({ section: 'Other Branches', value: b, label: b, selected: stored(b) });
  }
  // The backend lists the remote branch with the entry's own name first.
  for (const r of o.remotes) {
    if (!match(r)) continue;
    const sameName = branch !== null && r.slice(r.indexOf('/') + 1) === branch;
    rows.push({ section: 'Remote Branches', value: r, label: r, note: sameName ? 'same name' : undefined, selected: stored(r) });
  }
  if (query) {
    for (const t of o.tags) {
      if (match(t)) rows.push({ section: 'Tags', value: t, label: t, selected: stored(t) });
    }
  }
  return rows;
}

/** The row the menu opens on: the checked one, else the first that can be chosen. */
export function initialRow(rows: BaseRow[]): number {
  const at = rows.findIndex((r) => r.selected && !r.disabled);
  return at >= 0 ? at : Math.max(0, rows.findIndex((r) => !r.disabled));
}

/** Text that could be a commit SHA (7–40 hex characters). */
export function looksLikeSha(q: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(q.trim());
}
