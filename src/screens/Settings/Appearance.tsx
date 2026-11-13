// Settings › Appearance: Theme (every theme as System / Light / Dark, previewed while the
// list is open), Formatting, Diff and Review (docs/SPEC.md §5).
import { Fragment, useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '../../components/icons';
import { Menu, MenuDivider, MenuItem } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { Select } from '../../components/Select';
import { Switch } from '../../components/Switch';
import { t } from '../../i18n';
import {
  DATE_FORMATS,
  NUMBER_FORMATS,
  TAB_SIZES,
  TIME_FORMATS,
  dateSample,
  formatSample,
  timeSample,
  validDateFormat,
  validNumberFormat,
  validTabSize,
  validTimeFormat,
} from '../../lib/format';
import { updateSettings } from '../../lib/ipc';
import { THEME_CHOICES, previewTheme, resolveEffective, systemIsDark, type ThemeChoice } from '../../lib/theme';
import type { Appearance as AppearanceSetting, CommitRows, Config, HistoryLayout, Settings } from '../../lib/types';
import { themeOf } from '../../themes';
import select from '../../components/Select.module.css';
import styles from './Settings.module.css';

export function AppearanceSection({ config }: { config: Config }) {
  return (
    <>
      <h2 className={styles.heading}>{t('settings.appearanceHeading')}</h2>
      <ThemeGroup config={config} />
      <FormattingGroup config={config} />
      <DiffGroup config={config} />
      <ReviewListGroup config={config} />
    </>
  );
}

function ThemeGroup({ config }: { config: Config }) {
  const { settings } = config;
  const theme = themeOf(settings.theme).id;
  const appearance: AppearanceSetting = settings.appearance ?? 'system';
  const on = (c: ThemeChoice) => c.theme === theme && c.appearance === appearance;
  const name = (c: (typeof THEME_CHOICES)[number]) => `${c.name} ${t(c.label)}`;
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // A pick keeps its preview until the saved setting applies.
  const picked = useRef(false);
  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];

  // Opens on the current choice; closing without a pick ends the preview.
  useEffect(() => {
    if (!anchor) return;
    items()[THEME_CHOICES.findIndex(on)]?.focus();
    return () => {
      if (!picked.current) previewTheme(null);
      picked.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  const close = () => {
    setAnchor(null);
    button.current?.focus();
  };

  const pick = (c: ThemeChoice) => {
    picked.current = !on(c);
    close();
    if (picked.current)
      updateSettings({ ...settings, theme: c.theme, appearance: c.appearance }).catch(() => previewTheme(null));
  };

  return (
    <section className={styles.section}>
      <div className={styles.setting}>
        <span className={styles.settingText}>
          <span id="theme-title" className={styles.settingName}>
            {t('settings.themeName')}
          </span>
        </span>
        <span className={select.field}>
          <button
            ref={button}
            type="button"
            aria-labelledby="theme-title theme-value"
            aria-haspopup="menu"
            aria-expanded={!!anchor}
            className={`${select.select} ${styles.themeButton}`}
            onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              setAnchor(e.currentTarget.getBoundingClientRect());
            }}
          >
            <span id="theme-value">{name(THEME_CHOICES.find(on)!)}</span>
          </button>
          <ChevronDownIcon size={12} className={select.chevron} />
        </span>
      </div>
      {anchor && (
        <Popover anchorRect={anchor} anchor={button.current} width={230} alignRight onClose={close}>
          {/* The row under the keyboard or the pointer is shown at once; a pick saves it. */}
          <div
            ref={list}
            onFocus={(e) => {
              const c = THEME_CHOICES[items().indexOf(e.target as HTMLElement)];
              if (c) previewTheme(resolveEffective(c, systemIsDark()));
            }}
          >
            <Menu aria-label={t('settings.themeName')}>
              {THEME_CHOICES.map((c, i) => (
                <Fragment key={`${c.theme}-${c.appearance}`}>
                  {i > 0 && c.theme !== THEME_CHOICES[i - 1].theme && <MenuDivider />}
                  <MenuItem checked={on(c)} onSelect={() => pick(c)} onHover={(el) => el.focus()}>
                    {name(c)}
                  </MenuItem>
                </Fragment>
              ))}
            </Menu>
          </div>
        </Popover>
      )}
    </section>
  );
}

function FormattingGroup({ config }: { config: Config }) {
  const { dateFormat, timeFormat, numberFormat, preferAbsoluteDates } = config.settings;
  const save = (patch: Partial<Settings>) => void updateSettings({ ...config.settings, ...patch });
  return (
    <section className={styles.section}>
      <span className={styles.settingName}>{t('settings.formattingName')}</span>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>{t('settings.dateFormat')}</span>
        </span>
        <Select
          aria-label={t('settings.dateFormat')}
          value={validDateFormat(dateFormat)}
          onChange={(v) => save({ dateFormat: v })}
          options={DATE_FORMATS.map((p) => ({ value: p, label: `${dateSample(p)} (${p})` }))}
        />
      </label>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>{t('settings.timeFormat')}</span>
        </span>
        <Select
          aria-label={t('settings.timeFormat')}
          value={validTimeFormat(timeFormat)}
          onChange={(v) => save({ timeFormat: v })}
          options={TIME_FORMATS.map((p) => ({ value: p, label: `${timeSample(p)} (${p})` }))}
        />
      </label>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>{t('settings.numberFormat')}</span>
        </span>
        <Select
          aria-label={t('settings.numberFormat')}
          value={validNumberFormat(numberFormat)}
          onChange={(v) => save({ numberFormat: v })}
          options={NUMBER_FORMATS.map((id) => ({ value: id, label: formatSample(1234567.89, id) }))}
        />
      </label>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>{t('settings.absoluteDates')}</span>
        </span>
        <Switch
          aria-label={t('settings.absoluteDates')}
          title={t('settings.absoluteDates')}
          checked={preferAbsoluteDates}
          onChange={(e) => save({ preferAbsoluteDates: e.target.checked })}
        />
      </label>
    </section>
  );
}

function DiffGroup({ config }: { config: Config }) {
  const { diffTabSize } = config.settings;
  const save = (patch: Partial<Settings>) => void updateSettings({ ...config.settings, ...patch });
  return (
    <section className={styles.section}>
      <span className={styles.settingName}>{t('settings.diffName')}</span>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>{t('settings.tabSize')}</span>
        </span>
        <Select
          aria-label={t('settings.tabSize')}
          value={String(validTabSize(diffTabSize))}
          onChange={(v) => save({ diffTabSize: Number(v) })}
          options={TAB_SIZES.map((n) => ({
            value: String(n),
            label: n === 4 ? `${n} ${t('settings.tabDefault')}` : String(n),
          }))}
        />
      </label>
    </section>
  );
}

function ReviewListGroup({ config }: { config: Config }) {
  const rows: CommitRows = config.settings.commitRows === 'one-line' ? 'one-line' : 'two-line';
  const layout: HistoryLayout = config.settings.historyLayout === 'columns' ? 'columns' : 'tree';
  const save = (patch: Partial<Settings>) => void updateSettings({ ...config.settings, ...patch });
  return (
    <section className={styles.section}>
      <span className={styles.settingName}>{t('settings.historyName')}</span>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>{t('settings.commitRows')}</span>
        </span>
        <Select
          aria-label={t('settings.commitRows')}
          value={rows}
          onChange={(v) => save({ commitRows: v })}
          options={[
            { value: 'two-line', label: t('settings.commitRowsTwo') },
            { value: 'one-line', label: t('settings.commitRowsOne') },
          ]}
        />
      </label>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>{t('settings.historyLayout')}</span>
        </span>
        <Select
          aria-label={t('settings.historyLayout')}
          value={layout}
          onChange={(v) => save({ historyLayout: v })}
          options={[
            { value: 'tree', label: t('settings.historyLayoutTree') },
            { value: 'columns', label: t('settings.historyLayoutColumns') },
          ]}
        />
      </label>
    </section>
  );
}
