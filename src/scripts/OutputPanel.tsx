import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { CloseIcon } from '../components/icons';
import { Modal, ModalFooter } from '../components/Modal';
import { Pill } from '../components/Pill';
import { getScriptRun, resizeScript, stopScript, writeScriptInput } from '../lib/ipc';
import type { ScriptRun } from '../lib/types';
import { ScriptIcon } from './ScriptIcon';
import { onRunOutput, runAgain, useRuns } from './runs';
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

/** Terminal escapes out, for Copy output. */
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
    fit.fit();
    void resizeScript(run.runId, t.cols, t.rows).catch(() => {});
    term.current = t;

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
        could not start
      </Pill>
    ) : running ? (
      <Pill tone="neutral" mono>
        running · {took}
      </Pill>
    ) : run.exitCode === 0 ? (
      <Pill tone="success" mono>
        exit 0 · {took}
      </Pill>
    ) : (
      <Pill tone="danger" mono>
        {run.stopped ? 'stopped' : run.exitCode !== null ? `exit ${run.exitCode}` : (run.signal ?? 'ended')} · {took}
      </Pill>
    );

  const copy = async () => {
    const r = await getScriptRun(run.runId);
    await writeText(plainText(r.buffered ?? ''));
  };

  return (
    <Modal aria-label={`${run.name} output`} width={760} paddingTop={80} onClose={onClose}>
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
          <IconButton aria-label="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </IconButton>
        </div>
        <div
          ref={box}
          role="log"
          aria-label="Output"
          className={focused && running ? `${styles.terminal} ${styles.focused}` : styles.terminal}
        />
        <ModalFooter
          ruled
          aside={running ? (focused ? 'Type to answer · ⌃C stops' : 'Click the output to type') : undefined}
        >
          <Button size={36} onClick={() => void copy()}>
            Copy output
          </Button>
          {running ? (
            <Button size={36} className={styles.stop} onClick={() => void stopScript(run.runId)}>
              Stop
            </Button>
          ) : (
            canRunAgain && (
              <Button variant="primary" size={36} onClick={() => runAgain(run.runId)}>
                Run again
              </Button>
            )
          )}
        </ModalFooter>
      </div>
    </Modal>
  );
}
