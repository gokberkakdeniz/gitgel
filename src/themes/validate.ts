// Checks a theme file against `theme.schema.json`: the part of JSON Schema it uses (exact keys,
// strings, patterns). Custom themes are read from disk, so they are checked before use.
import schema from './theme.schema.json';

interface Rule {
  required: string[];
  properties: Record<string, { type?: string; pattern?: string; minLength?: number }>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every key known, every required one there, every value a string in its pattern. */
function strings(value: unknown, rule: Rule, where: string): string | null {
  if (!isObject(value)) return `${where} is not an object`;
  for (const key of rule.required) if (!(key in value)) return `${where}.${key} is missing`;
  for (const [key, v] of Object.entries(value)) {
    const p = rule.properties[key];
    if (!p) return `${where}.${key} is not a known key`;
    if (typeof v !== 'string' || v.length < (p.minLength ?? 0)) return `${where}.${key} is not a string`;
    if (p.pattern && !new RegExp(p.pattern).test(v)) return `${where}.${key} "${v}" does not match ${p.pattern}`;
  }
  return null;
}

/** What is wrong with a theme file's value, or `null` when it follows the schema. */
export function validate(value: unknown): string | null {
  if (!isObject(value)) return 'not an object';
  const top = strings(
    { id: value.id, name: value.name },
    { required: ['id', 'name'], properties: { id: schema.properties.id, name: schema.properties.name } },
    'theme',
  );
  if (top) return top;
  for (const key of Object.keys(value)) if (!(key in schema.properties)) return `theme.${key} is not a known key`;
  if (!('light' in value) && !('dark' in value)) return 'theme has neither light nor dark';
  for (const mode of ['light', 'dark'] as const) {
    if (!(mode in value)) continue;
    const variant = value[mode];
    if (!isObject(variant)) return `${mode} is not an object`;
    for (const key of Object.keys(variant))
      if (key !== 'colors' && key !== 'editor') return `${mode}.${key} is not a known key`;
    const problem =
      strings(variant.colors, schema.definitions.colors, `${mode}.colors`) ??
      strings(variant.editor, schema.definitions.editor, `${mode}.editor`);
    if (problem) return problem;
  }
  return null;
}
