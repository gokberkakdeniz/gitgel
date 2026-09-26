/** `origin/HEAD → main, master` → `['origin/HEAD', 'main', 'master']`; `→`, `,` and `>` separate. */
export function parseBaseOrder(text: string): string[] {
  return text
    .split(/→|,|>/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A whole number of days, 1–365, or null. */
export function parseDays(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 365 ? n : null;
}
