import { describe, expect, it } from 'vitest';
import { copyText, folderLeads, locate, noteReference, sortNotes } from './notes';
import type { Note } from './types';

const note = (over: Partial<Note>): Note => ({
  id: 'n',
  path: 'src/a.ts',
  side: 'new',
  from: 1,
  to: 1,
  lines: ['x'],
  text: '',
  createdAt: 0,
  resolved: false,
  ...over,
});

describe('locate', () => {
  it('finds the lines where they moved', () => {
    expect(locate(note({ from: 2, lines: ['b', 'c'] }), ['z', 'a', 'b', 'c'])).toEqual({ from: 3, to: 4 });
  });
  it('takes the occurrence nearest to where they were', () => {
    expect(locate(note({ from: 5, lines: ['}'] }), ['}', 'a', 'b', 'c', 'd', '}'])).toEqual({ from: 6, to: 6 });
  });
  it('is null once the text is gone', () => {
    expect(locate(note({ lines: ['gone'] }), ['a', 'b'])).toBeNull();
  });
});

describe('copying', () => {
  it('puts each reference above its text', () => {
    expect(
      copyText([
        { ref: noteReference('src/a.ts', 2, 2), text: 'One' },
        { ref: noteReference('src/a.ts', 22, 23, 'token-refresh/'), text: 'Two' },
      ]),
    ).toBe('@src/a.ts:2\nOne\n\n@token-refresh/src/a.ts:22-23\nTwo');
  });
  it('starts paths where the folders part', () => {
    const leads = folderLeads(['/Users/me/code/wt/token-refresh', '/Users/me/code/wt/token-rotation']);
    expect(leads.get('/Users/me/code/wt/token-refresh')).toBe('token-refresh/');
    expect(leads.get('/Users/me/code/wt/token-rotation')).toBe('token-rotation/');
    expect(folderLeads(['/a/b']).get('/a/b')).toBe('');
  });
});

describe('sortNotes', () => {
  const items = [
    { note: note({ id: 'a', path: 'b.ts', from: 9, createdAt: 1 }), order: 0 },
    { note: note({ id: 'b', path: 'a.ts', from: 3, createdAt: 3 }), order: 0 },
    { note: note({ id: 'c', path: 'a.ts', from: 1, createdAt: 2 }), order: 1 },
  ];
  const ids = (list: typeof items) => list.map((i) => i.note.id).join('');
  it('lists newest first by default', () => {
    expect(ids(sortNotes(items, { allBranches: false, byFile: false, oldestFirst: false, showResolved: false }))).toBe(
      'bca',
    );
  });
  it('groups by branch, then file and line', () => {
    expect(ids(sortNotes(items, { allBranches: true, byFile: true, oldestFirst: false, showResolved: false }))).toBe(
      'bac',
    );
  });
});
