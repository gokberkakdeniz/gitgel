import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { CloseIcon } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { Pill } from '../../components/Pill';
import { openAddRepos } from '../../lib/addRepos';
import { locateRepo, removeRepo, updateSettings } from '../../lib/ipc';
import { basename, tildifyHome } from '../../lib/paths';
import type { AppError, Config, RepoConfig, TerminalChoice } from '../../lib/types';
import { useData } from '../../state/data';
import styles from './Settings.module.css';
import { Appearance } from './Appearance';
import { parseBaseOrder, parseDays } from './parse';
import { SHORTCUTS } from '../../lib/shortcuts';

export function Settings() {
  const config = useData((s) => s.config);
  if (!config) return null;
  return (
    <>
      <PageHeader title="Settings" />
      <div className={styles.grid}>
        <Repositories config={config} />
        <div className={styles.column}>
          <Appearance config={config} />
          <Behaviour config={config} />
        </div>
        <Shortcuts />
      </div>
    </>
  );
}

function Repositories({ config }: { config: Config }) {
  const scan = useData((s) => s.scan);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<RepoConfig | null>(null);

  const locate = async (repo: RepoConfig) => {
    const picked = await open({ directory: true, multiple: false });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    try {
      await locateRepo(repo.id, path);
      setErrors(({ [repo.id]: _, ...rest }) => rest);
    } catch (e) {
      setErrors((errs) => ({ ...errs, [repo.id]: (e as AppError).message }));
    }
  };
  const entriesOf = (repoId: string) =>
    config.projects.reduce((n, p) => n + p.entries.filter((e) => e.repoId === repoId).length, 0);
  const remove = (repo: RepoConfig) => {
    // Only ask when projects would lose entries.
    if (entriesOf(repo.id) > 0) setRemoving(repo);
    else void removeRepo(repo.id);
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Repositories</h2>
      <div className={styles.card}>
        {config.repos.map((repo) => {
          const s = scan[repo.id];
          const missing = s?.status === 'missing';
          return (
            <div key={repo.id} className={styles.repoRow}>
              <div className={styles.repoLine}>
                <span className={styles.repoName} title={basename(repo.path)}>
                  {basename(repo.path)}
                </span>
                <span className={styles.repoPath} title={repo.path}>
                  {tildifyHome(repo.path)}
                </span>
                {missing ? (
                  <>
                    <Pill tone="danger">path not found</Pill>
                    <button type="button" className={styles.locate} onClick={() => void locate(repo)}>
                      Locate…
                    </button>
                  </>
                ) : s?.status === 'error' ? (
                  <Pill tone="danger" title={s.error ?? undefined}>
                    git error
                  </Pill>
                ) : (
                  <span className={styles.note}>{s?.defaultBase ? `base ${s.defaultBase}` : s ? 'no base found' : ''}</span>
                )}
                <button
                  type="button"
                  aria-label="Remove repository"
                  className={styles.remove}
                  onClick={() => remove(repo)}
                >
                  <CloseIcon size={13} />
                </button>
              </div>
              {errors[repo.id] && <div className={styles.error}>{errors[repo.id]}</div>}
            </div>
          );
        })}
        <button type="button" className={styles.addRepo} onClick={() => void openAddRepos()}>
          + Add repository…
        </button>
      </div>

      {removing && (
        <Modal aria-label="Remove repository" width={440} paddingTop={180} onClose={() => setRemoving(null)}>
          <div className={styles.modal}>
            <div className={styles.modalTitle}>Remove {basename(removing.path)}?</div>
            <p className={styles.modalText}>
              Its {entriesOf(removing.id) === 1 ? '1 project entry is' : `${entriesOf(removing.id)} project entries are`}{' '}
              removed too. Nothing on disk is touched.
            </p>
            <div className={styles.modalActions}>
              <Button size={36} className={styles.cancel} onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size={36}
                onClick={() => {
                  void removeRepo(removing.id);
                  setRemoving(null);
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Shortcuts() {
  return (
    <section className={styles.shortcuts} aria-labelledby="shortcuts-title">
      <div className={styles.shortcutsHead}>
        <h2 id="shortcuts-title" className={styles.heading}>
          Keyboard shortcuts
        </h2>
        <span className={styles.settingHint}>Not editable yet</span>
      </div>
      <div className={styles.shortcutGrid}>
        {SHORTCUTS.map((group) => (
          <div key={group.title} className={styles.shortcutCard}>
            <div className={styles.shortcutTitle}>{group.title}</div>
            {group.items.map((item) => (
              <div key={`${item.label}${item.note ?? ''}`} className={styles.shortcutRow}>
                <span className={styles.shortcutText}>
                  <span className={styles.shortcutLabel}>{item.label}</span>
                  {item.note && <span className={styles.shortcutNote}>{item.note}</span>}
                </span>
                <span className={styles.keys}>
                  {item.keys.map((k, i) =>
                    k === '/' ? (
                      <span key={i} className={styles.keySep}>
                        /
                      </span>
                    ) : (
                      <kbd key={i} className={styles.key}>
                        {k}
                      </kbd>
                    ),
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Behaviour({ config }: { config: Config }) {
  const { defaultBaseOrder, activeDays } = config.settings;
  const orderText = defaultBaseOrder.join(' → ');
  const [order, setOrder] = useState(orderText);
  const [days, setDays] = useState(String(activeDays));
  // Follow changes saved elsewhere (or the normalized value after a save).
  useEffect(() => setOrder(orderText), [orderText]);
  useEffect(() => setDays(String(activeDays)), [activeDays]);

  const saveOrder = () => {
    const parsed = parseBaseOrder(order);
    if (parsed.length === 0 || parsed.join(' → ') === orderText) {
      setOrder(orderText);
      return;
    }
    void updateSettings({ ...config.settings, defaultBaseOrder: parsed });
  };
  const saveDays = () => {
    const n = parseDays(days);
    if (n === null || n === activeDays) {
      setDays(String(activeDays));
      return;
    }
    void updateSettings({ ...config.settings, activeDays: n });
  };
  const onEnter = (save: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      save();
      e.currentTarget.blur();
    }
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Behaviour</h2>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>Default base</span>
          <span className={styles.settingHint}>Tried in order when a branch has no base set</span>
        </span>
        <input
          className={`${styles.input} ${styles.orderInput}`}
          value={order}
          spellCheck={false}
          onChange={(e) => setOrder(e.target.value)}
          onBlur={saveOrder}
          onKeyDown={onEnter(saveOrder)}
        />
      </label>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>Active threshold</span>
          <span className={styles.settingHint}>Branches without a worktree are listed if committed within</span>
        </span>
        <span className={styles.days}>
          <input
            className={`${styles.input} ${styles.daysInput}`}
            value={days}
            inputMode="numeric"
            onChange={(e) => setDays(e.target.value)}
            onBlur={saveDays}
            onKeyDown={onEnter(saveDays)}
          />
          <span className={styles.settingHint}>days</span>
        </span>
      </label>
      <TerminalSetting config={config} />
    </section>
  );
}

/** The app behind "Open in <terminal>" in the entry menus. */
function TerminalSetting({ config }: { config: Config }) {
  const { terminal, terminalCommand } = config.settings;
  const [command, setCommand] = useState(terminalCommand);
  useEffect(() => setCommand(terminalCommand), [terminalCommand]);
  const openApps = useData((s) => s.openApps);
  const termApp = openApps.find((a) => a.id === 'terminal');
  const loaded = openApps.length > 0;
  // Terminals that are not installed cannot be picked.
  const terminalOptions = useData((s) => s.terminalOptions);
  const missing = (choice: TerminalChoice) => terminalOptions.some((o) => o.choice === choice && !o.found);
  const saveCommand = () => {
    const trimmed = command.trim();
    if (trimmed !== terminalCommand) void updateSettings({ ...config.settings, terminalCommand: trimmed });
  };

  return (
    <div className={styles.terminal}>
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <span className={styles.settingName}>Terminal</span>
          <span className={styles.settingHint}>Used by “Open in …” in the branch menus</span>
        </span>
        <span className={styles.terminalWrap}>
          <select
            aria-label="Terminal"
            className={styles.terminalSelect}
            value={terminal}
            onChange={(e) => void updateSettings({ ...config.settings, terminal: e.target.value as TerminalChoice })}
          >
            <option value="auto">Automatic{termApp ? ` (${termApp.name})` : ''}</option>
            <option value="terminal" disabled={missing('terminal')}>
              Terminal
            </option>
            <option value="iterm" disabled={missing('iterm')}>
              iTerm2
            </option>
            <option value="wezterm" disabled={missing('wezterm')}>
              WezTerm
            </option>
            <option value="other">Other…</option>
          </select>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className={styles.terminalChevron}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6"></path>
          </svg>
        </span>
      </label>
      {terminal === 'other' && (
        <label className={styles.terminalOther}>
          <span className={styles.srOnly}>Terminal command</span>
          <input
            className={`${styles.input} ${styles.terminalCommand}`}
            placeholder="wezterm start --cwd %"
            value={command}
            spellCheck={false}
            onChange={(e) => setCommand(e.target.value)}
            onBlur={saveCommand}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                saveCommand();
                e.currentTarget.blur();
              }
            }}
          />
          <span className={styles.settingHint}>
            A command, or an app name such as Ghostty. <span className={styles.mono}>%</span> becomes the worktree
            folder; the command runs in your login shell, in that folder.
          </span>
        </label>
      )}
      {loaded && termApp && !termApp.found && (
        <span className={styles.terminalMissing}>
          {termApp.name} is not installed; the menus show it disabled
        </span>
      )}
    </div>
  );
}
