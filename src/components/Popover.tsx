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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Place below the anchor; flip above or clamp so it stays inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    let left = alignRight ? anchorRect.right - w : anchorRect.left;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
    const below = anchorRect.bottom + GAP;
    const over = anchorRect.top - GAP - h;
    let top = above ? over : below;
    if (!above && top + h > window.innerHeight - MARGIN && over >= MARGIN) top = over;
    if (above && top < MARGIN) top = below;
    setPos({ top, left });
  }, [anchorRect, alignRight, above]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
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
      className={[styles.popover, className].filter(Boolean).join(' ')}
      style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}
