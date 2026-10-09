import { describe, expect, it } from 'vitest';
import type { ScriptConfig } from '../lib/types';
import { sameName, scriptMeta } from './describe';
import { newScript, scriptProblem } from './ScriptEditor';

const base: ScriptConfig = {
  id: '',
  name: 'Run tests',
  icon: 'test',
  command: 'pnpm test',
  inputs: [],
  runsIn: 'worktree',
  showIn: ['branches', 'project'],
  when: '',
  openOutput: true,
  askFirst: false,
  disabled: false,
};

describe('scriptMeta', () => {
  it('names the folder, the menus and the output', () => {
    expect(scriptMeta(base)).toBe('Worktree Folder · Branches, Projects · Opens the output');
    expect(scriptMeta({ ...base, runsIn: 'repo', showIn: ['branches'], openOutput: false })).toBe(
      'Repository Folder · Branches',
    );
    expect(scriptMeta({ ...base, showIn: [] })).toBe('Worktree Folder · No menu · Opens the output');
  });

  it('compares names like the backend', () => {
    expect(sameName(' Run Tests ', 'run tests')).toBe(true);
    expect(sameName('Run tests', 'Run tests (2)')).toBe(false);
  });
});


describe('scriptProblem', () => {
  const ok = { ...newScript(), name: 'Run tests', command: 'pnpm test' };
  const input = (id: string, extra = {}) => ({
    id,
    label: id,
    type: 'text' as const,
    default: '',
    options: [],
    required: false,
    when: '',
    ...extra,
  });

  it('allows a named script with a command', () => {
    expect(scriptProblem(ok)).toBeNull();
  });

  it('names what blocks Save', () => {
    expect(scriptProblem(newScript())).toBe('Give the script a name');
    expect(scriptProblem({ ...ok, command: ' ' })).toBe('Give the script a command');
    expect(scriptProblem({ ...ok, showIn: [] })).toBe('Pick a menu under Show in');
    expect(scriptProblem({ ...ok, inputs: [input('port')] })).toMatch(/A–Z/);
    expect(scriptProblem({ ...ok, inputs: [input('A'), input('A')] })).toMatch(/share/);
    expect(scriptProblem({ ...ok, inputs: [input('API', { type: 'select' })] })).toMatch(/option/);
    expect(scriptProblem({ ...ok, when: 'branch.checkedOt' })).toMatch(/did you mean checkedOut/);
    expect(scriptProblem({ ...ok, inputs: [input('B', { when: 'inputs.later' })] })).toMatch(/Input B/);
  });
});
