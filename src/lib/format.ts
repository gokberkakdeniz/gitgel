const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

/** Compact age of a unix timestamp: `6m`, `3h`, `2d`, `1y`. */
export function formatAge(unix: number, now: number = Date.now() / 1000): string {
  const age = Math.max(0, now - unix);
  if (age < HOUR) return `${Math.max(1, Math.floor(age / MINUTE))}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < YEAR) return `${Math.floor(age / DAY)}d`;
  return `${Math.floor(age / YEAR)}y`;
}

/** `plural(1, 'branch', 'branches')` → `1 branch`; `plural(3, …)` → `3 branches`. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
