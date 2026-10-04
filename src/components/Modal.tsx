import { useEffect, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';
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
      // Listed in lib/shortcuts.ts.
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

/** The top of a modal: serif 22px title, a muted sub line (mono for a repo / branch or a path), an
 * optional ✕. */
export function ModalHeader({
  title,
  sub,
  subMono,
  onClose,
}: {
  title: ReactNode;
  sub?: ReactNode;
  subMono?: boolean;
  /** Shows a ✕ that calls it. */
  onClose?: () => void;
}) {
  return (
    <div className={onClose ? `${styles.header} ${styles.headerClose}` : styles.header}>
      <div className={styles.headerText}>
        <div className={styles.title}>{title}</div>
        {sub && <div className={subMono ? `${styles.sub} ${styles.subMono}` : styles.sub}>{sub}</div>}
      </div>
      {onClose && (
        <IconButton aria-label="Close" onClick={onClose}>
          <CloseIcon size={13} />
        </IconButton>
      )}
    </div>
  );
}

/** The bottom of a modal: bg.sunken; a note (or a lead link) on the left, buttons on the right,
 * the primary last. `ruled` false when the list above already ends in a row border. */
export function ModalFooter({
  note,
  noteMono,
  aside,
  ruled = true,
  children,
}: {
  note?: ReactNode;
  noteMono?: boolean;
  /** Muted text just before the buttons. */
  aside?: ReactNode;
  ruled?: boolean;
  /** The buttons; a lead link button may come first with `note` left empty. */
  children: ReactNode;
}) {
  return (
    <div className={ruled ? `${styles.footer} ${styles.ruled}` : styles.footer}>
      <span className={noteMono ? `${styles.note} ${styles.noteMono}` : styles.note}>{note}</span>
      {aside && <span className={styles.aside}>{aside}</span>}
      {children}
    </div>
  );
}
