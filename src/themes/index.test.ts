import { describe, expect, it } from 'vitest';
import { MODES, THEMES, effectiveId, isEffective, modeOf, themeCss, themeOf, variantOf } from './index';
import schema from './theme.schema.json';

type Rule = { required: string[]; properties: Record<string, { type: string; pattern?: string }> };

/** The part of JSON Schema `theme.schema.json` uses: exact keys, strings, patterns. */
function check(value: Record<string, unknown>, rule: Rule, where: string) {
  expect(Object.keys(value).sort(), where).toEqual([...rule.required].sort());
  for (const [key, v] of Object.entries(value)) {
    expect(typeof v, `${where}.${key}`).toBe('string');
    const { pattern } = rule.properties[key];
    if (pattern) expect(v, `${where}.${key}`).toMatch(new RegExp(pattern));
  }
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
    for (const t of THEMES)
      for (const m of MODES) {
        expect(Object.keys(t[m]).sort()).toEqual(['colors', 'editor']);
        check({ ...t[m].colors }, schema.definitions.colors, `${t.id}.${m}.colors`);
        check({ ...t[m].editor }, schema.definitions.editor, `${t.id}.${m}.editor`);
      }
  });

  it('start with Gitgel', () => {
    expect(THEMES[0].id).toBe('gitgel');
  });
});

describe('themeCss', () => {
  const css = themeCss();

  it('has a rule per theme and mode, and the default on :root', () => {
    for (const t of THEMES) for (const m of MODES) expect(css).toContain(`:root[data-theme='${t.id}-${m}']{`);
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
