import type { ReactNode } from 'react';
import { selectCanBack, selectCanForward, useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import { BackIcon, ForwardIcon, SidebarIcon } from '../icons';
import { IconButton } from '../IconButton';
import styles from './PageHeader.module.css';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-hand actions. */
  children?: ReactNode;
  /** Off where clicking the title renames the project (Project, Review of a project). */
  dragTitle?: boolean;
  /** A page opened from another (Review, History) names where Back goes and draws it stronger. */
  backLabel?: string;
}

/** The 64px page header. With the sidebar hidden it leaves room for the traffic lights and
 * shows the show-sidebar, back and forward buttons. */
export function PageHeader({ title, subtitle, children, dragTitle = true, backLabel }: Props) {
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const setSidebarVisible = useUi((s) => s.setSidebarVisible);
  const canBack = useNav(selectCanBack);
  const canForward = useNav(selectCanForward);
  const back = useNav((s) => s.back);
  const forward = useNav((s) => s.forward);
  const drag = dragTitle ? { 'data-tauri-drag-region': true } : {};

  return (
    <header className={sidebarVisible ? styles.header : `${styles.header} ${styles.bare}`} data-tauri-drag-region>
      {!sidebarVisible && (
        <div className={styles.chrome} data-tauri-drag-region>
          <div className={styles.lights} data-tauri-drag-region />
          <IconButton aria-label="Show sidebar" onClick={() => setSidebarVisible(true)}>
            <SidebarIcon />
          </IconButton>
          <IconButton
            aria-label={backLabel ?? 'Back'}
            onClick={back}
            disabled={!canBack}
            className={backLabel ? styles.back : undefined}
          >
            <BackIcon />
          </IconButton>
          <IconButton aria-label="Forward" onClick={forward} disabled={!canForward}>
            <ForwardIcon />
          </IconButton>
        </div>
      )}
      <div className={styles.titles} {...drag}>
        <h1 className="page-title" {...drag}>
          {title}
        </h1>
        {subtitle && (
          <div className={styles.subtitle} {...drag}>
            {subtitle}
          </div>
        )}
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </header>
  );
}
