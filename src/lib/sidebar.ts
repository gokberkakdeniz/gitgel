// The main sidebar's visibility: UI state for instant toggles, remembered in the config and
// cached for the next launch (the window shows before the config arrives).
import { useData } from '../state/data';
import { SIDEBAR_CACHE_KEY, useUi } from '../state/ui';
import { updateSettings } from './ipc';
import type { Config } from './types';

function show(visible: boolean) {
  if (useUi.getState().sidebarVisible !== visible) useUi.getState().setSidebarVisible(visible);
  try {
    localStorage.setItem(SIDEBAR_CACHE_KEY, String(visible));
  } catch {
    // Private browsing or similar: the next launch starts with it shown.
  }
}

/** Shows or hides the sidebar; the choice is written to the config. */
export function setSidebarVisible(visible: boolean) {
  show(visible);
  const settings = useData.getState().config?.settings;
  if (settings && settings.sidebarVisible !== visible) {
    void updateSettings({ ...settings, sidebarVisible: visible });
  }
}

/** Follows the config: the backend owns it (initial load, `config-changed`). */
export function syncSidebarVisible(config: Config) {
  show(config.settings.sidebarVisible);
}
