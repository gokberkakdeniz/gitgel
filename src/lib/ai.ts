// Commit message generation (SPEC §15 "Generate message"): the frontend end of the
// backend's `generate-finished` event.
import type { CommitProvider, GenerateFinished } from './types';

/** The agent CLIs, in menu order: their labels, binaries and whether the CLI takes `--effort`. */
export interface AiProviderMeta {
  id: CommitProvider;
  label: string;
  binary: string;
  effort: boolean;
}
export const AI_PROVIDERS: AiProviderMeta[] = [
  { id: 'opencode', label: 'OpenCode', binary: 'opencode', effort: true },
  { id: 'claude', label: 'Claude Code', binary: 'claude', effort: false },
  { id: 'cursor', label: 'Cursor', binary: 'agent', effort: false },
  { id: 'antigravity', label: 'Antigravity', binary: 'agy', effort: true },
  { id: 'codex', label: 'Codex', binary: 'codex', effort: true },
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

/** Calls back with one generation run's answer; returns the unsubscribe. */
export function onGenerateFinished(runId: string, listener: Listener): () => void {
  const set = listeners.get(runId) ?? new Set();
  set.add(listener);
  listeners.set(runId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(runId);
  };
}

/** `generate-finished`: to whoever started that run, if still around. */
export function applyGenerateFinished(result: GenerateFinished): void {
  listeners.get(result.runId)?.forEach((l) => l(result));
}
