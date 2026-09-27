// Settings › Appearance: the System / Light / Dark theme tiles (docs/SPEC.md §5).
// The mini-window previews are plain elements drawn from the palette values below
// (design/screens/Settings.dc.html `layer()`), not images.
import { useRef } from 'react';
import { updateSettings } from '../../lib/ipc';
import type { Appearance as AppearanceSetting, Config } from '../../lib/types';
import styles from './Settings.module.css';

const ORDER: AppearanceSetting[] = ['system', 'light', 'dark'];
const LABELS: Record<AppearanceSetting, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
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

export function Appearance({ config }: { config: Config }) {
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
    <section aria-labelledby="appearance-title" className={styles.section}>
      <h2 id="appearance-title" className={styles.heading}>
        Appearance
      </h2>
      <div role="radiogroup" aria-label="Theme" className={styles.tiles} onKeyDown={onKeyDown}>
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
                {LABELS[a]}
              </span>
            </button>
          );
        })}
      </div>
      <span className={styles.settingHint}>System follows the macOS appearance and switches with it.</span>
    </section>
  );
}
