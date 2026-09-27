import { describe, expect, it } from 'vitest';
import { language } from 'monaco-editor/languages/definitions/ruby/ruby';
import { guardTopLevelEnd } from './ruby';

// Every `end` case in the root state, as the grammar has it.
function endCases(lang: typeof language): unknown[] {
  const found: unknown[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object' || node instanceof RegExp) return;
    const cases = (node as { cases?: Record<string, unknown> }).cases;
    if (cases?.end) found.push(cases.end);
    Object.values(node).forEach(visit);
  };
  visit(lang.tokenizer.root);
  return found;
}

describe('guardTopLevelEnd', () => {
  it('pops on `end` only when a block is open', () => {
    const before = endCases(language);
    expect(before.length).toBeGreaterThan(0);
    for (const end of endCases(guardTopLevelEnd(language))) {
      expect(end).toMatchObject({ cases: { '$S2==': 'keyword', '@default': { next: '@pop' } } });
    }
  });

  it('leaves the original grammar alone', () => {
    const before = JSON.stringify(endCases(language));
    guardTopLevelEnd(language);
    expect(JSON.stringify(endCases(language))).toBe(before);
  });
});
