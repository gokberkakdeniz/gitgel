// The main sidebar's visibility: UI state for instant toggles, remembered in the config.
import { useData } from '../state/data';
import { useUi } from '../state/ui';
import { updateSettings } from './ipc';
import type { Config } from './types';

/** Shows or hides the sidebar; the choice is written to the config. */
export function setSidebarVisible(visible: boolean) {
  if (useUi.getState().sidebarVisible !== visible) useUi.getState().setSidebarVisible(visible);
  const settings = useData.getState().config?.settings;
  if (settings && settings.sidebarVisible !== visible) {
    void updateSettings({ ...settings, sidebarVisible: visible });
  }
}

/** Follows the config: the backend owns it (initial load, `config-changed`). */
export function syncSidebarVisible(config: Config) {
  if (useUi.getState().sidebarVisible !== config.settings.sidebarVisible) {
    useUi.getState().setSidebarVisible(config.settings.sidebarVisible);
  }
}
