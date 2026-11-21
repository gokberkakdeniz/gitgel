import { useState, type ReactNode, type Ref } from 'react';
import { t } from '../i18n';
import { IconButton } from './IconButton';
import { MoreVerticalIcon } from './icons';
import { Menu } from './Menu';
import { Popover } from './Popover';

/** The ⋮ button that closes a page header (Review): the page's less used actions
 * (Stash, Refresh, Edit project). `children` gets a `close` that also hands back the
 * button's rect, for a dialog that opens from it; `buttonRef` gives the button, for one opened
 * from elsewhere (the command palette). */
export function PageMenu({
  children,
  buttonRef,
}: {
  children: (close: () => void, anchor: DOMRect) => ReactNode;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const [at, setAt] = useState<DOMRect | null>(null);
  return (
    <>
      <IconButton
        ref={buttonRef}
        size={32}
        aria-label={t('common.moreActions')}
        title={t('common.moreActions')}
        aria-haspopup="menu"
        aria-expanded={!!at}
        active={!!at}
        onClick={(e) => setAt(at ? null : e.currentTarget.getBoundingClientRect())}
      >
        <MoreVerticalIcon size={14} />
      </IconButton>
      {at && (
        <Popover anchorRect={at} width={240} alignRight onClose={() => setAt(null)}>
          <Menu aria-label={t('common.moreActions')} autoFocus>
            {children(() => setAt(null), at)}
          </Menu>
        </Popover>
      )}
    </>
  );
}
