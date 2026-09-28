import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BaseMenu } from '../../components/BaseMenu/BaseMenu';
import { Button } from '../../components/Button';
import { BranchIcon, ChevronDownIcon, CopyIcon, HistoryIcon, MoreIcon, RemoveIcon } from '../../components/icons';
import { Kbd } from '../../components/Kbd';
import { Menu, MenuDivider, MenuItem } from '../../components/Menu';
import { OpenItems } from '../../components/OpenItems';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { Pill } from '../../components/Pill';
import { Popover } from '../../components/Popover';
import { ProjectMenu } from '../../components/ProjectMenu';
import { RefreshButton } from '../../components/RefreshButton';
import {
  commitExists,
  createProject,
  getBaseOptions,
  getProjectView,
  removeEntries,
  renameProject,
  repointEntry,
} from '../../lib/ipc';
import { basename } from '../../lib/paths';
import { entriesSummary, nameConflict } from '../../lib/projects';
import { entryKey } from '../../lib/entryKey';
import { formatAge } from '../../lib/format';
import type { EntryConfig, EntrySummary, RepoConfig } from '../../lib/types';
import { useInvoke } from '../../lib/useInvoke';
import { useData } from '../../state/data';
import { selectCanBack, useNav } from '../../state/nav';
import { useUi } from '../../state/ui';
import { draftRows } from './draftRows';
import styles from './Project.module.css';

export function Project({ projectId }: { projectId: string }) {
  return projectId === 'draft' ? <DraftProject /> : <SavedProject id={projectId} />;
}

/** ⌘K opens the Add palette for the project on screen. Listed in lib/shortcuts.ts. */
function usePaletteShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'k' && useUi.getState().modalCount === 0) {
        e.preventDefault();
        useUi.getState().setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const openPalette = () => useUi.getState().setPaletteOpen(true);

function SavedProject({ id }: { id: string }) {
  usePaletteShortcut();
  const config = useData((s) => s.config);
  const project = config?.projects.find((p) => p.id === id);
  const nav = useNav();
  const repoIds = useMemo(() => [...new Set(project?.entries.map((e) => e.repoId) ?? [])], [project]);
  const { data } = useInvoke(() => getProjectView(id), [id], { repoIds, onConfig: true, enabled: !!project });

  const [renaming, setRenaming] = useState(false);
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  const renameRequest = useUi((s) => s.renamingProjectId);

  // A deleted project's page goes back to Branches.
  useEffect(() => {
    if (config && !project) nav.replace({ name: 'branches' });
  }, [config, project, nav]);

  // F2 renames, like in Finder. Listed in lib/shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' && useUi.getState().modalCount === 0) {
        e.preventDefault();
        setRenaming(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Rename requested from the sidebar's right-click menu.
  useEffect(() => {
    if (renameRequest === id) {
      setRenaming(true);
      useUi.getState().setRenamingProjectId(null);
    }
  }, [renameRequest, id]);

  // ⌘R: Review changes. Listed in lib/shortcuts.ts.
  const hasEntries = (project?.entries.length ?? 0) > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'r' && hasEntries && useUi.getState().modalCount === 0) {
        e.preventDefault();
        useNav
          .getState()
          .push({ name: 'review', target: { kind: 'project', projectId: id }, backLabel: 'Back to project' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, hasEntries]);

  if (!project) return null;
  // Rows come from the view; while it loads, keep the table shape from the config.
  const rows = data?.project.id === id ? data.entries : [];
  const review = () =>
    nav.push({ name: 'review', target: { kind: 'project', projectId: id }, backLabel: 'Back to project' });

  return (
    <>
      <ProjectHeader
        title={project.name}
        renaming={renaming}
        exceptId={id}
        subtitle={entriesSummary(
          rows.length
            ? rows
            : project.entries.map((e) => ({ repoId: e.repoId, repoName: repoNameOf(config?.repos, e.repoId) })),
        )}
        onRenameStart={() => setRenaming(true)}
        onRenameSave={async (name) => {
          await renameProject(id, name);
          setRenaming(false);
        }}
        onRenameCancel={() => setRenaming(false)}
      >
        <RefreshButton />
        <button
          type="button"
          aria-label="Project options"
          aria-haspopup="menu"
          className={menuAt ? `${styles.optionsButton} ${styles.optionsOpen}` : styles.optionsButton}
          onClick={(e) => setMenuAt(e.currentTarget.getBoundingClientRect())}
        >
          <MoreIcon />
        </button>
        <Button kbd="⌘K" className={styles.addButton} onClick={openPalette}>
          Add entries
        </Button>
        <Button variant="primary" title="Review changes (⌘R)" disabled={project.entries.length === 0} onClick={review}>
          Review changes
        </Button>
      </ProjectHeader>

      {project.entries.length === 0 ? (
        <EmptyProject />
      ) : (
        <EntryTable
          rows={rows}
          stored={project.entries}
          projectId={id}
          onRemove={(key) => void removeEntries(id, [key])}
          footer={rows.length === 1 ? <AddRelatedCard /> : null}
        />
      )}

      {menuAt && (
        <Popover anchorRect={menuAt} width={230} alignRight onClose={() => setMenuAt(null)}>
          <ProjectMenu
            onRename={() => {
              setMenuAt(null);
              setRenaming(true);
            }}
            onDelete={() => {
              setMenuAt(null);
              useUi.getState().setDeletingProjectId(id);
            }}
          />
        </Popover>
      )}
    </>
  );
}

/** Flows C and H2: a project that exists only until it is named. */
function DraftProject() {
  usePaletteShortcut();
  const draft = useUi((s) => s.draftProject);
  const scan = useData((s) => s.scan);
  const nav = useNav();
  const canBack = useNav(selectCanBack);

  useEffect(() => {
    if (!draft) nav.replace({ name: 'branches' });
  }, [draft, nav]);

  const rows = useMemo(() => (draft ? draftRows(draft.entries, scan) : []), [draft, scan]);
  if (!draft) return null;

  const discard = () => {
    useUi.getState().setDraftProject(null);
    if (canBack) nav.back();
    else nav.replace({ name: 'branches' });
  };
  const save = async (name: string) => {
    const created = await createProject(name, draft.entries);
    useUi.getState().setDraftProject(null);
    nav.replace({ name: 'project', projectId: created.id });
  };
  const setEntries = (entries: typeof draft.entries) =>
    useUi.getState().setDraftProject({ ...draft, entries });

  return (
    <>
      <ProjectHeader
        title={draft.name}
        renaming
        draft
        subtitle={
          rows.length === 0
            ? 'Name your project · ↵ save · esc discards it'
            : `${entriesSummary(rows)} · name your project · ↵ save`
        }
        onNameChange={(name) => useUi.getState().setDraftProject({ ...draft, name })}
        onRenameSave={save}
        onRenameCancel={discard}
      >
        <RefreshButton />
        <Button kbd="⌘K" className={styles.addButton} onClick={openPalette}>
          Add entries
        </Button>
        <Button variant="primary" disabled>
          Review changes
        </Button>
      </ProjectHeader>

      {rows.length === 0 ? (
        <EmptyProject />
      ) : (
        <EntryTable
          rows={rows}
          stored={[]}
          projectId={null}
          onRemove={(key) => setEntries(draft.entries.filter((_, i) => rows[i].key !== key))}
          footer={rows.length === 1 ? <AddRelatedCard /> : null}
        />
      )}
    </>
  );
}

interface HeaderProps {
  title: string;
  subtitle: string;
  renaming: boolean;
  /** The draft's title is always an input, and its text is the draft's name. */
  draft?: boolean;
  exceptId?: string;
  onRenameStart?: () => void;
  onNameChange?: (name: string) => void;
  onRenameSave: (name: string) => Promise<void>;
  onRenameCancel: () => void;
  children: ReactNode;
}

function ProjectHeader(props: HeaderProps) {
  const { title, subtitle, renaming, draft, exceptId, children } = props;
  const config = useData((s) => s.config);
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setValue(title);
      // Text selected, ready to type over.
      requestAnimationFrame(() => input.current?.select());
    }
    // Only when rename mode starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming]);

  // Esc cancels even when the input lost focus. A click elsewhere leaves rename mode without
  // saving; a draft stays in rename mode, since it only exists until it is named.
  const cancel = useRef(props.onRenameCancel);
  cancel.current = props.onRenameCancel;
  useEffect(() => {
    if (!renaming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useUi.getState().modalCount === 0) {
        e.preventDefault();
        cancel.current();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!draft && e.target !== input.current) cancel.current();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [renaming, draft]);

  const conflict = renaming ? nameConflict(config, value, exceptId) : null;
  const canSave = !!value.trim() && !conflict && !saving;

  const titleNode = renaming ? (
    <input
      ref={input}
      aria-label="Project name"
      className={conflict ? `${styles.renameInput} ${styles.renameConflict}` : styles.renameInput}
      value={value}
      spellCheck={false}
      onChange={(e) => {
        setValue(e.target.value);
        props.onNameChange?.(e.target.value);
      }}
      onKeyDown={async (e) => {
        if (e.key === 'Enter' && canSave) {
          setSaving(true);
          try {
            await props.onRenameSave(value.trim());
          } finally {
            setSaving(false);
          }
        }
      }}
    />
  ) : (
    <span className={styles.title} onDoubleClick={props.onRenameStart}>
      {title}
    </span>
  );

  const sub = conflict
    ? `A project named “${conflict}” already exists`
    : renaming && !draft
      ? '↵ save · esc cancel'
      : subtitle;

  return (
    <PageHeader title={titleNode} subtitle={<span className={conflict ? styles.danger : undefined}>{sub}</span>} dragTitle={false}>
      {children}
    </PageHeader>
  );
}

function EmptyProject() {
  return (
    <div className={styles.center}>
      <div className={styles.emptyBody}>
        <h2 className={styles.emptyTitle}>No entries yet</h2>
        <p className={styles.emptyText}>
          A project groups branches that belong to one piece of work, across any of your repositories.
        </p>
        <Button variant="primary" size={40} kbd="⌘K" className={styles.emptyButton} onClick={openPalette}>
          Add branches
        </Button>
      </div>
    </div>
  );
}

function AddRelatedCard() {
  return (
    <button type="button" className={styles.relatedCard} onClick={openPalette}>
      <span className={styles.relatedPlus}>+</span>
      <span className={styles.relatedText}>Add related branches from other repositories</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

function EntryTable({
  rows,
  stored,
  projectId,
  onRemove,
  footer,
}: {
  rows: EntrySummary[];
  /** The project's stored entries (last known tips). */
  stored: EntryConfig[];
  projectId: string | null;
  onRemove: (key: string) => void;
  footer: ReactNode;
}) {
  const push = useNav((s) => s.push);
  const [menu, setMenu] = useState<{ key: string; rect: DOMRect } | null>(null);
  const menuEntry = rows.find((r) => r.key === menu?.key);
  const [baseMenu, setBaseMenu] = useState<{ entry: EntrySummary; rect: DOMRect } | null>(null);
  const [repoint, setRepoint] = useState<{ entry: EntrySummary; rect: DOMRect } | null>(null);
  const settings = () => push({ name: 'settings' });

  return (
    <div className={styles.table}>
      <div className={`${styles.grid} ${styles.columns}`}>
        <span>Repo</span>
        <span>Branch</span>
        <span>Base</span>
        <span>Ahead</span>
        <span>Files</span>
        <span>Uncommitted</span>
        <span>State</span>
        <span />
      </div>
      <div className={styles.rows}>
        {rows.map((e) => {
          const hot = menu?.key === e.key;
          const dim = e.state === 'branch_deleted' || e.state === 'repo_missing';
          const cls = [styles.grid, styles.row, hot && styles.hot, dim && !hot && styles.dim].filter(Boolean).join(' ');
          const name = e.branch ?? e.shortSha ?? e.worktreePath ?? '';
          return (
            <div key={e.key} className={cls}>
              <button
                type="button"
                className={styles.repo}
                title={`Show ${e.repoName} on Branches`}
                onClick={() => push({ name: 'branches', focusRepoId: e.repoId })}
              >
                {e.repoName}
              </button>
              {projectId ? (
                <button
                  type="button"
                  className={styles.branch}
                  title={name}
                  onClick={() =>
                    push({
                      name: 'review',
                      target: { kind: 'project', projectId },
                      focusKey: e.key,
                      backLabel: 'Back to project',
                    })
                  }
                >
                  {name}
                </button>
              ) : (
                <span className={styles.branchText}>{name}</span>
              )}
              <button
                type="button"
                aria-haspopup="listbox"
                className={styles.base}
                disabled={e.state === 'repo_missing'}
                onClick={(ev) => setBaseMenu({ entry: e, rect: ev.currentTarget.getBoundingClientRect() })}
              >
                <span className={styles.baseName}>{e.base ?? '—'}</span>
                <ChevronDownIcon size={10} />
              </button>
              <span className={styles.mono}>{e.ahead === null ? '—' : `↑${e.ahead}`}</span>
              <span className={styles.mono}>{e.files ?? '—'}</span>
              {e.uncommitted ? (
                <span className={styles.dirty}>● {e.uncommitted} changed</span>
              ) : (
                <span className={styles.faint}>—</span>
              )}
              <StatePill
                entry={e}
                onBase={(rect) => setBaseMenu({ entry: e, rect })}
                onMenu={(rect) => setMenu({ key: e.key, rect })}
                onSettings={settings}
              />
              <button
                type="button"
                aria-label="Entry options"
                className={hot ? `${styles.entryMenu} ${styles.entryMenuOpen}` : styles.entryMenu}
                onClick={(ev) => setMenu({ key: e.key, rect: ev.currentTarget.getBoundingClientRect() })}
              >
                <MoreIcon size={14} />
              </button>
            </div>
          );
        })}
        {footer}
      </div>

      {baseMenu && (
        <BaseMenu
          repoId={baseMenu.entry.repoId}
          entryKey={baseMenu.entry.key}
          branchName={baseMenu.entry.branch ?? baseMenu.entry.shortSha ?? ''}
          anchorRect={baseMenu.rect}
          onClose={() => setBaseMenu(null)}
        />
      )}
      {menu && menuEntry && (
        <Popover anchorRect={menu.rect} width={260} alignRight onClose={() => setMenu(null)}>
          <EntryMenu
            entry={menuEntry}
            stored={stored.find((c) => entryKey(c) === menuEntry.key)}
            saved={projectId !== null}
            onRepoint={() => {
              setRepoint({ entry: menuEntry, rect: menu.rect });
              setMenu(null);
            }}
            onRemove={() => {
              onRemove(menuEntry.key);
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
          />
        </Popover>
      )}
      {repoint && projectId && (
        <BranchPicker
          entry={repoint.entry}
          anchorRect={repoint.rect}
          onClose={() => setRepoint(null)}
          onPick={(branch) => void repointEntry(projectId, repoint.entry.key, branch)}
        />
      )}
    </div>
  );
}

/** Broken states are labels; the clickable ones lead to the fix. */
function StatePill({
  entry: e,
  onBase,
  onMenu,
  onSettings,
}: {
  entry: EntrySummary;
  onBase: (rect: DOMRect) => void;
  onMenu: (rect: DOMRect) => void;
  onSettings: () => void;
}) {
  const cls = styles.pill;
  const clickable = (tone: 'warning' | 'danger', label: string, onClick: (rect: DOMRect) => void) => (
    <button
      type="button"
      className={`${styles.pillButton} ${cls}`}
      title={e.error ?? undefined}
      onClick={(ev) => onClick(ev.currentTarget.getBoundingClientRect())}
    >
      <Pill tone={tone}>{label}</Pill>
    </button>
  );
  switch (e.state) {
    case 'merged':
      return (
        <Pill tone="success" className={cls} title={`merged into ${e.base}`}>
          merged into {e.base}
        </Pill>
      );
    case 'detached':
      return <Pill tone="warning" className={cls}>detached HEAD</Pill>;
    case 'base_missing':
      return clickable('warning', 'base missing', onBase);
    case 'git_error':
      return <Pill tone="danger" className={cls} title={e.error ?? undefined}>git error</Pill>;
    case 'branch_deleted':
      return clickable('danger', 'branch deleted', onMenu);
    case 'repo_missing':
      return clickable('danger', 'repo path not found', onSettings);
    default:
      return <span className={styles.faint}>—</span>;
  }
}

/** Entry options: [View last known state], Point to another branch…, Copy branch name, [open
 * items], Remove. */
function EntryMenu({
  entry,
  stored,
  saved,
  onRepoint,
  onRemove,
  onClose,
}: {
  entry: EntrySummary;
  stored: EntryConfig | undefined;
  saved: boolean;
  onRepoint: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const push = useNav((s) => s.push);
  const tip = entry.state === 'branch_deleted' ? stored?.lastKnownTip : null;
  const { data: exists } = useInvoke(() => commitExists(entry.repoId, tip!.sha), [tip?.sha], {
    enabled: !!tip,
  });
  const seen = tip ? formatAge(Date.parse(tip.seenAt) / 1000) : '';
  const hasFirst = !!tip || entry.branch !== null;

  return (
    <Menu aria-label="Entry options">
      {tip && (
        <MenuItem
          icon={<HistoryIcon />}
          disabled={exists === false}
          sub={
            exists === false
              ? `tip ${tip.sha.slice(0, 7)} · no longer in the repository`
              : `tip ${tip.sha.slice(0, 7)} · seen ${seen} ago`
          }
          onSelect={() => {
            onClose();
            push({
              name: 'review',
              target: { kind: 'branch', repoId: entry.repoId, branch: entry.branch, worktreePath: null, tipOverride: tip.sha },
              backLabel: 'Back to project',
            });
          }}
        >
          View last known state
        </MenuItem>
      )}
      {saved && entry.branch !== null && (
        <MenuItem icon={<BranchIcon size={14} />} onSelect={onRepoint}>
          Point to another branch…
        </MenuItem>
      )}
      {entry.branch !== null && (
        <MenuItem
          icon={<CopyIcon />}
          onSelect={() => {
            void writeText(entry.branch!);
            onClose();
          }}
        >
          Copy branch name
        </MenuItem>
      )}
      {hasFirst && <MenuDivider />}
      <OpenItems entry={entry} onDone={onClose} />
      <MenuDivider />
      <MenuItem danger icon={<RemoveIcon />} onSelect={onRemove}>
        Remove from project
      </MenuItem>
    </Menu>
  );
}

/** "Point to another branch…": the local branches of the entry's repo. */
function BranchPicker({
  entry,
  anchorRect,
  onPick,
  onClose,
}: {
  entry: EntrySummary;
  anchorRect: DOMRect;
  onPick: (branch: string) => void;
  onClose: () => void;
}) {
  const { data } = useInvoke(() => getBaseOptions(entry.repoId, entry.key), [entry.key]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const branches = (data?.branches ?? []).filter((b) => b.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = (b: string) => {
    onPick(b);
    onClose();
  };
  return (
    <Popover anchorRect={anchorRect} width={300} alignRight onClose={onClose}>
      <div role="listbox" aria-label={`Point ${entry.branch} to another branch`} className={styles.picker}>
        <div className={styles.pickerFilterRow}>
          <input
            autoFocus
            aria-label="Filter branches"
            placeholder="Filter branches"
            className={styles.pickerFilter}
            value={query}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              const n = branches.length;
              if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
                e.preventDefault();
                setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
              } else if (e.key === 'Enter' && branches[active]) {
                e.preventDefault();
                pick(branches[active]);
              }
            }}
          />
        </div>
        <div className={styles.pickerList}>
          {branches.map((b, i) => (
            <button
              key={b}
              type="button"
              role="option"
              aria-selected={i === active}
              className={i === active ? `${styles.pickerItem} ${styles.pickerActive}` : styles.pickerItem}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(b)}
            >
              {b}
            </button>
          ))}
          {data && branches.length === 0 && <div className={styles.pickerEmpty}>No branches</div>}
        </div>
      </div>
    </Popover>
  );
}

function repoNameOf(repos: RepoConfig[] | undefined, id: string): string {
  const repo = repos?.find((r) => r.id === id);
  return repo ? basename(repo.path) : id;
}
