// The repo bands and stash lists collapsed on Branches, by repo id; remembered in localStorage.
import { useState } from 'react';

export const REPOS_KEY = 'gitgel.branches.collapsedRepos';
export const STASHES_KEY = 'gitgel.branches.collapsedStashes';

function read(key: string): Set<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The collapsed ids under `key`, and a setter that remembers them. */
export function useCollapsed(key: string): [Set<string>, (update: (ids: Set<string>) => Set<string>) => void] {
  const [ids, setIds] = useState(() => read(key));
  const set = (update: (ids: Set<string>) => Set<string>) =>
    setIds((prev) => {
      const next = update(prev);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // Not remembered; fine.
      }
      return next;
    });
  return [ids, set];
}

/** `ids` with `id` flipped. */
export function toggled(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (!next.delete(id)) next.add(id);
  return next;
}
