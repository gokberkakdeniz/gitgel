// The keyboard shortcuts listed in Settings. Not editable, so handlers do not read this list;
// each handler is marked "Listed in lib/shortcuts.ts". Change both together.
// `label`, `note` and `title` are i18n keys, rendered with `t()` in Settings.

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
    title: 'shortcuts.general',
    items: [
      { label: 'shortcuts.newProject', keys: ['⌘', 'N'] },
      { label: 'shortcuts.toggleSidebar', keys: ['⌘', 'B'] },
      { label: 'shortcuts.back', keys: ['⌘', '['], note: 'shortcuts.backNote' },
      { label: 'shortcuts.forward', keys: ['⌘', ']'], note: 'shortcuts.forwardNote' },
      { label: 'shortcuts.settings', keys: ['⌘', ','] },
      { label: 'shortcuts.fontSize', keys: ['⌘', '-', '/', '⌘', '.'], note: 'shortcuts.fontSizeNote' },
      { label: 'shortcuts.closeDialog', keys: ['esc'], note: 'shortcuts.closeNote' },
    ],
  },
  {
    title: 'shortcuts.branches',
    items: [
      { label: 'shortcuts.focusFilter', keys: ['⌘', 'K'], note: 'shortcuts.focusNote' },
      { label: 'shortcuts.addBranches', keys: ['⌘', 'K'], note: 'shortcuts.inProject' },
      { label: 'shortcuts.reviewChanges', keys: ['⌘', 'R'], note: 'shortcuts.inProject' },
      { label: 'shortcuts.renameProject', keys: ['F2'] },
      { label: 'shortcuts.collapseAll', keys: ['⌥', 'click'], note: 'shortcuts.collapseNote' },
    ],
  },
  {
    title: 'shortcuts.review',
    items: [
      { label: 'shortcuts.nextChange', keys: ['⌥', '↓'], note: 'shortcuts.nextNote' },
      { label: 'shortcuts.prevChange', keys: ['⌥', '↑'] },
      { label: 'shortcuts.newerCommit', keys: ['⌥', '⇧', '↑'], note: 'shortcuts.newerNote' },
      { label: 'shortcuts.olderCommit', keys: ['⌥', '⇧', '↓'] },
      { label: 'shortcuts.splitUnified', keys: ['⌥', 'V'] },
      { label: 'shortcuts.contextWhole', keys: ['⌥', 'C'] },
      { label: 'shortcuts.ignoreWs', keys: ['⌥', 'W'] },
      { label: 'shortcuts.reviewHistory', keys: ['⌥', 'H'], note: 'shortcuts.sameBranch' },
      { label: 'shortcuts.switchBranch', keys: ['⇧', '⌘', 'B'], note: 'shortcuts.inHistory' },
      { label: 'shortcuts.pickFiles', keys: ['⌘', 'click', '/', '⇧', 'click'], note: 'shortcuts.pickNote' },
      { label: 'shortcuts.pickCommits', keys: ['⌘', 'click', '/', '⇧', 'click'], note: 'shortcuts.inHistory' },
    ],
  },
  {
    title: 'shortcuts.lists',
    items: [
      { label: 'shortcuts.move', keys: ['↑', '/', '↓'] },
      { label: 'shortcuts.markRow', keys: ['space'], note: 'shortcuts.markNote' },
      { label: 'shortcuts.confirm', keys: ['↵'] },
      { label: 'shortcuts.runScript', keys: ['⌘', '↵'], note: 'shortcuts.runNote' },
      { label: 'shortcuts.commit', keys: ['⌘', '↵'], note: 'shortcuts.commitNote' },
      { label: 'shortcuts.cancel', keys: ['esc'] },
    ],
  },
];

/** A field the user types in, where keys edit text. Not the read-only diff: Monaco's hidden
 * textarea is there only to take keys, so the app's shortcuts work inside it too. */
export function isTextField(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t?.closest('input, textarea, [contenteditable]') && !t.closest('.monaco-editor');
}
