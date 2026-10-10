import { useState } from 'react';
import styles from './ResizeHandle.module.css';

/** A pane width the user drags, remembered under `key`; null until they first resize it. */
export function useStoredWidth(key: string): [number | null, (w: number | null) => void] {
  const [width, setWidth] = useState<number | null>(() => {
    try {
      const n = Number(localStorage.getItem(key));
      return n > 0 ? n : null;
    } catch {
      return null;
    }
  });
  const set = (w: number | null) => {
    setWidth(w);
    try {
      if (w === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(Math.round(w)));
    } catch {
      // Not remembered; fine.
    }
  };
  return [width, set];
}

/** The draggable border on a pane's edge: drag or arrow keys to resize, double-click
 * to reset. `axis="x"` (default) is the right edge (←/→), `axis="y"` the bottom edge (↑/↓). */
export function ResizeHandle({
  pane,
  min,
  max,
  onResize,
  onReset,
  label = 'Resize file list',
  axis = 'x',
}: {
  pane: React.RefObject<HTMLElement | null>;
  min: number;
  max: number;
  onResize: (size: number) => void;
  onReset: () => void;
  label?: string;
  axis?: 'x' | 'y';
}) {
  const [dragging, setDragging] = useState(false);
  const horizontal = axis === 'y';
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const resizingClass = horizontal ? styles.resizingY : styles.resizing;

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !pane.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = pane.current.getBoundingClientRect();
    const startAt = horizontal ? e.clientY : e.clientX;
    const startSize = horizontal ? rect.height : rect.width;
    setDragging(true);
    document.body.classList.add(resizingClass);
    const move = (ev: PointerEvent) =>
      onResize(clamp(startSize + (horizontal ? ev.clientY : ev.clientX) - startAt));
    const up = () => {
      setDragging(false);
      document.body.classList.remove(resizingClass);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const key = (e: React.KeyboardEvent) => {
    const prev = horizontal ? 'ArrowUp' : 'ArrowLeft';
    const next = horizontal ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== prev && e.key !== next) return;
    e.preventDefault();
    const rect = pane.current?.getBoundingClientRect();
    const size = horizontal ? (rect?.height ?? min) : (rect?.width ?? min);
    onResize(clamp(size + (e.key === next ? 16 : -16)));
  };

  const cls = [styles.handle, horizontal ? styles.horizontal : '', dragging ? styles.active : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={label}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className={cls}
      onPointerDown={down}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
