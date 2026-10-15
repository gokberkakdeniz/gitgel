import { homeDir } from '@tauri-apps/api/path';

let home: string | null = null;

/** Reads the home folder once; `tildifyHome` returns paths unchanged until this resolves. */
export async function loadHome(): Promise<void> {
  if (home === null) home = await homeDir();
}

/** `/Users/me/code/x` → `~/code/x` for home `/Users/me`. */
export function tildify(path: string, homePath: string | null): string {
  if (!homePath) return path;
  const h = homePath.replace(/\/+$/, '');
  if (path === h) return '~';
  return path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}

export function tildifyHome(path: string): string {
  return tildify(path, home);
}

/** `~/code/x` → `/Users/me/code/x`; anything else unchanged. */
export function expandHome(path: string): string {
  if (!home || !(path === '~' || path.startsWith('~/'))) return path;
  return home.replace(/\/+$/, '') + path.slice(1);
}

export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const i = trimmed.lastIndexOf('/');
  if (i < 0) return '';
  return i === 0 ? '/' : trimmed.slice(0, i);
}
