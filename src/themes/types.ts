// What a theme file (`<id>.json`) holds, as `theme.schema.json` describes it (docs/SPEC.md §4
// "Themes"); index.test.ts checks every file against the schema.

/** The app's colour tokens; `bgSidebar` is `--bg-sidebar` in CSS. Any CSS colour value. */
export interface ThemeColors {
  bgSidebar: string;
  bgMain: string;
  bgSunken: string;
  bgBand: string;
  bgElevated: string;
  bgTrack: string;
  bgHover: string;
  bgSidebarActive: string;
  bgPressed: string;
  bgAvatar: string;

  border: string;
  borderRow: string;
  borderStrong: string;
  chipOpenBorder: string;

  textStrong: string;
  textCode: string;
  textBody: string;
  textMuted: string;
  textFaint: string;
  textDisabled: string;
  iconDisabled: string;

  /** `#rrggbb`: tints are mixed from it (`--accent-rgb`, the focus ring). */
  accent: string;
  accentText: string;
  accentHover: string;
  onAccent: string;
  selectedBg: string;

  successText: string;
  successBg: string;
  /** `#rrggbb`: the amber that tints are mixed from (`--warning-rgb`). */
  warningTint: string;
  warningText: string;
  warningBg: string;
  /** `#rrggbb`: the red that tints are mixed from (`--danger-rgb`). */
  dangerTint: string;
  dangerText: string;
  dangerBg: string;
  dangerFill: string;

  diffAddBg: string;
  diffDelBg: string;
  diffAddMark: string;
  diffDelMark: string;
  diffFoldBg: string;

  kindAText: string;
  kindABg: string;
  kindMText: string;
  kindMBg: string;
  kindRText: string;
  kindRBg: string;
  kindDText: string;
  kindDBg: string;
  kindUText: string;
  kindUBg: string;

  shadowPop: string;
  shadowModal: string;
  scrim: string;
}

/** Monaco's own colours, `#rrggbb` or `#rrggbbaa`; the rest of the editor uses `ThemeColors`. */
export interface EditorColors {
  keyword: string;
  string: string;
  number: string;
  type: string;
  comment: string;
  /** Line and changed-text grounds of the diff; translucent, so the selection shows through. */
  insertedLine: string;
  removedLine: string;
  insertedText: string;
  removedText: string;
}

export interface ThemeVariant {
  colors: ThemeColors;
  editor: EditorColors;
}

export interface Theme {
  /** Saved in the config and used in `data-theme` (`<id>-light`, `<id>-dark`); lowercase. */
  id: string;
  /** Shown as is in every language. */
  name: string;
  light: ThemeVariant;
  dark: ThemeVariant;
}
