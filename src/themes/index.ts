// The themes of the app and of Monaco (docs/SPEC.md §4 "Themes"). A new theme is a file here
// (see `types.ts`) added to `THEMES`; its CSS tokens and its Monaco themes come from it.
import { github } from './github';
import { gitgel } from './gitgel';
import type { Theme, ThemeColors, ThemeVariant } from './types';

export type { EditorColors, Theme, ThemeColors, ThemeVariant } from './types';

/** In the order Settings lists them; the first is the default. */
export const THEMES: readonly Theme[] = [gitgel, github];

export type Mode = 'light' | 'dark';
export const MODES: readonly Mode[] = ['light', 'dark'];

/** A theme in one mode, `<id>-<mode>`: the `data-theme` value and the Monaco theme name. */
export type EffectiveTheme = string;

export function effectiveId(theme: string, mode: Mode): EffectiveTheme {
  return `${themeOf(theme).id}-${mode}`;
}

/** The theme with this id; one that is not there (removed, hand-edited config) is the default. */
export function themeOf(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isEffective(id: string | undefined): id is EffectiveTheme {
  return THEMES.some((t) => MODES.some((m) => id === `${t.id}-${m}`));
}

export function modeOf(effective: EffectiveTheme): Mode {
  return effective.endsWith('-light') ? 'light' : 'dark';
}

export function variantOf(effective: EffectiveTheme): ThemeVariant {
  const mode = modeOf(effective);
  return themeOf(effective.slice(0, -mode.length - 1))[mode];
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
  const rules = [`:root{${declarations('dark', THEMES[0].dark.colors)}}`];
  for (const t of THEMES)
    for (const m of MODES) rules.push(`:root[data-theme='${t.id}-${m}']{${declarations(m, t[m].colors)}}`);
  return rules.join('\n');
}

/** Puts the tokens on the page. Called once, before the first render (main.tsx). */
export function installThemes() {
  const style = document.createElement('style');
  style.dataset.themes = '';
  style.textContent = themeCss();
  document.head.appendChild(style);
}
