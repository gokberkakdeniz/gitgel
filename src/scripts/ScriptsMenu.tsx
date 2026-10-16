import { useEffect, useState } from 'react';
import { Icon, isIconName } from '../components/icons';
import { Menu, MenuDivider, MenuItem } from '../components/Menu';
import { Popover } from '../components/Popover';
import { t } from '../i18n';
import type { EntrySummary, ScriptConfig } from '../lib/types';
import { useData } from '../state/data';
import { fillName, pickScript } from './runs';
import { branchContext, menuScripts, type ScriptMenuName } from './when';

/** The Scripts group of a branch's menu (flows N1–N2): the scripts that are on, shown in this menu,
 * whose Show when matches and that can run here, in the Settings order. A missing repo runs
 * nothing, and worktree scripts need the branch checked out. One script is an item of its own,
 * more go in a "Run Script" submenu. No group when none is left. */
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
  const [sub, setSub] = useState<{ el: HTMLElement; focus?: boolean } | null>(null);
  // The pointer on another item of the menu closes the submenu.
  useEffect(() => {
    const parent = sub?.el.closest('[role="menu"]');
    if (!sub || !parent) return;
    const over = (e: Event) => {
      const item = (e.target as Element).closest('[role^="menuitem"]');
      if (item && item !== sub.el) setSub(null);
    };
    parent.addEventListener('mouseover', over);
    return () => parent.removeEventListener('mouseover', over);
  }, [sub]);
  const branch = branchContext(entry, menu, project);
  const repoGone = entry.state === 'repo_missing';
  const noWorktree = entry.worktreePath === null;
  const shown = menuScripts(scripts, menu, branch).filter(
    (s) => !repoGone && !(s.runsIn === 'worktree' && noWorktree),
  );
  if (shown.length === 0) return null;
  const item = (s: ScriptConfig, done: () => void) => (
    <MenuItem
      key={s.id}
      icon={<Icon name={isIconName(s.icon) ? s.icon : 'prompt'} size={14} strokeWidth={1.8} />}
      title={fillName(s.name, entry)}
      onSelect={() => {
        done();
        pickScript(s, entry, menu, project);
      }}
    >
      {fillName(s.name, entry)}
    </MenuItem>
  );
  if (shown.length === 1)
    return (
      <>
        <MenuDivider />
        {item(shown[0], onDone)}
      </>
    );
  return (
    <>
      <MenuDivider />
      <MenuItem
        icon="prompt"
        submenu
        onHover={(el) => setSub({ el })}
        onSelect={(el) => setSub({ el, focus: true })}
      >
        {t('scripts.menuRun')}
      </MenuItem>
      {sub && (
        <Popover
          anchor={sub.el}
          anchorRect={sub.el.getBoundingClientRect()}
          side="right"
          width={260}
          onClose={() => setSub(null)}
        >
          <div
            onKeyDown={(e) => {
              // React carries the portal's keys to the menu around this one (its ↑/↓).
              e.stopPropagation();
              if (e.key !== 'ArrowLeft') return;
              e.preventDefault();
              sub.el.focus();
              setSub(null);
            }}
          >
            <Menu aria-label={t('scripts.menuRun')} autoFocus={!!sub.focus}>
              {shown.map((s) =>
                item(s, () => {
                  setSub(null);
                  onDone();
                }),
              )}
            </Menu>
          </div>
        </Popover>
      )}
    </>
  );
}
