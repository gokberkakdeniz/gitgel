// Same values as tokens.css, for code that cannot read CSS variables (the Monaco theme).
export const colors = {
  bgSidebar: '#0e0d0c',
  bgMain: '#141311',
  bgSunken: '#1a1917',
  bgBand: '#1c1b18',
  bgElevated: '#211f1c',
  bgHover: '#2a2825',
  bgSidebarActive: '#24221f',
  bgPressed: '#383631',

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

export const kindColors = {
  A: { text: '#8fcf9c', bg: 'rgba(93,184,114,0.15)' },
  M: { text: '#e8c071', bg: 'rgba(212,160,23,0.15)' },
  R: { text: '#93b8ee', bg: 'rgba(90,140,220,0.16)' },
  D: { text: '#ee9a90', bg: 'rgba(198,69,69,0.18)' },
  U: { text: '#c5b2f2', bg: 'rgba(160,130,230,0.16)' },
} as const;

export const fonts = {
  ui: "'Instrument Sans', -apple-system, sans-serif",
  serif: "'Source Serif 4', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;
