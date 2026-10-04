import type { ButtonHTMLAttributes } from 'react';
import { ChevronDownIcon, Icon, type IconName } from './icons';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** 32px default, 28px in rows, 36px in modals, 40px on empty states. */
  size?: 28 | 32 | 36 | 40;
  /** A 12px icon before the label. Icon-only buttons are `IconButton`. */
  icon?: IconName;
  /** Shortcut hint shown on the right, e.g. "⌘K". */
  kbd?: string;
  /** A dropdown trigger: a chevron after the label. */
  chevron?: boolean;
  /** The trigger's menu is open. */
  active?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 32,
  icon,
  kbd,
  chevron,
  active,
  className,
  children,
  type = 'button',
  ...rest
}: Props) {
  const cls = [styles.button, styles[variant], styles[`h${size}`], active && styles.active, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={cls}
      aria-haspopup={chevron ? 'menu' : undefined}
      aria-expanded={chevron ? !!active : undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
      {kbd && <span className={styles.kbd}>{kbd}</span>}
      {chevron && <ChevronDownIcon size={12} />}
    </button>
  );
}
