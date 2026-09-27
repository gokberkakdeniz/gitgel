import { DiffEditor } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { readFilePair } from '../lib/ipc';
import { useEffectiveTheme } from '../lib/theme';
import type { DiffLayout, DiffMode, FileChange } from '../lib/types';
import { useInvoke } from '../lib/useInvoke';
import styles from './DiffView.module.css';
import { hunkAtScroll, hunkTarget, type Hunk } from './changeNav';
import { languageForPath } from './language';
import { monacoReady } from './setup';
import { MONACO_THEMES } from './theme';

const OPTIONS: monaco.editor.IDiffEditorConstructionOptions = {
  readOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: false,
  renderIndicators: true,
  hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3 },
  fontFamily: 'JetBrains Mono',
  fontSize: 12,
  lineHeight: 20,
  minimap: { enabled: false },
  renderOverviewRuler: false,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  contextmenu: false,
};

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
  /** ⌥V / ⌥W while the diff has focus. */
  onToggleLayout: () => void;
  onToggleWhitespace: () => void;
  /** ⌥⇧↑ / ⌥⇧↓ while the diff has focus: newer (-1) / older (1) commit. */
  onCommitStep: (dir: 1 | -1) => void;
  /** ⌘K while the diff has focus: the file filter. */
  onFocusFilter: () => void;
}

/** Side-by-side diff of one file. The editor stays mounted; only its content changes. */
export function DiffView({
  repoId,
  worktreePath,
  change,
  mode,
  fileKey,
  land,
  onNav,
  onStep,
  navRef,
  layout,
  ignoreWhitespace,
  onToggleLayout,
  onToggleWhitespace,
  onCommitStep,
  onFocusFilter,
}: Props) {
  const [ready, setReady] = useState(false);
  const effective = useEffectiveTheme();
  useEffect(() => {
    void monacoReady.then(() => setReady(true));
  }, []);

  // Latest props for Monaco callbacks registered once.
  const latest = useRef({ onNav, onStep, land, fileKey, layout, onToggleLayout, onToggleWhitespace, onCommitStep, onFocusFilter });
  latest.current = { onNav, onStep, land, fileKey, layout, onToggleLayout, onToggleWhitespace, onCommitStep, onFocusFilter };

  // Layout and whitespace are editor options: changed in place, never by rebuilding the editor.
  // Monaco hides whitespace-only changes by default, so the option is always given.
  const options = useMemo(
    () => ({ ...OPTIONS, renderSideBySide: layout === 'split', ignoreTrimWhitespace: ignoreWhitespace }),
    [layout, ignoreWhitespace],
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
    shownKey: null as string | null,
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
    window.setTimeout(() => (n.jumping = false), 80);
    n.index = index;
    mark();
    report();
  };
  navRef.current = { goTo };

  const onDiffUpdated = () => {
    const m = mounted.current;
    const n = nav.current;
    if (!m) return;
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
      // Same file, new content: keep the place.
      if (n.index !== null) n.index = n.hunks.length ? Math.min(n.index, n.hunks.length - 1) : null;
      mark();
      report();
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

  // Ignoring whitespace changes which lines count as changes: restart at the first one.
  const firstWs = useRef(true);
  useEffect(() => {
    if (firstWs.current) {
      firstWs.current = false;
      return;
    }
    nav.current.restart = true;
  }, [ignoreWhitespace]);

  const message = data?.binary
    ? 'Binary file not shown'
    : data?.tooLarge
      ? 'File is too large to show (over 1 MB)'
      : null;

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
            // Read-only, so ⌥↑/⌥↓ (move line) is free for jumping. Listed in lib/shortcuts.ts.
            for (const ed of [original, modified]) {
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => latest.current.onStep(1));
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => latest.current.onStep(-1));
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyV, () => latest.current.onToggleLayout());
              ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyW, () => latest.current.onToggleWhitespace());
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
    </div>
  );
}
