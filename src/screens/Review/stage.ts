// Stage / Unstage (SPEC §15 "Stage", Hi5): Review's Staged and Unstaged sections are git's
// index. A click moves the row at once; its git command waits 150ms for more clicks and runs
// with them as one, one at a time per repository (git's index.lock, and one git action per
// repository). While a repository's queue is not empty its Commit button is off. A failed run
// puts the rows back and says so in a toast.
import { create } from 'zustand';
import { t } from '../../i18n';
import { cnt } from '../../lib/format';
import { gitStage } from '../../lib/ipc';
import type { AppError, EntryRef, FileChange, IndexChanges } from '../../lib/types';
import { nameRun, useRuns } from '../../scripts/runs';
import { useUi } from '../../state/ui';

/** Where a file ends up: all of it staged, or none of it. */
export type StageTo = 'staged' | 'unstaged';

/** One file's move: its path (the key), every path git needs (a rename's old one too). */
export interface StageOp {
  path: string;
  paths: string[];
  to: StageTo;
  /** Where it was before the queue touched it: a move back there needs no git command. */
  from: StageTo | 'both';
}

export interface StageTarget {
  entry: EntryRef;
  entryKey: string;
  repoId: string;
  /** `repo / branch`, under the failed toast. */
  label: string;
}

interface StageState {
  /** Per entry: the files moved but not yet read back from git's index. */
  over: Record<string, Record<string, StageTo>>;
  /** Per repository: clicks waiting or a command running. */
  busy: Record<string, boolean>;
  /** Per entry: commands ended; Review reads the index again on each, so the read that drops
   * the moves comes after the command. */
  done: Record<string, number>;
  /** Drops an entry's moves once its index was read again with nothing in flight. */
  settle: (entryKey: string) => void;
}

export const useStage = create<StageState>()((set) => ({
  over: {},
  busy: {},
  done: {},
  settle: (entryKey) =>
    set((s) => {
      if (!s.over[entryKey]) return s;
      const over = { ...s.over };
      delete over[entryKey];
      return { over };
    }),
}));

/** What waits for a repository's next command. */
interface Batch {
  target: StageTarget;
  ops: Map<string, StageOp>;
}

const DELAY = 150;
const waiting = new Map<string, Batch>();
const timers = new Map<string, number>();
const running = new Set<string>();

const setBusy = (repoId: string, on: boolean) =>
  useStage.setState((s) => ({ busy: { ...s.busy, [repoId]: on } }));

const setOver = (entryKey: string, change: (m: Record<string, StageTo>) => void) =>
  useStage.setState((s) => {
    const m = { ...(s.over[entryKey] ?? {}) };
    change(m);
    return { over: { ...s.over, [entryKey]: m } };
  });

/** Moves files at once and queues their git command. */
export function requestStage(target: StageTarget, ops: StageOp[]): void {
  if (ops.length === 0) return;
  const { repoId, entryKey } = target;
  setOver(entryKey, (m) => ops.forEach((o) => (m[o.path] = o.to)));
  const batch = waiting.get(repoId) ?? { target, ops: new Map<string, StageOp>() };
  for (const o of ops) {
    const before = batch.ops.get(o.path);
    const op = { ...o, from: before?.from ?? o.from };
    // Back where it was before this batch: nothing to run for it.
    if (op.from === op.to) batch.ops.delete(o.path);
    else batch.ops.set(o.path, op);
  }
  waiting.set(repoId, batch);
  setBusy(repoId, true);
  window.clearTimeout(timers.get(repoId));
  timers.set(
    repoId,
    window.setTimeout(() => void flush(repoId), DELAY),
  );
}

async function flush(repoId: string): Promise<void> {
  // The running command flushes the queue when it ends.
  if (running.has(repoId)) return;
  const batch = waiting.get(repoId);
  waiting.delete(repoId);
  if (!batch || batch.ops.size === 0) {
    setBusy(repoId, false);
    return;
  }
  running.add(repoId);
  const ops = [...batch.ops.values()];
  const stage = ops.filter((o) => o.to === 'staged').flatMap((o) => o.paths);
  const unstage = ops.filter((o) => o.to === 'unstaged').flatMap((o) => o.paths);
  const verb = stage.length > 0 ? 'stage' : 'unstage';
  const fail = (message: string, runId?: string) => {
    // The rows go back; the next read of the index says where they are.
    setOver(batch.target.entryKey, (m) => ops.forEach((o) => delete m[o.path]));
    useUi.getState().showToast({
      status: 'failed',
      message: t(verb === 'stage' ? 'history.couldNotStage' : 'history.couldNotUnstage', {
        ...cnt(ops.length),
        file: ops[0].path.split('/').pop() ?? ops[0].path,
      }),
      sub: message,
      ...(runId && {
        actionLabel: t('common.showOutput'),
        onAction: () => useRuns.getState().showOutput(runId),
        owner: runId,
      }),
    });
  };
  try {
    const run = await gitStage(batch.target.entry, { stage, unstage });
    nameRun(run.runId, t(verb === 'stage' ? 'history.stageAct' : 'history.unstageAct'), '');
    const runs = useRuns.getState();
    if (!runs.runs[run.runId]) runs.put(run);
    await new Promise<void>((done) => {
      const ended = () => {
        const r = useRuns.getState().runs[run.runId];
        if (!r || r.status === 'running') return false;
        if (r.status !== 'exited' || r.exitCode !== 0) fail(r.lastLine || batch.target.label, r.runId);
        done();
        return true;
      };
      if (ended()) return;
      const off = useRuns.subscribe(() => ended() && off());
    });
  } catch (err) {
    fail((err as AppError).message);
  } finally {
    running.delete(repoId);
    const key = batch.target.entryKey;
    useStage.setState((s) => ({ done: { ...s.done, [key]: (s.done[key] ?? 0) + 1 } }));
  }
  if (waiting.has(repoId)) await flush(repoId);
  else setBusy(repoId, false);
}

/** The index as shown: git's lists with the files moved but not read back yet. `whole` is each
 * file against HEAD (Uncommitted's list): a file staged or unstaged whole shows that. */
export function withMoves(index: IndexChanges, whole: FileChange[], over: Record<string, StageTo> | undefined): IndexChanges {
  if (!over || Object.keys(over).length === 0) return index;
  const staged = index.staged.filter((f) => !(f.path in over));
  const unstaged = index.unstaged.filter((f) => !(f.path in over));
  for (const [path, to] of Object.entries(over)) {
    const head = whole.find((f) => f.path === path);
    const known = head ?? index.staged.find((f) => f.path === path) ?? index.unstaged.find((f) => f.path === path);
    if (!known) continue;
    // Staged whole, an untracked file is new.
    if (to === 'staged') staged.push(known.kind === 'U' ? { ...known, kind: 'A' } : known);
    // Unstaged whole, a new file is untracked again.
    else unstaged.push(known.kind === 'A' ? { ...known, kind: 'U' } : known);
  }
  const byPath = (a: FileChange, b: FileChange) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { staged: staged.sort(byPath), unstaged: unstaged.sort(byPath) };
}
