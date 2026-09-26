import { describe, expect, it } from 'vitest';
import { languageForPath } from './language';

const langs = [
  { id: 'typescript', extensions: ['.ts', '.tsx'] },
  { id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
  { id: 'scss', extensions: ['.scss'] },
  { id: 'css', extensions: ['.css'] },
  { id: 'd-ts', extensions: ['.d.ts'] },
];

describe('languageForPath', () => {
  it('matches file names, then the longest extension', () => {
    expect(languageForPath('src/auth/session.ts', langs)).toBe('typescript');
    expect(languageForPath('deploy/Dockerfile', langs)).toBe('dockerfile');
    expect(languageForPath('types/index.d.ts', langs)).toBe('d-ts');
    expect(languageForPath('STYLE.SCSS', langs)).toBe('scss');
    expect(languageForPath('README', langs)).toBe('plaintext');
  });
});
