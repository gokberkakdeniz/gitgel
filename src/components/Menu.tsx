import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { CheckIcon, ChevronRightIcon, Icon, InfoIcon, type IconName } from './icons';
import { Segmented, type SegmentedOption } from './Segmented';
import styles from './Menu.module.css';

const ITEMS = ['menuitem', 'menuitemradio', 'menuitemcheckbox'].map((r) => `[role="${r}"]:not(:disabled)`).join(', ');

interface MenuProps {
  children: ReactNode;
  'aria-label': string;
  /** Focus the first item on open, for keyboard use. */
  autoFocus?: boolean;
}

/** ↑/↓ move between the enabled items; the item under a resting pointer then gives up its highlight until the pointer moves. */
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
    ref.current!.dataset.keys = '';
    all[next].focus();
  };
  const point = (e: MouseEvent) => {
    if (ref.current?.dataset.keys === undefined) return;
    delete ref.current.dataset.keys;
    (e.target as HTMLElement).closest<HTMLElement>(ITEMS)?.focus();
  };
  return (
    <div ref={ref} role="menu" aria-label={label} className={styles.menu} onKeyDown={move} onMouseMove={point}>
      {children}
    </div>
  );
}

interface ItemProps {
  children: ReactNode;
  /** Gets the item's element (a submenu opens beside it). */
  onSelect: (el: HTMLElement) => void;
  danger?: boolean;
  /** Accent text, e.g. "Add to Another Project…". */
  accent?: boolean;
  /** A 7px hollow dot on the left (a project); the label then stays on one line. */
  dot?: boolean;
  /** → on the right: goes to that page. */
  arrow?: boolean;
  /** Muted text on the right, e.g. "double-click title". */
  hint?: string;
  /** Mono shortcut on the right, e.g. "⌥V". */
  kbd?: string;
  /** Second line in mono, e.g. "tip 3be91a0 · seen 2d ago". */
  sub?: string;
  /** Second line in the UI font, a short explanation. */
  desc?: string;
  /** Each line stays on one line and ends in "…" (a long branch name, a folder). */
  oneLine?: boolean;
  disabled?: boolean;
  /** A line icon by name (14px), or a 16px image node (app icons), on the left. */
  icon?: IconName | ReactNode;
  /** A radio item: a check slot on the left, shown when true. */
  checked?: boolean;
  /** A checkbox item: a drawn box on the left. */
  box?: boolean;
  /** Tooltip, e.g. why it is disabled. */
  title?: string;
  /** Opens a submenu: a chevron on the right; → opens it from the keyboard. */
  submenu?: boolean;
  /** The pointer came onto the item (a submenu opens on hover; other items close it). */
  onHover?: (el: HTMLElement) => void;
}

export function MenuItem({
  children,
  onSelect,
  danger,
  accent,
  dot,
  arrow,
  hint,
  kbd,
  sub,
  desc,
  oneLine,
  disabled,
  icon,
  checked,
  box,
  title,
  submenu,
  onHover,
}: ItemProps) {
  const second = sub ?? desc;
  const radio = checked !== undefined;
  const check = box !== undefined;
  const cls = [styles.item, danger && styles.danger, accent && styles.accent, second && styles.stacked]
    .filter(Boolean)
    .join(' ');
  const text = second ? (
    <span className={oneLine ? `${styles.lines} ${styles.fit}` : styles.lines}>
      <span className={oneLine ? styles.oneLine : undefined}>{children}</span>
      <span className={`${sub ? styles.sub : styles.desc}${oneLine ? ` ${styles.oneLine}` : ''}`}>{second}</span>
    </span>
  ) : (
    <span className={dot ? `${styles.label} ${styles.oneLine}` : styles.label}>{children}</span>
  );
  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : check ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={radio ? checked : check ? box : undefined}
      className={cls}
      onClick={(e) => onSelect(e.currentTarget)}
      onMouseEnter={onHover && ((e) => onHover(e.currentTarget))}
      onKeyDown={
        submenu
          ? (e) => {
              if (e.key !== 'ArrowRight') return;
              e.preventDefault();
              onSelect(e.currentTarget);
            }
          : undefined
      }
      aria-haspopup={submenu ? 'menu' : undefined}
      disabled={disabled}
      title={title}
    >
      {icon && (
        <span className={styles.icon}>
          {typeof icon === 'string' ? <Icon name={icon as IconName} size={14} strokeWidth={1.8} /> : icon}
        </span>
      )}
      {dot && <span className={styles.dot} />}
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
      {arrow && <span className={styles.arrow}>→</span>}
      {submenu && <ChevronRightIcon size={12} className={styles.submenu} />}
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
