import type { ReactNode } from 'react';
import { selectCanBack, selectCanForward, useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import { setSidebarVisible } from '../../lib/sidebar';
import { BackIcon, ForwardIcon, SidebarIcon } from '../icons';
import { IconButton } from '../IconButton';
import { t } from '../../i18n';
import styles from './PageHeader.module.css';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-hand actions. */
  children?: ReactNode;
  /** A page opened from another (Review, History) names where Back goes and draws it stronger. */
  backLabel?: string;
}

/** The 64px page header. With the sidebar hidden it leaves room for the traffic lights and
 * shows the show-sidebar, back and forward buttons. */
export function PageHeader({ title, subtitle, children, backLabel }: Props) {
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const canBack = useNav(selectCanBack);
  const canForward = useNav(selectCanForward);
  const back = useNav((s) => s.back);
  const forward = useNav((s) => s.forward);

  return (
    <header className={sidebarVisible ? styles.header : `${styles.header} ${styles.bare}`} data-tauri-drag-region>
      {!sidebarVisible && (
        <div className={styles.chrome} data-tauri-drag-region>
          <div className={styles.lights} data-tauri-drag-region />
          <IconButton aria-label={t('nav.showSidebar')} onClick={() => setSidebarVisible(true)}>
            <SidebarIcon />
          </IconButton>
          <IconButton
            aria-label={backLabel ?? t('sidebar.back')}
            onClick={back}
            disabled={!canBack}
            className={backLabel ? styles.back : undefined}
          >
            <BackIcon />
          </IconButton>
          <IconButton aria-label={t('sidebar.forward')} onClick={forward} disabled={!canForward}>
            <ForwardIcon />
          </IconButton>
        </div>
      )}
      {/* An editable title inside (no drag attribute of its own) still takes its click. */}
      <div className={styles.titles} data-tauri-drag-region>
        <h1 className="page-title" data-tauri-drag-region>
          {title}
        </h1>
        {subtitle && (
          <div className={styles.subtitle} data-tauri-drag-region>
            {subtitle}
          </div>
        )}
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </header>
  );
}
