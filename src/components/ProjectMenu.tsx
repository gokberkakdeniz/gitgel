import { t } from '../i18n';
import { Menu, MenuDivider, MenuItem } from './Menu';

/** Rename / Delete Project…; shared by the Project header and the sidebar's right-click. */
export function ProjectMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  return (
    <Menu aria-label={t('project.projectOptions')}>
      <MenuItem hint="F2" onSelect={onRename}>
        {t('common.rename')}
      </MenuItem>
      <MenuDivider />
      <MenuItem danger onSelect={onDelete}>
        {t('common.deleteProject')}
      </MenuItem>
    </Menu>
  );
}
