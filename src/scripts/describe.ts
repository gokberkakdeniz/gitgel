import { t } from '../i18n';
import type { ScriptConfig } from '../lib/types';

/** "Worktree Folder · Branches, Projects · Opens the output" (import preview). */
export function scriptMeta(s: ScriptConfig): string {
  const folder = s.runsIn === 'worktree' ? t('scripts.metaFolderW') : t('scripts.metaFolderR');
  const menus = s.showIn.map((m) => (m === 'branches' ? t('scripts.metaBranches') : t('scripts.metaProjects'))).join(', ') || t('scripts.metaNoMenu');
  return s.openOutput ? `${folder} · ${menus} · ${t('scripts.metaOpens')}` : `${folder} · ${menus}`;
}

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
