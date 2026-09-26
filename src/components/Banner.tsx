import type { ReactNode } from 'react';
import styles from './Banner.module.css';

export function Banner({ tone, children }: { tone: 'warning' | 'neutral'; children: ReactNode }) {
  return <div className={`${styles.banner} ${styles[tone]}`}>{children}</div>;
}
