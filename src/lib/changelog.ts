// Release notes (SPEC §7 "What's New", §12 "Release notes"): CHANGELOG.md, bundled at build
// time, and the update feed's `notes`, which hold sections of the same file.
import raw from '../../CHANGELOG.md?raw';

export interface ReleaseGroup {
  title: string; // New, Improved, Fixed
  items: string[]; // Markdown lines; only `code` spans mean anything
}
export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  groups: ReleaseGroup[];
}

/** Reads `## <version> — <date>`, `### <group>` and `- ` lines; everything else is skipped. */
export function parseChangelog(text: string): Release[] {
  const releases: Release[] = [];
  for (const line of text.split('\n')) {
    const heading = /^## (\S+)\s+—\s+(\S+)\s*$/.exec(line);
    if (heading) {
      releases.push({ version: heading[1], date: heading[2], groups: [] });
      continue;
    }
    const release = releases[releases.length - 1];
    if (!release) continue;
    const group = /^### (.+?)\s*$/.exec(line);
    if (group) {
      release.groups.push({ title: group[1], items: [] });
      continue;
    }
    const item = /^- (.+?)\s*$/.exec(line);
    if (item) release.groups[release.groups.length - 1]?.items.push(item[1]);
  }
  return releases.filter((r) => r.groups.some((g) => g.items.length > 0));
}

/** Compares dotted versions as numbers (0.1.10 > 0.1.9); a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The releases newer than `version`, newest first. */
export function newerThan(releases: Release[], version: string): Release[] {
  return releases.filter((r) => compareVersions(r.version, version) > 0);
}

/** The bundled CHANGELOG.md. */
export const changelog: Release[] = parseChangelog(raw);
