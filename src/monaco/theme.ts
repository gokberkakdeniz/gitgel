// The Monaco themes, one per theme and mode, named as `data-theme` (`gitgel-dark`, …) and built
// from src/themes (docs/SPEC.md §4). DiffView picks one through its `theme` prop.
import type * as Monaco from 'monaco-editor';
import { MODES, THEMES, type Mode, type ThemeVariant } from '../themes';

const hex = (c: string) => c.replace('#', '');

function definition(mode: Mode, { colors: c, editor: e }: ThemeVariant): Monaco.editor.IStandaloneThemeData {
  return {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: hex(c.textCode) },
      { token: 'keyword', foreground: hex(e.keyword) },
      { token: 'string', foreground: hex(e.string) },
      { token: 'number', foreground: hex(e.number) },
      { token: 'type', foreground: hex(e.type) },
      { token: 'comment', foreground: hex(e.comment), fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': c.bgMain,
      'editor.foreground': c.textCode,
      'editorLineNumber.foreground': c.textFaint,
      'editorLineNumber.activeForeground': c.textMuted,
      'editorGutter.background': c.bgMain,
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#00000000',
      'diffEditor.insertedLineBackground': e.insertedLine,
      'diffEditor.removedLineBackground': e.removedLine,
      'diffEditor.insertedTextBackground': e.insertedText,
      'diffEditor.removedTextBackground': e.removedText,
      'diffEditorGutter.insertedLineBackground': e.insertedLine,
      'diffEditorGutter.removedLineBackground': e.removedLine,
      'diffEditor.diagonalFill': c.bgBand,
      'diffEditor.unchangedRegionBackground': c.bgSunken,
      'diffEditor.unchangedRegionForeground': c.textFaint,
      'diffEditor.unchangedCodeBackground': '#00000000',
      'diffEditor.border': c.border,
      'scrollbarSlider.background': `${c.bgPressed}99`,
      'scrollbarSlider.hoverBackground': c.bgPressed,
      'scrollbarSlider.activeBackground': c.bgPressed,
      'scrollbar.shadow': '#00000000',
      'editorOverviewRuler.border': '#00000000',
    },
  };
}

export function defineTheme(monaco: Pick<typeof Monaco, 'editor'>) {
  for (const t of THEMES)
    for (const m of MODES) monaco.editor.defineTheme(`${t.id}-${m}`, definition(m, t[m]));
}
