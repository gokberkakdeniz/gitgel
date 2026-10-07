/** Where the cursor is in the diff on screen (its modified side), for opening that file in an editor
 * at the same line. Read when a menu item is picked, so it is not state. */
let at: { path: string; line: number; column: number } | null = null;

export function setDiffPosition(path: string, line: number, column: number) {
  at = { path, line, column };
}

/** The cursor in the diff of `path`, if that is the file the diff shows. */
export function diffPosition(path: string): { line: number; column: number } | null {
  return at && at.path === path ? { line: at.line, column: at.column } : null;
}
