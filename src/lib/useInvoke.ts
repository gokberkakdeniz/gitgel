// Request/response data from the backend, refetched when the repos or config it depends on change.
import { useEffect, useRef, useState } from 'react';
import { useData } from '../state/data';
import type { AppError } from './types';

export interface InvokeState<T> {
  data: T | undefined;
  error: AppError | undefined;
  loading: boolean;
}

interface Options {
  repoIds?: string[]; // refetch on repo-updated for any of these repos
  onConfig?: boolean; // refetch on config-changed
  enabled?: boolean;
}

export function useInvoke<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  { repoIds, onConfig = false, enabled = true }: Options = {},
): InvokeState<T> {
  const versions = useData((s) => reloadKey(s, repoIds, onConfig));
  const [state, setState] = useState<InvokeState<T>>(InvokeRunner.initial);
  const runner = useRef<InvokeRunner<T> | null>(null);
  runner.current ??= new InvokeRunner<T>(setState);
  const latestFetcher = useRef(fetcher);
  latestFetcher.current = fetcher;

  useEffect(() => {
    const r = runner.current!;
    r.attach();
    return () => r.detach();
  }, []);

  useEffect(() => {
    if (enabled) runner.current!.run(() => latestFetcher.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, versions, enabled]);

  return state;
}

/** Changes whenever one of `repoIds` is updated, or the config when `onConfig` is set. */
export function reloadKey(
  s: { repoVersion: Record<string, number>; configVersion: number },
  repoIds: string[] | undefined,
  onConfig: boolean,
): string {
  const repos = (repoIds ?? []).map((id) => s.repoVersion[id] ?? 0).join(',');
  return onConfig ? `${repos}|${s.configVersion}` : repos;
}

/**
 * Runs fetches for one hook instance. Keeps the previous data while reloading, and drops
 * answers that are not from the latest call or that arrive while detached (unmounted).
 */
export class InvokeRunner<T> {
  static initial = { data: undefined, error: undefined, loading: false };

  private state: InvokeState<T> = InvokeRunner.initial;
  private seq = 0;
  private attached = true;

  constructor(private readonly onChange: (state: InvokeState<T>) => void) {}

  attach() {
    this.attached = true;
  }

  detach() {
    this.attached = false;
  }

  run(fetcher: () => Promise<T>): Promise<void> {
    const id = ++this.seq;
    this.set({ ...this.state, loading: true });
    return fetcher().then(
      (data) => {
        if (this.isCurrent(id)) this.set({ data, error: undefined, loading: false });
      },
      (err: unknown) => {
        if (this.isCurrent(id)) this.set({ ...this.state, error: toAppError(err), loading: false });
      },
    );
  }

  private isCurrent(id: number) {
    return this.attached && id === this.seq;
  }

  private set(state: InvokeState<T>) {
    this.state = state;
    if (this.attached) this.onChange(state);
  }
}

function toAppError(err: unknown): AppError {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return err as AppError;
  }
  return { code: 'unknown', message: String(err) };
}
