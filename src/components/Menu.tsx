import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Menu.module.css';

interface MenuProps {
  children: ReactNode;
  'aria-label': string;
  /** Focus the first item on open, for keyboard use. */
  autoFocus?: boolean;
}

/** ↑/↓ move between the enabled items. */
export function Menu({ children, 'aria-label': label, autoFocus }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  useEffect(() => {
    if (autoFocus) items()[0]?.focus();
  }, [autoFocus]);
  const move = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = items();
    if (all.length === 0) return;
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % all.length : (i <= 0 ? all.length : i) - 1;
    all[next].focus();
  };
  return (
    <div ref={ref} role="menu" aria-label={label} className={styles.menu} onKeyDown={move}>
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
  /** 14px line icon or 16px image, on the left. */
  icon?: ReactNode;
}

export function MenuItem({ children, onSelect, danger, hint, sub, disabled, icon }: ItemProps) {
  const cls = [styles.item, danger && styles.danger, sub && styles.stacked].filter(Boolean).join(' ');
  const text = sub ? (
    <span className={styles.lines}>
      <span>{children}</span>
      <span className={styles.sub}>{sub}</span>
    </span>
  ) : (
    <>
      <span className={styles.label}>{children}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </>
  );
  return (
    <button type="button" role="menuitem" className={cls} onClick={onSelect} disabled={disabled}>
      {icon && <span className={styles.icon}>{icon}</span>}
      {text}
    </button>
  );
}

export function MenuDivider() {
  return <div role="separator" className={styles.divider} />;
}
