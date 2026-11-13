import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../components/IconButton';
import { CheckIcon, ChevronRightIcon, CloseIcon } from '../../components/icons';
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
import { THEME_CHOICES, resolveEffective, type ThemeChoice } from '../../lib/theme';
import type { CommitRows, Config, HistoryLayout, Settings } from '../../lib/types';
import { themeOf, variantOf, type EffectiveTheme } from '../../themes';
import { useData } from '../../state/data';
import { useUi } from '../../state/ui';
import styles from './Settings.module.css';

const DOTS = ['#ff5f57', '#febc2e', '#28c840'];

function box(x: number, y: number, w: number, h: number, c: string, r = 2): React.CSSProperties {
  return {
    position: 'absolute',
    left: x,
    top: y,
    width: w,
    height: h,
    background: c,
    borderRadius: r,
  };
}

/** One 120 × 72 mini-window in the given theme. */
function Layer({ theme, clip }: { theme: EffectiveTheme; clip?: boolean }) {
  const p = variantOf(theme).colors;
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        background: p.bgMain,
        ...(clip ? { clipPath: 'polygon(0 0, 100% 0, 0 100%)' } : {}),
      }}
    >
      <span style={box(0, 0, 32, 72, p.bgSidebar, 0)} />
      <span style={box(32, 0, 1, 72, p.border, 0)} />
      {DOTS.map((c, i) => (
        <span key={c} style={box(6 + i * 6, 6, 4, 4, c)} />
      ))}
      <span style={box(6, 20, 20, 3, p.borderStrong)} />
      <span style={box(6, 27, 15, 3, p.borderStrong)} />
      <span style={box(6, 34, 18, 3, p.borderStrong)} />
      <span style={box(40, 9, 42, 5, p.textMuted)} />
      <span style={box(40, 22, 70, 3, p.borderStrong)} />
      <span style={box(40, 29, 58, 3, p.borderStrong)} />
      <span style={box(40, 36, 64, 3, p.borderStrong)} />
      <span style={box(40, 50, 26, 9, p.accent, 3)} />
    </span>
  );
}

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

const sameChoice = (a: ThemeChoice, b: ThemeChoice) =>
  themeOf(a.theme).id === themeOf(b.theme).id && a.appearance === b.appearance;
const choiceName = (c: (typeof THEME_CHOICES)[number]) => `${c.name} ${t(c.label)}`;

function ThemeGroup({ config }: { config: Config }) {
  const current = THEME_CHOICES.find((c) => sameChoice(c, config.settings))!;
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="theme-title" className={styles.section}>
      <span id="theme-title" className={styles.settingName}>
        {t('settings.themeName')}
      </span>
      <button
        type="button"
        className={styles.themeTrigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <ThemePreview choice={current} />
        <span className={styles.themeTriggerText}>
          <span className={styles.settingName}>{choiceName(current)}</span>
          <span className={styles.settingHint}>{t('settings.browseThemes')}</span>
        </span>
        <ChevronRightIcon size={16} />
      </button>
      <span className={styles.settingHint}>{t('settings.themeHint')}</span>
      {open && <ThemeDrawer config={config} onClose={() => setOpen(false)} />}
    </section>
  );
}

function ThemePreview({ choice }: { choice: ThemeChoice }) {
  return (
    <span className={styles.tileFrame} aria-hidden>
      {choice.appearance === 'system' ? (
        <><Layer theme={resolveEffective(choice, true)} /><Layer theme={resolveEffective(choice, false)} clip /></>
      ) : (
        <Layer theme={resolveEffective(choice, false)} />
      )}
    </span>
  );
}

function ThemeDrawer({ config, onClose }: { config: Config; onClose: () => void }) {
  const current: ThemeChoice = config.settings;
  const dialog = useRef<HTMLDialogElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = dialog.current!;
    useUi.getState().modalOpened();
    el.showModal();
    el.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => {
      el.close();
      useUi.getState().modalClosed();
      previous?.focus();
    };
  }, []);

  const pick = async (a: ThemeChoice) => {
    if (sameChoice(a, current) || saving) return;
    setSaving(true);
    setError(false);
    try {
      const settings = useData.getState().config?.settings ?? config.settings;
      const saved = await updateSettings({ ...settings, theme: a.theme, appearance: a.appearance });
      useData.getState().setConfig(saved);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  // Radio semantics: the arrow keys move (and pick) the choice.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = THEME_CHOICES.findIndex((a) => sameChoice(a, current));
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % THEME_CHOICES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i + THEME_CHOICES.length - 1) % THEME_CHOICES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = THEME_CHOICES.length - 1;
    if (next === null) return;
    e.preventDefault();
    if (saving) return;
    void pick(THEME_CHOICES[next]);
    buttons.current[next]?.focus();
  };

  return createPortal(
    <dialog
      ref={dialog}
      className={styles.themeDrawer}
      aria-labelledby="theme-drawer-title"
      aria-describedby="theme-drawer-hint"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
        if (e.target === e.currentTarget && outside) onClose();
      }}
    >
      <div className={styles.themeDrawerHeader}>
        <h2 id="theme-drawer-title" className={styles.heading}>{t('settings.themeName')}</h2>
        <IconButton aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon size={14} />
        </IconButton>
      </div>
      <p id="theme-drawer-hint" className={styles.themeDrawerHint}>{t('settings.themeDrawerHint')}</p>
      <div role="radiogroup" aria-labelledby="theme-drawer-title" aria-busy={saving} className={styles.tiles} onKeyDown={onKeyDown}>
        {THEME_CHOICES.map((a, i) => {
          const on = sameChoice(a, current);
          return (
            <button
              key={`${a.theme}-${a.appearance}`}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={saving}
              // One tab stop for the group; the arrow keys move between tiles.
              tabIndex={on ? 0 : -1}
              onClick={() => void pick(a)}
              className={styles.tile}
            >
              <ThemePreview choice={a} />
              <span className={styles.tileLabel}>{choiceName(a)}</span>
              <span className={styles.themeCheck}>{on && <CheckIcon size={14} />}</span>
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className={styles.themeError}>{t('settings.themeSaveFailed')}</p>}
    </dialog>,
    document.body,
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
