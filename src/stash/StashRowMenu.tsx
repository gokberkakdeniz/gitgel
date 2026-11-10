import { Menu, MenuDivider, MenuItem } from '../components/Menu';
import { Popover } from '../components/Popover';
import { t } from '../i18n';
import type { ReviewStash } from '../screens/Review/stashes';
import { applyStash, askDrop } from './actions';
import { useStashHome } from './StashBar';

/** A Review stash row's right-click menu: Apply and Pop (into the worktree its branch is checked
 * out in; left out when it is not), Drop. */
export function StashRowMenu({ stash, at, onClose }: { stash: ReviewStash; at: DOMRect; onClose: () => void }) {
  const home = useStashHome(stash);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Popover anchorRect={at} width={200} onClose={onClose}>
      <Menu aria-label={t('branches.stashOptions')}>
        {home && (
          <>
            <MenuItem icon="download" onSelect={run(() => void applyStash(stash, home, false))}>
              {t('stash.applyBtn')}
            </MenuItem>
            <MenuItem icon="undo" onSelect={run(() => void applyStash(stash, home, true))}>
              {t('stash.popBtn')}
            </MenuItem>
            <MenuDivider />
          </>
        )}
        <MenuItem icon="trash" danger onSelect={run(() => askDrop(stash))}>
          {t('stash.drop')}
        </MenuItem>
      </Menu>
    </Popover>
  );
}
