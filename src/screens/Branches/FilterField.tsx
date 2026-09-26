import { forwardRef } from 'react';
import { SearchIcon } from '../../components/icons';
import { Kbd } from '../../components/Kbd';
import styles from './Branches.module.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** The header filter: a real filter of the list. Esc clears it. */
export const FilterField = forwardRef<HTMLInputElement, Props>(function FilterField({ value, onChange }, ref) {
  return (
    <label className={styles.filter}>
      <SearchIcon size={14} />
      <input
        ref={ref}
        className={styles.filterInput}
        placeholder="Filter branch or worktree"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('');
            e.currentTarget.blur();
          }
        }}
      />
      <Kbd>⌘K</Kbd>
    </label>
  );
});
