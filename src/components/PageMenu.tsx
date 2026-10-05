import { useState, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import { MoreVerticalIcon } from './icons';
import { Menu } from './Menu';
import { Popover } from './Popover';

/** The ⋮ button that closes a page header (Review, History): the page's less used actions
 * (Stash, Refresh, Edit project). `children` gets a `close` that also hands back the
 * button's rect, for a dialog that opens from it. */
export function PageMenu({ children }: { children: (close: () => void, anchor: DOMRect) => ReactNode }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  return (
    <>
      <IconButton
        size={32}
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={!!at}
        active={!!at}
        onClick={(e) => setAt(at ? null : e.currentTarget.getBoundingClientRect())}
      >
        <MoreVerticalIcon size={14} />
      </IconButton>
      {at && (
        <Popover anchorRect={at} width={240} alignRight onClose={() => setAt(null)}>
          <Menu aria-label="More actions" autoFocus>
            {children(() => setAt(null), at)}
          </Menu>
        </Popover>
      )}
    </>
  );
}
