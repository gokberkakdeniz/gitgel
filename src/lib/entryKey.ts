// Same as `entry_key` in src-tauri/src/model.rs.
import type { EntryRef } from './types';

export function entryKey({ repoId, branch, worktreePath }: EntryRef): string {
  return branch !== null ? `${repoId}:${branch}` : `${repoId}:@${worktreePath ?? ''}`;
}
