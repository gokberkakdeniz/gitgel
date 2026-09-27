// The `gitgel-dark` / `gitgel-light` Monaco themes, built from the design tokens
// (docs/SPEC.md §4). DiffView picks one through its `theme` prop.
import type * as Monaco from 'monaco-editor';
import { darkColors, lightColors, type EffectiveTheme } from '../styles/tokens';

const hex = (c: string) => c.replace('#', '');

interface Palette {
  base: 'vs-dark' | 'vs';
  textCode: string;
  accentText: string;
  warningText: string;
  textFaint: string;
  textMuted: string;
  bgMain: string;
  bgBand: string;
  bgSunken: string;
  border: string;
  bgPressed: string;
  insertedLine: string;
  removedLine: string;
  insertedText: string;
  removedText: string;
  number: string;
  type: string;
}

function paletteOf(theme: EffectiveTheme): Palette {
  const c = theme === 'dark' ? darkColors : lightColors;
  return theme === 'dark'
    ? {
        base: 'vs-dark',
        textCode: c.textCode,
        accentText: c.accentText,
        warningText: c.warningText,
        textFaint: c.textFaint,
        textMuted: c.textMuted,
        bgMain: c.bgMain,
        bgBand: c.bgBand,
        bgSunken: c.bgSunken,
        border: c.border,
        bgPressed: c.bgPressed,
        insertedLine: '#5db87226',
        removedLine: '#c645452b',
        insertedText: '#5db87240',
        removedText: '#c6454548',
        number: 'c5b2f2',
        type: '93b8ee',
      }
    : {
        base: 'vs',
        textCode: c.textCode,
        accentText: c.accentText,
        warningText: c.warningText,
        textFaint: c.textFaint,
        textMuted: c.textMuted,
        bgMain: c.bgMain,
        bgBand: c.bgBand,
        bgSunken: c.bgSunken,
        border: c.border,
        bgPressed: c.bgPressed,
        insertedLine: '#2e8c4e26',
        removedLine: '#c8483c2b',
        insertedText: '#2e8c4e40',
        removedText: '#c8483c40',
        number: '6a4fb5',
        type: '2f63a8',
      };
}

export const MONACO_THEMES = { dark: 'gitgel-dark', light: 'gitgel-light' } as const;

function definition(p: Palette): Monaco.editor.IStandaloneThemeData {
  return {
    base: p.base,
    inherit: true,
    rules: [
      { token: '', foreground: hex(p.textCode) },
      { token: 'keyword', foreground: hex(p.accentText) },
      { token: 'string', foreground: hex(p.warningText) },
      { token: 'number', foreground: p.number },
      { token: 'type', foreground: p.type },
      { token: 'comment', foreground: hex(p.textFaint), fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': p.bgMain,
      'editor.foreground': p.textCode,
      'editorLineNumber.foreground': p.textFaint,
      'editorLineNumber.activeForeground': p.textMuted,
      'editorGutter.background': p.bgMain,
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#00000000',
      'diffEditor.insertedLineBackground': p.insertedLine,
      'diffEditor.removedLineBackground': p.removedLine,
      'diffEditor.insertedTextBackground': p.insertedText,
      'diffEditor.removedTextBackground': p.removedText,
      'diffEditorGutter.insertedLineBackground': p.insertedLine,
      'diffEditorGutter.removedLineBackground': p.removedLine,
      'diffEditor.diagonalFill': p.bgBand,
      'diffEditor.unchangedRegionBackground': p.bgSunken,
      'diffEditor.unchangedRegionForeground': p.textFaint,
      'diffEditor.unchangedCodeBackground': '#00000000',
      'diffEditor.border': p.border,
      'scrollbarSlider.background': `${p.bgPressed}99`,
      'scrollbarSlider.hoverBackground': p.bgPressed,
      'scrollbarSlider.activeBackground': p.bgPressed,
      'scrollbar.shadow': '#00000000',
      'editorOverviewRuler.border': '#00000000',
    },
  };
}

export function defineTheme(monaco: typeof Monaco) {
  monaco.editor.defineTheme(MONACO_THEMES.dark, definition(paletteOf('dark')));
  monaco.editor.defineTheme(MONACO_THEMES.light, definition(paletteOf('light')));
}
