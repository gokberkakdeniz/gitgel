// What the command palette lists (SPEC §5 "Command palette"): the app's own commands and places,
// plus what the screen on show adds through `useCommandSource`.
import { useEffect, useId, useRef } from 'react';

/** A row of ⇧⌘P. Only commands that can run now are listed. */
export interface Command {
  id: string;
  title: string;
  /** Group title (translated): General, Project, Review, Branch, Settings. */
  group: string;
  /** The shortcut that does the same, shown on the right. */
  keys?: string;
  run: () => void;
}

/** A row of ⌘P: a place to go, one line after an icon that says what it is. */
export interface GoItem {
  key: string;
  /** Keeps rows of a kind together and orders them; not shown. */
  group: string;
  kind: 'project' | 'worktree' | 'branch';
  /** The project's name, or the branch (or a detached worktree's short SHA). */
  label: string;
  /** A branch's repository, shown muted before it: `web-app/`. */
  repo?: string;
  /** Searched too, not shown: the worktree path. */
  terms?: string;
  /** The project on show's entries: its name above them, a line under them. */
  heading?: string;
  /** The one on show (a project's open entry, the project shown). */
  current?: boolean;
  /** Only listed while searching (older branches). */
  searchOnly?: boolean;
  run: () => void;
}

export interface Contribution {
  /** Places listed before the app's own. */
  go?: GoItem[];
  commands?: Command[];
}

const sources = new Map<string, () => Contribution>();

/** A screen's commands and places while it is mounted; `build` runs when the palette opens, so it
 * reads the screen's state as it is then. */
export function useCommandSource(build: () => Contribution) {
  const id = useId();
  const ref = useRef(build);
  ref.current = build;
  useEffect(() => {
    sources.set(id, () => ref.current());
    return () => {
      sources.delete(id);
    };
  }, [id]);
}

/** What the mounted screens add, in mount order (outer screens first). */
export function contributions(): Contribution[] {
  return [...sources.values()].map((build) => build());
}
