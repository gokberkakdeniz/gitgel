import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  disabled?: boolean;
}

interface Props<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `md` 28px; `sm` 26px (Branches scope, dialog choices); `xs` 22px mono, inside a menu row. */
  size?: 'md' | 'sm' | 'xs';
  /** A 1px border, on `bg.elevated` surfaces (dialogs) where the track would vanish. */
  bordered?: boolean;
  /** `radio` for a choice inside a form; `pressed` (default) for a view switch. */
  role?: 'radio' | 'pressed';
  disabled?: boolean;
  'aria-label': string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  bordered,
  role = 'pressed',
  disabled,
  ...rest
}: Props<T>) {
  const radio = role === 'radio';
  return (
    <div
      role={radio ? 'radiogroup' : 'group'}
      aria-disabled={disabled || undefined}
      className={[styles.group, size === 'xs' && styles.xsGroup, bordered && styles.bordered].filter(Boolean).join(' ')}
      {...rest}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={radio ? 'radio' : undefined}
            aria-checked={radio ? on : undefined}
            aria-pressed={radio ? undefined : on}
            disabled={o.disabled || disabled}
            tabIndex={disabled ? -1 : undefined}
            className={[styles.item, size !== 'md' && styles[size], on && styles.active].filter(Boolean).join(' ')}
            onClick={() => onChange(o.value)}
          >
            {o.label}
            {o.count !== undefined && <span className={styles.count}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
