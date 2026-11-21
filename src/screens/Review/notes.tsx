// Review's notes on diff lines (SPEC §5 Review "Notes"): the header's Notes button and its
// popover (the branch's notes, or a project's), List Options, Copy All, Clear All / Clear Resolved.
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { NoteIcon, TuneIcon } from '../../components/icons';
import { Menu, MenuDivider, MenuItem, MenuLabel } from '../../components/Menu';
import { Pill } from '../../components/Pill';
import { Popover } from '../../components/Popover';
import { t } from '../../i18n';
import { ageText, cnt } from '../../lib/format';
import { getNoteFiles, updateSettings } from '../../lib/ipc';
import {
  copyText,
  DEFAULT_NOTES_LIST,
  folderLeads,
  locate,
  newNoteId,
  noteReference,
  notesOf,
  saveNotes,
  sortNotes,
  textLines,
} from '../../lib/notes';
import { stopAsking } from '../../lib/prompts';
import type { EntrySummary, Note, NotesList } from '../../lib/types';
import { useData } from '../../state/data';
import { useUi } from '../../state/ui';
import type { DiffNotes } from '../../monaco/DiffView';
import styles from './notes.module.css';

/** A note to open once its branch's Review is showing (a project review switches branch first). */
interface Jump {
  key: string;
  noteId: string;
  path: string;
  seq: number;
}
export const useNoteJump = create<{ jump: Jump | null; go: (j: Omit<Jump, 'seq'>) => void }>()((set) => ({
  jump: null,
  go: (j) => set((s) => ({ jump: { ...j, seq: (s.jump?.seq ?? 0) + 1 } })),
}));

export function useNotesList(): NotesList {
  return useData((s) => s.config?.settings.notesList) ?? DEFAULT_NOTES_LIST;
}

function setNotesList(patch: Partial<NotesList>) {
  const settings = useData.getState().config?.settings;
  if (settings)
    void updateSettings({ ...settings, notesList: { ...(settings.notesList ?? DEFAULT_NOTES_LIST), ...patch } });
}

/** The diff's notes for one file of a branch: add, edit, resolve, delete (Undo). */
export function useDiffNotes(key: string | null, path: string | null, reveal: DiffNotes['reveal']): DiffNotes | null {
  const all = useData((s) => (key ? s.notes[key] : undefined));
  const list = useNotesList();
  return useMemo(() => {
    if (!key || !path) return null;
    const mine = (all ?? []).filter((n) => n.path === path);
    const change = (fn: (notes: Note[]) => Note[]) => void saveNotes(key, fn(notesOf(key)));
    return {
      list: mine,
      showResolved: list.showResolved,
      reveal,
      onAdd: (n) => change((notes) => [...notes, { ...n, id: newNoteId(), createdAt: Date.now(), resolved: false }]),
      onEdit: (id, text) => change((notes) => notes.map((x) => (x.id === id ? { ...x, text } : x))),
      onResolve: (id, resolved) => {
        const before = notesOf(key);
        change((notes) => notes.map((x) => (x.id === id ? { ...x, resolved } : x)));
        if (resolved && !list.showResolved)
          useUi.getState().showToast({
            message: t('notes.resolvedToast'),
            actionLabel: t('common.undo'),
            onAction: () => void saveNotes(key, before),
          });
      },
      onDelete: (id) => {
        const before = notesOf(key);
        change((notes) => notes.filter((x) => x.id !== id));
        useUi.getState().showToast({
          message: t('notes.deletedToast'),
          actionLabel: t('common.undo'),
          onAction: () => void saveNotes(key, before),
        });
      },
    };
  }, [key, path, all, list.showResolved, reveal]);
}

/** Where each note of a branch is in its files now (null: outdated). Notes on removed lines
 * keep their place (the current file never has those lines). */
export function useNotePlaces(entries: NotesEntry[]): Map<string, { from: number; to: number } | null> {
  const notes = useData((s) => s.notes);
  const versions = useData((s) => s.repoVersion);
  const [places, setPlaces] = useState(new Map<string, { from: number; to: number } | null>());
  const wanted = entries
    .map((e) => {
      const paths = [...new Set((notes[e.key] ?? []).filter((n) => n.side === 'new').map((n) => n.path))].sort();
      return { e, paths, v: versions[e.repoId] ?? 0 };
    })
    .filter((w) => (notes[w.e.key] ?? []).length > 0);
  const wantedKey = JSON.stringify(wanted.map((w) => [w.e.key, w.e.rev, w.e.worktreePath, w.paths, w.v]));
  useEffect(() => {
    let live = true;
    void Promise.all(
      wanted.map(async (w) => {
        const list = notes[w.e.key] ?? [];
        const texts = w.paths.length
          ? await getNoteFiles(w.e.repoId, w.e.worktreePath, w.e.rev, w.paths).catch(() => w.paths.map(() => null))
          : [];
        const lines = new Map(w.paths.map((p, i) => [p, texts[i] === null ? null : textLines(texts[i]!)]));
        return list.map((n) => {
          if (n.side === 'old') return [n.id, { from: n.from, to: n.to }] as const;
          const l = lines.get(n.path);
          return [n.id, l ? locate(n, l) : null] as const;
        });
      }),
    ).then((rows) => {
      if (live) setPlaces(new Map(rows.flat()));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, notes]);
  return places;
}

/** A branch whose notes the popover lists. */
export interface NotesEntry {
  key: string;
  repoId: string;
  repoName: string;
  rev: string;
  worktreePath: string | null;
  /** Its worktree, else its repository folder: where references start in a project's list. */
  folder: string;
}

export function notesEntry(e: EntrySummary, repoPath: string | undefined): NotesEntry | null {
  const rev = e.branch ?? e.headSha;
  if (!rev) return null;
  return {
    key: e.key,
    repoId: e.repoId,
    repoName: e.repoName,
    rev,
    worktreePath: e.worktreePath,
    folder: e.worktreePath ?? repoPath ?? e.repoName,
  };
}

interface Row {
  note: Note;
  entry: NotesEntry;
  order: number;
  at: { from: number; to: number };
  outdated: boolean;
  ref: string;
}

/** The header's Notes button (only while the listed branches have notes) and its popover. */
export function NotesButton({
  entries,
  open,
  inProject,
  places,
  onGo,
}: {
  /** The open branch, or every branch of the project. */
  entries: NotesEntry[];
  /** The open branch's key. */
  open: string;
  inProject: boolean;
  /** Where the listed notes are now (`useNotePlaces`); null: outdated. */
  places: Map<string, { from: number; to: number } | null>;
  onGo: (note: Note, entry: NotesEntry) => void;
}) {
  const notes = useData((s) => s.notes);
  const list = useNotesList();
  const allBranches = inProject && list.allBranches;
  const shown = allBranches ? entries : entries.filter((e) => e.key === open);
  const [at, setAt] = useState<DOMRect | null>(null);
  const [options, setOptions] = useState<DOMRect | null>(null);
  const [asking, setAsking] = useState<{ resolved: boolean; rows: Row[] } | null>(null);

  const leads = folderLeads(shown.filter((e) => (notes[e.key] ?? []).length).map((e) => e.folder));
  const all: Row[] = shown.flatMap((entry, order) =>
    (notes[entry.key] ?? []).map((note) => {
      const place = places.has(note.id) ? places.get(note.id)! : { from: note.from, to: note.to };
      const at = place ?? { from: note.from, to: note.to };
      return {
        note,
        entry,
        order,
        at,
        outdated: place === null,
        ref: noteReference(note.path, at.from, at.to, allBranches ? (leads.get(entry.folder) ?? '') : ''),
      };
    }),
  );
  const closed = (r: Row) => r.note.resolved || r.outdated;
  const rows = sortNotes(
    all.filter((r) => list.showResolved || !closed(r)),
    list,
  );
  if (all.length === 0) return null;

  const close = () => {
    setAt(null);
    setOptions(null);
  };
  const clear = (resolved: boolean, picked: Row[]) => {
    const byKey = new Map<string, Set<string>>();
    for (const r of picked) {
      if (!byKey.has(r.entry.key)) byKey.set(r.entry.key, new Set());
      byKey.get(r.entry.key)!.add(r.note.id);
    }
    const before = [...byKey.keys()].map((k) => [k, notesOf(k)] as const);
    for (const [k, ids] of byKey)
      void saveNotes(
        k,
        notesOf(k).filter((n) => !ids.has(n.id)),
      );
    useUi.getState().showToast({
      message: t(resolved ? 'notes.clearedResolved' : 'notes.cleared', { ...cnt(picked.length) }),
      actionLabel: t('common.undo'),
      onAction: () => {
        for (const [k, list] of before) void saveNotes(k, list);
      },
    });
  };
  const askClear = (resolved: boolean) => {
    const picked = resolved ? all.filter(closed) : rows;
    close();
    if (picked.length === 0) return;
    if (useData.getState().config?.settings.prompts.clearNotes === false) clear(resolved, picked);
    else setAsking({ resolved, rows: picked });
  };
  const hasClosed = all.some(closed);
  const groups = list.byFile ? groupRows(rows) : [];
  const many = allBranches && new Set(rows.map((r) => r.entry.key)).size > 1;

  return (
    <>
      <button
        type="button"
        className={at ? `${styles.button} ${styles.buttonOpen}` : styles.button}
        aria-haspopup="dialog"
        aria-expanded={!!at}
        aria-label={t('notes.count', { ...cnt(rows.length) })}
        title={t('notes.title')}
        onClick={(e) => setAt(at ? null : e.currentTarget.getBoundingClientRect())}
      >
        <NoteIcon size={14} />
        <span className={styles.count}>{rows.length}</span>
      </button>
      {at && (
        <Popover anchorRect={at} width={400} alignRight onClose={close}>
          <div className={styles.panel} role="dialog" aria-label={t('notes.title')}>
            <div className={styles.head}>
              <span className={styles.title}>{t('notes.title')}</span>
              <span className={styles.pill}>{rows.length}</span>
              <span className={styles.grow} />
              <button
                type="button"
                className={options ? `${styles.options} ${styles.optionsOpen}` : styles.options}
                aria-haspopup="menu"
                aria-expanded={!!options}
                aria-label={t('notes.listOptions')}
                title={t('notes.listOptions')}
                onClick={(e) => setOptions(options ? null : e.currentTarget.getBoundingClientRect())}
              >
                <TuneIcon size={14} />
              </button>
            </div>
            <div className={styles.list}>
              {rows.length === 0 && <div className={styles.empty}>{t('notes.none')}</div>}
              {list.byFile
                ? groups.map((g) => (
                    <div key={`${g.entry.key}\u0000${g.path}`}>
                      {allBranches && g.first && (
                        <div className={styles.branch}>
                          <span className={styles.repo}>{g.entry.repoName}</span>
                          <span className={styles.branchName}>{g.entry.rev}</span>
                        </div>
                      )}
                      <div className={styles.file}>
                        <span className={styles.fileName}>{g.name}</span>
                        <span className={styles.dir}>{g.dir}</span>
                      </div>
                      {g.rows.map((r) => (
                        <NoteRow
                          key={r.note.id}
                          row={r}
                          label={rangeShort(r)}
                          repo={null}
                          indent
                          onGo={() => {
                            close();
                            onGo(r.note, r.entry);
                          }}
                        />
                      ))}
                    </div>
                  ))
                : rows.map((r) => (
                    <NoteRow
                      key={r.note.id}
                      row={r}
                      label={`${basename(r.note.path)}:${rangeText(r)}`}
                      repo={many ? r.entry.repoName : null}
                      age={ageText(r.note.createdAt / 1000)}
                      onGo={() => {
                        close();
                        onGo(r.note, r.entry);
                      }}
                    />
                  ))}
            </div>
            <div className={styles.foot}>
              {hasClosed && (
                <Button variant="ghost" size={28} onClick={() => askClear(true)}>
                  {t('notes.clearResolved')}
                </Button>
              )}
              <Button variant="ghost" size={28} disabled={rows.length === 0} onClick={() => askClear(false)}>
                {t('notes.clearAll')}
              </Button>
              <span className={styles.grow} />
              <Button
                variant="primary"
                size={28}
                icon="copy"
                disabled={rows.length === 0}
                onClick={() => {
                  void writeText(copyText(rows.map((r) => ({ ref: r.ref, text: r.note.text }))));
                  close();
                  useUi
                    .getState()
                    .showToast({ status: 'success', message: t('notes.copied', { ...cnt(rows.length) }) });
                }}
              >
                {t('notes.copyAll')}
              </Button>
            </div>
          </div>
          {options && (
            <Popover anchorRect={options} width={220} alignRight onClose={() => setOptions(null)}>
              <Menu aria-label={t('notes.listOptions')} autoFocus>
                {inProject && (
                  <>
                    <MenuLabel>{t('notes.branches')}</MenuLabel>
                    <MenuItem checked={!list.allBranches} onSelect={() => pick({ allBranches: false })}>
                      {t('notes.openBranch')}
                    </MenuItem>
                    <MenuItem checked={list.allBranches} onSelect={() => pick({ allBranches: true })}>
                      {t('notes.allBranches')}
                    </MenuItem>
                    <MenuDivider />
                  </>
                )}
                <MenuLabel>{t('notes.list')}</MenuLabel>
                <MenuItem checked={!list.byFile} onSelect={() => pick({ byFile: false })}>
                  {t('notes.byDate')}
                </MenuItem>
                <MenuItem checked={list.byFile} onSelect={() => pick({ byFile: true })}>
                  {t('notes.byFile')}
                </MenuItem>
                {!list.byFile && (
                  <>
                    <MenuDivider />
                    <MenuLabel>{t('notes.order')}</MenuLabel>
                    <MenuItem checked={!list.oldestFirst} onSelect={() => pick({ oldestFirst: false })}>
                      {t('notes.newestFirst')}
                    </MenuItem>
                    <MenuItem checked={list.oldestFirst} onSelect={() => pick({ oldestFirst: true })}>
                      {t('notes.oldestFirst')}
                    </MenuItem>
                  </>
                )}
                <MenuDivider />
                <MenuItem box={list.showResolved} onSelect={() => setNotesList({ showResolved: !list.showResolved })}>
                  {t('notes.showResolved')}
                </MenuItem>
              </Menu>
            </Popover>
          )}
        </Popover>
      )}
      {asking && (
        <ClearNotesModal
          resolved={asking.resolved}
          count={asking.rows.length}
          branch={shown.length === 1 && !allBranches ? `${shown[0].repoName} / ${shown[0].rev}` : null}
          onClose={() => setAsking(null)}
          onClear={() => {
            clear(asking.resolved, asking.rows);
            setAsking(null);
          }}
        />
      )}
    </>
  );

  function pick(patch: Partial<NotesList>) {
    setNotesList(patch);
    setOptions(null);
  }
}

function NoteRow({
  row,
  label,
  repo,
  age,
  indent,
  onGo,
}: {
  row: Row;
  label: string;
  repo: string | null;
  age?: string;
  indent?: boolean;
  onGo: () => void;
}) {
  return (
    <button
      type="button"
      className={indent ? `${styles.row} ${styles.indent}` : styles.row}
      title={row.ref}
      onClick={onGo}
    >
      <span className={styles.rowHead}>
        {repo && <span className={styles.rowRepo}>{repo}</span>}
        <span className={styles.rowLabel}>{label}</span>
        {row.outdated ? (
          <Pill tone="warning" size="sm">
            {t('notes.outdated')}
          </Pill>
        ) : (
          row.note.resolved && (
            <Pill tone="neutral" size="sm">
              {t('notes.resolved')}
            </Pill>
          )
        )}
        {age && <span className={styles.age}>{age}</span>}
      </span>
      <span className={styles.rowText}>{row.note.text}</span>
    </button>
  );
}

function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}
function rangeText(r: Row) {
  return r.at.from === r.at.to ? String(r.at.to) : `${r.at.from}–${r.at.to}`;
}
function rangeShort(r: Row) {
  return `L${rangeText(r)}`;
}

function groupRows(rows: Row[]) {
  const out: { entry: NotesEntry; path: string; name: string; dir: string; first: boolean; rows: Row[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.entry.key === r.entry.key && last.path === r.note.path) {
      last.rows.push(r);
      continue;
    }
    const cut = r.note.path.lastIndexOf('/');
    out.push({
      entry: r.entry,
      path: r.note.path,
      name: r.note.path.slice(cut + 1),
      dir: cut > 0 ? r.note.path.slice(0, cut) : '',
      first: !last || last.entry.key !== r.entry.key,
      rows: [r],
    });
  }
  return out;
}

/** Clear All / Clear Resolved ask first (Settings › Prompts › "Clearing notes"). */
function ClearNotesModal({
  resolved,
  count,
  branch,
  onClose,
  onClear,
}: {
  resolved: boolean;
  count: number;
  branch: string | null;
  onClose: () => void;
  onClear: () => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  const title = t(resolved ? 'notes.clearResolvedTitle' : 'notes.clearTitle');
  return (
    <ConfirmModal
      aria-label={title}
      title={title}
      width={460}
      onClose={onClose}
      context={branch ? [{ icon: 'branch', text: branch }] : undefined}
      text={t(resolved ? 'notes.clearResolvedText' : 'notes.clearText', { ...cnt(count) })}
      dontAsk={{ checked: dontAsk, onChange: setDontAsk }}
    >
      <Button size={36} autoFocus onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button
        size={36}
        variant="danger"
        onClick={() => {
          if (dontAsk) stopAsking('clearNotes');
          onClear();
        }}
      >
        {t(resolved ? 'notes.clearResolvedButton' : 'notes.clearButton')}
      </Button>
    </ConfirmModal>
  );
}
