import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { ChevronDownIcon, UndoIcon } from '../../components/icons';
import { Input } from '../../components/Input';
import { List } from '../../components/List';
import { Menu, MenuItem } from '../../components/Menu';
import { Modal, ModalFooter, ModalHeader } from '../../components/Modal';
import { Popover } from '../../components/Popover';
import { Switch } from '../../components/Switch';
import { AI_PROVIDERS, providerOrder, type AiProviderMeta } from '../../lib/ai';
import { getAiStatus, getDefaultPrompt, updateSettings } from '../../lib/ipc';
import { useAutoGrow } from '../../lib/useAutoGrow';
import type { AiProviderSettings, AiStatus, CommitProvider, Config } from '../../lib/types';
import { useReorder } from '../../scripts/useReorder';
import styles from './Settings.module.css';

/** Settings › AI: commit message generation (SPEC §5). */
export function Ai({ config }: { config: Config }) {
  const ai = config.settings.ai;
  // Whether each CLI is installed; null while the login shell is asked, and when it fails.
  const [status, setStatus] = useState<AiStatus[] | null>(null);
  useEffect(() => {
    void getAiStatus().then(setStatus, () => {});
  }, []);
  const [editing, setEditing] = useState<AiProviderMeta | null>(null);
  const missing = (id: CommitProvider) =>
    status !== null && !status.some((s) => s.id === id && s.installed);
  const save = (next: Config['settings']['ai']) =>
    void updateSettings({ ...config.settings, ai: next });
  const withProvider = (id: CommitProvider, patch: Partial<AiProviderSettings>) => {
    const next = { ...ai };
    next[id] = { ...ai[id], ...patch };
    return next;
  };
  const ids = providerOrder(ai.order);
  const { listRef, order, dragId, handleProps, rowStyle, dropBefore, dropAfter } = useReorder(ids, (sorted) =>
    save({ ...ai, order: sorted }),
  );
  const shown = order
    .map((id) => AI_PROVIDERS.find((p) => p.id === id))
    .filter((p): p is AiProviderMeta => !!p);

  // Off and on at once, no toast: the row shows it.
  const setOn = (meta: AiProviderMeta, on: boolean) =>
    save(withProvider(meta.id, { enabled: on }));

  return (
    <>
      <h2 className={styles.heading}>AI</h2>
      <section className={styles.section}>
        <label className={styles.setting}>
          <span className={styles.settingText}>
            <span className={styles.settingName}>Generate commit message with AI</span>
            <span className={styles.settingHint}>The commit form&apos;s bolt asks an agent CLI for the message</span>
          </span>
          <Switch
            aria-label="Generate commit message with AI"
            title="Generate commit message with AI"
            checked={ai.enabled}
            onChange={(e) => save({ ...ai, enabled: e.target.checked })}
          />
        </label>
        <List
          label="Providers"
          listRef={listRef}
          empty="No providers"
          items={shown.map((p) => {
            const settings = ai[p.id];
            const off = !settings.enabled;
            const gone = missing(p.id);
            return {
              key: p.id,
              rowProps: {
                'data-reorder': true,
                className: p.id === dragId ? styles.dragging : undefined,
                style: rowStyle(p.id),
                'data-drop-before': dropBefore(p.id) || undefined,
                'data-drop-after': dropAfter(p.id) || undefined,
              },
              handle: { 'aria-label': `Move ${p.label}`, ...handleProps(p.id) },
              lead: 'tile',
              icon: 'bolt',
              title: p.label,
              titleWeight: 500,
              off,
              badges: [
                ...(gone ? [{ label: 'Not installed', tone: 'danger' as const }] : []),
                ...(off ? [{ label: 'off', tone: 'neutral' as const }] : []),
              ],
              actions: [
                {
                  kind: 'switch',
                  checked: settings.enabled,
                  ariaLabel: `${p.label} on`,
                  title: off
                    ? 'Off: in no menu. Switch on to show it'
                    : 'On: shown in the commit menu. Switch off to hide it',
                  disabled: gone,
                  onToggle: (on) => setOn(p, on),
                },
                {
                  icon: 'edit',
                  ariaLabel: `Edit ${p.label}`,
                  disabled: gone,
                  title: gone ? 'Not installed' : undefined,
                  onPress: () => setEditing(p),
                },
              ],
            };
          })}
        />
      </section>
      {editing && (
        <ProviderEditor
          meta={editing}
          settings={ai[editing.id]}
          onSave={(next) => {
            save(withProvider(editing.id, next));
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/** The prompt's variables, with what each one becomes. */
const PROMPT_VARIABLES: [string, string][] = [
  ['branch', 'the branch (or short SHA)'],
  ['repo', 'the repository name'],
  ['stat', 'the checked files, one per line'],
  ['patch', 'their diff (required)'],
  ['examples', "the repo's recent subjects"],
];

function ProviderEditor({
  meta,
  settings,
  onSave,
  onClose,
}: {
  meta: AiProviderMeta;
  settings: AiProviderSettings;
  onSave: (next: AiProviderSettings) => void;
  onClose: () => void;
}) {
  const [model, setModel] = useState(settings.model ?? '');
  const [effort, setEffort] = useState(settings.effort ?? '');
  // The effective prompt: the provider's own when untouched (prefilled from the default).
  const [prompt, setPrompt] = useState(settings.prompt ?? '');
  // The built-in default, for the Reset button and the save comparison.
  const [def, setDef] = useState<string | null>(null);
  useEffect(() => {
    void getDefaultPrompt().then(
      (d) => {
        setDef(d);
        if (settings.prompt == null) setPrompt((p) => (p === '' ? d : p));
      },
      () => setDef(''),
    );
  }, [settings.prompt]);
  const ready = settings.prompt != null || def !== null;
  const canReset = def != null && def !== '' && prompt !== def;
  const trimmed = (s: string) => {
    const t = s.trim();
    return t === '' ? null : t;
  };
  const problem = !prompt.includes('{patch}') ? 'The prompt needs {patch}' : null;
  const next = {
    ...settings,
    model: trimmed(model),
    effort: trimmed(effort),
    // Default text always stores as null — including after Reset on a custom prompt.
    prompt: trimmed(prompt) === def?.trim() ? null : trimmed(prompt),
  };
  // Nothing changed (e.g. Reset on an untouched prompt): saving writes nothing.
  const unchanged = JSON.stringify(next) === JSON.stringify(settings);
  const save = () => {
    if (problem || unchanged) return;
    onSave(next);
  };
  const submitOnKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    e.preventDefault();
    save();
  };
  // The prompt editor grows with its text; "+ Variable" inserts at the cursor.
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const grow = useAutoGrow(promptRef, prompt);
  const resetPrompt = () => {
    if (def == null) return;
    setPrompt(def);
    promptRef.current?.focus();
  };
  const [variables, setVariables] = useState<DOMRect | null>(null);
  const insertVariable = (name: string) => () => {
    const area = promptRef.current;
    const a = area?.selectionStart ?? prompt.length;
    const b = area?.selectionEnd ?? prompt.length;
    const text = `{${name}}`;
    setPrompt(prompt.slice(0, a) + text + prompt.slice(b));
    setVariables(null);
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(a + text.length, a + text.length);
    });
  };
  return (
    <Modal aria-label={`Edit ${meta.label}`} width={600} onClose={onClose}>
      <ModalHeader title={`Edit ${meta.label}`} sub={meta.binary} onClose={onClose} />
      <div className={styles.aiEditor}>
        <label className={styles.aiEditorField}>
          <span className={styles.settingName}>Model</span>
          <Input
            mono
            size={36}
            placeholder="Default"
            aria-label="Model"
            value={model}
            onChange={setModel}
            onKeyDown={submitOnKey}
          />
          <span className={styles.settingHint}>Empty is the CLI&apos;s own default</span>
        </label>
        <label className={styles.aiEditorField}>
          <span className={styles.settingName}>Effort</span>
          <Input
            mono
            size={36}
            placeholder="Default"
            aria-label="Effort"
            value={effort}
            onChange={setEffort}
            onKeyDown={submitOnKey}
          />
          <span className={styles.settingHint}>Free text: the names are the model provider&apos;s own</span>
        </label>
        <div className={styles.aiEditorField}>
          <span className={styles.settingName}>Prompt</span>
          <div className={styles.aiPromptWrap}>
            <textarea
              ref={promptRef}
              aria-label="Prompt"
              spellCheck={false}
              className={styles.aiPrompt}
              value={ready ? prompt : ''}
              placeholder={ready ? undefined : 'Loading the default…'}
              disabled={!ready}
              onChange={(e) => setPrompt(e.target.value)}
              {...grow}
            />
            <div className={styles.aiCornerWrap}>
              <button
                type="button"
                className={styles.aiCorner}
                aria-label="Reset prompt to default"
                title="Reset to default"
                disabled={!canReset}
                onClick={resetPrompt}
              >
                <UndoIcon size={12} />
                Reset
              </button>
              <button
                type="button"
                className={variables ? `${styles.aiCorner} ${styles.open}` : styles.aiCorner}
                aria-haspopup="menu"
                aria-expanded={variables !== null}
                title="Insert a variable"
                onClick={(e) =>
                  setVariables(variables ? null : e.currentTarget.getBoundingClientRect())
                }
              >
                + Variable
                <ChevronDownIcon size={9} />
              </button>
            </div>
          </div>
          {variables && (
            <Popover anchorRect={variables} width={280} alignRight onClose={() => setVariables(null)}>
              <Menu aria-label="Insert a variable" autoFocus>
                {PROMPT_VARIABLES.map(([name, note]) => (
                  <MenuItem key={name} hint={note} onSelect={insertVariable(name)}>
                    {`{${name}}`}
                  </MenuItem>
                ))}
              </Menu>
            </Popover>
          )}
        </div>
      </div>
      <ModalFooter note={problem && <span className={styles.problem}>{problem}</span>}>
        <Button size={36} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size={36}
          disabled={!!problem || !ready || unchanged}
          title={unchanged ? 'No changes' : undefined}
          onClick={save}
        >
          Save
        </Button>
      </ModalFooter>
    </Modal>
  );
}
