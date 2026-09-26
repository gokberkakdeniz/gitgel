import type { BaseOptions } from '../../lib/types';

export type BaseSection = 'Suggested' | 'Default' | 'Other branches' | 'Tags' | 'Commit';

export interface BaseRow {
  section: BaseSection;
  /** What gets saved as the base. */
  value: string;
  label: string;
  /** Second line (Suggested) or right-hand note. */
  sub?: string;
  note?: string;
}

/** Menu rows for the filter text `q`. Tags only show up when filtering. */
export function baseRows(o: BaseOptions, q: string): BaseRow[] {
  const query = q.trim().toLowerCase();
  const match = (name: string) => !query || name.toLowerCase().includes(query);
  const rows: BaseRow[] = [];
  const suggestedNames = new Set(o.suggested.map((s) => s.branch));

  for (const s of o.suggested) {
    if (match(s.branch)) {
      rows.push({
        section: 'Suggested',
        value: s.branch,
        label: s.branch,
        sub: `Contains ${s.contains} of the ${s.total} commits shown`,
      });
    }
  }
  if (o.default && match(o.default.name)) {
    const current = o.current === o.default.name;
    rows.push({
      section: 'Default',
      value: o.default.name,
      label: o.default.name,
      note: current ? `current · from ${o.default.source}` : `from ${o.default.source}`,
    });
  }
  for (const b of o.branches) {
    if (b === o.default?.name || suggestedNames.has(b) || !match(b)) continue;
    rows.push({ section: 'Other branches', value: b, label: b, note: b === o.current ? 'current' : undefined });
  }
  if (query) {
    for (const t of o.tags) {
      if (match(t)) rows.push({ section: 'Tags', value: t, label: t, note: t === o.current ? 'current' : undefined });
    }
  }
  return rows;
}

/** Text that could be a commit SHA (7–40 hex characters). */
export function looksLikeSha(q: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(q.trim());
}
