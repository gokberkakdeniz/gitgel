import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { slotForPointer } from '../../scripts/useReorder';

/** Where the drop line is drawn, in viewport pixels. */
export interface DropLine {
  top: number;
  left: number;
  width: number;
}

/** The order after `id` moves to `slot` (its place among the others). Pure, so it is unit-tested. */
export function movedTo(ids: string[], id: string, slot: number): string[] {
  const next = ids.filter((x) => x !== id);
  next.splice(slot, 0, id);
  return next;
}

/** The commits a reorder has to pick again (newest first): from the newest down to the lowest
 * row that changed; none when the order is the same. Pure, so it is unit-tested. */
export function reorderSpan(before: string[], after: string[]): string[] {
  let last = -1;
  after.forEach((sha, i) => {
    if (sha !== before[i]) last = i;
  });
  return after.slice(0, last + 1);
}

/**
 * Reorder (SPEC §16 "Reorder"): a commit row dragged to another place among `movable` (newest
 * first). Rows carry `data-commit`. A press becomes a drag after 6px; an accent line marks the
 * slot; the order commits on release and Escape cancels. Pointer events, not HTML5 drag and
 * drop: the window takes native drags for folder drops.
 */
export function useCommitDrag(movable: string[], onMove: (order: string[]) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [line, setLine] = useState<DropLine | null>(null);
  const stop = useRef<(() => void) | null>(null);
  // Unmount mid-drag: never commits.
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (id: string) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.metaKey || e.shiftKey || e.ctrlKey || !movable.includes(id)) return;
    const list = e.currentTarget.parentElement;
    if (!list) return;
    const ids = [...movable];
    const from = ids.indexOf(id);
    const startY = e.clientY;
    let active = false;
    let slot = from;
    const prev = { cursor: document.body.style.cursor, select: document.body.style.userSelect };
    // The other rows, top to bottom, as laid out now (the list may have scrolled).
    const others = () =>
      ids
        .filter((x) => x !== id)
        .map((x) => list.querySelector<HTMLElement>(`[data-commit="${x}"]`)?.getBoundingClientRect())
        .filter((r): r is DOMRect => !!r);
    const move = (ev: globalThis.PointerEvent) => {
      if (!active && Math.abs(ev.clientY - startY) < 6) return;
      if (!active) {
        active = true;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        setDragging(id);
      }
      const rects = others();
      if (rects.length !== ids.length - 1) return;
      slot = slotForPointer(
        rects.map((r) => r.top + r.height / 2),
        ev.clientY,
      );
      const at = slot === 0 ? rects[0] : rects[slot - 1];
      setLine(slot === from ? null : { top: slot === 0 ? at.top - 1 : at.bottom - 1, left: at.left, width: at.width });
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      stop.current = null;
      if (!active) return;
      document.body.style.cursor = prev.cursor;
      document.body.style.userSelect = prev.select;
      setDragging(null);
      setLine(null);
      // The click that ends the drag must not pick the row.
      const eat = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', eat, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', eat, true), 0);
      if (commit && slot !== from) onMove(movedTo(ids, id, slot));
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !active) return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };
    stop.current = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  };

  return { dragging, line, onPointerDown };
}
