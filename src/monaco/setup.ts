// Monaco from the local bundle (no CDN), with its workers. Imported first in main.tsx.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { language as rubyLanguage } from 'monaco-editor/languages/definitions/ruby/ruby';
import { guardTopLevelEnd } from './ruby';
import { defineTheme } from './theme';

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

// Review is read-only and sees files out of their project: no red squiggles.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  });
}
monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: false });
for (const defaults of [monaco.css.cssDefaults, monaco.css.scssDefaults, monaco.css.lessDefaults]) {
  defaults.setOptions({ validate: false });
}

// Registered directly, it replaces the grammar Monaco would load on first use.
monaco.languages.setMonarchTokensProvider('ruby', guardTopLevelEnd(rubyLanguage));

loader.config({ monaco });
defineTheme(monaco);

/** Resolves once JetBrains Mono is loaded and Monaco has measured it. */
export const monacoReady: Promise<void> = document.fonts
  .load('12px "JetBrains Mono"')
  .then(() => monaco.editor.remeasureFonts())
  .catch(() => undefined);
