import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

/**
 * Reordering a list by a handle on each row: a pointer drag or ↑ / ↓ on the focused handle.
 * Rows carry `data-reorder`. HTML5 drag and drop is not used: the window takes native drags
 * for folder drops.
 *
 * While dragging the DOM order stays put so rows never jump: the dragged row follows the
 * pointer (`rowStyle` translates and lifts it), the rows around it glide aside to open the
 * gap (`rowStyle` translates them with a transition), and an accent line marks the drop slot
 * (`dropBefore` / `dropAfter`, drawn in `DragHandle.module.css`). The order commits on
 * release; Escape cancels.
 */
export function useReorder(ids: string[], onCommit: (ids: string[]) => void) {
  const listRef = useRef<HTMLUListElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [motion, setMotion] = useState<{ dy: number; slot: number } | null>(null);
  // The drop slot, mirrored for the release handler (state updaters must stay pure).
  const slotRef = useRef<number | null>(null);
  const dyRef = useRef(0);
  const drag = useRef<{
    id: string;
    base: string[];
    from: number;
    startY: number;
    height: number;
    minDy: number;
    maxDy: number;
    lastY: number;
    active: boolean;
    scroller: HTMLElement | null;
    raf: number;
    prevCursor: string;
    prevSelect: string;
    move: (ev: globalThis.PointerEvent) => void;
    up: () => void;
    cancel: () => void;
    key: (ev: globalThis.KeyboardEvent) => void;
  } | null>(null);

  // Unmount mid-drag: drop the listeners, restore the body. Never commits.
  useEffect(
    () => () => {
      const d = drag.current;
      if (!d) return;
      cancelAnimationFrame(d.raf);
      window.removeEventListener('pointermove', d.move);
      window.removeEventListener('pointerup', d.up);
      window.removeEventListener('pointercancel', d.cancel);
      window.removeEventListener('keydown', d.key, true);
      document.body.style.cursor = d.prevCursor;
      document.body.style.userSelect = d.prevSelect;
      drag.current = null;
    },
    [],
  );

  const finish = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    window.removeEventListener('pointermove', d.move);
    window.removeEventListener('pointerup', d.up);
    window.removeEventListener('pointercancel', d.cancel);
    window.removeEventListener('keydown', d.key, true);
    document.body.style.cursor = d.prevCursor;
    document.body.style.userSelect = d.prevSelect;
    const slot = slotRef.current;
    drag.current = null;
    slotRef.current = null;
    setMotion(null);
    setDragId(null);
    if (commit && slot !== null && slot !== d.from) {
      const next = d.base.filter((x) => x !== d.id);
      next.splice(slot, 0, d.id);
      onCommit(next);
    }
  };

  const handleMove = (ev: globalThis.PointerEvent) => {
    const d = drag.current;
    const list = listRef.current;
    if (!d || !list) return;
    d.lastY = ev.clientY;
    const raw = ev.clientY - d.startY;
    // A press is not a drag until the pointer really moves.
    if (!d.active && Math.abs(raw) < 4) return;
    if (!d.active) {
      d.active = true;
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      d.raf = requestAnimationFrame(scrollTick);
    }
    const dy = Math.min(d.maxDy, Math.max(d.minDy, raw));
    const rows = [...list.querySelectorAll<HTMLElement>('[data-reorder]')];
    const slot = slotForPointer(
      rows.filter((_, i) => i !== d.from).map((r) => mid(r)),
      ev.clientY,
    );
    if (slotRef.current === slot && dyRef.current === dy) return;
    slotRef.current = slot;
    dyRef.current = dy;
    setMotion({ dy, slot });
  };

  const scrollTick = () => {
    const d = drag.current;
    if (!d?.active) return;
    const el = d.scroller;
    if (el) {
      const r = el.getBoundingClientRect();
      const m = 56;
      const v = 14;
      if (d.lastY < r.top + m) el.scrollTop -= v * (1 - Math.max(0, d.lastY - r.top) / m);
      else if (d.lastY > r.bottom - m) el.scrollTop += v * (1 - Math.max(0, r.bottom - d.lastY) / m);
    }
    d.raf = requestAnimationFrame(scrollTick);
  };

  const handleKey = (ev: globalThis.KeyboardEvent) => {
    if (ev.key !== 'Escape' || !drag.current?.active) return;
    // Cancel the drag; a modal under it must not close too.
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };

  const onPointerDown = (id: string) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const list = listRef.current;
    const rows = [...(list?.querySelectorAll<HTMLElement>('[data-reorder]') ?? [])];
    const base = [...ids];
    const from = base.indexOf(id);
    const box = rows[from]?.getBoundingClientRect();
    if (!list || rows.length === 0 || from === -1 || !box) return;
    const first = rows[0].getBoundingClientRect();
    const last = rows[rows.length - 1].getBoundingClientRect();
    const up = () => finish(true);
    const cancel = () => finish(false);
    drag.current = {
      id,
      base,
      from,
      startY: e.clientY,
      height: box.height,
      minDy: first.top - box.top,
      maxDy: last.bottom - box.bottom,
      lastY: e.clientY,
      active: false,
      scroller: autoScroller(list),
      raf: 0,
      prevCursor: document.body.style.cursor,
      prevSelect: document.body.style.userSelect,
      move: handleMove,
      up,
      cancel,
      key: handleKey,
    };
    slotRef.current = null;
    setDragId(id);
    setMotion(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', handleKey, true);
  };

  const onKeyDown = (id: string) => (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next = [...ids];
    const i = next.indexOf(id);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onCommit(next);
  };

  const d = drag.current;
  const from = d?.from ?? -1;
  const slot = motion?.slot ?? -1;
  const reduce =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const glide = reduce ? 'none' : 'transform 180ms cubic-bezier(0.2, 0, 0, 1)';

  /** The visual state of one row while a drag runs: translate it into place. */
  const rowStyle = (id: string): CSSProperties => {
    if (!d || !motion || !d.active) return {};
    if (id === d.id) {
      return {
        position: 'relative',
        zIndex: 3,
        transform: `translateY(${motion.dy}px) scale(1.01)`,
        background: 'var(--bg-elevated)',
        borderRadius: 8,
        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.4)',
        opacity: 0.96,
        cursor: 'grabbing',
        transition: reduce ? 'none' : 'box-shadow 160ms ease, opacity 160ms ease',
      };
    }
    const i = d.base.indexOf(id);
    const shift = shiftForRow(from, slot, i, d.height);
    return shift === 0
      ? { position: 'relative', transition: glide }
      : { position: 'relative', zIndex: 1, transform: `translateY(${shift}px)`, transition: glide };
  };

  /** The accent line goes before this row (it moves down to open the gap). */
  const dropBefore = (id: string) =>
    !!d?.active && !!motion && slot < from && d.base.indexOf(id) === slot;
  /** The accent line goes after this row (it moves up to open the gap). */
  const dropAfter = (id: string) =>
    !!d?.active && !!motion && slot > from && d.base.indexOf(id) === slot;

  return {
    listRef,
    /** The ids in draw order; stable while dragging (rows move with transforms instead). */
    order: ids,
    dragId,
    handleProps: (id: string) => ({ onPointerDown: onPointerDown(id), onKeyDown: onKeyDown(id) }),
    rowStyle,
    dropBefore,
    dropAfter,
  };
}

/** The midpoint of a row, in viewport pixels. */
function mid(row: HTMLElement): number {
  const r = row.getBoundingClientRect();
  return r.top + r.height / 2;
}

/**
 * Where the dragged row lands: how many of the remaining rows' midpoints sit above the
 * pointer (0..mids.length). Pure, so it is unit-tested.
 */
export function slotForPointer(mids: number[], y: number): number {
  let slot = 0;
  for (const m of mids) {
    if (y > m) slot++;
    else break;
  }
  return slot;
}

/**
 * How far a row at index `i` moves to open the gap at `slot` (the dragged row sits at
 * `from`): rows between the two shift by one dragged-row height. Pure, so it is unit-tested.
 */
export function shiftForRow(from: number, slot: number, i: number, height: number): number {
  if (slot > from && i > from && i <= slot) return -height;
  if (slot < from && i >= slot && i < from) return height;
  return 0;
}

/** The closest ancestor that scrolls vertically, if any. */
function autoScroller(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    if (p.scrollHeight > p.clientHeight + 1) {
      const overflow = getComputedStyle(p).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return p;
    }
    p = p.parentElement;
  }
  return null;
}
