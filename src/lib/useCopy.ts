import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useEffect, useRef, useState } from 'react';

/** How long a copy button says "Copied". */
const COPIED_MS = 1500;

/** Copies to the clipboard; `copied` is true for a moment after, so the button can say so. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (text: string | (() => Promise<string>)) => {
    await writeText(typeof text === 'string' ? text : await text());
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };
  return { copied, copy };
}
