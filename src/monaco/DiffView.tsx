import { DiffEditor } from '@monaco-editor/react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import * as monaco from './monaco';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CopyIcon, HistoryIcon, Icon, LinkIcon, NoteIcon } from '../components/icons';
import { Menu, MenuDivider, MenuItem } from '../components/Menu';
import { FileOpenItems } from '../components/OpenItems';
import { Popover } from '../components/Popover';
import { getBlame, getRemoteUrl, openRemoteLink, readFilePair } from '../lib/ipc';
import { t } from '../i18n';
import { useEffectiveTheme } from '../lib/theme';
import { locate, textLines } from '../lib/notes';
import type { DiffContext, DiffLayout, DiffMode, FileChange, Note } from '../lib/types';
import { useInvoke } from '../lib/useInvoke';
import { ImageDiff } from './ImageDiff';
import styles from './DiffView.module.css';
import { blameAt, blameText } from './blame';
import { hunkAtScroll, hunkTarget, type Hunk } from './changeNav';
import { cutHunks, hunkAt, hunkAtZone, stagedContent, wholeCut, withoutEmptySide, type Cut } from './lineStage';
import { languageForPath } from './language';
import { NoteCard, NoteDraft } from './NoteZone';
import { diffPosition, setDiffPosition } from './position';
import { fileReference, permalink } from './reference';
import { monacoReady } from './setup';

const OPTIONS: monaco.editor.IDiffEditorConstructionOptions = {
  readOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: false,
  renderIndicators: true,
  fontFamily: 'JetBrains Mono',
  fontSize: 12,
  lineHeight: 20,
  minimap: { enabled: false },
  // Monaco turns the pinned class / method header on whenever unchanged lines are not folded.
  stickyScroll: { enabled: false },
  renderOverviewRuler: false,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  contextmenu: false,
};

/** Monaco's folding of unchanged lines for a Context setting. */
function folding(context: DiffContext, contextLines: number): monaco.editor.IDiffEditorOptions['hideUnchangedRegions'] {
  return context === 'whole'
    ? { enabled: false }
    : { enabled: true, contextLineCount: contextLines, minimumLineCount: 3, revealLineCount: 20 };
}

/** The current change and how many there are. */
export interface NavInfo {
  index: number | null;
  count: number;
}

export interface DiffNav {
  goTo: (index: number) => void;
}

/** The texts on screen and the blobs they were read from (null: none, or the working tree). */
interface Shown {
  original: string;
  modified: string;
  oldOid: string | null;
  newOid: string | null;
}

/** Staging picked lines of an Uncommitted file (SPEC §15 "Stage"): an Unstaged row stages
 * them, a Staged row (`unstage`) takes them out of the index. */
export interface LineStage {
  unstage: boolean;
  /** Puts the file's new staged version in the index (null: the whole file, as the row's + / −),
   * made from the staged blob `expect` (null: none); resolves false when it could not. */
  apply: (content: string | null, expect: string | null) => Promise<boolean>;
}

/** Notes on the file's lines (SPEC §5 Review "Notes"): each sits in a view zone under the last
 * of its lines where the side shown still has them; resolved ones only with `showResolved`. */
export interface DiffNotes {
  /** The branch's notes on this file. */
  list: Note[];
  showResolved: boolean;
  onAdd: (note: Pick<Note, 'path' | 'side' | 'from' | 'to' | 'lines' | 'text'>) => void;
  onEdit: (id: string, text: string) => void;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  /** Scrolls to this note once it is placed (each `seq` once). */
  reveal: { id: string; seq: number } | null;
}

/** A note being written (`editId`: an existing note's text being changed). */
interface Draft {
  side: Note['side'];
  from: number;
  to: number;
  editId: string | null;
  text: string;
}

/** A note or the draft in a view zone: which editor, under which line. */
interface ZoneSpec {
  key: string;
  editor: 'original' | 'modified';
  after: number;
}

/** A note on screen: a view zone keeps its room between the lines, an overlay widget over that
 * room holds the card (VS Code's zone widgets do the same: the editor takes clicks in a view
 * zone for itself, never in an overlay widget). */
interface PlacedZone extends ZoneSpec {
  node: HTMLDivElement;
  ed: monaco.editor.ICodeEditor;
  zone: monaco.editor.IViewZone;
  widget: monaco.editor.IOverlayWidget;
  id: string;
}

let zoneSerial = 0;

interface Props {
  repoId: string;
  worktreePath: string | null;
  /** The folder the file is on disk in (worktree, else repository), for the absolute reference. */
  folder: string | null;
  /** The commit the file is shown at (its modified side), for the permalink; none (also for a
   * commit the remote does not have), no permalink. */
  commit: string | null;
  /** The commit's first parent: what the old side shows (none for a root commit). */
  parent: string | null;
  change: FileChange;
  mode: DiffMode;
  /** Identifies the file on screen; when it changes the view lands on a change. */
  fileKey: string;
  /** Where to land in a newly shown file (the last change when coming back from the next file). */
  land: 'first' | 'last';
  onNav: (info: NavInfo) => void;
  /** ⌥↓ / ⌥↑ while the diff has focus. */
  onStep: (dir: 1 | -1) => void;
  navRef: MutableRefObject<DiffNav | null>;
  layout: DiffLayout;
  ignoreWhitespace: boolean;
  /** Appearance › Diff › Tab size: spaces, both panes. */
  tabSize: number;
  /** Changes only (unchanged lines folded, `contextLines` kept around each change) or whole file. */
  context: DiffContext;
  contextLines: number;
  /** ⌥V / ⌥W while the diff has focus. */
  onToggleLayout: () => void;
  onToggleWhitespace: () => void;
  /** ⌥C while the diff has focus: changes only ↔ whole file. */
  onToggleContext: () => void;
  /** ⌥⇧↑ / ⌥⇧↓ while the diff has focus: newer (-1) / older (1) commit. */
  onCommitStep: (dir: 1 | -1) => void;
  /** ⌘K while the diff has focus: the file filter. */
  onFocusFilter: () => void;
  /** The right-click menu's Stage / Unstage items; none (a commit, or a stage or commit
   * running), no items. */
  lineStage?: LineStage | null;
  /** Blame of the new side (SPEC §5 "Blame"): the commit its lines are blamed at. `buffer`: the
   * text shown is not that commit's (the index's or the working tree's), so it goes along and
   * its own lines read "Not committed yet". None: off, or nothing to blame at. */
  blame?: { rev: string; buffer: boolean } | null;
  /** ⌥B while the diff has focus. */
  onToggleBlame?: () => void;
  /** The right-click menu's "File History"; none, no item. */
  onFileHistory?: ((path: string) => void) | null;
  /** The right-click menu's "Show Commit <sha>" for the blamed line; none, no item. */
  onShowCommit?: ((sha: string, path: string) => void) | null;
  /** Notes on lines; none (no branch, a stash), no notes and no Add Note. */
  notes?: DiffNotes | null;
}

/** Side-by-side diff of one file. The editor stays mounted; only its content changes. */
export function DiffView({
  repoId,
  worktreePath,
  folder,
  commit,
  parent,
  change,
  mode,
  fileKey,
  land,
  onNav,
  onStep,
  navRef,
  layout,
  ignoreWhitespace,
  tabSize,
  context,
  contextLines,
  onToggleLayout,
  onToggleWhitespace,
  onToggleContext,
  onCommitStep,
  onFocusFilter,
  lineStage = null,
  blame = null,
  onToggleBlame = () => {},
  onFileHistory = null,
  onShowCommit = null,
  notes = null,
}: Props) {
  const [ready, setReady] = useState(false);
  /** The right-click menu: where it opens and the lines it refers to (`modified`: the new side). */
  const [menu, setMenu] = useState<{
    rect: DOMRect;
    from: number;
    to: number;
    endColumn: number;
    modified: boolean;
    /** The selected lines' changes, cut down to them; the clicked change. */
    lines: Cut[] | null;
    change: Cut[] | null;
    /** The texts the changes are of. */
    text: Shown | null;
  } | null>(null);
  const effective = useEffectiveTheme();
  useEffect(() => {
    void monacoReady.then(() => setReady(true));
  }, []);

  // Latest props for Monaco callbacks registered once.
  const handlers = {
    onNav,
    onStep,
    onToggleLayout,
    onToggleWhitespace,
    onToggleContext,
    onCommitStep,
    onFocusFilter,
    onToggleBlame,
  };
  const latest = useRef({ ...handlers, land, fileKey, layout, context, contextLines, tabSize, path: change.path });
  latest.current = { ...handlers, land, fileKey, layout, context, contextLines, tabSize, path: change.path };

  // Layout, whitespace and context are editor options: changed in place, never by rebuilding the
  // editor. Monaco hides whitespace-only changes by default, so the option is always given.
  const options = useMemo(
    () => ({
      ...OPTIONS,
      renderSideBySide: layout === 'split',
      ignoreTrimWhitespace: ignoreWhitespace,
      hideUnchangedRegions: folding(context, contextLines),
      tabSize,
      insertSpaces: true,
      renderMarginRevertIcon: false,
    }),
    [layout, ignoreWhitespace, context, contextLines, tabSize],
  );

  // The wrapper would dispose the models before the editor lets go of them, which Monaco
  // reports as an error. It keeps them instead; here the editor is detached first.
  const mounted = useRef<{ editor: monaco.editor.IStandaloneDiffEditor; models: monaco.editor.ITextModel[] } | null>(
    null,
  );
  useEffect(
    () => () => {
      const m = mounted.current;
      if (!m) return;
      try {
        m.editor.setModel(null);
      } catch {
        // Already disposed.
      }
      for (const model of m.models) model.dispose();
    },
    [],
  );

  const changeKey = `${change.path}\u0000${change.oldOid}\u0000${change.newOid}`;
  const { data } = useInvoke(
    // Tagged with the file it belongs to: the previous file stays on screen while loading.
    () =>
      readFilePair(repoId, worktreePath, change).then((pair) => ({
        ...pair,
        fileKey,
        changeKey,
        oldOid: change.oldOid,
        newOid: change.newOid,
      })),
    [repoId, worktreePath, changeKey, mode, fileKey],
    // Blob contents never change; only a working-tree side needs refetching.
    { repoIds: change.newOid === null ? [repoId] : [] },
  );

  // ---- Changes (hunks), the current one, jumping (flow D4) ----
  const nav = useRef({
    hunks: [] as Hunk[],
    index: null as number | null,
    /** The file the view last landed in; a different file on screen lands again. */
    landedKey: null as string | null,
    /** Scrolling done by a jump, not by the user. */
    jumping: false,
    /** The next diff update restarts at the first change. */
    restart: false,
    /** The next diff update brings the current change back into view (the folds changed). */
    reveal: false,
    shownKey: null as string | null,
    /** The line at the top of the view before new content of the same file came in. */
    keepLine: null as number | null,
    decorations: [] as monaco.editor.IEditorDecorationsCollection[],
    /** The texts `hunks` were computed for; picked lines are staged only from those. */
    hunksFor: null as Shown | null,
  });

  /** Bumped when the changes are recomputed (the notes on removed lines follow them). */
  const [, setHunksVersion] = useState(0);
  /** Set further down: the selection toolbar follows the selection, ⌥N writes a note. */
  const pickedRef = useRef<(ed: monaco.editor.ICodeEditor | null) => void>(() => {});
  /** A mouse button is down in the editor (a selection being dragged). */
  const mouseSelecting = useRef(false);
  const noteKeyRef = useRef<(ed: monaco.editor.ICodeEditor) => void>(() => {});
  /** The editor is mounted: the notes' zones and decorations can go in. */
  const [editorOn, setEditorOn] = useState(false);

  /** Redraws the blame after the cursor's line (set further down). */
  const markBlameRef = useRef(() => {});

  const report = () => latest.current.onNav({ index: nav.current.index, count: nav.current.hunks.length });

  const mark = () => {
    const m = mounted.current;
    const n = nav.current;
    if (!m || n.decorations.length < 2) return;
    const h = n.index === null ? undefined : n.hunks[n.index];
    const deco = (start: number, end: number) =>
      end > 0
        ? [
            {
              range: new monaco.Range(start, 1, end, 1),
              options: { isWholeLine: true, className: 'gg-current-change' },
            },
          ]
        : [];
    n.decorations[0].set(h ? deco(h.originalStart, h.originalEnd) : []);
    n.decorations[1].set(h ? deco(h.modifiedStart, h.modifiedEnd) : []);
  };

  const goTo = (index: number) => {
    const m = mounted.current;
    const n = nav.current;
    const h = n.hunks[index];
    if (!m || !h) return;
    const target = hunkTarget(h, latest.current.layout === 'unified');
    const ed = target.side === 'original' ? m.editor.getOriginalEditor() : m.editor.getModifiedEditor();
    n.jumping = true;
    // Top third of the view; both sides scroll together.
    ed.setScrollTop(Math.max(0, ed.getTopForLineNumber(target.line) - ed.getLayoutInfo().height / 3));
    ed.setPosition({ lineNumber: target.line, column: 1 });
    // A change on the old side only: the file's line is where the lines were removed.
    if (target.side === 'original') setDiffPosition(latest.current.path, Math.max(1, h.modifiedStart), 1);
    window.setTimeout(() => (n.jumping = false), 80);
    n.index = index;
    mark();
    report();
  };
  navRef.current = { goTo };

  // Monaco carries each fold's open / closed state over from the previous content through markers
  // on the text, but a new file arrives with setValue, which drops them, and Monaco then opens every
  // fold. Switching folding off and on closes them all again (what Whole file → Changes only does).
  const refold = () => {
    const m = mounted.current;
    const { context, contextLines } = latest.current;
    if (!m || context === 'whole') return;
    m.editor.updateOptions({ hideUnchangedRegions: { enabled: false } });
    m.editor.updateOptions({ hideUnchangedRegions: folding(context, contextLines) });
  };

  const onDiffUpdated = () => {
    const m = mounted.current;
    const n = nav.current;
    if (!m) return;
    refold();
    markBlameRef.current();
    n.hunksFor = shownText.current;
    n.hunks = (m.editor.getLineChanges() ?? []).map((c) => ({
      originalStart: c.originalStartLineNumber,
      originalEnd: c.originalEndLineNumber,
      modifiedStart: c.modifiedStartLineNumber,
      modifiedEnd: c.modifiedEndLineNumber,
    }));
    setHunksVersion((v) => v + 1);
    const { fileKey: wanted, land: where } = latest.current;
    if (n.restart) {
      // Whitespace setting changed: the changes are different ones now, start at the first.
      n.restart = false;
      n.index = null;
      if (n.hunks.length > 0) goTo(0);
      else report();
    } else if (n.shownKey === wanted && n.landedKey !== wanted) {
      // A newly shown file: land on its first (or last) change.
      n.landedKey = wanted;
      n.index = null;
      if (n.hunks.length > 0) goTo(where === 'last' ? n.hunks.length - 1 : 0);
      else report();
    } else {
      // Same file, new content (or new folds): keep the place.
      if (n.index !== null) n.index = n.hunks.length ? Math.min(n.index, n.hunks.length - 1) : null;
      const reveal = n.reveal;
      n.reveal = false;
      const keep = n.keepLine;
      n.keepLine = null;
      if (keep !== null) {
        // The new content folds differently: bring the same line back to the top once it has.
        const ed = m.editor.getModifiedEditor();
        requestAnimationFrame(() => ed.setScrollTop(ed.getTopForLineNumber(keep)));
        mark();
        report();
      } else if (reveal && n.index !== null) goTo(n.index);
      else {
        mark();
        report();
      }
    }
  };
  const language = useMemo(() => languageForPath(change.path, monaco.languages.getLanguages()), [change.path]);

  // Switching layout keeps the current change and brings it back into view.
  const firstLayout = useRef(true);
  useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false;
      return;
    }
    const index = nav.current.index;
    if (index !== null) requestAnimationFrame(() => goTo(index));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Changing the context re-folds the file: keep the current change and bring it back into view,
  // now and again once Monaco has recomputed the folds (a new line count recomputes the diff).
  const firstContext = useRef(true);
  useEffect(() => {
    if (firstContext.current) {
      firstContext.current = false;
      return;
    }
    // Folds opened while Whole file was on (a file opened meanwhile comes back all open) close.
    refold();
    nav.current.reveal = true;
    const index = nav.current.index;
    if (index !== null) requestAnimationFrame(() => goTo(index));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, contextLines]);

  // Ignoring whitespace changes which lines count as changes: restart at the first one.
  const firstWs = useRef(true);
  useEffect(() => {
    if (firstWs.current) {
      firstWs.current = false;
      return;
    }
    nav.current.restart = true;
  }, [ignoreWhitespace]);

  // The remote page, when the file is shown at a commit (for the permalink).
  const { data: remoteData } = useInvoke(() => getRemoteUrl(repoId), [repoId], { enabled: commit !== null });
  const remote = commit !== null ? remoteData : null;
  // The new side is the file at the commit, the old side at its parent (under its old name).
  const at = menu?.modified
    ? change.kind !== 'D' && commit && { sha: commit, path: change.path }
    : change.oldOid !== null && parent && { sha: parent, path: change.oldPath ?? change.path };
  const link = menu && remote && at ? permalink(remote, at.sha, at.path, menu.from, menu.to, menu.endColumn) : null;
  const copy = (text: string) => {
    void writeText(text);
    setMenu(null);
  };

  const message = data?.binary ? t('diff.binary') : data?.tooLarge ? t('diff.tooLarge') : null;

  // Picked lines being staged: the index side shows their new staged version at once, until the
  // index read after the stage brings the file in again (another change key) or the stage failed.
  const [staging, setStaging] = useState<{
    fileKey: string;
    changeKey: string;
    side: 'original' | 'modified';
    text: string;
  } | null>(null);
  const pending =
    staging && data && staging.fileKey === data.fileKey && staging.changeKey === data.changeKey ? staging : null;
  const shown: Shown = useMemo(
    () => ({
      original: message ? '' : pending?.side === 'original' ? pending.text : (data?.original ?? ''),
      modified: message ? '' : pending?.side === 'modified' ? pending.text : (data?.modified ?? ''),
      oldOid: data?.oldOid ?? null,
      newOid: data?.newOid ?? null,
    }),
    [data, message, pending],
  );

  // New content for the file on screen (another layer, a refresh, staged lines): note the line
  // at the top before the editor takes it.
  useLayoutEffect(() => {
    const m = mounted.current;
    const n = nav.current;
    if (!m || !data || n.shownKey !== data.fileKey) return;
    n.keepLine = m.editor.getModifiedEditor().getVisibleRanges()[0]?.startLineNumber ?? null;
  }, [shown]);

  // Which file's content is on screen. Monaco reports no diff update when the text does not
  // change (e.g. two binary files), so settle those here.
  const shownText = useRef<Shown | null>(null);
  useEffect(() => {
    nav.current.shownKey = data?.fileKey ?? null;
    const same = shownText.current?.original === shown.original && shownText.current?.modified === shown.modified;
    shownText.current = shown;
    // Same text as before (another file with equal content, or both sides empty): the current
    // line changes still hold, so land now.
    if (data && same) onDiffUpdated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // Lines can be staged from text read whole and as it is, once the last stage was read back.
  const canStage = !!lineStage && !!data && !data.binary && !data.tooLarge && !data.lossy && !pending;

  // ---- Blame: the commit behind the cursor's line of the new side, after that line ----
  const blamePath = blame?.buffer ? (change.oldPath ?? change.path) : change.path;
  const blameKey = blame ? `${blame.rev}\u0000${blamePath}\u0000${fileKey}` : '';
  const blameOn =
    !!blame &&
    change.kind !== 'D' &&
    !!data &&
    data.fileKey === fileKey &&
    !data.binary &&
    !data.tooLarge &&
    !data.image;
  const blameContent = blame?.buffer ? shown.modified : null;
  const { data: blameRead } = useInvoke(
    () => getBlame(repoId, blame!.rev, blamePath, blameContent).then((b) => ({ ...b, key: blameKey })),
    [repoId, blameKey, blameContent],
    { enabled: blameOn },
  );
  const blamed = blameOn && blameRead?.key === blameKey ? blameRead : null;
  const blameRef = useRef<{ blamed: typeof blamed; deco: monaco.editor.IEditorDecorationsCollection | null }>({
    blamed: null,
    deco: null,
  });
  blameRef.current.blamed = blamed;
  const markBlame = () => {
    const m = mounted.current;
    const { blamed: b, deco } = blameRef.current;
    if (!m || !deco) return;
    const ed = m.editor.getModifiedEditor();
    const model = ed.getModel();
    const line = ed.getPosition()?.lineNumber;
    const commit = b && line ? blameAt(b, line) : undefined;
    if (!model || !line || line > model.getLineCount() || commit === undefined) {
      deco.clear();
      return;
    }
    const column = model.getLineMaxColumn(line);
    deco.set([
      {
        range: new monaco.Range(line, column, line, column),
        options: { showIfCollapsed: true, after: { content: blameText(commit), inlineClassName: 'gg-blame' } },
      },
    ]);
  };
  markBlameRef.current = markBlame;
  useEffect(() => {
    markBlame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blamed, ready]);
  // The commit behind the menu's line, when it is another one than the commit shown.
  const menuCommit = menu?.modified && blamed ? blameAt(blamed, menu.from) : null;
  const showCommit = menuCommit && onShowCommit && (blame?.buffer || menuCommit.sha !== blame?.rev) ? menuCommit : null;

  // Stage / Unstage from the menu: the cuts' new staged version, or the whole file when they
  // take all of it. Made from the texts the menu was opened on, if they are still on screen.
  const stageCuts = (cuts: Cut[], text: Shown | null) => {
    setMenu(null);
    if (!lineStage || !data || !text || text !== nav.current.hunksFor) return;
    const content = stagedContent(text.original, text.modified, cuts, lineStage.unstage);
    const expect = lineStage.unstage ? text.newOid : text.oldOid;
    if (content === (lineStage.unstage ? text.original : text.modified)) {
      void lineStage.apply(null, expect);
      return;
    }
    const next = {
      fileKey: data.fileKey,
      changeKey: data.changeKey,
      side: lineStage.unstage ? ('modified' as const) : ('original' as const),
      text: content,
    };
    setStaging(next);
    void lineStage.apply(content, expect).then((ok) => {
      if (!ok) setStaging((s) => (s === next ? null : s));
    });
  };

  // ---- Notes on lines (SPEC §5 Review "Notes") ----
  const notesOn =
    !!notes && !!data && data.fileKey === fileKey && !data.binary && !data.tooLarge && !data.image && !pending;
  const [draft, setDraft] = useState<Draft | null>(null);
  /** The note whose card is hovered or focused: its lines are tinted. */
  const [litNote, setLitNote] = useState<string | null>(null);
  useEffect(() => setDraft(null), [fileKey]);
  const sideLines = useMemo(() => ({ old: textLines(shown.original), new: textLines(shown.modified) }), [shown]);
  /** Each note where the side shown has its lines (an outdated one, nowhere). */
  const placed = useMemo(() => {
    if (!notesOn || !notes) return [];
    return notes.list.flatMap((note) => {
      if ((note.resolved && !notes.showResolved) || draft?.editId === note.id) return [];
      const at = locate(note, sideLines[note.side]);
      return at ? [{ note, ...at }] : [];
    });
  }, [notesOn, notes, sideLines, draft?.editId]);
  const unified = layout === 'unified';
  /** A removed line's place: the old side in split, else the new line its change ends on. */
  const oldPlace = (line: number): Omit<ZoneSpec, 'key'> | null => {
    if (!unified) return { editor: 'original', after: line };
    const h = nav.current.hunks.find((x) => x.originalEnd > 0 && line >= x.originalStart && line <= x.originalEnd);
    return h ? { editor: 'modified', after: h.modifiedEnd > 0 ? h.modifiedEnd : h.modifiedStart } : null;
  };
  const place = (side: Note['side'], to: number) =>
    side === 'new' ? { editor: 'modified' as const, after: to } : oldPlace(to);
  const specs: ZoneSpec[] = [
    ...placed.flatMap((p) => {
      const at = place(p.note.side, p.to);
      return at ? [{ key: p.note.id, ...at }] : [];
    }),
    ...(notesOn && draft ? [place(draft.side, draft.to)].flatMap((at) => (at ? [{ key: 'draft', ...at }] : [])) : []),
  ];
  const specKey = JSON.stringify(specs);
  const [zones, setZones] = useState<PlacedZone[]>([]);
  const zonesRef = useRef<PlacedZone[]>([]);
  const zoneHeights = useRef(new Map<string, number>());
  useEffect(() => {
    const m = mounted.current;
    if (!m) return;
    for (const z of zonesRef.current) {
      z.ed.changeViewZones((acc) => acc.removeZone(z.id));
      z.ed.removeOverlayWidget(z.widget);
    }
    const next = (JSON.parse(specKey) as ZoneSpec[]).map((spec) => {
      const ed = spec.editor === 'original' ? m.editor.getOriginalEditor() : m.editor.getModifiedEditor();
      const node = document.createElement('div');
      node.className = 'gg-note-zone';
      node.style.position = 'absolute';
      node.style.left = '0';
      node.style.display = 'none';
      // The editor's own keys (⌥C, ⌘K…) stay out of the notes. React's handlers listen at the
      // root, so the zone's keys are handled on their own elements (NoteDraft).
      for (const type of ['keydown', 'keyup', 'keypress'] as const)
        node.addEventListener(type, (e) => e.stopPropagation());
      const widgetId = `gg.note.${++zoneSerial}`;
      const widget: monaco.editor.IOverlayWidget = {
        getId: () => widgetId,
        getDomNode: () => node,
        // Placed by hand, over its zone.
        getPosition: () => null,
      };
      ed.addOverlayWidget(widget);
      const zone: monaco.editor.IViewZone = {
        afterLineNumber: spec.after,
        heightInPx: zoneHeights.current.get(spec.key) ?? (spec.key === 'draft' ? 152 : 72),
        domNode: document.createElement('div'),
        // Under the removed lines Monaco shows at the same line (unified).
        ordinal: 1_000_000,
        // Where the zone is in the view now; far above it when it is out of view.
        onDomNodeTop: (top) => {
          node.style.top = `${top}px`;
          node.style.display = top < -100_000 ? 'none' : '';
        },
      };
      let id = '';
      ed.changeViewZones((acc) => {
        id = acc.addZone(zone);
      });
      return { ...spec, node, ed, zone, widget, id };
    });
    zonesRef.current = next;
    setZones(next);
  }, [specKey, editorOn]);
  const fitZone = (z: PlacedZone, height: number) => {
    zoneHeights.current.set(z.key, height);
    if (Math.abs((z.zone.heightInPx ?? 0) - height) < 1) return;
    z.zone.heightInPx = height;
    z.ed.changeViewZones((acc) => acc.layoutZone(z.id));
  };

  // The lines a note covers have accent numbers; the lines of the note being written are tinted.
  const noteDeco = useRef<monaco.editor.IEditorDecorationsCollection[]>([]);
  useEffect(() => {
    const [orig, mod] = noteDeco.current;
    if (!orig || !mod) return;
    const lineDeco = (from: number, to: number, className: string) => ({
      range: new monaco.Range(from, 1, to, 1),
      options: { isWholeLine: true, lineNumberClassName: 'gg-note-line', className },
    });
    const of = (side: Note['side']) => [
      ...placed
        .filter((p) => p.note.side === side)
        .map((p) => lineDeco(p.from, p.to, p.note.id === litNote ? 'gg-note-draft' : '')),
      ...(notesOn && draft && draft.side === side ? [lineDeco(draft.from, draft.to, 'gg-note-draft')] : []),
    ];
    orig.set(of('old'));
    mod.set(of('new'));
  }, [placed, draft, notesOn, editorOn, litNote]);

  /** Whether a note can be written on this line: any line of the new side, a removed line of the old. */
  const canNote = (side: Note['side'], line: number) =>
    side === 'new' ||
    nav.current.hunks.some((h) => h.originalEnd > 0 && line >= h.originalStart && line <= h.originalEnd);
  const startNote = (side: Note['side'], from: number, to: number) => {
    setMenu(null);
    setPicked(null);
    setDraft({ side, from: Math.min(from, to), to: Math.max(from, to), editId: null, text: '' });
  };

  // ---- The selection toolbar: whole lines picked (by their numbers) → Add Note, Stage ----
  const viewRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<{
    side: Note['side'];
    from: number;
    to: number;
    top: number;
    right: number;
  } | null>(null);
  const pickedEd = useRef<monaco.editor.ICodeEditor | null>(null);
  /** The lines a selection in `ed` touches (one ending at the start of a line leaves it out);
   * null with nothing selected. */
  const selectedLines = (ed: monaco.editor.ICodeEditor) => {
    const sel = ed.getSelection();
    if (!sel || sel.isEmpty()) return null;
    const endsAtLineStart = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber;
    return { from: sel.startLineNumber, to: endsAtLineStart ? sel.endLineNumber - 1 : sel.endLineNumber };
  };
  pickedRef.current = (changed) => {
    const m = mounted.current;
    const box = viewRef.current;
    if (changed) pickedEd.current = changed;
    const ed = pickedEd.current;
    if (!m || !box || !ed) return setPicked(null);
    // Not while the mouse is still selecting: it shows once the button is up.
    if (mouseSelecting.current) return setPicked(null);
    const lines = selectedLines(ed);
    const side: Note['side'] = ed === m.editor.getModifiedEditor() ? 'new' : 'old';
    if (!lines || (unified && side === 'old')) return setPicked(null);
    const l = ed.getLayoutInfo();
    const edBox = ed.getDomNode()?.getBoundingClientRect();
    const outer = box.getBoundingClientRect();
    if (!edBox) return setPicked(null);
    const top = edBox.top - outer.top + ed.getTopForLineNumber(lines.to + 1) - ed.getScrollTop() + 2;
    const right = outer.right - (edBox.left + l.width - l.verticalScrollbarWidth) + 12;
    // Out of view: no toolbar.
    if (top < 0 || top > edBox.height) return setPicked(null);
    setPicked((p) =>
      p && p.side === side && p.from === lines.from && p.to === lines.to && p.top === top && p.right === right
        ? p
        : { side, ...lines, top, right },
    );
  };
  /** The picked lines' changes, cut to them (what Stage Selected Lines takes). */
  const pickedCuts = () => {
    const n = nav.current;
    const text = n.hunksFor;
    if (!picked || !text || text !== shownText.current) return null;
    const hunks = withoutEmptySide(n.hunks, text.original, text.modified);
    const cuts = cutHunks(hunks, {
      side: picked.side === 'new' ? 'modified' : 'original',
      from: picked.from,
      to: picked.to,
      lines: sideLines[picked.side].length,
    });
    return cuts.length ? { cuts, text } : null;
  };
  const allRemoved = (from: number, to: number) => {
    for (let l = from; l <= to; l++) if (!canNote('old', l)) return false;
    return true;
  };
  const unpick = () => {
    const ed = pickedEd.current;
    const sel = ed?.getSelection();
    if (ed && sel)
      ed.setSelection(new monaco.Selection(sel.endLineNumber, sel.endColumn, sel.endLineNumber, sel.endColumn));
    setPicked(null);
  };
  const toolbarNote = picked && notesOn && (picked.side === 'new' || allRemoved(picked.from, picked.to));
  const toolbarStage = picked && canStage ? pickedCuts() : null;
  // ⌥N: a note on the selected lines, else on the cursor's line.
  noteKeyRef.current = (ed) => {
    const m = mounted.current;
    if (!m || !notesOn) return;
    const side: Note['side'] = ed === m.editor.getModifiedEditor() ? 'new' : 'old';
    const sel = ed.getSelection();
    if (!sel) return;
    const to =
      sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber;
    const from = Math.min(sel.startLineNumber, to);
    if (side === 'old' && !allRemoved(from, to)) return;
    ed.setPosition({ lineNumber: to, column: 1 });
    startNote(side, from, to);
  };
  const saveDraft = (text: string) => {
    const d = draft;
    if (!d || !notes) return;
    if (d.editId) notes.onEdit(d.editId, text);
    else
      notes.onAdd({
        path: change.path,
        side: d.side,
        from: d.from,
        to: d.to,
        lines: sideLines[d.side].slice(d.from - 1, d.to),
        text,
      });
    setDraft(null);
  };

  // Popover's notes open their file at them (once per `seq`), after the view lands.
  const revealed = useRef(0);
  useEffect(() => {
    const r = notes?.reveal;
    if (!r || r.seq === revealed.current) return;
    const z = zones.find((x) => x.key === r.id);
    if (!z) return;
    revealed.current = r.seq;
    window.setTimeout(() => {
      nav.current.jumping = true;
      z.ed.setScrollTop(Math.max(0, z.ed.getTopForLineNumber(z.after) - z.ed.getLayoutInfo().height / 3));
      window.setTimeout(() => (nav.current.jumping = false), 80);
    }, 120);
  }, [zones, notes?.reveal]);

  const zoneBody = (z: PlacedZone): ReactNode => {
    if (z.key === 'draft') {
      if (!draft) return null;
      return (
        <NoteDraft
          key={`${draft.editId ?? 'new'}:${draft.side}:${draft.from}`}
          from={draft.from}
          to={draft.to}
          initial={draft.text}
          onSave={saveDraft}
          onCancel={() => setDraft(null)}
        />
      );
    }
    const p = placed.find((x) => x.note.id === z.key);
    if (!p || !notes) return null;
    return (
      <NoteCard
        from={p.from}
        to={p.to}
        text={p.note.text}
        resolved={p.note.resolved}
        onResolve={() => notes.onResolve(p.note.id, !p.note.resolved)}
        onEdit={() => setDraft({ side: p.note.side, from: p.from, to: p.to, editId: p.note.id, text: p.note.text })}
        onDelete={() => notes.onDelete(p.note.id)}
        onLight={(on) => setLitNote((id) => (on ? p.note.id : id === p.note.id ? null : id))}
      />
    );
  };

  return (
    <div ref={viewRef} className={styles.view}>
      {ready && (
        <DiffEditor
          theme={effective}
          language={language}
          original={shown.original}
          modified={shown.modified}
          options={options}
          loading={null}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          onMount={(editor) => {
            const model = editor.getModel();
            mounted.current = { editor, models: model ? [model.original, model.modified] : [] };
            const original = editor.getOriginalEditor();
            const modified = editor.getModifiedEditor();
            nav.current.decorations = [original.createDecorationsCollection(), modified.createDecorationsCollection()];
            editor.onDidUpdateDiff(onDiffUpdated);
            blameRef.current.deco = modified.createDecorationsCollection();
            noteDeco.current = [original.createDecorationsCollection(), modified.createDecorationsCollection()];
            setEditorOn(true);
            // Lines picked as whole lines get the selection toolbar (SPEC §5 Review "Notes").
            for (const ed of [original, modified]) {
              ed.onDidChangeCursorSelection(() => pickedRef.current(ed));
              ed.onMouseDown(() => {
                mouseSelecting.current = true;
                pickedRef.current(ed);
                const up = () => {
                  document.removeEventListener('pointerup', up, true);
                  mouseSelecting.current = false;
                  pickedRef.current(ed);
                };
                document.addEventListener('pointerup', up, true);
              });
              ed.onDidScrollChange(() => pickedRef.current(null));
              ed.onDidLayoutChange(() => pickedRef.current(null));
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyN, () => noteKeyRef.current(ed));
            }
            modified.onDidChangeCursorPosition((e) => {
              setDiffPosition(latest.current.path, e.position.lineNumber, e.position.column);
              markBlameRef.current();
            });
            modified.onDidChangeModelContent(() => markBlameRef.current());
            // Scrolling by hand moves "current" to the first change in view.
            modified.onDidScrollChange(() => {
              const n = nav.current;
              if (n.jumping || n.hunks.length === 0) return;
              const first = modified.getVisibleRanges()[0]?.startLineNumber ?? 1;
              const index = hunkAtScroll(n.hunks, first);
              if (index !== n.index) {
                n.index = index;
                mark();
                report();
              }
            });
            // Right-click: copy a reference to the selected lines, else the clicked one; stage
            // the selected lines or the clicked change.
            for (const ed of [original, modified]) {
              ed.onContextMenu((e) => {
                if ((e.event.browserEvent.target as Element | null)?.closest?.('.gg-note-zone')) return;
                const { clientX, clientY } = e.event.browserEvent;
                const rect = new DOMRect(clientX, clientY, 0, 0);
                const n = nav.current;
                // The changes are those of the text on screen (not one still being diffed).
                const text = n.hunksFor;
                const hunks =
                  text && text === shownText.current ? withoutEmptySide(n.hunks, text.original, text.modified) : [];
                const side = ed === modified ? ('modified' as const) : ('original' as const);
                // Unified layout: removed lines are a view zone of the new side (Monaco gives the
                // line above as its position).
                const zone =
                  e.target.type === monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE
                    ? hunkAtZone(hunks, e.target.detail.afterLineNumber)
                    : null;
                const line = e.target.position?.lineNumber;
                if (!line) return;
                const sel = ed.getSelection();
                const inSel = sel && !sel.isEmpty() && sel.containsPosition(e.target.position!);
                // A selection ending at the start of a line (line numbers clicked) leaves it out.
                const to =
                  inSel && sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber
                    ? sel.endLineNumber - 1
                    : (sel?.endLineNumber ?? line);
                const lines = inSel
                  ? cutHunks(hunks, { side, from: sel.startLineNumber, to, lines: ed.getModel()?.getLineCount() ?? 0 })
                  : [];
                const at = zone ?? hunkAt(hunks, side, line);
                const change = at ? [wholeCut(at)] : null;
                setMenu({
                  rect,
                  from: inSel ? sel.startLineNumber : line,
                  to: inSel ? sel.endLineNumber : line,
                  endColumn: inSel ? sel.endColumn : 2,
                  modified: ed === modified,
                  lines: lines.length > 0 ? lines : null,
                  // Left out when the selection takes the same.
                  change: change && JSON.stringify(change) !== JSON.stringify(lines) ? change : null,
                  text,
                });
              });
            }
            // Read-only, so ⌥↑/⌥↓ (move line) is free for jumping. Listed in lib/shortcuts.ts.
            for (const ed of [original, modified]) {
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => latest.current.onStep(1));
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => latest.current.onStep(-1));
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyV, () => latest.current.onToggleLayout());
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyW, () => latest.current.onToggleWhitespace());
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyC, () => latest.current.onToggleContext());
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyB, () => latest.current.onToggleBlame());
              // ⌥⇧↑/⌥⇧↓ (copy line) is free too.
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.UpArrow, () =>
                latest.current.onCommitStep(-1),
              );
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.DownArrow, () =>
                latest.current.onCommitStep(1),
              );
              // ⌘K is otherwise the prefix of Monaco's editing chords, which read-only does not need.
              ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => latest.current.onFocusFilter());
            }
          }}
        />
      )}
      {data?.image ? <ImageDiff image={data.image} /> : message && <div className={styles.message}>{message}</div>}
      {menu && (
        <Popover anchorRect={menu.rect} width={230} onClose={() => setMenu(null)}>
          <Menu aria-label={t('diff.actions')} autoFocus>
            {canStage && (menu.lines || menu.change) && (
              <>
                {menu.lines && (
                  <MenuItem
                    icon={lineStage.unstage ? 'remove' : 'plus'}
                    onSelect={() => stageCuts(menu.lines!, menu.text)}
                  >
                    {t(lineStage.unstage ? 'diff.unstageLines' : 'diff.stageLines')}
                  </MenuItem>
                )}
                {menu.change && (
                  <MenuItem
                    icon={lineStage.unstage ? 'remove' : 'plus'}
                    onSelect={() => stageCuts(menu.change!, menu.text)}
                  >
                    {t(lineStage.unstage ? 'diff.unstageChange' : 'diff.stageChange')}
                  </MenuItem>
                )}
                <MenuDivider />
              </>
            )}
            {(showCommit || onFileHistory) && (
              <>
                {showCommit && (
                  <MenuItem
                    icon={<HistoryIcon />}
                    onSelect={() => {
                      setMenu(null);
                      onShowCommit?.(showCommit.sha, change.path);
                    }}
                  >
                    {t('diff.showCommit', { sha: showCommit.shortSha })}
                  </MenuItem>
                )}
                {onFileHistory && (
                  <MenuItem
                    icon={<HistoryIcon />}
                    onSelect={() => {
                      setMenu(null);
                      onFileHistory(change.path);
                    }}
                  >
                    {t('review.fileHistory')}
                  </MenuItem>
                )}
                <MenuDivider />
              </>
            )}
            {notesOn && (menu.modified || menu.change || menu.lines) && (
              <MenuItem
                icon={<NoteIcon />}
                kbd="⌥N"
                onSelect={() =>
                  startNote(
                    menu.modified ? 'new' : 'old',
                    menu.from,
                    menu.endColumn === 1 && menu.to > menu.from ? menu.to - 1 : menu.to,
                  )
                }
              >
                {t('notes.add')}
              </MenuItem>
            )}
            <MenuItem
              icon={<CopyIcon />}
              onSelect={() => copy(fileReference(change.path, menu.from, menu.to, menu.endColumn))}
            >
              {t('diff.copyRelative')}
            </MenuItem>
            {folder && (
              <MenuItem
                icon={<CopyIcon />}
                onSelect={() => copy(fileReference(`${folder}/${change.path}`, menu.from, menu.to, menu.endColumn))}
              >
                {t('diff.copyAbsolute')}
              </MenuItem>
            )}
            {link && (
              <>
                <MenuItem icon={<CopyIcon />} onSelect={() => copy(link)}>
                  {t('diff.copyPermalink')}
                </MenuItem>
                <MenuItem
                  icon={<LinkIcon />}
                  onSelect={() => {
                    openRemoteLink(link).catch((e) => console.error('cannot open link', e));
                    setMenu(null);
                  }}
                >
                  {t('diff.openPermalink')}
                </MenuItem>
              </>
            )}
            {/* The file on disk (not for a deleted one), at the clicked line of the new side. */}
            {folder && change.kind !== 'D' && (
              <>
                <MenuDivider />
                <FileOpenItems
                  files={[{ folder, path: change.path }]}
                  at={() => (menu.modified ? { line: menu.from, column: 1 } : diffPosition(change.path))}
                  onDone={() => setMenu(null)}
                />
              </>
            )}
          </Menu>
        </Popover>
      )}
      {picked && (toolbarNote || toolbarStage) && (
        <div
          className={styles.toolbar}
          role="toolbar"
          aria-label={t('notes.selectedLines')}
          style={{ top: picked.top, right: picked.right }}
        >
          {toolbarNote && (
            <button
              type="button"
              className={styles.toolButton}
              aria-label={t('notes.addHint')}
              title={t('notes.addHint')}
              onClick={() => {
                const p = picked;
                unpick();
                startNote(p.side, p.from, p.to);
              }}
            >
              <NoteIcon size={14} />
            </button>
          )}
          {toolbarStage && lineStage && (
            <button
              type="button"
              className={styles.toolButton}
              aria-label={t(lineStage.unstage ? 'diff.unstageLines' : 'diff.stageLines')}
              title={t(lineStage.unstage ? 'diff.unstageLines' : 'diff.stageLines')}
              onClick={() => {
                unpick();
                stageCuts(toolbarStage.cuts, toolbarStage.text);
              }}
            >
              <Icon name={lineStage.unstage ? 'remove' : 'plus'} size={14} />
            </button>
          )}
        </div>
      )}
      {zones.map((z) =>
        createPortal(
          <ZoneBody ed={z.ed} onHeight={(h) => fitZone(z, h)}>
            {zoneBody(z)}
          </ZoneBody>,
          z.node,
          `${z.key}:${z.id}`,
        ),
      )}
    </div>
  );
}

/** A note's content over its zone: from the code column to the scrollbar; the zone takes its
 * height. */
function ZoneBody({
  ed,
  onHeight,
  children,
}: {
  ed: monaco.editor.ICodeEditor;
  onHeight: (height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onHeight);
  report.current = onHeight;
  const view = () => {
    const l = ed.getLayoutInfo();
    return { width: Math.max(0, l.width - l.contentLeft - l.verticalScrollbarWidth), left: l.contentLeft };
  };
  const [box, setBox] = useState(view);
  useEffect(() => {
    const update = () => setBox(view());
    const subs = [ed.onDidLayoutChange(update)];
    update();
    return () => {
      for (const sub of subs) sub.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => report.current(el.offsetHeight));
    ro.observe(el);
    report.current(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ display: 'flow-root', width: box.width, marginLeft: box.left }}>
      {children}
    </div>
  );
}
