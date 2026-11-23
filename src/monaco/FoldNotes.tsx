import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as monaco from './monaco';
import { Icon } from '../components/icons';
import { t } from '../i18n';
import { cnt } from '../lib/format';
import styles from './DiffView.module.css';

type Side = 'original' | 'modified';
interface Zone {
  key: string;
  editor: Side;
  after: number;
}
interface Fold<Z> {
  start: number;
  top: number;
  zones: Z[];
}

interface LineRange {
  startLineNumber: number;
  endLineNumberExclusive: number;
}
interface Region {
  modifiedLineNumber: number;
  lineCount: number;
  getHiddenOriginalRange(reader: undefined): LineRange;
  getHiddenModifiedRange(reader: undefined): LineRange;
}

/** The lines a side's folds hide now. Monaco's diff model, not its public API (monaco-editor is
 * pinned); [] when it is not there. */
function hiddenRanges(diff: monaco.editor.IStandaloneDiffEditor, side: Side): LineRange[] {
  const model = (
    diff as unknown as { _diffModel?: { get(): { unchangedRegions?: { get(): Region[] } } | undefined } }
  )._diffModel?.get();
  const regions = model?.unchangedRegions?.get() ?? [];
  // One region over the whole file (no changes) is not folded (Monaco's own rule).
  const lines = diff.getModifiedEditor().getModel()?.getLineCount();
  if (regions.length === 1 && regions[0].modifiedLineNumber === 1 && regions[0].lineCount === lines) return [];
  return regions
    .map((r) => (side === 'original' ? r.getHiddenOriginalRange(undefined) : r.getHiddenModifiedRange(undefined)))
    .filter((r) => r.endLineNumberExclusive > r.startLineNumber);
}

/** A count of the notes a fold hides, on the right of its bar; clicking it opens the first. */
export function FoldNotes<Z extends Zone>({
  diff,
  side,
  zones,
  onOpen,
}: {
  diff: monaco.editor.IStandaloneDiffEditor;
  side: Side;
  zones: Z[];
  onOpen: (z: Z) => void;
}) {
  const ed = side === 'original' ? diff.getOriginalEditor() : diff.getModifiedEditor();
  const [node] = useState(() => {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = '100%';
    // Over the fold bars, which are overlay widgets added after this one.
    el.style.zIndex = '20';
    return el;
  });
  const [folds, setFolds] = useState<Fold<Z>[]>([]);
  const [right, setRight] = useState(0);
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  const same = (a: Z[], b: Z[]) => a.length === b.length && a.every((z, i) => z === b[i]);
  const compute = () => {
    const mine = zonesRef.current.filter((z) => z.key !== 'draft' && z.editor === side);
    const next: Fold<Z>[] = [];
    for (const r of mine.length ? hiddenRanges(diff, side) : []) {
      const inside = mine.filter((z) => z.after >= r.startLineNumber && z.after < r.endLineNumberExclusive);
      if (!inside.length) continue;
      // The fold's bar is a view zone right under the line above it.
      const top = r.startLineNumber > 1 ? ed.getBottomForLineNumber(r.startLineNumber - 1) : 0;
      next.push({ start: r.startLineNumber, top, zones: inside.sort((a, b) => a.after - b.after) });
    }
    setFolds((prev) =>
      prev.length === next.length &&
      prev.every((p, i) => p.start === next[i].start && p.top === next[i].top && same(p.zones, next[i].zones))
        ? prev
        : next,
    );
  };
  const computeRef = useRef(compute);
  computeRef.current = compute;

  useEffect(() => {
    const widget: monaco.editor.IOverlayWidget = {
      getId: () => `gg.foldNotes.${side}`,
      getDomNode: () => node,
      getPosition: () => null,
    };
    ed.addOverlayWidget(widget);
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => computeRef.current());
    };
    const scroll = () => (node.style.transform = `translateY(${-ed.getScrollTop()}px)`);
    // As far from the right edge as the bar's unfold icon (16px, centred in the gutter) is from
    // the left one; the chip's 6px padding is inside that gap.
    const layout = () => {
      const l = ed.getLayoutInfo();
      setRight(Math.max((l.contentLeft - 16) / 2 - 6, l.verticalScrollbarWidth));
    };
    const subs = [
      ed.onDidScrollChange(scroll),
      ed.onDidLayoutChange(() => {
        layout();
        later();
      }),
      // Folding and unfolding change the content's height.
      ed.onDidContentSizeChange(later),
      diff.onDidUpdateDiff(later),
    ];
    scroll();
    layout();
    later();
    return () => {
      cancelAnimationFrame(frame);
      for (const s of subs) s.dispose();
      ed.removeOverlayWidget(widget);
    };
  }, [diff, ed, node, side]);

  useEffect(() => computeRef.current(), [zones]);

  return createPortal(
    folds.map((f) => {
      const label = t('notes.count', { ...cnt(f.zones.length) });
      return (
        <button
          key={f.start}
          type="button"
          className={styles.foldNotes}
          style={{ top: f.top + 3, right }}
          aria-label={label}
          title={label}
          onClick={() => onOpen(f.zones[0])}
        >
          <Icon name="note" size={12} />
          {f.zones.length}
        </button>
      );
    }),
    node,
  );
}
