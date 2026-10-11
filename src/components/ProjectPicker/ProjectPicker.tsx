import { useMemo, useState } from 'react';
import { cnt } from '../../lib/format';
import { t } from '../../i18n';
import { addEntries, createProject, deleteProject, removeEntries } from '../../lib/ipc';
import { keysOf, nameConflict } from '../../lib/projects';
import type { EntryRef, ProjectConfig } from '../../lib/types';
import { useData } from '../../state/data';
import { useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import { Button } from '../Button';
import { Input } from '../Input';
import styles from './ProjectPicker.module.css';

interface Props {
  entries: EntryRef[];
  /** Toast text naming what was added: a branch (shown mono) or e.g. "3 branches". */
  label: ToastLabel;
  /** Shown in the new-project form under "First entry". */
  firstEntry: string;
  /** Replaces the in-place form for "+ New Project…" (selection bar: flow H2). */
  onNewProject?: () => void;
  /** Projects not offered (the entry is already in them). */
  excludeProjectIds?: string[];
  /** After the entries were added, with their keys. */
  onAdded?: (keys: string[]) => void;
  onDone: () => void;
}

/** Flow B: add entries to an existing project, or create one with them. */
export function ProjectPicker({
  entries,
  label,
  firstEntry,
  onNewProject,
  excludeProjectIds = [],
  onAdded,
  onDone,
}: Props) {
  const [view, setView] = useState<'pick' | 'new'>('pick');
  const added = () => {
    onAdded?.(keysOf(entries));
    onDone();
  };
  return view === 'pick' ? (
    <PickView
      entries={entries}
      label={label}
      exclude={excludeProjectIds}
      onNew={() => (onNewProject ? onNewProject() : setView('new'))}
      onDone={added}
    />
  ) : (
    <NewView entries={entries} label={label} firstEntry={firstEntry} onCancel={onDone} onDone={added} />
  );
}

function PickView({
  entries,
  label,
  exclude,
  onNew,
  onDone,
}: {
  entries: EntryRef[];
  label: ToastLabel;
  exclude: string[];
  onNew: () => void;
  onDone: () => void;
}) {
  const projects = useData((s) => s.config?.projects);
  const [filter, setFilter] = useState('');
  const shown = useMemo(
    () =>
      (projects ?? []).filter(
        (p) => !exclude.includes(p.id) && p.name.toLowerCase().includes(filter.trim().toLowerCase()),
      ),
    [projects, filter, exclude],
  );

  const pick = async (p: ProjectConfig) => {
    // Undo only removes what this action added.
    const before = new Set(keysOf(p.entries));
    const added = keysOf(entries).filter((k) => !before.has(k));
    await addEntries(p.id, entries);
    onDone();
    announce(label, p, () => removeEntries(p.id, added));
  };

  return (
    <div role="dialog" aria-label={t('project.pickTitle')} className={styles.pick}>
      <div className={styles.filterRow}>
        <Input
          autoFocus
          leftIcon="search"
          clearable
          size={32}
          aria-label={t('sidebar.searchProjects')}
          placeholder={t('sidebar.search')}
          className={styles.filter}
          value={filter}
          onChange={setFilter}
        />
      </div>
      {shown.length > 0 && (
        <div className={styles.list}>
          {shown.map((p) => (
            <button key={p.id} type="button" className={styles.project} onClick={() => void pick(p)}>
              <span className={styles.projectName}>{p.name}</span>
              <span className={styles.count}>
                {t('project.entryCount', { ...cnt(p.entries.length) })}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.newRow}>
        <button type="button" className={styles.newButton} onClick={onNew}>
          {t('project.newBtn')}
        </button>
      </div>
    </div>
  );
}

function NewView({
  entries,
  label,
  firstEntry,
  onCancel,
  onDone,
}: {
  entries: EntryRef[];
  label: ToastLabel;
  firstEntry: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const config = useData((s) => s.config);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const conflict = nameConflict(config, name);
  const canCreate = !!name.trim() && !conflict && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const project = await createProject(name.trim(), entries);
      onDone();
      announce(label, project, () => deleteProject(project.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label={t('project.newTitle')} className={styles.form}>
      <div className={styles.formTitle}>{t('project.newTitle')}</div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('project.nameLabel')}</span>
        <Input
          autoFocus
          size={36}
          invalid={!!conflict}
          value={name}
          onChange={setName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
        {conflict && <span className={styles.error}>{t('project.conflictExists', { name: conflict })}</span>}
      </label>
      <div className={styles.first}>
        <span>{t('project.firstEntry')}</span>
        <span className={styles.firstEntry}>{firstEntry}</span>
      </div>
      <div className={styles.actions}>
        <Button className={styles.cancel} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!canCreate} onClick={() => void create()}>
          {t('project.createAdd')}
        </Button>
      </div>
    </div>
  );
}

/** A branch name (the toast's mono part) or plain text such as "3 branches". */
export type ToastLabel = { branch: string } | string;

/** Toast after adding: Undo reverses exactly this action; "Open Project" goes there. */
function announce(label: ToastLabel, project: ProjectConfig, undo: () => Promise<unknown>) {
  useUi.getState().showToast({
    code: typeof label === 'string' ? undefined : label.branch,
    message:
      typeof label === 'string'
        ? t('project.addedTo', { label, project: project.name })
        : t('project.addedToPlain', { project: project.name }),
    actionLabel: t('common.undo'),
    onAction: () => void undo(),
    linkLabel: t('project.openLink'),
    onLink: () => useNav.getState().push({ name: 'project', projectId: project.id }),
  });
}
