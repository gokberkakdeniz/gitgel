# Translating Gitgel (`src/i18n/tr.json`)

The English source is `src/i18n/en.json`: flat keys in namespaces (`branches.*`,
`review.*`, `history.*`, `project.*`, `settings.*`, `palette.*`, `scripts.*`,
`common.*`, `time.*`, …), one MF2 message per key. `pnpm i18n:check` must be
green when you are done: same key set as `en.json`, same placeholders, valid MF2.

## Rules

- Never touch keys, placeholder names (`{$name}`, `{$n}`) or MF2 syntax: the
  `.input` / `.match` lines, variant keys (`1`, `*`), and `{{` `}}` braces stay
  exactly as they are. Only the text around them is translated.
- A count sentence is one key with a select message, all on one JSON line:
  `.input {$n :string} .match $n 1 {{1 repository}} * {{ {$d} repositories}}`.
  `$n` is the raw count the variants pick on; `$d` is how it shows (Number Format
  grouping), `$e` the same for a second count. A plain sentence shows `$d`
  (`{$d} dal`).
  Note the single space at the start of a variant value that begins with `{`:
  messageformat 4.0.0 cannot parse `{{{`, so such variants carry one leading
  space and `t()` strips it. Never start or end a whole message with a space:
  separators between parts (`·`, spaces, commas) stay in the code.
- If your language needs no variants (Turkish nouns do not pluralize with
  numbers), replace the whole `.match` block with a plain sentence showing `$d`
  (and `$e` for a second count): `{$d} dal`.
- Translate whole sentences, never word by word. Place `{$var}` where it reads
  naturally in your language (Turkish puts it differently than English:
  `Update to {$version}` → `{$version} sürümüne güncelle`).
- Counts stay raw (`{$n}`, never `:number`): number grouping belongs to the
  Number Format setting, not to translations.
- Dates, times and ages stay out: they render through the app's format settings.
- Non-translatables, copied verbatim: SHA/path/branch/commit names, git and
  script output, log text, CEL expressions, file paths, keycap names (⌘ ⌥ ⇧).
- Git terms in Turkish follow VS Code's Turkish language pack (`vscode-loc`, its git
  extension): repository → depo, remote → uzak depo, branch → dal, worktree and working
  tree → çalışma ağacı, stash → geçici kayıt (stash → geçici kaydet, apply → uygula,
  drop → bırak, pop → al), fetch → getir, pull → çek, push → gönder (force → zorla),
  merge → birleştir(me), merge base → birleştirme temeli, rebase → yeniden
  temellendir(me), cherry-pick → tek tek seç (the action; one in progress: seçerek
  uygula(ma)), revert → geri döndür(me),
  checkout → kullanıma al, abort → durdur, discard → at, amend → düzelt, sync → eşitle, tag → etiket.
  Commit stays "commit", as VS Code has it.
- Output nothing besides the JSON: no explanations, no comments, no trailing
  commas. Values are single-line strings; `\n` never appears in them.
