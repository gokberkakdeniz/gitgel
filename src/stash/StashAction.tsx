import { useState } from 'react';
import { MenuItem } from '../components/Menu';
import { t } from '../i18n';
import type { ReviewGroup } from '../lib/types';
import { StashDialog, stashRows } from './StashDialog';

/** "Stash" (flow P4) for a page's ⋮ menu (Review, History): left out while no
 * checked-out entry has uncommitted changes, disabled while they all have merge conflicts. The
 * dialog opens under the ⋮ button. */
export function useStashAction(groups: ReviewGroup[]) {
  const [at, setAt] = useState<{ rect: DOMRect; pointer: boolean } | null>(null);
  const rows = stashRows(groups).filter((r) => r.files.length > 0);
  const any = rows.some((r) => r.entry.conflicts === 0);
  const item = (close: () => void, anchor: DOMRect) =>
    rows.length > 0 && (
      <MenuItem
        icon="package"
        disabled={!any}
        title={any ? undefined : t('stash.conflictHint')}
        onSelect={() => {
          close();
          setAt({ rect: anchor, pointer: false });
        }}
      >
        {t('stash.menuItem')}
      </MenuItem>
    );
  const dialog = at && (
    <StashDialog groups={groups} anchorRect={at.rect} atPointer={at.pointer} onClose={() => setAt(null)} />
  );
  /** Opens the dialog at the pointer (Stash All Changes in History's Uncommitted right-click
   * menu); null when nothing can be stashed (no changes, or merge conflicts everywhere). */
  const open = rows.length > 0 && any ? (pointer: DOMRect) => setAt({ rect: pointer, pointer: true }) : null;
  return { item, dialog, open };
}
