import { useState } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { ChevronDownIcon, ChevronRightIcon } from '../components/icons';
import { Input } from '../components/Input';
import { KindBadge } from '../components/KindBadge';
import { Popover } from '../components/Popover';
import { plural } from '../lib/format';
import { basename } from '../lib/paths';
import type { EntrySummary, FileChange, ReviewGroup, StashPush } from '../lib/types';
import { dirLabel } from '../screens/Review/selection';
import { pushStashes } from './actions';
import styles from './StashDialog.module.css';

interface Row {
  entry: EntrySummary;
  /** Its uncommitted files (untracked ones as `U`). */
  files: FileChange[];
}

/** The review's entries that are checked out, with their uncommitted files. */
export function stashRows(groups: ReviewGroup[]): Row[] {
  return groups.filter((g) => g.entry.worktreePath).map((g) => ({ entry: g.entry, files: g.files.uncommitted }));
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

/** What to stash per entry: every entry with a file picked; all its files (no paths) when all are
 * picked, else the picked ones with a rename's old path too. Untracked files go when one is picked. */
export function stashPayload(rows: Row[], picks: Record<string, string[]>): StashPush[] {
  return rows.flatMap(({ entry: e, files }) => {
    // git cannot stash a worktree with merge conflicts.
    if (e.conflicts > 0) return [];
    const picked = files.filter((f) => picks[e.key]?.includes(f.path));
    if (picked.length === 0) return [];
    const all = picked.length === files.length;
    return [
      {
        repoId: e.repoId,
        branch: e.branch,
        worktreePath: e.branch === null ? e.worktreePath : null,
        paths: all ? null : picked.flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path])),
        untracked: picked.some((f) => f.kind === 'U'),
      },
    ];
  });
}

/** Stash changes (flow P4), under the ⋮ menu's Stash in Review and History. Each entry lists its
 * files under it (open when there is one entry); its box picks them all or none. */
export function StashDialog({ groups, anchorRect, onClose }: { groups: ReviewGroup[]; anchorRect: DOMRect; onClose: () => void }) {
  const rows = stashRows(groups);
  const [picks, setPicks] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(rows.map((r) => [r.entry.key, r.entry.conflicts > 0 ? [] : r.files.map((f) => f.path)])),
  );
  const [open, setOpen] = useState<string[]>(() => (rows.length === 1 ? [rows[0].entry.key] : []));
  const [message, setMessage] = useState('');
  const payload = stashPayload(rows, picks);
  const pickedEntries = rows.filter((r) => r.files.some((f) => picks[r.entry.key]?.includes(f.path))).map((r) => r.entry);

  const stash = () => {
    if (payload.length === 0) return;
    onClose();
    void pushStashes(payload, message);
  };
  const setPicked = (key: string, paths: string[]) => setPicks((p) => ({ ...p, [key]: paths }));
  const toggleFile = (key: string, path: string) => {
    const now = picks[key] ?? [];
    setPicked(key, now.includes(path) ? now.filter((x) => x !== path) : [...now, path]);
  };
  const toggleOpen = (key: string) => setOpen((o) => (o.includes(key) ? o.filter((k) => k !== key) : [...o, key]));

  return (
    <Popover anchorRect={anchorRect} width={420} alignRight onClose={onClose}>
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
            const key = r.entry.key;
            const conflicted = r.entry.conflicts > 0;
            const off = r.files.length === 0 || conflicted;
            const name = r.entry.branch ?? r.entry.shortSha ?? '';
            const n = r.files.filter((f) => picks[key]?.includes(f.path)).length;
            const all = !off && n === r.files.length;
            const isOpen = open.includes(key);
            return (
              <div key={key} className={styles.group}>
                <div className={off ? `${styles.entry} ${styles.off}` : styles.entry}>
                  <label className={styles.entryPick}>
                    <Checkbox
                      aria-label={`Stash ${name}`}
                      checked={all}
                      mixed={n > 0 && !all}
                      disabled={off}
                      onChange={() => setPicked(key, n > 0 ? [] : r.files.map((f) => f.path))}
                    />
                    <span className={styles.repo}>{r.entry.repoName}</span>
                    <span className={styles.branch}>{name}</span>
                  </label>
                  {conflicted ? (
                    <span className={styles.conflict} title="Resolve its merge conflicts first; git cannot stash them.">
                      {r.entry.conflicts === 1 ? '1 conflict' : `${r.entry.conflicts} conflicts`}
                    </span>
                  ) : off ? (
                    <span className={styles.count}>no changes</span>
                  ) : (
                    <button
                      type="button"
                      className={styles.countButton}
                      aria-expanded={isOpen}
                      title={isOpen ? 'Hide files' : 'Pick files'}
                      onClick={() => toggleOpen(key)}
                    >
                      {all ? plural(r.files.length, 'file', 'files') : `${n} of ${plural(r.files.length, 'file', 'files')}`}
                      {isOpen ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
                    </button>
                  )}
                </div>
                {isOpen &&
                  r.files.map((f) => (
                    <label key={f.path} className={styles.file} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
                      <Checkbox
                        aria-label={`Stash ${f.path}`}
                        checked={!!picks[key]?.includes(f.path)}
                        onChange={() => toggleFile(key, f.path)}
                      />
                      <KindBadge kind={f.kind} />
                      <span className={styles.fileName}>{basename(f.path)}</span>
                      <span className={styles.fileDir}>{dirLabel(f)}</span>
                    </label>
                  ))}
              </div>
            );
          })}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="stash-message">
            Message
          </label>
          <Input id="stash-message" size={32} value={message} onChange={setMessage} autoFocus />
        </div>
        <div className={styles.note}>{stashNote(pickedEntries)}</div>
        <div className={styles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" kbd="↵" disabled={payload.length === 0} onClick={stash}>
            Stash {plural(payload.length, 'entry', 'entries')}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
