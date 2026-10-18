import { describe, expect, it } from 'vitest';
import type { HistoryCommit } from '../../lib/types';
import { dayLabel, historyRows, initials, lineRows, whenLabel } from './rows';

const now = new Date(2026, 9, 4, 15, 0); // Oct 4, 2026, 15:00 local
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).getTime() / 1000;

function commit(subject: string, committedAt: number, inBase = false): HistoryCommit {
  return {
    sha: subject.padEnd(40, '0'),
    shortSha: subject.slice(0, 7),
    subject,
    body: '',
    author: 'Melis Kaya',
    authorEmail: 'melis@example.com',
    committedAt,
    parents: 1,
    inBase,
  };
}

describe('day and time labels', () => {
  it('names today, yesterday and older days', () => {
    expect(dayLabel(at(2026, 9, 4, 1), now)).toBe('Today');
    expect(dayLabel(at(2026, 9, 3, 23), now)).toBe('Yesterday');
    expect(dayLabel(at(2026, 9, 2), now)).toBe('Oct 2');
    expect(dayLabel(at(2025, 9, 2), now)).toBe('Oct 2, 2025');
  });

  it('adds the time except for another year', () => {
    expect(whenLabel(at(2026, 9, 4, 11, 42), now)).toBe('today 11:42');
    expect(whenLabel(at(2026, 9, 3, 9, 5), now)).toBe('yesterday 09:05');
    expect(whenLabel(at(2026, 9, 2, 11, 42), now)).toBe('Oct 2, 11:42');
    expect(whenLabel(at(2025, 9, 2, 11, 42), now)).toBe('Oct 2, 2025');
  });
});

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Melis Kaya')).toBe('MK');
    expect(initials('can öztürk')).toBe('CÖ');
    expect(initials('Ada Lovelace Byron')).toBe('AL');
    expect(initials('dependabot[bot]')).toBe('BOT');
    expect(initials('  ')).toBe('?');
  });
});

describe('historyRows', () => {
  it('puts Uncommitted first, with no day labels', () => {
    const rows = historyRows(
      [commit('a', at(2026, 9, 4, 11)), commit('b', at(2026, 9, 4, 9)), commit('c', at(2026, 9, 3))],
      { wip: true, base: null, ahead: null },
    );
    expect(rows.map((r) => (r.kind === 'commit' ? r.commit.subject : r.kind))).toEqual(['wip', 'a', 'b', 'c']);
  });

  it('draws the base line before the first commit already in the base', () => {
    const rows = historyRows(
      [commit('mine', at(2026, 9, 4, 11)), commit('shared', at(2026, 9, 4, 9), true)],
      { wip: false, base: 'main', ahead: 1 },
    );
    expect(rows.map((r) => r.kind)).toEqual(['commit', 'base', 'commit']);
  });

  it('has no base line when the branch adds nothing', () => {
    const rows = historyRows([commit('shared', at(2026, 9, 4), true)], {
      wip: false,
      base: 'origin/main',
      ahead: 0,
    });
    expect(rows.some((r) => r.kind === 'base')).toBe(false);
  });

  it('draws the origin line over the newest pushed commit and picks the rows above each line', () => {
    const list = [commit('new', at(2026, 9, 4, 12)), commit('pushed', at(2026, 9, 4, 11)), commit('shared', at(2026, 9, 4, 9), true)];
    const upstream = { remote: 'origin', name: 'origin/feat', ahead: 1, behind: 0, mergeBase: list[1].sha };
    const rows = historyRows(list, { wip: true, base: 'main', ahead: 2, upstream });
    expect(rows.map((r) => r.kind)).toEqual(['wip', 'commit', 'origin', 'commit', 'base', 'commit']);
    expect(rows.find((r) => r.kind === 'origin')).toMatchObject({ remote: 'origin/feat', pushed: 1 });
    expect(lineRows(rows, 'origin')).toEqual(['wip', list[0].sha]);
    expect(lineRows(rows, 'base')).toEqual(['wip', list[0].sha, list[1].sha]);
  });

  it('has no origin line when everything is pushed', () => {
    const list = [commit('pushed', at(2026, 9, 4, 11)), commit('shared', at(2026, 9, 4, 9), true)];
    const upstream = { remote: 'origin', name: 'origin/feat', ahead: 0, behind: 0, mergeBase: list[0].sha };
    expect(historyRows(list, { wip: false, base: 'main', ahead: 1, upstream }).some((r) => r.kind === 'origin')).toBe(false);
  });
});
