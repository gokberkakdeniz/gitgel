import { useState } from 'react';
import { Button } from '../components/Button';
import type { ReviewGroup } from '../lib/types';
import { StashDialog, stashRows } from './StashDialog';

/** Stash… (flow P4) in the Review and History headers: disabled while no checked-out entry has
 * uncommitted changes. */
export function StashButton({ groups }: { groups: ReviewGroup[] }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const any = stashRows(groups).some((r) => r.files.length > 0);
  return (
    <>
      <Button
        icon="package"
        disabled={!any}
        title={any ? undefined : 'No uncommitted changes'}
        active={!!rect}
        onClick={(e) => setRect(e.currentTarget.getBoundingClientRect())}
      >
        Stash…
      </Button>
      {rect && <StashDialog groups={groups} anchorRect={rect} onClose={() => setRect(null)} />}
    </>
  );
}
