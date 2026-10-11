import { describe, expect, it } from 'vitest';
import type { EntrySummary, ScriptConfig, ScriptInput } from '../lib/types';
import { defaultInputs, fillName } from './runs';
import { newScript } from './ScriptEditor';

const entry: EntrySummary = {
  key: 'r_1:session-token-refresh',
  repoId: 'r_1',
  repoName: 'web-app',
  branch: 'session-token-refresh',
  worktreePath: '/wt/token',
  headSha: 'abc1234',
  shortSha: 'abc1234',
  base: 'main',
  baseIsCustom: false,
  ahead: 4,
  behind: 0,
  files: 9,
  add: 1,
  del: 1,
  uncommitted: 3,
  conflicts: 0,
  lastCommitAt: 0,
  changedAt: null,
  upstream: null,
  operation: null,
  state: 'ok',
  error: null,
};

const input = (id: string, extra: Partial<ScriptInput> = {}): ScriptInput => ({
  id,
  label: id,
  type: 'text',
  default: '',
  options: [],
  required: false,
  when: '',
  ...extra,
});

describe('fillName', () => {
  it('fills branch, base and repo', () => {
    expect(fillName('Rebase {branch} on {base}… ({repo})', entry)).toBe(
      'Rebase session-token-refresh on main… (web-app)',
    );
    expect(fillName('{branch}', { ...entry, branch: null })).toBe('abc1234');
  });
});

describe('defaultInputs', () => {
  it('sends the shown inputs with their defaults, never the hidden ones', () => {
    const script: ScriptConfig = {
      ...newScript(),
      inputs: [
        input('MOCK', { type: 'checkbox', default: '1' }),
        input('API', { default: 'staging', when: '!inputs.mock' }),
        input('PORT', { default: '3000', when: 'branch.checkedOut' }),
      ],
    };
    expect(defaultInputs(script, entry, 'branches')).toEqual({ MOCK: '1', PORT: '3000' });
    expect(defaultInputs(script, { ...entry, worktreePath: null }, 'branches')).toEqual({ MOCK: '1' });
  });
});

describe('a run that ends before its start is answered', () => {
  it('keeps the end and its toast', async () => {
    const { vi } = await import('vitest');
    const ended = {
      runId: 'run_1',
      status: 'exited',
      exitCode: 0,
      name: 'test',
      lastLine: 'test',
      repoLabel: 'gitgel / master',
    };
    vi.doMock('../lib/ipc', () => ({
      runScript: async () => {
        const { applyRunExited } = await import('./runs');
        applyRunExited(ended as never);
        return { ...ended, status: 'running', exitCode: null };
      },
    }));
    vi.resetModules();
    const { startScript, useRuns } = await import('./runs');
    const { useUi } = await import('../state/ui');
    await startScript({ ...newScript(), name: 'test', command: 'echo test' }, entry, 'branches');
    expect(useRuns.getState().runs.run_1.status).toBe('exited');
    expect(useUi.getState().toast?.status).toBe('success');
    vi.doUnmock('../lib/ipc');
  });
});

describe('tokenizeCommand', () => {
  it('marks $VAR and ${VAR} outside single quotes, leaving the rest as text', async () => {
    const { tokenizeCommand } = await import('./OutputPanel');
    expect(tokenizeCommand('git checkout $GITGEL_BRANCH -m "$GITGEL_MSG"')).toEqual([
      { text: 'git checkout ' },
      { text: '$GITGEL_BRANCH', variable: 'GITGEL_BRANCH' },
      { text: ' -m "' },
      { text: '$GITGEL_MSG', variable: 'GITGEL_MSG' },
      { text: '"' },
    ]);
    expect(tokenizeCommand("echo '${NOT_A_VAR}' \\$LITERAL $5 ${UN_CLOSED")).toEqual([
      { text: "echo '${NOT_A_VAR}' \\$LITERAL " },
      { text: '$5', variable: '5' },
      { text: ' ${UN_CLOSED' },
    ]);
    expect(tokenizeCommand(`echo "it's $X" '$Y'`)).toEqual([
      { text: 'echo "it\'s ' },
      { text: '$X', variable: 'X' },
      { text: `" '$Y'` },
    ]);
  });
});

describe('plainText', () => {
  it('drops colours, titles and carriage returns for Copy output', async () => {
    const { plainText } = await import('./OutputPanel');
    expect(plainText('\x1b[32m ✓ ok\x1b[0m\r\n\x1b]0;title\x07done')).toBe(' ✓ ok\ndone');
  });
});

describe('shownInputs', () => {
  it('evaluates each condition against the shown inputs before it', async () => {
    const { shownInputs } = await import('./runs');
    const script: ScriptConfig = {
      ...newScript(),
      inputs: [
        input('DRAFT', { type: 'checkbox', default: '1' }),
        input('REVIEWER', { when: '!inputs.draft' }),
        input('BAD', { when: 'branch.nope' }),
      ],
    };
    const ids = (values: Record<string, string>) =>
      shownInputs(script, entry, 'branches', undefined, values).map((x) => [x.input.id, x.error !== null]);
    expect(ids({ DRAFT: '1' })).toEqual([
      ['DRAFT', false],
      ['BAD', true],
    ]);
    expect(ids({ DRAFT: '' })).toEqual([
      ['DRAFT', false],
      ['REVIEWER', false],
      ['BAD', true],
    ]);
  });
});

describe('a generation run', () => {
  it('toasts only while running; its generate-finished says how it ended', async () => {
    const { applyRunExited, showRunToast } = await import('./runs');
    const { useUi } = await import('../state/ui');
    const run = {
      runId: 'run_ai',
      scriptId: 'ai:generate',
      status: 'running',
      exitCode: null,
      name: 'Generate with Claude Code',
      lastLine: '',
      repoLabel: 'gitgel / master',
    } as never;
    showRunToast(run);
    expect(useUi.getState().toast?.status).toBe('running');
    applyRunExited({ ...(run as object), status: 'exited', exitCode: 0 } as never);
    expect(useUi.getState().toast?.status).toBe('running');
  });
});

describe('a run whose output panel is open', () => {
  it('has no toast; closing the panel brings it back while it runs', async () => {
    const { applyRunExited, showRunToast, useRuns } = await import('./runs');
    const { useUi } = await import('../state/ui');
    const run = {
      runId: 'run_9',
      status: 'running',
      exitCode: null,
      name: 'tests',
      lastLine: '',
      repoLabel: 'web-app / main',
    } as never;
    useRuns.getState().put(run);
    showRunToast(run);
    expect(useUi.getState().toast?.owner).toBe('run_9');

    useRuns.getState().showOutput('run_9');
    expect(useUi.getState().toast).toBeNull();
    useRuns.getState().showOutput(null);
    expect(useUi.getState().toast?.status).toBe('running');

    useRuns.getState().showOutput('run_9');
    applyRunExited({ ...(run as object), status: 'exited', exitCode: 0 } as never);
    expect(useUi.getState().toast).toBeNull();
    useRuns.getState().showOutput(null);
    expect(useUi.getState().toast).toBeNull();
  });
});
