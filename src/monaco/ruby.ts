// Monaco's Ruby grammar counts blocks from the keywords that open them, so an `end` whose opener
// it missed (`private def …`, `x = if …`) pops its state stack past the bottom and throws
// "ruby: trying to pop an empty stack". Here an `end` at the top level stays a plain keyword.
import type * as Monaco from 'monaco-editor';

type Language = Monaco.languages.IMonarchLanguage;

/** A copy of the grammar whose top-level `end` rules pop only when a block is open. */
export function guardTopLevelEnd(language: Language): Language {
  const copy = structuredClone(language);
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object' || node instanceof RegExp) return;
    const cases = (node as { cases?: Record<string, unknown> }).cases;
    const end = cases?.end as { next?: string } | undefined;
    if (cases && end?.next === '@pop') {
      // The block keyword is the state's second part (`root.def`); at the bottom it is empty.
      cases.end = { cases: { '$S2==': 'keyword', '@default': end } };
    }
    Object.values(node).forEach(visit);
  };
  visit(copy.tokenizer.root);
  return copy;
}
