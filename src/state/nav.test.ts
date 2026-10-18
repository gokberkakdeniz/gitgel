import { describe, expect, it } from 'vitest';
import { leaveDeletedBranch, revTarget, useNav, type Route } from './nav';

const review = (branch: string): Route => ({
  name: 'review',
  target: { kind: 'branch', repoId: 'r1', branch, worktreePath: null, tipOverride: null },
  backLabel: '',
});
// Review of a rev (what History was).
const history = (rev: string): Route => ({ name: 'review', target: revTarget('r1', rev), backLabel: '' });

function after(stack: Route[]): Route[] {
  useNav.setState({ stack, index: stack.length - 1 });
  leaveDeletedBranch('r1', 'feat');
  const s = useNav.getState();
  expect(s.index).toBe(s.stack.length - 1);
  return s.stack;
}

describe('leaving a deleted branch', () => {
  it('goes to Branches from its Review, by branch or by rev', () => {
    expect(after([{ name: 'branches' }, review('feat'), history('feat')])).toEqual([{ name: 'branches' }]);
    expect(after([{ name: 'settings' }, history('feat')])).toEqual([{ name: 'settings' }, { name: 'branches' }]);
  });

  it('stays in the project it was opened from', () => {
    const project: Route = { name: 'review', target: { kind: 'project', projectId: 'p1' }, backLabel: '' };
    expect(after([{ name: 'project', projectId: 'p1' }, project, history('feat')])).toEqual([
      { name: 'project', projectId: 'p1' },
      project,
    ]);
  });

  it('leaves other pages alone', () => {
    const stack: Route[] = [{ name: 'branches' }, history('main')];
    expect(after(stack)).toEqual(stack);
    // Shown: Branches; the deleted branch's Review is only forward.
    useNav.setState({ stack: [{ name: 'branches' }, review('feat')], index: 0 });
    leaveDeletedBranch('r1', 'feat');
    expect(useNav.getState()).toMatchObject({ stack: [{ name: 'branches' }, review('feat')], index: 0 });
  });
});
