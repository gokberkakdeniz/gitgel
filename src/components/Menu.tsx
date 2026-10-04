import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon, Icon, InfoIcon, type IconName } from './icons';
import { Segmented, type SegmentedOption } from './Segmented';
import styles from './Menu.module.css';

const ITEMS = ['menuitem', 'menuitemradio', 'menuitemcheckbox'].map((r) => `[role="${r}"]:not(:disabled)`).join(', ');

interface MenuProps {
  children: ReactNode;
  'aria-label': string;
  /** Focus the first item on open, for keyboard use. */
  autoFocus?: boolean;
}

/** ↑/↓ move between the enabled items. */
export function Menu({ children, 'aria-label': label, autoFocus }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
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
  /** Mono shortcut on the right, e.g. "⌥V". */
  kbd?: string;
  /** Second line in mono, e.g. "tip 3be91a0 · seen 2d ago". */
  sub?: string;
  /** Second line in the UI font, a short explanation. */
  desc?: string;
  disabled?: boolean;
  /** A line icon by name (14px), or a 16px image node (app icons), on the left. */
  icon?: IconName | ReactNode;
  /** A radio item: a check slot on the left, shown when true. */
  checked?: boolean;
  /** A checkbox item: a drawn box on the left. */
  box?: boolean;
  /** Tooltip, e.g. why it is disabled. */
  title?: string;
}

export function MenuItem({ children, onSelect, danger, hint, kbd, sub, desc, disabled, icon, checked, box, title }: ItemProps) {
  const second = sub ?? desc;
  const radio = checked !== undefined;
  const check = box !== undefined;
  const cls = [styles.item, danger && styles.danger, second && styles.stacked].filter(Boolean).join(' ');
  const text = second ? (
    <span className={styles.lines}>
      <span>{children}</span>
      <span className={sub ? styles.sub : styles.desc}>{second}</span>
    </span>
  ) : (
    <span className={styles.label}>{children}</span>
  );
  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : check ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={radio ? checked : check ? box : undefined}
      className={cls}
      onClick={onSelect}
      disabled={disabled}
      title={title}
    >
      {icon && (
        <span className={styles.icon}>
          {typeof icon === 'string' ? <Icon name={icon as IconName} size={14} strokeWidth={1.8} /> : icon}
        </span>
      )}
      {radio && (
        <span className={checked ? styles.check : `${styles.check} ${styles.unchecked}`}>
          <CheckIcon />
        </span>
      )}
      {check && (
        <span className={box ? `${styles.box} ${styles.boxOn}` : styles.box}>
          {box && <CheckIcon size={11} strokeWidth={3} />}
        </span>
      )}
      {text}
      {hint && <span className={styles.hint}>{hint}</span>}
      {kbd && <span className={second ? `${styles.kbd} ${styles.kbdTop}` : styles.kbd}>{kbd}</span>}
    </button>
  );
}

export function MenuDivider() {
  return <div role="separator" className={styles.divider} />;
}

/** A section heading, e.g. "Layout". */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className={styles.sectionLabel}>{children}</div>;
}

/** A faint closing line, e.g. "Applies to every diff and is remembered." */
export function MenuCaption({ children }: { children: ReactNode }) {
  return <div className={styles.caption}>{children}</div>;
}

/** A small choice under the item above it (Lines around changes); disabled with that item off. */
export function MenuSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? `${styles.segRow} ${styles.segOff}` : styles.segRow}>
      <span className={styles.segLabel}>{label}</span>
      <Segmented size="xs" aria-label={label} options={options} value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}

/** The warning note closing a menu, e.g. why some items are missing. */
export function MenuNote({ children }: { children: ReactNode }) {
  return (
    <div className={styles.note}>
      <InfoIcon size={14} />
      <span>{children}</span>
    </div>
  );
}
