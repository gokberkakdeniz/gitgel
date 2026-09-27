// The `gitgel` Monaco theme, built from the design tokens (docs/SPEC.md §4).
import type * as Monaco from 'monaco-editor';
import { colors } from '../styles/tokens';

const hex = (c: string) => c.replace('#', '');

export function defineTheme(monaco: typeof Monaco) {
  monaco.editor.defineTheme('gitgel', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: hex(colors.textCode) },
      { token: 'keyword', foreground: hex(colors.accentText) },
      { token: 'string', foreground: hex(colors.warningText) },
      { token: 'number', foreground: 'c5b2f2' },
      { token: 'type', foreground: '93b8ee' },
      { token: 'comment', foreground: hex(colors.textFaint), fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': colors.bgMain,
      'editor.foreground': colors.textCode,
      'editorLineNumber.foreground': colors.textFaint,
      'editorLineNumber.activeForeground': colors.textMuted,
      'editorGutter.background': colors.bgMain,
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#00000000',
      'diffEditor.insertedLineBackground': '#5db87226',
      'diffEditor.removedLineBackground': '#c645452b',
      'diffEditor.insertedTextBackground': '#5db87240',
      'diffEditor.removedTextBackground': '#c6454548',
      'diffEditorGutter.insertedLineBackground': '#5db87226',
      'diffEditorGutter.removedLineBackground': '#c645452b',
      'diffEditor.diagonalFill': colors.bgBand,
      'diffEditor.unchangedRegionBackground': colors.bgSunken,
      'diffEditor.unchangedRegionForeground': colors.textFaint,
      'diffEditor.unchangedCodeBackground': '#00000000',
      'diffEditor.border': colors.border,
      'scrollbarSlider.background': `${colors.bgPressed}99`,
      'scrollbarSlider.hoverBackground': colors.bgPressed,
      'scrollbarSlider.activeBackground': colors.bgPressed,
      'scrollbar.shadow': '#00000000',
      'editorOverviewRuler.border': '#00000000',
    },
  });
}
