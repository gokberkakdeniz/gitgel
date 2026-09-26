import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../state/ui';
import styles from './Modal.module.css';

interface Props {
  onClose: () => void;
  width: number;
  /** Distance from the top of the window. */
  paddingTop?: number;
  'aria-label': string;
  /** A click on the scrim closes it too. */
  closeOnScrim?: boolean;
  children: ReactNode;
}

export function Modal({ onClose, width, paddingTop = 110, closeOnScrim, children, 'aria-label': label }: Props) {
  useEffect(() => {
    useUi.getState().modalOpened();
    return () => useUi.getState().modalClosed();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className={styles.scrim}
      style={{ paddingTop }}
      onMouseDown={(e) => {
        if (closeOnScrim && e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal aria-label={label} className={styles.box} style={{ width }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
