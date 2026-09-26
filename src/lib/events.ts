// The only place backend events are listened to.
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useData } from '../state/data';
import * as ipc from './ipc';
import { loadHome } from './paths';
import type { Config, RepoUpdated } from './types';

let started: Promise<void> | null = null;

/** Subscribes to backend events, then loads the config and the scan. Safe to call more than once. */
export function startEventBridge(): Promise<void> {
  started ??= start();
  return started;
}

async function start() {
  const data = useData.getState();
  let configEvents = 0;
  // Listen first so nothing emitted during the initial load is lost.
  await listen<Config>('config-changed', (e) => {
    configEvents++;
    data.setConfig(e.payload);
  });
  await listen<RepoUpdated>('repo-updated', (e) => data.applyRepoUpdated(e.payload));
  // Safety net for events the watcher missed; there is no timer.
  await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused && useData.getState().scannedOnce) void rescanAll();
  });

  const [config] = await Promise.all([ipc.getConfig(), loadHome()]);
  // A config-changed that arrived meanwhile is newer than this answer.
  if (configEvents === 0) data.setConfig(config);
  data.setScan(await ipc.getScan());
}

let rescanning: Promise<void> | null = null;

/** Full rescan (focus and refresh buttons). The backend pushes each repo as `repo-updated`.
 * A call while one is running joins it. */
export function rescanAll(): Promise<void> {
  rescanning ??= (async () => {
    useData.getState().setRefreshing(true);
    try {
      await ipc.rescanAll();
    } catch (e) {
      console.error('rescan failed', e);
    } finally {
      useData.getState().setRefreshing(false);
      rescanning = null;
    }
  })();
  return rescanning;
}
