// The sidebar's project order, shared with lists that follow it (Branches' Projects menu).
import type { ProjectConfig } from './types';

export type ProjectSort = 'created' | 'name';
const KEY = 'gitgel.projectSort';

export function readProjectSort(): ProjectSort {
  try {
    return localStorage.getItem(KEY) === 'name' ? 'name' : 'created';
  } catch {
    return 'created';
  }
}

export function writeProjectSort(sort: ProjectSort): void {
  try {
    localStorage.setItem(KEY, sort);
  } catch {
    // Not remembered; fine.
  }
}

/** Config order is creation order. */
export function sortProjects<T extends Pick<ProjectConfig, 'name'>>(projects: T[], sort: ProjectSort): T[] {
  return sort === 'name' ? [...projects].sort((a, b) => a.name.localeCompare(b.name)) : projects;
}
