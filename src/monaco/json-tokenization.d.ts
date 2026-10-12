// Monaco's JSON tokenizer module ships without type declarations.
declare module 'monaco-editor/languages/features/json/tokenization' {
  import type * as Monaco from 'monaco-editor';
  export function createTokenizationSupport(supportComments: boolean): Monaco.languages.TokensProvider;
}
