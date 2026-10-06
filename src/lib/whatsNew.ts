// What's New after an update (SPEC §7 "Help › What's New").
import { useEffect, useRef } from 'react';
import { version } from '../../package.json';
import { useData } from '../state/data';
import { compareVersions } from './changelog';
import { openWindow, updateSettings } from './ipc';

/** Opens What's New once after an update: when the config's `lastSeenVersion` is older than
 * this build, or missing from a config that has repositories (versions before 0.1.17 did not
 * write it). A fresh install only records the version. */
export function useWhatsNewAfterUpdate() {
  const config = useData((s) => s.config);
  const done = useRef(false);
  useEffect(() => {
    if (!config || done.current) return;
    done.current = true;
    const seen = config.settings.lastSeenVersion;
    if (seen && compareVersions(seen, version) >= 0) return;
    if (seen || config.repos.length > 0) void openWindow('whats-new');
    void updateSettings({ ...config.settings, lastSeenVersion: version });
  }, [config]);
}
