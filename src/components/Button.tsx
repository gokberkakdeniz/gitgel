import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** 32px default, 36px in modals, 40px on empty states. */
  size?: 32 | 36 | 40;
  /** Shortcut hint shown on the right, e.g. "⌘K". */
  kbd?: string;
}

export function Button({
  variant = 'secondary',
  size = 32,
  kbd,
  className,
  children,
  type = 'button',
  ...rest
}: Props) {
  const cls = [styles.button, styles[variant], styles[`h${size}`], className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
      {kbd && <span className={styles.kbd}>{kbd}</span>}
    </button>
  );
}
