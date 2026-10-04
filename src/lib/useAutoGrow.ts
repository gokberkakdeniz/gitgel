import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * A textarea that grows with its text, up to `max` px (then it scrolls). Dragging its resize
 * handle sets a floor it never shrinks below; the text can still grow it past that. Spread the
 * returned `onMouseUp` on the textarea so a drag is noticed.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, max = 360) {
  const floor = useRef(0);
  const given = useRef(0); // the height last given here; a different one came from a drag

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = 'auto';
    const text = Math.min(el.scrollHeight + borders, max);
    given.current = Math.max(text, floor.current);
    el.style.height = `${given.current}px`;
  };
  useLayoutEffect(fit, [value]);
  return {
    onMouseUp: () => {
      const el = ref.current;
      if (el && el.offsetHeight !== given.current) {
        floor.current = el.offsetHeight;
        fit();
      }
    },
  };
}
