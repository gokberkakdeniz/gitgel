import { useRef, useState } from 'react';
import editable from '../../components/EditableTitle.module.css';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { ProjectNameInput } from '../../components/ProjectNameInput';
import { t } from '../../i18n';
import { cnt } from '../../lib/format';
import { basename, tildifyHome } from '../../lib/paths';
import type { EntrySummary, ReviewTarget } from '../../lib/types';
import { useData } from '../../state/data';
import { useNav } from '../../state/nav';
import type { ReviewStash } from './stashes';

/** Back to the project page when Review was opened from it, else to it. */
export function editProject(projectId: string) {
  const nav = useNav.getState();
  const prev = nav.stack[nav.index - 1];
  if (prev?.name === 'project' && prev.projectId === projectId) nav.back();
  else nav.push({ name: 'project', projectId });
}

/** Review's page header: the project's name (renamed in place), "Review" for a branch, or
 * "Stashes" for a repository's stash stack, with the subtitle of each (SPEC §5). */
export function ReviewHeader({
  entry,
  target,
  backLabel,
  stashes,
  children,
}: {
  entry: EntrySummary | undefined;
  target: ReviewTarget;
  backLabel: string;
  stashes: ReviewStash[];
  children: React.ReactNode;
}) {
  const config = useData((s) => s.config);
  const [renaming, setRenaming] = useState(false);
  // The title box's width when rename started, so the input keeps it.
  const titleWidth = useRef<number | undefined>(undefined);
  const project = target.kind === 'project' ? config?.projects.find((p) => p.id === target.projectId) : undefined;

  let title = '';
  let subtitle = '';
  if (target.kind === 'branch') {
    title = t('review.title');
    const rev = target.branch ?? entry?.shortSha;
    const where = target.tipOverride
      ? t('review.lastKnownState')
      : entry?.worktreePath
        ? tildifyHome(entry.worktreePath)
        : null;
    subtitle = [entry?.repoName, rev, where].filter(Boolean).join(' · ');
  } else if (target.kind === 'stashes') {
    title = t('review.stashesTitle');
    const repo = config?.repos.find((r) => r.id === target.repoId);
    subtitle = `${repo ? basename(repo.path) : ''} · ${t('branches.subStashes', { ...cnt(stashes.length) })}`;
  } else {
    title = project?.name ?? '';
    if (project) {
      const repos = new Set(project.entries.map((e) => e.repoId)).size;
      subtitle = `${t('branches.subRepos', { ...cnt(repos) })} · ${t('branches.subBranches', { ...cnt(project.entries.length) })}`;
    }
  }

  return (
    <PageHeader
      backLabel={backLabel}
      title={
        renaming && project ? (
          <ProjectNameInput
            project={project}
            className={editable.input}
            width={titleWidth.current}
            onDone={() => setRenaming(false)}
          />
        ) : project ? (
          <span
            className={editable.title}
            data-editable-title
            title={t('project.renameProject')}
            onClick={(e) => {
              titleWidth.current = e.currentTarget.offsetWidth;
              setRenaming(true);
            }}
          >
            {title}
          </span>
        ) : (
          title
        )
      }
      subtitle={subtitle}
    >
      {children}
    </PageHeader>
  );
}
