import { describe, expect, it } from 'vitest';
import {
  ageText,
  ageTitle,
  agoText,
  cnt,
  formatAge,
  formatCount,
  formatDate,
  formatDateTime,
  formatSample,
  rowAgeText,
  validDateFormat,
  validNumberFormat,
  validTabSize,
  validTimeFormat,
  type Fmt,
} from './format';

describe('formatAge', () => {
  const now = 1_800_000_000;
  it.each([
    [0, '1m'],
    [59, '1m'],
    [6 * 60, '6m'],
    [59 * 60 + 59, '59m'],
    [3600, '1h'],
    [23 * 3600, '23h'],
    [86400, '1d'],
    [364 * 86400, '364d'],
    [365 * 86400, '1y'],
    [800 * 86400, '2y'],
  ])('%i seconds ago → %s', (ago, expected) => {
    expect(formatAge(now - ago, now)).toBe(expected);
  });

  it('treats future times as just now', () => {
    expect(formatAge(now + 100, now)).toBe('1m');
  });
});

const enFmt: Fmt = { date: 'MMM d, yyyy', time: 'HH:mm', number: 'plain-comma', absolute: false, locale: 'en' };
// Local noon: the day never shifts with the timezone.
const noon = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 30, 45).getTime() / 1000;

describe('formatDateTime', () => {
  it('renders the patterns', () => {
    const unix = noon(2017, 10, 19);
    expect(formatDateTime(unix, enFmt)).toBe(
      `${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(unix * 1000))} 19, 2017, 12:30`,
    );
    expect(formatDateTime(unix, { ...enFmt, date: 'yyyy-MM-dd', time: 'HH.mm.ss' })).toBe('2017-10-19, 12.30.45');
    expect(formatDateTime(unix, { ...enFmt, date: 'dd.MM.yy', time: 'h:mm aaa' })).toBe('19.10.17, 12:30 pm');
  });

  it('ordinals are English, dotted in Turkish', () => {
    expect(formatDate(noon(2017, 10, 1), { ...enFmt, date: 'MMMM do, yyyy' })).toBe('October 1st, 2017');
    expect(formatDate(noon(2017, 10, 2), { ...enFmt, date: 'MMMM do, yyyy' })).toBe('October 2nd, 2017');
    expect(formatDate(noon(2017, 10, 3), { ...enFmt, date: 'MMMM do, yyyy' })).toBe('October 3rd, 2017');
    expect(formatDate(noon(2017, 10, 19), { ...enFmt, date: 'MMMM do, yyyy' })).toBe('October 19th, 2017');
    expect(formatDate(noon(2017, 10, 19), { ...enFmt, date: 'MMMM do, yyyy', locale: 'tr' })).toBe('Ekim 19., 2017');
    expect(formatDate(noon(2023, 10, 19), { ...enFmt, date: 'd MMMM yyyy', locale: 'tr' })).toBe('19 Ekim 2023');
    expect(formatDate(noon(2023, 10, 19), { ...enFmt, date: 'MMMM d, yyyy' })).toBe('October 19, 2023');
  });

  it('12-hour clock and the day period follow the locale', () => {
    const unix = noon(2017, 10, 19, 14);
    expect(formatDateTime(unix, { ...enFmt, time: 'h:mm aaa' })).toMatch(/2:30 pm$/);
    expect(formatDateTime(unix, { ...enFmt, time: 'h:mm aaa', locale: 'tr' })).toMatch(/2:30 ÖS$/);
    expect(formatDateTime(noon(2017, 10, 19, 9), { ...enFmt, time: 'h.mm aaa', locale: 'tr' })).toMatch(/9\.30 ÖÖ$/);
  });
});

describe('formatCount', () => {
  it('groups only with a grouped format', () => {
    expect(formatCount(1234567, { ...enFmt, number: 'plain-dot' })).toBe('1234567');
    expect(formatCount(1234567, { ...enFmt, number: 'plain-comma' })).toBe('1234567');
    expect(formatCount(1234567, { ...enFmt, number: 'group-comma-dot' })).toBe('1,234,567');
    expect(formatCount(1234567, { ...enFmt, number: 'group-dot-comma' })).toBe('1.234.567');
    expect(formatCount(1234567, { ...enFmt, number: 'group-space-dot' })).toBe('1 234 567');
    expect(formatCount(42, { ...enFmt, number: 'group-comma-dot' })).toBe('42');
  });
});

describe('formatSample', () => {
  it('renders the six number options', () => {
    expect(formatSample(1234567.89, 'plain-dot')).toBe('1234567.89');
    expect(formatSample(1234567.89, 'plain-comma')).toBe('1234567,89');
    expect(formatSample(1234567.89, 'group-comma-dot')).toBe('1,234,567.89');
    expect(formatSample(1234567.89, 'group-dot-comma')).toBe('1.234.567,89');
    expect(formatSample(1234567.89, 'group-space-dot')).toBe('1 234 567.89');
    expect(formatSample(1234567.89, 'group-space-comma')).toBe('1 234 567,89');
  });
});

describe('validators', () => {
  it('falls back to the defaults outside the choices', () => {
    expect(validDateFormat('yMd')).toBe('MMM d, yyyy');
    expect(validDateFormat('dd.MM.yyyy')).toBe('dd.MM.yyyy');
    expect(validTimeFormat('H:m')).toBe('HH:mm');
    expect(validTimeFormat('HH.mm')).toBe('HH.mm');
    expect(validNumberFormat('grouped')).toBe('plain-comma');
    expect(validNumberFormat('group-dot-comma')).toBe('group-dot-comma');
    expect(validTabSize(7)).toBe(4);
    expect(validTabSize(8)).toBe(8);
  });
});

describe('ageText and ageTitle', () => {
  const unix = noon(2017, 10, 19);
  it('shows relative dates until absolute is on', () => {
    expect(ageText(unix, unix + 3600, enFmt)).toBe('1h');
    expect(ageTitle(unix, unix + 3600, enFmt)).toBe(formatDateTime(unix, enFmt));
    const abs: Fmt = { ...enFmt, absolute: true };
    expect(ageText(unix, unix + 3600, abs)).toBe(formatDateTime(unix, abs));
    expect(ageTitle(unix, unix + 3600, abs)).toBe('1h ago');
    expect(agoText(unix, unix + 3600, enFmt)).toBe('1h ago');
  });
  it('shows the time alone on a History row when absolute is on', () => {
    expect(rowAgeText(unix, unix + 3600, enFmt)).toBe('1h');
    expect(rowAgeText(unix, unix + 3600, { ...enFmt, absolute: true })).toBe('12:30');
  });
});

describe('cnt', () => {
  it('carries the raw selector and the displayed form', () => {
    expect(cnt(1234567)).toEqual({ n: '1234567', d: '1234567' });
    expect(cnt(1234567).d).toBe('1234567');
  });
});
