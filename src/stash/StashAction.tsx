import { useState } from 'react';
import { MenuItem } from '../components/Menu';
import type { ReviewGroup } from '../lib/types';
import { StashDialog, stashRows } from './StashDialog';

/** "Stash" (flow P4) for a page's ⋮ menu (Review, History): left out while no
 * checked-out entry has uncommitted changes, disabled while they all have merge conflicts. The
 * dialog opens under the ⋮ button. */
export function useStashAction(groups: ReviewGroup[]) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rows = stashRows(groups).filter((r) => r.files.length > 0);
  const any = rows.some((r) => r.entry.conflicts === 0);
  const item = (close: () => void, anchor: DOMRect) =>
    rows.length > 0 && (
      <MenuItem
        icon="package"
        disabled={!any}
        title={any ? undefined : 'Resolve the merge conflicts first; git cannot stash them'}
        onSelect={() => {
          close();
          setRect(anchor);
        }}
      >
        Stash
      </MenuItem>
    );
  const dialog = rect && <StashDialog groups={groups} anchorRect={rect} onClose={() => setRect(null)} />;
  return { item, dialog };
}
