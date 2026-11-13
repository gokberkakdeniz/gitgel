// Effective theme resolution (docs/SPEC.md §4 "Light theme", §5 Settings › Appearance).
import { useSyncExternalStore } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { THEMES, effectiveId, isEffective, modeOf, variantOf, type EffectiveTheme } from '../themes';
import type { Appearance, Settings } from './types';

export type { EffectiveTheme };

export const APPEARANCES: { id: Appearance; label: string }[] = [
  { id: 'system', label: 'settings.themeSystem' },
  { id: 'light', label: 'settings.themeLight' },
  { id: 'dark', label: 'settings.themeDark' },
];

/** What Settings › Appearance › Theme saves: a theme (src/themes) and how it follows macOS. */
export type ThemeChoice = Pick<Settings, 'theme' | 'appearance'>;

/** Every theme in every mode ("GitHub Light", "GitHub System", …), for the command palette. */
export const THEME_CHOICES: (ThemeChoice & { name: string; label: string })[] = THEMES.flatMap((th) =>
  APPEARANCES.map((a) => ({ theme: th.id, appearance: a.id, name: th.name, label: a.label })),
);

// Read by index.html before the bundle loads: the theme, and its bgMain and bgElevated.
const CACHE_KEY = 'gitgel.effective-theme';
const GROUNDS_KEY = 'gitgel.theme-grounds';

// The effective theme for components (e.g. the Monaco `theme` prop). Kept in a module-level
// store so `applyTheme` (called from anywhere) notifies React subscribers.
const initial = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
let current: EffectiveTheme = isEffective(initial) ? initial : 'gitgel-dark';
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function systemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The chosen theme in the chosen mode, or for System in the macOS appearance. */
export function resolveEffective({ theme, appearance }: ThemeChoice, dark: boolean): EffectiveTheme {
  return effectiveId(theme, appearance === 'system' ? (dark ? 'dark' : 'light') : appearance);
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
  const { bgMain, bgElevated } = variantOf(effective).colors;
  try {
    localStorage.setItem(CACHE_KEY, effective);
    localStorage.setItem(GROUNDS_KEY, `${bgMain},${bgElevated}`);
  } catch {
    // Private browsing or similar; theming still works for this run.
  }
  // Outside Tauri (plain `vite dev` in a browser) there is no window to theme.
  try {
    const win = getCurrentWindow();
    const warn = (what: string) => (e: unknown) => console.warn(`${what} failed`, e);
    win.setTheme(appearance === 'system' ? null : modeOf(effective)).catch(warn('setTheme'));
    // Seen while resizing and before the page paints; the launch value is set in Rust.
    const small = new URLSearchParams(window.location.search).has('window');
    win.setBackgroundColor(small ? bgElevated : bgMain).catch(warn('setBackgroundColor'));
  } catch {
    // Not running under Tauri.
  }
}

/** Follows the macOS appearance while the setting is System. Call once from the app root. */
export function watchSystemTheme(getChoice: () => ThemeChoice | undefined): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    const choice = getChoice();
    if (choice?.appearance === 'system') applyTheme(resolveEffective(choice, query.matches), 'system');
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
