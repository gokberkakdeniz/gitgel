// Show when (SPEC §14): CEL conditions on a branch, and on the inputs before an input.
import { Environment } from '@marcbachmann/cel-js';
import { t } from '../i18n';
import type { EntrySummary, ScriptInput } from '../lib/types';

/** The `branch` fields a condition can use, with their CEL types. */
export const BRANCH_FIELDS = {
  name: 'string',
  repo: 'string',
  base: 'string',
  checkedOut: 'bool',
  detached: 'bool',
  uncommitted: 'int',
  ahead: 'int',
  behind: 'int',
  merged: 'bool',
  project: 'string', // Project Entry Menu only; test with has(branch.project)
  menu: 'string', // 'branches' | 'project'
} as const;

export type ScriptMenuName = 'branches' | 'project';

export interface BranchContext {
  name: string;
  repo: string;
  base: string;
  checkedOut: boolean;
  detached: boolean;
  uncommitted: bigint;
  ahead: bigint;
  behind: bigint;
  merged: boolean;
  project?: string;
  menu: ScriptMenuName;
}

/** The branch as a condition sees it. */
export function branchContext(e: EntrySummary, menu: ScriptMenuName, project?: string): BranchContext {
  return {
    name: e.branch ?? '',
    repo: e.repoName,
    base: e.base ?? '',
    checkedOut: e.worktreePath !== null,
    detached: e.branch === null,
    uncommitted: BigInt(e.uncommitted ?? 0),
    ahead: BigInt(e.ahead ?? 0),
    behind: BigInt(e.behind ?? 0),
    merged: e.state === 'merged',
    ...(project !== undefined ? { project } : {}),
    menu,
  };
}

/** Input values as conditions see them: `inputs.<id in lower case>`, a checkbox as a bool. */
export function inputsContext(inputs: ScriptInput[], values: Record<string, string>): Record<string, string | boolean> {
  return Object.fromEntries(
    inputs.map((i) => [i.id.toLowerCase(), i.type === 'checkbox' ? values[i.id] === '1' : (values[i.id] ?? '')]),
  );
}

function environment(inputs: ScriptInput[] | null): Environment {
  const env = new Environment().registerVariable({ name: 'branch', schema: { ...BRANCH_FIELDS } });
  if (inputs) {
    const schema = Object.fromEntries(
      inputs.map((i) => [i.id.toLowerCase(), i.type === 'checkbox' ? 'bool' : 'string']),
    );
    env.registerVariable({ name: 'inputs', schema });
  }
  return env;
}

const scriptEnv = environment(null);

/** The closest name by edit distance, if it is close enough to be a typo. */
function closest(word: string, names: string[]): string | null {
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of names) {
    const dd = dist(word.toLowerCase(), n.toLowerCase());
    if (dd < bestD) [best, bestD] = [n, dd];
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

function message(expr: string, raw: string, inputs: ScriptInput[] | null): string {
  const unknown = raw.match(/No such key: (\w+)/);
  if (unknown) {
    const key = unknown[1];
    const inBranch = new RegExp(`branch\\.${key}\\b`).test(expr);
    const names = inBranch ? Object.keys(BRANCH_FIELDS) : (inputs ?? []).map((i) => i.id.toLowerCase());
    const where = inBranch ? 'branch' : 'inputs';
    const guess = closest(key, names);
    return t('scripts.noField', { field: `${where}.${key}` }) + (guess ? ` ${t('scripts.didMean', { guess })}` : '');
  }
  return raw.split('\n')[0];
}

/**
 * Checks a condition without running it. `inputs`: for an input's condition, the inputs before
 * it. Returns the error to show, or null when it is valid (or empty).
 */
export function checkWhen(expr: string, inputs: ScriptInput[] | null = null): string | null {
  if (!expr.trim()) return null;
  try {
    const result = (inputs ? environment(inputs) : scriptEnv).check(expr);
    if (!result.valid) return message(expr, result.error?.message ?? t('scripts.notValid'), inputs);
    if (result.type !== 'bool' && result.type !== 'dyn') return t('scripts.mustBool', { type: result.type });
    return null;
  } catch (e) {
    return message(expr, e instanceof Error ? e.message : String(e), inputs);
  }
}

/** The scripts a branch menu lists: on, shown in this menu and Show when matching, in order. */
export function menuScripts<S extends { disabled: boolean; showIn: string[]; when: string }>(
  scripts: S[],
  menu: ScriptMenuName,
  branch: BranchContext,
): S[] {
  return scripts.filter((s) => !s.disabled && s.showIn.includes(menu) && evalWhen(s.when, branch));
}

/**
 * Whether a script (or an input) shows. Empty shows it; a condition that fails or does not give
 * true hides it.
 */
export function evalWhen(
  expr: string,
  branch: BranchContext,
  inputs?: { defs: ScriptInput[]; values: Record<string, string> },
): boolean {
  if (!expr.trim()) return true;
  try {
    const env = inputs ? environment(inputs.defs) : scriptEnv;
    const ctx = inputs ? { branch, inputs: inputsContext(inputs.defs, inputs.values) } : { branch };
    return env.evaluate(expr, ctx) === true;
  } catch {
    return false;
  }
}
