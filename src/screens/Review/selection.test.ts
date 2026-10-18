import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../lib/types';
import { dirLabel } from './selection';

const file = (path: string, extra: Partial<FileChange> = {}): FileChange => ({
  path,
  oldPath: null,
  kind: 'M',
  add: 1,
  del: 0,
  binary: false,
  oldOid: 'a',
  newOid: 'b',
  ...extra,
});

describe('dirLabel', () => {
  it('shows the folder, the old path of renames and untracked files', () => {
    expect(dirLabel(file('src/auth/session.ts'))).toBe('src/auth');
    expect(dirLabel(file('package.json'))).toBe('.');
    expect(dirLabel(file('src/auth/tokens.ts', { kind: 'R', oldPath: 'src/auth/token.ts' }))).toBe(
      'src/auth ← src/auth/token.ts',
    );
    expect(dirLabel(file('scripts/debug.ts', { kind: 'U' }))).toBe('scripts · untracked');
  });
});
