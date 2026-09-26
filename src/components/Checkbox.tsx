import type { InputHTMLAttributes } from 'react';
import styles from './Checkbox.module.css';

export function Checkbox({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input type="checkbox" className={[styles.checkbox, className].filter(Boolean).join(' ')} {...rest} />;
}
