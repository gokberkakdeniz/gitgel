import { useState } from 'react';
import { Button } from '../components/Button';
import { Icon } from '../components/icons';
import { Popover } from '../components/Popover';
import { formatAge } from '../lib/format';
import { tildifyHome } from '../lib/paths';
import styles from '../screens/Review/Review.module.css';
import type { ReviewStash } from '../screens/Review/stashes';
import { useData } from '../state/data';
import { applyStash, askDrop } from './actions';
import { StashTargetMenu } from './StashTargetMenu';

/** Above a stash's diff: its message and actions, then which stash, where it was taken and on
 * what. Two lines, so a long message does not push the rest out. */
export function StashBar({ stash, base }: { stash: ReviewStash; base: string }) {
  const branch = stash.branch ?? 'detached HEAD';
  // Apply / Pop: straight into the worktree its branch is checked out in; otherwise the
  // worktree picker (P5) under the button.
  const [pick, setPick] = useState<{ pop: boolean; rect: DOMRect } | null>(null);
  const home = useData((s) =>
    stash.branch === null ? undefined : s.scan[stash.repoId]?.active.find((e) => e.worktreePath && e.branch === stash.branch),
  );
  const act = (pop: boolean, el: HTMLElement) =>
    home ? void applyStash(stash, home, pop) : setPick({ pop, rect: el.getBoundingClientRect() });
  const where = home ? ` to ${home.branch} (${tildifyHome(home.worktreePath ?? '')})` : ' to a worktree';
  return (
    <div className={styles.entryBar}>
      <div className={styles.entryLine}>
        <span className={styles.stashTitle} title={stash.message}>
          {stash.message}
        </span>
        <span className={styles.grow} />
        <Button size={28} title={`Apply${where}`} active={pick?.pop === false} onClick={(e) => act(false, e.currentTarget)}>
          Apply
        </Button>
        <Button size={28} title={`Pop${where}`} active={pick?.pop === true} onClick={(e) => act(true, e.currentTarget)}>
          Pop
        </Button>
        <Button size={28} className={styles.dropButton} onClick={() => askDrop(stash)}>
          Drop
        </Button>
        {pick && (
          <Popover anchorRect={pick.rect} width={280} alignRight onClose={() => setPick(null)}>
            <StashTargetMenu stash={stash} pop={pick.pop} onDone={() => setPick(null)} />
          </Popover>
        )}
      </div>
      <div className={styles.stashBarMeta}>
        <Icon name="package" size={12} strokeWidth={1.7} className={styles.stashBarIcon} />
        <span className={styles.stashBarRef}>stash@{`{${stash.index}}`}</span>
        <span className={styles.dot}>·</span>
        <span className={styles.stashBarWhere}>
          {stash.repoName} / {branch}
        </span>
        <span className={styles.dot}>·</span>
        <span>from {base.slice(0, 7)}</span>
        <span className={styles.dot}>·</span>
        <span>{formatAge(stash.createdAt)} ago</span>
      </div>
    </div>
  );
}
