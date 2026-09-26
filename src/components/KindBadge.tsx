import type { FileKind } from '../lib/types';
import styles from './KindBadge.module.css';

export function KindBadge({ kind }: { kind: FileKind }) {
  return <span className={`${styles.badge} ${styles[kind]}`}>{kind}</span>;
}
