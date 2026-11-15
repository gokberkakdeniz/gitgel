import { t } from '../i18n';
import { formatDate } from '../lib/format';
import { compareVersions, type Release } from '../lib/changelog';
import { Pill } from './Pill';
import styles from './ReleaseNotes.module.css';

/** Release notes, newest first: What's New's body, and the box in Software Update (`compact`:
 * smaller type and the date without its year). With `seen` (What's New after an update: the
 * version last seen) the versions newer than it carry a "new" pill, and an "Earlier" rule starts
 * the ones seen before. */
export function ReleaseNotes({ releases, compact, seen }: { releases: Release[]; compact?: boolean; seen?: string }) {
  const isNew = (r: Release) => !!seen && compareVersions(r.version, seen) > 0;
  return (
    <>
      {releases.map((r, i) => (
        <section key={r.version} className={compact ? `${styles.release} ${styles.compact}` : styles.release}>
          {seen && !isNew(r) && i > 0 && isNew(releases[i - 1]) && (
            <div className={styles.earlier}>
              <span>{t('update.earlier')}</span>
            </div>
          )}
          <h3 className={styles.heading}>
            <span className={styles.version}>{r.version}</span>
            <span className={styles.date}>{releaseDate(r.date)}</span>
            {isNew(r) && (
              <Pill tone="accent" size="sm">
                {t('update.newPill')}
              </Pill>
            )}
          </h3>
          {r.groups.map((g) => (
            <div key={g.title} className={styles.group}>
              <span className={styles.groupTitle}>{g.title}</span>
              <ul className={styles.items}>
                {g.items.map((item, i) => (
                  <li key={i} className={styles.item}>
                    <span>
                      <Line text={item} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

/** A line with its `code` spans in mono. */
function Line({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 ? (
          <code key={i} className={styles.code}>
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** `2026-10-06` → the Appearance date pattern. */
function releaseDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return formatDate(d.getTime() / 1000);
}
