// Picking several files of Uncommitted (Hi8, D12): ⌘-click adds or drops one, ⇧-click takes the
// range from the last one clicked, a plain click picks just that one again (and shows it), esc
// clears. The diff keeps the file it shows; the picked files get the right-click menu's actions.
// Listed in lib/shortcuts.ts.
import { useEffect, useState, type MouseEvent } from 'react';
import { isTextField } from '../lib/shortcuts';
import { useUi } from '../state/ui';

/** `ids` with `id` added, or taken out when it is there. */
export function toggled(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** The ids of `order` from `from` to `to`, both included, in list order. */
export function range(order: string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * The picked files among `order` (the rows as listed). `shown` is the file the diff shows: the
 * first ⌘-click starts from it. `reset` changing (another row, branch or mode) drops the picks.
 */
export function usePicks(order: string[], shown: string | null, reset: unknown) {
  const [picks, setPicks] = useState<string[] | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  useEffect(() => {
    setPicks(null);
    setAnchor(null);
  }, [reset]);
  // Files that left the list (discarded, committed) leave the picks too.
  const live = picks ? order.filter((id) => picks.includes(id)) : [];
  const any = live.length > 0;

  useEffect(() => {
    if (!any) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTextField(e.target) || useUi.getState().modalCount > 0) return;
      if (document.querySelector('[data-popover]')) return;
      setPicks(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [any]);

  /** A click on a row: picks with ⌘ / ⇧, else `open` (show that file) and no picks. */
  const click = (id: string, e: MouseEvent, open: () => void) => {
    if (e.metaKey) {
      const next = toggled(any ? live : shown && order.includes(shown) ? [shown] : [], id);
      setPicks(next.length > 0 ? next : null);
      setAnchor(id);
      return;
    }
    if (e.shiftKey) {
      setPicks(range(order, anchor ?? shown ?? id, id));
      return;
    }
    setPicks(null);
    setAnchor(id);
    open();
  };

  return {
    click,
    isPicked: (id: string) => any && live.includes(id),
    /** What a right-click on `id` acts on: the picked files when it is one of them, else it. */
    targets: (id: string) => (any && live.includes(id) ? live : [id]),
    clear: () => setPicks(null),
  };
}
