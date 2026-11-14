import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  /** `right`: beside the anchor, its top level with the anchor's (a submenu). */
  side?: 'below' | 'right';
  /** The element it opens from; it follows it when the page scrolls or resizes. Default: the
   * element at the middle of `anchorRect` when it opens. */
  anchor?: Element | null;
  className?: string;
  children: ReactNode;
}

const GAP = 6;
const MARGIN = 8;

/** A popover opened inside another (a submenu) registers with it, so a click in it is not a
 * click outside the parent, and Esc closes the innermost one first. */
interface Nest {
  add: (el: HTMLElement) => void;
  remove: (el: HTMLElement) => void;
}
const NestContext = createContext<Nest | null>(null);

type Pos = { top: number; left: number; maxHeight?: number };

/** Where a popover of size w × h goes for an anchor rect, kept inside the viewport. */
function place(
  a: DOMRect,
  w: number,
  h: number,
  o: { alignRight?: boolean; above?: boolean; side?: 'below' | 'right' },
): Pos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (o.side === 'right') {
    // Beside the anchor, or on its left when there is no room on the right.
    let left = a.right + 2;
    if (left + w > vw - MARGIN) left = a.left - 2 - w;
    left = Math.max(MARGIN, left);
    const height = Math.min(h, vh - 2 * MARGIN);
    const top = Math.max(MARGIN, Math.min(a.top - 6, vh - MARGIN - height));
    return { top, left, maxHeight: h > height ? height : undefined };
  }
  let left = o.alignRight ? a.right - w : a.left;
  left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
  const roomBelow = vh - MARGIN - (a.bottom + GAP);
  const roomAbove = a.top - GAP - MARGIN;
  const fitsBelow = h <= roomBelow;
  const fitsAbove = h <= roomAbove;
  const up = o.above
    ? fitsAbove || (!fitsBelow && roomAbove >= roomBelow)
    : !fitsBelow && (fitsAbove || roomAbove > roomBelow);
  const room = up ? roomAbove : roomBelow;
  const height = Math.min(h, room);
  const top = up ? a.top - GAP - height : a.bottom + GAP;
  return { top, left, maxHeight: h > room ? room : undefined };
}

export function Popover({ anchorRect, onClose, width, alignRight, above, side, anchor, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  // Popovers opened inside this one.
  const kids = useRef(new Set<HTMLElement>());
  const nest = useMemo<Nest>(
    () => ({ add: (el) => kids.current.add(el), remove: (el) => kids.current.delete(el) }),
    [],
  );
  const parent = useContext(NestContext);
  useEffect(() => {
    const el = ref.current;
    if (!parent || !el) return;
    parent.add(el);
    return () => parent.remove(el);
  }, [parent]);

  // The anchor element and where it was when the popover opened: the popover moves with it, so
  // it stays where it opened when the page under it scrolls or resizes.
  const tracked = useRef<{ el: Element; start: DOMRect } | null>(null);
  useLayoutEffect(() => {
    const el =
      anchor ??
      document.elementFromPoint(anchorRect.left + anchorRect.width / 2, anchorRect.top + anchorRect.height / 2);
    tracked.current = el ? { el, start: el.getBoundingClientRect() } : null;
  }, [anchor, anchorRect]);

  // Place below the anchor; flip above or clamp so it stays inside the viewport. When it fits on
  // neither side it takes the roomier one and scrolls (a webview cannot draw outside the window).
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    let a = anchorRect;
    const t = tracked.current;
    if (t?.el.isConnected) {
      const now = t.el.getBoundingClientRect();
      const dx = now.left - t.start.left;
      const dy = now.top - t.start.top;
      if (dx || dy) a = new DOMRect(a.x + dx, a.y + dy, a.width, a.height);
    }
    const next = place(a, el.offsetWidth, el.scrollHeight, { alignRight, above, side });
    setPos((p) => (p && p.top === next.top && p.left === next.left && p.maxHeight === next.maxHeight ? p : next));
  }, [anchorRect, alignRight, above, side]);
  useLayoutEffect(update, [update]);

  // Again on any scroll (lists scroll inside the page) and when the anchor, the popover or the
  // window changes size.
  useEffect(() => {
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', later, true);
    window.addEventListener('resize', later);
    const observer = new ResizeObserver(later);
    if (ref.current) observer.observe(ref.current);
    if (tracked.current) observer.observe(tracked.current.el);
    observer.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', later, true);
      window.removeEventListener('resize', later);
      observer.disconnect();
    };
  }, [update]);

  useEffect(() => {
    const inside = (target: Node) =>
      !!ref.current?.contains(target) || [...kids.current].some((k) => k.contains(target));
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // Listed in lib/shortcuts.ts. A submenu closes first.
      if (e.key === 'Escape' && kids.current.size === 0) {
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
    <NestContext.Provider value={nest}>
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
      </div>
    </NestContext.Provider>,
    document.body,
  );
}
