// The small windows beside the main one (SPEC §7, `src-tauri/src/windows.rs`): About Gitgel,
// Software Update and What's New. Each follows Settings › Appearance like the main window.
import { listen } from '@tauri-apps/api/event';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { getConfig, revealWindow as ipcRevealWindow } from '../lib/ipc';
import { fmtFromSettings, getFmt, setFmt } from '../lib/format';
import { getLocale, resolveLocale, setLocale } from '../i18n';
import { applyTheme, resolveEffective, systemIsDark, watchSystemTheme } from '../lib/theme';
import type { Appearance, Config } from '../lib/types';
import { AboutWindow } from './AboutWindow';
import { UpdateWindow } from './UpdateWindow';
import { WhatsNewWindow } from './WhatsNewWindow';
import styles from './AuxApp.module.css';

/** Shows the window, which `windows.rs` opens hidden: once it has drawn (and sized itself), so
 * it never flashes empty or jumps. Later calls do nothing. */
let revealed = false;
export function revealWindow() {
  if (revealed) return;
  revealed = true;
  void ipcRevealWindow();
}

export function AuxApp({ label }: { label: string }) {
  // In case a window never reports that it is ready.
  useEffect(() => {
    const timer = window.setTimeout(revealWindow, 800);
    return () => window.clearTimeout(timer);
  }, []);

  const [, setLangTick] = useState(0);
  useEffect(() => {
    let appearance: Appearance = 'system';
    const apply = (a: Appearance) => {
      appearance = a;
      applyTheme(resolveEffective(a, systemIsDark()), a);
    };
    void getConfig().then((c) => {
      apply(c.settings.appearance);
      let changed = false;
      const next = resolveLocale(c.settings.language ?? 'system');
      if (next !== getLocale()) {
        setLocale(next);
        changed = true;
      }
      const fmt = fmtFromSettings(c.settings);
      if (JSON.stringify(fmt) !== JSON.stringify(getFmt())) {
        setFmt(fmt);
        changed = true;
      }
      if (changed) setLangTick((n) => n + 1);
    });
    const unlisten = listen<Config>('config-changed', (e) => apply(e.payload.settings.appearance));
    const unwatch = watchSystemTheme(() => appearance);
    return () => {
      unwatch();
      void unlisten.then((fn) => fn());
    };
  }, []);

  const content =
    label === 'about' ? <AboutWindow /> : label === 'update' ? <UpdateWindow /> : label === 'whats-new' ? <WhatsNewWindow /> : null;
  return (
    <div className={styles.window}>
      {/* The traffic lights sit here; the strip moves the window. */}
      <div className={styles.titleBar} data-tauri-drag-region />
      {content}
    </div>
  );
}

/** Closes this window. */
export function closeWindow() {
  void getCurrentWindow().close();
}

/** Esc closes the window, unless `enabled` is false (an update installing). */
export function useEscCloses(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Keeps a fixed-size window as tall as `ref`'s content (About, Software Update), and `width`
 * wide when given (Software Update widens for release notes). */
export function useFitHeight(ref: RefObject<HTMLElement | null>, width?: number) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      // Not requestAnimationFrame: a hidden webview does not run it.
      void getCurrentWindow()
        .setSize(new LogicalSize(width ?? window.innerWidth, height))
        .then(revealWindow);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    fit();
    return () => observer.disconnect();
  }, [ref, width]);
}

/** A fixed-size window's content: measured for `useFitHeight`. */
export function Fitted({ children, className, width }: { children: ReactNode; className?: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useFitHeight(ref, width);
  return (
    <div ref={ref} className={className ? `${styles.fitted} ${className}` : styles.fitted}>
      {children}
    </div>
  );
}
