import type { RemoteInfo } from '../lib/types';

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

/** The commit's page on the remote (shape by host). */
export function commitUrl(remote: RemoteInfo, sha: string): string {
  switch (remote.kind) {
    case 'gitlab':
      return `${remote.base}/-/commit/${sha}`;
    case 'bitbucket':
      return `${remote.base}/commits/${sha}`;
    case 'github':
    case 'other':
      return `${remote.base}/commit/${sha}`;
  }
}

/** The lines as they are in that commit (shape by host). */
export function permalink(
  remote: RemoteInfo,
  sha: string,
  path: string,
  from: number,
  to: number,
  endColumn = 2,
): string {
  const last = lastLine(from, to, endColumn);
  const file = path.split('/').map(encodeURIComponent).join('/');
  switch (remote.kind) {
    case 'gitlab':
      return `${remote.base}/-/blob/${sha}/${file}#L${from}${last > from ? `-L${last}` : ''}`;
    case 'bitbucket':
      return `${remote.base}/src/${sha}/${file}#lines-${from}${last > from ? `:${last}` : ''}`;
    case 'github':
    case 'other':
      return `${remote.base}/blob/${sha}/${file}#L${from}${last > from ? `-L${last}` : ''}`;
  }
}
