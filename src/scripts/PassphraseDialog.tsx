// SSH passphrase (SPEC §15, FlowS1.dc.html): ssh asked for a key's passphrase in a run; the
// answer is typed into the run's pty, and saved in the Keychain once ssh took it.
import { useState } from 'react';
import { create } from 'zustand';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Input } from '../components/Input';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { rememberSshKey, stopScript, writeScriptInput } from '../lib/ipc';
import { tildifyHome } from '../lib/paths';
import type { ScriptRun } from '../lib/types';
import styles from './PassphraseDialog.module.css';

interface Ask {
  runId: string;
  key: string;
  /** ssh asked again after an answer: it was wrong. */
  wrong: boolean;
  /** Tells one ask from the next (a new dialog, an empty field). */
  n: number;
}
/** The last answer, until ssh asks again (wrong) or the run ends (taken). */
interface Answer {
  runId: string;
  key: string;
  passphrase: string;
  remember: boolean;
}

const usePassphrase = create<{ ask: Ask | null; answer: Answer | null }>()(() => ({ ask: null, answer: null }));
let asks = 0;

/** `ssh-passphrase`: open the dialog (again, saying so, after a wrong one). */
export function applyPassphraseAsked(e: { runId: string; key: string }) {
  const { answer } = usePassphrase.getState();
  const wrong = !!answer && answer.runId === e.runId && answer.key === e.key;
  usePassphrase.setState({ ask: { ...e, wrong, n: ++asks }, answer: null });
}

/** A run ended: its dialog closes, and an answer ssh took is saved when asked to. */
export function applyPassphraseRunExited(run: ScriptRun) {
  const { ask, answer } = usePassphrase.getState();
  if (ask?.runId === run.runId) usePassphrase.setState({ ask: null });
  if (answer?.runId === run.runId) {
    usePassphrase.setState({ answer: null });
    if (answer.remember) {
      // Never log the passphrase; ssh-add's failure is logged by the backend.
      rememberSshKey(answer.key, answer.passphrase).catch(() => console.warn('the passphrase was not saved'));
    }
  }
}

export function PassphraseDialog() {
  const ask = usePassphrase((s) => s.ask);
  return ask ? <Dialog key={ask.n} ask={ask} /> : null;
}

function Dialog({ ask }: { ask: Ask }) {
  const [value, setValue] = useState('');
  const [remember, setRemember] = useState(true);
  const submit = () => {
    if (!value) return;
    void writeScriptInput(ask.runId, `${value}\r`);
    usePassphrase.setState({ ask: null, answer: { runId: ask.runId, key: ask.key, passphrase: value, remember } });
  };
  const cancel = () => {
    void stopScript(ask.runId);
    usePassphrase.setState({ ask: null, answer: null });
  };
  return (
    <Modal aria-label="Passphrase" width={420} paddingTop={180} onClose={cancel}>
      <ModalHeader title="Passphrase" sub={tildifyHome(ask.key)} subMono />
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={styles.field}>
          <Input
            type="password"
            size={36}
            autoFocus
            aria-label="Passphrase"
            value={value}
            onChange={setValue}
            invalid={ask.wrong && !value}
          />
          {ask.wrong && <span className={styles.wrong}>Wrong passphrase</span>}
        </div>
        <Checkbox label="Remember in Keychain" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
      </form>
      <ModalFooter>
        <Button size={36} onClick={cancel}>
          Cancel
        </Button>
        <Button variant="primary" size={36} kbd="↵" disabled={!value} onClick={submit}>
          Continue
        </Button>
      </ModalFooter>
    </Modal>
  );
}
