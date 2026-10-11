import { t } from '../i18n';
import { Icon, type IconName } from './icons';
import styles from './SettingsNav.module.css';

export interface SettingsNavSection<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  count?: number;
}

/** Settings' section list (VS Code-style): 200px, 34px rows, the current one highlighted. */
export function SettingsNav<T extends string>({
  sections,
  current,
  onPick,
}: {
  sections: SettingsNavSection<T>[];
  current: T;
  onPick: (id: T) => void;
}) {
  return (
    <nav aria-label={t('settings.navLabel')} className={styles.nav}>
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-current={s.id === current ? 'page' : undefined}
          className={s.id === current ? `${styles.item} ${styles.on}` : styles.item}
          onClick={() => onPick(s.id)}
        >
          <Icon name={s.icon} size={16} strokeWidth={1.7} className={styles.icon} />
          <span className={styles.label}>{t(s.label)}</span>
          {s.count !== undefined && <span className={styles.count}>{s.count}</span>}
        </button>
      ))}
    </nav>
  );
}
