// The only place backend events are listened to.
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useData } from '../state/data';
import { selectRoute, useNav } from '../state/nav';
import { useUi } from '../state/ui';
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
    const before = useData.getState().config?.settings;
    data.setConfig(e.payload);
    // The terminal item follows Settings › Behaviour › Terminal.
    const after = e.payload.settings;
    if (before && (before.terminal !== after.terminal || before.terminalCommand !== after.terminalCommand)) {
      void loadOpenApps();
    }
  });
  await listen<RepoUpdated>('repo-updated', (e) => data.applyRepoUpdated(e.payload));
  // App menu › Settings… (⌘,). Listed in lib/shortcuts.ts.
  await listen('open-settings', () => {
    const nav = useNav.getState();
    if (useUi.getState().modalCount === 0 && selectRoute(nav).name !== 'settings') nav.push({ name: 'settings' });
  });
  // Safety net for events the watcher missed; there is no timer.
  // An app installed meanwhile shows up in the open items.
  await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused) return;
    void loadOpenApps();
    void loadTerminalOptions();
    if (useData.getState().scannedOnce) void rescanAll();
  });

  void loadOpenApps();
  void loadTerminalOptions();
  const [config] = await Promise.all([ipc.getConfig(), loadHome()]);
  // A config-changed that arrived meanwhile is newer than this answer.
  if (configEvents === 0) data.setConfig(config);
  data.setScan(await ipc.getScan());
}

async function loadOpenApps() {
  try {
    const apps = await ipc.getOpenApps();
    if (JSON.stringify(apps) !== JSON.stringify(useData.getState().openApps)) useData.getState().setOpenApps(apps);
  } catch (e) {
    console.error('cannot list apps', e);
  }
}

async function loadTerminalOptions() {
  try {
    const options = await ipc.getTerminalOptions();
    if (JSON.stringify(options) !== JSON.stringify(useData.getState().terminalOptions))
      useData.getState().setTerminalOptions(options);
  } catch (e) {
    console.error('cannot list terminals', e);
  }
}

let rescanning: Promise<void> | null = null;
let rescanningForced = false;
let current: object | null = null;

/** Full rescan. The backend pushes each repo as `repo-updated`. `force` (the refresh button)
 * also rereads every working tree; window focus relies on the file watcher for those. A call
 * while one is running joins it, unless it asks for more (a forced one after a plain one). */
export function rescanAll(force = false): Promise<void> {
  if (rescanning && (rescanningForced || !force)) return rescanning;
  const previous = rescanning;
  const token = {};
  current = token;
  const run = (async () => {
    await previous;
    useData.getState().setRefreshing(true);
    try {
      await ipc.rescanAll(force);
    } catch (e) {
      console.error('rescan failed', e);
    } finally {
      if (current === token) {
        rescanning = null;
        useData.getState().setRefreshing(false);
      }
    }
  })();
  rescanning = run;
  rescanningForced = force;
  return run;
}
