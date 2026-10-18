import { useState } from 'react';
import { IconButton } from '../../components/IconButton';
import { SparklesIcon, SpinnerIcon } from '../../components/icons';
import { Menu, MenuItem, MenuLabel } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { t } from '../../i18n';
import { providerLabel } from '../../lib/ai';
import type { CommitProvider } from '../../lib/types';
import styles from './GenerateButton.module.css';

/** Generate message's ✦ at the end of a summary field (SPEC §15): a click generates with the
 * default provider, right-click opens the menu of the others; a spinner while it runs. */
export function GenerateButton({
  provider,
  providers,
  generating,
  disabled,
  onGenerate,
}: {
  /** The default: the menu's topmost. */
  provider: CommitProvider;
  /** The menu's providers: switched on and installed, in menu order. */
  providers: CommitProvider[];
  generating: boolean;
  disabled: boolean;
  /** No provider: the default; a menu pick generates with it at once, leaving the default alone. */
  onGenerate: (provider?: CommitProvider) => void;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const can = !disabled && !generating;
  const generateWith = t('history.genWith', { provider: providerLabel(provider) });
  return (
    <>
      <IconButton
        size={24}
        aria-label={generateWith}
        title={generating ? t('history.askingMsg') : generateWith}
        active={menu !== null}
        disabled={!can}
        onClick={() => onGenerate()}
        onContextMenu={(e) => {
          e.preventDefault();
          if (can && providers.length > 0) setMenu(e.currentTarget.getBoundingClientRect());
        }}
        className={styles.generate}
      >
        {generating ? <SpinnerIcon size={13} className={styles.spin} /> : <SparklesIcon size={14} />}
      </IconButton>
      {menu && (
        <Popover anchorRect={menu} width={220} alignRight onClose={() => setMenu(null)}>
          <Menu aria-label={t('history.genWithMenu')}>
            <MenuLabel>{t('history.genWithMenu')}</MenuLabel>
            {providers.map((id) => (
              <MenuItem
                key={id}
                onSelect={() => {
                  onGenerate(id);
                  setMenu(null);
                }}
              >
                {providerLabel(id)}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      )}
    </>
  );
}
