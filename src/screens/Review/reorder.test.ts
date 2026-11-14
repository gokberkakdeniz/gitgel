import { describe, expect, it } from 'vitest';
import { movedTo, reorderSpan } from './reorder';

describe('reorder', () => {
  const ids = ['d', 'c', 'b', 'a'];
  it('moves a commit to its slot among the others', () => {
    expect(movedTo(ids, 'd', 2)).toEqual(['c', 'b', 'd', 'a']);
    expect(movedTo(ids, 'a', 0)).toEqual(['a', 'd', 'c', 'b']);
    expect(movedTo(ids, 'c', 1)).toEqual(ids);
  });
  it('picks again down to the lowest row that changed', () => {
    expect(reorderSpan(ids, ['c', 'd', 'b', 'a'])).toEqual(['c', 'd']);
    expect(reorderSpan(ids, ['c', 'b', 'd', 'a'])).toEqual(['c', 'b', 'd']);
    expect(reorderSpan(ids, ids)).toEqual([]);
  });
});
