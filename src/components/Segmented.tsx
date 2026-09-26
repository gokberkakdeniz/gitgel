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
  /** `sm`: 26px buttons (Branches scope). */
  size?: 'md' | 'sm';
  'aria-label': string;
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md', ...rest }: Props<T>) {
  return (
    <div role="group" className={styles.group} {...rest}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          className={[styles.item, size === 'sm' && styles.sm, o.value === value && styles.active]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className={styles.count}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
