import { Icon, isIconName } from '../components/icons';
import styles from './ScriptIcon.module.css';

/** A script's icon in a 28px tile (Settings › Scripts, import preview). Unknown names show the
 * prompt icon. */
export function ScriptIcon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={className ? `${styles.tile} ${className}` : styles.tile} aria-hidden>
      <Icon name={isIconName(name) ? name : 'prompt'} size={14} strokeWidth={1.8} />
    </span>
  );
}
