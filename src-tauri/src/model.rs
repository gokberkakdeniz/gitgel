//! Serialized types shared with the frontend (`src/lib/types.ts`). Field names match the
//! TypeScript side through serde's camelCase renaming.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

/// Key of a project entry and of `Config::branch_bases`.
pub fn entry_key(repo_id: &str, branch: Option<&str>, worktree_path: Option<&str>) -> String {
    match branch {
        Some(branch) => format!("{repo_id}:{branch}"),
        None => format!("{repo_id}:@{}", worktree_path.unwrap_or_default()),
    }
}

// ---- Config (stored on disk) ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConfig {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastKnownTip {
    pub sha: String,
    /// ISO 8601 UTC.
    pub seen_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryConfig {
    pub repo_id: String,
    /// `None` for a detached HEAD worktree entry.
    pub branch: Option<String>,
    /// Set only on detached entries.
    pub worktree_path: Option<String>,
    pub last_known_tip: Option<LastKnownTip>,
}

impl EntryConfig {
    pub fn key(&self) -> String {
        entry_key(
            &self.repo_id,
            self.branch.as_deref(),
            self.worktree_path.as_deref(),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    /// ISO 8601 UTC.
    pub created_at: String,
    pub entries: Vec<EntryConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub default_base_order: Vec<String>,
    pub active_days: u32,
    /// Review layout; configs from before it load as `split`.
    pub diff_view: DiffLayout,
    pub ignore_whitespace: bool,
    /// Review: fold unchanged lines or show the whole file.
    pub diff_context: DiffContext,
    /// Lines kept around each change while folding: 3, 5 or 10.
    #[serde(deserialize_with = "context_lines")]
    pub diff_context_lines: u32,
    /// View › Font Size: the window's zoom, in percent.
    pub zoom: u32,
    /// Settings › General › Language; configs from before it load as `system`.
    #[serde(deserialize_with = "language")]
    pub language: Language,
    /// Settings › Appearance › Formatting › Date Format pattern; anything outside the
    /// choices reads as the default.
    #[serde(deserialize_with = "date_format")]
    pub date_format: String,
    /// Settings › Appearance › Formatting › Time Format pattern; same leniency.
    #[serde(deserialize_with = "time_format")]
    pub time_format: String,
    /// Settings › Appearance › Formatting › Number Format.
    #[serde(deserialize_with = "number_format")]
    pub number_format: NumberFormat,
    /// Settings › Appearance › Formatting › Prefer absolute dates over relative dates.
    pub prefer_absolute_dates: bool,
    /// Settings › Appearance › Diff › Tab size; anything outside the choices reads as 4.
    #[serde(deserialize_with = "tab_size")]
    pub diff_tab_size: u32,
    /// Settings › Appearance; configs from before it load as `system`.
    pub appearance: Appearance,
    /// Whether the main sidebar is shown; remembered, configs from before it load as shown.
    #[serde(default = "on")]
    pub sidebar_visible: bool,
    /// Settings › Behaviour › Terminal, for the entry menus' open items.
    pub terminal: TerminalChoice,
    /// The `other` terminal: a command (`%` becomes the folder), an app name, a `.app` path or
    /// a bundle id. Empty means Automatic.
    pub terminal_command: String,
    /// Settings › Behaviour › Check for updates: at launch and on focus, at most every 6 hours.
    pub check_updates: bool,
    /// The version whose What's New was shown (or skipped on a fresh install); '' before any.
    pub last_seen_version: String,
    /// Settings › Prompts: which confirmations are shown; configs from before it ask for all.
    pub prompts: Prompts,
    /// Settings › AI: commit message generation; configs from before it have it on.
    pub ai: AiSettings,
    /// Settings › Repositories › where New Branch checks a branch out unless another row is
    /// picked; configs from before it use the repository folder.
    pub new_branch_checkout: NewBranchCheckoutDefault,
}

/// The row New Branch opens with (SPEC §15 "New branch").
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NewBranchCheckoutDefault {
    Worktree,
    #[default]
    Main,
    None,
}

/// Settings › Prompts (M6): "Show a confirmation dialog before..." each of these.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prompts {
    pub remove_repositories: bool,
    /// Off after "Do not show this message again" in Confirm Discard Changes.
    pub discard_changes: bool,
    pub discard_stash: bool,
    pub delete_projects: bool,
    /// Abort of a rebase, merge, cherry-pick or revert (T3).
    pub abort_operation: bool,
    /// Amend of a commit already on the remote (Hi10).
    pub amend_pushed: bool,
}

impl Default for Prompts {
    fn default() -> Self {
        Prompts {
            remove_repositories: true,
            discard_changes: true,
            discard_stash: true,
            delete_projects: true,
            abort_operation: true,
            amend_pushed: true,
        }
    }
}

/// Settings › AI: commit message generation (SPEC §15 "Generate message").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    /// The commit form's generate control shows; off hides it.
    pub enabled: bool,
    /// Menu order: provider ids, as the Settings list has them; the default is the
    /// topmost switched-on one. (Old files may still carry `provider`: ignored.)
    pub order: Vec<String>,
    pub opencode: AiProviderSettings,
    pub claude: AiProviderSettings,
    pub cursor: AiProviderSettings,
    pub antigravity: AiProviderSettings,
    pub codex: AiProviderSettings,
    pub foundation: AiProviderSettings,
}

/// One provider's switch, model, effort and prompt template; an empty model, effort or
/// prompt is the CLI's own default, and the effort names are the model provider's own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiProviderSettings {
    /// Off hides the provider from the commit menu; configs from before it have it on.
    #[serde(default = "on")]
    pub enabled: bool,
    pub model: Option<String>,
    pub effort: Option<String>,
    /// `{branch}`, `{repo}`, `{stat}`, `{patch}`, `{examples}` are filled in; unset sends the
    /// built-in default.
    pub prompt: Option<String>,
}

fn on() -> bool {
    true
}

impl Default for AiSettings {
    fn default() -> Self {
        AiSettings {
            enabled: true,
            order: [
                "opencode",
                "claude",
                "cursor",
                "antigravity",
                "codex",
                "foundation",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
            opencode: AiProviderSettings::default(),
            claude: AiProviderSettings::default(),
            cursor: AiProviderSettings::default(),
            antigravity: AiProviderSettings::default(),
            codex: AiProviderSettings::default(),
            foundation: AiProviderSettings::default(),
        }
    }
}

impl Default for AiProviderSettings {
    fn default() -> Self {
        AiProviderSettings {
            enabled: true,
            model: None,
            effort: None,
            prompt: None,
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            default_base_order: vec!["origin/HEAD".into(), "main".into(), "master".into()],
            active_days: 14,
            diff_view: DiffLayout::Split,
            ignore_whitespace: false,
            diff_context: DiffContext::Changes,
            diff_context_lines: 3,
            zoom: 100,
            language: Language::System,
            date_format: "MMM d, yyyy".into(),
            time_format: "HH:mm".into(),
            number_format: NumberFormat::PlainComma,
            prefer_absolute_dates: false,
            diff_tab_size: 4,
            appearance: Appearance::System,
            sidebar_visible: true,
            terminal: TerminalChoice::Auto,
            terminal_command: String::new(),
            check_updates: true,
            last_seen_version: String::new(),
            prompts: Prompts::default(),
            ai: AiSettings::default(),
            new_branch_checkout: NewBranchCheckoutDefault::Main,
        }
    }
}

/// Settings › Appearance › Formatting › Number Format: which separators a count shows.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NumberFormat {
    PlainDot,
    /// The default: no grouping, comma decimals (`1234567,89`).
    #[default]
    PlainComma,
    GroupCommaDot,
    GroupDotComma,
    GroupSpaceDot,
    GroupSpaceComma,
}

/// The Date Format choices (SPEC §5 "Appearance").
pub const DATE_FORMATS: [&str; 16] = [
    "MMM d, yyyy",
    "MMMM do, yyyy",
    "MM/dd/yyyy",
    "dd/MM/yyyy",
    "dd-MM-yyyy",
    "dd.MM.yyyy",
    "yyyy/MM/dd",
    "yyyy-MM-dd",
    "yyyy.MM.dd",
    "MM/dd/yy",
    "dd/MM/yy",
    "dd-MM-yy",
    "dd.MM.yy",
    "yy/MM/dd",
    "yy-MM-dd",
    "yy.MM.dd",
];

/// The Time Format choices (SPEC §5 "Appearance").
pub const TIME_FORMATS: [&str; 8] = [
    "HH:mm:ss",
    "HH.mm.ss",
    "HH:mm",
    "HH.mm",
    "h:mm:ss aaa",
    "h.mm.ss aaa",
    "h:mm aaa",
    "h.mm aaa",
];

/// The Tab size choices (SPEC §5 "Appearance › Diff").
pub const TAB_SIZES: [u32; 9] = [1, 2, 3, 4, 5, 6, 8, 10, 12];

pub fn valid_date_format(s: &str) -> &str {
    if DATE_FORMATS.contains(&s) {
        s
    } else {
        "MMM d, yyyy"
    }
}

pub fn valid_time_format(s: &str) -> &str {
    if TIME_FORMATS.contains(&s) {
        s
    } else {
        "HH:mm"
    }
}

pub fn valid_tab_size(n: u32) -> u32 {
    if TAB_SIZES.contains(&n) {
        n
    } else {
        4
    }
}

/// Reads `dateFormat` leniently: a value outside the choices is the default.
fn date_format<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(valid_date_format(value.as_str().unwrap_or_default()).to_string())
}

/// Reads `timeFormat` leniently: a value outside the choices is the default.
fn time_format<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(valid_time_format(value.as_str().unwrap_or_default()).to_string())
}

/// Reads `numberFormat` leniently: an unknown value is the default.
fn number_format<'de, D: Deserializer<'de>>(d: D) -> Result<NumberFormat, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(match value.as_str() {
        Some("plain-dot") => NumberFormat::PlainDot,
        Some("group-comma-dot") => NumberFormat::GroupCommaDot,
        Some("group-dot-comma") => NumberFormat::GroupDotComma,
        Some("group-space-dot") => NumberFormat::GroupSpaceDot,
        Some("group-space-comma") => NumberFormat::GroupSpaceComma,
        _ => NumberFormat::PlainComma,
    })
}

/// Reads `diffTabSize` leniently: a value outside the choices is 4.
fn tab_size<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(valid_tab_size(
        value
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(4),
    ))
}

/// The lines-around-changes choices; anything else counts as 3.
pub fn valid_context_lines(n: u32) -> u32 {
    if matches!(n, 3 | 5 | 10) {
        n
    } else {
        3
    }
}

/// Reads `language` leniently: an unknown value is `system`, so a hand-edited
/// config never gets set aside for it (missing values use the struct default).
fn language<'de, D: Deserializer<'de>>(d: D) -> Result<Language, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(match value.as_str() {
        Some("en") => Language::En,
        Some("tr") => Language::Tr,
        _ => Language::System,
    })
}

/// Reads `diffContextLines` leniently: a value that is not 3, 5 or 10 (or not a number) is 3,
/// so a hand-edited config never gets set aside for it.
fn context_lines<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(valid_context_lines(
        value
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(3),
    ))
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffContext {
    /// Unchanged lines fold, keeping `diffContextLines` around each change.
    #[default]
    Changes,
    Whole,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

/// Settings › General › Language: the UI language; `system` follows the OS/browser.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    #[default]
    System,
    En,
    Tr,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalChoice {
    /// The first installed of iTerm2, WezTerm, Terminal.
    #[default]
    Auto,
    Terminal,
    Iterm,
    Wezterm,
    Other,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffLayout {
    #[default]
    Split,
    Unified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    pub repos: Vec<RepoConfig>,
    /// entryKey -> base ref name.
    pub branch_bases: BTreeMap<String, String>,
    pub projects: Vec<ProjectConfig>,
    pub settings: Settings,
    /// The user's scripts, in menu order (SPEC §14).
    pub scripts: Vec<ScriptConfig>,
    /// Repo ids pinned to the top of Branches, in the order they were pinned.
    pub pinned_repos: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            version: 1,
            repos: Vec::new(),
            branch_bases: BTreeMap::new(),
            projects: Vec::new(),
            settings: Settings::default(),
            scripts: Vec::new(),
            pinned_repos: Vec::new(),
        }
    }
}

// ---- Scripts (SPEC §14) ----

/// A value asked for before a script runs; it reaches the script as `GITGEL_INPUT_<ID>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptInput {
    /// `A–Z`, `0–9`, `_`; unique in its script.
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: ScriptInputKind,
    /// A checkbox's is `"1"` or empty.
    pub default: String,
    /// Select only.
    pub options: Vec<String>,
    pub required: bool,
    /// CEL; empty shows it always.
    pub when: String,
}

impl Default for ScriptInput {
    fn default() -> Self {
        ScriptInput {
            id: String::new(),
            label: String::new(),
            kind: ScriptInputKind::Text,
            default: String::new(),
            options: Vec::new(),
            required: false,
            when: String::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptInputKind {
    #[default]
    Text,
    Textarea,
    Checkbox,
    Select,
    Branch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptConfig {
    /// `s_` + 8 hex; empty for a new script and in an exported file.
    pub id: String,
    /// `{branch}`, `{base}` and `{repo}` are filled in on the menu.
    pub name: String,
    /// A name from the icon set (`src/components/icons.tsx`).
    pub icon: String,
    pub command: String,
    pub inputs: Vec<ScriptInput>,
    pub runs_in: ScriptFolder,
    pub show_in: Vec<ScriptMenu>,
    /// CEL; empty shows it always.
    pub when: String,
    /// "Open the output panel automatically": the panel opens as it starts.
    pub open_output: bool,
    /// "Ask before running": the run dialog opens even without inputs.
    pub ask_first: bool,
    /// Turned off in Settings › Scripts: kept, but in no menu.
    pub disabled: bool,
}

impl Default for ScriptConfig {
    fn default() -> Self {
        ScriptConfig {
            id: String::new(),
            name: String::new(),
            icon: "prompt".into(),
            command: String::new(),
            inputs: Vec::new(),
            runs_in: ScriptFolder::Worktree,
            show_in: vec![ScriptMenu::Branches, ScriptMenu::Project],
            when: String::new(),
            open_output: false,
            ask_first: false,
            disabled: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptFolder {
    /// The branch's worktree folder; disabled when it is not checked out.
    #[default]
    Worktree,
    /// The repository folder.
    Repo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptMenu {
    /// The Branches row menu.
    Branches,
    /// The Project entry menu.
    Project,
}

/// One run of a script (SPEC §14 "Running").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRun {
    pub run_id: String,
    pub script_id: String,
    /// The filled-in name.
    pub name: String,
    pub icon: String,
    pub entry_key: String,
    /// `web-app / session-token-refresh`.
    pub repo_label: String,
    pub repo_id: String,
    pub folder: String,
    /// The shell command as it runs (`$SHELL -l -c`), shown in the output panel.
    pub command: String,
    /// The `$VAR`s the command names with their values, for the output panel's hover
    /// (display only, including long ones like the AI prompt). The pty always gets `command`.
    pub command_vars: Vec<CommandVar>,
    pub status: ScriptRunStatus,
    pub exit_code: Option<i32>,
    /// Set when a signal ended it, e.g. `SIGINT` after Stop.
    pub signal: Option<String>,
    /// Stop was asked for.
    pub stopped: bool,
    /// ISO 8601 UTC.
    pub started_at: String,
    pub ended_at: Option<String>,
    /// The last non-empty output line.
    pub last_line: String,
    /// `get_script_run` only: the output so far (at most 2 MB, oldest dropped).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buffered: Option<String>,
    /// `get_script_run` only: bytes of output so far, dropped ones included; a `script-output`
    /// chunk whose `end` is not past it is already in `buffered`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buffered_end: Option<u64>,
}

/// One `$VAR` a run's command names, with its value (output panel hover).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandVar {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptRunStatus {
    Running,
    Exited,
    /// Could not start (the shell or the folder is missing).
    Failed,
}

/// Payload of `script-output`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptOutputChunk {
    pub run_id: String,
    pub data: String,
    /// Bytes of output so far, this chunk included.
    pub end: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryRef {
    pub repo_id: String,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
}

// ---- Scan and summaries ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryState {
    Ok,
    Merged,
    Detached,
    BaseMissing,
    BranchDeleted,
    RepoMissing,
    GitError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummary {
    pub key: String,
    pub repo_id: String,
    /// Basename of the repo folder.
    pub repo_name: String,
    pub branch: Option<String>,
    /// Folder it is checked out in; `None` if not checked out.
    pub worktree_path: Option<String>,
    /// Current tip; `None` if deleted or the repo is missing.
    pub head_sha: Option<String>,
    pub short_sha: Option<String>,
    /// Effective base ref name (custom or the repo default).
    pub base: Option<String>,
    pub base_is_custom: bool,
    pub ahead: Option<u32>,
    /// Base commits the branch does not have.
    pub behind: Option<u32>,
    /// Files changed between merge-base and tip.
    pub files: Option<u32>,
    pub add: Option<u32>,
    pub del: Option<u32>,
    /// `None` if not checked out.
    pub uncommitted: Option<u32>,
    /// Uncommitted files with merge conflicts (unmerged in the index); 0 when not checked out.
    #[serde(default)]
    pub conflicts: u32,
    /// Committer time of the tip commit, unix seconds.
    pub last_commit_at: Option<i64>,
    /// Newest modification time of the uncommitted files (staged, unstaged and untracked), unix
    /// seconds; only set when newer than `last_commit_at`.
    pub changed_at: Option<i64>,
    pub state: EntryState,
    /// Detail for `git_error` / `base_missing`.
    pub error: Option<String>,
    /// Where the branch is pushed to (W4a); `None` when detached, deleted or without a remote.
    #[serde(default)]
    pub upstream: Option<Upstream>,
    /// A rebase, merge, cherry-pick or revert stopped in its worktree (SPEC §15 "Operations in
    /// progress"); `None` when not checked out or nothing is in progress.
    #[serde(default)]
    pub operation: Option<Operation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Rebase,
    Merge,
    CherryPick,
    Revert,
}

/// An operation git left half done in an entry's worktree, usually on conflicts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub kind: OperationKind,
    /// Rebase: what it rebases on (a branch whose tip it is, else the short SHA).
    pub onto: Option<String>,
    /// Merge: what is merged in (`main`, `origin/feat`).
    pub other: Option<String>,
    /// The commit it stopped at (rebase) or applies (cherry-pick, revert): short SHA and subject.
    pub commit: Option<String>,
    pub subject: Option<String>,
    /// Rebase: the commit it stopped at (1-based) of `total`.
    pub step: Option<u32>,
    pub total: Option<u32>,
    /// Conflicted files that still have git's markers: Continue waits for none.
    pub unresolved: Vec<String>,
}

/// What deleting a branch loses (SPEC §15 "Delete branch"): its commits on no other branch, tag
/// or remote-tracking branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchLoss {
    /// Its own remote-tracking branch kept.
    pub lost: u32,
    /// Its remote branch deleted too.
    pub lost_with_remote: u32,
}

/// What stops New Branch (SPEC §15 "New branch"), for the dialog's message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NewBranchProblem {
    /// Not a name git takes for a branch.
    BadName,
    /// A local branch has it.
    Exists,
    /// Not an absolute path, or a file.
    BadFolder,
    /// A folder with something in it.
    FolderNotEmpty,
    /// Checking out in the repository folder: an operation in progress or conflicts there.
    MainBusy,
    /// Bringing the repository folder's changes: one of its changed files also differs between
    /// HEAD and the base, so `git switch` would refuse.
    CannotBring,
}

/// Where New Branch checks the new branch out.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NewBranchCheckout {
    /// A new linked worktree in `folder` (absolute, missing or empty).
    Worktree { folder: String },
    /// The repository folder; `bring` its uncommitted changes along, else stash them first.
    Main { bring: bool },
    /// Nowhere.
    None,
}

/// What stops Checkout Branch (SPEC §15 "Checkout branch"), for the dialog's message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckoutProblem {
    /// The local branch is gone or checked out somewhere already, or the remote branch is gone.
    Unavailable,
    /// A remote branch whose local name a local branch has.
    Exists,
    /// Not one of the repo's worktrees.
    NoWorktree,
    /// The worktree has an operation in progress or conflicts.
    Busy,
    /// Bringing the worktree's changes: one of its changed files also differs between HEAD and
    /// the branch, so `git switch` would refuse.
    CannotBring,
    /// A new worktree: not an absolute path, or a file.
    BadFolder,
    /// A new worktree: a folder with something in it.
    FolderNotEmpty,
}

/// Where Checkout Branch checks the branch out.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CheckoutTarget {
    /// One of the repo's worktrees (the repository folder too), which switches to it; `bring`
    /// its uncommitted changes along, else stash them first.
    Existing { folder: String, bring: bool },
    /// A new linked worktree in `folder` (absolute, missing or empty).
    New { folder: String },
}

/// A branch against its remote (`refs::tracking`), as of the last fetch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// e.g. `origin`.
    pub remote: String,
    /// The remote-tracking branch (`origin/feat`); `None` when the remote does not have it.
    pub name: Option<String>,
    /// Commits the remote does not have: on top of `name`, or, without it, on top of the base.
    pub ahead: u32,
    /// Commits of `name` the branch does not have.
    pub behind: u32,
    /// Newest commit the branch shares with `name` (where Review draws the upstream line).
    pub merge_base: Option<String>,
}

/// Lightweight record for the palette's "Older" group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherBranch {
    pub repo_id: String,
    pub repo_name: String,
    pub branch: String,
    pub last_commit_at: i64,
    pub merged: bool,
}

/// A remote-tracking branch with no local twin (Branches lists it while filtering).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    /// e.g. `origin/feat/x`.
    pub name: String,
    pub last_commit_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepoStatus {
    Ok,
    Missing,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoScan {
    pub repo: RepoConfig,
    pub name: String,
    pub status: RepoStatus,
    pub error: Option<String>,
    /// e.g. "main".
    pub default_base: Option<String>,
    /// The `defaultBaseOrder` item that matched, e.g. "origin/HEAD".
    pub default_base_source: Option<String>,
    /// Local name of the base branch, which `active` always lists (when it exists).
    pub base_branch: Option<String>,
    /// Active branches and detached worktrees, newest first.
    pub active: Vec<EntrySummary>,
    /// All remaining local branches except the base branch.
    pub others: Vec<OtherBranch>,
    /// Remote-tracking branches that are no local branch's upstream or namesake, newest first.
    pub remotes: Vec<RemoteBranch>,
    /// The repository's stash stack, newest first (one stack for all its worktrees).
    pub stashes: Vec<StashInfo>,
}

/// One `stash@{n}` (flow P).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    /// `n` in `stash@{n}`; 0 is the newest.
    pub index: u32,
    pub sha: String,
    /// The text after `On <branch>: `, or the whole `WIP on …` line.
    pub message: String,
    /// The branch it was taken on; `None` on a detached HEAD.
    pub branch: Option<String>,
    /// That branch still exists.
    pub branch_exists: bool,
    /// The commit it was taken on (its first parent).
    pub base: String,
    /// `None` when its changes could not be read.
    pub files: Option<u32>,
    /// Unix seconds.
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub repos: Vec<RepoScan>,
    pub scanned_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateReason {
    Refs,
    Worktree,
    Rescan,
}

/// Payload of the `repo-updated` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoUpdated {
    pub repo_id: String,
    /// Full current state of the repo; replaces the stored record.
    pub scan: RepoScan,
    pub reason: UpdateReason,
    /// The changed worktree when `reason` is `worktree`.
    pub worktree_path: Option<String>,
}

// ---- Review ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffMode {
    Committed,
    Uncommitted,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileKind {
    A,
    M,
    R,
    D,
    U,
    /// Unmerged: a merge, rebase or stash apply left it with conflicts (working tree only).
    C,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Only for R (and copies reported as A).
    pub old_path: Option<String>,
    pub kind: FileKind,
    /// `None` for binary files.
    pub add: Option<u32>,
    pub del: Option<u32>,
    pub binary: bool,
    /// `None`: the left side is empty (added / untracked).
    pub old_oid: Option<String>,
    /// `None`: the right side is read from disk (worktree), or empty for D.
    pub new_oid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub committed_at: i64,
    /// Name of the other branch this commit belongs to, if any.
    pub from_branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackHint {
    pub branch: String,
    pub contains: u32,
    pub total: u32,
}

/// `Record<DiffMode, FileChange[]>` on the TypeScript side.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesByMode {
    pub committed: Vec<FileChange>,
    pub uncommitted: Vec<FileChange>,
    pub all: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGroup {
    pub entry: EntrySummary,
    pub merge_base: Option<String>,
    pub files: FilesByMode,
    pub commits: Vec<CommitInfo>,
    pub stack_hint: Option<StackHint>,
}

/// One commit's own changes, against its first parent (flow D7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitChanges {
    pub sha: String,
    /// First parent; `None` for a root commit (compared with an empty tree).
    pub parent: Option<String>,
    pub files: Vec<FileChange>,
}

/// Several commits taken together (History's selection, Hi12): from the oldest one's first
/// parent to the newest one, or to the working tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeChanges {
    /// `None` for a root commit (compared with an empty tree).
    pub parent: Option<String>,
    pub files: Vec<FileChange>,
}

/// What a stash holds, against the commit it was taken on; untracked files are `U`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashChanges {
    pub sha: String,
    pub base: String,
    pub files: Vec<FileChange>,
}

/// One commit of a history page (§16).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommit {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    /// The message after the subject, trimmed; empty when there is none.
    pub body: String,
    pub author: String,
    pub author_email: String,
    /// Committer time, unix seconds.
    pub committed_at: i64,
    /// More than one: a merge commit.
    pub parents: u32,
    /// Reachable from the base asked for (listed below the base line).
    pub in_base: bool,
}

/// A branch's history, newest first (§16).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub rev: String,
    /// `None` when `rev` does not resolve.
    pub tip: Option<String>,
    pub commits: Vec<HistoryCommit>,
    /// More commits (or matches) past `limit`.
    pub more: bool,
    /// Commits not reachable from the base; `None` without a base.
    pub ahead: Option<u32>,
    /// Modification time of `FETCH_HEAD`, unix seconds; `None` if never fetched.
    pub fetched_at: Option<i64>,
    /// When `rev` is a local branch: where it is pushed to (W4a).
    pub upstream: Option<Upstream>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewData {
    /// Reviewable entries, in project order.
    pub groups: Vec<ReviewGroup>,
    /// Project scope only.
    pub not_in_review: Vec<EntrySummary>,
    pub total_entries: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ReviewTarget {
    Project {
        project_id: String,
    },
    Branch {
        repo_id: String,
        branch: Option<String>,
        worktree_path: Option<String>,
        tip_override: Option<String>,
    },
    /// A repository's stash stack (flow P3): no entries, only its stashes.
    Stashes {
        repo_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePair {
    pub original: String,
    pub modified: String,
    pub binary: bool,
    pub too_large: bool,
}

/// A repository remote's web page (`remote_url`): `origin` if there is one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub base: String,
    pub kind: RemoteKind,
}

/// The host decides the URL shape on the frontend: GitLab (`/-/commit`, `/-/blob`),
/// Bitbucket (`/commits`, `/src`); anything else (Gitea, Forgejo, self-hosted) is
/// GitHub-style (`/commit`, `/blob`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteKind {
    GitHub,
    GitLab,
    Bitbucket,
    Other,
}

// ---- Other ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderKind {
    Repo,
    Resolved,
    Duplicate,
    NotGit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolvedVia {
    Worktree,
    Subdir,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateOf {
    Config,
    Batch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCheck {
    /// The path the user picked.
    pub input: String,
    pub kind: FolderKind,
    /// Resolved main repository root.
    pub repo_path: Option<String>,
    /// How `resolved` / `duplicate` inputs were resolved.
    pub via: Option<ResolvedVia>,
    pub duplicate_of: Option<DuplicateOf>,
    pub default_base: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseCandidate {
    /// `master` or `origin/master`.
    pub name: String,
    pub remote: bool,
    /// The entry's commits on top of it; `None` if unrelated (or the entry has no tip).
    pub ahead: Option<u32>,
    /// The other candidate's name when both point at the same commit.
    pub same_as: Option<String>,
    /// No common ancestor with the entry's tip.
    pub unrelated: bool,
    /// The one the nearest-default rule picked.
    pub auto: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultCandidates {
    /// The matching order item (`origin/HEAD`), or `upstream` for the base branch itself.
    pub source: String,
    /// Local first.
    pub candidates: Vec<BaseCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseOptions {
    pub current: Option<String>,
    /// Descending by `contains`, only `contains > 0`.
    pub suggested: Vec<StackHint>,
    pub defaults: Option<DefaultCandidates>,
    /// All local branches except the entry itself.
    pub branches: Vec<String>,
    /// Remote-tracking branches without `*/HEAD` and the default candidates; the one with the
    /// entry's name first.
    pub remotes: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub project: ProjectConfig,
    pub entries: Vec<EntrySummary>,
}

/// An installed app the entry menus can open a worktree folder in (`apps.rs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenApp {
    pub id: String,
    pub name: String,
    /// PNG data URL of the app's icon.
    pub icon: Option<String>,
    /// False only for a terminal that is not installed.
    pub found: bool,
}

/// A terminal the Settings dropdown can choose: whether it is installed (`apps.rs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOption {
    pub choice: TerminalChoice,
    pub name: String,
    pub found: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn entry_key_for_branch() {
        assert_eq!(entry_key("r_1", Some("feat/x"), None), "r_1:feat/x");
        // A branch entry ignores the worktree path.
        assert_eq!(entry_key("r_1", Some("main"), Some("/wt")), "r_1:main");
    }

    #[test]
    fn entry_key_for_detached() {
        assert_eq!(
            entry_key("r_1", None, Some("/Users/me/wt/d")),
            "r_1:@/Users/me/wt/d"
        );
    }

    #[test]
    fn review_target_uses_kind_tag_and_camel_case_fields() {
        let t: ReviewTarget = serde_json::from_value(json!({
            "kind": "branch", "repoId": "r_1", "branch": "main",
            "worktreePath": null, "tipOverride": null
        }))
        .unwrap();
        assert_eq!(
            t,
            ReviewTarget::Branch {
                repo_id: "r_1".into(),
                branch: Some("main".into()),
                worktree_path: None,
                tip_override: None,
            }
        );
        let p = serde_json::to_value(ReviewTarget::Project {
            project_id: "p_1".into(),
        })
        .unwrap();
        assert_eq!(p, json!({ "kind": "project", "projectId": "p_1" }));
    }

    #[test]
    fn enums_use_frontend_spelling() {
        assert_eq!(
            serde_json::to_value(EntryState::BaseMissing).unwrap(),
            json!("base_missing")
        );
        assert_eq!(serde_json::to_value(FileKind::U).unwrap(), json!("U"));
        assert_eq!(
            serde_json::to_value(FolderKind::NotGit).unwrap(),
            json!("not_git")
        );
    }
}
