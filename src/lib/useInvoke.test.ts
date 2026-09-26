import { describe, expect, it } from 'vitest';
import { InvokeRunner, reloadKey, type InvokeState } from './useInvoke';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const states: InvokeState<string>[] = [];
  const runner = new InvokeRunner<string>((s) => states.push(s));
  return { runner, states, last: () => states[states.length - 1] };
}

describe('InvokeRunner', () => {
  it('keeps the old data while reloading', async () => {
    const { runner, last } = setup();
    await runner.run(() => Promise.resolve('first'));
    expect(last()).toEqual({ data: 'first', error: undefined, loading: false });

    const next = deferred<string>();
    const done = runner.run(() => next.promise);
    expect(last()).toEqual({ data: 'first', error: undefined, loading: true });
    next.resolve('second');
    await done;
    expect(last()).toEqual({ data: 'second', error: undefined, loading: false });
  });

  it('drops an answer that is not from the latest call', async () => {
    const { runner, last } = setup();
    const slow = deferred<string>();
    const fast = deferred<string>();
    const a = runner.run(() => slow.promise);
    const b = runner.run(() => fast.promise);
    fast.resolve('new');
    await b;
    slow.resolve('old');
    await a;
    expect(last().data).toBe('new');
    expect(last().loading).toBe(false);
  });

  it('keeps data and reports the error on failure', async () => {
    const { runner, last } = setup();
    await runner.run(() => Promise.resolve('ok'));
    await runner.run(() => Promise.reject({ code: 'git', message: 'boom' }));
    expect(last()).toEqual({ data: 'ok', error: { code: 'git', message: 'boom' }, loading: false });
  });

  it('ignores answers after detach', async () => {
    const { runner, states } = setup();
    const d = deferred<string>();
    const p = runner.run(() => d.promise);
    const count = states.length;
    runner.detach();
    d.resolve('late');
    await p;
    expect(states.length).toBe(count);
  });
});

describe('reloadKey', () => {
  const base = { repoVersion: { r_1: 1, r_2: 5 }, configVersion: 3 };

  it('changes when a watched repo is updated', () => {
    const before = reloadKey(base, ['r_1'], false);
    const after = reloadKey({ ...base, repoVersion: { ...base.repoVersion, r_1: 2 } }, ['r_1'], false);
    expect(after).not.toBe(before);
  });

  it('ignores other repos and the config unless asked', () => {
    const before = reloadKey(base, ['r_1'], false);
    expect(reloadKey({ ...base, repoVersion: { ...base.repoVersion, r_2: 6 } }, ['r_1'], false)).toBe(before);
    expect(reloadKey({ ...base, configVersion: 4 }, ['r_1'], false)).toBe(before);
    expect(reloadKey({ ...base, configVersion: 4 }, ['r_1'], true)).not.toBe(reloadKey(base, ['r_1'], true));
  });
});
