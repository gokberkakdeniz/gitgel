# Gitgel — Task listesi

Bu dosya projenin tek iş planı: ürün özeti, mimari kararlar, paylaşılan tipler, git komutları,
fazlara bölünmüş task'lar ve en sonda ilerleme takibi. Eski `docs/SPEC.md`'nin hâlâ geçerli
kısımları buraya taşındı; SPEC silindi.

---

## 0. Önce bunu oku (her agent için)

### Kaynaklar ve öncelik

1. `design/HANDOFF.md` — UI ve davranışın kaynağı. Bu dosyayla çelişirse **HANDOFF kazanır**.
2. `design/screens/*.dc.html` — her ekranın renkleri, ölçüleri, boşlukları ve metinleri. Sadece
   değer okumak için. Template sözdizimini (`{{…}}`, `<sc-for>`, `<sc-if>`, `renderVals()`)
   uygulamaya kopyalama, dosyaları render etmeye çalışma. Ekranlardaki örnek veri ve kod sahtedir.
   Stiller çoğunlukla `renderVals()` içindeki string'lerde; oraya da bak.
3. Bu dosya — mimari, komutlar, tipler ve HANDOFF §5'teki açık sorular için seçilen varsayılanlar.

### Kurallar

- **Git erişimi sadece git2 (libgit2) ile.** git CLI hiçbir yerde çalıştırılmaz;
  `std::process::Command` uygulama kodunda yasak. git2 sadece `src-tauri/src/git/` altında
  kullanılır; diğer modüller oradaki fonksiyonları ve §4'teki kendi tiplerimizi kullanır.
- **Salt okunur.** Uygulama repolara yazan hiçbir git2 API'sini çağırmaz: checkout, set_head,
  commit, stash, reset, merge, cherrypick, revert, branch/reference/tag oluşturma-silme-yeniden
  adlandırma, worktree add/prune/lock, index yazma, blob/odb yazma, fetch/push, config yazma yok.
  Diff ve status seçeneklerinde `update_index` asla açılmaz. Bu sınır T1.2'de clippy
  `disallowed-methods` ile derleme zamanında zorlanır.
- **Agent'lar bu repoda commit atmaz** (CLAUDE.md kuralı). Commit/push'u kullanıcı yapar.
- Task'ları sırayla yap. Başlamadan önce "Bağımlı" satırındaki task'ların §11'de `[x]` olduğunu
  kontrol et.
- Her fazın son task'ı bir **✋ kontrol noktası**: orada dur, uygulamayı `pnpm tauri dev` ile
  açık bırak, kullanıcıya neyi nasıl kontrol edeceğini madde madde yaz ve onay bekle. Onay
  gelmeden sonraki faza geçme.
- Task bitince §11'deki satırı `- [ ]` → `- [x]` yap ve sonuna ` — YYYY-MM-DD` ekle. Kabul
  kriterleri sağlanmadan işaretleme. Yarım kaldıysa işaretleme; satırın altına `  - not: …` ile
  nerede kaldığını yaz.
- Tasarımda olmayan özellik uydurma. Bir şey tanımsızsa önce bu dosyada varsayılan var mı bak;
  yoksa en basit çözümü uygula ve kontrol noktasında kullanıcıya söyle.
- UI metinleri İngilizce ve ekran dosyalarındaki gibi birebir. Kod, identifier ve yorumlar
  İngilizce.
- **Paket yöneticisi pnpm.** npm, npx ve yarn kullanma; `package-lock.json` ya da `yarn.lock`
  oluşturma. Paket eklerken `pnpm add -E <paket>` (dev için `pnpm add -D -E`). Tek seferlik CLI
  gerekirse `pnpm dlx`.
- Paket sürümleri sabit (exact, `^`/`~` yok). Bu dosyada listelenmeyen bir paket eklemeden önce
  gerçekten gerekli mi düşün; eklersen güncel stabil sürümü kur ve sabitle.
- T0.3'ten sonra her task'ın sonunda şunlar hatasız geçmeli:
  - `pnpm build` (tsc + vite)
  - `pnpm test` (vitest)
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

  UI task'larında ayrıca `pnpm tauri dev` ile ekranı açıp ilgili `.dc.html` ile karşılaştır.
- **Tauri 2** kullanıyoruz, Tauri 1 değil. Tauri 1 API'lerini karıştırma:
  `@tauri-apps/api/tauri` yok → `invoke` `@tauri-apps/api/core`'dan gelir; `appWindow` yok →
  `getCurrentWindow()` (`@tauri-apps/api/window`); `allowlist` yok → izinler
  `src-tauri/capabilities/*.json` içinde; plugin'ler `tauri-plugin-*` crate'leri ve
  `@tauri-apps/plugin-*` paketleri.
- Tauri 2'de Rust komut parametresi `repo_id`, JS tarafında `repoId` olarak gönderilir.

---

## 1. Ürün özeti

**Amaç:** Birden çok git reposundaki branch ve worktree'leri, hiçbir şeyi checkout etmeden tek
yerden review etmeyi sağlayan, salt okunur bir macOS masaüstü uygulaması. Cursor, Codex ve Claude
Code agent'larının açtığı worktree/branch'leri incelemek için. App Store'a gitmeyecek, sadece
local build. Sandbox, signing ve notarization yok.

**Kavramlar**

- **Repo:** Kullanıcının Settings'te bir kez eklediği git reposu (global liste).
- **Branch:** Temel kavram. Worktree bilgisi config'te tutulmaz, her taramada yeniden hesaplanır.
- **Worktree:** Bir branch'in (veya detached HEAD'in) checkout edildiği klasör. Agent
  worktree'leri repo dışında, home altında herhangi bir yerde olabilir.
- **Project:** Birden çok repoya yayılan bir iş. Sabit `id`'si ve benzersiz bir adı vardır.
  İçinde **entry**'ler (repo + branch, detached ise repo + worktree path) bulunur.
- **Base:** Diff'in hesaplandığı ref. Varsayılan sırayla bulunur (`origin/HEAD → main → master`,
  Settings'ten değişir). Kullanıcı değiştirebilir; seçim **branch başına** saklanır ve o branch'in
  göründüğü her yerde geçerlidir.
- **Aktif branch:** Bir worktree'de checkout edilmiş, VEYA son N günde (Settings, varsayılan 14)
  commit almış ve base'in önünde olan branch.

**Ekranlar:** Branches (eski adıyla "Inbox"; ilk açılış boş durumu dahil), Project, Review,
Add palette (⌘K), Settings.

**MVP kapsamı dışı:** Yazma işlemleri, review yorumları, GitHub/PR entegrasyonu, fetch/pull,
agent başlatma, çoklu pencere, LSP, git CLI (yedek olarak bile), agent etiketleri (Claude
Code/Codex/Cursor — kaldırıldı), açık tema, ayarlanabilir yenileme aralığı.

**MVP sonrası** (şimdi yapma, bkz. §10): editörde aç, go-to-definition, yeniden adlandırılmış
branch tespiti.

---

## 2. Mimari kararlar

| Konu | Karar | Kaynak |
|---|---|---|
| Git erişimi | **git2** (libgit2 bağlaması), `vendored-libgit2` ile statik derlenir, varsayılan özellikler (ssh/https) kapalı. git CLI hiç kullanılmaz. HANDOFF'ta geçen git komutları (akış A2, §4.10) davranışı tarif eder; git2 karşılıkları §6'da. | Kullanıcı kararı (2026-09-26); HANDOFF §4.8 ve akış A4 buna göre güncellendi |
| Git binary | Aranmaz; "Git not found" ekranı yok. Makinede git kurulu olmasa da uygulama çalışır. | Kullanıcı kararı |
| Repo nesneleri | `git2::Repository` repo (ve worktree) yolu başına bir kez açılır, havuzda tutulur; her istekte yeniden açılmaz. `Sync` olmadığı için her biri kendi `Mutex`'inde. | SPEC |
| Yenileme | **Dosya izleme** (`notify-debouncer-full`, macOS'ta FSEvents, 300 ms debounce). **Poll yok, zamanlayıcı yok.** Olay → sadece etkilenen repo/worktree yeniden hesaplanır → backend sonucu Tauri event'iyle frontend'e iter. Kaçan olaylara karşı pencere focus aldığında ve manuel refresh butonunda tam tarama. Ayarlanamaz; UI'da yenilemeyle ilgili metin yok. Ayrıntı §6. | Kullanıcı kararı (2026-09-26), SPEC "Yenileme"; HANDOFF §4.7 buna göre güncellendi |
| Performans | Hesaplanan sonuçlar `(repo, branch tip SHA, base tip SHA)` anahtarıyla önbelleklenir; bir olay geldiğinde sadece tip'i ya da base'i değişen branch'ler yeniden hesaplanır. Bir worktree'nin commit'lenmemiş durumu sadece o worktree'den olay gelince yeniden okunur. | HANDOFF §5 |
| Base | Branch başına saklanır: `branchBases["<repoId>:<branch>"]`. | HANDOFF §4.3 |
| Proje | Sabit `id`, ad sadece görüntü içindir, adlar benzersizdir (büyük/küçük harf duyarsız, trim'li). | HANDOFF §4.4 |
| Silinen branch | Entry `lastKnownTip` (SHA + görülme zamanı) tutar. | HANDOFF §4.5 |
| Review | Proje genelinde tek ekran; dosyalar entry başına gruplu; tek mod toggle'ı. Tek branch review'u aynı ekranın tek gruplu hâli. | HANDOFF §4.6 |
| Settings | Sadece: repolar, default base sırası, aktif gün eşiği. | HANDOFF §4.7 |
| Config sahibi | Config'i sadece Rust okur/yazar. Frontend hiçbir zaman dosyaya yazmaz; her değişiklik bir Tauri komutudur. | — |
| Config yolu | `~/Library/Application Support/com.gitgel.desktop/config.json` (Tauri `app_data_dir()`). | — |
| Log | `tauri-plugin-log` → `~/Library/Logs/com.gitgel.desktop/`. Git hataları `log::warn!` ile yazılır. | SPEC |
| Paket yöneticisi | **pnpm**; sürümü `package.json` `packageManager` alanında sabit. npm/yarn yok. | Kullanıcı kararı (2026-09-26) |
| Frontend | React + TypeScript + Vite, state zustand. Backend verisi iki yoldan gelir: **push** — config ve tarama sonucu store'da tutulur, backend event'leriyle güncellenir; **istek-cevap** — review, proje görünümü, dosya içeriği, base seçenekleri küçük bir `useInvoke` hook'uyla çekilir ve ilgili repo event'i gelince yenilenir. React Query kullanılmaz. Stil: CSS Modules + CSS değişkenleri. Fuzzy arama: fuse.js. | Kullanıcı kararı (2026-09-26) |
| Diff | `@monaco-editor/react` + `monaco-editor`, CDN değil yerel bundle (`loader.config({ monaco })`). | SPEC |
| Fontlar | Instrument Sans, Source Serif 4, JetBrains Mono — `@fontsource/*` paketleriyle yerel. Uygulama offline çalışır. | HANDOFF §1 |
| Bundle id | `com.gitgel.desktop` (`.app` ile bitmesin; macOS'ta bundle uzantısıyla çakışır). | — |

### HANDOFF §5 açık soruları için varsayılanlar

Bunlar kullanıcı tarafından henüz kesinleşmedi; aşağıdaki varsayılanı uygula, kontrol noktasında
hatırlat.

| Açık soru | Uygulanacak varsayılan |
|---|---|
| Review'daki "Not in review" bölümü | Tasarımcının önerisi: tek satır, `N entries not reviewable · Open project` (Open project → Project ekranı). N=0 ise hiç gösterme. |
| Branches başlığındaki filtre alanı | Gerçek bir liste filtresi (palette açmaz). Branches ekranında ⌘K bu alana odaklanır. |
| Selection bar "Add to project ▾" | B1 popover'ı (proje seçici) yeniden kullan. |
| Sidebar'da projeye sağ tık | Project menüsünü (Rename / Delete project…) yeniden kullan. |
| Yeniden adlandırılmış branch tespiti | MVP dışı. |
| Squash merge tespiti | Uygula (T2.3, ağaç karşılaştırması). |
| Diff istatistik önbelleği | Uygula (T2.5). |

---

## 3. Proje yapısı (hedef)

```
gitgel/
├─ CLAUDE.md
├─ design/                      # dokunma (salt referans)
├─ docs/TASKS.md                # bu dosya
├─ scripts/make-fixtures.sh     # T0.7 — sadece test fixture'ları için
├─ index.html
├─ package.json  pnpm-lock.yaml  .nvmrc
├─ vite.config.ts  tsconfig*.json
├─ src/
│  ├─ main.tsx                  # font import'ları, Monaco setup
│  ├─ App.tsx                   # layout + route switch + global kısayollar
│  ├─ styles/  tokens.css  tokens.ts  global.css
│  ├─ lib/     types.ts  ipc.ts  events.ts  useInvoke.ts  format.ts  paths.ts  entryKey.ts
│  ├─ state/   nav.ts  ui.ts  data.ts
│  ├─ components/               # Button, IconButton, Pill, Checkbox, TextInput, Kbd,
│  │                            # Popover, Menu, Modal, Toast, Segmented, KindBadge,
│  │                            # Banner, icons.tsx, Sidebar/, BaseMenu/, ProjectPicker/
│  ├─ screens/  Branches/  Project/  Review/  Settings/  Palette/  AddRepos/
│  └─ monaco/   setup.ts  theme.ts  language.ts  DiffView.tsx
└─ src-tauri/
   ├─ Cargo.toml  Cargo.lock  rust-toolchain.toml  clippy.toml  tauri.conf.json  build.rs
   ├─ capabilities/default.json
   └─ src/
      ├─ main.rs  lib.rs        # lib.rs: run(), plugin'ler, komut kaydı
      ├─ error.rs  state.rs  model.rs  config.rs  cache.rs
      ├─ commands.rs            # tüm #[tauri::command]'lar (ince sarmalayıcılar)
      ├─ git/                   # git2'nin kullanıldığı TEK yer
      │  ├─ mod.rs              # alt modüller + From<git2::Error>
      │  ├─ pool.rs             # Repository havuzu
      │  ├─ inspect.rs          # klasör çözümleme (akış A2)
      │  ├─ refs.rs             # branch'ler, default base, ref doğrulama, tag'ler
      │  ├─ worktrees.rs        # ana + bağlı worktree'ler
      │  ├─ diff.rs             # tree/workdir diff'leri, FileChange dönüşümü, blob okuma
      │  ├─ history.rs          # merge-base, ahead, revwalk, ata kontrolü, stacked adaylar
      │  └─ testutil.rs         # sadece #[cfg(test)]: TempDir içinde geçici test repoları
      ├─ scan.rs                # branch/worktree keşfi, entry özetleri, saklı tarama sonucu
      ├─ watch.rs               # dosya izleme, olay sınıflandırma, hedefli yeniden hesaplama
      ├─ review.rs  files.rs  base.rs  projects.rs
```

---

## 4. Veri modeli ve paylaşılan tipler

TypeScript tipleri `src/lib/types.ts`'te. Rust karşılıkları `src-tauri/src/model.rs`'te, aynı
alan adlarıyla: struct'larda `#[serde(rename_all = "camelCase")]`, enum'larda
`#[serde(rename_all = "snake_case")]`, `null` olabilen alanlar `Option<T>`.

### Entry anahtarı

```ts
// src/lib/entryKey.ts — Rust'ta aynı fonksiyon model.rs içinde
entryKey = branch !== null ? `${repoId}:${branch}` : `${repoId}:@${worktreePath}`
```

Aynı anahtar `branchBases` için de kullanılır.

### Config (diskte saklanan)

```ts
export interface RepoConfig { id: string; path: string }          // id: "r_" + 8 hex
export interface LastKnownTip { sha: string; seenAt: string }      // seenAt: ISO 8601 UTC
export interface EntryConfig {
  repoId: string;
  branch: string | null;         // null => detached HEAD worktree entry
  worktreePath: string | null;   // sadece detached entry'lerde dolu
  lastKnownTip: LastKnownTip | null;
}
export interface ProjectConfig {
  id: string;                    // "p_" + 8 hex
  name: string;
  createdAt: string;             // ISO 8601 UTC
  entries: EntryConfig[];
}
export interface Settings { defaultBaseOrder: string[]; activeDays: number }
export interface Config {
  version: 1;
  repos: RepoConfig[];
  branchBases: Record<string, string>;   // entryKey -> base ref adı
  projects: ProjectConfig[];
  settings: Settings;                    // varsayılan: ["origin/HEAD","main","master"], 14
}
export interface EntryRef { repoId: string; branch: string | null; worktreePath: string | null }
```

### Tarama ve özetler

```ts
export type EntryState =
  | 'ok' | 'merged' | 'detached' | 'base_missing'
  | 'branch_deleted' | 'repo_missing' | 'git_error';

export interface EntrySummary {
  key: string;                   // entryKey
  repoId: string;
  repoName: string;              // repo klasörünün adı (basename)
  branch: string | null;
  worktreePath: string | null;   // checkout edildiği klasör; checkout edilmemişse null
  headSha: string | null;        // güncel tip; silinmiş/repo yoksa null
  shortSha: string | null;       // ilk 7 karakter
  base: string | null;           // etkin base ref adı (özel veya repo varsayılanı)
  baseIsCustom: boolean;
  ahead: number | null;
  files: number | null;          // merge-base..tip değişen dosya sayısı
  add: number | null;
  del: number | null;
  uncommitted: number | null;    // checkout edilmemişse null
  lastCommitAt: number | null;   // tip commit'in committer tarihi, unix saniye
  state: EntryState;
  error: string | null;          // git_error / base_missing ayrıntısı
}

export interface OtherBranch {   // palette "Older" grubu için hafif kayıt
  repoId: string; repoName: string; branch: string; lastCommitAt: number; merged: boolean;
}
export interface RepoScan {
  repo: RepoConfig;
  name: string;
  status: 'ok' | 'missing' | 'error';
  error: string | null;
  defaultBase: string | null;        // örn. "main"
  defaultBaseSource: string | null;  // eşleşen defaultBaseOrder öğesi, örn. "origin/HEAD"
  active: EntrySummary[];            // aktif branch'ler + detached worktree'ler, yeniden eskiye
  others: OtherBranch[];             // kalan tüm yerel branch'ler (base branch hariç)
}
export interface ScanResult { repos: RepoScan[]; scannedAt: number }

// Backend → frontend event payload'u (§5)
export interface RepoUpdated {
  repoId: string;
  scan: RepoScan;                  // reponun güncel tam hâli; store'daki kaydın yerine geçer
  reason: 'refs' | 'worktree' | 'rescan';
  worktreePath: string | null;     // reason 'worktree' ise değişen worktree
}
```

### Review

```ts
export type DiffMode = 'committed' | 'uncommitted' | 'all';
export type FileKind = 'A' | 'M' | 'R' | 'D' | 'U';
export interface FileChange {
  path: string;
  oldPath: string | null;        // sadece R
  kind: FileKind;
  add: number | null;            // binary ise null
  del: number | null;
  binary: boolean;
  oldOid: string | null;         // null => sol taraf boş (eklenen / untracked)
  newOid: string | null;         // null => sağ taraf diskten (worktree) okunur; kind D ise boş
}
export interface CommitInfo {
  sha: string; shortSha: string; subject: string; committedAt: number;
  fromBranch: string | null;     // başka bir branch'e aitse o branch'in adı (T6.2)
}
export interface StackHint { branch: string; contains: number; total: number }
export interface ReviewGroup {
  entry: EntrySummary;
  mergeBase: string | null;
  files: Record<DiffMode, FileChange[]>;   // üç mod birden döner; toggle anında çalışır
  commits: CommitInfo[];
  stackHint: StackHint | null;
}
export interface ReviewData {
  groups: ReviewGroup[];          // review edilebilir entry'ler, proje sırasıyla
  notInReview: EntrySummary[];    // sadece proje kapsamı
  totalEntries: number;
}
export type ReviewTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'branch'; repoId: string; branch: string | null;
      worktreePath: string | null; tipOverride: string | null };
export interface FilePair { original: string; modified: string; binary: boolean; tooLarge: boolean }
```

### Diğer

```ts
export type FolderKind = 'repo' | 'resolved' | 'duplicate' | 'not_git';
export interface FolderCheck {
  input: string;                          // kullanıcının seçtiği yol
  kind: FolderKind;
  repoPath: string | null;                // çözülmüş ana repo kökü
  via: 'worktree' | 'subdir' | null;      // resolved/duplicate için nasıl çözüldüğü
  duplicateOf: 'config' | 'batch' | null;
  defaultBase: string | null;
}
export interface BaseOptions {
  current: string | null;
  suggested: StackHint[];                 // contains'e göre azalan, contains > 0
  default: { name: string; source: string } | null;
  branches: string[];                     // entry'nin kendisi hariç tüm yerel branch'ler
  tags: string[];
}
export interface ProjectView { project: ProjectConfig; entries: EntrySummary[] }
```

### Hata

Rust'ta:

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "code", content = "message", rename_all = "snake_case")]
pub enum AppError {
    #[error("git error: {0}")] Git(String),   // git2::Error'dan (T1.2)
    #[error("not a git repository: {0}")] NotARepo(String),
    #[error("name conflict: {0}")] NameConflict(String),
    #[error("not found: {0}")] NotFound(String),
    #[error("forbidden: {0}")] Forbidden(String),
    #[error("io: {0}")] Io(String),
}
```

TS'te `invoke` bu nesneyle reject eder: `{ code: string; message: string }`.

---

## 5. Tauri komutları

Hepsi `src-tauri/src/commands.rs`'te `async fn` olarak tanımlanır, iş mantığını ilgili modülden
çağırır, git/disk işini `tauri::async_runtime::spawn_blocking` içinde yapar ve
`Result<T, AppError>` döner. Frontend'de her birinin tipli sarmalayıcısı `src/lib/ipc.ts`'te.

| Komut | Argümanlar | Döner | Task |
|---|---|---|---|
| `get_config` | – | `Config` | T1.4 |
| `inspect_folders` | `paths: string[]` | `FolderCheck[]` | T1.8 |
| `add_repos` | `paths: string[]` | `Config` | T1.8 |
| `get_scan` | – | `ScanResult` (saklı sonuç; yoksa tam tarama) | T2.6 |
| `rescan_all` | – | `ScanResult` (her zaman tam tarama) | T2.6 |
| `get_review` | `target: ReviewTarget` | `ReviewData` | T3.2, T4.1, T5.10 |
| `read_file_pair` | `repoId, worktreePath: string\|null, change: FileChange` | `FilePair` | T3.3, T4.2 |
| `create_project` | `name, entries: EntryRef[]` | `ProjectConfig` | T5.1 |
| `rename_project` | `projectId, name` | `Config` | T5.1 |
| `delete_project` | `projectId` | `Config` | T5.1 |
| `add_entries` | `projectId, entries: EntryRef[]` | `Config` | T5.1 |
| `remove_entries` | `projectId, keys: string[]` | `Config` | T5.1 |
| `get_project_view` | `projectId` | `ProjectView` | T5.2 |
| `get_base_options` | `repoId, key` | `BaseOptions` | T6.1 |
| `set_branch_base` | `key, base: string\|null` | `Config` | T6.1 |
| `verify_ref` | `repoId, rev` | `string\|null` (tam SHA) | T6.1 |
| `commit_exists` | `repoId, sha` | `boolean` | T7.2 |
| `repoint_entry` | `projectId, key, branch` | `Config` | T7.2 |
| `remove_repo` | `repoId` | `Config` | T8.1 |
| `locate_repo` | `repoId, path` | `Config` | T8.1 |
| `update_settings` | `settings: Settings` | `Config` | T8.2 |

Bir repoyu etkileyen komutlar (`add_repos`, `remove_repo`, `locate_repo`, `update_settings`,
`set_branch_base`) işi bitince ilgili repoları yeniden tarar, izleme listesini günceller ve
`repo-updated` yayınlar.

### Event'ler (backend → frontend)

Rust'ta `use tauri::Emitter; app.emit("<ad>", payload)`; frontend'de `listen` (`@tauri-apps/api/event`).
Dinleyiciler tek yerde: `src/lib/events.ts` (T1.5).

| Event | Payload | Ne zaman | Task |
|---|---|---|---|
| `config-changed` | `Config` | `config::update` her kaydettiğinde (kullanıcı işlemi ya da `lastKnownTip` güncellemesi) | T1.4 |
| `repo-updated` | `RepoUpdated` | Watcher bir değişikliği işledikten sonra; bir komut ya da tam tarama bir repoyu yeniden taradıktan sonra | T2.6, T2.8 |

---

## 6. Git katmanı (git2)

### Kurulum ve sınır

- Crate: `git2`, `default-features = false`, `features = ["vendored-libgit2"]`. libgit2 statik
  derlenir; sistem libgit2'sine ve OpenSSL'e bağımlılık yok. Ağ özellikleri (ssh/https) gerekmez,
  çünkü fetch/push yok.
- git2 sadece `src-tauri/src/git/` altında kullanılır. Dışarıya git2 tipi sızmaz: SHA'lar hex
  `String`, hatalar `AppError`, sonuçlar §4'teki tipler.
- Yazan API'ler `src-tauri/clippy.toml` ile yasak (T1.2). Tek istisna `git/testutil.rs` (sadece
  testlerde, sadece kendi `TempDir`'i içinde).
- HANDOFF'ta geçen git komutları (akış A2'deki `rev-parse`, §4.10'daki `for-each-ref`) davranışı
  tarif eder; aşağıdaki git2 karşılıklarıyla uygulanır.

### Repository havuzu (T1.3)

- Repo (ve worktree) yolu başına bir `git2::Repository` açılır ve havuzda tutulur; her istekte
  yeniden açılmaz. `Repository` `Sync` olmadığı için her biri kendi `Mutex`'indedir.
- Açma: `Repository::open_ext(path, RepositoryOpenFlags::NO_SEARCH, &[] as &[&OsStr])`. Yukarı
  doğru arayan `Repository::discover` sadece klasör incelemede (T1.8) kullanılır.
- libgit2 ref'leri ve HEAD'i her okumada diskten okur, bulamadığı nesnede object DB'yi kendisi
  yeniler. **Index'i kendiliğinden tazelemez:** index kullanan her diff'ten önce
  `repo.index()?.read(false)?` çağır (yazmaz; sadece diskte değiştiyse yeniden okur).

### Değişiklik izleme (T2.8)

Poll yok. Backend dosya sistemini izler, değişeni yeniden hesaplar, sonucu event'le frontend'e iter.

- **Crate:** `notify-debouncer-full` (macOS'ta FSEvents), debounce 300 ms. `notify`'ı ayrıca
  ekleme; `notify_debouncer_full::notify` re-export'unu kullan (sürüm uyuşmazlığı olmasın).
- **İzlenen kökler** (hepsi recursive, `canonicalize` edilmiş; FSEvents gerçek yolları bildirir,
  örn. `/private/…`):
  - Her reponun git dizini (`commondir()`, örn. `<repo>/.git/`).
  - Her worktree klasörü: ana worktree ve bağlı worktree'ler. Bağlılar repo dışında, home
    altında her yerde olabilir.
  - Bir kök başka bir izlenen kökün içindeyse ayrıca izlenmez (ana worktree zaten `.git/`'i
    kapsar). Diskte olmayan yol izlenmez.
- **Sınıflandırma:** olay yolu, onu kapsayan **en uzun** köke göre sınıflanır (ana worktree
  içindeki `.git/…` yolu git dizini köküne düşer).
  - Git dizini altında (göreli yola göre):

    | Göreli yol | Değişiklik |
    |---|---|
    | `HEAD`, `packed-refs`, `refs/**` | `Refs` |
    | `index` | `Worktree` (ana worktree) |
    | `worktrees/<ad>/HEAD` | `Refs` |
    | `worktrees/<ad>/index` | `Worktree` (o worktree) |
    | `worktrees/<ad>` klasörünün eklenmesi/silinmesi | `Refs` (worktree listesi değişti) |
    | diğer her şey (`objects/`, `logs/`, `*.lock`, `FETCH_HEAD`, …) | at |

  - Worktree kökü altında: `.git` (bağlı worktree'deki `.git` dosyası) atılır; geri kalan her yol
    `Worktree`'dir, ama önce `.gitignore` süzgecinden geçer.
- **Ignore süzgeci:** yolun köke en yakın atasından başlayarak `repo.is_path_ignored(<worktree'ye
  göreli yol>)` ile kontrol et; bir ata ignore ise altındaki her şey ignore'dur. Sonuçları batch
  içinde önbelleğe al. Böylece `node_modules/` ya da `target/` altındaki binlerce olay tek
  kontrolle elenir.
- **İş:**
  - `Refs` → o repoyu baştan tara (`rescan_repo`; ref'i değişmeyen branch'ler önbellekten gelir,
    her worktree'nin uncommitted sayısı da yeniden okunur). Worktree listesi değiştiyse izleme
    listesini güncelle.
  - `Worktree` → sadece o worktree'nin uncommitted sayısını yeniden hesapla, reponun saklı
    `RepoScan`'inde ilgili entry'yi güncelle (`merged`/`ok` geçişi dahil).
  - İkisinde de sonunda `repo-updated` yayınla.
- **Thread'ler:** debouncer callback'i ağır iş yapmaz, olayları bir kanala atar. Tek bir işçi
  thread'i kanalı bekler; bir batch gelince kuyrukta bekleyen tüm batch'leri de boşaltır, olayları
  `(repoId, tür, worktree)` kümesine indirger (aynı repo için yüzlerce olay tek işe döner) ve işi
  yapar. İş sürerken gelen olaylar bir sonraki turda birleşir.
- **Emniyet:** pencere focus aldığında ve manuel refresh butonunda tam tarama (`rescan_all`).
  Zamanlayıcı yok.

### İşlem → git2 karşılığı

| İşlem | git2 | Not |
|---|---|---|
| Klasör çözümü (akış A2) | `Repository::discover(dir)` → `is_bare()`, `workdir()`, `commondir()`, `is_worktree()` | Ana repo kökü = `commondir()` `.git` ile bitiyorsa onun parent'ı |
| Remote HEAD | `find_reference("refs/remotes/origin/HEAD")?.symbolic_target()` | `refs/remotes/origin/main` döner |
| Yerel branch var mı | `find_branch(name, BranchType::Local)` | |
| Ref doğrulama | `revparse_single(rev)?.peel_to_commit()?.id()` | hata = yok |
| Yerel branch'ler | `branches(Some(BranchType::Local))` → `name()`, `get().target()` | `target()` `None` ise (sembolik) atla |
| Commit tarihi | `find_commit(oid)?.time().seconds()` | committer zamanı |
| Tag'ler | `tag_names(None)` | |
| Worktree'ler | Ana: `workdir()` + `head()`. Bağlılar: `worktrees()` → `find_worktree(name)` → `validate()`, `path()` | `worktrees()` ana worktree'yi **listelemez**, ayrıca ekle. `validate()` hata = prunable, atla |
| Worktree HEAD | worktree yolunu havuzdan aç → `head_detached()`, `head()?.name()`, `head()?.target()` | unborn HEAD → atla |
| Merge-base | `merge_base(base, tip)` | `ErrorCode::NotFound` = ortak ata yok |
| Ahead | `graph_ahead_behind(tip, base)?.0` | |
| Ata mı | `a == d \|\| graph_descendant_of(d, a)?` | merged ve stacked kontrolü |
| Commit listesi | `revwalk()`: `push(tip)`, `hide(base)`, `set_sorting(Sort::TOPOLOGICAL \| Sort::TIME)`, ilk 200 | `id()`, `summary()`, `time()` |
| Committed diff | `diff_tree_to_tree(Some(&from_tree), Some(&to_tree), Some(&mut opts))` + `find_similar` | |
| Working tree diff | worktree repo'sunda `diff_tree_to_workdir_with_index(Some(&tree), Some(&mut opts))` + `find_similar` | Uncommitted: HEAD tree. All: merge-base tree |
| Satır sayıları | `Patch::from_diff(&diff, i)?` → `line_stats()` | `None` = binary ya da içerik farkı yok |
| Blob boyutu | `odb()?.read_header(oid)?.0` | içeriği yüklemez |
| Blob içeriği | `find_blob(oid)?.content()` | |
| Commit var mı | `find_commit(oid).is_ok()` | |
| Ignore kontrolü | `is_path_ignored(rel_path)` | watcher süzgeci (T2.8) |

### Diff seçenekleri

```rust
let mut opts = DiffOptions::new();
opts.context_lines(0)             // sadece sayı gerekiyor; patch üretimini hızlandırır
    .include_typechange(true)
    .ignore_submodules(true);
// working tree diff'lerinde ek olarak:
opts.include_untracked(true)
    .recurse_untracked_dirs(true)
    .show_untracked_content(true);  // untracked dosyaların satır sayısı da gelir
// ASLA: opts.update_index(true) — index'i diske yazar (clippy'de yasak)

let mut find = DiffFindOptions::new();
find.renames(true);
diff.find_similar(Some(&mut find))?;
```

`.gitignore`'daki dosyalar varsayılan olarak dışarıda kalır; `include_ignored` açma.

### Delta → `FileChange` (T2.1)

- `delta.status()` → `FileKind`: `Added`→A; `Modified`, `Typechange`, `Conflicted`→M;
  `Renamed`→R (`oldPath` = eski yol); `Copied`→A (`oldPath` dolu); `Deleted`→D; `Untracked`→U.
  `Unmodified`, `Ignored`, `Unreadable` → atla.
- `path` = `new_file().path()` (D'de `old_file().path()`), `to_string_lossy`.
- `oldOid` = `old_file().id()` sıfır değilse hex, değilse `null`.
- `newOid`:
  - tree ↔ tree diff'inde `new_file().id()` sıfır değilse hex.
  - working tree diff'inde **her zaman `null`**. libgit2 orada diskteki içeriğin hash'ini
    doldurabilir ama o blob object DB'de yoktur; sağ taraf diskten okunur (T4.2).
- Satır sayısı: `Patch::from_diff(&diff, i)?` `Some(p)` ise `p.line_stats()?` → `(_, add, del)`.
  `None` dönerse ve `diff.get_delta(i)`'nin `flags().is_binary()` değeri doğruysa
  `binary: true`, `add`/`del` `null`; binary değilse (örn. boş dosya) `0`/`0`.

---

## 7. Tasarım referans haritası

| Ekran | Dosya | Önemli satırlar |
|---|---|---|
| Sidebar | `Sidebar.dc.html` | üst satır 18–33, nav 35–46, "Projects" başlığı 48–58, liste 60–75, footer 79–90 (repo satırı + "+" butonu 80–86), satır ve footer stilleri 100–121 |
| Branches | `Main.dc.html` | header 22–44 (All / Not in a project seçici 32–36), kolon başlığı 48–50, repo bandı 54–59, satır 61–73 (Projects hücresi 71), satır ve Projects hücresi stilleri 211–252, filtre mantığı 275–285 ve 303–310, boş durum 81–91, B1 popover 93–106, B2 form 108–124, Projects menüsü 126–142, toast 144–150, selection bar 151–164, sürükle-bırak overlay 167–174, sheet 176–200 ve 312–327 |
| Review | `Diff.dc.html` | header 20–45, banner 47–49 ve 427–431, dosya listesi 52–102 ve 283–303, sağ taraf 104–151, base menüsü 154–174, segmented 311–318, diff satırları 377–391, commit satırları 392–397 |
| Project | `Projects.dc.html` | header 22–43, tablo 47–60 ve 172–183, "add related" kartı 62–68, boş proje 72–80, entry menüsü 82–93, proje menüsü 94–100, silme modalı 103–114, rename 150–170, pill'ler 124–133 |
| Palette | `Palette.dc.html` | dialog 25–56, satır stili 70–76, pill'ler 62–69 |
| Settings | `Settings.dc.html` | tamamı |

**İkonlar** (1.6–1.8 stroke outline SVG; `src/components/icons.tsx`'e birebir kopyala, emoji
kullanma):

| İkon | Kaynak |
|---|---|
| Sidebar toggle | `Sidebar.dc.html:25` |
| Back / Forward | `Sidebar.dc.html:28`, `:31` |
| Plus (New project) | `Sidebar.dc.html:38` (küçük, footer: `:85`) |
| Branch | `Sidebar.dc.html:43` (büyük: `Main.dc.html:79`) |
| Search | `Sidebar.dc.html:52` |
| Sort/filter (sliders) | `Sidebar.dc.html:55` |
| Folder | `Sidebar.dc.html:81` (folder+plus: `Main.dc.html:147`) |
| Gear | `Sidebar.dc.html:88` |
| Refresh | `Main.dc.html:30` |
| Chevron down | `Main.dc.html:134` |
| Close (✕) | `Main.dc.html:138` |
| More (⋯) | `Projects.dc.html:39` |

---

## 8. Faz ve task'lar

Her task'ta: **Bağımlı** (önce bitmesi gerekenler), **Dosyalar** (dokunulacak başlıca dosyalar),
**Adımlar**, **Kabul** (işaretlemeden önce doğrula).

---

### Faz 0 — Ortam ve iskelet

#### T0.1 Ön koşulları doğrula
- **Bağımlı:** –
- **Adımlar:**
  1. `xcode-select -p` → yol dönmeli (Xcode Command Line Tools). Yoksa kullanıcıdan
     `xcode-select --install` çalıştırmasını iste.
  2. `rustc --version`, `cargo --version` → stable Rust. Yoksa kurulum için kullanıcıdan onay al
     (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`).
  3. `node --version` (≥ 20 LTS) ve `pnpm --version`. pnpm yoksa kullanıcıdan onay alıp kur:
     `corepack enable pnpm` (Node 24 ve öncesinde corepack Node ile gelir) ya da
     `brew install pnpm`.
  4. `git --version` — sadece T0.7'deki fixture script'i için. Uygulama git CLI kullanmaz;
     libgit2 (git2 crate'i) uygulamayla birlikte derlenir, bunun için Xcode CLT'deki C
     derleyicisi yeterli.
- **Kabul:** Sürümler kullanıcıya bildirildi; eksik araç yok.

#### T0.2 Tauri 2 + React + TS + Vite iskeleti
- **Bağımlı:** T0.1
- **Dosyalar:** repo kökü, `src-tauri/tauri.conf.json`, `package.json`, `.gitignore`
- **Adımlar:**
  1. Repo kökü boş olmadığı için iskeleti geçici klasörde oluştur:
     ```bash
     SCAFFOLD="$(mktemp -d)" && cd "$SCAFFOLD"
     pnpm create tauri-app gitgel --template react-ts --manager pnpm --identifier com.gitgel.desktop --yes
     ```
     Bir bayrak reddedilirse `pnpm create tauri-app --help` ile eşdeğerini bul. Şablon
     React + TypeScript, paket yöneticisi pnpm, Tauri sürümü 2 olmalı.
  2. Dosyaları repo köküne kopyala, var olanların üzerine yazma:
     `rsync -a --ignore-existing --exclude .git "$SCAFFOLD/gitgel/" "<repo kökü>/"`.
  3. Repo kökünde `pnpm install`. pnpm "Ignored build scripts" uyarısı verirse
     `pnpm approve-builds` ile sadece gerçekten gereken paketlere (örn. `esbuild`) izin ver;
     emin değilsen kullanıcıya sor.
  4. `src-tauri/tauri.conf.json`: `productName: "Gitgel"`, `version: "0.1.0"`,
     `identifier: "com.gitgel.desktop"`, `bundle.targets: ["app"]`. `build.beforeDevCommand`
     `pnpm dev`, `build.beforeBuildCommand` `pnpm build` olmalı (şablon npm yazdıysa düzelt).
     `package.json` `name: "gitgel"`.
  5. `.gitignore`'a (yoksa) `node_modules`, `dist`, `src-tauri/target`, `.DS_Store` ekle.
- **Kabul:** `pnpm tauri dev` şablon penceresini açıyor; `pnpm build` geçiyor; repoda
  `package-lock.json` yok.

#### T0.3 Bağımlılıklar ve sürüm sabitleme
- **Bağımlı:** T0.2
- **Dosyalar:** `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `src-tauri/Cargo.toml`,
  `src-tauri/rust-toolchain.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`
- **Adımlar:**
  1. `node --version | tr -d v > .nvmrc`. `package.json`'a elle ekle:
     - `"packageManager": "pnpm@<pnpm --version çıktısı>"` (pnpm sürümünü de sabitler)
     - `"engines": { "node": ">=20" }`
     - `scripts` içine `"test": "vitest run --passWithNoTests"`
  2. Frontend paketleri:
     ```bash
     pnpm add -E zustand fuse.js @monaco-editor/react monaco-editor \
       @fontsource/instrument-sans @fontsource/jetbrains-mono @fontsource/source-serif-4
     pnpm add -D -E vitest
     ```
  3. Tauri plugin'leri (her biri crate'i, JS paketini, `lib.rs` kaydını ve izni ekler; paket
     yöneticisini lockfile'dan anlar. Sonra `lib.rs`'e ve `package.json`'a bakıp gerçekten
     eklendiğini doğrula):
     ```bash
     pnpm tauri add dialog
     pnpm tauri add clipboard-manager
     pnpm tauri add log
     ```
  4. Rust crate'leri (`src-tauri` içinde):
     ```bash
     cargo add serde --features derive
     cargo add serde_json thiserror log chrono
     cargo add uuid --features v4
     cargo add git2 --no-default-features --features vendored-libgit2
     cargo add notify-debouncer-full
     cargo add --dev tempfile
     ```
     `git2`'nin varsayılan özellikleri (ssh, https) ağ içindir; fetch/push olmadığı için kapalı.
     `vendored-libgit2` libgit2'yi statik derler (sistem kütüphanesine bağımlılık yok).
  5. JS sürümlerini sabitle (şablondan ve `tauri add`'den gelen `^`'leri temizler; kurulu
     sürümleri `pnpm list` ile okur):
     ```bash
     node -e 'const fs=require("fs");const [l]=JSON.parse(require("child_process").execSync("pnpm list --depth 0 --json"));const p=JSON.parse(fs.readFileSync("package.json"));for(const k of ["dependencies","devDependencies"])for(const n in p[k]||{})p[k][n]=l[k][n].version;fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'
     pnpm install
     ```
  6. Cargo sürümlerini sabitle: `cargo tree --depth 1 -e normal,build,dev` çıktısındaki
     sürümlerle `Cargo.toml`'daki her doğrudan bağımlılığı `version = "=X.Y.Z"` yap
     (`tauri-build` ve dev-dependency'ler dahil).
     `Cargo.lock` repoda kalır.
  7. `src-tauri/rust-toolchain.toml`:
     ```toml
     [toolchain]
     channel = "<rustc --version çıktısındaki sürüm, örn. 1.xx.0>"
     components = ["clippy", "rustfmt"]
     ```
- **Kabul:** `package.json`'da `^`/`~` yok ve `packageManager` alanı var; `Cargo.toml`'daki tüm
  sürümler `=` ile başlıyor; `pnpm build`, `pnpm test` ve `cargo build` geçiyor.

#### T0.4 Klasör yapısı ve şablon temizliği
- **Bağımlı:** T0.3
- **Dosyalar:** §3'teki yapı
- **Adımlar:**
  1. Şablondaki demo'yu kaldır: `greet` komutu, `App.css`, `src/assets/*`, `public/*.svg`, logolar.
  2. §3'teki klasörleri ve boş modülleri oluştur. Rust'ta `lib.rs` içinde `mod` bildirimlerini
     ekle; boş modüller derlenmeli.
  3. `index.html` `<title>Gitgel</title>`.
  4. `App.tsx` şimdilik koyu arka planlı boş bir `<div>` render etsin.
- **Kabul:** Uygulama boş koyu pencereyle açılıyor; build'ler ve clippy temiz.

#### T0.5 Fontlar, renk token'ları, global CSS
- **Bağımlı:** T0.4
- **Dosyalar:** `src/styles/tokens.css`, `src/styles/tokens.ts`, `src/styles/global.css`, `src/main.tsx`
- **Adımlar:**
  1. `main.tsx`'te fontları import et:
     `@fontsource/instrument-sans/{400,500,600}.css`, `@fontsource/jetbrains-mono/{400,500}.css`,
     `@fontsource/source-serif-4/{400,500}.css`.
  2. `tokens.css`'te HANDOFF §1'deki her token'ı `:root` değişkeni olarak tanımla. İsimlendirme:
     `bg.sidebar` → `--bg-sidebar`, `text.muted` → `--text-muted`, `accent.text` →
     `--accent-text` vb. Ek olarak:
     - `--on-accent: #141311`
     - `--success-text/--success-bg`, `--warning-text/--warning-bg`, `--danger-text/--danger-bg`, `--danger-fill`
     - `--diff-add-bg`, `--diff-del-bg`, `--diff-add-mark`, `--diff-del-mark`, `--diff-fold-bg`
     - `--kind-{a,m,r,d,u}-text` ve `--kind-{a,m,r,d,u}-bg` (HANDOFF §1 "File-kind badges")
     - `--font-ui: 'Instrument Sans', -apple-system, sans-serif`,
       `--font-serif: 'Source Serif 4', Georgia, serif`,
       `--font-mono: 'JetBrains Mono', ui-monospace, monospace`
     - `--radius-control: 8px`, `--radius-seg: 10px`, `--radius-pop: 12px`,
       `--radius-modal: 16px`, `--radius-pill: 9999px`
     - `--shadow-pop: 0 16px 40px rgba(0,0,0,0.45)`,
       `--shadow-modal: 0 24px 60px rgba(0,0,0,0.5)`, `--scrim: rgba(0,0,0,0.5)`
     - `--focus-ring: 0 0 0 1px #4f8fa3, 0 0 0 3px rgba(79,143,163,0.25)`
  3. `tokens.ts`: aynı hex değerlerini TS sabiti olarak export et (Monaco teması CSS
     değişkeni okuyamaz).
  4. `global.css`: `html, body, #root { height: 100% }`, `body { margin: 0; background:
     var(--bg-main); color: var(--text-body); font: 13px/1.4 var(--font-ui);
     -webkit-font-smoothing: antialiased }`, `button, input { font: inherit }`,
     `a { color: var(--accent-text); text-decoration: none } a:hover { color: var(--accent-hover) }`,
     `user-select: none` (input ve kod alanları hariç), ince koyu scrollbar, `:focus-visible`
     için `--focus-ring`.
  5. Sayfa başlığı sınıfı: serif 22px, weight 400, letter-spacing −0.3px, `--text-strong`.
     Bölüm etiketi sınıfı: 11px, 500, uppercase, letter-spacing 0.06em, `--text-muted`.
- **Kabul:** Test amaçlı üç satır (sans, serif, mono) doğru fontla görünüyor; Wi-Fi kapalıyken de
  aynı (fontlar yerelden geliyor). Test satırlarını sonra kaldır.

#### T0.6 Pencere, başlık çubuğu ve izinler
- **Bağımlı:** T0.4
- **Dosyalar:** `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`
- **Adımlar:**
  1. `app.windows[0]`:
     ```json
     { "label": "main", "title": "Gitgel", "width": 1280, "height": 800,
       "minWidth": 1100, "minHeight": 680, "titleBarStyle": "Overlay",
       "hiddenTitle": true, "trafficLightPosition": { "x": 16, "y": 20 } }
     ```
     Kurulu sürüm `trafficLightPosition`'ı tanımıyorsa kaldır, varsayılan konuma göre çalış.
     Trafik ışıkları native'dir; tasarımdaki renkli daireleri çizme, sadece ~70px yer bırak.
  2. `capabilities/default.json` izinleri: `core:default`, `core:window:allow-start-dragging`,
     `dialog:allow-open`, `clipboard-manager:allow-write-text`, `log:default`.
  3. Pencere sürükleme: başlık satırlarına (sidebar üst satırı, sayfa header'ları)
     `data-tauri-drag-region` ekle. Bu nitelik sadece öğenin kendisinde çalışır, çocuklarda
     değil; buton ve inputlara ekleme. Project başlığına ekleme (çift tık rename içindir; drag
     region'da çift tık pencereyi büyütür).
- **Kabul:** Trafik ışıkları sol üstte, içerik başlık çubuğunun altına uzanıyor, üst boş alandan
  pencere sürüklenebiliyor.

#### T0.7 Test fixture repoları
- **Bağımlı:** T0.1
- **Dosyalar:** `scripts/make-fixtures.sh`
- **Not:** Bu script bir geliştirme aracıdır ve git CLI kullanır; uygulama kodu git CLI'ı hiç
  kullanmaz. CLAUDE.md'deki "yazan git komutu yok" kuralı kullanıcının repolarını korur; bu
  script sadece kendi oluşturduğu `$ROOT` altında yeni repo kurar. **İlk kez çalıştırmadan önce
  kullanıcıdan onay al.**
- **Adımlar:** Bash script yaz (`set -euo pipefail`):
  - `ROOT="${GITGEL_FIXTURES:-$HOME/gitgel-fixtures}"`. Klasör varsa ve içinde
    `.gitgel-fixtures` işaret dosyası yoksa **dur** (yanlışlıkla başka bir şeyi silme). Varsa
    silip yeniden oluştur; işaret dosyasını yaz.
  - Sabit yazar/committer (`GIT_AUTHOR_NAME=Fixture` …). Geçmiş tarihli commit için
    `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` = `"$(date -v-<N>d +%s) +0000"`.
  - **web-app** (bare `remote/web-app.git`'ten clone'la ki `origin/HEAD` → `main` olsun):
    - `main`: `src/auth/session.ts`, `src/auth/token.ts`, `src/api/client.ts`, `package.json`, 30 gün önce.
    - `session-token-refresh`: 4 commit (değiştir, ekle, `token.ts` → `tokens.ts` rename, test
      ekle). `wt/token-refresh` worktree'sinde checkout; bir dosyada commit'lenmemiş değişiklik
      ve bir untracked dosya (`scripts/token-debug.ts`).
    - `feat/billing-v2`: 3 commit, 2 gün önce, checkout edilmemiş, bir binary dosya (küçük PNG baytları).
    - `old-feature`: 60 gün önce, merge edilmemiş (sadece palette "Older"da görünmeli).
    - `merged-ff`: `main`'e fast-forward merge edilmiş.
    - `squashed`: 2 commit; değişiklikleri `main`'e tek commit olarak squash edilmiş, branch duruyor.
  - **api-server** (varsayılan branch `master`; origin yok → base sırası fallback'ini test eder):
    - `feat/job-queue`: 3 commit.
    - `token-rotation-job`: `feat/job-queue`'dan çıkıp 2 commit daha; `wt/token-rotation`'da
      checkout, 1 dosya değişik (stacked branch testi).
    - `wt/detached`: `feat/job-queue~1`'de detached HEAD worktree.
    - `to-be-deleted`: 1 commit.
  - `not-a-repo/`: sadece bir metin dosyası.
  - Alt komutlar: `make-fixtures.sh delete-branch` → `api-server`'da `to-be-deleted`'ı siler;
    `make-fixtures.sh remove-repo` → `$ROOT/web-app`'i `$ROOT/web-app.moved`'a taşır (repo
    kayboldu testi); `make-fixtures.sh restore-repo` → geri taşır.
  - Sonunda eklenecek yolları yazdır.
- **Kabul:** Script iki kez üst üste hatasız çalışıyor;
  `git -C ~/gitgel-fixtures/api-server worktree list` üç worktree gösteriyor.

#### T0.8 ✋ Kontrol noktası — Faz 0
- **Bağımlı:** T0.1–T0.7
- **Kullanıcıya göster:** koyu boş pencere, overlay başlık çubuğu, fontlar, sabitlenmiş sürümler
  (`package.json`, `Cargo.toml`), fixture script'inin çıktısı. İki istisna için açıkça onay iste:
  fixture script'i (T0.7) ve Rust testlerinin kendi `TempDir`'lerinde git2 ile geçici repo
  kurması (T1.2, `git/testutil.rs`). Onay bekle.

---

### Faz 1 — Git katmanı, config, repo ekleme

#### T1.1 Rust modül iskeleti, hata tipi, AppState
- **Bağımlı:** T0.8
- **Dosyalar:** `error.rs`, `state.rs`, `model.rs`, `lib.rs`, `commands.rs`
- **Adımlar:**
  1. `error.rs`: §4'teki `AppError`; `From<std::io::Error>` ve `From<serde_json::Error>`
     dönüşümleri. (`From<git2::Error>` T1.2'de `git/mod.rs`'e yazılır; git2 o klasör dışında
     kullanılmaz.)
  2. `model.rs`: §4'teki tüm tipler (serde derive, camelCase) ve `entry_key()` fonksiyonu.
  3. `state.rs`:
     ```rust
     #[derive(Clone)]
     pub struct AppState(pub Arc<Inner>);
     pub struct Inner {
         pub pool: RepoPool,             // T1.3
         pub config: Mutex<Config>,
         pub config_path: PathBuf,
         pub cache: Mutex<Cache>,        // T2.5
     }
     ```
  4. `lib.rs` `run()`: `.setup(|app| { … app.manage(AppState::new(…)); Ok(()) })` ve
     `.invoke_handler(tauri::generate_handler![...])`. Komutlar geldikçe buraya eklenir.
  5. Blocking iş için yardımcı: `async fn blocking<T>(state, f) -> Result<T, AppError>`
     (`AppState`'i klonlayıp `spawn_blocking` içinde çalıştırır).
- **Kabul:** `cargo test` ve `clippy` temiz; `entry_key` için birim testi var (branch ve detached).

#### T1.2 git2 sınırı: yazma yasakları ve test repo yardımcısı
- **Bağımlı:** T1.1
- **Dosyalar:** `src-tauri/clippy.toml`, `git/mod.rs`, `git/testutil.rs`
- **Adımlar:**
  1. `git/mod.rs`: alt modülleri bildir (`pool`, `inspect`, `refs`, `worktrees`, `diff`,
     `history`, `#[cfg(test)] pub mod testutil`). `impl From<git2::Error> for AppError` burada:
     `AppError::Git(format!("{} ({:?}/{:?})", e.message(), e.class(), e.code()))`.
  2. `src-tauri/clippy.toml` (clippy bu dosyayı `Cargo.toml`'un yanında bulur). Yasaklı çağrılar
     `-D warnings` ile derleme hatasına döner:
     ```toml
     disallowed-methods = [
       { path = "std::process::Command::new", reason = "no git CLI; use git2" },
       { path = "git2::Repository::checkout_head", reason = "read-only app" },
       # … aşağıdaki listenin tamamı, hepsi reason = "read-only app"
     ]
     disallowed-types = [
       { path = "git2::build::CheckoutBuilder", reason = "read-only app" },
       # …
     ]
     ```
     Yasaklı metotlar:
     - `git2::Repository::` → `init`, `init_bare`, `init_opts`, `clone`, `clone_recurse`,
       `checkout_head`, `checkout_index`, `checkout_tree`, `set_head`, `set_head_detached`,
       `set_head_bytes`, `commit`, `commit_signed`, `branch`, `branch_from_annotated_commit`,
       `reference`, `reference_matching`, `reference_symbolic`, `reference_symbolic_matching`,
       `tag`, `tag_annotation_create`, `tag_lightweight`, `tag_delete`, `note`, `note_delete`,
       `stash_save`, `stash_save2`, `stash_save_ext`, `stash_apply`, `stash_pop`, `stash_drop`,
       `worktree`, `remote`, `remote_anonymous`, `remote_delete`, `remote_rename`,
       `remote_set_url`, `remote_set_pushurl`, `merge`, `cherrypick`, `revert`, `reset`,
       `reset_default`, `apply`, `cleanup_state`, `blob`, `blob_path`, `blob_writer`,
       `set_workdir`, `set_index`, `submodule`
     - `git2::Branch::delete`, `git2::Branch::rename`, `git2::Branch::set_upstream`
     - `git2::Reference::delete`, `git2::Reference::rename`, `git2::Reference::set_target`
     - `git2::Index::write`, `git2::Index::write_tree`, `git2::Index::write_tree_to`,
       `git2::Index::add_path`, `git2::Index::add_all`, `git2::Index::remove_path`
     - `git2::Worktree::prune`, `git2::Worktree::lock`, `git2::Worktree::unlock`
     - `git2::Remote::fetch`, `git2::Remote::push`, `git2::Remote::download`
     - `git2::Odb::write`
     - `git2::Config::set_str`, `git2::Config::set_bool`, `git2::Config::set_i32`,
       `git2::Config::set_i64`, `git2::Config::remove`
     - `git2::DiffOptions::update_index`, `git2::StatusOptions::update_index` (index'i diske yazar)

     Yasaklı tipler: `git2::build::CheckoutBuilder`, `git2::build::RepoBuilder`,
     `git2::build::TreeUpdateBuilder`, `git2::TreeBuilder`, `git2::Rebase`.
     Kurulu git2 sürümünde bulunmayan bir path için clippy uyarı verirse sadece o satırı sil.
  3. `git/testutil.rs`: sadece `#[cfg(test)]`, dosyanın başında
     `#![allow(clippy::disallowed_methods, clippy::disallowed_types)]`. Her şeyi kendi
     `tempfile::TempDir`'i içinde yapan `TestRepo`:
     - `new()`: `Repository::init`, HEAD → `refs/heads/main`.
     - `commit_on(branch, files: &[(&str, Option<&[u8]>)], msg, days_ago) -> Oid`: dalın tip'inin
       tree'sinden başlar; `TreeUpdateBuilder` ile dosyaları ekler/günceller (`Some`, içerik
       `repo.blob` ile) ya da siler (`None`); `repo.commit(Some("refs/heads/<branch>"), …)`.
       İmza: `Signature::new("Test", "test@example.com", &Time::new(now - days_ago * 86400, 0))`.
       Dal yoksa ilk commit parent'sız olur.
     - `branch_from(name, oid)`, `set_branch(name, oid)` (fast-forward merge simülasyonu),
       `delete_branch(name)`.
     - `set_origin_head(branch)`: `refs/remotes/origin/<branch>` ve sembolik
       `refs/remotes/origin/HEAD` ref'lerini oluşturur.
     - `checkout_main()`: ana workdir'i HEAD'e göre doldurur (`checkout_head`, force).
     - `add_worktree(name, branch) -> PathBuf`: `repo.worktree(name, path,
       Some(WorktreeAddOptions::new().reference(Some(&branch_ref))))`.
     - `add_detached_worktree(name, oid) -> PathBuf`: geçici bir dalla worktree ekler, worktree
       repo'sunda `set_head_detached(oid)` + `checkout_head` (force) yapar, geçici dalı siler.
     - `write_file(dir, rel_path, bytes)`, `stage(worktree_dir, rel_path)` (index'e ekle + yaz).
  4. `testutil` uygulama kodundan çağrılamaz (`cfg(test)`) ve kullanıcının repolarına dokunmaz.
- **Kabul:** Geçici olarak `scan.rs`'e `std::process::Command::new("git")` ve bir `git/*.rs`
  dosyasına `repo.checkout_head(None)` ekleyince
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` ikisini de
  hata olarak veriyor (sonra geri al). `TestRepo` ile iki commit'li dal + worktree kuran örnek
  test geçiyor.

#### T1.3 Repository havuzu
- **Bağımlı:** T1.2
- **Dosyalar:** `git/pool.rs`, `state.rs`, `lib.rs`
- **Adımlar:**
  1. `git/pool.rs`:
     ```rust
     pub struct RepoPool { repos: Mutex<HashMap<PathBuf, Arc<Mutex<Repository>>>> }
     impl RepoPool {
         pub fn get(&self, path: &Path) -> Result<Arc<Mutex<Repository>>, AppError>;
         pub fn forget(&self, path: &Path);
         pub fn retain_existing(&self);   // yolu artık diskte olmayanları at
     }
     ```
     - `get`: yolu `canonicalize` et; havuzda varsa `Arc`'ı klonla. Yoksa
       `Repository::open_ext(&path, RepositoryOpenFlags::NO_SEARCH, &[] as &[&OsStr])` ile aç ve
       ekle. Açılamazsa `AppError::Git` + `log::warn!`, havuza ekleme.
     - Map kilidini sadece map erişimi süresince tut; git2 işi repo'nun kendi `Mutex`'iyle yapılır.
  2. Tazelik kuralı (§6): index kullanan her diff'ten önce `repo.index()?.read(false)?`
     (T2.1'deki `workdir_diff` bunu yapar).
  3. `AppState.Inner`'a `pool: RepoPool` ekle. Açılışta libgit2 sürümünü logla
     (`git2::Version::get().libgit2_version()`).
- **Kabul:** `TestRepo` ile birim testleri: aynı yol iki kez → aynı `Arc` (`Arc::ptr_eq`); repo
  içindeki alt klasör → hata (`NO_SEARCH`); var olmayan yol → hata; klasör silinince
  `retain_existing` kaydı atıyor.

#### T1.4 Config dosyası
- **Bağımlı:** T1.1
- **Dosyalar:** `config.rs`, `commands.rs`
- **Adımlar:**
  1. Yol: `app.path().app_data_dir()?.join("config.json")`; klasör yoksa oluştur.
  2. `load`: dosya yoksa varsayılan config (`version: 1`, boş listeler, `defaultBaseOrder:
     ["origin/HEAD","main","master"]`, `activeDays: 14`). Bozuksa `config.broken-<unix>.json`
     olarak yeniden adlandır, log yaz, varsayılanla devam et.
  3. `save`: önce `config.json.tmp`'ye yaz, sonra `rename` (atomik).
  4. `fn update<F: FnOnce(&mut Config) -> Result<T, AppError>>(state, f)`: kilitle, değiştir,
     kaydet, sonra yeni config ile `config-changed` yayınla (§5; `AppHandle`'ı `AppState`'te
     tut). Tüm mutasyon komutları bunu kullanır.
  5. Id üretimi: `format!("r_{}", &uuid::Uuid::new_v4().simple().to_string()[..8])` (projeler için `p_`).
  6. Komut: `get_config`.
- **Kabul:** Birim testleri: varsayılan config, JSON gidiş-dönüş (HANDOFF §4'teki örnek şekille
  uyumlu), bozuk dosya kurtarma.

#### T1.5 Frontend altyapısı: tipler, IPC, store, event köprüsü, useInvoke, router
- **Bağımlı:** T1.4
- **Dosyalar:** `src/lib/{types,ipc,events,useInvoke,format,paths,entryKey}.ts`,
  `src/state/{nav,ui,data}.ts`, `src/main.tsx`, `src/App.tsx`
- **Adımlar:**
  1. `types.ts`: §4'teki tüm tipler.
  2. `ipc.ts`: her komut için tipli fonksiyon, örn.
     `export const getConfig = () => invoke<Config>('get_config')`.
  3. `state/data.ts` (zustand): backend'in ittiği veri.
     - `config: Config | null`, `scan: Record<string, RepoScan>` (repoId'ye göre),
       `scannedOnce: boolean`.
     - `repoVersion: Record<string, number>` (her `repo-updated`'da o repo için artar),
       `configVersion: number` (her `config-changed`'de artar).
     - Aksiyonlar: `setConfig(c)`, `setScan(r: ScanResult)`, `applyRepoUpdated(e: RepoUpdated)`.
     - Config'te artık olmayan repoların tarama kayıtları seçicilerde (selector) yok sayılır.
  4. `events.ts` → `startEventBridge()`, App açılışında bir kez:
     - **Önce** `listen('config-changed', …)` ve `listen('repo-updated', …)` kur, **sonra**
       `get_config` çağırıp store'u doldur (sıra önemli; arada gelen event kaybolmasın).
     - `get_scan` çağrısı ve `rescanAll()` yardımcısı T2.6/T2.9'da buraya eklenir.
  5. `useInvoke.ts`: istek-cevap verisi için küçük hook (React Query yerine):
     ```ts
     function useInvoke<T>(
       fetcher: () => Promise<T>,
       deps: unknown[],                 // değişince yeniden çağır
       opts?: {
         repoIds?: string[];            // bu repolardan biri için repo-updated gelince yeniden çağır
         onConfig?: boolean;            // config-changed gelince yeniden çağır
         enabled?: boolean;
       },
     ): { data: T | undefined; error: AppError | undefined; loading: boolean }
     ```
     Kurallar:
     - `deps` değişince, ilgili `repoVersion` ya da (`onConfig` ise) `configVersion` artınca
       yeniden çağırır.
     - Yeniden yüklerken **eski `data`'yı tutar** (ekran boşalmaz, titremez); `loading` true olur.
     - Yarış koruması: her çağrıya artan bir numara verilir; gelen cevap en son çağrıya ait değilse
       atılır. Unmount'tan sonra gelen cevap yok sayılır.
     - Vitest testleri: eski veriyi tutma, yarışta eski cevabın atılması, repo sürümü artınca
       yeniden çağırma.
  6. `format.ts`:
     - `formatAge(unix)`: <1 saat → `Nm` (en az `1m`), <24 saat → `Nh`, <365 gün → `Nd`, sonra `Ny`
     - `plural(n, 'branch', 'branches')`
     - Vitest testleri yaz.
  7. `paths.ts`: `tildify(path, home)` (home `@tauri-apps/api/path` `homeDir()` ile bir kez
     alınır), `basename`, `dirname`. Vitest testleri.
  8. `state/nav.ts` (zustand), geçmişli basit router:
     ```ts
     type Route =
       | { name: 'branches' }
       | { name: 'project'; projectId: string }            // 'draft' = kaydedilmemiş taslak (T5.6)
       | { name: 'review'; target: ReviewTarget; focusKey?: string; backLabel: string }
       | { name: 'settings' };
     // state: stack: Route[], index: number
     // actions: push, replace, back, forward; getters: canBack, canForward
     ```
  9. `state/ui.ts` (zustand): `sidebarVisible`, `branchesFilter`, `selectedKeys: string[]`,
     `draftProject`, `paletteOpen`, `toast`, `addReposSheet: string[] | null`.
  10. `App.tsx`: `startEventBridge()`; layout ve route'a göre ekran switch'i.
- **Kabul:** `pnpm test` format/paths/useInvoke testleriyle geçiyor; route değişince placeholder
  ekranlar değişiyor; config store'a geliyor.

#### T1.6 UI temel bileşenleri ve ikonlar
- **Bağımlı:** T0.5, T1.5
- **Dosyalar:** `src/components/*`
- **Adımlar:** Her bileşen kendi `*.module.css` dosyasıyla, değerler token'lardan:
  - `icons.tsx`: §7'deki SVG'ler; `size` ve `className` prop'ları; `stroke="currentColor"`.
  - `Button`: varyantlar
    - `primary`: accent dolgu, `--on-accent` yazı, 600
    - `secondary`: `bg.elevated`, 1px `border`, `text.strong`
    - `ghost`: şeffaf, `text.muted`
    - `danger`: `danger.fill`, beyaz yazı
    - `link`: `accent.text`

    Boyutlar: 32px (varsayılan), 36px (modal), 40px (boş durum). Radius 8. `kbd` prop'u
    sağda mono 11px ipucu gösterir.
  - `IconButton`: 28px (sidebar) / 32px (header, `bg.elevated` + border), radius 7–8.
  - `Pill`: `tone: success | warning | danger | neutral`; 11px/500, padding 3px 10px, radius
    9999. Neutral: yazı `#d8d4cc`, zemin `#302e2a` (palette "in project").
  - `Checkbox`: 16px, `accent-color: var(--accent)`.
  - `TextInput`: 32–36px, `bg.sunken`, 1px `border`, radius 8; focus'ta `--focus-ring`;
    `invalid` prop'u halkayı danger yapar (`#ee9a90` + `rgba(198,69,69,0.25)`).
  - `Kbd`: mono 11px, `#2a2825` zemin, radius 5, padding 1px 6px.
  - `Popover`: `anchorRect` alır, `position: fixed`, altına yerleşir, viewport'a sığdırır;
    `bg.elevated`, border, radius 12, `--shadow-pop`. Dışarı tık ve Esc kapatır.
  - `Menu` + `MenuItem` (+ `danger`, `hint`, `sub` satırı, `divider`); aktif satır `bg.hover`.
    Konteyner padding 6px, öğe padding 8px 10px, radius 8.
  - `Modal`: scrim `--scrim`, kutu `bg.elevated`, radius 16, `--shadow-modal`, üstten konumlu
    (`paddingTop` prop). Esc kapatır.
  - `Toast` (alt ortada; `#2a2825` zemin, `#383631` border, radius 12, `--shadow-pop`) ve
    tek aktif toast'ı yöneten host.
  - `Segmented`: konteyner padding 3, gap 2, `bg.elevated`, radius 10; buton 28px, padding 0 12,
    12px/500; aktif `bg.pressed` + `text.strong`, pasif `text.muted`; sağında mono 11px sayı
    (opacity .7).
  - `KindBadge`: 18px kare, radius 5, mono 10px/500; A/M/R/D/U renkleri token'lardan.
  - `Banner`: `tone: warning | neutral`; padding 9px 20px, 12px, alt border.
- **Kabul:** Geçici bir `/dev` ekranında (sonra sil) tüm bileşen ve varyantlar görünüyor;
  ekran dosyalarındaki ölçü ve renklerle eşleşiyor.

#### T1.7 Sidebar ve uygulama iskeleti
- **Bağımlı:** T1.6
- **Dosyalar:** `src/components/Sidebar/*`, `src/App.tsx`
- **Referans:** `Sidebar.dc.html`, HANDOFF §2 "Sidebar"
- **Adımlar:**
  1. Layout: `sidebarVisible` ise solda 260px sidebar (`bg.sidebar`, sağda 1px `border.row`),
     sağda ekran.
  2. Üst satır (52px, drag region): trafik ışıkları için ~70px boşluk, sonra 28px ikon
     butonları: sidebar toggle, Back, Forward. Back/Forward `nav.canBack`/`canForward`'a göre
     pasif (pasif renk `#5c5a55`).
  3. Nav: "New project" (24px yuvarlak `#302e2a` zeminli + ikonu) ve "Branches" (branch ikonu,
     sağda mono 12px sayı). Satırlar 40px, radius 10, 14px; aktif `bg.sidebarActive` +
     `text.strong`. Şimdilik "New project" bir şey yapmasın (T5.6), sayı `0`.
  4. "Projects" başlığı (14px `text.muted`, cümle düzeni) + search ve sort/filter ikon butonları
     (davranış T5.3). Liste boş.
  5. Footer (56px, üst border `#2a2825`): folder ikonu + "N repositories" (config'ten; tekilde
     "1 repository"), sağda gear → Settings. Aktif route settings ise gear `bg.sidebarActive`.
  6. Sidebar gizliyken ekran header'ı solda trafik ışıkları payı (~78px) + "show sidebar" ve Back
     butonlarını göstersin (Review header'ıyla aynı düzen, `Diff.dc.html:20–31`).
- **Kabul:** Görünüm `Sidebar.dc.html` ile eşleşiyor; toggle, back/forward ve Settings'e gidiş
  çalışıyor.

#### T1.8 Klasör inceleme ve varsayılan base (backend)
- **Bağımlı:** T1.3, T1.4
- **Dosyalar:** `git/refs.rs`, `git/inspect.rs`, `commands.rs`
- **Adımlar:**
  1. `git/refs.rs` → `resolve_default_base(repo, order) -> Option<(name, source)>`, `order`'ın
     her öğesi için sırayla:
     - Öğe `<remote>/HEAD` ise (örn. `origin/HEAD`):
       `find_reference("refs/remotes/<remote>/HEAD")?.symbolic_target()` →
       `refs/remotes/origin/main` → kısa ad `origin/main`. Yerel `main` varsa
       (`find_branch("main", BranchType::Local)`) `("main", öğe)`, yoksa `("origin/main", öğe)`.
       Hata → sonraki öğe.
     - Değilse: `find_branch(öğe, BranchType::Local)` başarılıysa `(öğe, öğe)`; olmazsa
       `revparse_single(öğe)?.peel_to_commit()` başarılıysa `(öğe, öğe)`.
     - Hiçbiri yoksa `None`.
  2. `git/inspect.rs` → `inspect_folders(paths)`: girdileri sırayla işle, tekrarları at. Havuzu
     kullanma; repoları geçici aç.
     - Klasör değil ya da yok → `not_git`.
     - `Repository::discover(dir)` başarısız → `not_git`. (`discover` üst klasörlere doğru arar;
       alt klasör girdisi böylece repo köküne çözülür.)
     - `repo.is_bare()` → `not_git`.
     - `main_root` = `repo.commondir()` `.git` ile bitiyorsa onun parent'ı, değilse
       `repo.workdir()`. Tüm yolları `canonicalize` et.
     - `main_root` config'te var → `duplicate` (`duplicateOf: 'config'`); bu partide daha önce
       çıktıysa → `duplicate` (`'batch'`).
     - `repo.is_worktree()` → `resolved` (`via: 'worktree'`); girdi ≠ `workdir()` → `resolved`
       (`via: 'subdir'`); aksi hâlde `repo`.
     - `defaultBase` = ana repoyu (`main_root`) açıp `resolve_default_base`.
     - Duplicate'lerde de `via` doldurulur (worktree'den geldiyse `'worktree'`).
  3. `add_repos(paths)`: yeniden `inspect` et, `repo`/`resolved` olanların `main_root`'larını
     yeni id'lerle ekle, kaydet, `Config` dön.
- **Kabul:** `TestRepo` ile birim testleri: repo, worktree, alt klasör, repo olmayan klasör,
  partide tekrar; `set_origin_head` ile `origin/HEAD` kaynağı. Fixture'larla elle: `web-app` →
  repo; `wt/token-refresh` → resolved (worktree, web-app'e); `web-app/src` → resolved (subdir);
  `not-a-repo` → not_git; aynı partide iki kez web-app → ikincisi duplicate. `api-server` default
  base = `master`, `web-app` = `main` (kaynak `origin/HEAD`).

#### T1.9 İlk açılış: boş durum, klasör seçici, sürükle-bırak, sheet
- **Bağımlı:** T1.7, T1.8
- **Dosyalar:** `src/screens/Branches/*` (boş durum kısmı), `src/screens/AddRepos/*`
- **Referans:** `Main.dc.html` 76–86 (boş durum), 144–168 ve 227–246 (sheet); HANDOFF §3 akış A
- **Adımlar:**
  1. Repo yokken Branches:
     - Header: başlık "Branches", alt başlık "Nothing to review yet"; refresh ve filtre alanı yok.
     - Ortada: 40px branch ikonu (accent), serif 28px "No repositories yet", 14px açıklama
       (ekrandaki metin birebir), 40px birincil buton "Add repository…", altında 12px muted
       "or drop folders onto this window".
  2. Buton → `open({ directory: true, multiple: true })` (`@tauri-apps/plugin-dialog`); seçim
     varsa `ui.addReposSheet = paths`.
  3. Sürükle-bırak: `getCurrentWebview().onDragDropEvent(e => …)`. `e.payload.type === 'drop'`
     ise `paths` ile sheet'i aç. `enter`/`over` sırasında pencereye ince accent çerçeve,
     `leave`'de kaldır. Her ekranda çalışır.
  4. Sheet (Modal, genişlik 600, `paddingTop: 110`):
     - Başlık serif 22px "Add repositories". Alt başlık: "N folders selected. Worktree folders
       resolve to their main repository."
     - Satırlar `inspect_folders` sonucundan. 22px yuvarlak ikon (✓ success, ↪ warning,
       ✕ danger), mono 12px `tildify(input)`, altında 12px muted not:
       - repo: `Git repository · default base <base>` (base yoksa `Git repository · no default base found`)
       - resolved/worktree: `Worktree of <~repoPath> · adds the main repository`
       - resolved/subdir: `Inside <~repoPath> · adds the repository root`
       - duplicate/worktree: `Worktree of <~repoPath> · already in this list, skipped`
       - duplicate/config: `Already added · skipped`
       - duplicate/batch: `Already in this list · skipped`
       - not_git: `Not a git repository · skipped`
     - Footer (`bg.sunken`): Cancel (secondary) ve "Add N repositories" (primary; tekilde
       "Add 1 repository"; N=0 ise pasif).
  5. Ekle → `add_repos` → sheet kapanır. Yeni config `config-changed` ile store'a gelir. (T2.6
     ve T2.8'den sonra backend eklenen repoları ayrıca tarar, izlemeye alır ve `repo-updated`
     yayınlar.)
- **Kabul:** Fixture klasörlerini (+ `not-a-repo` + bir worktree) seçince notlar doğru; ekleme
  sonrası footer "2 repositories" diyor; uygulamayı kapatıp açınca repolar duruyor.

#### T1.10 ✋ Kontrol noktası — Faz 1
- **Bağımlı:** T1.1–T1.9
- **Kullanıcıya göster:** boş durum, klasör seçici ve sürükle-bırak ile sheet, config dosyasının
  yolu ve içeriği, `clippy.toml` yazma yasaklarının çalıştığı. Onay bekle.

---

### Faz 2 — Branch/worktree keşfi ve Branches ekranı

#### T2.1 Diff → FileChange dönüşümü
- **Bağımlı:** T1.10
- **Dosyalar:** `git/diff.rs`
- **Adımlar:**
  1. `pub enum NewSide { Tree, Workdir }`.
  2. `fn diff_options(workdir: bool) -> DiffOptions` ve `fn find_renames(diff: &mut Diff)` —
     §6 "Diff seçenekleri".
  3. Diff üreticileri (commit id'si alır, tree'yi kendisi çözer):
     - `tree_diff(repo, from: Oid, to: Oid) -> Result<Diff>`
     - `tree_diff_paths(repo, from, to, paths: &[String])`: her yol için `opts.pathspec(p)` +
       `disable_pathspec_match(true)` (squash kontrolü, T2.3)
     - `workdir_diff(wt_repo, from: Oid)`: önce `wt_repo.index()?.read(false)?`, sonra
       `diff_tree_to_workdir_with_index`
  4. `changes(diff: &Diff, side: NewSide) -> Result<Vec<FileChange>, AppError>` — §6 "Delta →
     FileChange" kurallarıyla.
  5. `changed_paths(diff) -> Vec<String>` (rename'lerde eski ve yeni yol) ve
     `delta_count(diff) -> usize` (patch üretmeden sayım).
- **Kabul:** `TestRepo` ile birim testleri: eklenen, değişen, silinen, rename (`oldPath` dolu),
  binary (NUL baytlı dosya → `binary: true`, sayılar `null`), untracked (workdir diff'inde `U`,
  satır sayısı dolu), `.gitignore`'daki dosya listede yok, boşluklu ve Türkçe karakterli yol;
  workdir diff'inde `newOid` her zaman `null`.

#### T2.2 Repo tarama: branch'ler, worktree'ler, base çözümü
- **Bağımlı:** T2.1
- **Dosyalar:** `git/refs.rs`, `git/worktrees.rs`, `git/history.rs`, `scan.rs`
- **Adımlar:**
  1. `git/refs.rs` → `local_branches(repo) -> Vec<LocalBranch { name, tipSha, lastCommitAt }>`:
     `branches(Some(BranchType::Local))`; `name()` `None` ya da `get().target()` `None` ise
     atla; tarih `find_commit(oid)?.time().seconds()`.
  2. `git/worktrees.rs` → `list_worktrees(pool, repo) -> Vec<WorktreeInfo { path, headSha,
     branch: Option<String> }>` (`branch: None` = detached):
     - Ana worktree: repo bare değilse `workdir()` + `head()`. **`worktrees()` ana worktree'yi
       listelemez; bunu ayrıca ekle.**
     - Bağlı worktree'ler: `worktrees()?` → `find_worktree(name)?` → `validate()` hata verirse
       (prunable) ya da `path()` diskte yoksa atla → yolu havuzdan aç → `head_detached()?`,
       `head()?` (`name()` = `refs/heads/x`, `target()` = SHA).
     - Unborn HEAD (henüz commit yok) → atla.
  3. `git/history.rs` → `is_ancestor(repo, ancestor, descendant) -> bool`
     (`a == d || graph_descendant_of(d, a)`).
  4. `scan_repo(pool, repo, config) -> RepoScan`:
     - Repo yolu yoksa → `status: 'missing'`; havuz açamıyorsa → `status: 'error'` + `error`.
       İkisinde de listeler boş.
     - `resolve_default_base` → `defaultBase`, `defaultBaseSource`; commit id'sini çöz.
     - `branch → worktreePath` haritası kur.
     - Her branch için etkin base: `config.branchBases[entryKey] ?? defaultBase`.
     - Aday listesi:
       - Adı `defaultBase`'in kısa adıyla (`origin/` öneki atılmış) aynı olan branch hariç.
       - Worktree'de checkout edilmiş her branch → aktif.
       - Değilse `now - lastCommitAt <= activeDays * 86400` ise özet çıkar (T2.3); `ahead > 0`
         ise aktif.
       - Geri kalanlar → `others`; `merged` = `is_ancestor(tip, defaultBaseTip)` (önbellekli, T2.5).
       - Her detached worktree → aktif, `branch: null`, `worktreePath` dolu.
     - `active` listesini `lastCommitAt`'e göre azalan sırala.
- **Kabul:** `TestRepo` ile birim testi: ana, bağlı ve detached worktree doğru listeleniyor;
  klasörü silinmiş (prunable) worktree atlanıyor. Fixture'ta web-app aktifleri:
  `session-token-refresh`, `feat/billing-v2`, `squashed` (commit'leri main'in atası olmadığı için
  ahead > 0; T2.3'ten sonra state'i `merged` olur). `old-feature` ve `merged-ff` `others`'ta
  (`merged-ff` için `merged: true`). api-server aktifleri: `token-rotation-job`,
  `feat/job-queue`, detached worktree, `to-be-deleted`.

#### T2.3 Entry özeti: ahead, files, merged, durum
- **Bağımlı:** T2.2
- **Dosyalar:** `git/history.rs`, `git/diff.rs`, `scan.rs`
- **Adımlar:** `summarize(ctx, entry_ref) -> EntrySummary`:
  1. Repo yok → `repo_missing`.
  2. Tip: branch ise `local_branches`'tan, detached ise worktree'nin HEAD'i. Bulunamazsa →
     `branch_deleted`.
  3. Base commit'i çözülemezse (`revparse_single(base)?.peel_to_commit()` hata) → `base_missing`
     (`error`: "base <ad> not found").
  4. Önbellekli kısım (anahtar `(repoId, tipSha, baseSha)`, T2.5):
     - `merge_base(base, tip)`; `ErrorCode::NotFound` ise `base_missing` + "no common ancestor".
     - `ahead = graph_ahead_behind(tip, base)?.0`.
     - `tree_diff(mergeBase, tip)` + `find_renames` → `changes(…, NewSide::Tree)` →
       `files` = sayı, `add`/`del` = toplamlar (binary'ler sayılmaz).
     - Squash kontrolü (sadece `ahead > 0` iken):
       - A = `changed_paths` (rename'lerde eski ve yeni yol).
       - `tree_diff_paths(baseSha, tip, A)` (sadece A yollarıyla sınırlı diff).
       - `squashMerged = A boş değil && bu diff'te hiç delta yok` (base bu dosyalarda branch'le
         aynı içeriğe sahip, yani değişiklikler zaten base'de).
  5. `uncommitted`: T2.4 (checkout edilmemişse `null`).
  6. `state` önceliği: `repo_missing` > `git_error` > `branch_deleted` > `base_missing` >
     `detached` (branch null) > `merged` > `ok`.
     `merged` = `(ahead == 0 || squashMerged) && (uncommitted ?? 0) == 0`. (Yeni açılmış ve
     sadece commit'lenmemiş değişikliği olan agent worktree'si "merged" görünmesin.)
  7. Beklenmedik git2 hatası → `git_error`, `error`'a mesaj, `log::warn!`. Asla panik yok.
- **Kabul:** `TestRepo` ile birim testleri: fast-forward merge edilmiş → merged; squash merge
  edilmiş → merged; merge edilmemiş → ok, doğru ahead/files/add/del; ortak atası olmayan base →
  base_missing; durum önceliği tablosu. Fixture'ta `squashed` → merged; `session-token-refresh` →
  ok, ahead 4; detached worktree → detached.

#### T2.4 Commit'lenmemiş değişiklikler
- **Bağımlı:** T2.3
- **Dosyalar:** `git/diff.rs`, `scan.rs`
- **Adımlar:**
  1. `git/diff.rs` → `uncommitted(wt_repo) -> Result<Vec<FileChange>>`: HEAD commit'i →
     `workdir_diff(wt_repo, head)` (HEAD ↔ working tree, index dahil; untracked'lar `U` olarak ve
     satır sayılarıyla gelir) → `find_renames` → `changes(…, NewSide::Workdir)`.
  2. Branches sayısı için patch üretme: `uncommitted_count(wt_repo)` = aynı diff'in
     `delta_count`'u.
  3. Sonuçları önbelleğe alma; worktree'den olay gelince (T2.8) ya da repo yeniden taranınca
     taze okunur.
- **Kabul:** `TestRepo` ile: worktree'de bir dosyayı değiştir + bir untracked dosya ekle → 2
  değişiklik (biri `U`); `stage` edilmiş değişiklik de sayılıyor; `.gitignore`'daki dosya
  sayılmıyor; yeni dal + sadece uncommitted değişiklik → state `merged` değil. Fixture'ta
  `session-token-refresh` → 2, `token-rotation-job` → 1.

#### T2.5 Önbellek ve paralel tarama
- **Bağımlı:** T2.3
- **Dosyalar:** `cache.rs`, `scan.rs`
- **Adımlar:**
  1. `Cache { committed: HashMap<(String, String, String), CommittedStats> }`; anahtar
     `(repoId, tipSha, baseSha)`. `CommittedStats`: `mergeBase`, `ahead`, `files`, `add`, `del`,
     `squashMerged`, sonradan eklenecek alanlar için `Option`'lar (review dosya listesi ve commit
     listesi T3.2'de buraya eklenir).
  2. Tarama sonunda artık hiçbir branch'in tip'i olmayan anahtarları sil (veya 5000 kaydı geçince
     tamamen temizle).
  3. Repoları paralel tara (`std::thread::scope`, repo başına bir thread; repo içi sıralı).
     `git2::Repository` `Sync` değildir, her biri kendi `Mutex`'indedir (T1.3). Ana repo ve bir
     worktree repo'sunun kilidi birlikte gerekiyorsa sıra hep ana repo → worktree. Cache
     kilidini git2 çalışırken tutma: oku → bırak → hesapla → yaz.
  4. Her taramanın süresini `log::info!("scan: {} repos, {} ms", …)` ile yaz.
- **Kabul:** İkinci tam tarama (değişiklik yokken) ilkinden belirgin hızlı; log'da görülüyor.

#### T2.6 Tarama komutları ve saklı sonuç
- **Bağımlı:** T2.4, T2.5
- **Dosyalar:** `scan.rs`, `state.rs`, `commands.rs`, `src/lib/events.ts`
- **Adımlar:**
  1. `AppState`'e `last_scan: Mutex<HashMap<String, RepoScan>>` (repoId → son tarama) ekle.
  2. `scan_all(state) -> ScanResult`: tüm repoları paralel tara, `last_scan`'i baştan yaz.
     `rescan_repo(state, repo_id, reason, worktree_path)`: tek repoyu tara, `last_scan`'e yaz,
     `repo-updated` yayınla.
  3. Komutlar:
     - `get_scan`: `last_scan` doluysa ondan `ScanResult` kur, değilse `scan_all`.
     - `rescan_all`: her zaman `scan_all`; ayrıca her repo için `repo-updated` (`reason:
       'rescan'`) yayınla ki açık ekranlar da yenilensin.
  4. Repoyu etkileyen komutlar tarar: `add_repos` → eklenen repolar için `rescan_repo`;
     `update_settings` (T8.2) → `rescan_all` mantığı; `set_branch_base` (T6.1), `locate_repo` ve
     `remove_repo` (T8.1) de bu yardımcıları kullanır.
  5. Frontend `events.ts`: `get_config`'ten sonra `get_scan` çağırıp `setScan` yap, `scannedOnce`
     true olsun. `rescanAll()` yardımcısını ekle (aynı anda ikinci çağrıyı başlatmaz).
- **Kabul:** `get_scan` ikinci çağrıda taramadan saklı sonucu dönüyor; `rescan_all` sonrası
  frontend'de `repo-updated` event'leri görülüyor (geçici `console.log`, sonra kaldır).

#### T2.7 Branches ekranı
- **Bağımlı:** T2.6, T1.9
- **Dosyalar:** `src/screens/Branches/*`
- **Referans:** `Main.dc.html`, HANDOFF §2 "Branches"
- **Adımlar:**
  1. Veri: `state/data.ts`'teki `scan` ve `config`. Bir projede bulunan entry key'lerini kümele; `active`
     içinden bunları çıkar. Kalanlar Branches satırlarıdır; sidebar'daki "Branches" sayısı da bu.
     **T7.0 ile değişti:** üyelik filtresi kaldırıldı, Branches tüm aktif branch'leri gösterir.
  2. Header (64px, drag region):
     - Başlık "Branches".
     - Alt başlık: `Active branches not in any project · N repos · checked out in a worktree, or
       committed in the last D days` (tekilde "1 repo").
     - Sağda refresh (32px) ve filtre alanı: 230px, 32px, `bg.sunken`, search ikonu,
       placeholder "Filter branch or worktree", sağda `Kbd` "⌘K".
     - Filtre gerçek filtre, kelime bazlı: `-`, `/`, `_`, `.` boşluk sayılır; aranan her kelime
       branch/SHA, worktree yolu ya da repo adında (sırası fark etmez, büyük/küçük harf duyarsız)
       geçmeli. "to be" → `to-be-deleted`, "feat queue" → `feat/job-queue` (kullanıcı kararı
       2026-09-26). Esc temizler.
  3. Kolon başlığı: grid `16px minmax(0,1fr) 60px 68px 128px 150px 44px 136px`, column-gap 12,
     padding 10px 28px, bölüm etiketi stili: [boş] Branch · Ahead · Files · Uncommitted · State ·
     Age · [boş].
  4. Repo bandı: `bg.band`, üst border `border.strong`, alt border `border`, padding 10px 28px.
     İçerik: folder ikonu (accent), 15px/600 repo adı, mono 11 muted `tildify(path)`, sağda
     "N branches". Bantlar arası boşluk 14px. Satırı olmayan repo gösterilmez.
     `status: 'missing'` olan repo: bant gösterilir, sayı yerine danger pill "path not found";
     tıklayınca Settings.
  5. Satır (aynı grid, padding 10px 28px, alt border `border.row`):
     - Checkbox — T5.8'e kadar görünmez ama yeri korunur.
     - Branch hücresi: mono 13 `text.strong` branch adı (detached ise `shortSha`); altında mono
       11 muted `base <base> · worktree <~path>` ya da `base <base> · not checked out`. Sadece
       branch adı tıklanabilir link (T3.6).
     - Ahead: mono 12 `↑N`. Files: mono 12 sayı.
     - Uncommitted: >0 ise 12px/500 `accent.text` `● N changed`, değilse faint "—".
     - State:
       - merged → success "merged into <base>"
       - detached → warning "detached HEAD"
       - base_missing → warning "base missing"
       - git_error → danger "git error" (`title` = hata)
       - ok → faint "—"
     - Age: mono 12 muted `formatAge`.
     - Son hücre: "+ Add to project" butonu — T5.7'ye kadar gizli ama yeri korunur.
  6. Hover: satır zemini `bg.sunken`.
  7. Sıralama: repolar en yeni `lastCommitAt`'e göre, satırlar kendi içinde en yeniden eskiye.
  8. İlk tarama sürerken ortada muted "Scanning repositories…". Repo var ama satır yoksa ortada
     serif 22px "No active branches" ve 14px "Branches checked out in a worktree or committed in
     the last D days show up here."
- **Kabul:** Fixture'la ekran `Main.dc.html` (popover'sız varsayılan hâl) ile yan yana karşılaştırıldı;
  kolonlar hizalı, pill'ler ve sayılar doğru, filtre çalışıyor.

#### T2.8 Dosya izleme ve hedefli yeniden hesaplama (backend)
- **Bağımlı:** T2.6
- **Dosyalar:** `watch.rs`, `git/worktrees.rs`, `scan.rs`, `state.rs`, `lib.rs`
- **Adımlar:** §6 "Değişiklik izleme"yi uygula.
  1. `watch.rs`, saf kısım (git2'ye ve diske dokunmaz, birim testli):
     ```rust
     pub enum RootKind { GitDir { repo_id: String }, Worktree { repo_id: String, path: PathBuf } }
     pub struct WatchIndex { roots: Vec<(PathBuf, RootKind)> }       // canonical yollar
     pub enum Change {
         Refs { repo_id: String },
         Worktree { repo_id: String, path: PathBuf, rel: PathBuf },   // rel: worktree'ye göreli
     }
     pub fn classify(index: &WatchIndex, path: &Path) -> Option<Change>;  // en uzun kök eşleşmesi
     pub fn desired_roots(repos: &[(repo_id, git_dir, Vec<worktree_path>)]) -> Vec<(PathBuf, RootKind)>;
     ```
     `desired_roots`: iç içe kökleri tekilleştirir (içte kalanı ayrıca izleme).
  2. `git/worktrees.rs` → `is_ignored(wt_repo, rel) -> bool`: `rel`'in köke en yakın atasından
     başlayarak `is_path_ignored`; bir ata ignore ise `true`. Batch içi önbellek için
     `HashMap<(worktree, ata), bool>` çağıran tarafta tutulur.
  3. Watcher kurulumu (`setup`'ta): `new_debouncer(Duration::from_millis(300), None, tx)`.
     Callback sadece `tx.send(result)`. Watcher nesnesini `AppState`'te tut (düşerse izleme durur).
  4. İşçi thread'i:
     - `rx.recv()` ile bekle, sonra `try_recv` ile kuyruktaki tüm batch'leri de al.
     - Her olay yolunu `classify` et; `Worktree` olanları ignore süzgecinden geçir.
     - `Change` kümesine indir (aynı repo için `Refs` varsa o reponun `Worktree`
       değişikliklerini at; tam tarama onları da kapsar).
     - `Refs` → `rescan_repo(…, 'refs', None)`; `Worktree` → o worktree için
       `uncommitted_count`, `last_scan`'deki entry'yi güncelle (state geçişi dahil),
       `repo-updated` (`'worktree'`, `worktreePath`) yayınla.
     - Her turu `log::debug!` ile yaz (olay sayısı, iş sayısı, süre).
  5. `sync_watches(state)`: config'teki repolar + her reponun güncel worktree listesinden
     `desired_roots`'u hesapla; mevcutla farkı `watch(path, RecursiveMode::Recursive)` /
     `unwatch` et; `WatchIndex`'i güncelle. Çağrıldığı yerler: açılış, `scan_all` sonrası,
     worktree listesi değişen `rescan_repo` sonrası, repo ekleme/kaldırma/yer değiştirme.
  6. `watch` hatası uygulamayı durdurmaz: `log::warn!`; o kök için sadece focus/refresh taraması
     kalır.
- **Kabul:**
  - Birim testleri (`classify`, `desired_roots`): git dizini tablosundaki her satır; ana worktree
    içindeki `.git/…` yolunun git dizinine düşmesi; bağlı worktree'deki `.git` dosyasının atılması;
    iç içe köklerin tekilleşmesi.
  - `TestRepo` ile: `.gitignore`'da `build/` varken `build/a/b.txt` ignore; `src/a.ts` değil.
  - Fixture'larla elle (sadece fixture repolarında, uygulama açıkken terminalden):
    - worktree'de dosya değiştir → log'da tek `Worktree` işi, `repo-updated` yayınlanıyor;
    - `git -C <wt> add <dosya>` → index olayı geliyor, sayı doğru;
    - worktree'de commit → `Refs` işi; ahead/files artıyor, uncommitted düşüyor;
    - ignore edilen bir klasörde 2000 dosya oluştur (örn. `.gitignore`'da `node_modules/` varken
      `mkdir -p node_modules && for i in $(seq 1 2000); do touch node_modules/f$i; done`) → log'da
      yeniden hesaplama yok;
    - `git -C <repo> worktree add ../wt/yeni -b yeni` → yeni worktree izlenmeye başlıyor;
      `git worktree remove` → izlemeden çıkıyor.

#### T2.9 Frontend: canlı güncelleme, focus ve refresh butonu
- **Bağımlı:** T2.7, T2.8
- **Dosyalar:** `src/lib/events.ts`, `src/state/data.ts`, `src/App.tsx`, refresh butonları
- **Adımlar:**
  1. `repo-updated` → `applyRepoUpdated`: o reponun `RepoScan`'ini değiştirir ve
     `repoVersion[repoId]`'i artırır. Branches ve sidebar sayacı store'dan okuduğu için
     kendiliğinden güncellenir.
  2. `getCurrentWindow().onFocusChanged(({ payload }) => payload && rescanAll())` (App'te bir kez).
  3. Tüm refresh butonları `rescanAll()` çağırır; çalışırken ikon döner.
  4. Zamanlayıcı yok: `setInterval`/`setTimeout` ile periyodik yenileme yazma. UI'da yenilemeyle
     ilgili metin yok (HANDOFF §4.7).
- **Kabul:** Uygulama açıkken terminalden fixture worktree'sinde dosya değiştirince Branches ~1 sn
  içinde, hiçbir şeye tıklamadan güncelleniyor. `grep -rn "setInterval" src` boş.

#### T2.10 ✋ Kontrol noktası — Faz 2
- **Bağımlı:** T2.1–T2.9
- **Kullanıcıya göster:** fixture repolarıyla Branches ekranı, merged/detached pill'leri, filtre;
  canlı güncelleme (terminalden dosya değiştir, stage et, commit at, worktree ekle/sil); ignore
  edilen klasördeki olay fırtınasının iş üretmediği log. Kendi gerçek repolarından birini
  eklemesini öner. Onay bekle.

---

### Faz 3 — Commit'lenmiş diff (Review ekranı + Monaco)

#### T3.1 Monaco kurulumu ve tema
- **Bağımlı:** T2.10
- **Dosyalar:** `src/monaco/setup.ts`, `src/monaco/theme.ts`, `src/monaco/language.ts`, `src/main.tsx`
- **Adımlar:**
  1. `setup.ts` (main.tsx'te en başta import et):
     ```ts
     import * as monaco from 'monaco-editor';
     import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
     import { loader } from '@monaco-editor/react';
     self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
     loader.config({ monaco });   // CDN yerine yerel bundle
     ```
  2. `theme.ts`: `monaco.editor.defineTheme('gitgel', { base: 'vs-dark', inherit: true, … })`,
     renkler `tokens.ts`'ten:
     - `editor.background` `#141311`, `editor.foreground` `#e0ddd6`
     - `editorLineNumber.foreground` `#75726b`, `editorLineNumber.activeForeground` `#a09d96`
     - `editorGutter.background` `#141311`, `editor.lineHighlightBackground` `#00000000`
     - `diffEditor.insertedLineBackground` `#5db87226`, `diffEditor.removedLineBackground` `#c645452b`
     - `diffEditor.insertedTextBackground` `#5db87240`, `diffEditor.removedTextBackground` `#c6454548`
     - `diffEditor.diagonalFill` `#1c1b18`
     - `diffEditor.unchangedRegionBackground` `#1a1917`, `diffEditor.unchangedRegionForeground` `#75726b`
     - `diffEditor.border` `#302e2a`
     - scrollbar renkleri `#383631`

     Sözdizimi kuralları sadece token renkleri:

     | Token | Renk |
     |---|---|
     | keyword | `#7fb3c4` |
     | string | `#e8c071` |
     | number | `#c5b2f2` |
     | type | `#93b8ee` |
     | comment | `#75726b` (italik) |
     | diğer | `#e0ddd6` |
  3. Karşı taraf dolgusu: HANDOFF'taki `repeating-linear-gradient(135deg, #1c1b18 0 4px, #141311
     4px 8px)` için Monaco'nun `.diagonal-fill` sınıfını global CSS'te override et.
  4. `language.ts`: `languageForPath(path)`: `monaco.languages.getLanguages()` içinde
     uzantı/dosya adı eşleşmesi; yoksa `'plaintext'`.
  5. Fontlar: editörü oluşturmadan önce `await document.fonts.load('12px "JetBrains Mono"')`,
     sonra `monaco.editor.remeasureFonts()`.
- **Kabul:** Offline'da (Wi-Fi kapalı) geçici bir DiffEditor iki metni temayla gösteriyor; konsolda
  CDN isteği yok.

#### T3.2 Review verisi (committed) — backend
- **Bağımlı:** T3.1
- **Dosyalar:** `review.rs`, `git/history.rs`, `commands.rs`, `cache.rs`
- **Adımlar:** `get_review(target)`. Bu task'ta sadece `kind: 'branch'`:
  1. Entry'yi özetle (`summarize`; `tipOverride` varsa tip olarak onu kullan).
  2. Review edilebilir (`ok`/`detached`/`merged`) ise grup kur:
     - `files.committed` = `tree_diff(mergeBase, tip)` + `find_renames` →
       `changes(…, NewSide::Tree)`.
     - `commits` = `git/history.rs` → `commits(repo, base, tip, 200)`: revwalk `push(tip)`,
       `hide(base)`, `set_sorting(Sort::TOPOLOGICAL | Sort::TIME)`; her commit için `id()`,
       `summary()`, `time().seconds()`.
     - `files.uncommitted = []`, `files.all = files.committed` (T4.1'de doldurulur).
     - `stackHint = null` (T6.2).
  3. Committed dosya listesi ve commit listesi `(repoId, tip, baseSha)` önbelleğine eklenir.
  4. Review edilemez durumdaki entry `notInReview`'a girer.
- **Kabul:** `TestRepo` ile commit sırası ve sayısı testi. Fixture'ta `session-token-refresh`
  için 4 commit ve rename dahil doğru dosya listesi; binary dosyada `binary: true`.

#### T3.3 Dosya içeriği okuma — backend
- **Bağımlı:** T3.2
- **Dosyalar:** `files.rs`, `git/diff.rs`, `commands.rs`
- **Adımlar:** `read_file_pair(repoId, worktreePath, change)`:
  1. Blob'lar ana repodan okunur (worktree'ler object DB'yi paylaşır). `git/diff.rs`'e iki
     yardımcı: `blob_size(repo, oid)` = `odb()?.read_header(oid)?.0` (içeriği yüklemez) ve
     `blob_bytes(repo, oid)` = `find_blob(oid)?.content().to_vec()`.
  2. Önce boyut: taraflardan biri > 1 MiB → `tooLarge: true`, içerik boş.
  3. `original` = `oldOid` ? `blob_bytes` : boş.
  4. `modified` = `newOid` ? `blob_bytes` : (kind D ise boş, değilse diskten — T4.2).
  5. `binary` = `change.binary` ya da iki taraftan birinin ilk 8000 baytında NUL var. Binary ise
     içerik boş döner.
  6. Metin: `String::from_utf8_lossy`.
  7. Frontend: `useInvoke(() => readFilePair(…), [seçili dosya, mod], { repoIds: change.newOid === null ? [repoId] : [] })`.
     İki taraf da blob ise içerik değişmez; olaylarla yeniden çekme.
- **Kabul:** Rename edilen dosyada sol eski, sağ yeni içerik; binary'de `binary: true`.

#### T3.4 Review ekranı iskeleti ve dosya listesi
- **Bağımlı:** T3.2, T1.6
- **Dosyalar:** `src/screens/Review/*`
- **Referans:** `Diff.dc.html`, HANDOFF §2 "Review"
- **Veri:** `useInvoke(() => getReview(target), [target], { repoIds: <hedefteki repo id'leri>,
  onConfig: true })`. Bir repo değişince ekran boşalmadan yenilenir; seçili dosya yeni listede
  hâlâ varsa seçim korunur, yoksa grubun ilk dosyasına geçer.
- **Adımlar:**
  1. Review route'una girince `sidebarVisible = false`; çıkınca eski değerine dön.
  2. Header (56px, `bg.main`, alt border, drag region):
     - Trafik ışığı payı, show-sidebar butonu, Back (aria-label `backLabel`: "Back to Branches" /
       "Back to project").
     - Başlık serif 18px + 12px muted alt başlık. Branch kapsamı: başlık = branch (detached ise
       `shortSha`), alt başlık `<repo> · not in a project` (branch bir projedeyse
       `<repo> · in <Project>`).
     - Sağda `Segmented` (Committed/Uncommitted/All, sayılar = gruplardaki dosya sayılarının
       toplamı; bu fazda sadece Committed etkin, diğerleri T4.3) ve refresh butonu.
  3. Sol liste (310px, `bg.sidebar`, sağ border, padding 8, dikey scroll), grup başına:
     - Satır 1: chevron (kapalıyken −90°) + 14px/600 repo adı; sağa yaslı base butonu (22px,
       padding 0 8, radius 6, `bg.elevated`, mono 11, "base" muted + ad + chevron). Base
       butonunun davranışı T6.3'te; `baseIsCustom` ise accent border + 2px halka.
     - Satır 2 (padding-left 20): mono 12 branch (ellipsis), sağda mono 11 yeşil `+add` ve
       kırmızı `−del` (del 0 ise gösterme).
     - Dosya satırları (30px, padding 0 8 0 28, gap 8, radius 8; seçili `bg.hover`): KindBadge,
       mono 12 `text.strong` dosya adı, mono 11 sönük dizin (ellipsis; rename'de
       `dir ← old/path`; untracked'ta `dir · untracked`), mono 11 `+N` / `−N`.
     - Grup kapatma chevron'la.
  4. Sağ taraf üstü (padding 12px 18px, alt border):
     - Satır: 14px/600 repo, mono 12 branch, mono 11 muted `<base>..<branch>`, sağda 12px muted
       `N commits ahead of <base>`.
     - Commit listesi (gap 6, max-height ~132px, scroll): mono 12 `accent.text` shortSha,
       `text.strong` mesaj, mono 11 muted yaş.
  5. Dosya başlık çubuğu (padding 9px 18px, `bg.sunken`, alt border): mono 12 path, 12px muted
     karşılaştırma etiketi (`merge-base ↔ <branch>`), sağda "Side by side · read-only".
  6. Varsayılan seçim: ilk grubun ilk dosyası. Seçim değişince sağ taraf o dosyanın grubuna
     (entry bar + commit listesi) geçer.
  7. Seçili modda hiç dosya yoksa sağ tarafta ortada muted "No committed changes".
- **Kabul:** Branch kapsamında ekran `Diff.dc.html` (`scope=branch`) ile karşılaştırıldı.

#### T3.5 Diff görünümü
- **Bağımlı:** T3.3, T3.4
- **Dosyalar:** `src/monaco/DiffView.tsx`
- **Adımlar:**
  1. `@monaco-editor/react` `DiffEditor`, `theme="gitgel"`. Seçenekler:
     ```ts
     { readOnly: true, originalEditable: false, renderSideBySide: true,
       useInlineViewWhenSpaceIsLimited: false, renderIndicators: true,
       hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3 },
       fontFamily: 'JetBrains Mono', fontSize: 12, lineHeight: 20,
       minimap: { enabled: false }, renderOverviewRuler: false,
       scrollBeyondLastLine: false, automaticLayout: true, contextmenu: false }
     ```
  2. `language = languageForPath(path)`.
  3. Yüklenirken boş alan (spinner yok, titreme olmasın). `binary` ise ortada muted "Binary file
     not shown"; `tooLarge` ise "File is too large to show (over 1 MB)".
  4. Katlanan bölgenin metni Monaco'nun kendi metnidir ("⋯ N unchanged lines" birebir
     olmayabilir); sadece renkleri tema ile eşleştir. Bu kabul edilen bir sapmadır.
- **Kabul:** Eklenen/silinen/değişen satır renkleri HANDOFF §1 "Diff colours" ile eşleşiyor; dosya
  değiştirince editör yeniden oluşmadan içerik değişiyor.

#### T3.6 Navigasyon: Branches → Review
- **Bağımlı:** T3.5
- **Dosyalar:** `src/screens/Branches/*`, `src/screens/Review/*`
- **Adımlar:**
  1. Branches'ta branch adı linki →
     `nav.push({ name: 'review', target: { kind: 'branch', repoId, branch, worktreePath, tipOverride: null }, backLabel: 'Back to Branches' })`.
  2. Review header'ındaki Back → `nav.back()`. Show-sidebar → sidebar'ı açar (ekran daralır).
- **Kabul:** Branches → Review → Back akışı; sidebar'daki back/forward da çalışıyor.

#### T3.7 ✋ Kontrol noktası — Faz 3
- **Bağımlı:** T3.1–T3.6
- **Kullanıcıya göster:** `session-token-refresh` review'u (rename, test dosyası), `feat/billing-v2`
  binary dosyası, offline çalışma. Onay bekle.

---

### Faz 4 — Commit'lenmemiş katman ve mod toggle

#### T4.1 Uncommitted ve All dosya listeleri — backend
- **Bağımlı:** T3.7
- **Dosyalar:** `review.rs`
- **Adımlar:** Entry bir worktree'de checkout edilmişse (`worktreePath` dolu), worktree repo'sunu
  havuzdan al:
  - `files.uncommitted` = `uncommitted(wt_repo)` (T2.4; HEAD ↔ working tree + untracked).
  - `files.all` = `workdir_diff(wt_repo, mergeBase)` + `find_renames` →
    `changes(…, NewSide::Workdir)` (merge-base ↔ working tree; untracked'lar dahil).

  Checkout edilmemişse `uncommitted = []`, `all = committed`. Bunlar önbelleğe alınmaz.
- **Kabul:** `session-token-refresh`: uncommitted 2 dosya (biri U), all = committed ∪ uncommitted.

#### T4.2 Working tree'den içerik okuma
- **Bağımlı:** T4.1, T3.3
- **Dosyalar:** `files.rs`
- **Adımlar:**
  1. `newOid == null` ve kind ≠ D ise sağ taraf `worktreePath/path` dosyasından okunur.
  2. Güvenlik:
     - `worktreePath`, o reponun bilinen worktree'lerinden biri olmalı (worktree listesiyle
       doğrula); değilse `Forbidden`.
     - `canonicalize(join)` sonucu `canonicalize(worktreePath)` ile başlamalı; değilse `Forbidden`.
  3. Symlink ise hedefi değil link metnini göster (`read_link`).
  4. Dosya yoksa (az önce silindi) `""`. Boyut ve binary kuralları T3.3 ile aynı.
- **Kabul:** Untracked dosya sağda tam içerikle, solda boş görünüyor; `../` içeren sahte bir path
  reddediliyor (birim testi).

#### T4.3 Mod toggle, banner ve etiketler — frontend
- **Bağımlı:** T4.1, T4.2
- **Dosyalar:** `src/screens/Review/*`
- **Adımlar:**
  1. `Segmented` üç mod da etkin; sayılar her mod için tüm grupların dosya sayısı toplamı.
  2. Mod değişince seçim o modun ilk dosyasına sıfırlanır. Seçili modda dosyası olmayan gruplar
     gizlenir.
  3. Varsayılan mod: Committed. İstisna: committed toplamı 0 ve uncommitted > 0 ise
     Uncommitted.
  4. Uncommitted modunda:
     - Commit listesi gizli.
     - Header altında warning `Banner`: proje kapsamında `Uncommitted changes across N
       checked-out entries`, branch kapsamında `Working tree at <~path>`.
     - Entry bar'da `working tree <~path>` ve sağda `HEAD ↔ working tree`.
  5. Karşılaştırma etiketi:
     - Committed → `merge-base ↔ <branch>`
     - Uncommitted → `HEAD ↔ working tree`
     - All → checkout edilmişse `merge-base ↔ working tree`, değilse `merge-base ↔ <branch>`
  6. Boş mod mesajları: "No committed changes" / "No uncommitted changes" / "No changes".
- **Kabul:** Üç mod `Diff.dc.html`'deki `mode` durumlarıyla eşleşiyor; yenilemeyle ilgili metin
  yok; worktree'de dosya değiştirince açık review ve sağdaki diff kendiliğinden güncelleniyor.

#### T4.4 ✋ Kontrol noktası — Faz 4
- **Bağımlı:** T4.1–T4.3
- **Kullanıcıya göster:** Üç mod, untracked dosya, working tree'de değişiklik yapınca review'un
  kendiliğinden güncellenmesi.
  Onay bekle.

---

### Faz 5 — Projeler ve Add palette

#### T5.0 Sonradan repo ekleme: sidebar footer ve her ekranda bırakma (akış A5–A7)
- **Bağımlı:** T1.9, T4.4
- **Dosyalar:** `src/components/Sidebar/*`, `src/screens/AddRepos/*`, `src/App.tsx` (drop overlay)
- **Referans:** `Sidebar.dc.html` 79–90 ve `repoRowStyle`/`repoAddStyle` (100–121); `Main.dc.html`
  144–151 (overlay), 153–177 ve 244–268 (sheet); HANDOFF §2 "Sidebar", §3 akış A 5–7
- **Adımlar:**
  1. Klasör seçici + sheet açılışını tek fonksiyona topla: `openAddRepos(paths?)`. `paths` yoksa
     önce `open({ directory: true, multiple: true })`. Boş durum butonu, sürükle-bırak, sidebar
     "+" ve Settings (T8.1) hep bunu çağırır.
  2. Sidebar footer (56px, padding `0 12px 0 10px`, gap 4):
     - Sol: link satırı (flex-grow, 36px, radius 8, padding `0 10px`, gap 12): folder ikonu +
       "N repositories" (tekilde "1 repository") → Settings. Hover'da zemin `bg.sunken`.
     - Ortada 32px ikon butonu "+" (aria-label "Add repository", title "Add repository…"): sadece
       footer hover'dayken görünür (yoksa `visibility: hidden`, yer tutar). Hover'da `bg.hover`,
       `text.strong`. Tıklayınca `openAddRepos()`.
     - Sağda mevcut gear → Settings.
  3. Sürükle-bırak overlay'i (T1.9'daki ince çerçevenin yerine): `enter`/`over` sırasında tüm
     pencerenin üstünde, `pointer-events: none`: 2px inset accent çerçeve
     (`box-shadow: inset 0 0 0 2px #4f8fa3`), `rgba(79,143,163,0.06)` zemin, ortada elevated pill
     (padding 12px 18px, radius 12, 1px accent border, popover gölgesi): folder+plus ikonu (18px,
     accent) + 14px "Drop folders to add repositories". `leave`/`drop`'ta kalkar. Repo olsun
     olmasın her ekranda aynı. Bir modal (sheet dahil) açıkken bırakma yok sayılır.
  4. Sheet metinleri:
     - Alt başlık: config'te repo yoksa mevcut metin; varsa "N folders selected. Repositories
       already in Gitgel are skipped."
     - `duplicate` + `duplicateOf: 'config'` + `via: 'worktree'` → `Worktree of <~repoPath> ·
       already added, skipped`. (`duplicateOf: 'batch'` + worktree mevcut "already in this list"
       notunu korur.) Diğer notlar T1.9'daki gibi.
     - Buton sadece eklenecekleri sayar; hepsi atlanıyorsa pasif.
- **Kabul:** Repo varken footer hover'da "+" görünüyor ve seçiciyi açıyor; satıra tıklamak
  Settings'e gidiyor. Zaten ekli `web-app`, onun bir worktree'si ve yeni bir fixture repo
  seçilince notlar sırasıyla "Already added · skipped", "Worktree of ~/… · already added,
  skipped", "Git repository · default base …"; buton "Add 1 repository". Branches ve Review
  ekranlarındayken klasör sürükleyince overlay çıkıyor, bırakınca sheet açılıyor.

#### T5.1 Proje komutları — backend
- **Bağımlı:** T4.4
- **Dosyalar:** `projects.rs`, `commands.rs`
- **Adımlar:** Hepsi `config::update` ile:
  - `create_project(name, entries)`: adı trim'le; boşsa hata; mevcut bir adla (büyük/küçük harf
    duyarsız) çakışırsa `NameConflict`. Yeni id, `createdAt`. Her entry'nin `lastKnownTip`'ini o
    anki tip ile doldur. `ProjectConfig` döner.
  - `rename_project(projectId, name)`: aynı ad kuralları (kendisi hariç).
  - `delete_project(projectId)`.
  - `add_entries(projectId, entries)`: aynı key zaten varsa atla; `lastKnownTip`'i doldur.
  - `remove_entries(projectId, keys)`.
- **Kabul:** Birim testleri: çakışma (büyük/küçük harf), boş ad, tekrar eden entry, silme.

#### T5.2 Proje görünümü verisi — backend
- **Bağımlı:** T5.1
- **Dosyalar:** `projects.rs`, `scan.rs`
- **Adımlar:** `get_project_view(projectId)`: her entry için `summarize` (aktif olup olmamasından
  bağımsız; önbellek devrede), proje sırasını koru. Bilinmeyen `projectId` → `NotFound`.
- **Kabul:** Eski bir branch (`old-feature`) eklenmiş projede de doğru özet dönüyor.

#### T5.3 Sidebar proje listesi
- **Bağımlı:** T5.2, T1.7
- **Dosyalar:** `src/components/Sidebar/*`
- **Referans:** `Sidebar.dc.html` 60–75 ve 94–110
- **Adımlar:**
  1. Projeler `config.projects`'ten. Satır: 40px, padding-left 16, gap 14; 7px içi boş daire
     (1.5px border; aktifse `#e0ddd6`, değilse `#75726b`) + ad (ellipsis). Sayı yok. Tık →
     Project ekranı; aktif proje `bg.sidebarActive`.
  2. Search ikonu: "Projects" satırını 32px "Filter projects" inputuna çevirir; ad içinde filtre;
     Esc kapatır.
  3. Sort/filter ikonu: `Menu` → "Sort by name" / "Sort by date created" (varsayılan: oluşturma
     sırası). Seçim `localStorage`'da.
  4. Sağ tık (`contextmenu`, preventDefault) → Project menüsü (T5.5'teki bileşen: Rename, Delete
     project…). Rename seçilince o projeye gidip rename moduna geçer.
  5. Taslak proje varken (T5.6) taslak adıyla aktif bir satır listenin sonunda görünür.
- **Kabul:** Listeleme, filtre, sıralama ve sağ tık menüsü çalışıyor.

#### T5.4 Project ekranı
- **Bağımlı:** T5.3
- **Dosyalar:** `src/screens/Project/*`
- **Referans:** `Projects.dc.html`, HANDOFF §2 "Project"
- **Veri:** `useInvoke(() => getProjectView(id), [id], { repoIds: <projedeki repo id'leri>,
  onConfig: true })` (taslak projede satırlar store'daki `scan`'den gelir, T5.8).
- **Adımlar:**
  1. Header (64px):
     - Serif 22px başlık (çift tık → rename, T5.5).
     - Alt başlık: `N entries across M repos` / `1 entry · <repo>` / `Empty`.
     - Sağda sırayla: refresh, "⋯" (32px; menü açıkken `bg.pressed` + border `#4a4741`),
       secondary "Add entries ⌘K", primary "Review changes".
  2. Tablo:
     - Grid `104px minmax(0,1fr) 160px 56px 56px 116px 160px 32px`, padding 12px 28px, satır alt
       border `border.row`. Kolon başlığı etiket stilinde: Repo · Branch · Base · Ahead · Files ·
       Uncommitted · State · [boş].
     - Hücreler:
       - Repo: serif 15px. Tıklanınca Branches'a gidip o reponun bandına kayar ve kısa süre
         vurgular; satırı kalmamış repo da "0 branches" bandıyla görünür. Review entry bar'ındaki
         repo adı da aynı (kullanıcı kararı 2026-09-26).
       - Branch: mono 13 link, ellipsis → proje review'u, `focusKey` = entry key (T5.10).
       - Base: buton (mono 12, `bg.elevated`, border, radius 8, padding 4px 10px, ellipsis +
         chevron); davranışı T6.3.
       - Ahead: `↑N` ya da "—". Files: sayı ya da "—".
       - Uncommitted, State: Branches'taki gibi. Ek pill'ler: branch_deleted → danger "branch
         deleted"; repo_missing → danger "repo path not found".
       - ⋯: entry menü butonu (30px).
     - `branch_deleted` ve `repo_missing` satırlar opacity 0.6.
  3. Entry menüsü (Menu, 260px). Bu task'ta sadece: "Copy branch name" (clipboard-manager
     `writeText`; detached entry'de gizli), ayraç, danger "Remove from project"
     (`remove_entries`). Menü açıkken satır `bg.elevated`, buton `bg.pressed`.
  4. Tek entry: tablonun altında kart (margin 20px 28px, padding 18px 20px, `bg.elevated`,
     border, radius 12): serif 20px accent "+", 14px "Add related branches from other
     repositories", `Kbd` ⌘K. Tık → palette.
  5. Boş proje: ortada serif 28px "No entries yet", 14px "A project groups branches that belong
     to one piece of work, across any of your repositories.", 40px primary "Add branches ⌘K" →
     palette.
  6. "Review changes" →
     `nav.push({ name: 'review', target: { kind: 'project', projectId }, backLabel: 'Back to project' })`.
     Boş projede pasif.
  7. Route'taki proje config'te yoksa (silinmiş) Branches'a `replace` et.
- **Kabul:** `Projects.dc.html`'nin `variant=full/one/empty` durumlarıyla eşleşiyor.

#### T5.5 Rename ve delete
- **Bağımlı:** T5.4
- **Dosyalar:** `src/screens/Project/*`, `src/components/ProjectMenu.tsx`
- **Referans:** `Projects.dc.html` 94–114, 150–170
- **Adımlar:**
  1. Project menüsü (230px): "Rename" (sağda 12px muted "F2"), ayraç, danger
     "Delete project…". Project ekranında F2 rename moduna geçer; başlığa çift tık da çalışır
     (kullanıcı kararı 2026-09-26).
  2. Rename modu: başlık yerinde input (340px, 34px, serif 22px, `bg.sunken`, radius 8, accent
     halka), metin seçili; alt başlık "↵ save · esc cancel".
     - Çakışma (istemcide kontrol, kendisi hariç, büyük/küçük harf duyarsız): halka ve alt başlık
       danger, metin `A project named "X" already exists`; ↵ hiçbir şey yapmaz.
     - ↵ → `rename_project`. Esc → iptal. Boş ad → ↵ bir şey yapmaz.
  3. Delete: Modal (440px, `paddingTop: 180`, radius 16):
     - Başlık serif 22px `Delete "Name"?`.
     - 14px metin: "The project and its N entries are removed from this app. Branches, worktrees
       and repositories are not touched." (tekilde "its 1 entry").
     - Cancel (secondary 36px) / "Delete project" (danger 36px).
     - Onay → `delete_project` → Branches'a `replace`.
- **Kabul:** Çakışma, iptal, silme; silinen projenin entry'leri Branches'a geri dönüyor.

#### T5.6 Akış C: boş proje (New project)
- **Bağımlı:** T5.5
- **Dosyalar:** `src/state/ui.ts`, `src/components/Sidebar/*`, `src/screens/Project/*`
- **Adımlar:**
  1. Sidebar "New project" →
     `ui.draftProject = { name: <benzersiz 'Untitled project' | 'Untitled project 2' …>, entries: [], returnTo: <mevcut route> }`
     ve `nav.push({ name: 'project', projectId: 'draft' })`.
  2. Taslak proje ekranı:
     - Başlık rename modunda, metin seçili.
     - Alt başlık "Name your project · ↵ save · esc discards it".
     - Sidebar'da taslak adıyla aktif satır.
  3. ↵ (geçerli ad) → `create_project(name, entries)` → route'u gerçek id ile `replace` et, taslağı
     temizle.
  4. Esc → taslağı sil, `nav.back()`. Taslaktan başka bir ekrana gitmek de taslağı siler.
  5. Taslak boşken "Add branches ⌘K" palette'i açar ve seçilenleri taslak `entries`'e ekler.
- **Kabul:** HANDOFF akış C adım adım çalışıyor; esc sonrası config'te proje yok.

#### T5.7 Akış B: satırdan projeye ekleme
- **Bağımlı:** T5.6
- **Dosyalar:** `src/screens/Branches/*`, `src/components/ProjectPicker/*`
- **Referans:** `Main.dc.html` 88–127 ve 186–203
- **Adımlar:**
  1. "+ Add to project" sadece hover'daki satırda görünür (secondary küçük buton: 12px, padding
     6px 12px, radius 8).
  2. Tık → `ProjectPicker` popover (300px):
     - "Filter projects" inputu.
     - Proje listesi (ad + sağda 12px muted "N entries").
     - Alt bölmede `#2a2825` zeminli `accent.text` "+ New project…".

     Popover açıkken satır `bg.elevated`, buton accent dolgu.
  3. Proje seç → `add_entries` → toast.
  4. "+ New project…" → popover yerinde forma döner (320px, padding 16, gap 14):
     - Serif 18px "New project".
     - "Name" etiketi + input (odaklı).
     - "First entry" + mono 11 `<repo> / <branch> · base <base>`.
     - Cancel / primary "Create & add ↵".
     - Çakışmada input `invalid`, altında 12px danger mesaj, buton pasif.
     - ↵ → `create_project(name, [entry])` → toast.
  5. Toast: `<branch (mono 12)> added to <Project>`, "Undo" (28px, `#383631`) ve link
     "Open project →". 6 sn sonra kaybolur.
     - Undo: `remove_entries`; proje bu işlemle oluşturulduysa `delete_project`.
     - Open project → Project ekranı.
  6. ~~Satır Branches'tan kendiliğinden çıkar~~ **T7.0 ile değişti:** satır kalır, Projects hücresi yeni sayıyı gösterir; sidebar yeni projeyi gösterir.
- **Kabul:** `Main.dc.html`'nin `popover=pick/new` ve `added` durumlarıyla eşleşiyor; Undo çalışıyor.

#### T5.8 Akış H: çoklu seçim ve selection bar
- **Bağımlı:** T5.7
- **Dosyalar:** `src/screens/Branches/*`
- **Referans:** `Main.dc.html` 128–141, 186–203
- **Adımlar:**
  1. Checkbox sadece hover'daki satırda görünür; `selectedKeys` boş değilse tüm checkbox'lar
     görünür. Seçili satır zemini `rgba(79,143,163,0.10)`. Esc seçimi temizler.
  2. Seçim ≥ 1 ise alt ortada selection bar:
     - `N branches selected` (13px/500) + 12px muted `across M repos`.
     - Dikey ayraç.
     - Secondary "Add to project ▾" → aynı `ProjectPicker`, bar'ın üstüne açılır.
     - Primary "New project".
     - ✕ (seçimi temizle).
  3. "Add to project" ile proje seç → `add_entries(hepsi)` → toast `N branches added to <Project>`
     + Undo. "+ New project…" ve "New project" → akış H2.
  4. H2: `ui.draftProject = { name: benzersiz 'Untitled project', entries: seçilenler, returnTo }`
     → taslak proje ekranı. Tablo satırları scan verisinden gelir. Alt başlık `N entries across M
     repos · name your project · ↵ save`. ↵/esc davranışı T5.6 ile aynı.
- **Kabul:** HANDOFF akış H; `Main.dc.html` `select` ve `Projects.dc.html` `fromSelection` durumları.

#### T5.9 Add palette (⌘K)
- **Bağımlı:** T5.6
- **Dosyalar:** `src/screens/Palette/*`
- **Referans:** `Palette.dc.html`, HANDOFF §2 "Add palette"
- **Adımlar:**
  1. Açılış: Project ekranında (taslak dahil) ⌘K, "Add entries", "Add branches", "add related"
     kartı. Hedef proje bulunulan projedir; proje seçici yok.
  2. Görünüm:
     - Scrim üstünde 620px dialog, yatayda ortalı, top 96px, radius 16.
     - Arama satırı 56px: search ikonu, 16px input (otomatik odak), sağda 12px muted "fuzzy ·
       all repos".
     - Liste max-height 470px, scroll.
     - Footer (`bg.sunken`): "N selected" … primary "Add ↵".
  3. Veri store'daki `scan`'den:
     - **Worktrees** = `active` içinde `worktreePath` dolu olanlar.
     - **Active branches** = `active` içinde `worktreePath` boş olanlar.
     - **Older · found by search** = `others`. Sadece sorgu boş değilken görünür, en fazla 50
       sonuç.
  4. Satır:
     - Checkbox + mono 13 branch + 12px muted meta + sağda pill.
     - Meta örnekleri: `api-server · ↑2 · 4 files · ● 1 uncommitted`, `mobile · ↑5 · 8 files ·
       3d ago`, `web-app · merged into main · 41d ago` (pill success "merged").
     - Bu projede olan entry: pasif, opacity 0.55, meta `<repo> · already in <Project>`, neutral
       pill "in project".
  5. Arama: fuse.js, anahtarlar `branch` (ağırlık 2), `repoName`, `worktreePath`; `threshold:
     0.35`, `ignoreLocation: true`. Grup sırası korunur.
  6. Klavye:
     - ↑/↓ aktif satırı gezdirir (pasifleri atlar; aktif satır `bg.hover`).
     - Space işaretler (arama boşken ya da ok tuşlarıyla gezinirken; arama yazılırken boşluk
       karakteri olarak yazılır, "feat queue" gibi aramalar için).
     - ↵ işaretlileri ekler; hiçbiri işaretli değilse sadece ok tuşlarıyla gelinen aktif satırı
       ekler (fareyle üzerine gelinmiş satır eklenmez). "Add ↵" butonu sadece işaretlileri ekler,
       hiçbiri yoksa pasif (kullanıcı kararı 2026-09-26).
     - Esc kapatır.
  7. Ekle → gerçek projede `add_entries`, taslakta `draftProject.entries`'e ekle → palette kapanır.
- **Kabul:** `Palette.dc.html` ile eşleşiyor; "token" araması üç grubu da getiriyor.

#### T5.10 Proje kapsamlı review
- **Bağımlı:** T5.2, T4.4
- **Dosyalar:** `review.rs`, `src/screens/Review/*`
- **Adımlar:**
  1. Backend `get_review({ kind: 'project' })`: projedeki her entry için T3.2/T4.1'deki grup.
     Review edilemeyenler (`branch_deleted`, `repo_missing`, `base_missing`, `git_error`, ya da
     üç modda da dosyası olmayan `merged`) `notInReview`'a.
  2. Aynı repodan iki entry iki ayrı gruptur.
  3. Başlık proje adı; alt başlık `Project review · X of Y entries have changes` (X = herhangi
     bir modda ≥1 dosyası olan grup sayısı, Y = toplam entry).
  4. Sol listenin sonunda (varsa) üst border'lı tek satır: 12px muted `N entries not reviewable ·`
     + link "Open project" (→ `nav.push({ name: 'project', projectId })`).
  5. `focusKey` ile gelindiyse o grubun ilk dosyasını seç ve diğer grupları kapat.
- **Kabul:** `Diff.dc.html` `scope=project` ile eşleşiyor (Not in review bölümü dışında; o bilinçli
  olarak tek satır).

#### T5.11 ✋ Kontrol noktası — Faz 5
- **Bağımlı:** T5.1–T5.10
- **Kullanıcıya göster:** Akış B, C, G, H; palette; proje review'u. "Not in review" tek satır
  varsayılanını ve Branches filtresi kararını hatırlat. Onay bekle.

---

### Faz 6 — Base yönetimi ve stacked branch (akış E)

#### T6.1 Base seçenekleri ve kaydetme — backend
- **Bağımlı:** T5.11
- **Dosyalar:** `base.rs`, `git/refs.rs`, `commands.rs`
- **Adımlar:**
  1. `get_base_options(repoId, key) -> BaseOptions`:
     - `current`: etkin base.
     - `suggested`: T6.2'deki sıralı adaylar.
     - `default`: `{ name: defaultBase, source: defaultBaseSource }`.
     - `branches`: tüm yerel branch'ler (entry'nin kendisi hariç).
     - `tags`: `tag_names(None)`.
  2. `set_branch_base(key, base)`: `base` null ya da repo varsayılanına eşitse `branchBases`'ten
     sil, değilse yaz. Sonra o repoyu `rescan_repo` ile tara (`repo-updated` yayınlanır; Branches,
     Project ve Review kendiliğinden güncellenir).
  3. `verify_ref(repoId, rev)`: `revparse_single(rev)?.peel_to_commit()?.id()` → tam SHA; hata
     → null.
- **Kabul:** Base değiştirince Branches, Project ve Review aynı base'i gösteriyor (base branch
  başına).

#### T6.2 Stacked tespiti — backend
- **Bağımlı:** T6.1
- **Dosyalar:** `git/history.rs`, `base.rs`, `review.rs`
- **Adımlar:**
  1. Adaylar: HANDOFF §4.10'daki `for-each-ref refs/heads --merged=<branch>
     --no-merged=<default-base>` sorgusunun git2 karşılığı. Her yerel branch C için (entry'nin
     kendisi ve tip'i entry tip'iyle aynı olanlar hariç):
     - `is_ancestor(C, tip)` (C, branch'ten erişilebilir) **ve**
     - `!is_ancestor(C, defaultBaseTip)` (C, default base'e merge edilmemiş).
  2. Listelenen commit kümesi S = revwalk `push(tip)`, `hide(base)`. Her aday için revwalk
     `push(C)`, `hide(base)` → `contains = |… ∩ S|`. `contains > 0` olanları azalan sırala →
     `suggested`.
  3. Review grubunda: en üst aday etkin base'den farklıysa `stackHint = { branch, contains,
     total: |S| }`.
  4. Commit'lerin `fromBranch`'i: sıralı adaylarda o commit'i içeren ilk aday.
  5. Sonuçları `(repoId, tip, baseSha)` önbelleğine ekle.
- **Kabul:** `TestRepo` ile stacked senaryo testi. Fixture'ta `token-rotation-job` (base
  `master`): 5 commit'in 3'ü `feat/job-queue`'dan; öneri `feat/job-queue`, "3 of 5". Base
  `feat/job-queue` yapılınca ipucu kayboluyor.

#### T6.3 Base menüsü — frontend
- **Bağımlı:** T6.2
- **Dosyalar:** `src/components/BaseMenu/*`, `src/screens/Review/*`, `src/screens/Project/*`
- **Referans:** `Diff.dc.html` 69–71, 154–174, 392–397, 427–431
- **Adımlar:**
  1. `BaseMenu` popover (340px):
     - "Filter branches, tags, SHAs" inputu.
     - **Suggested**: mono 13 ad + 12px muted `Contains N of the M commits shown`.
     - **Default**: ad + sağda 12px muted not. Mevcut base ise `current · from <source>`, değilse
       `from <source>`.
     - **Other branches**: mono 13. Mevcut base ise sağda "current".
     - Bölüm başlıkları etiket stilinde. Boş bölümler gizli.
     - Filtre tüm bölümlere uygulanır; eşleşen tag'ler "Tags" bölümünde çıkar. Metin 7–40 hex ise
       `verify_ref` ile doğrula; geçerliyse "Use <shortSha>" satırı göster.
     - ↑/↓/↵/Esc ile kullanılabilir.
  2. Açılış yerleri: Review grup başlığındaki base butonu; Project tablosundaki Base butonu;
     `base_missing` pill'i (T7.3).
  3. Seçim → `set_branch_base`. Backend'in `repo-updated`'ı açık ekranları yeniler; `useInvoke`
     eski veriyi tuttuğu için diğer gruplar boşalmaz. `loading` iken sadece değişen grubun
     başlığında küçük bir yükleniyor göstergesi olsun.
  4. Review'da seçimden sonra neutral banner: `Base for <branch> set to <base>. Saved for this
     branch; Branches and projects use it too.` Uncommitted modunda uncommitted banner'ı öncelikli.
     Ekrandan çıkınca kaybolur.
  5. Stacked uyarısı (grup başlığının altında; margin 0 8px 6px 28px, padding 7px 10px, radius 8,
     warning tonu): `N of M commits come from <branch>. A different base may fit better.`
  6. Commit listesinde `fromBranch` dolu satırlar opacity 0.6 ve sağda mono 11 warning pill (dal adı).
- **Kabul:** HANDOFF akış E adım adım; `Diff.dc.html` `stacked`, `baseMenu`, `base` durumlarıyla
  eşleşiyor.

#### T6.4 ✋ Kontrol noktası — Faz 6
- **Bağımlı:** T6.1–T6.3
- **Kullanıcıya göster:** Stacked fixture'ında uyarı → menü → öneri seçimi → banner → Branches'ta
  yeni base. Onay bekle.

---

### Faz 7 — Durum etiketleri ve bozuk entry'ler (akış F)

#### T7.0 Branches: tüm aktif branch'ler, Projects sütunu ve "Not in a project" filtresi (akış I)
- **Bağımlı:** T6.4
- **Dosyalar:** `src/screens/Branches/*`, `src/components/ProjectPicker/*`, `src/components/Sidebar/*`
- **Referans:** `Main.dc.html` 32–36 (filtre seçici), 48–50 (kolonlar), 71 (hücre), 126–142 (menü),
  211–252 (stiller), 275–310 (filtre mantığı);
  HANDOFF §2 "Branches", §3 akış B ve I, §4 madde 11
- **Adımlar:**
  1. Proje üyeliği filtresini kaldır: Branches `active` listesinin tamamını gösterir. Sidebar
     "Branches" sayısı tüm aktif branch sayısıdır. Alt başlık: `Active branches · N repos ·
     checked out in a worktree, or committed in the last D days`.
  2. Grid `16px minmax(0,1fr) 60px 68px 128px 150px 112px 44px`; kolonlar: [boş] Branch · Ahead ·
     Files · Uncommitted · State · Projects · Age. Satır sonundaki "+ Add to project" butonu
     kaldırılır.
  3. `projectsOf(entryKey)`: config'te entry'yi içeren projeler, sidebar sırasıyla.
  4. Projects hücresi (26px, radius 8, padding `0 9px`, 12px, gap 6, `justify-self: start`):
     - 0 proje: faint "—", tıklanamaz. Satır hover'da ya da klavye odağındayken hücre "+ Add" olur
       (şeffaf zemin, 1px `border`, `accent.text`) → `ProjectPicker` (T5.7) hücrenin altında,
       hücrenin sağ kenarına hizalı açılır. Picker açıkken hücre accent dolgu (`#141311` metin),
       satır `bg.elevated`.
     - ≥1 proje: çip "1 project" / "N projects" (`bg.elevated`, 1px `border`, `text.body`) + 10px
       chevron; `title` = virgülle proje adları. Tık → menü (270px, popover stili, padding 6):
       - Bölüm etiketi "In N projects".
       - Her proje: 7px içi boş daire + ad + muted "→"; tık → o Project ekranı.
       - Ayraç, sonra `accent.text` "+ Add to another project…" → aynı hücrede `ProjectPicker`
         (branch'in zaten bulunduğu projeler listede gösterilmez).
       - Menü açıkken çip `bg.pressed` + `#4a4741` border, satır `bg.elevated`. Esc ve dışarı tık
         kapatır; ↑/↓ ile gezilir, ↵ seçer.
  5. Ekleme sonrası (T5.7, T5.8, palette): satır listede kalır, hücre yeni sayıyı gösterir ve
     ~2 sn `rgba(79,143,163,0.12)` zemin + accent border ile vurgulanır. Toast aynı; Undo sayıyı
     geri alır.
  6. Proje silme, rename ve entry çıkarma sonrası hücreler `config-changed` ile kendiliğinden
     güncellenir.
  7. Header'a refresh ile filtre alanı arasına segmented seçici: "All" ve "Not in a project",
     yanlarında mono 11 sayı (review'daki mod seçiciyle aynı stil: `bg.elevated` zemin, padding 3,
     radius 10; buton 26px, aktif `bg.pressed` + `text.strong`, pasif `text.muted`).
     - Sayılar metin filtresinden bağımsız: tüm aktif branch'ler / hiçbir projede olmayanlar.
     - "Not in a project": projesi olan satırlar gizlenir, satırı kalmayan repo bantları gizlenir,
       alt başlık `Active branches not in any project · N repos · …` olur (N = görünen repo).
       Metin filtresi bunun üstüne uygulanır.
     - Sonuç boşsa ortada serif 22px "Every active branch is in a project".
     - Seçim `localStorage`'da (`gitgel.branches.scope`) saklanır; varsayılan "All".
     - Bu görünümdeyken bir branch projeye eklenirse satır toast'la birlikte listeden çıkar.
     - Sidebar "Branches" sayısı seçimden etkilenmez (her zaman tüm aktif branch'ler).
- **Kabul:** Fixture'da bir branch'i iki projeye ekleyince hücre "2 projects" ve title iki adı
  gösteriyor, menüden projeye gidiliyor; 0 projeli satırda hover "+ Add" picker'ı açıyor; ekleme
  sonrası satır kaybolmuyor ve sidebar sayısı değişmiyor. `Main.dc.html` varsayılan, `popover=pick`,
  `added`, `projMenu` ve `scope=unassigned` durumlarıyla karşılaştırıldı. "Not in a project" seçiliyken
  uygulama yeniden açılınca seçim korunuyor.

#### T7.1 lastKnownTip takibi
- **Bağımlı:** T6.4
- **Dosyalar:** `projects.rs`
- **Adımlar:** `get_project_view` ve proje `get_review` sırasında, branch mevcutsa ve
  (`lastKnownTip.sha` ≠ tip ya da `seenAt` 1 saatten eski) ise
  `lastKnownTip = { sha: tip, seenAt: now }` yap. Değişiklik olduysa tek bir `config::update`
  ile kaydet (her yeniden hesaplamada diske yazma; her kayıt `config-changed` yayınlar).
- **Kabul:** Fixture'ta tip değişince config'teki SHA güncelleniyor; değişmeyince dosya mtime'ı
  sabit.

#### T7.2 Entry menüsünün tamamı
- **Bağımlı:** T7.1
- **Dosyalar:** `src/screens/Project/*`, `commands.rs`
- **Referans:** `Projects.dc.html` 82–93
- **Adımlar:**
  1. `branch_deleted` entry'de menünün en üstüne "View last known state" ekle; altında mono 11
     muted `tip <shortSha> · seen <formatAge> ago`.
     - `commit_exists` false ise öğe pasif, alt satır `tip <shortSha> · no longer in the repository`.
     - Tık → `review` route'u:
       `{ kind: 'branch', repoId, branch, worktreePath: null, tipOverride: sha }`. Alt başlık
       `<repo> · last known state`.
  2. "Point to another branch…" (tüm branch entry'lerinde) → BaseMenu görünümünde branch seçici
     (sadece yerel branch'ler, entry'nin reposundan) → `repoint_entry(projectId, key, branch)`
     (backend: entry'nin `branch`'ini değiştirir, `lastKnownTip`'i yeniler; aynı key projede
     varsa hata).
  3. Menü sırası: [View last known state], Point to another branch…, Copy branch name, ayraç,
     Remove from project.
- **Kabul:** `make-fixtures.sh delete-branch` sonrası `to-be-deleted` entry'si "branch deleted"
  oluyor ve son durum görüntülenebiliyor; başka branch'e yönlendirme çalışıyor.

#### T7.3 Bozuk entry görünümü ve yönlendirmeler
- **Bağımlı:** T7.2
- **Dosyalar:** `src/screens/Project/*`, `src/screens/Branches/*`
- **Adımlar:**
  1. Pill'ler tıklanabilir:
     - "base missing" → o entry'nin BaseMenu'sü.
     - "repo path not found" → Settings.
     - "branch deleted" → entry menüsü.
  2. Durumlar hata değil etikettir: kırmızı ekran, modal ya da toast yok.
- **Kabul:** `make-fixtures.sh remove-repo` sonrası web-app entry'leri "repo path not found",
  opacity 0.6; `restore-repo` + refresh ile düzeliyor. Bir entry'nin base'ini var olmayan bir
  branch'e ayarlayınca "base missing" ve pill menüyü açıyor.

#### T7.4 Hata etiketi ve loglama
- **Bağımlı:** T7.3
- **Dosyalar:** `git/mod.rs`, `scan.rs`, frontend pill'leri
- **Adımlar:**
  1. Beklenmedik git2 hataları entry'de `git_error` + `error` olur ve `log::warn!` ile yazılır
     (işlem, repo, `git2::Error` mesajı, sınıfı ve kodu).
  2. Frontend'de danger "git error" pill'i, `title` = hata metni.
  3. git2 bir repoyu hiç açamıyorsa (`status: 'error'`) Branches bandında danger "git error" pill'i.
  4. Hiçbir komut hatası uygulamayı çökertmez; `unwrap()`/`expect()` sadece testlerde.
- **Kabul:** `grep -rn "unwrap()\|expect(" src-tauri/src` sadece testleri gösteriyor. Bozuk bir
  repo (örn. `.git/HEAD` bozuk sahte klasör — fixture altında) uygulamayı çökertmiyor. Log dosyası
  `~/Library/Logs/com.gitgel.desktop/` altında.

#### T7.5 ✋ Kontrol noktası — Faz 7
- **Bağımlı:** T7.0–T7.4
- **Kullanıcıya göster:** Branches'taki Projects sütunu, menüsü ve filtresi (T7.0); silinmiş branch, kayıp
  repo, eksik base, git hatası; log dosyası.
  Onay bekle.

---

### Faz 8 — Settings, cila, build

#### T8.1 Settings: Repositories
- **Bağımlı:** T7.5
- **Dosyalar:** `src/screens/Settings/*`, `git/repo.rs`, `commands.rs`
- **Referans:** `Settings.dc.html`
- **Adımlar:**
  1. Header 64px, serif 22px "Settings". İçerik iki kolon grid (gap 40, padding 28px 32px).
  2. Sol: serif 18px "Repositories"; kart (`bg.sunken`, border, radius 12). Satır (padding 11px
     14px, alt border):
     - 500 ağırlıklı ad (96px), mono 12 muted yol (ellipsis).
     - Not: 12px muted `base <defaultBase>`; repo yoksa danger pill "path not found" + "Locate…"
       butonu (28px).
     - ✕ kaldır butonu.
  3. "+ Add repository…" (kartın son satırı, `accent.text`) → T5.0'daki `openAddRepos()` (klasör seçici → sheet).
  4. `locate_repo(repoId, path)`: `inspect` et; `repo`/`resolved` değilse hata "Not a git
     repository"; başka bir repo id'siyle aynı köke çözülüyorsa hata "Already added as <name>".
     Aynı id ile yolu güncelle, `sync_watches` + `rescan_repo`. O reponun tüm entry'leri
     kendiliğinden düzelir. Hata satırın
     altında 12px danger metinle gösterilir.
  5. ✕: repo projelerde kullanılıyorsa Modal: `Remove <name>?` / "Its N project entries are
     removed too. Nothing on disk is touched." / Cancel / "Remove" (danger). `remove_repo`: repoyu,
     o reponun `branchBases` anahtarlarını ve proje entry'lerini siler; `last_scan`'den çıkarır ve
     `sync_watches` çağırır.
- **Kabul:** `Settings.dc.html` ile eşleşiyor; Locate ile taşınmış fixture repo düzeliyor.

#### T8.2 Settings: Behaviour
- **Bağımlı:** T8.1
- **Dosyalar:** `src/screens/Settings/*`, `commands.rs`
- **Adımlar:**
  1. Serif 18px "Behaviour".
  2. "Default base" (açıklama "Tried in order when a branch has no base set"): 230px mono input;
     değer `defaultBaseOrder.join(' → ')`. Blur/↵'da `→`, `,` ya da `>` ile böl, trim'le, boşları
     at. Liste boşsa eski değere dön; değilse `update_settings`.
  3. "Active threshold" (açıklama "Branches without a worktree are listed if committed within"):
     60px sağa yaslı mono input + "days". 1–365 tamsayı değilse eski değere dön.
  4. `update_settings` kaydettikten sonra tüm repoları yeniden tarar (her repo için `repo-updated`).
     Başka ayar ekleme (yenileme, git yolu vb. bilinçli olarak yok).
- **Kabul:** Eşiği 1 gün yapınca `feat/billing-v2` (2 günlük) Branches'tan düşüyor; sırayı
  `master → main` yapınca web-app'in base'i değişiyor.

#### T8.3 Klavye kısayolları ve odak
- **Bağımlı:** T8.2
- **Dosyalar:** `src/App.tsx`, ilgili ekranlar
- **Adımlar:**
  1. Global:
     - ⌘K: Project ekranında palette, Branches'ta filtreye odak.
     - ⌘N: New project (akış C), modal açık değilse her ekrandan (kullanıcı kararı 2026-09-26;
       T5 sırasında eklendi).
     - F2: Project ekranında rename (T5.5).
     - ⌘R: Project ekranında "Review changes" (proje review'unu açar); her yerde webview
       yenilemesini `preventDefault` ile engeller. Yenileme refresh butonunda ve focus'ta kalır
       (kullanıcı kararı 2026-09-26; T6 sırasında eklendi).
     - ⌘← / ⌘→ (metin alanı dışında) ve ⌘[ / ⌘] (fiziksel tuş; Türkçe Q klavyede ⌘ğ / ⌘ü):
       back/forward (kullanıcı kararı 2026-09-26).
     - Esc: en üstteki popover/menü/modal/palette'i kapatır, yoksa seçim/filtreyi temizler.
  2. Varsayılan webview sağ tık menüsünü engelle (input, textarea ve `.monaco-editor` hariç).
  3. Tüm ikon butonlarda ekran dosyalarındaki `aria-label`'lar; popover/menü/modal'larda
     `role`'ler (`dialog`, `menu`, `menuitem`, `listbox`, `alertdialog`, `status`, `toolbar`).
- **Kabul:** Fare kullanmadan: Branches filtre → Review → mod değiştirme → geri → Project → ⌘K →
  seç → ekle akışı yapılabiliyor.

#### T8.4 Performans kontrolü
- **Bağımlı:** T8.3
- **Adımlar:**
  1. Fixture'lar + kullanıcının izin verdiği 2–3 gerçek repo ile log'daki tarama sürelerini ölç.
     Hedefler:
     - İlk tarama < 3 sn.
     - Dosya değişikliği → ekranda güncelleme < 1 sn (300 ms debounce dahil).
     - Değişiklik yokken tam tarama (`rescan_all`) < 300 ms (5 repo / ~30 branch).
     - Review'da dosya değiştirme anlık.
  2. Hedef aşılıyorsa önce önbellek isabetini kontrol et: ref'i değişmeyen branch için merge-base
     ve tree diff hesaplanmamalı. `Worktree` olayında sadece o worktree'nin workdir diff'i
     çalışmalı; Branches sayımında patch üretilmediğini (`delta_count`) doğrula.
  3. Olay fırtınası: bir fixture worktree'sinde ignore edilmeyen bir klasörde hızla 500 dosya
     oluştur/değiştir. İşçi thread'i olayları birleştirmeli (log'da dosya başına ayrı iş yok), UI
     donmamalı, son durum doğru olmalı.
- **Kabul:** Ölçümler kontrol noktasında raporlanır.

#### T8.5 Salt okunur denetimi
- **Bağımlı:** T8.4
- **Adımlar:**
  1. `grep -rn "Command::new" src-tauri/src` → boş.
  2. `grep -rln "git2::" src-tauri/src | grep -v "src/git/"` → boş.
  3. `grep -rn "disallowed" src-tauri/src` → sadece `git/testutil.rs`.
  4. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` temiz
     (yazma yasakları T1.2'deki `clippy.toml`'da).
  5. Uygulamalı test:
     ```bash
     touch /tmp/gitgel-marker
     # uygulamayı fixture'larla aç, tüm ekranları gez; worktree'lerde dosya değiştir
     # (echo >> ile; stage/commit yapma), pencere focus'unu değiştir, refresh'e bas
     find ~/gitgel-fixtures -path '*/.git/*' -newer /tmp/gitgel-marker
     ```
     Çıktı boş olmalı (index, HEAD, refs, lock dosyası değişmemiş).
- **Kabul:** Beş kontrol de temiz; sonuç kontrol noktasında raporlanır.

#### T8.6 Görsel QA
- **Bağımlı:** T8.5
- **Adımlar:** Her ekranı ilgili `.dc.html` ile yan yana kontrol et ve farkları düzelt:
  - Ölçüler:
    - Sidebar 260px; page header 64px (Review 56px).
    - Butonlar 32px (boş durum 40px); sidebar satırları 40px; dosya satırları 30px.
    - Radius'lar: 8 / 10 / 12 / 16 / 9999.
    - Gölgeler ve scrim.
  - Renkler: sol taraf her zaman sağdan koyu (`bg.sidebar` < `bg.main`); `text.faint` sadece satır
    numarası, "—" ve sönük dizinlerde; accent sadece HANDOFF §1'deki yerlerde.
  - Tipografi: başlıklar serif 400; kod/branch/path/SHA/sayı/kısayol mono; etiketler uppercase 11px.
  - Metinler: ekran dosyalarındaki İngilizce metinler birebir (tekil/çoğul dahil).
  - İkonlar: emoji yok, stroke 1.6–1.8.
- **Kabul:** Bulunan farklar ve düzeltmeleri kontrol noktası notunda listelenir.

#### T8.7 Üretim build'i ve README
- **Bağımlı:** T8.6
- **Dosyalar:** `README.md`
- **Adımlar:**
  1. `pnpm tauri build --bundles app` →
     `src-tauri/target/release/bundle/macos/Gitgel.app`. İmzasız.
  2. Build'i aç, fixture'larla hızlı duman testi.
  3. Uygulama ikonu: şablon ikonu kalır. Kullanıcı 1024×1024 PNG verirse `pnpm tauri icon <png>`.
  4. `README.md` (kısa): ne olduğu, ön koşullar (pnpm dahil), `pnpm install`, `pnpm tauri dev`, build komutu,
     config ve log yolları, fixture script'i (onay notuyla). Not: macOS, `~/Desktop`,
     `~/Documents` gibi korumalı klasörlerdeki repolar için erişim izni ister; imzasız build
     yeniden derlendikçe tekrar sorabilir.
- **Kabul:** `.app` açılıyor ve dev sürümüyle aynı çalışıyor.

#### T8.8 ✋ Son kontrol noktası
- **Bağımlı:** T8.1–T8.7
- **Kullanıcıya göster:** HANDOFF §3'teki A–H akışlarının hepsi build edilmiş `.app` üzerinde; T8.4
  ölçümleri; T8.5 salt okunur denetimi; §2'deki açık soru varsayılanlarının listesi (kesinleştirmesi
  için).

---

## 9. Test stratejisi (özet)

- **Rust birim testleri:** `git/` fonksiyonları `TestRepo` (T1.2) ile kendi `TempDir`'lerindeki
  geçici repolarda test edilir: havuz (T1.3), klasör inceleme (T1.8), delta dönüşümü (T2.1),
  worktree listesi (T2.2), merged/squash ve durum önceliği (T2.3), uncommitted (T2.4), commit
  listesi (T3.2), stacked (T6.2), ignore süzgeci (T2.8). Ayrıca config (T1.4), proje ad
  kuralları (T5.1), path güvenliği (T4.2), olay sınıflandırma ve kök tekilleştirme (T2.8, saf
  fonksiyonlar).
- **Vitest:** `useInvoke` (T1.5), `format.ts`, `paths.ts`, entry key, default base girdisi ayrıştırma, palette
  gruplama/filtreleme mantığı (saf fonksiyonlara ayır).
- **Elle:** `scripts/make-fixtures.sh` repoları + her kontrol noktasındaki listeler.

---

## 10. MVP sonrası (şimdi yapma)

- **Editörde aç:** worktree'deki dosyayı `cursor://file/<path>:<line>` veya
  `vscode://file/<path>:<line>` ile açma.
- **Go-to-definition:** git blob'ları üzerinde tree-sitter ile arama tabanlı navigasyon
  (checkout gerekmez). Monaco'da `registerDefinitionProvider` + `registerEditorOpener`.
- **Yeniden adlandırılmış branch tespiti:** git2 ile reflog'daki "Branch: renamed …" kaydı
  (`repo.reflog(...)`) ya da tip'i `lastKnownTip`'e eşit olan yerel branch'leri arayarak.
- HANDOFF §5'teki kesinleşmemiş kararların kullanıcıya göre güncellenmesi.

---

## 11. İlerleme takibi

Durum: `[ ]` yapılacak · `[x]` bitti (sonuna ` — YYYY-MM-DD` ekle). Yarım kalan task'ın altına
`  - not: …` yaz. Kontrol noktaları kullanıcı onay verince işaretlenir.

### Faz 0 — Ortam ve iskelet
- [x] T0.1 Ön koşulları doğrula — 2026-09-26
- [x] T0.2 Tauri 2 + React + TS + Vite iskeleti — 2026-09-26
- [x] T0.3 Bağımlılıklar ve sürüm sabitleme — 2026-09-26
- [x] T0.4 Klasör yapısı ve şablon temizliği — 2026-09-26
- [x] T0.5 Fontlar, renk token'ları, global CSS — 2026-09-26
- [x] T0.6 Pencere, başlık çubuğu ve izinler — 2026-09-26
- [x] T0.7 Test fixture repoları — 2026-09-26
- [x] T0.8 ✋ Kontrol noktası — Faz 0 — 2026-09-26

### Faz 1 — Git katmanı, config, repo ekleme
- [x] T1.1 Rust modül iskeleti, hata tipi, AppState — 2026-09-26
- [x] T1.2 git2 sınırı: yazma yasakları ve test repo yardımcısı — 2026-09-26
- [x] T1.3 Repository havuzu — 2026-09-26
- [x] T1.4 Config dosyası — 2026-09-26
- [x] T1.5 Frontend altyapısı: tipler, IPC, store, event köprüsü, useInvoke, router — 2026-09-26
- [x] T1.6 UI temel bileşenleri ve ikonlar — 2026-09-26
- [x] T1.7 Sidebar ve uygulama iskeleti — 2026-09-26
- [x] T1.8 Klasör inceleme ve varsayılan base (backend) — 2026-09-26
- [x] T1.9 İlk açılış: boş durum, klasör seçici, sürükle-bırak, sheet — 2026-09-26
- [x] T1.10 ✋ Kontrol noktası — Faz 1 — 2026-09-26

### Faz 2 — Branch/worktree keşfi ve Branches ekranı
- [x] T2.1 Diff → FileChange dönüşümü — 2026-09-26
- [x] T2.2 Repo tarama: branch'ler, worktree'ler, base çözümü — 2026-09-26
- [x] T2.3 Entry özeti: ahead, files, merged, durum — 2026-09-26
- [x] T2.4 Commit'lenmemiş değişiklikler — 2026-09-26
- [x] T2.5 Önbellek ve paralel tarama — 2026-09-26
- [x] T2.6 Tarama komutları ve saklı sonuç — 2026-09-26
- [x] T2.7 Branches ekranı — 2026-09-26
- [x] T2.8 Dosya izleme ve hedefli yeniden hesaplama (backend) — 2026-09-26
- [x] T2.9 Frontend: canlı güncelleme, focus ve refresh butonu — 2026-09-26
- [x] T2.10 ✋ Kontrol noktası — Faz 2 — 2026-09-26

### Faz 3 — Commit'lenmiş diff
- [x] T3.1 Monaco kurulumu ve tema — 2026-09-26
- [x] T3.2 Review verisi (committed) — backend — 2026-09-26
- [x] T3.3 Dosya içeriği okuma — backend — 2026-09-26
- [x] T3.4 Review ekranı iskeleti ve dosya listesi — 2026-09-26
- [x] T3.5 Diff görünümü — 2026-09-26
- [x] T3.6 Navigasyon: Branches → Review — 2026-09-26
- [x] T3.7 ✋ Kontrol noktası — Faz 3 — 2026-09-26

### Faz 4 — Commit'lenmemiş katman ve mod toggle
- [x] T4.1 Uncommitted ve All dosya listeleri — backend — 2026-09-26
- [x] T4.2 Working tree'den içerik okuma — 2026-09-26
- [x] T4.3 Mod toggle, banner ve etiketler — frontend — 2026-09-26
- [x] T4.4 ✋ Kontrol noktası — Faz 4 — 2026-09-26

### Faz 5 — Projeler ve Add palette
- [x] T5.0 Sonradan repo ekleme: sidebar footer ve her ekranda bırakma — 2026-09-26
- [x] T5.1 Proje komutları — backend — 2026-09-26
- [x] T5.2 Proje görünümü verisi — backend — 2026-09-26
- [x] T5.3 Sidebar proje listesi — 2026-09-26
- [x] T5.4 Project ekranı — 2026-09-26
- [x] T5.5 Rename ve delete — 2026-09-26
- [x] T5.6 Akış C: boş proje (New project) — 2026-09-26
- [x] T5.7 Akış B: satırdan projeye ekleme — 2026-09-26
- [x] T5.8 Akış H: çoklu seçim ve selection bar — 2026-09-26
- [x] T5.9 Add palette (⌘K) — 2026-09-26
- [x] T5.10 Proje kapsamlı review — 2026-09-26
- [x] T5.11 ✋ Kontrol noktası — Faz 5 — 2026-09-26

### Faz 6 — Base yönetimi ve stacked branch
- [x] T6.1 Base seçenekleri ve kaydetme — backend — 2026-09-26
- [x] T6.2 Stacked tespiti — backend — 2026-09-26
- [x] T6.3 Base menüsü — frontend — 2026-09-26
- [x] T6.4 ✋ Kontrol noktası — Faz 6 — 2026-09-26

### Faz 7 — Durum etiketleri ve bozuk entry'ler
- [x] T7.0 Branches: tüm aktif branch'ler, Projects sütunu ve "Not in a project" filtresi — 2026-09-26
- [x] T7.1 lastKnownTip takibi — 2026-09-26
- [x] T7.2 Entry menüsünün tamamı — 2026-09-26
- [x] T7.3 Bozuk entry görünümü ve yönlendirmeler — 2026-09-26
- [x] T7.4 Hata etiketi ve loglama — 2026-09-26
- [x] T7.5 ✋ Kontrol noktası — Faz 7 — 2026-09-26

### Faz 8 — Settings, cila, build
- [x] T8.1 Settings: Repositories — 2026-09-26
- [x] T8.2 Settings: Behaviour — 2026-09-26
- [x] T8.3 Klavye kısayolları ve odak — 2026-09-26
- [x] T8.4 Performans kontrolü — 2026-09-26
- [x] T8.5 Salt okunur denetimi — 2026-09-26
- [x] T8.6 Görsel QA — 2026-09-26
- [x] T8.7 Üretim build'i ve README — 2026-09-26
  - not: ilk açılışta macOS ~/Desktop izni istedi; onaylanana kadar ilk tarama bekledi (233 sn), sonra 3–4 ms.
- [x] T8.8 ✋ Son kontrol noktası — 2026-09-26
  - not: kullanıcı "her şey düzgün" dedi; §2 açık soru varsayılanları olduğu gibi kaldı.
