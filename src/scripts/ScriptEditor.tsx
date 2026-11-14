import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { IconButton } from '../components/IconButton';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  HelpIcon,
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
import { cnt } from '../lib/format';
import { t } from '../i18n';
import { middleCut } from '../screens/Branches/rows';
import { openRemoteLink, saveScript } from '../lib/ipc';
import { useAutoGrow } from '../lib/useAutoGrow';
import type { AppError, ScriptConfig, ScriptInput, ScriptInputType } from '../lib/types';
import { useData } from '../state/data';
import { DragHandle } from './DragHandle';
import { useReorder } from './useReorder';
import { BRANCH_FIELDS, branchContext, checkWhen, evalWhen } from './when';
import styles from './ScriptEditor.module.css';

/** The CEL language definition, behind Show when's "CEL Syntax" link. */
const CEL_SYNTAX = 'https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md';

/** The icons offered for a script (a part of the Icon set). */
const SCRIPT_ICONS: IconName[] = [
  'play',
  'prompt',
  'test',
  'pull-request',
  'rebase',
  'link',
  'upload',
  'download',
  'refresh',
  'undo',
  'code',
  'package',
  'rocket',
  'bug',
  'search',
  'copy',
  'folder',
  'bolt',
];

const TYPES: { value: ScriptInputType; label: string }[] = [
  { value: 'text', label: 'scripts.typeText' },
  { value: 'textarea', label: 'scripts.typeLong' },
  { value: 'checkbox', label: 'scripts.typeCheck' },
  { value: 'select', label: 'scripts.typeSelect' },
  { value: 'branch', label: 'scripts.typeBranch' },
];

const VARIABLES: [string, string][] = [
  ['$GITGEL_BRANCH', 'scripts.varBranch'],
  ['$GITGEL_BASE', 'scripts.varBase'],
  ['$GITGEL_WORKTREE', 'scripts.varWorktree'],
  ['$GITGEL_REPO', 'scripts.varRepo'],
  ['$GITGEL_REPO_NAME', 'scripts.varRepoName'],
  ['$GITGEL_PROJECT', 'scripts.varProject'],
  ['$GITGEL_HEAD', 'scripts.varHead'],
];

/** What the name can hold; filled in on the menu. */
const NAME_VARIABLES: [string, string][] = [
  ['{branch}', 'scripts.varBranch'],
  ['{base}', 'scripts.varBase'],
  ['{repo}', 'scripts.varRepoName'],
];

const FIELD_NOTES: Partial<Record<keyof typeof BRANCH_FIELDS, string>> = {
  project: 'scripts.fieldProject',
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
  if (!s.name.trim()) return t('scripts.needName');
  if (!s.command.trim()) return t('scripts.needCommand');
  if (s.showIn.length === 0) return t('scripts.needMenu');
  const ids = new Set<string>();
  for (const [i, input] of s.inputs.entries()) {
    if (!/^[A-Z0-9_]+$/.test(input.id)) return t('scripts.badId', { id: input.id });
    if (ids.has(input.id)) return t('scripts.dupId', { id: input.id });
    ids.add(input.id);
    if (input.type === 'select' && input.options.length === 0) return t('scripts.needOption', { id: input.id });
    const err = checkWhen(input.when, s.inputs.slice(0, i));
    if (err) return t('scripts.inputErr', { id: input.id, err });
  }
  return checkWhen(s.when);
}

/** Show when's live result, "Matches N branches", with a ? that lists them on hover or focus,
 * under the ? and as wide as the field. */
function MatchCount({
  names,
  fieldRef,
}: {
  names: { repo: string; branch: string }[];
  fieldRef: RefObject<HTMLElement | null>;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const closing = useRef<number | undefined>(undefined);
  const open = (el: Element) => {
    window.clearTimeout(closing.current);
    const r = el.getBoundingClientRect();
    const field = fieldRef.current?.getBoundingClientRect();
    setRect(field ? new DOMRect(field.left, r.top, field.width, r.height) : r);
  };
  // A short delay, so the pointer can move from the ? into the list.
  const close = () => {
    window.clearTimeout(closing.current);
    closing.current = window.setTimeout(() => setRect(null), 150);
  };
  useEffect(() => () => window.clearTimeout(closing.current), []);
  return (
    <>
      <span>{t('scripts.matchCount', { ...cnt(names.length) })}</span>
      {names.length > 0 && (
        <button
          type="button"
          aria-label={t('scripts.showMatches')}
          aria-expanded={!!rect}
          className={styles.matchHelp}
          onMouseEnter={(e) => open(e.currentTarget)}
          onMouseLeave={close}
          onFocus={(e) => open(e.currentTarget)}
          onBlur={close}
        >
          <HelpIcon size={13} />
        </button>
      )}
      {rect && (
        <Popover anchorRect={rect} width={rect.width} onClose={() => setRect(null)}>
          <ul
            aria-label={t('scripts.matchingBranches')}
            className={styles.matchList}
            onMouseEnter={() => window.clearTimeout(closing.current)}
            onMouseLeave={close}
          >
            {names.map(({ repo, branch }) => {
              const [head, tail] = middleCut(branch);
              return (
                <li key={`${repo}\0${branch}`} title={`${repo} · ${branch}`} className={styles.matchItem}>
                  <span className={styles.matchRepo}>{repo}</span>
                  <span className={styles.matchDot}>·</span>
                  <span className={styles.matchHead}>{head}</span>
                  <span className={styles.matchTail}>{tail}</span>
                </li>
              );
            })}
          </ul>
        </Popover>
      )}
    </>
  );
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
        {
          id: `INPUT_${n}`,
          label: t('scripts.inputDefault'),
          type: 'text',
          default: '',
          options: [],
          required: false,
          when: '',
        },
      ],
    });
    setOpenInput(s.inputs.length);
  };

  // Show when: the live result over the active branches of every repo.
  const whenError = checkWhen(s.when);
  const matches =
    whenError || !s.when.trim() ? [] : entries.filter((e) => evalWhen(s.when, branchContext(e, 'branches')));
  const names = matches.map((e) => ({ repo: e.repoName, branch: e.branch ?? e.shortSha ?? '' }));

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
      pop?.kind === kind && pop.input === input ? null : { kind, input, rect: e.currentTarget.getBoundingClientRect() },
    );
  const iconName = SCRIPT_ICONS.includes(s.icon) ? s.icon : 'prompt';

  return (
    <Modal
      aria-label={t(initial.id ? 'scripts.editScript' : 'scripts.newScript')}
      width={600}
      paddingTop={110}
      onClose={onClose}
    >
      <ModalHeader title={t(initial.id ? 'scripts.editScript' : 'scripts.newScript')} onClose={onClose} />
      <div className={styles.body}>
        <div className={styles.field}>
          <span className={styles.label}>{t('scripts.nameLabel')}</span>
          <Input
            ref={nameRef}
            size={36}
            aria-label={t('scripts.nameLabel')}
            value={s.name}
            autoFocus={!initial.id}
            placeholder={t('scripts.namePh')}
            onChange={(name) => set({ name })}
            leftText={
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={pop?.kind === 'icon'}
                aria-label={t('scripts.iconName', { name: iconName })}
                title={t('scripts.iconTitle')}
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
                title={t('scripts.insertVar')}
                className={styles.nameVar}
                onClick={toggle('name')}
              />
            }
          />
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor="script-command" className={styles.label}>
              {t('scripts.commandLabel')}
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
              placeholder={t('scripts.commandPh')}
              onChange={(e) => set({ command: e.target.value })}
            />
            <VariableButton
              open={pop?.kind === 'command'}
              title={t('scripts.insertVar')}
              className={styles.corner}
              onClick={toggle('command')}
            />
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <span id="script-inputs" className={styles.label}>
              {t('scripts.inputsLabel')}
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
                  data-drop-before={reorder.dropBefore(key) || undefined}
                  data-drop-after={reorder.dropAfter(key) || undefined}
                  style={reorder.rowStyle(key)}
                  className={reorder.dragId === key ? `${styles.input} ${styles.dragging}` : styles.input}
                >
                  <div className={styles.inputRow}>
                    <DragHandle
                      aria-label={t('scripts.moveInput', { name: input.label })}
                      {...reorder.handleProps(key)}
                    />
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
                      aria-label={t('scripts.removeInput', { name: input.label })}
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
                        {t('scripts.fLabel')}
                        <Input size={32} value={input.label} onChange={(label) => setInput(i, { label })} />
                      </label>
                      <label className={styles.small}>
                        {t('scripts.fId')}
                        <Input
                          size={32}
                          mono
                          value={input.id}
                          onChange={(id) => setInput(i, { id: id.toUpperCase() })}
                          invalid={!/^[A-Z0-9_]+$/.test(input.id)}
                        />
                      </label>
                      <label className={styles.small}>
                        {t('scripts.fType')}
                        <Select<ScriptInputType>
                          aria-label={t('scripts.fType')}
                          size={32}
                          className={styles.full}
                          value={input.type}
                          options={TYPES.map(({ value, label }) => ({ value, label: t(label) }))}
                          onChange={(type) => setInput(i, { type, default: type === 'checkbox' ? '' : input.default })}
                        />
                      </label>
                      {input.type === 'checkbox' ? (
                        <div className={styles.small}>
                          {t('scripts.fDefault')}
                          <Checkbox
                            label={t('scripts.checked')}
                            className={styles.defaultCheck}
                            checked={input.default === '1'}
                            onChange={(e) => setInput(i, { default: e.target.checked ? '1' : '' })}
                          />
                        </div>
                      ) : (
                        <label className={styles.small}>
                          {t('scripts.fDefault')}
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
                            {t('scripts.optionsLabel')}
                            <span>{t('scripts.optionsHint')}</span>
                          </span>
                          <OptionsField options={input.options} onChange={(options) => setInput(i, { options })} />
                        </label>
                      )}
                      <label className={`${styles.small} ${styles.span}`}>
                        <span className={styles.labelRow}>
                          {t('scripts.showWhen')}
                          <span>{t('scripts.showWhenHint')}</span>
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
                            placeholder={t('scripts.alwaysPh')}
                            value={input.when}
                            onChange={(e) => setInput(i, { when: e.target.value })}
                          />
                          <VariableButton
                            open={pop?.kind === 'inputWhen' && pop.input === i}
                            title={t('scripts.insertField')}
                            className={styles.corner}
                            onClick={toggle('inputWhen', i)}
                          />
                        </span>
                      </label>
                      {input.when.trim() && (
                        <span className={[styles.result, err && styles.bad, styles.span].filter(Boolean).join(' ')}>
                          {err ? <InfoIcon size={13} /> : <CheckIcon size={13} className={styles.ok} />}
                          {err ?? t('scripts.validCond')}
                        </span>
                      )}
                      <Checkbox
                        label={t('scripts.required')}
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
                {t('scripts.addInput')}
              </Button>
            </li>
          </ul>
        </div>

        <div className={styles.columns}>
          <div role="radiogroup" aria-labelledby="script-runs-in" className={styles.choices}>
            <span id="script-runs-in" className={styles.label}>
              {t('scripts.runsIn')}
            </span>
            {(
              [
                ['worktree', 'scripts.runsWorktree', 'scripts.runsWorktreeHint'],
                ['repo', 'scripts.runsRepo', 'scripts.runsRepoHint'],
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
                  <span className={styles.strong}>{t(label)}</span>
                  <span className={styles.hint}>{t(note)}</span>
                </span>
              </button>
            ))}
          </div>
          <div role="group" aria-labelledby="script-show-in" className={styles.choices}>
            <span id="script-show-in" className={styles.label}>
              {t('scripts.showIn')}
            </span>
            {(
              [
                ['branches', 'scripts.showBranches'],
                ['project', 'scripts.showProject'],
              ] as const
            ).map(([menu, label]) => (
              <Checkbox
                key={menu}
                label={t(label)}
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
              {t('scripts.showWhen')}
            </label>
            <button
              type="button"
              className={styles.hintLink}
              onClick={() => void openRemoteLink(CEL_SYNTAX).catch((e) => console.error('cannot open link', e))}
            >
              {t('scripts.celSyntax')}
            </button>
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
              placeholder={t('scripts.whenPh')}
              onChange={(e) => set({ when: e.target.value })}
            />
            <VariableButton
              open={pop?.kind === 'when'}
              title={t('scripts.insertField')}
              className={styles.corner}
              onClick={toggle('when')}
            />
          </div>
          <div id="script-when-result" className={whenError ? `${styles.result} ${styles.bad}` : styles.result}>
            {whenError ? <InfoIcon size={13} /> : s.when.trim() && <CheckIcon size={13} className={styles.ok} />}
            {whenError ? (
              <span>{whenError}</span>
            ) : s.when.trim() ? (
              <MatchCount names={names} fieldRef={whenRef} />
            ) : (
              <span>{t('scripts.alwaysShown')}</span>
            )}
          </div>
        </div>

        <Checkbox
          label={t('scripts.openOutput')}
          checked={s.openOutput}
          onChange={(e) => set({ openOutput: e.target.checked })}
        />

        <Checkbox
          label={t('scripts.askFirst')}
          checked={s.askFirst}
          onChange={(e) => set({ askFirst: e.target.checked })}
        />
      </div>
      <ModalFooter note={<span className={styles.problem}>{saveError ?? (s.name || s.command ? problem : null)}</span>}>
        <Button size={36} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size={36} disabled={!!problem || busy} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </ModalFooter>

      {pop?.kind === 'icon' && (
        <Popover anchorRect={pop.rect} width={264} onClose={() => setPop(null)}>
          <div role="listbox" aria-label={t('scripts.iconTitle')} className={styles.iconPicker}>
            <span className={styles.pickerLabel}>{t('scripts.iconTitle')}</span>
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
          <Menu aria-label={t('scripts.insertVar')} autoFocus>
            {NAME_VARIABLES.map(([name, note]) => (
              <MenuItem
                key={name}
                hint={t(note)}
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
          <Menu aria-label={t('scripts.insertVar')} autoFocus>
            {[
              ...VARIABLES.map(([name, note]): [string, string] => [name, t(note)]),
              ...s.inputs.map((x): [string, string] => [
                `$GITGEL_INPUT_${x.id}`,
                t('scripts.varInput', { label: x.label }),
              ]),
            ].map(([name, hint]) => (
              <MenuItem key={name} hint={hint} onSelect={() => insert(commandRef, 'command', name)}>
                <span className={styles.varName}>{name}</span>
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      )}
      {pop?.kind === 'when' && (
        <Popover anchorRect={pop.rect} width={320} alignRight onClose={() => setPop(null)}>
          <Menu aria-label={t('scripts.insertField')} autoFocus>
            {(Object.keys(BRANCH_FIELDS) as (keyof typeof BRANCH_FIELDS)[]).map((f) => (
              <MenuItem
                key={f}
                hint={f === 'project' ? t('scripts.fieldProject') : (FIELD_NOTES[f] ?? BRANCH_FIELDS[f])}
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
          <Menu aria-label={t('scripts.insertField')} autoFocus>
            {[
              ...(Object.keys(BRANCH_FIELDS) as (keyof typeof BRANCH_FIELDS)[]).map((f): [string, string] => [
                `branch.${f}`,
                f === 'project' ? t('scripts.fieldProject') : (FIELD_NOTES[f] ?? BRANCH_FIELDS[f]),
              ]),
              // Only the inputs above this one can be used.
              ...s.inputs
                .slice(0, pop.input)
                .map((x): [string, string] => [
                  `inputs.${x.id.toLowerCase()}`,
                  t(x.type === 'checkbox' ? 'scripts.varBool' : 'scripts.varString', { label: x.label }),
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
      {t('scripts.addVariable')}
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
