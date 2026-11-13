// Monaco from the local bundle (no CDN), with its diff worker. Loaded before App in main.tsx.
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { language as rubyLanguage } from 'monaco-editor/languages/definitions/ruby/ruby';
import * as monaco from './monaco';
import { guardTopLevelEnd } from './ruby';
import { isEffective, onThemesChange } from '../themes';
import { defineTheme } from './theme';

// The only worker: it computes diffs (and CSS color swatches); there are no language services.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Registered directly, it replaces the grammar Monaco would load on first use.
monaco.languages.setMonarchTokensProvider('ruby', guardTopLevelEnd(rubyLanguage));

// Typed for the full entry; the wrapper uses only `editor`.
loader.config({ monaco: monaco as unknown as typeof import('monaco-editor') });
defineTheme(monaco);
// Custom themes arrive after launch and can change while the app runs; the one on show is set again.
onThemesChange(() => {
  defineTheme(monaco);
  const shown = document.documentElement.dataset.theme;
  if (isEffective(shown)) monaco.editor.setTheme(shown);
});

/** Resolves once JetBrains Mono is loaded and Monaco has measured it. */
export const monacoReady: Promise<void> = document.fonts
  .load('12px "JetBrains Mono"')
  .then(() => monaco.editor.remeasureFonts())
  .catch(() => undefined);
