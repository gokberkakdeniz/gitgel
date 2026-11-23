import { useRef, useState } from 'react';
import { useCommandSource } from '../../commands/registry';
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

/** A branch review's subtitle: the repo, rev and worktree joined by ` · `. Each can be selected
 * and copied, and a double click selects all of it rather than one word of a branch name or path;
 * having no drag attribute, pressing one does not move the window. A label (`last known state`)
 * stays plain text. */
export function CopyableSubtitle({ parts, label }: { parts: (string | null | undefined)[]; label?: string }) {
  const items: React.ReactNode[] = parts
    .filter((p): p is string => !!p)
    .map((p, i) => (
      <span
        // Fixed order; the repo and the rev can share a name.
        key={i}
        className="selectable"
        // Set once the double click is over (after mouseup), so no drag of the press extends
        // it; a triple click's line selection would run past the span, so it is kept out.
        onDoubleClick={(e) => {
          const text = e.currentTarget.firstChild;
          if (text) window.getSelection()?.setBaseAndExtent(text, 0, text, text.textContent?.length ?? 0);
        }}
        onMouseDown={(e) => e.detail > 2 && e.preventDefault()}
      >
        {p}
      </span>
    ));
  if (label) items.push(label);
  return <>{items.flatMap((item, i) => (i ? [' · ', item] : [item]))}</>;
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
  useCommandSource(() => ({
    commands: project
      ? [
          {
            id: 'project:rename',
            title: t('project.renameProject'),
            group: t('cmd.groupProject'),
            run: () => setRenaming(true),
          },
        ]
      : [],
  }));

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
