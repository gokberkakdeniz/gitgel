// The only place backend events are listened to.
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useData } from '../state/data';
import { openSettings } from '../state/nav';
import { useUi } from '../state/ui';
import * as ipc from './ipc';
import { loadHome } from './paths';
import { syncSidebarVisible } from './sidebar';
import { applyPassphraseAsked, applyPassphraseRunExited } from '../scripts/PassphraseDialog';
import { applyRunExited, applyRunOutput } from '../scripts/runs';
import { applyGenerateFinished } from './ai';
import type { Config, GenerateFinished, RepoUpdated, ScriptOutputChunk, ScriptRun, UpdateInfo } from './types';

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
    syncSidebarVisible(e.payload);
    // The editor and terminal items follow Settings › General › Editor and Terminal.
    const after = e.payload.settings;
    if (
      before &&
      (before.editor !== after.editor ||
        before.editorCommand !== after.editorCommand ||
        before.terminal !== after.terminal ||
        before.terminalCommand !== after.terminalCommand)
    ) {
      void loadOpenApps();
    }
  });
  await listen<RepoUpdated>('repo-updated', (e) => data.applyRepoUpdated(e.payload));
  // A script ended (scripts/run.rs); its toast says how.
  await listen<ScriptRun>('script-exited', (e) => {
    applyRunExited(e.payload);
    applyPassphraseRunExited(e.payload);
  });
  // ssh asked for a key's passphrase in a run (SPEC §15 "SSH passphrase").
  await listen<{ runId: string; key: string }>('ssh-passphrase', (e) => applyPassphraseAsked(e.payload));
  await listen<ScriptOutputChunk>('script-output', (e) => applyRunOutput(e.payload));
  // A generation run answered (src/ai.ts); the starter fills its form.
  await listen<GenerateFinished>('generate-finished', (e) => applyGenerateFinished(e.payload));
  // The backend checks for updates at launch and on focus (updates.rs).
  await listen<UpdateInfo | null>('update-available', (e) => data.setUpdate(e.payload));
  await listen<number | null>('update-progress', (e) => data.setUpdateProgress(e.payload ?? 'unknown'));
  // The small windows (About, Software Update, What's New) block this one while open.
  await listen<string[]>('aux-windows', (e) => useUi.getState().setAuxWindows(e.payload));
  // App menu › Settings… (⌘,). Listed in lib/shortcuts.ts.
  await listen('open-settings', () => {
    if (useUi.getState().modalCount === 0) openSettings();
  });
  // Safety net for events the watcher missed; there is no timer.
  // An app installed meanwhile shows up in the open items.
  await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused) return;
    void loadOpenApps();
    void loadAppOptions();
    if (useData.getState().scannedOnce) void rescanAll();
  });

  void loadOpenApps();
  void loadAppOptions();
  // A check that finished before the listener was added.
  void ipc.getUpdate().then((u) => u && data.setUpdate(u));
  const [config] = await Promise.all([ipc.getConfig(), loadHome()]);
  // A config-changed that arrived meanwhile is newer than this answer.
  if (configEvents === 0) {
    data.setConfig(config);
    syncSidebarVisible(config);
  }
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

/** The install state of the editors and terminals the Settings dropdowns offer. */
async function loadAppOptions() {
  try {
    const [editors, terminals] = await Promise.all([ipc.getEditorOptions(), ipc.getTerminalOptions()]);
    const data = useData.getState();
    if (JSON.stringify(editors) !== JSON.stringify(data.editorOptions)) data.setEditorOptions(editors);
    if (JSON.stringify(terminals) !== JSON.stringify(data.terminalOptions)) data.setTerminalOptions(terminals);
  } catch (e) {
    console.error('cannot list editors and terminals', e);
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
