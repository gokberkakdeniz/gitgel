import { Menu, MenuDivider, MenuItem } from './Menu';

/** Rename / Delete project; shared by the Project header and the sidebar's right-click. */
export function ProjectMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  return (
    <Menu aria-label="Project options">
      <MenuItem hint="F2" onSelect={onRename}>
        Rename
      </MenuItem>
      <MenuDivider />
      <MenuItem danger onSelect={onDelete}>
        Delete project
      </MenuItem>
    </Menu>
  );
}
