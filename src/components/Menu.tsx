import type { ReactNode } from 'react';
import styles from './Menu.module.css';

export function Menu({ children, 'aria-label': label }: { children: ReactNode; 'aria-label': string }) {
  return (
    <div role="menu" aria-label={label} className={styles.menu}>
      {children}
    </div>
  );
}

interface ItemProps {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Muted text on the right, e.g. "double-click title". */
  hint?: string;
  /** Second line in mono, e.g. "tip 3be91a0 · seen 2d ago". */
  sub?: string;
  disabled?: boolean;
}

export function MenuItem({ children, onSelect, danger, hint, sub, disabled }: ItemProps) {
  const cls = [styles.item, danger && styles.danger, sub && styles.stacked].filter(Boolean).join(' ');
  return (
    <button type="button" role="menuitem" className={cls} onClick={onSelect} disabled={disabled}>
      {sub ? (
        <>
          <span>{children}</span>
          <span className={styles.sub}>{sub}</span>
        </>
      ) : (
        <>
          {children}
          {hint && <span className={styles.hint}>{hint}</span>}
        </>
      )}
    </button>
  );
}

export function MenuDivider() {
  return <div role="separator" className={styles.divider} />;
}
