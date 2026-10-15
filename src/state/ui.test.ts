import { describe, expect, it } from 'vitest';
import { commitDraftKey, useUi } from './ui';

describe('commit drafts', () => {
  it('keeps each branch’s form and drops an emptied one', () => {
    const a = commitDraftKey('r1', 'main');
    const b = commitDraftKey('r1', 'feat');
    useUi.getState().setCommitDraft(a, { summary: 'Fix it' });
    useUi.getState().setCommitDraft(b, { description: 'Body' });
    expect(useUi.getState().commitDrafts[a]).toEqual({ summary: 'Fix it', description: '', amending: null });
    expect(useUi.getState().commitDrafts[b]?.description).toBe('Body');
    useUi.getState().setCommitDraft(a, { summary: '' });
    expect(a in useUi.getState().commitDrafts).toBe(false);
    expect(b in useUi.getState().commitDrafts).toBe(true);
  });
});
