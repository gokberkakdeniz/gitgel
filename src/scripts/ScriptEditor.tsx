import { useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { IconButton } from '../components/IconButton';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  Icon,
  InfoIcon,
  type IconName,
} from '../components/icons';
import { Input } from '../components/Input';
import { Menu, MenuItem } from '../components/Menu';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { Pill } from '../components/Pill';
import { Popover } from '../components/Popover';
import { Select } from '../components/Select';
import { saveScript } from '../lib/ipc';
import { useAutoGrow } from '../lib/useAutoGrow';
import type { AppError, ScriptConfig, ScriptInput, ScriptInputType } from '../lib/types';
import { useData } from '../state/data';
import { DragHandle } from './DragHandle';
import { useReorder } from './useReorder';
import { BRANCH_FIELDS, branchContext, checkWhen, evalWhen } from './when';
import styles from './ScriptEditor.module.css';

/** The icons offered for a script (a part of the Icon set). */
const SCRIPT_ICONS: IconName[] = [
  'play', 'prompt', 'test', 'pull-request', 'rebase', 'link',
  'upload', 'download', 'refresh', 'undo', 'code', 'package',
  'rocket', 'bug', 'search', 'copy', 'folder', 'bolt',
];

const TYPES: { value: ScriptInputType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'select', label: 'Select' },
  { value: 'branch', label: 'Branch' },
];

const VARIABLES: [string, string][] = [
  ['$GITGEL_BRANCH', 'branch name'],
  ['$GITGEL_BASE', 'base in use'],
  ['$GITGEL_WORKTREE', 'empty if not checked out'],
  ['$GITGEL_REPO', 'repository folder'],
  ['$GITGEL_REPO_NAME', 'repository name'],
  ['$GITGEL_PROJECT', 'project entry menu only'],
  ['$GITGEL_HEAD', 'tip SHA'],
];

/** What the name can hold; filled in on the menu. */
const NAME_VARIABLES: [string, string][] = [
  ['{branch}', 'branch name'],
  ['{base}', 'base in use'],
  ['{repo}', 'repository name'],
];

const FIELD_NOTES: Partial<Record<keyof typeof BRANCH_FIELDS, string>> = {
  project: 'string, Project menu only',
  menu: "'branches' | 'project'",
};

export function newScript(): ScriptConfig {
  return {
    id: '',
    name: '',
    icon: 'prompt',
    command: '',
    inputs: [],
    runsIn: 'worktree',
    showIn: ['branches', 'project'],
    when: '',
    openOutput: false,
    askFirst: false,
    disabled: false,
  };
}

/** What blocks Save, in the order the fields appear; null when the script can be saved. */
export function scriptProblem(s: ScriptConfig): string | null {
  if (!s.name.trim()) return 'Give the script a name';
  if (!s.command.trim()) return 'Give the script a command';
  if (s.showIn.length === 0) return 'Pick a menu under Show in';
  const ids = new Set<string>();
  for (const [i, input] of s.inputs.entries()) {
    if (!/^[A-Z0-9_]+$/.test(input.id)) return `Input ID “${input.id}” may only use A–Z, 0–9 and _`;
    if (ids.has(input.id)) return `Two inputs share the ID ${input.id}`;
    ids.add(input.id);
    if (input.type === 'select' && input.options.length === 0) return `Input ${input.id} needs at least one option`;
    const err = checkWhen(input.when, s.inputs.slice(0, i));
    if (err) return `Input ${input.id}: ${err}`;
  }
  return checkWhen(s.when);
}

/** An open popover; `input` is the input whose Show when gets the field (kind `inputWhen`). */
type Pop = { kind: 'icon' | 'name' | 'command' | 'when' | 'inputWhen'; rect: DOMRect; input?: number };

/** Flow N6: a new script, or an existing one. */
export function ScriptEditor({ script: initial, onClose }: { script: ScriptConfig; onClose: () => void }) {
  const [s, setS] = useState(initial);
  const [openInput, setOpenInput] = useState<number | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const commandGrow = useAutoGrow(commandRef, s.command);
  const whenRef = useRef<HTMLTextAreaElement>(null);
  const scan = useData((d) => d.scan);
  const entries = useMemo(() => Object.values(scan).flatMap((r) => r.active), [scan]);

  const set = (patch: Partial<ScriptConfig>) => {
    setSaveError(null);
    setS((x) => ({ ...x, ...patch }));
  };
  const setInput = (i: number, patch: Partial<ScriptInput>) =>
    set({ inputs: s.inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const reorder = useReorder(
    s.inputs.map((_, i) => String(i)),
    (ids) => {
      set({ inputs: ids.map((i) => s.inputs[Number(i)]) });
      setOpenInput(null);
    },
  );

  // Puts `text` at the cursor of `el` (whose value is `value`), then puts the cursor after it.
  const insertAt = (
    el: HTMLInputElement | HTMLTextAreaElement | null,
    value: string,
    text: string,
    apply: (v: string) => void,
  ) => {
    const a = el?.selectionStart ?? value.length;
    const b = el?.selectionEnd ?? value.length;
    apply(value.slice(0, a) + text + value.slice(b));
    setPop(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + text.length, a + text.length);
    });
  };
  const insert = (ref: RefObject<HTMLTextAreaElement | null>, key: 'command' | 'when', text: string) =>
    insertAt(ref.current, s[key], text, (v) => set({ [key]: v }));
  const inputWhenRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const addInput = () => {
    let n = s.inputs.length + 1;
    while (s.inputs.some((x) => x.id === `INPUT_${n}`)) n++;
    set({
      inputs: [
        ...s.inputs,
        { id: `INPUT_${n}`, label: 'Input', type: 'text', default: '', options: [], required: false, when: '' },
      ],
    });
    setOpenInput(s.inputs.length);
  };

  // Show when: the live result over the active branches of every repo.
  const whenError = checkWhen(s.when);
  const matches =
    whenError || !s.when.trim() ? [] : entries.filter((e) => evalWhen(s.when, branchContext(e, 'branches')));
  const names = matches.map((e) => e.branch ?? e.shortSha ?? '');
  const result = !s.when.trim()
    ? 'Always shown'
    : `Shows for ${matches.length} of ${entries.length} branches${
        names.length ? `: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}` : ''
      }`;

  const problem = scriptProblem(s);
  const save = async () => {
    if (problem) return;
    setBusy(true);
    try {
      await saveScript(s);
      onClose();
    } catch (e) {
      setSaveError((e as AppError).message);
      setBusy(false);
    }
  };
  const toggle = (kind: Pop['kind'], input?: number) => (e: MouseEvent<HTMLElement>) =>
    setPop(
      pop?.kind === kind && pop.input === input
        ? null
        : { kind, input, rect: e.currentTarget.getBoundingClientRect() },
    );
  const iconName = SCRIPT_ICONS.includes(s.icon) ? s.icon : 'prompt';

  return (
    <Modal aria-label={initial.id ? 'Edit Script' : 'New Script'} width={600} paddingTop={110} onClose={onClose}>
      <ModalHeader title={initial.id ? 'Edit Script' : 'New Script'} onClose={onClose} />
      <div className={styles.body}>
        <div className={styles.field}>
          <span className={styles.label}>Name</span>
          <Input
            ref={nameRef}
            size={36}
            aria-label="Name"
            value={s.name}
            autoFocus={!initial.id}
            placeholder="Run tests"
            onChange={(name) => set({ name })}
            leftText={
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={pop?.kind === 'icon'}
                aria-label={`Icon: ${iconName}`}
                title="Icon"
                className={pop?.kind === 'icon' ? `${styles.iconButton} ${styles.open}` : styles.iconButton}
                onClick={toggle('icon')}
              >
                <Icon name={iconName} size={15} />
                <ChevronDownIcon size={9} className={styles.muted} />
              </button>
            }
            rightText={
              <VariableButton
                open={pop?.kind === 'name'}
                title="Insert a Variable"
                className={styles.nameVar}
                onClick={toggle('name')}
              />
            }
          />
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor="script-command" className={styles.label}>
              Command
            </label>
          </div>
          <div className={styles.areaWrap}>
            <textarea
              id="script-command"
              ref={commandRef}
              rows={3}
              spellCheck={false}
              className={`${styles.area} ${styles.grow}`}
              {...commandGrow}
              value={s.command}
              placeholder="pnpm install --frozen-lockfile && pnpm test"
              onChange={(e) => set({ command: e.target.value })}
            />
            <VariableButton
              open={pop?.kind === 'command'}
              title="Insert a Variable"
              className={styles.corner}
              onClick={toggle('command')}
            />
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <span id="script-inputs" className={styles.label}>
              Inputs
            </span>
          </div>
          <ul ref={reorder.listRef} aria-labelledby="script-inputs" className={styles.card}>
            {reorder.order.map((key) => {
              const i = Number(key);
              const input = s.inputs[i];
              const open = openInput === i;
              const err = checkWhen(input.when, s.inputs.slice(0, i));
              return (
                <li
                  key={key}
                  data-reorder
                  className={reorder.dragId === key ? `${styles.input} ${styles.dragging}` : styles.input}
                >
                  <div className={styles.inputRow}>
                    <DragHandle aria-label={`Move ${input.label}`} {...reorder.handleProps(key)} />
                    <button
                      type="button"
                      aria-expanded={open}
                      className={styles.inputToggle}
                      onClick={() => setOpenInput(open ? null : i)}
                    >
                      <ChevronRightIcon className={open ? `${styles.chevron} ${styles.turned}` : styles.chevron} />
                      <span className={styles.typeChip}>{input.type}</span>
                      <span className={styles.inputLabel}>{input.label}</span>
                      <span className={styles.envName}>$GITGEL_INPUT_{input.id}</span>
                      {input.when.trim() && (
                        <Pill tone="neutral" size="sm">
                          when
                        </Pill>
                      )}
                    </button>
                    <IconButton
                      aria-label={`Remove ${input.label}`}
                      onClick={() => {
                        set({ inputs: s.inputs.filter((_, j) => j !== i) });
                        setOpenInput(null);
                      }}
                    >
                      <CloseIcon size={12} />
                    </IconButton>
                  </div>
                  {open && (
                    <div className={styles.inputGrid}>
                      <label className={styles.small}>
                        Label
                        <Input size={32} value={input.label} onChange={(label) => setInput(i, { label })} />
                      </label>
                      <label className={styles.small}>
                        ID
                        <Input
                          size={32}
                          mono
                          value={input.id}
                          onChange={(id) => setInput(i, { id: id.toUpperCase() })}
                          invalid={!/^[A-Z0-9_]+$/.test(input.id)}
                        />
                      </label>
                      <label className={styles.small}>
                        Type
                        <Select<ScriptInputType>
                          aria-label="Type"
                          size={32}
                          className={styles.full}
                          value={input.type}
                          options={TYPES}
                          onChange={(type) => setInput(i, { type, default: type === 'checkbox' ? '' : input.default })}
                        />
                      </label>
                      {input.type === 'checkbox' ? (
                        <div className={styles.small}>
                          Default
                          <Checkbox
                            label="Checked"
                            className={styles.defaultCheck}
                            checked={input.default === '1'}
                            onChange={(e) => setInput(i, { default: e.target.checked ? '1' : '' })}
                          />
                        </div>
                      ) : (
                        <label className={styles.small}>
                          Default
                          <Input
                            size={32}
                            mono={input.type === 'branch'}
                            value={input.default}
                            onChange={(v) => setInput(i, { default: v })}
                          />
                        </label>
                      )}
                      {input.type === 'select' && (
                        <label className={`${styles.small} ${styles.span}`}>
                          <span className={styles.labelRow}>
                            Options<span>One per line. 4 or fewer show as buttons.</span>
                          </span>
                          <OptionsField options={input.options} onChange={(options) => setInput(i, { options })} />
                        </label>
                      )}
                      <label className={`${styles.small} ${styles.span}`}>
                        <span className={styles.labelRow}>
                          Show when<span>Can use branch and the inputs above</span>
                        </span>
                        <span className={styles.areaWrap}>
                          <textarea
                            ref={(el) => {
                              inputWhenRefs.current[i] = el;
                            }}
                            rows={2}
                            spellCheck={false}
                            aria-invalid={!!err || undefined}
                            className={[styles.area, styles.areaSmall, styles.withCorner, err && styles.invalid]
                              .filter(Boolean)
                              .join(' ')}
                            placeholder="Always"
                            value={input.when}
                            onChange={(e) => setInput(i, { when: e.target.value })}
                          />
                          <VariableButton
                            open={pop?.kind === 'inputWhen' && pop.input === i}
                            title="Insert a Field"
                            className={styles.corner}
                            onClick={toggle('inputWhen', i)}
                          />
                        </span>
                      </label>
                      {input.when.trim() && (
                        <span className={[styles.result, err && styles.bad, styles.span].filter(Boolean).join(' ')}>
                          {err ? <InfoIcon size={13} /> : <CheckIcon size={13} className={styles.ok} />}
                          {err ?? 'Valid condition'}
                        </span>
                      )}
                      <Checkbox
                        label="Required"
                        className={styles.span}
                        checked={input.required}
                        onChange={(e) => setInput(i, { required: e.target.checked })}
                      />
                    </div>
                  )}
                </li>
              );
            })}
            <li className={styles.addRow}>
              <Button variant="link" onClick={addInput}>
                Add Input
              </Button>
            </li>
          </ul>
        </div>

        <div className={styles.columns}>
          <div role="radiogroup" aria-labelledby="script-runs-in" className={styles.choices}>
            <span id="script-runs-in" className={styles.label}>
              Runs in
            </span>
            {(
              [
                ['worktree', 'Worktree Folder', 'Hidden when the branch is not checked out'],
                ['repo', 'Repository Folder', 'Always available'],
              ] as const
            ).map(([value, label, note]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={s.runsIn === value}
                className={styles.radio}
                onClick={() => set({ runsIn: value })}
              >
                <span className={s.runsIn === value ? `${styles.dot} ${styles.dotOn}` : styles.dot} />
                <span className={styles.radioText}>
                  <span className={styles.strong}>{label}</span>
                  <span className={styles.hint}>{note}</span>
                </span>
              </button>
            ))}
          </div>
          <div role="group" aria-labelledby="script-show-in" className={styles.choices}>
            <span id="script-show-in" className={styles.label}>
              Show in
            </span>
            {(
              [
                ['branches', 'Branches Row Menu'],
                ['project', 'Project Entry Menu'],
              ] as const
            ).map(([menu, label]) => (
              <Checkbox
                key={menu}
                label={label}
                checked={s.showIn.includes(menu)}
                onChange={(e) =>
                  set({ showIn: e.target.checked ? [...s.showIn, menu] : s.showIn.filter((m) => m !== menu) })
                }
              />
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor="script-when" className={styles.label}>
              Show when
            </label>
            <span className={styles.hint}>A CEL expression. Empty shows it always.</span>
          </div>
          <div className={styles.areaWrap}>
            <textarea
              id="script-when"
              ref={whenRef}
              rows={2}
              spellCheck={false}
              aria-invalid={!!whenError || undefined}
              aria-describedby="script-when-result"
              className={whenError ? `${styles.area} ${styles.invalid}` : styles.area}
              value={s.when}
              placeholder="branch.ahead > 0 && !branch.merged"
              onChange={(e) => set({ when: e.target.value })}
            />
            <VariableButton
              open={pop?.kind === 'when'}
              title="Insert a Field"
              className={styles.corner}
              onClick={toggle('when')}
            />
          </div>
          <div id="script-when-result" className={whenError ? `${styles.result} ${styles.bad}` : styles.result}>
            {whenError ? (
              <InfoIcon size={13} />
            ) : (
              s.when.trim() && <CheckIcon size={13} className={styles.ok} />
            )}
            <span>{whenError ?? result}</span>
          </div>
        </div>

        <Checkbox
          card
          label="Open the output panel automatically"
          sub={
            'Every run shows a toast; click it for the output, to answer prompts or to stop the script. ' +
            'Turn this on to open the output as soon as it starts (long jobs, scripts that ask questions).'
          }
          checked={s.openOutput}
          onChange={(e) => set({ openOutput: e.target.checked })}
        />

        <Checkbox
          card
          label="Ask before running"
          sub={
            'Opens the run dialog first, even without inputs, so nothing runs on one click. ' +
            'Turn it on for scripts that change the branch (rebase, push, reset).'
          }
          checked={s.askFirst}
          onChange={(e) => set({ askFirst: e.target.checked })}
        />
      </div>
      <ModalFooter
        note={<span className={styles.problem}>{saveError ?? (s.name || s.command ? problem : null)}</span>}
      >
        <Button size={36} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size={36} disabled={!!problem || busy} onClick={() => void save()}>
          Save Script
        </Button>
      </ModalFooter>

      {pop?.kind === 'icon' && (
        <Popover anchorRect={pop.rect} width={264} onClose={() => setPop(null)}>
          <div role="listbox" aria-label="Icon" className={styles.iconPicker}>
            <span className={styles.pickerLabel}>Icon</span>
            <div className={styles.iconGrid}>
              {SCRIPT_ICONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={name === iconName}
                  aria-label={name}
                  title={name}
                  className={name === iconName ? `${styles.iconOption} ${styles.picked}` : styles.iconOption}
                  onClick={() => {
                    set({ icon: name });
                    setPop(null);
                  }}
                >
                  <Icon name={name} size={15} />
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
      {pop?.kind === 'name' && (
        <Popover anchorRect={pop.rect} width={280} alignRight onClose={() => setPop(null)}>
          <Menu aria-label="Insert a Variable" autoFocus>
            {NAME_VARIABLES.map(([name, note]) => (
              <MenuItem
                key={name}
                hint={note}
                onSelect={() => insertAt(nameRef.current, s.name, name, (v) => set({ name: v }))}
              >
                <span className={styles.varName}>{name}</span>
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      )}
      {pop?.kind === 'command' && (
        <Popover anchorRect={pop.rect} width={300} alignRight onClose={() => setPop(null)}>
          <Menu aria-label="Insert a Variable" autoFocus>
            {[
              ...VARIABLES,
              ...s.inputs.map((x): [string, string] => [`$GITGEL_INPUT_${x.id}`, `input · ${x.label}`]),
            ].map(([name, note]) => (
              <MenuItem key={name} hint={note} onSelect={() => insert(commandRef, 'command', name)}>
                <span className={styles.varName}>{name}</span>
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      )}
      {pop?.kind === 'when' && (
        <Popover anchorRect={pop.rect} width={320} alignRight onClose={() => setPop(null)}>
          <Menu aria-label="Insert a Field" autoFocus>
            {(Object.keys(BRANCH_FIELDS) as (keyof typeof BRANCH_FIELDS)[]).map((f) => (
              <MenuItem
                key={f}
                hint={FIELD_NOTES[f] ?? BRANCH_FIELDS[f]}
                onSelect={() => insert(whenRef, 'when', `branch.${f}`)}
              >
                <span className={styles.varName}>branch.{f}</span>
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      )}
      {pop?.kind === 'inputWhen' && pop.input !== undefined && s.inputs[pop.input] && (
        <Popover anchorRect={pop.rect} width={320} alignRight onClose={() => setPop(null)}>
          <Menu aria-label="Insert a Field" autoFocus>
            {[
              ...(Object.keys(BRANCH_FIELDS) as (keyof typeof BRANCH_FIELDS)[]).map((f): [string, string] => [
                `branch.${f}`,
                FIELD_NOTES[f] ?? BRANCH_FIELDS[f],
              ]),
              // Only the inputs above this one can be used.
              ...s.inputs
                .slice(0, pop.input)
                .map((x): [string, string] => [
                  `inputs.${x.id.toLowerCase()}`,
                  `${x.type === 'checkbox' ? 'bool' : 'string'} · ${x.label}`,
                ]),
            ].map(([name, note]) => {
              const at = pop.input!;
              return (
                <MenuItem
                  key={name}
                  hint={note}
                  onSelect={() =>
                    insertAt(inputWhenRefs.current[at], s.inputs[at].when, name, (when) => setInput(at, { when }))
                  }
                >
                  <span className={styles.varName}>{name}</span>
                </MenuItem>
              );
            })}
          </Menu>
        </Popover>
      )}
    </Modal>
  );
}

/** A select input's options, one per line. The text is kept as typed (blank lines included), so
 * Enter starts a new line; the options are its non-empty lines, trimmed. */
/** "Add Variable ▾": opens the menu of variables or fields to insert. */
function VariableButton({
  open,
  title,
  className,
  onClick,
}: {
  open: boolean;
  title: string;
  className: string;
  onClick: (e: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      title={title}
      className={open ? `${className} ${styles.open}` : className}
      onClick={onClick}
    >
      Add Variable
      <ChevronDownIcon size={9} />
    </button>
  );
}

function OptionsField({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [text, setText] = useState(() => options.join('\n'));
  return (
    <textarea
      rows={3}
      spellCheck={false}
      className={`${styles.area} ${styles.areaSmall}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split('\n')
            .map((o) => o.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}
