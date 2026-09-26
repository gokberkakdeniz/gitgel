// Language id for a file path, from Monaco's registered languages.

export interface LanguageInfo {
  id: string;
  extensions?: string[];
  filenames?: string[];
}

/** Exact file name first (`Dockerfile`), then the longest matching extension; else plaintext. */
export function languageForPath(path: string, languages: LanguageInfo[]): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  for (const lang of languages) {
    if (lang.filenames?.some((f) => f.toLowerCase() === name)) return lang.id;
  }
  let best = '';
  let id = 'plaintext';
  for (const lang of languages) {
    for (const ext of lang.extensions ?? []) {
      const e = ext.toLowerCase();
      if (name.endsWith(e) && e.length > best.length) {
        best = e;
        id = lang.id;
      }
    }
  }
  return id;
}
