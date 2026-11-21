// Notes on diff lines (SPEC §5 Review "Notes"): finding them again, listing and copying them.
// Stored per branch by the backend (notes.rs); `useData().notes` holds them all.
import { fileReference } from '../monaco/reference';
import { useData } from '../state/data';
import { setNotes } from './ipc';
import type { Note, NotesList } from './types';

export function textLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Where a note's lines are in `lines` now: the occurrence nearest to where they were written;
 * null when the text no longer has them (the note is outdated). */
export function locate(note: Pick<Note, 'lines' | 'from'>, lines: string[]): { from: number; to: number } | null {
  const n = note.lines.length;
  if (n === 0) return null;
  let best = -1;
  for (let i = 0; i + n <= lines.length; i++) {
    let same = true;
    for (let j = 0; j < n && same; j++) same = lines[i + j] === note.lines[j];
    if (same && (best < 0 || Math.abs(i + 1 - note.from) < Math.abs(best + 1 - note.from))) best = i;
  }
  return best < 0 ? null : { from: best + 1, to: best + n };
}

/** A note is closed when resolved by hand or outdated; closed notes are listed (and copied) only
 * with Show Resolved, and never shown in the diff when outdated. */
export function isClosed(note: Note, outdated: boolean): boolean {
  return note.resolved || outdated;
}

/** What Copy All puts on the clipboard: each note's reference, its text under it, a blank line
 * between notes. */
export function copyText(items: { ref: string; text: string }[]): string {
  return items.map((i) => `${i.ref}\n${i.text}`).join('\n\n');
}

/** The reference of a note at `from`–`to`, its path after `lead` (`token-refresh/`). */
export function noteReference(path: string, from: number, to: number, lead = ''): string {
  return fileReference(`${lead}${path}`, from, to);
}

/** Each folder after the part all of them share (`~/code/wt/a`, `~/code/wt/b` → `a/`, `b/`);
 * a single folder gets none. */
export function folderLeads(folders: string[]): Map<string, string> {
  const unique = [...new Set(folders)];
  const out = new Map<string, string>();
  if (unique.length < 2) {
    for (const f of unique) out.set(f, '');
    return out;
  }
  const parts = unique.map((f) => f.split('/').filter(Boolean));
  let common = 0;
  while (parts.every((p) => common < p.length - 1 && p[common] === parts[0][common])) common++;
  for (const [i, f] of unique.entries()) out.set(f, `${parts[i].slice(common).join('/')}/`);
  return out;
}

/** In list order: by date added (newest first unless `oldestFirst`), or by file and line. */
export function sortNotes<T extends { note: Note; order: number }>(items: T[], list: NotesList): T[] {
  const out = items.slice();
  if (list.byFile) {
    out.sort(
      (a, b) =>
        a.order - b.order ||
        (a.note.path < b.note.path ? -1 : a.note.path > b.note.path ? 1 : 0) ||
        a.note.from - b.note.from,
    );
  } else {
    out.sort((a, b) => (list.oldestFirst ? a.note.createdAt - b.note.createdAt : b.note.createdAt - a.note.createdAt));
  }
  return out;
}

export const DEFAULT_NOTES_LIST: NotesList = {
  allBranches: false,
  byFile: false,
  oldestFirst: false,
  showResolved: false,
};

/** A branch's notes, in the order they were written. */
export function notesOf(key: string): Note[] {
  return useData.getState().notes[key] ?? [];
}

/** Replaces a branch's notes, at once here and then in notes.json. */
export function saveNotes(key: string, list: Note[]): Promise<void> {
  const data = useData.getState();
  const next = { ...data.notes };
  if (list.length) next[key] = list;
  else delete next[key];
  data.setNotes(next);
  return setNotes(key, list).catch((e) => {
    console.error('cannot save notes', e);
  });
}

export function newNoteId(): string {
  return `n_${Math.random().toString(16).slice(2, 10)}`;
}
