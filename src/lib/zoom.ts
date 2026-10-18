// View › Font Size zooms the whole main window, but the native traffic lights do not move or
// grow: the room left for them is divided by the zoom (`--zoom`), so the buttons beside them stay
// put. Cached for the next launch (the window shows before the config arrives).
const KEY = 'gitgel.zoom';

/** Sets `--zoom` from the config's percent and remembers it. */
export function applyZoom(percent: number): void {
  document.documentElement.style.setProperty('--zoom', String(percent / 100));
  try {
    localStorage.setItem(KEY, String(percent));
  } catch {
    // The next launch starts at 100 until the config arrives.
  }
}

/** The last launch's zoom, before the first render. */
export function applyCachedZoom(): void {
  try {
    const percent = Number(localStorage.getItem(KEY));
    if (percent > 0) document.documentElement.style.setProperty('--zoom', String(percent / 100));
  } catch {
    // Nothing cached.
  }
}
