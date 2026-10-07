/** The last line of a selection from line `from` to `to`; one that ends at the start of a line
 * does not include that line. */
function lastLine(from: number, to: number, endColumn: number): number {
  return Math.max(from, to > from && endColumn === 1 ? to - 1 : to);
}

/** `@path:12-13` (`@path:12` for one line): a pointer into a file to hand to an agent. */
export function fileReference(path: string, from: number, to: number, endColumn = 2): string {
  const last = lastLine(from, to, endColumn);
  return last > from ? `@${path}:${from}-${last}` : `@${path}:${from}`;
}

/** `<github>/blob/<sha>/<path>#L12-L13`: the lines as they are in that commit. */
export function permalink(github: string, sha: string, path: string, from: number, to: number, endColumn = 2): string {
  const last = lastLine(from, to, endColumn);
  const file = path.split('/').map(encodeURIComponent).join('/');
  return `${github}/blob/${sha}/${file}#L${from}${last > from ? `-L${last}` : ''}`;
}
