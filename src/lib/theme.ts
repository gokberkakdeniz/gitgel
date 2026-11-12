// Effective theme resolution (docs/SPEC.md §4 "Light theme", §5 Settings › Appearance).
import { useSyncExternalStore } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { palettes, type EffectiveTheme } from '../styles/tokens';
import type { Appearance } from './types';

export type { EffectiveTheme };

export const THEME_CHOICES: { id: Appearance; label: string }[] = [
  { id: 'system', label: 'settings.themeSystem' },
  { id: 'light', label: 'settings.themeLight' },
  { id: 'dark', label: 'settings.themeDark' },
  { id: 'github-light', label: 'settings.themeGithubLight' },
  { id: 'github-dark', label: 'settings.themeGithubDark' },
];

const CACHE_KEY = 'gitgel.effective-theme';

// The effective theme for components (e.g. the Monaco `theme` prop). Kept in a module-level
// store so `applyTheme` (called from anywhere) notifies React subscribers.
const initial = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
let current: EffectiveTheme =
  initial && Object.prototype.hasOwnProperty.call(palettes, initial) ? initial as EffectiveTheme : 'dark';
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function systemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The setting, or for System the macOS appearance. */
export function resolveEffective(appearance: Appearance, dark: boolean): EffectiveTheme {
  return appearance === 'system' ? (dark ? 'dark' : 'light') : appearance;
}

export function isDarkTheme(theme: EffectiveTheme): boolean {
  return theme === 'dark' || theme === 'github-dark';
}

/**
 * Applies the effective theme everywhere at once: the CSS tokens (`data-theme`), the
 * native title bar / traffic lights / menus (`setTheme`, `null` follows the system) and
 * Monaco (through `useEffectiveTheme` in DiffView). The choice is cached so the next launch
 * starts without a flash.
 */
export function applyTheme(effective: EffectiveTheme, appearance: Appearance) {
  document.documentElement.dataset.theme = effective;
  // index.html painted <html> before the CSS loaded; from here the tokens take over.
  document.documentElement.style.removeProperty('background');
  current = effective;
  notify();
  try {
    localStorage.setItem(CACHE_KEY, effective);
  } catch {
    // Private browsing or similar; theming still works for this run.
  }
  // Outside Tauri (plain `vite dev` in a browser) there is no window to theme.
  try {
    const win = getCurrentWindow();
    const warn = (what: string) => (e: unknown) => console.warn(`${what} failed`, e);
    const nativeTheme = appearance === 'system' ? null : isDarkTheme(effective) ? 'dark' : 'light';
    win.setTheme(nativeTheme).catch(warn('setTheme'));
    // Seen while resizing and before the page paints; the launch value is set in Rust.
    const small = new URLSearchParams(window.location.search).has('window');
    const background = small ? palettes[effective].bgElevated : palettes[effective].bgMain;
    win.setBackgroundColor(background).catch(warn('setBackgroundColor'));
  } catch {
    // Not running under Tauri.
  }
}

/** Follows the macOS appearance while the setting is System. Call once from the app root. */
export function watchSystemTheme(getAppearance: () => Appearance): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getAppearance() === 'system') applyTheme(resolveEffective('system', query.matches), 'system');
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

// ---- React binding ----

/** React hook; re-renders when the effective theme changes. */
export function useEffectiveTheme(): EffectiveTheme {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => current,
  );
}
