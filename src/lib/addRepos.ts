import { open } from '@tauri-apps/plugin-dialog';
import { useUi } from '../state/ui';

/**
 * Every way of adding repositories ends here: with `paths` (dropped folders) the sheet opens
 * directly, otherwise the multi-folder picker comes first.
 */
export async function openAddRepos(paths?: string[]): Promise<void> {
  let picked = paths;
  if (!picked) {
    const result = await open({ directory: true, multiple: true });
    picked = result === null ? [] : Array.isArray(result) ? result : [result];
  }
  if (picked.length > 0) useUi.getState().setAddReposSheet(picked);
}
