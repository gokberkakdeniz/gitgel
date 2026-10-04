import type { SelectHTMLAttributes } from 'react';
import { ChevronDownIcon, Icon, type IconName } from './icons';
import styles from './Select.module.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface Props<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'size'> {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 36 in forms (default), 32 in denser rows. */
  size?: 32 | 36;
  /** A 14px muted icon before the value. */
  icon?: IconName;
  mono?: boolean;
  /** Layout for the field box (width). */
  className?: string;
  'aria-label': string;
}

/** A native select drawn as a field: bg.elevated, 1px border, radius 8, a chevron on the right. */
export function Select<T extends string>({
  options,
  value,
  onChange,
  size = 36,
  icon,
  mono,
  className,
  ...rest
}: Props<T>) {
  const cls = [styles.field, styles[`s${size}`], icon && styles.withIcon, mono && styles.mono, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls}>
      {icon && <Icon name={icon} size={14} className={styles.icon} />}
      <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value as T)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={12} className={styles.chevron} />
    </span>
  );
}
