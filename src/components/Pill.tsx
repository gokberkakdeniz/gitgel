import type { HTMLAttributes, MouseEventHandler } from 'react';
import styles from './Pill.module.css';

interface Props extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'accent';
  /** `md` (padding 3px 10px) in tables, lists and headers; `sm` (16px tall) inside a meta line. */
  size?: 'sm' | 'md';
  /** Exit codes, SHAs, branch names. */
  mono?: boolean;
  /** Makes it a button (e.g. Review's "Whitespace ignored", a state that opens a fix). */
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

export function Pill({ tone, size = 'md', mono, onClick, className, ...rest }: Props) {
  const cls = [styles.pill, styles[tone], size === 'sm' && styles.sm, mono && styles.mono, onClick && styles.button]
    .concat(className)
    .filter(Boolean)
    .join(' ');
  if (onClick) return <button type="button" className={cls} onClick={onClick} {...rest} />;
  return <span className={cls} {...rest} />;
}
