import type { InputHTMLAttributes, ReactNode } from 'react';
import { CheckIcon } from './icons';
import styles from './Checkbox.module.css';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 13px text after the box; the whole row toggles it. */
  label?: ReactNode;
  /** A 12px muted line under the label. */
  sub?: ReactNode;
  /** A sunken box around it (an option that needs an explanation). */
  card?: boolean;
}

/**
 * A drawn 16px box: accent fill with a check when on, a 1.5px border when off. The native input
 * stays underneath for focus, keyboard and forms. Without a label, give it an aria-label.
 */
export function Checkbox({ className, label, sub, card, checked, ...rest }: Props) {
  const box = (
    <span className={styles.box}>
      <input type="checkbox" className={styles.input} checked={checked} {...rest} />
      {checked && <CheckIcon size={11} strokeWidth={3} className={styles.tick} />}
    </span>
  );
  if (!label) return <span className={[styles.only, className].filter(Boolean).join(' ')}>{box}</span>;
  return (
    <label className={[styles.row, sub && styles.top, card && styles.card, className].filter(Boolean).join(' ')}>
      {box}
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>
    </label>
  );
}
