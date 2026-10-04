import { describe, expect, it } from 'vitest';
import type { EntrySummary, ScriptInput } from '../lib/types';
import { branchContext, checkWhen, evalWhen, menuScripts } from './when';

const entry = (over: Partial<EntrySummary> = {}): EntrySummary => ({
  key: 'r_1:session-token-refresh',
  repoId: 'r_1',
  repoName: 'web-app',
  branch: 'session-token-refresh',
  worktreePath: '/wt/token',
  headSha: 'abc',
  shortSha: 'abc',
  base: 'main',
  baseIsCustom: false,
  ahead: 4,
  behind: 0,
  files: 9,
  add: 1,
  del: 1,
  uncommitted: 3,
  lastCommitAt: 0,
  changedAt: null,
  state: 'ok',
  error: null,
  ...over,
});

const input = (id: string, type: ScriptInput['type'] = 'text'): ScriptInput => ({
  id,
  label: id,
  type,
  default: '',
  options: [],
  required: false,
  when: '',
});

describe('menuScripts', () => {
  it('lists the scripts that are on, in this menu and matching, in order', () => {
    const b = branchContext(entry(), 'branches');
    const s = (name: string, over: { disabled?: boolean; showIn?: string[]; when?: string } = {}) => ({
      name,
      disabled: false,
      showIn: ['branches', 'project'],
      when: '',
      ...over,
    });
    const scripts = [
      s('a'),
      s('off', { disabled: true }),
      s('project only', { showIn: ['project'] }),
      s('no match', { when: "branch.repo == 'other'" }),
      s('b', { when: 'branch.checkedOut' }),
    ];
    expect(menuScripts(scripts, 'branches', b).map((x) => x.name)).toEqual(['a', 'b']);
  });
});

describe('branch conditions', () => {
  const b = branchContext(entry(), 'branches');

  it('reads every field', () => {
    expect(evalWhen("branch.repo == 'web-app' && branch.checkedOut", b)).toBe(true);
    expect(evalWhen('branch.ahead > 0 && !branch.merged && branch.uncommitted == 3', b)).toBe(true);
    expect(evalWhen("branch.name.startsWith('session') && branch.base == 'main'", b)).toBe(true);
    expect(evalWhen("branch.menu == 'project'", b)).toBe(false);
    expect(evalWhen('branch.detached', branchContext(entry({ branch: null }), 'branches'))).toBe(true);
    expect(evalWhen('branch.checkedOut', branchContext(entry({ worktreePath: null }), 'branches'))).toBe(false);
  });

  it('has project only in the Project menu', () => {
    expect(evalWhen('has(branch.project)', b)).toBe(false);
    expect(evalWhen("branch.project == 'Auth'", b)).toBe(false); // fails, so hidden
    expect(evalWhen("branch.project == 'Auth'", branchContext(entry(), 'project', 'Auth'))).toBe(true);
  });

  it('shows on empty, hides on anything but true', () => {
    expect(evalWhen('  ', b)).toBe(true);
    expect(evalWhen('branch.ahead', b)).toBe(false);
  });
});

describe('checkWhen', () => {
  it('accepts valid and empty conditions', () => {
    expect(checkWhen('')).toBeNull();
    expect(checkWhen("branch.repo == 'web-app' && branch.checkedOut")).toBeNull();
  });

  it('suggests the field for a typo', () => {
    expect(checkWhen("branch.repo == 'web-app' && branch.checkedOt")).toBe(
      'No such field: branch.checkedOt (did you mean checkedOut?)',
    );
    expect(checkWhen('branch.zzzzzzzz')).toBe('No such field: branch.zzzzzzzz');
  });

  it('rejects syntax errors, wrong types and non-bool results', () => {
    expect(checkWhen('branch.repo ==')).not.toBeNull();
    expect(checkWhen('foo == 1')).toMatch(/foo/);
    expect(checkWhen("branch.ahead + 'x'")).not.toBeNull();
    expect(checkWhen('branch.ahead')).toBe('Must be true or false, not int');
  });
});

describe('input conditions', () => {
  const defs = [input('MOCK', 'checkbox'), input('API', 'select')];

  it('sees earlier inputs in lower case, checkboxes as bools', () => {
    expect(checkWhen('!inputs.mock', defs.slice(0, 1))).toBeNull();
    expect(checkWhen('inputs.api == "x"', defs.slice(0, 1))).toMatch(/inputs\.api/);
    const b = branchContext(entry(), 'branches');
    expect(evalWhen('!inputs.mock', b, { defs, values: { MOCK: '1' } })).toBe(false);
    expect(evalWhen('!inputs.mock', b, { defs, values: { MOCK: '' } })).toBe(true);
  });
});
