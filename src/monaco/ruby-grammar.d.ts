// Monaco's Ruby grammar module ships without type declarations.
declare module 'monaco-editor/languages/definitions/ruby/ruby' {
  import type * as Monaco from 'monaco-editor';
  export const conf: Monaco.languages.LanguageConfiguration;
  export const language: Monaco.languages.IMonarchLanguage;
}
