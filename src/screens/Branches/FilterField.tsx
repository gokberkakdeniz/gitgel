import { forwardRef } from 'react';
import { Input } from '../../components/Input';
import { Kbd } from '../../components/Kbd';
import styles from './Branches.module.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** The header filter: a real filter of the list. Esc clears it, a second Esc leaves it. */
export const FilterField = forwardRef<HTMLInputElement, Props>(function FilterField({ value, onChange }, ref) {
  return (
    <Input
      ref={ref}
      leftIcon="search"
      rightText={!value && <Kbd>⌘K</Kbd>}
      mono
      clearable
      size={32}
      className={styles.filter}
      placeholder="Search"
      aria-label="Search Branches and Worktrees"
      value={value}
      onChange={onChange}
      onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
    />
  );
});
