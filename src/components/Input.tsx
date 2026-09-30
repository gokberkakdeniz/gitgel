import { forwardRef, useImperativeHandle, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { CloseIcon } from './icons';
import styles from './Input.module.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> {
  value: string;
  onChange: (value: string) => void;
  /** 30 default; 28 beside 28px icon buttons, 32 beside 32px header controls, 36 in forms. */
  size?: 28 | 30 | 32 | 36;
  /** Before the text, muted (e.g. a search icon). */
  leftIcon?: ReactNode;
  /** After the text, muted (e.g. a ⌘K hint or a match count). */
  rightIcon?: ReactNode;
  /** Mono text, for branches, files, paths and commands. */
  mono?: boolean;
  /** Danger border and ring (e.g. a name that is taken). */
  invalid?: boolean;
  /** For filters: while it has text the field keeps its accent border and ends with a clear
   * button, and Esc clears it (the next Esc reaches `onKeyDown`). */
  clearable?: boolean;
  /** Layout for the field box (width, margins, position). */
  className?: string;
}

/**
 * The text field: sunken box, 1px border, accent border with a soft ring while focused.
 * In-place editors (page titles, the sidebar rename) are not fields and keep their own look.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { value, onChange, size = 30, leftIcon, rightIcon, mono, invalid, clearable, className, onKeyDown, ...rest },
  ref,
) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  const filled = !!clearable && value.length > 0;
  const cls = [
    styles.field,
    styles[`s${size}`],
    mono && styles.mono,
    filled && styles.filled,
    invalid && styles.invalid,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // A div, not a label, so an Input can sit inside a form label.
    <div
      className={cls}
      onMouseDown={(e) => {
        // A click on the box (icons, padding) focuses the input.
        if (e.target !== input.current && !(e.target as Element).closest('button')) {
          e.preventDefault();
          input.current?.focus();
        }
      }}
    >
      {leftIcon && <span className={styles.slot}>{leftIcon}</span>}
      <input
        ref={input}
        className={styles.input}
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && filled) {
            e.preventDefault();
            onChange('');
            return;
          }
          onKeyDown?.(e);
        }}
        {...rest}
      />
      {rightIcon && <span className={styles.slot}>{rightIcon}</span>}
      {filled && (
        <button
          type="button"
          aria-label="Clear"
          title="Clear (esc)"
          className={styles.clear}
          // Keeps focus in the field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <CloseIcon size={10} />
        </button>
      )}
    </div>
  );
});
