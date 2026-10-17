import { getLocale, t, type AppLocale } from '../i18n';
import type { NumberFormat, Settings } from './types';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

/** Compact age of a unix timestamp: `6m`, `3h`, `2d`, `1y`. Language-neutral. */
export function formatAge(unix: number, now: number = Date.now() / 1000): string {
  const age = Math.max(0, now - unix);
  if (age < HOUR) return `${Math.max(1, Math.floor(age / MINUTE))}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < YEAR) return `${Math.floor(age / DAY)}d`;
  return `${Math.floor(age / YEAR)}y`;
}

// ---- Appearance › Formatting (SPEC §5) ----

/** Appearance › Formatting + locale, as the renderers need it. */
export interface Fmt {
  date: string;
  time: string;
  number: NumberFormat;
  absolute: boolean;
  locale: AppLocale;
}

export const DATE_FORMATS = [
  'MMM d, yyyy',
  'MMMM do, yyyy',
  'MM/dd/yyyy',
  'dd/MM/yyyy',
  'dd-MM-yyyy',
  'dd.MM.yyyy',
  'yyyy/MM/dd',
  'yyyy-MM-dd',
  'yyyy.MM.dd',
  'MM/dd/yy',
  'dd/MM/yy',
  'dd-MM-yy',
  'dd.MM.yy',
  'yy/MM/dd',
  'yy-MM-dd',
  'yy.MM.dd',
] as const;

export const TIME_FORMATS = [
  'HH:mm:ss',
  'HH.mm.ss',
  'HH:mm',
  'HH.mm',
  'h:mm:ss aaa',
  'h.mm.ss aaa',
  'h:mm aaa',
  'h.mm aaa',
] as const;

export const NUMBER_FORMATS = [
  'plain-dot',
  'plain-comma',
  'group-comma-dot',
  'group-dot-comma',
  'group-space-dot',
  'group-space-comma',
] as const;

export const TAB_SIZES = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const;

export function validDateFormat(pattern: string): string {
  return (DATE_FORMATS as readonly string[]).includes(pattern) ? pattern : 'MMM d, yyyy';
}

export function validTimeFormat(pattern: string): string {
  return (TIME_FORMATS as readonly string[]).includes(pattern) ? pattern : 'HH:mm';
}

export function validNumberFormat(id: string): NumberFormat {
  return (NUMBER_FORMATS as readonly string[]).includes(id) ? (id as NumberFormat) : 'plain-comma';
}

export function validTabSize(n: number): number {
  return (TAB_SIZES as readonly number[]).includes(n) ? n : 4;
}

const DEFAULT_FMT: Fmt = { date: 'MMM d, yyyy', time: 'HH:mm', number: 'plain-comma', absolute: false, locale: 'en' };

let current: Fmt = DEFAULT_FMT;

/** Set by the app once the config arrives (and when it changes); tests use explicit `Fmt`. */
export function setFmt(f: Fmt): void {
  current = f;
}

export function getFmt(): Fmt {
  return current;
}

export function fmtFromSettings(s: Settings): Fmt {
  return {
    date: validDateFormat(s.dateFormat ?? 'MMM d, yyyy'),
    time: validTimeFormat(s.timeFormat ?? 'HH:mm'),
    number: validNumberFormat(s.numberFormat ?? 'plain-comma'),
    absolute: s.preferAbsoluteDates ?? false,
    locale: getLocale(),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function monthName(d: Date, style: 'long' | 'short', locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr' : 'en-US', { month: style }).format(d);
}

function ordinal(day: number, locale: AppLocale): string {
  if (locale === 'tr') return `${day}.`;
  const m10 = day % 10;
  const m100 = day % 100;
  if (m10 === 1 && m100 !== 11) return `${day}st`;
  if (m10 === 2 && m100 !== 12) return `${day}nd`;
  if (m10 === 3 && m100 !== 13) return `${day}rd`;
  return `${day}th`;
}

function dayPeriod(hour24: number, locale: AppLocale): string {
  const pm = hour24 >= 12;
  return locale === 'tr' ? (pm ? 'ÖS' : 'ÖÖ') : pm ? 'pm' : 'am';
}

function renderDate(pattern: string, d: Date, locale: AppLocale): string {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return pattern.replace(/MMMM|MMM|MM|dd|do|d|yyyy|yy/g, (tok) => {
    switch (tok) {
      case 'MMMM':
        return monthName(d, 'long', locale);
      case 'MMM':
        return monthName(d, 'short', locale);
      case 'MM':
        return pad2(month);
      case 'dd':
        return pad2(day);
      case 'do':
        return ordinal(day, locale);
      case 'd':
        return String(day);
      case 'yyyy':
        return String(year);
      case 'yy':
        return String(year).slice(-2);
      default:
        return tok;
    }
  });
}

function renderTime(pattern: string, d: Date, locale: AppLocale): string {
  const h24 = d.getHours();
  const h12 = h24 % 12 || 12;
  return pattern.replace(/HH|h|mm|ss|aaa/g, (tok) => {
    switch (tok) {
      case 'HH':
        return pad2(h24);
      case 'h':
        return String(h12);
      case 'mm':
        return pad2(d.getMinutes());
      case 'ss':
        return pad2(d.getSeconds());
      default:
        return dayPeriod(h24, locale);
    }
  });
}

/** The dropdown samples are rendered for Oct 19, 2017 14:30:45. */
const SAMPLE_UNIX = new Date(2017, 9, 19, 14, 30, 45).getTime() / 1000;

/** `Oct 19, 2017` for a Date Format option, in the app language. */
export function dateSample(pattern: string, f: Fmt = getFmt()): string {
  return renderDate(validDateFormat(pattern), new Date(SAMPLE_UNIX * 1000), f.locale);
}

/** `14:30` for a Time Format option, in the app language. */
export function timeSample(pattern: string, f: Fmt = getFmt()): string {
  return renderTime(validTimeFormat(pattern), new Date(SAMPLE_UNIX * 1000), f.locale);
}

/** `Oct 19, 2017, 14:30` from the Appearance patterns. */
export function formatDateTime(unix: number, f: Fmt = getFmt()): string {
  const d = new Date(unix * 1000);
  return `${renderDate(f.date, d, f.locale)}, ${renderTime(f.time, d, f.locale)}`;
}

/** The date alone, for release notes. */
export function formatDate(unix: number, f: Fmt = getFmt()): string {
  return renderDate(f.date, new Date(unix * 1000), f.locale);
}

/** A Number Format's separators: thousands (`''` for the `plain-*` ones) and decimal. */
function separators(id: string): { group: string; decimal: string } {
  const [kind, a, b] = id.split('-');
  if (kind === 'plain') return { group: '', decimal: a === 'comma' ? ',' : '.' };
  const sep = (s: string) => (s === 'comma' ? ',' : s === 'dot' ? '.' : ' ');
  return { group: sep(a), decimal: sep(b) };
}

function group(digits: string, sep: string): string {
  return sep ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : digits;
}

/** A count with the Number Format grouping; `plain-*` shows none. Counts are integers. */
export function formatCount(n: number, f: Fmt = getFmt()): string {
  const sign = n < 0 ? '-' : '';
  return sign + group(String(Math.abs(Math.trunc(n))), separators(f.number).group);
}

/** A number with the Number Format separators, for the Settings samples (`1234567.89`). */
export function formatSample(value: number, id: string): string {
  const { group: sep, decimal } = separators(id);
  const [whole, frac] = String(value).split('.');
  return frac === undefined ? group(whole, sep) : `${group(whole, sep)}${decimal}${frac}`;
}

/** The primary age text: relative, or absolute with the setting on. */
export function ageText(unix: number, now: number = Date.now() / 1000, f: Fmt = getFmt()): string {
  return f.absolute ? formatDateTime(unix, f) : formatAge(unix, now);
}

/** A commit row's age under a History day label: relative, or the time alone with the setting on. */
export function rowAgeText(unix: number, now: number = Date.now() / 1000, f: Fmt = getFmt()): string {
  return f.absolute ? renderTime(f.time, new Date(unix * 1000), f.locale) : formatAge(unix, now);
}

/** The tooltip beside it: the other form. */
export function ageTitle(unix: number, now: number = Date.now() / 1000, f: Fmt = getFmt()): string {
  return f.absolute ? t('time.ago', { age: formatAge(unix, now) }) : formatDateTime(unix, f);
}

/** A relative age with its ago-word (`3h ago`), for sentences that keep it. */
export function agoText(unix: number, now: number = Date.now() / 1000, f: Fmt = getFmt()): string {
  return f.absolute ? formatDateTime(unix, f) : t('time.ago', { age: formatAge(unix, now) });
}

/** A count for an MF2 select: the raw selector and the displayed form. */
export function cnt(n: number): { n: string; d: string } {
  return { n: String(n), d: formatCount(n) };
}
