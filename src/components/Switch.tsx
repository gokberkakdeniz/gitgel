import type { InputHTMLAttributes } from 'react';
import styles from './Switch.module.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'>;

/**
 * Turns a thing on or off at once, with no Save (a `Checkbox` picks options in a form). A drawn
 * 28×16 track with a 12px knob over the native input, which keeps focus and keyboard. It has no
 * label of its own: give it an aria-label and a title.
 */
export function Switch({ className, ...rest }: Props) {
  return (
    <span className={[styles.switch, className].filter(Boolean).join(' ')}>
      <input type="checkbox" role="switch" className={styles.input} {...rest} />
      <span className={styles.knob} aria-hidden="true" />
    </span>
  );
}
