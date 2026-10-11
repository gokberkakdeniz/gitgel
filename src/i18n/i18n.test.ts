import { describe, expect, it } from 'vitest';
import en from './en.json';
import tr from './tr.json';

// T25.3c: the translated dict covers exactly the source keys.
describe('i18n key parity', () => {
  it('tr has every en key and no extras', () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });
});
