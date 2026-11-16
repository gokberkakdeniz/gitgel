import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Modal, ModalFooter, ModalHeader } from '../components/Modal';
import { t } from '../i18n';
import { cnt } from '../lib/format';
import { tildifyHome } from '../lib/paths';
import { useData } from '../state/data';
import { Choice } from '../sync/NewBranch';
import choiceStyles from '../sync/NewBranch.module.css';
import { applyStashes, byRepo, useStashUi } from './actions';
import styles from './StashDialog.module.css';
import { stashTargets } from './StashTargetMenu';

/** Apply / Pop (SPEC §15): asks which worktree `useStashUi.applying` goes into; the one its
 * branch is checked out in comes first and is picked. Stashes of several repositories (a project
 * review) get a list per repository. */
export function ApplyStashModal() {
  const ask = useStashUi((s) => s.applying);
  const scans = useData((s) => s.scan);
  // The picked worktree per repository; none yet, its first.
  const [picked, setPicked] = useState<Record<string, string>>({});
  useEffect(() => setPicked({}), [ask]);
  if (!ask) return null;
  const { stashes, pop } = ask;
  const [first] = stashes;
  const many = stashes.length > 1;
  const groups = byRepo(stashes).map((list) => {
    const targets = stashTargets(list[0], scans[list[0].repoId]?.active ?? []);
    return { list, targets, target: targets.find((e) => e.key === picked[list[0].repoId]) ?? targets[0] };
  });
  const ready = groups.every((g) => g.target);
  const close = () => useStashUi.setState({ applying: null });
  const run = async () => {
    if (!ready) return;
    close();
    for (const g of groups) await applyStashes(g.list, g.target, pop);
  };
  const title = many
    ? t(pop ? 'stash.popDialogN' : 'stash.applyDialogN', { ...cnt(stashes.length) })
    : t(pop ? 'stash.popDialog' : 'stash.applyDialog');
  const count = t('branches.subStashes', { ...cnt(stashes.length) });
  const sub = !many
    ? `stash@{${first.index}} · ${first.message}`
    : groups.length > 1
      ? count
      : `${first.repoName} · ${count}`;
  return (
    <Modal aria-label={title} width={480} paddingTop={160} onClose={close}>
      <ModalHeader title={title} sub={sub} subMono onClose={close} />
      <div className={`${styles.body} ${styles.groups}`}>
        {groups.map((g) => (
          <div key={g.list[0].repoId} className={styles.group}>
            {groups.length > 1 && <span className={choiceStyles.label}>{g.list[0].repoName}</span>}
            <div role="radiogroup" aria-label={g.list[0].repoName} className={choiceStyles.choices}>
              {g.targets.map((e) => (
                <Choice
                  key={e.key}
                  title={e.branch ?? e.shortSha ?? ''}
                  sub={tildifyHome(e.worktreePath ?? '')}
                  on={e === g.target}
                  onPick={() => setPicked((p) => ({ ...p, [g.list[0].repoId]: e.key }))}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <ModalFooter>
        <Button size={36} onClick={close}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size={36} kbd="↵" autoFocus disabled={!ready} onClick={() => void run()}>
          {t(pop ? 'stash.popBtn' : 'stash.applyBtn')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
