import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { IconButton } from '../../components/IconButton';
import { CloseIcon } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { Pill } from '../../components/Pill';
import { Select } from '../../components/Select';
import { SettingsNav, type SettingsNavSection } from '../../components/SettingsNav';
import { openAddRepos } from '../../lib/addRepos';
import { locateRepo, removeRepo, updateSettings } from '../../lib/ipc';
import { basename, tildifyHome } from '../../lib/paths';
import type { AppError, Config, RepoConfig, TerminalChoice } from '../../lib/types';
import { useData } from '../../state/data';
import { useUi, type SettingsSection } from '../../state/ui';
import styles from './Settings.module.css';
import { Appearance } from './Appearance';
import { BaseOrder } from './BaseOrder';
import { parseDays } from './parse';
import { SHORTCUTS } from '../../lib/shortcuts';

const SECTIONS: SettingsNavSection<SettingsSection>[] = [
  { id: 'general', label: 'General', icon: 'tune' },
  { id: 'repositories', label: 'Repositories', icon: 'folder' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
];

/** A section list on the left, the chosen section's settings on the right (flow M). */
export function Settings() {
  const config = useData((s) => s.config);
  const section = useUi((s) => s.settingsSection);
  const setSection = useUi((s) => s.setSettingsSection);
  if (!config) return null;
  return (
    <>
      <PageHeader title="Settings" />
      <div className={styles.body}>
        <SettingsNav
          sections={SECTIONS.map((s) => (s.id === 'repositories' ? { ...s, count: config.repos.length } : s))}
          current={section}
          onPick={setSection}
        />
        {/* Keyed so each section starts scrolled to the top. */}
        <div key={section} className={styles.pane}>
          <div className={styles.paneInner}>
            {section === 'repositories' ? (
              <>
                <Repositories config={config} />
                <section className={styles.section}>
                  <BaseOrder config={config} />
                  <ActiveThreshold config={config} />
                </section>
              </>
            ) : section === 'general' ? (
              <General config={config} />
            ) : (
              <Shortcuts />
            )}
          </div>
        </div>
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
                    <Button size={28} onClick={() => void locate(repo)}>
                      Locate…
                    </Button>
                  </>
                ) : s?.status === 'error' ? (
                  <Pill tone="danger" title={s.error ?? undefined}>
                    git error
                  </Pill>
                ) : (
                  <span className={styles.note}>{s?.defaultBase ? `base ${s.defaultBase}` : s ? 'no base found' : ''}</span>
                )}
                <IconButton aria-label="Remove repository" onClick={() => remove(repo)}>
                  <CloseIcon size={13} />
                </IconButton>
              </div>
              {errors[repo.id] && <div className={styles.error}>{errors[repo.id]}</div>}
            </div>
          );
        })}
        <div className={styles.addRow}>
          <Button variant="link" onClick={() => void openAddRepos()}>
            + Add repository…
          </Button>
        </div>
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
              <Button size={36} onClick={() => setRemoving(null)}>
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

/** Changing it rescans every repo (as does the default base). */
function ActiveThreshold({ config }: { config: Config }) {
  const { activeDays } = config.settings;
  const [days, setDays] = useState(String(activeDays));
  // Follow changes saved elsewhere (or the normalized value after a save).
  useEffect(() => setDays(String(activeDays)), [activeDays]);

  const saveDays = () => {
    const n = parseDays(days);
    if (n === null || n === activeDays) {
      setDays(String(activeDays));
      return;
    }
    void updateSettings({ ...config.settings, activeDays: n });
  };

  return (
    <label className={styles.setting}>
      <span className={styles.settingText}>
        <span className={styles.settingName}>Active threshold</span>
        <span className={styles.settingHint}>Branches without a worktree are listed if committed within</span>
      </span>
      <span className={styles.days}>
        <Input
          mono
          size={36}
          className={styles.daysInput}
          value={days}
          inputMode="numeric"
          onChange={setDays}
          onBlur={saveDays}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              saveDays();
              e.currentTarget.blur();
            }
          }}
        />
        <span className={styles.settingHint}>days</span>
      </span>
    </label>
  );
}

function General({ config }: { config: Config }) {
  return (
    <>
      <h2 className={styles.heading}>General</h2>
      <Appearance config={config} />
      <section className={styles.section}>
        <TerminalSetting config={config} />
        <label className={styles.setting}>
          <span className={styles.settingText}>
            <span className={styles.settingName}>Check for updates</span>
            <span className={styles.settingHint}>At launch and every 6 hours; a new version shows in the sidebar</span>
          </span>
          <Checkbox
            checked={config.settings.checkUpdates}
            onChange={(e) => void updateSettings({ ...config.settings, checkUpdates: e.target.checked })}
          />
        </label>
      </section>
    </>
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
        <Select<TerminalChoice>
          aria-label="Terminal"
          value={terminal}
          onChange={(t) => void updateSettings({ ...config.settings, terminal: t })}
          options={[
            { value: 'auto', label: `Automatic${termApp ? ` (${termApp.name})` : ''}` },
            { value: 'terminal', label: 'Terminal', disabled: missing('terminal') },
            { value: 'iterm', label: 'iTerm2', disabled: missing('iterm') },
            { value: 'wezterm', label: 'WezTerm', disabled: missing('wezterm') },
            { value: 'other', label: 'Other…' },
          ]}
        />
      </label>
      {terminal === 'other' && (
        <label className={styles.terminalOther}>
          <span className={styles.srOnly}>Terminal command</span>
          <Input
            mono
            size={36}
            className={styles.terminalCommand}
            placeholder="wezterm start --cwd %"
            value={command}
            onChange={setCommand}
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
