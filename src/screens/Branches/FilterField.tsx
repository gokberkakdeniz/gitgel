import { forwardRef } from 'react';
import { SearchIcon } from '../../components/icons';
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
      leftIcon={<SearchIcon size={13} />}
      rightIcon={!value && <Kbd>⌘K</Kbd>}
      mono
      clearable
      size={32}
      className={styles.filter}
      placeholder="Search"
      aria-label="Search branches and worktrees"
      value={value}
      onChange={onChange}
      onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
    />
  );
});
