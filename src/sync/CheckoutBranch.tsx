// Checkout Branch (SPEC §15 "Checkout branch"): a git action from the branch menus, checking a
// branch that is checked out nowhere (or a remote branch, as a local one tracking it) out in one
// of its repo's worktrees, which switches to it (its uncommitted changes brought along or
// stashed), or in a new linked worktree.
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { MenuItem } from '../components/Menu';
import { Modal } from '../components/Modal';
import { t } from '../i18n';
import { cnt } from '../lib/format';
import { checkCheckout, gitCheckoutBranch } from '../lib/ipc';
import { basename, expandHome, tildifyHome } from '../lib/paths';
import type { AppError, CheckoutProblem, CheckoutTarget, EntrySummary, RepoScan } from '../lib/types';
import { startGitAction } from '../scripts/runs';
import { useData } from '../state/data';
import { defaultParent, folderName } from './branchDefaults';
import { Choice, SubChoice } from './NewBranch';
import nb from './NewBranch.module.css';
import styles from './CheckoutBranch.module.css';
import { useGitActionRunning } from './operation';

/** What the dialog checks out: a local branch, or with `remote` a remote-tracking branch
 * (`origin/feat`). */
interface Request {
  repoId: string;
  branch: string;
  remote: boolean;
}
const useCheckout = create<{ req: Request | null }>()(() => ({ req: null }));

/** Opens Checkout Branch: from a Remote Branches row's menu. */
export function openCheckout(req: Request) {
  useCheckout.setState({ req });
}

const PROBLEM: Record<CheckoutProblem, string> = {
  unavailable: 'branches.checkoutUnavailable',
  exists: 'branches.newExists',
  noWorktree: 'branches.checkoutNoWorktree',
  busy: 'branches.checkoutBusy',
  cannotBring: 'branches.newCannotBring',
  badFolder: 'branches.newBadFolder',
  folderNotEmpty: 'branches.newFolderNotEmpty',
};

const trimSlash = (p: string) => p.replace(/\/+$/, '');
/** The local branch a remote one becomes: its name after the remote (as Branches splits it). */
const localName = (r: Request) => (r.remote ? r.branch.slice(r.branch.indexOf('/') + 1) : r.branch);

/** A local branch that is there and checked out nowhere. */
export const canCheckout = (entry: EntrySummary) =>
  !!entry.branch &&
  !!entry.headSha &&
  !entry.worktreePath &&
  entry.state !== 'repo_missing' &&
  entry.state !== 'branch_deleted';

/** "Checkout Branch…", first in a branch menu's Sync group (`SyncItems`): a branch `canCheckout`
 * takes. Disabled while a git action runs in the repo. */
export function CheckoutBranchItem({ entry, onDone }: { entry: EntrySummary; onDone: () => void }) {
  const running = useGitActionRunning(entry.repoId);
  if (!canCheckout(entry)) return null;
  const branch = entry.branch ?? '';
  return (
    <MenuItem
      icon="worktree"
      disabled={running}
      title={running ? t('sync.gitBusy') : undefined}
      onSelect={() => {
        onDone();
        openCheckout({ repoId: entry.repoId, branch, remote: false });
      }}
    >
      {t('branches.checkoutMenu')}
    </MenuItem>
  );
}

/** Mounted once (App): the dialog for `useCheckout.req`. */
export function CheckoutBranchModal() {
  const req = useCheckout((s) => s.req);
  const scan = useData((s) => (req ? s.scan[req.repoId] : undefined));
  if (!req || !scan) return null;
  return (
    <CheckoutForm
      key={`${req.repoId}:${req.branch}`}
      req={req}
      scan={scan}
      onClose={() => useCheckout.setState({ req: null })}
    />
  );
}

type Pick = { kind: 'existing'; folder: string } | { kind: 'new' };

function CheckoutForm({ req, scan, onClose }: { req: Request; scan: RepoScan; onClose: () => void }) {
  const repoId = req.repoId;
  const branch = localName(req);
  // The repo's worktrees: the repository folder (listed first, then New worktree, in Settings'
  // order), then the linked ones by folder.
  const trees = useMemo(() => {
    const all = scan.active.filter((e): e is EntrySummary & { worktreePath: string } => !!e.worktreePath);
    const isMain = (e: EntrySummary) => trimSlash(e.worktreePath ?? '') === trimSlash(scan.repo.path);
    return [
      ...all.filter(isMain),
      ...all.filter((e) => !isMain(e)).sort((a, b) => a.worktreePath.localeCompare(b.worktreePath)),
    ];
  }, [scan]);
  const mainPath =
    trees[0] && trimSlash(trees[0].worktreePath) === trimSlash(scan.repo.path) ? trees[0].worktreePath : null;
  // Opens on Settings › Repositories' choice for new branches: a new worktree, else the
  // repository folder.
  const [pick, setPick] = useState<Pick>(() =>
    useData.getState().config?.settings.newBranchCheckout === 'worktree' || !mainPath
      ? { kind: 'new' }
      : { kind: 'existing', folder: mainPath },
  );
  const [bring, setBring] = useState(true);
  const [parent, setParent] = useState(() => defaultParent(scan.repo.path));
  // Typed by hand: it no longer follows Choose….
  const [typed, setTyped] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<CheckoutProblem | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const running = useGitActionRunning(repoId);

  const shown = typed ?? tildifyHome(`${parent}/${folderName(branch)}`);
  const newFolder = expandHome(shown.trim());
  useLayoutEffect(() => {
    const el = folderInput.current;
    if (el && document.activeElement !== el) el.scrollLeft = el.scrollWidth;
  }, [shown, pick]);
  const picked = pick.kind === 'existing' ? trees.find((e) => e.worktreePath === pick.folder) : undefined;
  const dirty = picked?.uncommitted ?? 0;
  const target = useMemo<CheckoutTarget>(
    () =>
      pick.kind === 'existing'
        ? { kind: 'existing', folder: pick.folder, bring: dirty === 0 || bring }
        : { kind: 'new', folder: newFolder },
    [pick, dirty, bring, newFolder],
  );

  // Checked as it is filled in, 150 ms after the last change.
  useEffect(() => {
    setError(null);
    setChecking(true);
    let live = true;
    const timer = setTimeout(() => {
      checkCheckout(repoId, req.branch, req.remote, target)
        .then((p) => live && setProblem(p))
        .catch(() => live && setProblem(null))
        .finally(() => live && setChecking(false));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repoId, req.branch, req.remote, target]);

  const canRun = !problem && !checking && !starting && !running && (target.kind === 'existing' || !!newFolder);
  const run = async () => {
    if (!canRun) return;
    setStarting(true);
    try {
      const started = await gitCheckoutBranch(repoId, req.branch, req.remote, target);
      onClose();
      void startGitAction(
        t('branches.actCheckout', { branch }),
        t('branches.checkingOut', { branch }),
        () => Promise.resolve(started),
        {
          done: t('branches.checkedOut', { branch }),
        },
      );
    } catch (err) {
      setError((err as AppError).message);
      setStarting(false);
    }
  };
  const choose = async () => {
    const chosen = await open({ directory: true, defaultPath: parent });
    if (typeof chosen === 'string') {
      setParent(chosen);
      setTyped(null);
    }
  };

  // A worktree's row: it switches to the branch; its changes come along or are stashed.
  const row = (e: (typeof trees)[number]) => {
    const isMain = e.worktreePath === mainPath;
    const on = pick.kind === 'existing' && pick.folder === e.worktreePath;
    const from = e.branch ?? e.shortSha ?? '';
    const n = e.uncommitted ?? 0;
    return (
      <Choice
        key={e.worktreePath}
        title={isMain ? t('branches.newSwitch') : basename(e.worktreePath)}
        tip={tildifyHome(e.worktreePath)}
        sub={`${from} →`}
        subTitle={t('branches.checkoutFrom', { branch: from })}
        on={on}
        more={n > 0}
        onPick={() => setPick({ kind: 'existing', folder: e.worktreePath })}
      >
        <div role="radiogroup" aria-label={t('branches.newChanges', { ...cnt(n) })} className={nb.changes}>
          <span className={nb.changesLabel}>{t('branches.newChanges', { ...cnt(n) })}</span>
          <SubChoice title={t('branches.checkoutBring', { branch })} on={bring} onPick={() => setBring(true)} />
          <SubChoice title={t('branches.newStash')} on={!bring} onPick={() => setBring(false)} />
        </div>
      </Choice>
    );
  };

  const message = error ?? (problem ? t(PROBLEM[problem], { branch, base: branch }) : null);
  return (
    <Modal aria-label={t('branches.checkoutTitle')} width={460} paddingTop={140} onClose={onClose}>
      <div
        className={styles.body}
        onKeyDown={(e) => {
          // Listed in lib/shortcuts.ts.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName !== 'BUTTON') {
            e.preventDefault();
            void run();
          }
        }}
      >
        <div className={styles.head}>
          <div className={styles.title}>{t('branches.checkoutTitle')}</div>
          <div className={styles.sub}>{`${scan.name} / ${req.branch}`}</div>
        </div>
        <div className={nb.field}>
          <span id="checkout-where" className={nb.label}>
            {t('branches.newCheckOut')}
          </span>
          <div role="radiogroup" aria-labelledby="checkout-where" className={`${nb.choices} ${styles.list}`}>
            {trees.slice(0, mainPath ? 1 : 0).map(row)}
            <Choice
              title={t('branches.newWorktree')}
              on={pick.kind === 'new'}
              more
              onPick={() => setPick({ kind: 'new' })}
            >
              <div className={nb.folderRow}>
                <Input
                  ref={folderInput}
                  size={32}
                  mono
                  leftIcon="folder"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={t('branches.newFolder')}
                  className={nb.folder}
                  invalid={problem === 'badFolder' || problem === 'folderNotEmpty'}
                  title={shown}
                  value={shown}
                  onChange={setTyped}
                  onBlur={(e) => (e.currentTarget.scrollLeft = e.currentTarget.scrollWidth)}
                />
                <Button onClick={() => void choose()}>{t('branches.newChoose')}</Button>
              </div>
            </Choice>
            {trees.slice(mainPath ? 1 : 0).map(row)}
          </div>
        </div>
        {message && <div className={nb.error}>{message}</div>}
        <div className={nb.actions}>
          <Button size={36} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size={36}
            kbd="↵"
            autoFocus
            disabled={!canRun}
            title={running ? t('sync.gitBusy') : undefined}
            onClick={() => void run()}
          >
            {t('branches.checkoutBtn')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
