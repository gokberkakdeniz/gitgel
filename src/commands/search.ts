// The palette's search: fuse.js over each row, groups kept together.
import Fuse from 'fuse.js';
import type { Command, GoItem } from './registry';

/** Rows of a group that is listed only while searching, at most. */
export const SEARCH_ONLY_LIMIT = 50;

/** Groups in the order of their first row; with scores, the group of the best match first. */
function grouped<T extends { group: string }>(rows: T[]): T[] {
  const order: string[] = [];
  const by = new Map<string, T[]>();
  for (const r of rows) {
    if (!by.has(r.group)) {
      order.push(r.group);
      by.set(r.group, []);
    }
    by.get(r.group)!.push(r);
  }
  return order.flatMap((g) => by.get(g)!);
}

const fuseOptions = { threshold: 0.35, ignoreLocation: true };

/** What a query's first character asks for (`?` lists these). Git refuses `~` and `?` in a
 * branch name and `/` at its start; `#` and `>` rarely start one. */
export const PREFIXES = [
  { prefix: '>', mode: 'commands' },
  { prefix: '#', mode: 'go', kinds: ['project'] },
  { prefix: '~', mode: 'go', kinds: ['worktree'] },
  { prefix: '/', mode: 'go', kinds: ['worktree', 'branch'] },
] as const satisfies readonly { prefix: string; mode: 'commands' | 'go'; kinds?: readonly GoItem['kind'][] }[];

export type Prefix = (typeof PREFIXES)[number]['prefix'];

export interface ParsedQuery {
  mode: 'go' | 'commands' | 'help';
  /** Only places of these kinds (a `#`, `~` or `/` query). */
  kinds: readonly GoItem['kind'][] | null;
  /** The query after its prefix. */
  text: string;
}

export function parseQuery(query: string): ParsedQuery {
  if (query.startsWith('?')) return { mode: 'help', kinds: null, text: '' };
  const p = PREFIXES.find((x) => query.startsWith(x.prefix));
  if (!p) return { mode: 'go', kinds: null, text: query };
  return { mode: p.mode, kinds: 'kinds' in p ? p.kinds : null, text: query.slice(1) };
}

/** ⌘P: without a query, every place but the search-only ones, as given. With `kinds` only those,
 * search-only ones too, and flat: no project heading. */
export function searchGo(items: GoItem[], query: string, kinds: readonly GoItem['kind'][] | null = null): GoItem[] {
  const q = query.trim();
  if (kinds) items = items.filter((i) => kinds.includes(i.kind)).map((i) => ({ ...i, heading: undefined }));
  if (!q) return kinds ? capSearchOnly(items) : items.filter((i) => !i.searchOnly);
  const fuse = new Fuse(items, {
    ...fuseOptions,
    keys: [
      { name: 'label', weight: 2 },
      { name: 'repo', weight: 1 },
      { name: 'terms', weight: 1 },
    ],
  });
  // The project on show's entries stay on top.
  const hits = grouped(fuse.search(q).map((r) => r.item));
  return capSearchOnly([...hits.filter((i) => i.heading), ...hits.filter((i) => !i.heading)]);
}

/** At most `SEARCH_ONLY_LIMIT` search-only rows per group. */
function capSearchOnly(found: GoItem[]): GoItem[] {
  const counts = new Map<string, number>();
  return found.filter((i) => {
    if (!i.searchOnly) return true;
    const n = (counts.get(i.group) ?? 0) + 1;
    counts.set(i.group, n);
    return n <= SEARCH_ONLY_LIMIT;
  });
}

/** ⇧⌘P: without a query, the recently run ones first (in `recentGroup`), then all by group. */
export function searchCommands(commands: Command[], query: string, recent: string[], recentGroup: string): Command[] {
  const q = query.trim();
  if (!q) {
    const byId = new Map(commands.map((c) => [c.id, c]));
    const first = recent.flatMap((id) => {
      const c = byId.get(id);
      return c ? [{ ...c, group: recentGroup }] : [];
    });
    const taken = new Set(first.map((c) => c.id));
    return [...first, ...grouped(commands.filter((c) => !taken.has(c.id)))];
  }
  const fuse = new Fuse(commands, {
    ...fuseOptions,
    keys: [
      { name: 'title', weight: 2 },
      { name: 'group', weight: 1 },
    ],
  });
  return grouped(fuse.search(q).map((r) => r.item));
}

const RECENT_KEY = 'gitgel.recentCommands';
const RECENT_MAX = 5;

export function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberRecent(id: string): void {
  try {
    const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Nowhere to keep it; the palette opens without Recent.
  }
}
