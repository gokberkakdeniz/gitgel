// Dev only (`pnpm dev`, then open /#list, or /#list-light): every variant of `ListSpec.dc.html`, to compare with
// the board in both themes. main.tsx loads it only in development.
import { useState, type CSSProperties } from 'react';
import { Button } from './Button';
import { List, type ListAction, type ListItem } from './List';

const x = (label: string): ListAction => ({ icon: 'close', ariaLabel: label });

const repos: ListItem[] = [
  {
    key: 'web',
    title: 'web-app',
    titleWeight: 500,
    titleWidth: 96,
    detail: '~/code/web-app',
    aside: 'base main',
    actions: [x('Remove repository')],
  },
  {
    key: 'api',
    title: 'api-server',
    titleWeight: 500,
    titleWidth: 96,
    detail: '~/code/api-server',
    aside: 'base main',
    actions: [x('Remove repository')],
  },
  {
    key: 'admin',
    title: 'admin-panel',
    titleWeight: 500,
    titleWidth: 96,
    detail: '~/old/admin-panel',
    actions: [
      { kind: 'pill', label: 'path not found', tone: 'danger' },
      { label: 'Locate…', variant: 'secondary', ariaLabel: 'Locate admin-panel' },
      x('Remove repository'),
    ],
  },
];

const bases = (hover: number): ListItem[] =>
  ['origin/HEAD', 'main', 'master'].map((n, i, all) => ({
    key: n,
    lead: 'index',
    leadText: String(i + 1),
    title: n,
    titleMono: true,
    active: i === hover,
    actionsOnHover: true,
    actions: [
      { icon: 'arrow-up', ariaLabel: `Move ${n} up`, disabled: i === 0 },
      { icon: 'arrow-down', ariaLabel: `Move ${n} down`, disabled: i === all.length - 1 },
      x(`Remove ${n}`),
    ],
  }));

const script = (name: string, icon: 'pull-request' | 'test' | 'link', off = false): ListItem => ({
  key: name,
  handle: { 'aria-label': `Move ${name}` },
  lead: 'tile',
  icon,
  title: name,
  titleWeight: 500,
  off,
  badges: off ? [{ label: 'off', tone: 'neutral' }] : [],
  actions: [
    {
      kind: 'switch',
      checked: !off,
      ariaLabel: `${name} on`,
      title: off ? 'Off: in no menu. Switch on to show it' : 'On: shown in its menus. Switch off to hide it',
      onToggle: () => {},
    },
    { icon: 'edit', ariaLabel: `Edit ${name}` },
    x(`Remove ${name}`),
  ],
});

const stashes: ListItem[] = [
  {
    key: '0',
    lead: 'icon',
    icon: 'package',
    prefix: 'stash@{0}',
    title: 'debug logging for refresh',
    sub: [{ pill: 'session-token-refresh', tone: 'accent' }, { text: '1 file' }, { text: '20m' }],
    active: true,
    actions: [{ icon: 'more-vertical', ariaLabel: 'Stash options', active: true }],
  },
  {
    key: '1',
    lead: 'icon',
    icon: 'package',
    prefix: 'stash@{1}',
    title: 'WIP on old-login: 71be0c2 Try new login form',
    sub: [{ pill: 'old-login · deleted', tone: 'outline' }, { text: '5 files' }, { text: '3w' }],
    actions: [{ icon: 'more-vertical', ariaLabel: 'Stash options' }],
  },
];

const h2: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};
const note: CSSProperties = { fontSize: 12, color: 'var(--text-faint)' };
const col: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };

export function ListStory() {
  const [theme, setTheme] = useState(() => {
    const t =
      window.location.hash === '#list-light'
        ? 'gitgel-light'
        : (document.documentElement.dataset.theme ?? 'gitgel-dark');
    document.documentElement.dataset.theme = t;
    return t;
  });
  const flip = () => {
    const next = theme === 'gitgel-dark' ? 'gitgel-light' : 'gitgel-dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.background = '';
    setTheme(next);
  };
  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg-main)' }}>
      <div
        style={{
          width: 1040,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          padding: '40px 48px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-serif)',
              fontSize: 28,
              fontWeight: 400,
              color: 'var(--text-strong)',
            }}
          >
            List
          </h1>
          <Button onClick={flip}>{theme === 'gitgel-dark' ? 'Light' : 'Dark'}</Button>
        </div>

        <section style={col}>
          <h2 style={h2}>Settings › Repositories · regular</h2>
          <List label="Repositories" items={repos} addLabel="+ Add repository" onAdd={() => {}} />
          <span style={note}>
            titleWeight 500 + titleWidth 96; aside "base main"; a missing repo: danger Pill + Locate; ✕
          </span>
        </section>

        <section style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
          <div style={col}>
            <h2 style={h2}>Default base · compact, radius 10</h2>
            <List
              label="Default base order"
              ordered
              density="compact"
              radius={10}
              width={280}
              items={bases(1)}
              addLabel="+ Add branch"
              onAdd={() => {}}
            />
            <span style={note}>↑ ↓ ✕ show on hover (row 2)</span>
          </div>
          <div style={col}>
            <h2 style={h2}>Adding · invalid</h2>
            <List
              label="Default base order"
              ordered
              density="compact"
              radius={10}
              width={280}
              items={bases(-1)}
              adding={{
                value: 'release candidate',
                onChange: () => {},
                placeholder: 'Branch name, e.g. develop',
                invalid: true,
                'aria-label': 'Add a base branch',
              }}
            />
            <span style={note}>the add row becomes a 28px mono Input</span>
          </div>
          <div style={col}>
            <h2 style={h2}>Empty</h2>
            <List label="Scripts" items={[]} empty="No scripts yet" width={300} />
          </div>
        </section>

        <section style={col}>
          <h2 style={h2}>Settings › Scripts · regular, tile lead</h2>
          <List
            label="Scripts"
            items={[
              script('Open pull request', 'pull-request'),
              script('Run tests', 'test'),
              script('Copy Linear link', 'link', true),
            ]}
          />
          <span style={note}>handle + tile; Switch, ✎, ✕; an off script dims its tile and title</span>
        </section>

        <section style={col}>
          <h2 style={h2}>Stashes · heading, icon lead, sub line</h2>
          <List heading="Stashes" items={stashes} />
          <span style={note}>sub: branch as an accent Pill (outline when gone) · files · age; row 1 menu open</span>
        </section>
      </div>
    </div>
  );
}
