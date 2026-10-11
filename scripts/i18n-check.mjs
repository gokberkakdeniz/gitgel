// `pnpm i18n:check`: missing keys, placeholder / MF2 breakage → fail.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageFormat } from 'messageformat';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n');

function load(name) {
  try {
    return JSON.parse(readFileSync(join(dir, name), 'utf8'));
  } catch (e) {
    console.error(`i18n: cannot read ${name}: ${(e).message}`);
    process.exit(1);
  }
}

/** `$`-variable references in an MF2 source (`{$count}`, `{$user.name}`). */
function placeholders(source) {
  const found = new Set();
  for (const m of String(source).matchAll(/\{\$([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g)) found.add(m[1]);
  return found;
}

/**
 * The placeholders a message displays: the `.input` declarations and the `.match`
 * selectors (`$n`, `$m`) picked, the rest (`$d`, `$e`) shown. A translation keeps
 * the displayed set; it may drop selector-only vars (a Turkish plain sentence has
 * no `.match`).
 */
function displayed(source) {
  const body = String(source)
    .replace(/\.input \{\$[^{}]*\}/g, '')
    .replace(/\.match\s+(?:\$\w+\s+)+/, '.match ');
  return placeholders(body);
}

const en = load('en.json');
const tr = load('tr.json');
const errors = [];

for (const [key, value] of Object.entries(en)) {
  if (typeof value !== 'string' || value === '') errors.push(`${key}: empty en string`);
  else if (/^\s|\s$/.test(value)) errors.push(`${key}: en message starts or ends with whitespace`);
}
for (const key of Object.keys(en)) {
  if (!(key in tr)) errors.push(`${key}: missing in tr.json`);
}
for (const key of Object.keys(tr)) {
  if (!(key in en)) console.warn(`i18n: ${key} is in tr.json but not in en.json`);
}
for (const key of Object.keys(en)) {
  if (!(key in tr)) continue;
  for (const [locale, source] of [['en', en[key]], ['tr', tr[key]]]) {
    try {
      new MessageFormat(locale, source);
    } catch (e) {
      errors.push(`${key}: broken MF2 in ${locale} (${(e).message})`);
    }
  }
  if (typeof en[key] === 'string' && typeof tr[key] === 'string') {
    const want = displayed(en[key]);
    const have = placeholders(tr[key]);
    const missing = [...want].filter((p) => !have.has(p));
    const extra = [...have].filter((p) => !placeholders(en[key]).has(p));
    if (missing.length > 0 || extra.length > 0) {
      errors.push(`${key}: placeholder mismatch (missing ${missing.join(', ') || '—'}, extra ${extra.join(', ') || '—'})`);
    }
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`i18n: ${e}`);
  console.error(`i18n: ${errors.length} problem(s) in ${Object.keys(en).length} keys`);
  process.exit(1);
}
console.log(`i18n: ${Object.keys(en).length} keys, OK`);
