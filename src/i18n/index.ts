// MF2 i18n: the `t()` wrapper around Unicode MessageFormat 2 (`messageformat`
// 4.0.0), locale resolution at launch, and the en fallback. Source strings live
// in `en.json` (namespaced keys: `branches.*`, `review.*`, …); `tr.json` holds
// the Turkish translations. The language picker (Settings › General) reloads
// the page, so the locale is module state set once at boot, never reactive.
import { MessageFormat } from 'messageformat';
import en from './en.json';
import tr from './tr.json';

export type AppLocale = 'en' | 'tr';

const dicts: Record<AppLocale, Record<string, string>> = { en, tr };

function browserLanguage(): string {
  return typeof navigator === 'undefined' ? 'en' : (navigator.language ?? 'en');
}

/** Locale resolution at launch: an explicit pick wins, `system` follows the browser. */
export function resolveLocale(setting: string, language: string = browserLanguage()): AppLocale {
  if (setting === 'en' || setting === 'tr') return setting;
  return language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

let locale: AppLocale = resolveLocale('system');
const compiled = new Map<string, MessageFormat>();
const warned = new Set<string>();

export function setLocale(next: AppLocale): void {
  if (next !== locale) {
    locale = next;
    compiled.clear();
  }
}

export function getLocale(): AppLocale {
  return locale;
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** One message formatted; `strict` throws on any formatting error (a missing variable). */
function format(loc: AppLocale, key: string, source: string, vars: Record<string, unknown> | undefined, strict: boolean): string {
  const cacheKey = `${loc}${key}`;
  let mf = compiled.get(cacheKey);
  if (!mf) {
    mf = new MessageFormat(loc, source, { bidiIsolation: 'none' });
    compiled.set(cacheKey, mf);
  }
  let failed = false;
  const out = mf.format(vars, () => {
    failed = true;
  });
  if (failed && strict) throw new Error('format failed');
  // messageformat 4.0.0 cannot parse a select variant whose pattern starts
  // with an expression (`{{{`): such variants carry one leading space (see
  // TRANSLATE.md), stripped here. No message starts with a real space
  // (`pnpm i18n:check` rejects those), so exactly one is always safe.
  return out.startsWith(' ') ? out.slice(1) : out;
}

/** Translate `key`, formatting its MF2 placeholders with `vars`. */
export function t(key: string, vars?: Record<string, unknown>): string {
  const own = dicts[locale][key];
  const source = own ?? dicts.en[key];
  if (source === undefined) {
    warnOnce(key, `i18n: missing key "${key}"`);
    return key;
  }
  if (own === undefined) {
    warnOnce(key, `i18n: missing key "${key}" for locale "${locale}", falling back to en`);
  }
  try {
    return format(own === undefined ? 'en' : locale, key, source, vars, true);
  } catch {
    // Broken MF2 or a missing variable: the en message, as well as it formats.
    warnOnce(key, `i18n: broken message "${key}" for locale "${locale}", showing en`);
    try {
      return format('en', key, dicts.en[key] ?? source, vars, false);
    } catch {
      return dicts.en[key] ?? source;
    }
  }
}
