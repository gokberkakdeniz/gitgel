import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * Reordering a list by a handle on each row: a pointer drag (the pointer's height picks the
 * slot; saved on release) or ↑ / ↓ on the focused handle. Rows carry `data-reorder`.
 * HTML5 drag and drop is not used: the window takes native drags for folder drops.
 */
export function useReorder(ids: string[], onCommit: (ids: string[]) => void) {
  const listRef = useRef<HTMLUListElement>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const onPointerDown = (id: string) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let current = [...ids];
    setOrder(current);
    setDragId(id);
    const onMove = (ev: globalThis.PointerEvent) => {
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-reorder]') ?? [])];
      const at = rows.findIndex((r) => {
        const rect = r.getBoundingClientRect();
        return ev.clientY < rect.top + rect.height / 2;
      });
      const slot = at === -1 ? rows.length : at;
      const from = current.indexOf(id);
      const to = slot > from ? slot - 1 : slot;
      if (to === from) return;
      current = [...current];
      current.splice(from, 1);
      current.splice(to, 0, id);
      setOrder(current);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setOrder(null);
      setDragId(null);
      if (current.some((x, i) => x !== ids[i])) onCommit(current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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

  return {
    listRef,
    /** The ids in the order to draw (the dragged order while dragging). */
    order: order ?? ids,
    dragId,
    handleProps: (id: string) => ({ onPointerDown: onPointerDown(id), onKeyDown: onKeyDown(id) }),
  };
}
