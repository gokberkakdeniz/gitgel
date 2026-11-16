import { describe, expect, it } from 'vitest';
import type { Blame } from '../lib/types';
import { blameAt, blameText } from './blame';

const commit = (sha: string, subject: string) => ({
  sha,
  shortSha: sha.slice(0, 7),
  subject,
  author: 'Ada',
  committedAt: 1_000,
});
const blame: Blame = {
  commits: [commit('a'.repeat(40), 'first'), commit('b'.repeat(40), 'second')],
  hunks: [
    { start: 1, lines: 2, commit: 0 },
    { start: 3, lines: 1, commit: null },
    { start: 4, lines: 3, commit: 1 },
  ],
};

describe('blameAt', () => {
  it('finds the commit of a line', () => {
    expect(blameAt(blame, 1)?.subject).toBe('first');
    expect(blameAt(blame, 2)?.subject).toBe('first');
    expect(blameAt(blame, 6)?.subject).toBe('second');
  });
  it('tells lines not committed from lines it does not reach', () => {
    expect(blameAt(blame, 3)).toBeNull();
    expect(blameAt(blame, 7)).toBeUndefined();
    expect(blameAt({ commits: [], hunks: [] }, 1)).toBeUndefined();
  });
});

describe('blameText', () => {
  it('names the author, the age and the subject', () => {
    const text = blameText(commit('c'.repeat(40), 'Fix it'), 1_000 + 3 * 86_400);
    expect(text.startsWith('Ada, ')).toBe(true);
    expect(text.endsWith(' · Fix it')).toBe(true);
  });
  it('cuts a long subject', () => {
    const text = blameText(commit('c'.repeat(40), 'x'.repeat(200)), 2_000);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThan(120);
  });
  it('says so for a line not committed', () => {
    expect(blameText(null)).toBe('Not committed yet');
  });
});
