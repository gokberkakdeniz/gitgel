import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEffect, useState } from 'react';
import { useUi } from '../state/ui';
import { openAddRepos } from './addRepos';

/** Folders dropped anywhere on the window open the Add repositories sheet, except while a modal
 * is open. Returns whether folders are being dragged over the window. */
export function useFolderDrop(): boolean {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        const blocked = useUi.getState().modalCount > 0;
        if (p.type === 'enter' || p.type === 'over') {
          setOver(!blocked);
        } else {
          setOver(false);
          if (p.type === 'drop' && !blocked && p.paths.length > 0) void openAddRepos(p.paths);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return over;
}
