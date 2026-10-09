import { DiffEditor } from '@monaco-editor/react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import * as monaco from 'monaco-editor';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { CopyIcon, LinkIcon } from '../components/icons';
import { Menu, MenuDivider, MenuItem } from '../components/Menu';
import { FileOpenItems } from '../components/OpenItems';
import { Popover } from '../components/Popover';
import { getGithubUrl, openGithubLink, readFilePair } from '../lib/ipc';
import { useEffectiveTheme } from '../lib/theme';
import type { DiffContext, DiffLayout, DiffMode, FileChange } from '../lib/types';
import { useInvoke } from '../lib/useInvoke';
import styles from './DiffView.module.css';
import { hunkAtScroll, hunkTarget, type Hunk } from './changeNav';
import { languageForPath } from './language';
import { diffPosition, setDiffPosition } from './position';
import { fileReference, permalink } from './reference';
import { monacoReady } from './setup';
import { MONACO_THEMES } from './theme';

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

interface Props {
  repoId: string;
  worktreePath: string | null;
  /** The folder the file is on disk in (worktree, else repository), for the absolute reference. */
  folder: string | null;
  /** The commit the file is shown at (its modified side), for the permalink; none, no permalink. */
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
  context,
  contextLines,
  onToggleLayout,
  onToggleWhitespace,
  onToggleContext,
  onCommitStep,
  onFocusFilter,
}: Props) {
  const [ready, setReady] = useState(false);
  /** The right-click menu: where it opens and the lines it refers to (`modified`: the new side). */
  const [menu, setMenu] = useState<{
    rect: DOMRect;
    from: number;
    to: number;
    endColumn: number;
    modified: boolean;
  } | null>(null);
  const effective = useEffectiveTheme();
  useEffect(() => {
    void monacoReady.then(() => setReady(true));
  }, []);

  // Latest props for Monaco callbacks registered once.
  const handlers = { onNav, onStep, onToggleLayout, onToggleWhitespace, onToggleContext, onCommitStep, onFocusFilter };
  const latest = useRef({ ...handlers, land, fileKey, layout, context, contextLines, path: change.path });
  latest.current = { ...handlers, land, fileKey, layout, context, contextLines, path: change.path };

  // Layout, whitespace and context are editor options: changed in place, never by rebuilding the
  // editor. Monaco hides whitespace-only changes by default, so the option is always given.
  const options = useMemo(
    () => ({
      ...OPTIONS,
      renderSideBySide: layout === 'split',
      ignoreTrimWhitespace: ignoreWhitespace,
      hideUnchangedRegions: folding(context, contextLines),
    }),
    [layout, ignoreWhitespace, context, contextLines],
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
      m.models.forEach((model) => model.dispose());
    },
    [],
  );

  const changeKey = `${change.path}\u0000${change.oldOid}\u0000${change.newOid}`;
  const { data } = useInvoke(
    // Tagged with the file it belongs to: the previous file stays on screen while loading.
    () => readFilePair(repoId, worktreePath, change).then((pair) => ({ ...pair, fileKey })),
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
  });

  const report = () => latest.current.onNav({ index: nav.current.index, count: nav.current.hunks.length });

  const mark = () => {
    const m = mounted.current;
    const n = nav.current;
    if (!m || n.decorations.length < 2) return;
    const h = n.index === null ? undefined : n.hunks[n.index];
    const deco = (start: number, end: number) =>
      end > 0 ? [{ range: new monaco.Range(start, 1, end, 1), options: { isWholeLine: true, className: 'gg-current-change' } }] : [];
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
    n.hunks = (m.editor.getLineChanges() ?? []).map((c) => ({
      originalStart: c.originalStartLineNumber,
      originalEnd: c.originalEndLineNumber,
      modifiedStart: c.modifiedStartLineNumber,
      modifiedEnd: c.modifiedEndLineNumber,
    }));
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

  // The repository's GitHub page, when the file is shown at a commit (for the permalink).
  const { data: githubData } = useInvoke(() => getGithubUrl(repoId), [repoId], { enabled: commit !== null });
  const github = commit !== null ? githubData : null;
  // The new side is the file at the commit, the old side at its parent (under its old name).
  const at = menu?.modified
    ? change.kind !== 'D' && commit && { sha: commit, path: change.path }
    : change.oldOid !== null && parent && { sha: parent, path: change.oldPath ?? change.path };
  const link = menu && github && at ? permalink(github, at.sha, at.path, menu.from, menu.to, menu.endColumn) : null;
  const copy = (text: string) => {
    void writeText(text);
    setMenu(null);
  };

  const message = data?.binary
    ? 'Binary file not shown'
    : data?.tooLarge
      ? 'File is too large to show (over 1 MB)'
      : null;

  // New content for the file on screen (another layer, a refresh): note the line at the top
  // before the editor takes it.
  useLayoutEffect(() => {
    const m = mounted.current;
    const n = nav.current;
    if (!m || !data || n.shownKey !== data.fileKey) return;
    n.keepLine = m.editor.getModifiedEditor().getVisibleRanges()[0]?.startLineNumber ?? null;
  }, [data]);

  // Which file's content is on screen. Monaco reports no diff update when the text does not
  // change (e.g. two binary files), so settle those here.
  const shownText = useRef<{ original: string; modified: string } | null>(null);
  useEffect(() => {
    nav.current.shownKey = data?.fileKey ?? null;
    const text = { original: message ? '' : (data?.original ?? ''), modified: message ? '' : (data?.modified ?? '') };
    const same =
      shownText.current?.original === text.original && shownText.current?.modified === text.modified;
    shownText.current = text;
    // Same text as before (another file with equal content, or both sides empty): the current
    // line changes still hold, so land now.
    if (data && same) onDiffUpdated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className={styles.view}>
      {ready && (
        <DiffEditor
          theme={MONACO_THEMES[effective]}
          language={language}
          original={message ? '' : (data?.original ?? '')}
          modified={message ? '' : (data?.modified ?? '')}
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
            modified.onDidChangeCursorPosition((e) =>
              setDiffPosition(latest.current.path, e.position.lineNumber, e.position.column),
            );
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
            // Right-click: copy a reference to the selected lines, else the clicked one.
            for (const ed of [original, modified]) {
              ed.onContextMenu((e) => {
                const line = e.target.position?.lineNumber;
                if (!line) return;
                const sel = ed.getSelection();
                const inSel = sel && !sel.isEmpty() && sel.containsPosition(e.target.position!);
                const { clientX, clientY } = e.event.browserEvent;
                setMenu({
                  rect: new DOMRect(clientX, clientY, 0, 0),
                  from: inSel ? sel.startLineNumber : line,
                  to: inSel ? sel.endLineNumber : line,
                  endColumn: inSel ? sel.endColumn : 2,
                  modified: ed === modified,
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
      {message && <div className={styles.message}>{message}</div>}
      {menu && (
        <Popover anchorRect={menu.rect} width={230} onClose={() => setMenu(null)}>
          <Menu aria-label="Diff actions" autoFocus>
            <MenuItem icon={<CopyIcon />} onSelect={() => copy(fileReference(change.path, menu.from, menu.to, menu.endColumn))}>
              Copy relative reference
            </MenuItem>
            {folder && (
              <MenuItem
                icon={<CopyIcon />}
                onSelect={() => copy(fileReference(`${folder}/${change.path}`, menu.from, menu.to, menu.endColumn))}
              >
                Copy absolute reference
              </MenuItem>
            )}
            {link && (
              <>
                <MenuItem icon={<CopyIcon />} onSelect={() => copy(link)}>
                  Copy permalink
                </MenuItem>
                <MenuItem
                  icon={<LinkIcon />}
                  onSelect={() => {
                    openGithubLink(link).catch((e) => console.error('cannot open link', e));
                    setMenu(null);
                  }}
                >
                  Open permalink
                </MenuItem>
              </>
            )}
            {/* The file on disk (not for a deleted one), at the clicked line of the new side. */}
            {folder && change.kind !== 'D' && (
              <>
                <MenuDivider />
                <FileOpenItems
                  folder={folder}
                  path={change.path}
                  at={() => (menu.modified ? { line: menu.from, column: 1 } : diffPosition(change.path))}
                  onDone={() => setMenu(null)}
                />
              </>
            )}
          </Menu>
        </Popover>
      )}
    </div>
  );
}
