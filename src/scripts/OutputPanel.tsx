import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { CheckIcon, CloseIcon, CopyIcon } from '../components/icons';
import { Popover } from '../components/Popover';
import { ResizeHandle } from '../components/ResizeHandle';
import { Modal, ModalFooter } from '../components/Modal';
import { Pill } from '../components/Pill';
import { getScriptRun, resizeScript, stopScript, writeScriptInput } from '../lib/ipc';
import { t } from '../i18n';
import type { ScriptRun } from '../lib/types';
import { useCopy } from '../lib/useCopy';
import { ScriptIcon } from './ScriptIcon';
import { gitActionAgain, onRunOutput, runAgain, useRuns } from './runs';
import styles from './OutputPanel.module.css';

/** The output panel of the run `useRuns.shownRunId` names (flow N4). */
export function OutputPanelHost() {
  const runId = useRuns((s) => s.shownRunId);
  const run = useRuns((s) => (runId ? s.runs[runId] : undefined));
  if (!runId || !run) return null;
  // Keyed: Run again starts a new run with its own terminal.
  return <OutputPanel key={runId} run={run} onClose={() => useRuns.getState().showOutput(null)} />;
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A command's pieces: plain text, or a `$VAR` / `${VAR}` token (same rules as the
 * backend's `command_vars`: single-quoted parts and `\$` stay text). */
export function tokenizeCommand(command: string): { text: string; variable?: string }[] {
  const out: { text: string; variable?: string }[] = [];
  let text = '';
  const flush = () => {
    if (text) {
      out.push({ text });
      text = '';
    }
  };
  let single = false;
  let i = 0;
  while (i < command.length) {
    const c = command[i];
    if (c === "'") {
      single = !single;
      text += c;
      i++;
      continue;
    }
    if (c === '\\' && !single) {
      text += command.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '$' && !single) {
      const rest = command.slice(i + 1);
      let name = '';
      let len = 0;
      if (rest.startsWith('{')) {
        const end = rest.indexOf('}');
        if (end > 1) {
          name = rest.slice(1, end);
          len = end + 1;
        }
      } else {
        const m = /^[A-Za-z0-9_]+/.exec(rest);
        if (m) {
          name = m[0];
          len = m[0].length;
        }
      }
      if (!name) {
        text += c;
        i++;
        continue;
      }
      flush();
      out.push({ text: command.slice(i, i + 1 + len), variable: name });
      i += 1 + len;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

/** Terminal escapes out, for Copy Output. */
export function plainText(output: string): string {
  return (
    output
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      .replace(/\r\n/g, '\n')
  );
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function OutputPanel({ run, onClose }: { run: ScriptRun; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const cmd = useRef<HTMLDivElement>(null);
  // The command row's dragged height; null until first dragged, never remembered.
  const [cmdH, setCmdH] = useState<number | null>(null);
  const vars = new Map(run.commandVars.map((v) => [v.name, v.value]));
  // The variable whose value hovers, with the anchor it opened from.
  const [tip, setTip] = useState<{ name: string; rect: DOMRect } | null>(null);
  const closing = useRef<number | undefined>(undefined);
  const showTip = (el: Element, name: string) => {
    window.clearTimeout(closing.current);
    setTip({ name, rect: el.getBoundingClientRect() });
  };
  // A short delay, so the pointer can move from the variable into its value.
  const hideTip = () => {
    window.clearTimeout(closing.current);
    closing.current = window.setTimeout(() => setTip(null), 150);
  };
  useEffect(() => () => window.clearTimeout(closing.current), []);
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(Date.now());
  const running = run.status === 'running';
  const canRunAgain = useRuns((s) => !!s.starts[run.runId]);

  // The terminal: everything so far, then the chunks that follow. Typing goes to the script.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const t = new Terminal({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: cssVar('--bg-sunken'),
        foreground: cssVar('--text-code'),
        cursor: cssVar('--text-strong'),
        cursorAccent: cssVar('--bg-sunken'),
        selectionBackground: `rgba(${cssVar('--accent-rgb')}, 0.35)`,
      },
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(el);
    // Fits the visible box: the frame's padding is outside `el`, and the viewport's
    // scrollbar (classic mode) is taken out, so wrapped lines never hide on the right.
    const refit = () => {
      fit.fit();
      const vp = el.querySelector('.xterm-viewport');
      if (vp) {
        const cellW = el.clientWidth / Math.max(1, t.cols);
        const cut = Math.round((el.clientWidth - vp.clientWidth) / cellW);
        if (cut > 0) t.resize(t.cols - cut, t.rows);
      }
    };
    const syncSize = () => {
      refit();
      void resizeScript(run.runId, t.cols, t.rows).catch(() => {});
    };
    syncSize();
    // The webfont can arrive after the terminal opens; its metrics move the wrap point.
    let dead = false;
    document.fonts?.ready.then(() => {
      if (!dead) syncSize();
    }).catch(() => {});
    term.current = t;
    // The command row above is resizable: when it grows, this box shrinks. Re-fit
    // the terminal so its canvas follows instead of painting over the footer.
    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      refit();
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        void resizeScript(run.runId, t.cols, t.rows).catch(() => {});
      }, 150);
    });
    ro.observe(el);

    let seen = -1; // bytes already written; chunks up to it are in the first read
    const queued: { data: string; end: number }[] = [];
    const off = onRunOutput(run.runId, (chunk) => {
      if (seen < 0) queued.push(chunk);
      else if (chunk.end > seen) {
        t.write(chunk.data);
        seen = chunk.end;
      }
    });
    void getScriptRun(run.runId).then((r) => {
      t.write(r.buffered ?? '');
      seen = r.bufferedEnd ?? 0;
      for (const chunk of queued) {
        if (chunk.end > seen) {
          t.write(chunk.data);
          seen = chunk.end;
        }
      }
    });
    const typed = t.onData((data) => {
      if (useRuns.getState().runs[run.runId]?.status === 'running') void writeScriptInput(run.runId, data);
    });
    const textarea = el.querySelector('textarea');
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    textarea?.addEventListener('focus', onFocus);
    textarea?.addEventListener('blur', onBlur);
    return () => {
      dead = true;
      ro.disconnect();
      window.clearTimeout(resizeTimer);
      off();
      typed.dispose();
      textarea?.removeEventListener('focus', onFocus);
      textarea?.removeEventListener('blur', onBlur);
      t.dispose();
      term.current = null;
    };
  }, [run.runId]);

  // The pill's clock ticks while it runs.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const started = Date.parse(run.startedAt);
  const ended = run.endedAt ? Date.parse(run.endedAt) : now;
  const took = clock(ended - started);
  const pill =
    run.status === 'failed' ? (
      <Pill tone="danger" mono>
        {t('scripts.pillFailed')}
      </Pill>
    ) : running ? (
      <Pill tone="neutral" mono>
        {t('scripts.pillRunning', { took })}
      </Pill>
    ) : run.exitCode === 0 ? (
      <Pill tone="success" mono>
        {t('scripts.pillExit', { took })}
      </Pill>
    ) : (
      <Pill tone="danger" mono>
        {run.stopped
          ? t('scripts.stStopped')
          : run.exitCode !== null
            ? t('scripts.stExit', { code: String(run.exitCode) })
            : (run.signal ?? t('scripts.stEnded'))} · {took}
      </Pill>
    );

  // A failed git action may offer Retry (a failed Commit also: without hooks).
  const again = !running && run.status === 'exited' && run.exitCode !== 0 && !run.stopped ? gitActionAgain(run.runId) : undefined;
  const retry = again?.retry;
  useEffect(() => {
    if (!retry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !e.metaKey) return;
      e.preventDefault();
      onClose();
      retry();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [retry, onClose]);

  const { copied, copy } = useCopy();
  const copyOutput = () => copy(async () => plainText((await getScriptRun(run.runId)).buffered ?? ''));
  const varCopy = useCopy();

  return (
    <Modal aria-label={t('scripts.outputAria', { name: run.name })} width={760} paddingTop={80} onClose={onClose}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <ScriptIcon name={run.icon} />
          <div className={styles.titles}>
            <h2 className={styles.title}>{run.name}</h2>
            <span className={styles.sub} title={run.folder}>
              {run.repoLabel} · {run.folder}
            </span>
          </div>
          {pill}
          <IconButton aria-label={t('common.close')} onClick={onClose}>
            <CloseIcon size={13} />
          </IconButton>
        </div>
        {run.command && (
          <>
            <div ref={cmd} className={styles.command} style={cmdH ? { height: cmdH } : undefined}>
              <span aria-hidden="true" className={styles.dollar}>
                $
              </span>
              <span className={styles.commandText}>
                {tokenizeCommand(run.command).map((tok, i) =>
                  tok.variable && vars.has(tok.variable) ? (
                    <span
                      key={i}
                      role="button"
                      tabIndex={0}
                      aria-label={t('scripts.varAria', { name: tok.text })}
                      aria-expanded={tip?.name === tok.variable}
                      className={styles.var}
                      onMouseEnter={(e) => showTip(e.currentTarget, tok.variable as string)}
                      onMouseLeave={hideTip}
                      onFocus={(e) => showTip(e.currentTarget, tok.variable as string)}
                      onBlur={hideTip}
                    >
                      {tok.text}
                    </span>
                  ) : (
                    <span key={i}>{tok.text}</span>
                  ),
                )}
              </span>
            </div>
            <ResizeHandle
              axis="y"
              pane={cmd}
              min={34}
              max={260}
              onResize={setCmdH}
              onReset={() => setCmdH(null)}
              label={t('scripts.resizeCmd')}
            />
            {tip && (
              <Popover anchorRect={tip.rect} onClose={() => setTip(null)}>
                <div
                  className={styles.varPop}
                  onMouseEnter={() => window.clearTimeout(closing.current)}
                  onMouseLeave={hideTip}
                >
                  <div className={styles.varValue}>{vars.get(tip.name)}</div>
                  <IconButton
                    size={24}
                    aria-label={t('scripts.copyValue')}
                    title={t('scripts.copyValue')}
                    className={varCopy.copied ? `${styles.varCopy} ${styles.varCopied}` : styles.varCopy}
                    onClick={() => void varCopy.copy(vars.get(tip.name) ?? '')}
                  >
                    {varCopy.copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  </IconButton>
                </div>
              </Popover>
            )}
          </>
        )}
        <div
          role="log"
          aria-label={t('scripts.outputLabel')}
          className={focused && running ? `${styles.terminal} ${styles.focused}` : styles.terminal}
        >
          <div ref={box} className={styles.termBox} />
        </div>
        <ModalFooter
          ruled
          lead={
            <Button size={36} onClick={onClose}>
              {t('common.close')}
            </Button>
          }
        >
          <Button
            size={36}
            icon={copied ? 'check' : 'copy'}
            className={copied ? `${styles.copy} ${styles.copied}` : styles.copy}
            onClick={() => void copyOutput()}
          >
            {copied ? t('scripts.copiedBtn') : t('scripts.copyBtn')}
          </Button>
          {again && (
            <>
              {again.skipHooks && (
                <Button
                  size={36}
                  onClick={() => {
                    onClose();
                    again.skipHooks!();
                  }}
                >
                  {t('scripts.noHooks')}
                </Button>
              )}
              <Button
                variant="primary"
                size={36}
                kbd="⌘↵"
                onClick={() => {
                  onClose();
                  again.retry();
                }}
              >
                {t('scripts.retryBtn')}
              </Button>
            </>
          )}
          {running ? (
            <Button size={36} className={styles.stop} onClick={() => void stopScript(run.runId)}>
              {t('scripts.stopBtn')}
            </Button>
          ) : (
            canRunAgain && (
              <Button variant="primary" size={36} onClick={() => runAgain(run.runId)}>
                {t('scripts.runAgain')}
              </Button>
            )
          )}
        </ModalFooter>
      </div>
    </Modal>
  );
}
