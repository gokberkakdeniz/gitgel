import { describe, expect, it } from 'vitest';
import { changelog, compareVersions, newerThan, parseChangelog } from './changelog';
import { version } from '../../package.json';

describe('parseChangelog', () => {
  it('reads versions, dates, groups and lines', () => {
    const text = [
      '# Changelog',
      '',
      '## 0.1.16 — 2026-10-06',
      '',
      '### Improved',
      '- Signed and notarized.',
      '',
      '## 0.1.15 — 2026-10-05',
      '### New',
      '- Fetch, Pull and Push.',
      '- Pinned repos.',
      '### Fixed',
      '- Rename keeps the colour.',
      '',
    ].join('\n');
    expect(parseChangelog(text)).toEqual([
      { version: '0.1.16', date: '2026-10-06', groups: [{ title: 'Improved', items: ['Signed and notarized.'] }] },
      {
        version: '0.1.15',
        date: '2026-10-05',
        groups: [
          { title: 'New', items: ['Fetch, Pull and Push.', 'Pinned repos.'] },
          { title: 'Fixed', items: ['Rename keeps the colour.'] },
        ],
      },
    ]);
  });

  it('leaves out a version without lines', () => {
    expect(parseChangelog('## 0.2.0 — 2026-11-01\n\n### New\n')).toEqual([]);
  });

  it('reads the bundled CHANGELOG.md, the running version on top', () => {
    expect(changelog.length).toBeGreaterThan(10);
    expect(changelog[0].version).toBe(version);
    for (const r of changelog) expect(r.groups.length).toBeGreaterThan(0);
  });
});

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.9', '0.1.10')).toBeLessThan(0);
    expect(compareVersions('0.2.0', '0.1.16')).toBeGreaterThan(0);
    expect(compareVersions('0.1.16', '0.1.16')).toBe(0);
    expect(compareVersions('0.1', '0.1.0')).toBe(0);
  });
});

describe('newerThan', () => {
  it('keeps the versions after the running one', () => {
    expect(newerThan(changelog, '0.1.14').map((r) => r.version)).toEqual(
      changelog.filter((r) => compareVersions(r.version, '0.1.14') > 0).map((r) => r.version),
    );
    expect(newerThan(changelog, '0.1.14').map((r) => r.version)).toContain('0.1.15');
    expect(newerThan(changelog, '0.1.14').map((r) => r.version)).not.toContain('0.1.14');
  });
});
