import { ChevronDownIcon, ChevronUpIcon } from './icons';
import styles from './Stepper.module.css';

export interface Step {
  'aria-label': string;
  title: string;
  disabled: boolean;
  /** The step leaves the current item (the next file, flow D4): tinted. */
  cross?: boolean;
}

/** ↑ ↓ in one framed group: step through changes (D4) or commits (D7). */
export function Stepper({
  'aria-label': label,
  up,
  down,
  onStep,
}: {
  'aria-label': string;
  up: Step;
  down: Step;
  /** -1: up, 1: down. */
  onStep: (dir: 1 | -1) => void;
}) {
  const button = (s: Step, dir: 1 | -1) => (
    <button
      type="button"
      aria-label={s['aria-label']}
      title={s.title}
      className={s.cross ? `${styles.button} ${styles.cross}` : styles.button}
      disabled={s.disabled}
      onClick={() => onStep(dir)}
    >
      {dir < 0 ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
    </button>
  );
  return (
    <div role="group" aria-label={label} className={styles.group}>
      {button(up, -1)}
      {button(down, 1)}
    </div>
  );
}
