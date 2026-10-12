// Monaco without its language services. The full `monaco-editor` entry adds TypeScript, CSS, HTML
// and JSON workers (hovers, symbols, formatting: about 9 MB of code, and a worker process for each
// language a diff shows); a read-only diff needs only coloring, which the Monarch grammars do on
// the main thread. Contributions that need a language service or only edit text are left out.
import { languages } from 'monaco-editor/editor/editor.api';
import { createTokenizationSupport } from 'monaco-editor/languages/features/json/tokenization';
import 'monaco-editor/languages/definitions/register.all';
import 'monaco-editor/features/anchorSelect/register';
import 'monaco-editor/features/bracketMatching/register';
import 'monaco-editor/features/clipboard/register';
import 'monaco-editor/features/codicon/register';
// Color swatches in CSS come from the editor worker's default provider.
import 'monaco-editor/features/colorPicker/register';
import 'monaco-editor/features/cursorUndo/register';
import 'monaco-editor/features/diffEditor/register';
import 'monaco-editor/features/find/register';
import 'monaco-editor/features/folding/register';
import 'monaco-editor/features/gotoLine/register';
import 'monaco-editor/features/hover/register';
import 'monaco-editor/features/lineSelection/register';
import 'monaco-editor/features/links/register';
import 'monaco-editor/features/longLinesHelper/register';
import 'monaco-editor/features/middleScroll/register';
import 'monaco-editor/features/multicursor/register';
import 'monaco-editor/features/readOnlyMessage/register';
import 'monaco-editor/features/smartSelect/register';
import 'monaco-editor/features/toggleTabFocusMode/register';
import 'monaco-editor/features/tokenization/register';
import 'monaco-editor/features/unicodeHighlighter/register';
import 'monaco-editor/features/unusualLineTerminators/register';
import 'monaco-editor/features/wordHighlighter/register';
import 'monaco-editor/features/wordOperations/register';
import 'monaco-editor/features/wordPartOperations/register';

export * from 'monaco-editor/editor/editor.api';

// JSON has no Monarch grammar: its language service registered it and colored it with this
// tokenizer, which runs on the main thread.
languages.register({
  id: 'json',
  extensions: ['.json', '.bowerrc', '.jshintrc', '.jscsrc', '.eslintrc', '.babelrc', '.har'],
  aliases: ['JSON', 'json'],
  mimetypes: ['application/json'],
});
languages.setTokensProvider('json', createTokenizationSupport(true));
languages.setLanguageConfiguration('json', {
  wordPattern: /(-?\d*\.\d\w*)|([^[{\]}:",\s]+)/g,
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
});
