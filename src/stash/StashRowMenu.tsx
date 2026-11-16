import { Menu, MenuDivider, MenuItem } from '../components/Menu';
import { Popover } from '../components/Popover';
import { t } from '../i18n';
import { cnt } from '../lib/format';
import type { ReviewStash } from '../screens/Review/stashes';
import { askApply, askDrop } from './actions';

/** A Review stash row's right-click menu: Apply… and Pop… (asking for the worktree), Drop; of
 * the picked stashes together when the row is one of several. */
export function StashRowMenu({ stashes, at, onClose }: { stashes: ReviewStash[]; at: DOMRect; onClose: () => void }) {
  const many = stashes.length > 1;
  const n = cnt(stashes.length);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Popover anchorRect={at} width={many ? 230 : 200} onClose={onClose}>
      <Menu aria-label={t('branches.stashOptions')}>
        <MenuItem icon="stash-apply" onSelect={run(() => askApply(stashes, false))}>
          {many ? t('stash.applyN', { ...n }) : t('stash.applyMenu')}
        </MenuItem>
        <MenuItem icon="stash-pop" onSelect={run(() => askApply(stashes, true))}>
          {many ? t('stash.popN', { ...n }) : t('stash.popMenu')}
        </MenuItem>
        <MenuDivider />
        <MenuItem icon="trash" danger onSelect={run(() => askDrop(stashes))}>
          {many ? t('stash.dropN', { ...n }) : t('stash.drop')}
        </MenuItem>
      </Menu>
    </Popover>
  );
}
