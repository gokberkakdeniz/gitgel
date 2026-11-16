import { Icon } from '../components/icons';
import { t } from '../i18n';
import { cnt } from '../lib/format';
import type { StashChanges } from '../lib/types';
import { DiffStat, FileRow } from '../screens/Review/parts';
import parts from '../screens/Review/parts.module.css';
import { type ReviewStash, stashMeta } from '../screens/Review/stashes';
import styles from './StashSelection.module.css';

/** The pane while stashes are picked (stash review, SPEC §15): how many, then each with its
 * files; the header's Apply / Pop / Drop act on them. A file opens its stash on it. */
export function StashSelection({
  stashes,
  changes,
  folderOf,
  withRepo = false,
  onFile,
  onAll,
  onClear,
}: {
  stashes: ReviewStash[];
  /** The stashes' files by SHA, as they load. */
  changes: Record<string, StashChanges>;
  /** The folder a repository's files are opened from. */
  folderOf: (repoId: string) => string | null;
  /** `repo / branch` on line 2 (a project review). */
  withRepo?: boolean;
  onFile: (sha: string, path: string) => void;
  /** Picks the whole stack; none when it is all picked. */
  onAll?: () => void;
  onClear: () => void;
}) {
  const files = stashes.flatMap((s) => changes[s.sha]?.files ?? []);
  const loaded = stashes.every((s) => changes[s.sha]);
  const add = files.reduce((n, f) => n + (f.add ?? 0), 0);
  const del = files.reduce((n, f) => n + (f.del ?? 0), 0);
  return (
    <>
      <div className={parts.entryBar}>
        <div className={parts.entryLine}>
          <span className={parts.barTitle}>{t('stash.selectedN', { ...cnt(stashes.length) })}</span>
          <span className={parts.grow} />
          {onAll && (
            <button type="button" className={parts.linkButton} onClick={onAll}>
              {t('review.selectAll')}
            </button>
          )}
          <button type="button" className={parts.linkButton} onClick={onClear}>
            {t('common.clear')}
          </button>
        </div>
        {loaded && (
          <div className={parts.barMeta}>
            <span>{t('branches.fileCount', { ...cnt(files.length) })}</span>
            <DiffStat add={add || undefined} del={del || undefined} />
          </div>
        )}
      </div>
      <div className={styles.list}>
        {stashes.map((st) => (
          <section key={`${st.repoId}:${st.sha}`} className={styles.stash}>
            <div className={styles.head} title={st.message}>
              <span className={parts.stashLine}>
                <Icon name="package" size={13} strokeWidth={1.6} className={parts.stashIcon} />
                <span className={parts.stashMessage}>{st.message}</span>
                <span className={parts.stashRef}>stash@{`{${st.index}}`}</span>
              </span>
              <span className={parts.stashMeta}>{stashMeta(st, withRepo)}</span>
            </div>
            <div className={parts.fileRows}>
              {changes[st.sha]?.files.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  folder={folderOf(st.repoId)}
                  on={false}
                  onClick={() => onFile(st.sha, f.path)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
