// Commit message generation (SPEC §15 "Generate message"): the frontend end of the
// backend's `generate-finished` event.
import type { CommitProvider, GenerateFinished } from './types';

/** The agent CLIs, in menu order: their labels, binaries and whether the CLI takes an effort. */
export interface AiProviderMeta {
  id: CommitProvider;
  label: string;
  binary: string;
  effort: boolean;
}
export const AI_PROVIDERS: AiProviderMeta[] = [
  { id: 'opencode', label: 'OpenCode', binary: 'opencode', effort: true },
  { id: 'claude', label: 'Claude Code', binary: 'claude', effort: true },
  { id: 'cursor', label: 'Cursor', binary: 'agent', effort: false },
  { id: 'antigravity', label: 'Antigravity', binary: 'agy', effort: true },
  { id: 'codex', label: 'Codex', binary: 'codex', effort: true },
  { id: 'foundation', label: 'Apple Foundation Models', binary: 'fm', effort: false },
];

export const providerLabel = (provider: CommitProvider) =>
  AI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;

/** Menu order from the config; unknown ids are dropped, missing ones appended. */
export function providerOrder(order: string[]): CommitProvider[] {
  const known = AI_PROVIDERS.map((p) => p.id);
  return [
    ...order.filter((id): id is CommitProvider => known.includes(id as CommitProvider)),
    ...known.filter((id) => !order.includes(id)),
  ];
}

type Listener = (result: GenerateFinished) => void;
const listeners = new Map<string, Set<Listener>>();
// Answers that arrived before their starter subscribed: a run that cannot start ends before
// `generate_message_start` returns.
const early = new Map<string, GenerateFinished>();

/** Calls back with one generation run's answer (later, even when it is already here); returns
 * the unsubscribe. */
export function onGenerateFinished(runId: string, listener: Listener): () => void {
  const done = early.get(runId);
  if (done) {
    early.delete(runId);
    let live = true;
    queueMicrotask(() => live && listener(done));
    return () => {
      live = false;
    };
  }
  const set = listeners.get(runId) ?? new Set();
  set.add(listener);
  listeners.set(runId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(runId);
  };
}

/** `generate-finished`: to whoever started that run, or kept until it subscribes. */
export function applyGenerateFinished(result: GenerateFinished): void {
  const set = listeners.get(result.runId);
  if (set) set.forEach((l) => l(result));
  else early.set(result.runId, result);
}
