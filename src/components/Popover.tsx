import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Popover.module.css';

interface Props {
  /** Rect of the element the popover opens from; it is placed below it. */
  anchorRect: DOMRect;
  onClose: () => void;
  width?: number;
  /** Align the popover's right edge with the anchor's right edge. */
  alignRight?: boolean;
  /** Open above the anchor (e.g. from the selection bar at the bottom). */
  above?: boolean;
  className?: string;
  children: ReactNode;
}

const GAP = 6;
const MARGIN = 8;

export function Popover({ anchorRect, onClose, width, alignRight, above, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight?: number } | null>(null);

  // Place below the anchor; flip above or clamp so it stays inside the viewport. When it fits on
  // neither side it takes the roomier one and scrolls (a webview cannot draw outside the window).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, scrollHeight: h } = el;
    let left = alignRight ? anchorRect.right - w : anchorRect.left;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
    const roomBelow = window.innerHeight - MARGIN - (anchorRect.bottom + GAP);
    const roomAbove = anchorRect.top - GAP - MARGIN;
    const fitsBelow = h <= roomBelow;
    const fitsAbove = h <= roomAbove;
    const up = above
      ? fitsAbove || (!fitsBelow && roomAbove >= roomBelow)
      : !fitsBelow && (fitsAbove || roomAbove > roomBelow);
    const room = up ? roomAbove : roomBelow;
    const height = Math.min(h, room);
    const top = up ? anchorRect.top - GAP - height : anchorRect.bottom + GAP;
    setPos({ top, left, maxHeight: h > room ? room : undefined });
  }, [anchorRect, alignRight, above]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // Listed in lib/shortcuts.ts.
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      data-popover
      className={[styles.popover, className].filter(Boolean).join(' ')}
      style={{
        width,
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        maxHeight: pos?.maxHeight,
        overflowY: pos?.maxHeight ? 'auto' : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
