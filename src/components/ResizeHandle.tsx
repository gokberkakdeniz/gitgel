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

/** The draggable border on a pane's right edge: drag or ←/→ to resize, double-click to reset. */
export function ResizeHandle({
  pane,
  min,
  max,
  onResize,
  onReset,
  label = 'Resize file list',
}: {
  pane: React.RefObject<HTMLElement | null>;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset: () => void;
  label?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const clamp = (w: number) => Math.min(max, Math.max(min, w));

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !pane.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = pane.current.getBoundingClientRect().width;
    setDragging(true);
    document.body.classList.add(styles.resizing);
    const move = (ev: PointerEvent) => onResize(clamp(startW + ev.clientX - startX));
    const up = () => {
      setDragging(false);
      document.body.classList.remove(styles.resizing);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const key = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const w = pane.current?.getBoundingClientRect().width ?? min;
    onResize(clamp(w + (e.key === 'ArrowRight' ? 16 : -16)));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className={dragging ? `${styles.handle} ${styles.active}` : styles.handle}
      onPointerDown={down}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
