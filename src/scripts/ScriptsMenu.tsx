import { Icon, isIconName } from '../components/icons';
import { MenuDivider, MenuItem, MenuLabel } from '../components/Menu';
import { t } from '../i18n';
import type { EntrySummary } from '../lib/types';
import { useData } from '../state/data';
import { fillName, pickScript } from './runs';
import { branchContext, menuScripts, type ScriptMenuName } from './when';

/** The Scripts group of a branch's menu (flows N1–N2): the scripts that are on, shown in this menu,
 * whose Show when matches and that can run here, in the Settings order. A missing repo runs
 * nothing, and worktree scripts need the branch checked out. No group when none is left. */
export function ScriptsMenu({
  entry,
  menu,
  project,
  onDone,
}: {
  entry: EntrySummary;
  menu: ScriptMenuName;
  project?: string;
  onDone: () => void;
}) {
  const scripts = useData((s) => s.config?.scripts ?? []);
  const branch = branchContext(entry, menu, project);
  const repoGone = entry.state === 'repo_missing';
  const noWorktree = entry.worktreePath === null;
  const shown = menuScripts(scripts, menu, branch).filter(
    (s) => !repoGone && !(s.runsIn === 'worktree' && noWorktree),
  );
  if (shown.length === 0) return null;
  return (
    <>
      <MenuDivider />
      <MenuLabel>{t('scripts.menuLabel')}</MenuLabel>
      {shown.map((s) => (
        <MenuItem
          key={s.id}
          icon={<Icon name={isIconName(s.icon) ? s.icon : 'prompt'} size={14} strokeWidth={1.8} />}
          title={fillName(s.name, entry)}
          onSelect={() => {
            onDone();
            pickScript(s, entry, menu, project);
          }}
        >
          {fillName(s.name, entry)}
        </MenuItem>
      ))}
    </>
  );
}
