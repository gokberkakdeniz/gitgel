import type { HTMLAttributes } from 'react';
import styles from './Pill.module.css';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

export function Pill({ tone, className, ...rest }: Props) {
  return <span className={[styles.pill, styles[tone], className].filter(Boolean).join(' ')} {...rest} />;
}
