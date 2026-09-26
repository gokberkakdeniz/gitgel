import { forwardRef, type InputHTMLAttributes } from 'react';
import styles from './TextInput.module.css';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  height?: 32 | 36;
  /** Turns the focus ring red. */
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, Props>(function TextInput(
  { height = 32, invalid, className, ...rest },
  ref,
) {
  const cls = [styles.input, height === 36 && styles.h36, invalid && styles.invalid, className]
    .filter(Boolean)
    .join(' ');
  return <input ref={ref} className={cls} spellCheck={false} autoComplete="off" {...rest} />;
});
