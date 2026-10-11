/**
 * Why `name` (already trimmed) cannot join the default base list, or null. Checks git's
 * ref-name rules (`git check-ref-format`) and duplicates.
 */
import { t } from '../../i18n';

export function baseNameError(name: string, list: string[]): string | null {
  if (list.includes(name)) return t('settings.baseDup', { name });
  const invalid =
    name === '' ||
    name === '@' ||
    /[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) ||
    name.includes('..') ||
    name.includes('@{') ||
    name.includes('//') ||
    name.startsWith('-') ||
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'));
  return invalid ? t('settings.baseInvalid') : null;
}

/** A whole number of days, 1–365, or null. */
export function parseDays(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 365 ? n : null;
}
