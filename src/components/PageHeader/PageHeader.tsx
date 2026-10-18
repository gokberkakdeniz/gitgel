import { useEffect, useRef, type ReactNode } from 'react';
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
  /** A page opened from another (Review) names where Back goes and draws it stronger. */
  backLabel?: string;
}

const PEEK_DELAY = 120;

/** The 64px page header. With the sidebar hidden it leaves room for the traffic lights and
 * shows the show-sidebar, back and forward buttons. */
export function PageHeader({ title, subtitle, children, backLabel }: Props) {
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const canBack = useNav(selectCanBack);
  const canForward = useNav(selectCanForward);
  const back = useNav((s) => s.back);
  const forward = useNav((s) => s.forward);

  // Resting on the show-sidebar button shows the sidebar over the page (Sidebar's `peek`); a
  // short wait so passing over it on the way to the traffic lights does not.
  const peekTimer = useRef<number | undefined>(undefined);
  const peekSoon = () => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => useUi.getState().setSidebarPeek(true), PEEK_DELAY);
  };
  const peekCancel = () => window.clearTimeout(peekTimer.current);
  useEffect(() => peekCancel, []);

  return (
    <header className={sidebarVisible ? styles.header : `${styles.header} ${styles.bare}`} data-tauri-drag-region>
      {!sidebarVisible && (
        <div className={styles.chrome} data-tauri-drag-region>
          <div className={styles.lights} data-tauri-drag-region />
          <IconButton
            aria-label={t('nav.showSidebar')}
            data-sidebar-peek
            onClick={() => setSidebarVisible(true)}
            onPointerEnter={peekSoon}
            onPointerLeave={peekCancel}
          >
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
