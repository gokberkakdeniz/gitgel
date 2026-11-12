// Same values as tokens.css, for code that cannot read CSS variables (the Monaco theme).
// `colors` / `kindColors` are the dark palette (backwards compatibility).
export const darkColors = {
  bgSidebar: '#0e0d0c',
  bgMain: '#141311',
  bgSunken: '#1a1917',
  bgBand: '#1c1b18',
  bgElevated: '#211f1c',
  bgHover: '#2a2825',
  bgSidebarActive: '#24221f',
  bgPressed: '#383631',
  bgAvatar: '#383631',

  border: '#302e2a',
  borderRow: '#262420',
  borderStrong: '#383631',

  textStrong: '#faf9f5',
  textCode: '#e0ddd6',
  textBody: '#d8d4cc',
  textMuted: '#a09d96',
  textFaint: '#75726b',

  accent: '#4f8fa3',
  accentText: '#7fb3c4',
  accentHover: '#a3cad6',
  onAccent: '#141311',
  selectedBg: 'rgba(79,143,163,0.10)',

  successText: '#8fcf9c',
  successBg: 'rgba(93,184,114,0.14)',
  warningText: '#e8c071',
  warningBg: 'rgba(212,160,23,0.14)',
  dangerText: '#ee9a90',
  dangerBg: 'rgba(198,69,69,0.16)',
  dangerFill: '#c64545',

  diffAddBg: 'rgba(93,184,114,0.15)',
  diffDelBg: 'rgba(198,69,69,0.17)',
  diffAddMark: '#8fcf9c',
  diffDelMark: '#ee9a90',
  diffFoldBg: '#1a1917',
} as const;

export const lightColors = {
  bgSidebar: '#f1efea',
  bgMain: '#fbfaf7',
  bgSunken: '#f4f2ee',
  bgBand: '#eeebe5',
  bgElevated: '#ffffff',
  bgHover: '#ebe8e1',
  bgSidebarActive: '#e4e0d8',
  bgPressed: '#ffffff',
  bgAvatar: '#d5d0c7',

  border: '#e2ded6',
  borderRow: '#ebe8e2',
  borderStrong: '#d5d0c7',

  textStrong: '#1d1c19',
  textCode: '#2b2925',
  textBody: '#3b3934',
  textMuted: '#6e6a62',
  textFaint: '#99958c',

  accent: '#3a7b8f',
  accentText: '#2c6a7d',
  accentHover: '#1f5566',
  onAccent: '#ffffff',
  selectedBg: 'rgba(58,123,143,0.10)',

  successText: '#2e7a45',
  successBg: 'rgba(46,140,78,0.14)',
  warningText: '#8a6212',
  warningBg: 'rgba(196,146,20,0.14)',
  dangerText: '#b3463b',
  dangerBg: 'rgba(200,72,60,0.16)',
  dangerFill: '#c64545',

  diffAddBg: 'rgba(46,140,78,0.15)',
  diffDelBg: 'rgba(200,72,60,0.17)',
  diffAddMark: '#2e7a45',
  diffDelMark: '#b3463b',
  diffFoldBg: '#f4f2ee',
} as const;

export const githubLightColors = {
  bgSidebar: '#f6f8fa',
  bgMain: '#ffffff',
  bgSunken: '#f6f8fa',
  bgBand: '#f0f3f6',
  bgElevated: '#ffffff',
  bgHover: '#eaeef2',
  bgSidebarActive: '#ddf4ff',
  bgPressed: '#d8dee4',
  bgAvatar: '#d0d7de',
  border: '#d0d7de',
  borderRow: '#eaeef2',
  borderStrong: '#8c959f',
  textStrong: '#1f2328',
  textCode: '#1f2328',
  textBody: '#1f2328',
  textMuted: '#656d76',
  textFaint: '#6e7781',
  accent: '#0969da',
  accentText: '#0969da',
  accentHover: '#0550ae',
  onAccent: '#ffffff',
  selectedBg: '#ddf4ff',
  successText: '#1a7f37',
  successBg: '#dafbe1',
  warningText: '#9a6700',
  warningBg: '#fff8c5',
  dangerText: '#cf222e',
  dangerBg: '#ffebe9',
  dangerFill: '#cf222e',
  diffAddBg: '#dafbe1',
  diffDelBg: '#ffebe9',
  diffAddMark: '#1a7f37',
  diffDelMark: '#cf222e',
  diffFoldBg: '#f6f8fa',
} as const;

export const githubDarkColors = {
  bgSidebar: '#010409',
  bgMain: '#0d1117',
  bgSunken: '#010409',
  bgBand: '#161b22',
  bgElevated: '#161b22',
  bgHover: '#21262d',
  bgSidebarActive: '#1f2937',
  bgPressed: '#30363d',
  bgAvatar: '#30363d',
  border: '#30363d',
  borderRow: '#21262d',
  borderStrong: '#6e7681',
  textStrong: '#e6edf3',
  textCode: '#e6edf3',
  textBody: '#e6edf3',
  textMuted: '#8b949e',
  textFaint: '#7d8590',
  accent: '#1f6feb',
  accentText: '#58a6ff',
  accentHover: '#79c0ff',
  onAccent: '#ffffff',
  selectedBg: 'rgba(56,139,253,0.15)',
  successText: '#3fb950',
  successBg: 'rgba(46,160,67,0.15)',
  warningText: '#d29922',
  warningBg: 'rgba(187,128,9,0.15)',
  dangerText: '#f85149',
  dangerBg: 'rgba(248,81,73,0.15)',
  dangerFill: '#da3633',
  diffAddBg: 'rgba(46,160,67,0.15)',
  diffDelBg: 'rgba(248,81,73,0.15)',
  diffAddMark: '#3fb950',
  diffDelMark: '#f85149',
  diffFoldBg: '#010409',
} as const;

export const palettes = {
  dark: darkColors,
  light: lightColors,
  'github-light': githubLightColors,
  'github-dark': githubDarkColors,
} as const;

export type EffectiveTheme = keyof typeof palettes;

export const colors = darkColors;

export const darkKindColors = {
  A: { text: '#8fcf9c', bg: 'rgba(93,184,114,0.15)' },
  M: { text: '#e8c071', bg: 'rgba(212,160,23,0.15)' },
  R: { text: '#93b8ee', bg: 'rgba(90,140,220,0.16)' },
  D: { text: '#ee9a90', bg: 'rgba(198,69,69,0.18)' },
  U: { text: '#c5b2f2', bg: 'rgba(160,130,230,0.16)' },
} as const;

export const lightKindColors = {
  A: { text: '#2e7a45', bg: 'rgba(46,140,78,0.15)' },
  M: { text: '#8a6212', bg: 'rgba(196,146,20,0.15)' },
  R: { text: '#2f63a8', bg: 'rgba(60,110,200,0.16)' },
  D: { text: '#b3463b', bg: 'rgba(200,72,60,0.18)' },
  U: { text: '#6a4fb5', bg: 'rgba(140,100,220,0.16)' },
} as const;

export const kindPalettes = { dark: darkKindColors, light: lightKindColors } as const;

export const kindColors = darkKindColors;

export const fonts = {
  ui: "'Instrument Sans', -apple-system, sans-serif",
  serif: "'Source Serif 4', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;
