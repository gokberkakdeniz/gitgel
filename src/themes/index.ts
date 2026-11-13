// The themes of the app and of Monaco (docs/SPEC.md §4 "Themes"). A theme is a `<id>.json` file
// in this folder, written to `theme.schema.json`; its CSS tokens and its Monaco themes come from
// it. `index.html` holds a copy of Gitgel's two grounds (bgMain, bgElevated) for the first launch.
import type { Theme, ThemeColors, ThemeFile, ThemeVariant } from './types';
import { validate } from './validate';

export type { EditorColors, Theme, ThemeColors, ThemeFile, ThemeVariant } from './types';

const files = import.meta.glob<Theme>(['./*.json', '!./theme.schema.json'], { eager: true, import: 'default' });

/** Gitgel, the default, then by name. */
const BUILT_IN: readonly Theme[] = Object.values(files).sort(
  (a, b) => Number(b.id === 'gitgel') - Number(a.id === 'gitgel') || a.name.localeCompare(b.name),
);

/** In the order Settings lists them: the built-in themes, then the custom ones by name. */
export const THEMES: Theme[] = [...BUILT_IN];

export type Mode = 'light' | 'dark';
export const MODES: readonly Mode[] = ['light', 'dark'];

/** The modes a theme has: both, or the one of a light-only or dark-only theme. */
export function modesOf(theme: Theme): Mode[] {
  return MODES.filter((m) => theme[m]);
}

/** A theme in one mode, `<id>-<mode>`: the `data-theme` value and the Monaco theme name. */
export type EffectiveTheme = string;

/** A mode the theme does not have is the one it has. */
export function effectiveId(theme: string, mode: Mode): EffectiveTheme {
  const t = themeOf(theme);
  return `${t.id}-${t[mode] ? mode : modesOf(t)[0]}`;
}

/** The theme with this id; one that is not there (removed, hand-edited config) is the default. */
export function themeOf(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isEffective(id: string | undefined): id is EffectiveTheme {
  return THEMES.some((t) => modesOf(t).some((m) => id === `${t.id}-${m}`));
}

export function modeOf(effective: EffectiveTheme): Mode {
  return effective.endsWith('-light') ? 'light' : 'dark';
}

/** The theme an effective id names (`github-dark` → GitHub). */
export function themeOfEffective(effective: EffectiveTheme): Theme {
  return themeOf(effective.slice(0, effective.lastIndexOf('-')));
}

export function variantOf(effective: EffectiveTheme): ThemeVariant {
  const t = themeOfEffective(effective);
  return (t[modeOf(effective)] ?? t.dark ?? t.light)!;
}

// ---- CSS tokens ----

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
}

function declarations(mode: Mode, c: ThemeColors): string {
  const lines = [`color-scheme: ${mode}`];
  for (const [key, value] of Object.entries(c)) lines.push(`--${kebab(key)}: ${value}`);
  lines.push(
    `--accent-rgb: ${rgb(c.accent)}`,
    `--warning-rgb: ${rgb(c.warningTint)}`,
    `--danger-rgb: ${rgb(c.dangerTint)}`,
    `--diff-filler: repeating-linear-gradient(135deg, ${c.bgBand} 0 4px, ${c.bgMain} 4px 8px)`,
    `--focus-ring: 0 0 0 1px ${c.accent}, 0 0 0 3px rgba(${rgb(c.accent)}, 0.25)`,
  );
  return lines.join(';');
}

/** Every theme's tokens, one rule per `data-theme`; bare `:root` is the default theme, dark. */
export function themeCss(): string {
  const rules = [`:root{${declarations('dark', BUILT_IN[0].dark!.colors)}}`];
  for (const t of THEMES)
    for (const m of modesOf(t)) rules.push(`:root[data-theme='${t.id}-${m}']{${declarations(m, t[m]!.colors)}}`);
  return rules.join('\n');
}

// ---- Custom themes ----

// The theme files of `<config folder>/themes`, as last read: a window starts with them, before
// the backend answers, and the other windows hear of a change (`storage`).
const CUSTOM_KEY = 'gitgel.custom-themes';

const listeners = new Set<() => void>();
let version = 0;

/** Called when the custom themes change (the CSS is already in place). */
export function onThemesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Grows with every change; a snapshot for `useSyncExternalStore`. */
export function themesVersion(): number {
  return version;
}

/** Replaces the custom themes with the valid files; returns what is wrong with the others. */
function register(custom: ThemeFile[]): string[] {
  const problems: string[] = [];
  const themes: Theme[] = [];
  for (const file of custom) {
    let value: unknown;
    try {
      value = JSON.parse(file.content);
    } catch {
      problems.push(`${file.name}: not JSON`);
      continue;
    }
    const problem = validate(value);
    const { $schema: _, ...theme } = value as Theme & { $schema?: string };
    if (problem) problems.push(`${file.name}: ${problem}`);
    else if ([...BUILT_IN, ...themes].some((t) => t.id === theme.id))
      problems.push(`${file.name}: the id "${theme.id}" is taken`);
    else themes.push(theme);
  }
  themes.sort((a, b) => a.name.localeCompare(b.name));
  THEMES.splice(BUILT_IN.length, Infinity, ...themes);
  return problems;
}

function cached(): ThemeFile[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
    return Array.isArray(value) ? (value as ThemeFile[]) : [];
  } catch {
    return [];
  }
}

function writeCss() {
  if (typeof document === 'undefined') return;
  let style = document.querySelector<HTMLStyleElement>('style[data-themes]');
  if (!style) {
    style = document.createElement('style');
    style.dataset.themes = '';
    document.head.appendChild(style);
  }
  style.textContent = themeCss();
}

function changed() {
  writeCss();
  version += 1;
  for (const fn of listeners) fn();
}

/**
 * The custom theme files as just read from disk (lib/theme.ts `loadCustomThemes`). Returns what
 * is wrong with the files left out.
 */
export function setCustomThemes(custom: ThemeFile[]): string[] {
  const next = JSON.stringify(custom);
  const same = next === JSON.stringify(cached());
  try {
    localStorage.setItem(CUSTOM_KEY, next);
  } catch {
    // Private browsing or similar; the themes still work in this window.
  }
  const problems = register(custom);
  if (!same) changed();
  return problems;
}

/** Puts the tokens on the page. Called once, before the first render (main.tsx). */
export function installThemes() {
  register(cached());
  writeCss();
  window.addEventListener('storage', (e) => {
    if (e.key !== CUSTOM_KEY) return;
    register(cached());
    changed();
  });
}
