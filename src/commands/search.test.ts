import { describe, expect, it } from 'vitest';
import type { Command, GoItem } from './registry';
import { parseQuery, SEARCH_ONLY_LIMIT, searchCommands, searchGo } from './search';

const go = (key: string, group: string, extra: Partial<GoItem> = {}): GoItem => ({
  key,
  group,
  kind: 'branch',
  label: key,
  run: () => {},
  ...extra,
});
const cmd = (id: string, title: string, group: string): Command => ({ id, title, group, run: () => {} });

describe('searchGo', () => {
  it('leaves out search-only rows without a query', () => {
    const items = [go('feat/queue', 'Worktrees'), go('old/thing', 'Older', { searchOnly: true })];
    expect(searchGo(items, '').map((i) => i.key)).toEqual(['feat/queue']);
  });

  it('finds search-only rows, at most the limit per group', () => {
    const many = Array.from({ length: SEARCH_ONLY_LIMIT + 5 }, (_, i) =>
      go(`old/fix-${i}`, 'Older', { searchOnly: true }),
    );
    expect(searchGo(many, 'fix')).toHaveLength(SEARCH_ONLY_LIMIT);
  });

  it('keeps each group together, the best match first', () => {
    const items = [
      go('main', 'Projects'),
      go('queue-worker', 'Active'),
      go('feat/queue', 'Worktrees'),
      go('queue', 'Projects'),
    ];
    const keys = searchGo(items, 'queue').map((i) => i.key);
    expect(keys[0]).toBe('queue');
    const groups = searchGo(items, 'queue').map((i) => i.group);
    expect(groups).toEqual([...groups].sort((a, b) => groups.indexOf(a) - groups.indexOf(b)));
  });

  it("keeps the project on show's entries on top", () => {
    const items = [go('queue', 'Projects'), go('feat/queue-worker', 'entries', { heading: 'Payments' })];
    expect(searchGo(items, 'queue').map((i) => i.key)).toEqual(['feat/queue-worker', 'queue']);
  });

  it('searches the repo and the worktree path too', () => {
    const items = [go('main', 'Active', { repo: 'api-server', terms: '~/code/wt/rotation' })];
    expect(searchGo(items, 'api-server')).toHaveLength(1);
    expect(searchGo(items, 'rotation')).toHaveLength(1);
  });
});

describe('searchCommands', () => {
  const all = [
    cmd('push', 'Push', 'Branch'),
    cmd('fetch', 'Fetch', 'Branch'),
    cmd('newProject', 'New Project…', 'General'),
  ];

  it('lists recent ones first, under their own group, and not twice', () => {
    const out = searchCommands(all, '', ['newProject', 'gone'], 'Recently Used');
    expect(out.map((c) => [c.id, c.group])).toEqual([
      ['newProject', 'Recently Used'],
      ['push', 'Branch'],
      ['fetch', 'Branch'],
    ]);
  });

  it('matches titles while searching, without Recent', () => {
    expect(searchCommands(all, 'push', ['newProject'], 'Recently Used').map((c) => c.id)).toEqual(['push']);
  });
});

describe('parseQuery', () => {
  it('reads the prefix and keeps the rest', () => {
    expect(parseQuery('>push')).toEqual({ mode: 'commands', kinds: null, text: 'push' });
    expect(parseQuery('#pay')).toEqual({ mode: 'go', kinds: ['project'], text: 'pay' });
    expect(parseQuery('~api')).toEqual({ mode: 'go', kinds: ['worktree'], text: 'api' });
    expect(parseQuery('/feat')).toEqual({ mode: 'go', kinds: ['worktree', 'branch'], text: 'feat' });
    expect(parseQuery('?')).toEqual({ mode: 'help', kinds: null, text: '' });
    expect(parseQuery('feat/queue')).toEqual({ mode: 'go', kinds: null, text: 'feat/queue' });
  });
});

describe('searchGo with kinds', () => {
  const items = [
    go('Payments', 'projects', { kind: 'project' }),
    go('feat/queue', 'entries', { kind: 'worktree', heading: 'Payments' }),
    go('old/queue', 'older', { kind: 'branch', searchOnly: true }),
  ];

  it('lists every place of those kinds without a query, search-only ones too, without headings', () => {
    const out = searchGo(items, '', ['worktree', 'branch']);
    expect(out.map((i) => i.key)).toEqual(['feat/queue', 'old/queue']);
    expect(out.every((i) => i.heading === undefined)).toBe(true);
  });

  it('searches only those kinds', () => {
    expect(searchGo(items, 'pay', ['project']).map((i) => i.key)).toEqual(['Payments']);
    expect(searchGo(items, 'queue', ['project'])).toEqual([]);
  });
});
