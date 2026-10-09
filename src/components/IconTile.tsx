import { Icon, type IconName } from './icons';
import styles from './IconTile.module.css';

/** A 14px line icon in a 28px boxed tile (List rows with `lead="tile"`, a script's icon). */
export function IconTile({ name, className }: { name: IconName; className?: string }) {
  return (
    <span className={className ? `${styles.tile} ${className}` : styles.tile} aria-hidden>
      <Icon name={name} size={14} strokeWidth={1.8} />
    </span>
  );
}
