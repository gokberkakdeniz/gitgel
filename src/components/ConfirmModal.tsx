import type { KeyboardEvent, ReactNode } from 'react';
import { Checkbox } from './Checkbox';
import { Icon, type IconName } from './icons';
import { Modal } from './Modal';
import styles from './ConfirmModal.module.css';

export interface ConfirmContext {
  icon: IconName;
  text: string;
  title?: string;
}

/** A short confirmation (Delete Project…, Remove Repository…, Drop stash, Run): a serif title, then
 * a text or a box naming what it acts on with a note, then the buttons (children) on the right. */
export function ConfirmModal({
  'aria-label': label,
  title,
  width,
  onClose,
  onKeyDown,
  text,
  context,
  note,
  dontAsk,
  children,
}: {
  'aria-label': string;
  title: ReactNode;
  width: number;
  onClose: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** What happens, in a sentence. */
  text?: ReactNode;
  /** What it acts on, one row each (a stash, a branch, a folder). */
  context?: ConfirmContext[];
  /** Muted, under the box. */
  note?: ReactNode;
  /** "Do not show this message again" (Settings › Prompts, M6): its state; the caller turns the
   * prompt off when the action is confirmed with it checked. */
  dontAsk?: { checked: boolean; onChange: (checked: boolean) => void };
  children: ReactNode;
}) {
  return (
    <Modal aria-label={label} width={width} paddingTop={180} onClose={onClose}>
      <div className={context ? `${styles.body} ${styles.withContext}` : styles.body} onKeyDown={onKeyDown}>
        <div className={styles.title}>{title}</div>
        {text && <p className={styles.text}>{text}</p>}
        {context && (
          <div className={styles.context}>
            {context.map((c, i) => (
              <span key={i} className={styles.row} title={c.title}>
                <Icon name={c.icon} size={14} className={styles.icon} />
                <span className={styles.rowText}>{c.text}</span>
              </span>
            ))}
          </div>
        )}
        {note && <p className={styles.note}>{note}</p>}
        {dontAsk && (
          <Checkbox
            className={styles.dontAsk}
            label="Do not show this message again"
            checked={dontAsk.checked}
            onChange={(e) => dontAsk.onChange(e.target.checked)}
          />
        )}
        <div className={styles.actions}>{children}</div>
      </div>
    </Modal>
  );
}
