import { useState } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Input } from '../components/Input';
import { Popover } from '../components/Popover';
import { plural } from '../lib/format';
import type { EntrySummary, ReviewGroup } from '../lib/types';
import { pushStashes } from './actions';
import styles from './StashDialog.module.css';

interface Row {
  entry: EntrySummary;
  files: number;
  untracked: number;
}

/** The review's entries that are checked out, with their uncommitted files. */
export function stashRows(groups: ReviewGroup[]): Row[] {
  return groups
    .filter((g) => g.entry.worktreePath)
    .map((g) => ({
      entry: g.entry,
      files: g.files.uncommitted.length,
      untracked: g.files.uncommitted.filter((f) => f.kind === 'U').length,
    }));
}

/** "One stash per entry, same message." and a line per repo that gets several. */
export function stashNote(entries: EntrySummary[]): string {
  const perRepo = new Map<string, number>();
  for (const e of entries) perRepo.set(e.repoName, (perRepo.get(e.repoName) ?? 0) + 1);
  const lines = ['One stash per entry, same message.'];
  for (const [repo, n] of perRepo) {
    if (n === 2) lines.push(`Both are in ${repo}, so its stack gets 2 new stashes.`);
    else if (n > 2) lines.push(`${n} are in ${repo}, so its stack gets ${n} new stashes.`);
  }
  return lines.join(' ');
}

/** Stash changes (flow P4), under the Review header's Stash… button. */
export function StashDialog({ groups, anchorRect, onClose }: { groups: ReviewGroup[]; anchorRect: DOMRect; onClose: () => void }) {
  const rows = stashRows(groups);
  const [checked, setChecked] = useState<string[]>(() => rows.filter((r) => r.files > 0).map((r) => r.entry.key));
  const [message, setMessage] = useState('');
  const [untracked, setUntracked] = useState(true);
  const picked = rows.filter((r) => r.files > 0 && checked.includes(r.entry.key));
  const untrackedCount = picked.reduce((n, r) => n + r.untracked, 0);

  const stash = () => {
    if (picked.length === 0) return;
    onClose();
    void pushStashes(
      picked.map((r) => r.entry),
      message,
      untracked && untrackedCount > 0,
    );
  };
  const toggle = (key: string) =>
    setChecked((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));

  return (
    <Popover anchorRect={anchorRect} width={400} alignRight onClose={onClose}>
      <div
        role="dialog"
        aria-label="Stash changes"
        className={styles.dialog}
        onKeyDown={(e) => {
          // Listed in lib/shortcuts.ts.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
            stash();
          }
        }}
      >
        <div className={styles.title}>Stash changes</div>
        <div className={styles.entries}>
          <span className={styles.label}>In</span>
          {rows.map((r) => {
            const off = r.files === 0;
            const name = r.entry.branch ?? r.entry.shortSha ?? '';
            return (
              <label key={r.entry.key} className={off ? `${styles.entry} ${styles.off}` : styles.entry}>
                <Checkbox
                  aria-label={`Stash ${name}`}
                  checked={!off && checked.includes(r.entry.key)}
                  disabled={off}
                  onChange={() => toggle(r.entry.key)}
                />
                <span className={styles.repo}>{r.entry.repoName}</span>
                <span className={styles.branch}>{name}</span>
                <span className={styles.count}>{off ? 'no changes' : plural(r.files, 'file', 'files')}</span>
              </label>
            );
          })}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="stash-message">
            Message
          </label>
          <Input id="stash-message" size={32} value={message} onChange={setMessage} autoFocus />
        </div>
        {untrackedCount > 0 && (
          <Checkbox
            label={
              <>
                Include untracked files <span className={styles.muted}>({untrackedCount})</span>
              </>
            }
            checked={untracked}
            onChange={(e) => setUntracked(e.target.checked)}
          />
        )}
        <div className={styles.note}>{stashNote(picked.map((r) => r.entry))}</div>
        <div className={styles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="↵" disabled={picked.length === 0} onClick={stash}>
            Stash {plural(picked.length, 'entry', 'entries')}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
