import { describe, expect, it } from 'vitest';
import {
  THEMES,
  effectiveId,
  isEffective,
  modeOf,
  modesOf,
  setCustomThemes,
  themeCss,
  themeOf,
  variantOf,
} from './index';
import { validate } from './validate';
import schema from './theme.schema.json';

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('themes', () => {
  it('have distinct lowercase ids', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(new RegExp(schema.properties.id.pattern));
  });

  it('resolve by id, an unknown one as the default', () => {
    expect(themeOf('github').name).toBe('GitHub');
    expect(themeOf('gone')).toBe(THEMES[0]);
    expect(effectiveId('gone', 'light')).toBe('gitgel-light');
  });

  it('split an effective id back into theme and mode', () => {
    expect(modeOf('github-light')).toBe('light');
    expect(variantOf('github-dark')).toBe(themeOf('github').dark);
    expect(isEffective('github-dark')).toBe(true);
    expect(isEffective('dark')).toBe(false);
    expect(isEffective(undefined)).toBe(false);
  });

  it('follow theme.schema.json', () => {
    for (const t of THEMES) expect(validate(t), t.id).toBeNull();
  });

  it('keep text readable on its ground (WCAG AA)', () => {
    for (const t of THEMES)
      for (const m of modesOf(t)) {
        const c = t[m]!.colors;
        const pairs: [string, string, string][] = [
          ['textMuted', c.textMuted, c.bgMain],
          ['textMuted on sidebar', c.textMuted, c.bgSidebar],
          ['accentText', c.accentText, c.bgMain],
          ['onAccent', c.onAccent, c.accent],
          ['white on dangerFill', '#ffffff', c.dangerFill],
          ['textCode', c.textCode, c.bgMain],
        ];
        for (const [what, fg, bg] of pairs)
          expect(contrast(fg, bg), `${t.id}.${m} ${what}`).toBeGreaterThanOrEqual(4.5);
        for (const key of ['successText', 'warningText', 'dangerText'] as const)
          expect(contrast(c[key], c.bgMain), `${t.id}.${m} ${key}`).toBeGreaterThanOrEqual(4.5);
        // Syntax colours sit on the editor ground. A palette's own colours are kept (Monokai's
        // pink), so the floor is 3.5; comments may be quieter.
        const { keyword, string, number, type, comment } = t[m]!.editor;
        for (const fg of [keyword, string, number, type])
          expect(contrast(fg, c.bgMain), `${t.id}.${m} ${fg}`).toBeGreaterThanOrEqual(3.5);
        expect(contrast(comment, c.bgMain), `${t.id}.${m} comment`).toBeGreaterThanOrEqual(2.5);
      }
  });

  it('start with Gitgel', () => {
    expect(THEMES[0].id).toBe('gitgel');
  });
});

describe('themeCss', () => {
  const css = themeCss();

  it('has a rule per theme and mode, and the default on :root', () => {
    for (const t of THEMES) for (const m of modesOf(t)) expect(css).toContain(`:root[data-theme='${t.id}-${m}']{`);
    expect(css.startsWith(':root{color-scheme: dark;--bg-sidebar: #0e0d0c;')).toBe(true);
  });

  it('names tokens in kebab case and derives the mixed ones', () => {
    const rule = css.split('\n').find((r) => r.startsWith(":root[data-theme='gitgel-light']"))!;
    expect(rule).toContain('color-scheme: light;');
    expect(rule).toContain('--bg-sidebar-active: #e4e0d8;');
    expect(rule).toContain('--kind-a-text: #2e7a45;');
    expect(rule).toContain('--accent-rgb: 58, 123, 143;');
    expect(rule).toContain('--diff-filler: repeating-linear-gradient(135deg, #eeebe5 0 4px, #fbfaf7 4px 8px);');
    expect(rule).toContain('--focus-ring: 0 0 0 1px #3a7b8f, 0 0 0 3px rgba(58, 123, 143, 0.25)');
  });
});

describe('validate', () => {
  const gitgel = themeOf('gitgel');

  it('takes a theme with one mode, not one with none', () => {
    expect(validate({ id: 'night', name: 'Night', dark: gitgel.dark })).toBeNull();
    expect(validate({ id: 'night', name: 'Night' })).toBe('theme has neither light nor dark');
  });

  it('names the key that is wrong', () => {
    const dark = gitgel.dark!;
    expect(validate({ id: 'Night', name: 'Night', dark })).toContain('theme.id');
    expect(
      validate({ id: 'night', name: 'Night', dark: { ...dark, colors: { ...dark.colors, accent: 'teal' } } }),
    ).toContain('dark.colors.accent');
    const { scrim: _, ...rest } = dark.colors;
    expect(validate({ id: 'night', name: 'Night', dark: { ...dark, colors: rest } })).toBe(
      'dark.colors.scrim is missing',
    );
    expect(
      validate({ id: 'night', name: 'Night', dark: { ...dark, colors: { ...dark.colors, extra: '#000000' } } }),
    ).toBe('dark.colors.extra is not a known key');
    // A value goes into a style sheet as is.
    expect(
      validate({
        id: 'night',
        name: 'Night',
        dark: { ...dark, colors: { ...dark.colors, scrim: 'red} body{display:none' } },
      }),
    ).toContain('dark.colors.scrim');
  });
});

describe('custom themes', () => {
  const file = (name: string, theme: unknown) => ({ name, content: JSON.stringify(theme) });
  const night = { $schema: './theme.schema.json', id: 'night', name: 'Night', dark: themeOf('gitgel').dark };

  it('join the built-in ones, with the modes they have', () => {
    expect(setCustomThemes([file('night.json', night)])).toEqual([]);
    expect(THEMES[THEMES.length - 1].id).toBe('night');
    expect(modesOf(themeOf('night'))).toEqual(['dark']);
    expect(effectiveId('night', 'light')).toBe('night-dark');
    expect(isEffective('night-light')).toBe(false);
    expect(themeCss()).toContain(":root[data-theme='night-dark']{");
  });

  it('leave out a broken file or a taken id, and say why', () => {
    const problems = setCustomThemes([
      { name: 'bad.json', content: '{' },
      file('copy.json', { ...night, id: 'github' }),
      file('night.json', night),
    ]);
    expect(problems).toEqual(['bad.json: not JSON', 'copy.json: the id "github" is taken']);
    expect(THEMES.filter((t) => t.id === 'github')).toHaveLength(1);
    expect(setCustomThemes([])).toEqual([]);
    expect(themeOf('night').id).toBe('gitgel');
  });
});
