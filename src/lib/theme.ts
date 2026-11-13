// Effective theme resolution (docs/SPEC.md §4 "Light theme", §5 Settings › Appearance).
import { useSyncExternalStore } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  THEMES,
  effectiveId,
  isEffective,
  modeOf,
  modesOf,
  onThemesChange,
  setCustomThemes,
  themeOf,
  themeOfEffective,
  themesVersion,
  variantOf,
  type EffectiveTheme,
} from '../themes';
import { getCustomThemes } from './ipc';
import type { Appearance, Settings } from './types';

export type { EffectiveTheme };

export const APPEARANCES: { id: Appearance; label: string }[] = [
  { id: 'system', label: 'settings.themeSystem' },
  { id: 'light', label: 'settings.themeLight' },
  { id: 'dark', label: 'settings.themeDark' },
];

/** What Settings › Appearance › Theme saves: a theme (src/themes) and how it follows macOS. */
export type ThemeChoice = Pick<Settings, 'theme' | 'appearance'>;

/**
 * Every theme in every mode it has ("GitHub System", "GitHub Light", …), for Settings and the
 * command palette. A theme with one mode has no System.
 */
export function themeChoices(): (ThemeChoice & { name: string; label: string })[] {
  return THEMES.flatMap((th) => {
    const modes = modesOf(th);
    return APPEARANCES.filter((a) => (a.id === 'system' ? modes.length === 2 : modes.includes(a.id))).map((a) => ({
      theme: th.id,
      appearance: a.id,
      name: th.name,
      label: a.label,
    }));
  });
}

/** The saved choice as one of `themeChoices()`: a theme or mode that is gone is the nearest one. */
export function choiceOf({ theme, appearance }: ThemeChoice): ThemeChoice {
  const th = themeOf(theme);
  const modes = modesOf(th);
  return { theme: th.id, appearance: modes.length === 2 || appearance === modes[0] ? appearance : modes[0] };
}

/**
 * Reads the custom themes (`<config folder>/themes/*.json`) again. Called at launch and when
 * Settings opens the theme list; files that do not follow the schema are named in the console.
 */
export async function loadCustomThemes(): Promise<void> {
  try {
    for (const problem of setCustomThemes(await getCustomThemes())) console.warn(`Theme ${problem}`);
  } catch (e) {
    // Outside Tauri there are none.
    console.warn('get_custom_themes failed', e);
  }
}

/** React hook; re-renders when the custom themes change (its value changes with them). */
export function useThemes(): number {
  return useSyncExternalStore(onThemesChange, themesVersion);
}

// Read by index.html before the bundle loads: the theme, and its bgMain and bgElevated.
const CACHE_KEY = 'gitgel.effective-theme';
const GROUNDS_KEY = 'gitgel.theme-grounds';

// The effective theme for components (e.g. the Monaco `theme` prop). Kept in a module-level
// store so `applyTheme` (called from anywhere) notifies React subscribers.
const initial = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
let current: EffectiveTheme = isEffective(initial) ? initial : 'gitgel-dark';
// What `applyTheme` last set; a preview goes back to it.
let applied = current;
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
  current = applied = effective;
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
    // A theme with one mode keeps it under System too.
    const follows = appearance === 'system' && modesOf(themeOfEffective(effective)).length === 2;
    win.setTheme(follows ? null : modeOf(effective)).catch(warn('setTheme'));
    // Seen while resizing and before the page paints; the launch value is set in Rust.
    const small = new URLSearchParams(window.location.search).has('window');
    win.setBackgroundColor(small ? bgElevated : bgMain).catch(warn('setBackgroundColor'));
  } catch {
    // Not running under Tauri.
  }
}

/**
 * Shows a theme in this window's page and editor without saving it (Settings › Appearance ›
 * Theme, while its list is open); `null` goes back to the applied one.
 */
export function previewTheme(effective: EffectiveTheme | null) {
  const next = effective ?? applied;
  if (next === current) return;
  document.documentElement.dataset.theme = current = next;
  notify();
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
