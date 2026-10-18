// View › Font Size zooms the whole main window, but the native traffic lights do not move or
// grow. The strip beside them (the page header, the sidebar's top row) is zoomed back by the
// inverse (`--unzoom`), so it keeps its size and stays lined up with them. Cached for the next
// launch (the window shows before the config arrives).
const KEY = 'gitgel.zoom';

function setUnzoom(percent: number): void {
  document.documentElement.style.setProperty('--unzoom', String(100 / percent));
}

/** Sets `--unzoom` from the config's percent and remembers it. */
export function applyZoom(percent: number): void {
  setUnzoom(percent);
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
    if (percent > 0) setUnzoom(percent);
  } catch {
    // Nothing cached.
  }
}
