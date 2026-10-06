// The keyboard shortcuts listed in Settings. Not editable, so handlers do not read this list;
// each handler is marked "Listed in lib/shortcuts.ts". Change both together.

export interface Shortcut {
  label: string;
  /** Keycaps; "/" is shown as a separator between alternatives. */
  keys: string[];
  note?: string;
}
export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'General',
    items: [
      { label: 'New project', keys: ['⌘', 'N'] },
      { label: 'Back', keys: ['⌘', '['], note: 'also ⌘←' },
      { label: 'Forward', keys: ['⌘', ']'], note: 'also ⌘→' },
      { label: 'Settings', keys: ['⌘', ','] },
      { label: 'Font size', keys: ['⌘', '-', '/', '⌘', '.'], note: '⌘0 resets' },
      { label: 'Close menu or dialog', keys: ['esc'], note: 'or clear selection' },
    ],
  },
  {
    title: 'Branches and projects',
    items: [
      { label: 'Focus filter', keys: ['⌘', 'K'], note: 'Branches, Review files, History search' },
      { label: 'Add branches', keys: ['⌘', 'K'], note: 'Project' },
      { label: 'Review changes', keys: ['⌘', 'R'], note: 'Project' },
      { label: 'Rename project', keys: ['F2'] },
      { label: 'Collapse or expand all repos', keys: ['⌥', 'click'], note: 'Branches, on a repo' },
    ],
  },
  {
    title: 'Review',
    items: [
      { label: 'Next change', keys: ['⌥', '↓'], note: 'then next file' },
      { label: 'Previous change', keys: ['⌥', '↑'] },
      { label: 'Newer commit', keys: ['⌥', '⇧', '↑'], note: 'also History' },
      { label: 'Older commit', keys: ['⌥', '⇧', '↓'] },
      { label: 'Split / Unified', keys: ['⌥', 'V'] },
      { label: 'Changes only / Whole file', keys: ['⌥', 'C'] },
      { label: 'Ignore whitespace', keys: ['⌥', 'W'] },
      { label: 'Review / History', keys: ['⌥', 'H'], note: 'of the same branch' },
    ],
  },
  {
    title: 'Lists and dialogs',
    items: [
      { label: 'Move', keys: ['↑', '/', '↓'] },
      { label: 'Mark row', keys: ['space'], note: 'Add palette' },
      { label: 'Confirm', keys: ['↵'] },
      { label: 'Run script', keys: ['⌘', '↵'], note: 'Script inputs' },
      { label: 'Cancel', keys: ['esc'] },
    ],
  },
];
