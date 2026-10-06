import { useEffect } from 'react';
import { openWindow } from '../lib/ipc';
import { useUi } from '../state/ui';
import styles from './AuxBlocker.module.css';

/** While About, Software Update or What's New is open the main window is blocked (SPEC §7): a
 * click brings the small window forward, shortcuts are off, and only the title strip still moves
 * the window (the small one moves with it). */
export function AuxBlocker() {
  const open = useUi((s) => s.auxWindows);
  const blocked = open.length > 0;
  useEffect(() => {
    if (!blocked) return;
    useUi.getState().modalOpened();
    return () => useUi.getState().modalClosed();
  }, [blocked]);
  if (!blocked) return null;
  const front = open[open.length - 1] as 'about' | 'update' | 'whats-new';
  return (
    <div className={styles.blocker} onMouseDown={(e) => e.target === e.currentTarget && void openWindow(front)}>
      <div className={styles.drag} data-tauri-drag-region />
    </div>
  );
}
