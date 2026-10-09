import { Icon, type IconName } from '../components/icons';
import { formatAge } from '../lib/format';
import { MenuDivider, MenuItem } from '../components/Menu';
import type { EntrySummary } from '../lib/types';
import { useRuns } from '../scripts/runs';
import styles from './SyncButtons.module.css';
import { fetchRepo, forcePushBranch, pullBranch, pushBranch, rebaseOnBase, syncState, SYNC_ACTIONS, type SyncTarget } from './sync';

/** The sync action running in the repository, if any (one git action at a time per repository). */
function useRunningSync(repoId: string): string | null {
  return useRuns(
    (s) =>
      Object.values(s.runs).find(
        (r) => r.status === 'running' && r.repoId === repoId && SYNC_ACTIONS.includes(r.scriptId),
      )?.scriptId ?? null,
  );
}

/** Fetch, Pull and Push in the History header (W4a), for its branch; the last fetch's age is in
 * Fetch's tooltip. */
export function SyncButtons({ target, fetchedAt }: { target: SyncTarget; fetchedAt: number | null }) {
  const running = useRunningSync(target.repoId);
  const u = target.upstream;
  if (!target.branch || !u) return null;
  const st = syncState(target);
  const busy = (action: string) => running === `git:${action}`;
  return (
    <div role="group" aria-label="Sync with the remote" className={styles.group}>
      <SyncButton
        icon="download"
        busy={busy('fetch')}
        disabled={!!running}
        title={`Fetch ${target.repoName} from ${u.remote}${fetchedAt != null ? ` · last fetch ${formatAge(fetchedAt)} ago` : ''}`}
        className={styles.fetch}
        onClick={() => void fetchRepo(target)}
      >
        Fetch
      </SyncButton>
      <span className={styles.divider} />
      <SyncButton
        icon="arrow-down"
        busy={busy('pull')}
        disabled={!!running || !!st.pull}
        title={st.pull ?? `Pull from ${u.name}`}
        count={u.behind > 0 ? `↓${u.behind}` : undefined}
        onClick={() => void pullBranch(target)}
      >
        Pull
      </SyncButton>
      <SyncButton
        icon="arrow-up"
        busy={busy('push')}
        disabled={!!running || !!st.push}
        title={st.push ?? `Push to ${u.name ?? u.remote}`}
        count={u.ahead > 0 ? `↑${u.ahead}` : undefined}
        className={st.push ? undefined : styles.primary}
        onClick={() => void pushBranch(target)}
      >
        Push
      </SyncButton>
    </div>
  );
}

function SyncButton({
  icon,
  busy,
  count,
  className,
  children,
  ...rest
}: {
  icon: IconName;
  busy: boolean;
  count?: string;
  disabled: boolean;
  title: string;
  className?: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button type="button" className={[styles.button, className].filter(Boolean).join(' ')} {...rest}>
      <Icon name={busy ? 'spinner' : icon} size={12} className={busy ? styles.spin : undefined} />
      {children}
      {count && <span className={styles.count}>{count}</span>}
    </button>
  );
}

/** The sync group of a branch's menus (Branches, Project, Review; W4a): Fetch, Pull and Push with
 * what each would move. Nothing for a detached HEAD, a branch without a remote, or one that is
 * gone. */
export function SyncItems({
  entry,
  onDone,
  rebaseOnly,
}: {
  entry: EntrySummary;
  onDone: () => void;
  /** Only "Rebase on <base>": History's header has Fetch, Pull and Push already. */
  rebaseOnly?: boolean;
}) {
  const running = useRunningSync(entry.repoId);
  const u = entry.upstream;
  if (!entry.branch || !u || entry.state === 'repo_missing' || entry.state === 'branch_deleted') return null;
  const st = syncState(entry);
  const run = (action: () => Promise<void>) => {
    onDone();
    void action();
  };
  const busy = running ? 'A sync is running' : null;
  // Rebase on the base: a checked-out branch that has a base other than itself or its own remote
  // branch (the base branch's base is its upstream: that is Pull (rebase)).
  const base =
    entry.worktreePath && entry.base && entry.base !== entry.branch && entry.base !== u.name ? entry.base : null;
  if (rebaseOnly) {
    if (!base) return null;
    return (
      <>
        <MenuDivider />
        <MenuItem icon="rebase" disabled={!!running} title={busy ?? undefined} onSelect={() => run(() => rebaseOnBase(entry, base))}>
          Rebase on {base}
        </MenuItem>
      </>
    );
  }
  return (
    <>
      <MenuDivider />
      <MenuItem icon="download" disabled={!!running} title={busy ?? undefined} onSelect={() => run(() => fetchRepo(entry))}>
        Fetch
      </MenuItem>
      <MenuItem
        icon="arrow-down"
        hint={u.behind > 0 ? `↓${u.behind}` : undefined}
        disabled={!!running || !!st.pull}
        title={busy ?? st.pull ?? undefined}
        onSelect={() => run(() => pullBranch(entry))}
      >
        Pull
      </MenuItem>
      {st.diverged && !st.pull && (
        <MenuItem icon="rebase" disabled={!!running} title={busy ?? undefined} onSelect={() => run(() => pullBranch(entry, true))}>
          Pull (rebase)
        </MenuItem>
      )}
      {base && (
        <MenuItem icon="rebase" disabled={!!running} title={busy ?? undefined} onSelect={() => run(() => rebaseOnBase(entry, base))}>
          Rebase on {base}
        </MenuItem>
      )}
      <MenuItem
        icon="arrow-up"
        hint={u.ahead > 0 ? `↑${u.ahead}` : undefined}
        disabled={!!running || !!st.push}
        title={busy ?? st.push ?? (u.name ? undefined : `Not on ${u.remote} yet`)}
        onSelect={() => run(() => pushBranch(entry))}
      >
        Push
      </MenuItem>
      {st.diverged && (
        <MenuItem icon="arrow-up" disabled={!!running} title={busy ?? undefined} onSelect={() => run(() => forcePushBranch(entry))}>
          Force push
        </MenuItem>
      )}
    </>
  );
}
