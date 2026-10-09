import { useState } from 'react';
import { Button } from '../components/Button';
import { Icon } from '../components/icons';
import { Popover } from '../components/Popover';
import { formatAge } from '../lib/format';
import { tildifyHome } from '../lib/paths';
import parts from '../screens/Review/parts.module.css';
import type { ReviewStash } from '../screens/Review/stashes';
import { useData } from '../state/data';
import { applyStash, askDrop } from './actions';
import styles from './StashBar.module.css';
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
    <div className={`${parts.entryBar} ${styles.bar}`}>
      <div className={parts.entryLine}>
        <span className={parts.barTitle} title={stash.message}>
          {stash.message}
        </span>
        <span className={parts.grow} />
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
      <div className={parts.barMeta}>
        <Icon name="package" size={12} strokeWidth={1.7} className={styles.icon} />
        <span className={styles.ref}>stash@{`{${stash.index}}`}</span>
        <span className={parts.dot}>·</span>
        <span className={styles.where}>
          {stash.repoName} / {branch}
        </span>
        <span className={parts.dot}>·</span>
        <span>from {base.slice(0, 7)}</span>
        <span className={parts.dot}>·</span>
        <span>{formatAge(stash.createdAt)} ago</span>
      </div>
    </div>
  );
}
