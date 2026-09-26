import type { ButtonHTMLAttributes } from 'react';
import styles from './IconButton.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 28: transparent (sidebar, headers). 32: elevated with a border (page header actions). */
  size?: 28 | 32;
  active?: boolean;
  'aria-label': string;
}

export function IconButton({ size = 28, active, className, type = 'button', ...rest }: Props) {
  const cls = [styles.button, size === 32 ? styles.boxed : styles.plain, active && styles.active, className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={cls} {...rest} />;
}
