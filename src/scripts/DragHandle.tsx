import type { ComponentProps } from 'react';
import { t } from '../i18n';
import styles from './DragHandle.module.css';

/** The six-dot handle of a reorderable row (`useReorder`). */
export function DragHandle(props: Omit<ComponentProps<'button'>, 'type' | 'className'> & { 'aria-label': string }) {
  return (
    <button type="button" title={t('common.dragHint')} className={styles.handle} {...props}>
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
        {[2.5, 7, 11.5].map((y) => [2.5, 7.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />))}
      </svg>
    </button>
  );
}
