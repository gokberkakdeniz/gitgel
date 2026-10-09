import { describe, expect, it } from 'vitest';
import { range, toggled } from './picks';

describe('picks', () => {
  it('⌘-click adds a file, and drops it when picked', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('⇧-click takes the files between, either way', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(range(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(range(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(range(order, 'c', 'c')).toEqual(['c']);
    // An anchor no longer listed: just the file clicked.
    expect(range(order, 'x', 'b')).toEqual(['b']);
  });
});
