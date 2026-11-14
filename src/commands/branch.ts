// The open branch's commands (Review): what its menus offer, each only when it can run now.
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { entryFolder } from '../components/OpenItems';
import { t } from '../i18n';
import { openFolder } from '../lib/ipc';
import type { EntrySummary } from '../lib/types';
import { fillName, pickScript, useRuns } from '../scripts/runs';
import { branchScripts } from '../scripts/ScriptsMenu';
import type { ScriptMenuName } from '../scripts/when';
import { canCheckout, openCheckout } from '../sync/CheckoutBranch';
import { askDeleteBranch, canDeleteBranch } from '../sync/DeleteBranch';
import { askAbort, continueBlocked, continueOperation, operationTitle } from '../sync/operation';
import { fetchRepo, forcePushBranch, pullBranch, pushBranch, rebaseBase, rebaseOnBase, syncState } from '../sync/sync';
import { useData } from '../state/data';
import type { Command } from './registry';

export function branchCommands(entry: EntrySummary, menu: ScriptMenuName, project?: string): Command[] {
  const { config, scan, openApps } = useData.getState();
  const group = t('cmd.groupBranch');
  const running = Object.values(useRuns.getState().runs).some(
    (r) => r.status === 'running' && r.repoId === entry.repoId && r.scriptId.startsWith('git:'),
  );
  const list: Command[] = [];
  const add = (id: string, title: string, run: () => void) => list.push({ id: `branch:${id}`, title, group, run });

  const gone = entry.state === 'repo_missing' || entry.state === 'branch_deleted';
  if (!running && !gone) {
    const op = entry.operation;
    if (op) {
      const title = operationTitle(op);
      if (!continueBlocked(op))
        add('continue', t('sync.menuContinue', { title }), () => void continueOperation(entry, op));
      add('abort', t('sync.menuAbort', { title }), () => askAbort(entry, op));
    } else {
      if (canCheckout(entry))
        add('checkout', t('branches.checkoutMenu'), () =>
          openCheckout({ repoId: entry.repoId, branch: entry.branch ?? '', remote: false }),
        );
      const u = entry.upstream;
      if (entry.branch && u) {
        const st = syncState(entry);
        add('fetch', t('sync.fetchBtn'), () => void fetchRepo(entry));
        if (!st.pull) add('pull', t('sync.pullBtn'), () => void pullBranch(entry));
        if (st.diverged && !st.pull) add('pullRebase', t('history.pullRebase'), () => void pullBranch(entry, true));
        if (!st.push) add('push', t('sync.pushBtn'), () => void pushBranch(entry));
        if (st.diverged) add('forcePush', t('history.forcePush'), () => void forcePushBranch(entry));
        const base = rebaseBase(entry);
        if (base) add('rebase', t('sync.rebaseOn', { base }), () => void rebaseOnBase(entry, base));
      }
    }
  }

  const branch = entry.branch;
  if (branch !== null) add('copyName', t('common.copyBranchName'), () => void writeText(branch));
  const folder = entryFolder(entry, config);
  if (folder)
    for (const a of openApps.filter((x) => x.found))
      add(`open:${a.id}`, t('open.inApp', { app: a.name }), () => {
        openFolder(folder, a.id).catch((e) => console.error('cannot open folder', e));
      });
  for (const s of branchScripts(config?.scripts ?? [], entry, menu, project))
    add(`script:${s.id}`, fillName(s.name, entry), () => pickScript(s, entry, menu, project));

  const repoPath = config?.repos.find((r) => r.id === entry.repoId)?.path;
  if (!running && canDeleteBranch(entry, scan[entry.repoId]?.baseBranch ?? null, repoPath))
    add('delete', t('branches.deleteMenu'), () => askDeleteBranch(entry));
  return list;
}
