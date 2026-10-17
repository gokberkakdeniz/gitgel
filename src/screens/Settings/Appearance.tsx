// Settings › Appearance: Theme tiles (moved from General), Formatting, Diff and History
// (docs/SPEC.md §5). The mini-window previews are plain elements drawn from the palette
// values below (design/screens/Settings.dc.html `layer()`), not images.
import { useRef } from 'react';
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
import type { Appearance as AppearanceSetting, CommitRows, Config, HistoryLayout, Settings } from '../../lib/types';
import styles from './Settings.module.css';

const ORDER: AppearanceSetting[] = ['system', 'light', 'dark'];
const LABELS: Record<AppearanceSetting, string> = {
  system: 'settings.themeSystem',
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
};

interface PreviewPalette {
  sb: string;
  main: string;
  line: string;
  strong: string;
  accent: string;
  edge: string;
}

const PREVIEW: Record<'light' | 'dark', PreviewPalette> = {
  light: { sb: '#f1efea', main: '#fbfaf7', line: '#dcd8d0', strong: '#8a857c', accent: '#3a7b8f', edge: '#e2ded6' },
  dark: { sb: '#0e0d0c', main: '#141311', line: '#383631', strong: '#75726b', accent: '#4f8fa3', edge: '#262420' },
};

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
function Layer({ theme, clip }: { theme: 'light' | 'dark'; clip?: boolean }) {
  const p = PREVIEW[theme];
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        background: p.main,
        ...(clip ? { clipPath: 'polygon(0 0, 100% 0, 0 100%)' } : {}),
      }}
    >
      <span style={box(0, 0, 32, 72, p.sb, 0)} />
      <span style={box(32, 0, 1, 72, p.edge, 0)} />
      {DOTS.map((c, i) => (
        <span key={c} style={box(6 + i * 6, 6, 4, 4, c)} />
      ))}
      <span style={box(6, 20, 20, 3, p.line)} />
      <span style={box(6, 27, 15, 3, p.line)} />
      <span style={box(6, 34, 18, 3, p.line)} />
      <span style={box(40, 9, 42, 5, p.strong)} />
      <span style={box(40, 22, 70, 3, p.line)} />
      <span style={box(40, 29, 58, 3, p.line)} />
      <span style={box(40, 36, 64, 3, p.line)} />
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
      <HistoryGroup config={config} />
    </>
  );
}

function ThemeGroup({ config }: { config: Config }) {
  const current: AppearanceSetting = config.settings.appearance ?? 'system';
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const pick = (a: AppearanceSetting) => {
    if (a !== current) void updateSettings({ ...config.settings, appearance: a });
  };

  // Radio semantics: the arrow keys move (and pick) the choice.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = ORDER.indexOf(current);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % ORDER.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i + ORDER.length - 1) % ORDER.length;
    if (next === null) return;
    e.preventDefault();
    pick(ORDER[next]);
    buttons.current[next]?.focus();
  };

  return (
    <section aria-labelledby="theme-title" className={styles.section}>
      <span id="theme-title" className={styles.settingName}>
        {t('settings.themeName')}
      </span>
      <div role="radiogroup" aria-labelledby="theme-title" className={styles.tiles} onKeyDown={onKeyDown}>
        {ORDER.map((a, i) => {
          const on = current === a;
          return (
            <button
              key={a}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              // One tab stop for the group; the arrow keys move between tiles.
              tabIndex={on ? 0 : -1}
              onClick={() => pick(a)}
              className={styles.tile}
            >
              <span className={on ? `${styles.tileFrame} ${styles.tileFrameOn}` : styles.tileFrame}>
                {a === 'system' ? (
                  <>
                    <Layer theme="dark" />
                    <Layer theme="light" clip />
                  </>
                ) : (
                  <Layer theme={a} />
                )}
              </span>
              <span className={on ? `${styles.tileLabel} ${styles.tileLabelOn}` : styles.tileLabel}>
                {t(LABELS[a])}
              </span>
            </button>
          );
        })}
      </div>
      <span className={styles.settingHint}>{t('settings.themeHint')}</span>
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

function HistoryGroup({ config }: { config: Config }) {
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
