// Stage / Unstage (SPEC §15 "Stage", Hi5): Review's Staged and Unstaged sections are git's
// index. A click moves the row at once; its git command waits 150ms for more clicks and runs
// with them as one, one at a time per repository (git's index.lock, and one git action per
// repository). Picked lines of a diff queue here too, each as a command of its own. While a
// repository's queue is not empty its Commit button is off. A failed run puts the rows back and
// says so in a toast.
import { create } from 'zustand';
import { t } from '../../i18n';
import { cnt } from '../../lib/format';
import { gitStage, gitStageLines } from '../../lib/ipc';
import type { AppError, EntryRef, FileChange, IndexChanges, ScriptRun, StageLines } from '../../lib/types';
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

const setBusy = (repoId: string, on: boolean) => useStage.setState((s) => ({ busy: { ...s.busy, [repoId]: on } }));

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
  setOver(entryKey, (m) => {
    for (const o of ops) m[o.path] = o.to;
  });
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

/** A Stage of picked lines (the diff's menu): one file's new staged version, a command of its
 * own in the same queue. */
interface LinesJob {
  target: StageTarget;
  lines: StageLines;
  done: (ok: boolean) => void;
}
const linesWaiting = new Map<string, LinesJob[]>();

/** Queues picked lines; resolves false when they could not be staged (the toast says so). */
export function requestStageLines(target: StageTarget, lines: StageLines): Promise<boolean> {
  return new Promise((done) => {
    const { repoId } = target;
    linesWaiting.set(repoId, [...(linesWaiting.get(repoId) ?? []), { target, lines, done }]);
    setBusy(repoId, true);
    void flush(repoId);
  });
}

/** Runs one stage command and waits for it; a failure is told in a toast. */
async function execute(
  target: StageTarget,
  verb: 'stage' | 'unstage',
  start: () => Promise<ScriptRun>,
  toast: (message: string, runId?: string) => void,
): Promise<boolean> {
  try {
    const run = await start();
    nameRun(run.runId, t(verb === 'stage' ? 'history.stageAct' : 'history.unstageAct'), '');
    const runs = useRuns.getState();
    if (!runs.runs[run.runId]) runs.put(run);
    return await new Promise<boolean>((done) => {
      const ended = () => {
        const r = useRuns.getState().runs[run.runId];
        if (!r || r.status === 'running') return false;
        const ok = r.status === 'exited' && r.exitCode === 0;
        if (!ok) toast(r.lastLine || target.label, r.runId);
        done(ok);
        return true;
      };
      if (ended()) return;
      const off = useRuns.subscribe(() => ended() && off());
    });
  } catch (err) {
    toast((err as AppError).message);
    return false;
  }
}

const failToast = (message: string, sub: string, runId?: string) =>
  useUi.getState().showToast({
    status: 'failed',
    message,
    sub,
    ...(runId && {
      actionLabel: t('common.showOutput'),
      onAction: () => useRuns.getState().showOutput(runId),
      owner: runId,
    }),
  });

const fileName = (path: string) => path.split('/').pop() ?? path;

async function flush(repoId: string): Promise<void> {
  // The running command flushes the queue when it ends.
  if (running.has(repoId)) return;
  const job = linesWaiting.get(repoId)?.shift();
  const batch = job ? undefined : waiting.get(repoId);
  if (!job) waiting.delete(repoId);
  if (!job && (!batch || batch.ops.size === 0)) {
    setBusy(repoId, false);
    return;
  }
  running.add(repoId);
  const target = job?.target ?? batch!.target;
  try {
    if (job) {
      const verb = job.lines.unstage ? 'unstage' : 'stage';
      const ok = await execute(
        target,
        verb,
        () => gitStageLines(target.entry, job.lines),
        (sub, runId) =>
          failToast(
            t(verb === 'stage' ? 'history.couldNotStage' : 'history.couldNotUnstage', {
              ...cnt(1),
              file: fileName(job.lines.path),
            }),
            sub,
            runId,
          ),
      );
      job.done(ok);
    } else {
      const ops = [...batch!.ops.values()];
      const stage = ops.filter((o) => o.to === 'staged').flatMap((o) => o.paths);
      const unstage = ops.filter((o) => o.to === 'unstaged').flatMap((o) => o.paths);
      const verb = stage.length > 0 ? 'stage' : 'unstage';
      await execute(
        target,
        verb,
        () => gitStage(target.entry, { stage, unstage }),
        (sub, runId) => {
          // The rows go back; the next read of the index says where they are.
          setOver(target.entryKey, (m) => {
            for (const o of ops) delete m[o.path];
          });
          failToast(
            t(verb === 'stage' ? 'history.couldNotStage' : 'history.couldNotUnstage', {
              ...cnt(ops.length),
              file: fileName(ops[0].path),
            }),
            sub,
            runId,
          );
        },
      );
    }
  } finally {
    running.delete(repoId);
    const key = target.entryKey;
    useStage.setState((s) => ({ done: { ...s.done, [key]: (s.done[key] ?? 0) + 1 } }));
  }
  if (waiting.has(repoId) || (linesWaiting.get(repoId)?.length ?? 0) > 0) await flush(repoId);
  else setBusy(repoId, false);
}

/** The index as shown: git's lists with the files moved but not read back yet. `whole` is each
 * file against HEAD (Uncommitted's list): a file staged or unstaged whole shows that. */
export function withMoves(
  index: IndexChanges,
  whole: FileChange[],
  over: Record<string, StageTo> | undefined,
): IndexChanges {
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
