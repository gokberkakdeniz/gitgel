// Running scripts from the menus (SPEC §14): the runs this window knows about and their toasts.
import { create } from 'zustand';
import { runScript } from '../lib/ipc';
import type { AppError, EntrySummary, ScriptConfig, ScriptInput, ScriptOutputChunk, ScriptRun } from '../lib/types';
import { useUi } from '../state/ui';
import { branchContext, checkWhen, evalWhen, type ScriptMenuName } from './when';

/** How a run was started, for Run again. */
export interface RunStart {
  script: ScriptConfig;
  entry: EntrySummary;
  menu: ScriptMenuName;
  project?: string;
  inputs: Record<string, string>;
}

/** A script picked from a menu, before it runs. */
export interface RunRequest {
  script: ScriptConfig;
  entry: EntrySummary;
  menu: ScriptMenuName;
  project?: string;
}

interface RunsState {
  runs: Record<string, ScriptRun>;
  /** The run dialog is open for this pick (flow O). */
  dialog: RunRequest | null;
  starts: Record<string, RunStart>;
  /** The output panel shows this run; its toast is hidden meanwhile. */
  shownRunId: string | null;
  put: (run: ScriptRun) => void;
  showOutput: (runId: string | null) => void;
}

export const useRuns = create<RunsState>()((set, get) => ({
  runs: {},
  dialog: null,
  starts: {},
  shownRunId: null,
  put: (run) => set((s) => ({ runs: { ...s.runs, [run.runId]: run } })),
  showOutput: (runId) => {
    const before = get().shownRunId;
    set({ shownRunId: runId });
    if (runId) {
      // The panel says what the toast said.
      const ui = useUi.getState();
      if (ui.toast?.owner === runId) ui.dismissToast();
      return;
    }
    // Closed while it still runs: the toast comes back as the way back to it.
    const run = before ? get().runs[before] : undefined;
    if (run?.status === 'running') showRunToast(run);
  },
}));

type OutputListener = (chunk: ScriptOutputChunk) => void;
const outputListeners = new Map<string, Set<OutputListener>>();

/** The output panel listens to its run's chunks; returns the unsubscribe. */
export function onRunOutput(runId: string, listener: OutputListener): () => void {
  const set = outputListeners.get(runId) ?? new Set();
  set.add(listener);
  outputListeners.set(runId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) outputListeners.delete(runId);
  };
}

/** `script-output`: to the panel showing that run, if any. */
export function applyRunOutput(chunk: ScriptOutputChunk): void {
  outputListeners.get(chunk.runId)?.forEach((l) => l(chunk));
}

/** `{branch}`, `{base}` and `{repo}` in a script's name, as the menu shows it. */
export function fillName(name: string, e: EntrySummary): string {
  return name
    .split('{branch}')
    .join(e.branch ?? e.shortSha ?? '')
    .split('{base}')
    .join(e.base ?? '')
    .split('{repo}')
    .join(e.repoName);
}

/** The inputs that show, in order, given the values so far: each one's `when` sees the
 * shown inputs before it. A `when` that fails is listed with its error (and shown). */
export function shownInputs(
  script: ScriptConfig,
  e: EntrySummary,
  menu: ScriptMenuName,
  project: string | undefined,
  values: Record<string, string>,
): { input: ScriptInput; error: string | null }[] {
  const branch = branchContext(e, menu, project);
  const seen: Record<string, string> = {};
  const out: { input: ScriptInput; error: string | null }[] = [];
  script.inputs.forEach((input, i) => {
    const defs = script.inputs.slice(0, i);
    const error = checkWhen(input.when, defs);
    if (error || evalWhen(input.when, branch, { defs, values: seen })) {
      seen[input.id] = values[input.id] ?? input.default;
      out.push({ input, error });
    }
  });
  return out;
}

/** Each input that shows (its `when`, in order) with its default value. */
export function defaultInputs(
  script: ScriptConfig,
  e: EntrySummary,
  menu: ScriptMenuName,
  project?: string,
): Record<string, string> {
  return Object.fromEntries(
    shownInputs(script, e, menu, project, {}).map(({ input }) => [input.id, input.default]),
  );
}

/** A menu pick: the run dialog when the script has inputs to show or asks first; else it runs. */
export function pickScript(script: ScriptConfig, e: EntrySummary, menu: ScriptMenuName, project?: string): void {
  if (script.askFirst || shownInputs(script, e, menu, project, {}).length > 0) {
    useRuns.setState({ dialog: { script, entry: e, menu, project } });
  } else {
    void startScript(script, e, menu, project);
  }
}

/** The values the run dialog opens with: each input's default (nothing is remembered). */
export function initialInputs(script: ScriptConfig): Record<string, string> {
  return Object.fromEntries(script.inputs.map((i) => [i.id, i.default]));
}

/** Runs a script on an entry and shows its toast; with `show` (default: the script's `openOutput`)
 * its output panel opens instead. One already running for the entry opens its output panel.
 * `inputs`: the shown inputs only (from the run dialog, else their defaults). */
export async function startScript(
  script: ScriptConfig,
  e: EntrySummary,
  menu: ScriptMenuName,
  project?: string,
  inputs: Record<string, string> = defaultInputs(script, e, menu, project),
  show = script.openOutput,
): Promise<void> {
  const entry = { repoId: e.repoId, branch: e.branch, worktreePath: e.branch === null ? e.worktreePath : null };
  try {
    const run = await runScript(script, entry, inputs, { base: e.base, project: project ?? null });
    const runs = useRuns.getState();
    const known = runs.runs[run.runId];
    if (known?.status === 'running') {
      runs.showOutput(run.runId);
      return;
    }
    useRuns.setState((s) => ({ starts: { ...s.starts, [run.runId]: { script, entry: e, menu, project, inputs } } }));
    if (show) runs.showOutput(run.runId);
    // A quick script can end (`script-exited`) before this answer arrives; keep the end.
    if (known) return;
    runs.put(run);
    showRunToast(run);
  } catch (err) {
    useUi.getState().showToast({
      status: 'failed',
      message: `“${fillName(script.name, e)}” could not start`,
      sub: (err as AppError).message,
    });
  }
}

/** How a git action's end is shown (sync, W4a). */
export interface GitActionShow {
  /** A failed run opens its output panel instead of a toast. */
  openOnFail?: boolean;
  /** The success toast's message instead of “<name>” finished. */
  done?: string;
}
const gitActionShow = new Map<string, GitActionShow>();

/** Starts a git action (SPEC §15): its run gets the toast and output panel of a script's, but
 * no Run again. `name` is for the toast when it cannot start. */
export async function startGitAction(
  name: string,
  start: () => Promise<ScriptRun>,
  show: GitActionShow = {},
): Promise<void> {
  try {
    const run = await start();
    gitActionShow.set(run.runId, show);
    const runs = useRuns.getState();
    // A quick action can end (`script-exited`) before this answer arrives; keep the end.
    const known = runs.runs[run.runId];
    if (known) {
      if (known.status !== 'running') showRunToast(known);
      return;
    }
    runs.put(run);
    showRunToast(run);
  } catch (err) {
    useUi.getState().showToast({ status: 'failed', message: `“${name}” could not start`, sub: (err as AppError).message });
  }
}

/** The toast for a run: running (stays), then finished or failed; a click opens its output.
 * One toast at a time. */
export function showRunToast(run: ScriptRun): void {
  // Its output panel is open: the panel's pill says it all.
  if (useRuns.getState().shownRunId === run.runId) return;
  const output = { owner: run.runId, onClick: () => useRuns.getState().showOutput(run.runId) };
  if (run.status === 'running') {
    useUi.getState().showToast({
      status: 'running',
      message: `Running “${run.name}”…`,
      sub: run.repoLabel,
      ...output,
    });
    return;
  }
  if (run.status === 'failed') {
    useUi.getState().showToast({ status: 'failed', message: `“${run.name}” could not start`, sub: run.lastLine });
    return;
  }
  const ok = run.exitCode === 0;
  const show = gitActionShow.get(run.runId);
  if (!ok && show?.openOnFail && !run.stopped) {
    useRuns.getState().showOutput(run.runId);
    return;
  }
  const why = run.stopped ? 'stopped' : run.exitCode !== null ? `exit ${run.exitCode}` : (run.signal ?? 'ended');
  // The last line says how it went.
  useUi.getState().showToast({
    status: ok ? 'success' : 'failed',
    message: ok ? (show?.done ?? `“${run.name}” finished`) : `“${run.name}” failed · ${why}`,
    sub: run.lastLine || run.repoLabel,
    ...output,
  });
}

/** `script-exited`: the run's end, and its toast. */
export function applyRunExited(run: ScriptRun): void {
  useRuns.getState().put(run);
  showRunToast(run);
}

/** Run again from the output panel: the same script, entry and inputs. */
export function runAgain(runId: string): void {
  const start = useRuns.getState().starts[runId];
  if (start) void startScript(start.script, start.entry, start.menu, start.project, start.inputs, true);
}

// Dev only: a hot swap would leave the event listeners (lib/events.ts) on the old store, so a
// change here reloads the page instead.
import.meta.hot?.accept(() => window.location.reload());
