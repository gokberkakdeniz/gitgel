// New Branch (SPEC §15 "New branch"): a git action from a Branches repo band's "+", making a
// branch from a base, checked out in a new linked worktree, in the repository folder (its
// uncommitted changes brought along or stashed) or not at all.
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { CheckIcon, ChevronDownIcon, Icon, PlusIcon } from '../components/icons';
import { Input } from '../components/Input';
import { Popover } from '../components/Popover';
import { t } from '../i18n';
import { cnt } from '../lib/format';
import { checkNewBranch, gitCreateBranch, setBranchBase } from '../lib/ipc';
import { expandHome, tildifyHome } from '../lib/paths';
import type { AppError, NewBranchCheckout, NewBranchProblem, RepoScan } from '../lib/types';
import { startGitAction, useRuns } from '../scripts/runs';
import { baseChoices, defaultParent, folderName } from './branchDefaults';
import styles from './NewBranch.module.css';
import { useData } from '../state/data';
import { useGitActionRunning } from './operation';

const PROBLEM: Record<NewBranchProblem, string> = {
  badName: 'branches.newBadName',
  exists: 'branches.newExists',
  badFolder: 'branches.newBadFolder',
  folderNotEmpty: 'branches.newFolderNotEmpty',
  mainBusy: 'branches.newMainBusy',
  cannotBring: 'branches.newCannotBring',
};

type Where = NewBranchCheckout['kind'];
const trimSlash = (p: string) => p.replace(/\/+$/, '');

/** The band's "+": opens the New Branch form under it. Disabled while a git action runs. */
export function NewBranchButton({ scan, className }: { scan: RepoScan; className?: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const running = useGitActionRunning(scan.repo.id);
  return (
    <>
      <IconButton
        size={24}
        aria-label={t('branches.newBranchIn', { repo: scan.name })}
        title={running ? t('sync.gitBusy') : t('branches.newBranchIn', { repo: scan.name })}
        disabled={running}
        aria-haspopup="dialog"
        aria-expanded={!!rect}
        className={className}
        onClick={(e) => setRect(e.currentTarget.getBoundingClientRect())}
      >
        <PlusIcon size={13} />
      </IconButton>
      {rect && <NewBranchForm scan={scan} anchorRect={rect} onClose={() => setRect(null)} />}
    </>
  );
}

function NewBranchForm({ scan, anchorRect, onClose }: { scan: RepoScan; anchorRect: DOMRect; onClose: () => void }) {
  const repoId = scan.repo.id;
  const bases = useMemo(() => baseChoices(scan), [scan]);
  const [name, setName] = useState('');
  const [base, setBase] = useState(bases[0] ?? '');
  // Check out, in Settings' order: the repository folder (its changes brought along or stashed),
  // a new worktree or the branch only; it opens on Settings › Repositories' choice.
  const [where, setWhere] = useState<Where>(() => useData.getState().config?.settings.newBranchCheckout ?? 'main');
  const [bring, setBring] = useState(true);
  const [parent, setParent] = useState(() => defaultParent(scan.repo.path));
  // Typed by hand: it no longer follows the name.
  const [typed, setTyped] = useState<string | null>(null);
  // The folder's end (the branch's folder) stays in view while it is not being edited.
  const folderInput = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<NewBranchProblem | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const running = useGitActionRunning(repoId);

  const branch = name.trim();
  const shown = typed ?? tildifyHome(`${parent}/${folderName(name)}`);
  const folder = expandHome(shown.trim());
  useLayoutEffect(() => {
    const el = folderInput.current;
    if (el && document.activeElement !== el) el.scrollLeft = el.scrollWidth;
  }, [shown, where]);
  // The repository folder: what it has checked out now, and its uncommitted changes (they come
  // along or are stashed).
  const main = useMemo(
    () => scan.active.find((e) => e.worktreePath && trimSlash(e.worktreePath) === trimSlash(scan.repo.path)),
    [scan],
  );
  const dirty = main?.uncommitted ?? 0;
  // What it switches from.
  const from = main ? (main.branch ?? main.shortSha) : null;
  const checkout = useMemo<NewBranchCheckout>(
    () =>
      where === 'worktree'
        ? { kind: 'worktree', folder }
        : where === 'main'
          ? { kind: 'main', bring: dirty === 0 || bring }
          : { kind: 'none' },
    [where, folder, dirty, bring],
  );

  // Checked as it is typed, 150 ms after the last change.
  useEffect(() => {
    setError(null);
    if (!branch) {
      setProblem(null);
      return;
    }
    setChecking(true);
    let live = true;
    const timer = setTimeout(() => {
      checkNewBranch(repoId, branch, base, checkout)
        .then((p) => live && setProblem(p))
        .catch(() => live && setProblem(null))
        .finally(() => live && setChecking(false));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repoId, branch, base, checkout]);

  const canCreate =
    !!branch && !!base && !problem && !checking && !starting && !running && (where !== 'worktree' || !!folder);
  const create = async () => {
    if (!canCreate) return;
    setStarting(true);
    try {
      const run = await gitCreateBranch(repoId, branch, base, checkout);
      onClose();
      void startGitAction(t('branches.actCreate', { branch }), t('branches.creating', { branch }), () => Promise.resolve(run), {
        done: t('branches.created', { branch }),
        // A base other than the repo's default is stored for the branch once it exists.
        onStart: (runId) => {
          if (base === scan.defaultBase) return;
          const ended = () => {
            const r = useRuns.getState().runs[runId];
            if (!r || r.status === 'running') return false;
            if (r.status === 'exited' && r.exitCode === 0) void setBranchBase(`${repoId}:${branch}`, base);
            return true;
          };
          if (ended()) return;
          const off = useRuns.subscribe(() => ended() && off());
        },
      });
    } catch (err) {
      setError((err as AppError).message);
      setStarting(false);
    }
  };
  const choose = async () => {
    const picked = await open({ directory: true, defaultPath: parent });
    if (typeof picked === 'string') {
      setParent(picked);
      setTyped(null);
    }
  };

  const message = error ?? (problem ? t(PROBLEM[problem], { branch, base }) : null);
  const nameInvalid = problem === 'badName' || problem === 'exists';
  return (
    <Popover anchorRect={anchorRect} width={400} alignRight onClose={onClose}>
      <div
        role="dialog"
        aria-label={t('branches.newBranch')}
        className={styles.form}
        onKeyDown={(e) => {
          // Listed in lib/shortcuts.ts.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox') {
            e.preventDefault();
            void create();
          }
        }}
      >
        <div className={styles.head}>
          <span className={styles.title}>{t('branches.newBranch')}</span>
          <span className={styles.repo}>{scan.name}</span>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-branch-name">
            {t('branches.newName')}
          </label>
          <Input id="new-branch-name" size={32} mono autoFocus spellCheck={false} autoComplete="off" invalid={nameInvalid} value={name} onChange={setName} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-branch-base">
            {t('branches.newBase')}
          </label>
          <BasePicker id="new-branch-base" bases={bases} value={base} onChange={setBase} />
        </div>
        <div className={styles.field}>
          <span id="new-branch-checkout" className={styles.label}>
            {t('branches.newCheckOut')}
          </span>
          <div role="radiogroup" aria-labelledby="new-branch-checkout" className={styles.choices}>
            <Choice
              title={t('branches.newSwitch')}
              sub={from ? `${from} →` : undefined}
              subTitle={from ? t('branches.newSwitchFrom', { branch: from }) : undefined}
              on={where === 'main'}
              more={dirty > 0}
              onPick={() => setWhere('main')}
            >
              <div role="radiogroup" aria-label={t('branches.newChanges', { ...cnt(dirty) })} className={styles.changes}>
                <span className={styles.changesLabel}>{t('branches.newChanges', { ...cnt(dirty) })}</span>
                <SubChoice title={t('branches.newBring')} on={bring} onPick={() => setBring(true)} />
                <SubChoice title={t('branches.newStash')} on={!bring} onPick={() => setBring(false)} />
              </div>
            </Choice>
            <Choice
              title={t('branches.newWorktree')}
              on={where === 'worktree'}
              more
              onPick={() => setWhere('worktree')}
            >
              <div className={styles.folderRow}>
                <Input
                  ref={folderInput}
                  size={32}
                  mono
                  leftIcon="folder"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={t('branches.newFolder')}
                  className={styles.folder}
                  invalid={problem === 'badFolder' || problem === 'folderNotEmpty'}
                  title={shown}
                  value={shown}
                  onChange={setTyped}
                  onBlur={(e) => (e.currentTarget.scrollLeft = e.currentTarget.scrollWidth)}
                />
                <Button onClick={() => void choose()}>{t('branches.newChoose')}</Button>
              </div>
            </Choice>
            <Choice title={t('branches.newBranchOnly')} on={where === 'none'} onPick={() => setWhere('none')} />
          </div>
        </div>
        {message && <div className={styles.error}>{message}</div>}
        <div className={styles.actions}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            kbd="↵"
            disabled={!canCreate}
            title={running ? t('sync.gitBusy') : undefined}
            onClick={() => void create()}
          >
            {t('branches.newBtn')}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

/** A row of the Check out list: a box (checked when picked), the title and a mono note. A
 * picked row with `more` opens its `children` under it, and its chevron turns down. Checkout
 * Branch's list too. Long titles and notes cut from the middle (`MiddleCut`). */
export function Choice({
  title,
  tip,
  sub,
  subTitle,
  on,
  more,
  onPick,
  children,
}: {
  title: string;
  /** The row's tooltip. */
  tip?: string;
  /** Mono 11 muted, on the right (before the chevron). */
  sub?: string;
  subTitle?: string;
  on: boolean;
  more?: boolean;
  onPick: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={on ? `${styles.choice} ${styles.choiceOn}` : styles.choice}>
      <button
        type="button"
        role="radio"
        aria-checked={on}
        aria-expanded={more ? on : undefined}
        className={styles.choiceRow}
        title={tip}
        onClick={onPick}
      >
        <span className={on ? `${styles.box} ${styles.boxOn}` : styles.box}>{on && <CheckIcon size={10} />}</span>
        <span className={styles.choiceText}>
          <span className={styles.choiceTitle}>
            <MiddleCut text={title} tail={10} />
          </span>
          {sub && (
            <span className={styles.choiceSub} title={subTitle}>
              <MiddleCut text={sub} tail={6} />
            </span>
          )}
        </span>
        {more && <ChevronDownIcon size={12} className={on ? styles.chevron : `${styles.chevron} ${styles.chevronShut}`} />}
      </button>
      {on && more && <div className={styles.choiceMore}>{children}</div>}
    </div>
  );
}

/** One of the picked row's own options (Bring / Stash): a smaller row with the same box.
 * A long title cuts from the middle; the tooltip keeps the full text. */
export function SubChoice({ title, on, onPick }: { title: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} title={title} className={styles.subChoice} onClick={onPick}>
      <span className={on ? `${styles.box} ${styles.boxOn}` : styles.box}>{on && <CheckIcon size={10} />}</span>
      <span className={styles.choiceTitle}>
        <MiddleCut text={title} tail={10} />
      </span>
    </button>
  );
}

/** Long text cut from the middle: the start and the last `tail` characters stay visible, the
 * cut between them gets an ellipsis. Text that fits renders unchanged. */
export function MiddleCut({ text, tail = 8 }: { text: string; tail?: number }) {
  const head = text.length > tail ? text.slice(0, text.length - tail) : text;
  const end = text.length > tail ? text.slice(text.length - tail) : '';
  return (
    <>
      <span className={styles.cutStart}>{head}</span>
      {end && <span className={styles.cutEnd}>{end}</span>}
    </>
  );
}

/** The base: a field that opens a filtered list of `bases` under it (the check on the one in
 * use; ↑ / ↓ and ↵ pick). Not a native select, whose menu macOS places over the field. */
function BasePicker({
  id,
  bases,
  value,
  onChange,
}: {
  id: string;
  bases: string[];
  value: string;
  onChange: (base: string) => void;
}) {
  const field = useRef<HTMLButtonElement>(null);
  // A press on the field while the list is open closes it (as a press outside), and the click
  // that follows must not open it again.
  const wasOpen = useRef(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = bases.filter((b) => words.every((w) => b.toLowerCase().includes(w)));
  const [active, setActive] = useState(0);
  const close = () => {
    setRect(null);
    setQuery('');
    field.current?.focus();
  };
  const pick = (b: string) => {
    onChange(b);
    close();
  };
  return (
    <>
      <button
        ref={field}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={!!rect}
        className={rect ? `${styles.baseField} ${styles.baseOpen}` : styles.baseField}
        onMouseDown={() => {
          wasOpen.current = !!rect;
        }}
        onClick={(e) => {
          if (wasOpen.current) {
            wasOpen.current = false;
            return;
          }
          setActive(Math.max(0, bases.indexOf(value)));
          setRect(e.currentTarget.getBoundingClientRect());
        }}
      >
        <Icon name="branch" size={14} className={styles.baseIcon} />
        <span className={styles.baseValue}>{value}</span>
        <ChevronDownIcon size={12} className={styles.baseIcon} />
      </button>
      {rect && (
        <Popover anchorRect={rect} width={rect.width} onClose={close}>
          <div role="listbox" aria-label={t('branches.newBase')} className={styles.picker}>
            <div className={styles.pickerFilter}>
              <Input
                autoFocus
                leftIcon="search"
                mono
                clearable
                size={28}
                aria-label={t('project.searchBranches')}
                placeholder={t('sidebar.search')}
                value={query}
                onChange={(q) => {
                  setQuery(q);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (rows.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
                  } else if (e.key === 'Enter') {
                    // Not the form's ↵ (the event bubbles to it through the portal).
                    e.preventDefault();
                    e.stopPropagation();
                    if (rows[active]) pick(rows[active]);
                  }
                }}
              />
            </div>
            <div className={styles.pickerList}>
              {rows.map((b, i) => (
                <button
                  key={b}
                  type="button"
                  role="option"
                  aria-selected={b === value}
                  className={i === active ? `${styles.pickerRow} ${styles.pickerActive}` : styles.pickerRow}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(b)}
                >
                  <span className={b === value ? styles.pickerCheck : `${styles.pickerCheck} ${styles.hidden}`}>
                    <CheckIcon />
                  </span>
                  <span className={styles.pickerName}>{b}</span>
                </button>
              ))}
              {rows.length === 0 && <div className={styles.pickerEmpty}>{t('base.noMatch')}</div>}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
