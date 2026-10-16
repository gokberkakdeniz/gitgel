//! Commit message generation (SPEC §15 "Generate message"): an agent CLI writes a commit
//! message for the checked files of Uncommitted. The prompt comes from git2 reads only (the
//! checked files' patch and recent subjects); the CLI runs in the entry's worktree as a run
//! (`ai:generate`) through the scripts' pty runner, with a running toast and an output panel,
//! and never writes to the repository.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use git2::{DiffOptions, Oid, Repository, Sort};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::config;
use crate::error::AppError;
use crate::git::{diff, worktrees};
use crate::model::{
    entry_key, AiProviderSettings, AiSettings, EntryRef, ScriptRun, ScriptRunStatus,
};
use crate::scripts::run;
use crate::state::{lock, AppState};

/// Prefix of a message generation's runs; they rescan nothing and toast nothing at the end
/// (the `generate-finished` event carries the result).
pub const AI_PREFIX: &str = "ai:";
/// The frontend learns the answer through this event.
pub const GENERATE_FINISHED: &str = "generate-finished";
/// How long a provider may take (agy's own print timeout is 5 minutes).
const TIMEOUT: Duration = Duration::from_secs(330);
/// The patch in the prompt is cut here.
const MAX_PATCH: usize = 12_000;
/// Recent subjects in the prompt; those touching the checked files come first.
const MAX_EXAMPLES: usize = 15;
const MAX_FILE_EXAMPLES: usize = 8;
/// Commits walked back for the examples.
const WALK_DEPTH: usize = 100;

/// An agent CLI that writes the message (`generate_message`'s `provider`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Opencode,
    Claude,
    Cursor,
    Antigravity,
    Codex,
    Foundation,
}

impl Provider {
    fn tool(&self) -> &'static str {
        match self {
            Provider::Opencode => "OpenCode",
            Provider::Claude => "Claude Code",
            Provider::Cursor => "Cursor",
            Provider::Antigravity => "Antigravity",
            Provider::Codex => "Codex",
            Provider::Foundation => "Apple Foundation Models",
        }
    }

    /// The fixed command (the prompt travels in `GITGEL_PROMPT`, SPEC §0). opencode's
    /// default format mixes its trace into stdout, so it runs as JSON events and only the
    /// answer's text is kept; its `plan` agent denies edits (the default `build` allows all). `model` / `effort` add their flags (effort only where the CLI
    /// has one, see `effort_supported`).
    fn command(&self, model: bool, effort: bool) -> String {
        let prompt = "\"$GITGEL_PROMPT\"";
        let model = if model {
            " --model \"$GITGEL_MODEL\""
        } else {
            ""
        };
        let effort_flag = |flag: &str| {
            if effort {
                format!(" {flag} \"$GITGEL_EFFORT\"")
            } else {
                String::new()
            }
        };
        match self {
            Provider::Opencode => {
                let effort = effort_flag("--variant");
                format!("opencode run --format json --agent plan{model}{effort} {prompt}")
            }
            // No sandbox flag: anything that would prompt is denied instead, so the
            // CLI can read but not act (the patch is already in the prompt).
            Provider::Claude => {
                let effort = effort_flag("--effort");
                format!(
                    "claude -p {prompt} --output-format text --permission-prompts none{model}{effort}"
                )
            }
            // `agent` is Cursor's primary command (`cursor-agent` is its legacy alias).
            // `--trust` answers its workspace trust prompt, which ends a headless run.
            Provider::Cursor => format!("agent -p {prompt} --trust --output-format text{model}"),
            Provider::Antigravity => {
                let effort = effort_flag("--effort");
                format!("agy -p {prompt} --sandbox --output-format text --print-timeout 5m{model}{effort}")
            }
            // Read-only by default, explicit here; without `--force` cursor only proposes too.
            // The effort override is TOML, so the command quotes its value.
            Provider::Codex => {
                let effort = if effort {
                    " -c \"model_reasoning_effort=\\\"$GITGEL_EFFORT\\\"\""
                } else {
                    ""
                };
                format!("codex exec --ephemeral --sandbox read-only{model}{effort} {prompt}")
            }
            // Apple's on-device model: no tools unless asked for, so it cannot act. The
            // streamed answer redraws, so it is printed whole.
            Provider::Foundation => format!("fm respond --no-stream{model} {prompt}"),
        }
    }

    /// The id Settings and the commit menu use (`cursor`, not the `agent` binary).
    fn id(&self) -> &'static str {
        match self {
            Provider::Opencode => "opencode",
            Provider::Claude => "claude",
            Provider::Cursor => "cursor",
            Provider::Antigravity => "antigravity",
            Provider::Codex => "codex",
            Provider::Foundation => "foundation",
        }
    }

    fn settings<'a>(&self, ai: &'a AiSettings) -> &'a AiProviderSettings {
        match self {
            Provider::Opencode => &ai.opencode,
            Provider::Claude => &ai.claude,
            Provider::Cursor => &ai.cursor,
            Provider::Antigravity => &ai.antigravity,
            Provider::Codex => &ai.codex,
            Provider::Foundation => &ai.foundation,
        }
    }

    /// opencode (`--variant`), Claude Code and Antigravity (`--effort`) and Codex
    /// (`model_reasoning_effort`) take one; the names are the model provider's own.
    fn effort_supported(&self) -> bool {
        !matches!(self, Provider::Cursor | Provider::Foundation)
    }
}

/// The answer split for the form: its first line, and the rest.
struct GeneratedMessage {
    summary: String,
    description: String,
}

/// What `generate_message_start` returns through `generate-finished`: the form's two fields,
/// or why there are none.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateFinished {
    run_id: String,
    summary: Option<String>,
    description: Option<String>,
    error: Option<String>,
    cancelled: bool,
}

/// Whether each provider's CLI is installed: its binary through the login shell.
pub fn status() -> Vec<ProviderStatus> {
    const ALL: [Provider; 6] = [
        Provider::Opencode,
        Provider::Claude,
        Provider::Cursor,
        Provider::Antigravity,
        Provider::Codex,
        Provider::Foundation,
    ];
    const BINS: [&str; 6] = ["opencode", "claude", "agent", "agy", "codex", "fm"];
    // `command -v` one per line when found (`;`-joined: fish-safe); `true` keeps the exit 0.
    let command = BINS
        .iter()
        .map(|b| format!("command -v {b}"))
        .collect::<Vec<_>>()
        .join("; ")
        + "; true";
    let found = run::probe(&command, &[], Duration::from_secs(15)).unwrap_or_default();
    let paths: Vec<&str> = found
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    ALL.iter()
        .zip(BINS)
        .map(|(provider, bin)| {
            let suffix = format!("/{bin}");
            ProviderStatus {
                id: provider.id(),
                installed: paths
                    .iter()
                    .any(|p| *p == bin || p.ends_with(suffix.as_str())),
            }
        })
        .collect()
}

/// One row of `get_ai_status`.
#[derive(Debug, Clone, Serialize)]
pub struct ProviderStatus {
    pub id: &'static str,
    pub installed: bool,
}

/// Ask the provider's CLI for a commit message for the entry's checked files: a run
/// (`ai:generate`) with a running toast and an output panel; the answer arrives as
/// `generate-finished`.
pub fn start(
    state: &AppState,
    entry: EntryRef,
    include: Vec<String>,
    provider: Provider,
) -> Result<ScriptRun, AppError> {
    if include.is_empty() {
        return Err(AppError::Invalid("Pick at least one file.".into()));
    }
    if include.iter().any(|p| p.is_empty() || p.contains('\0')) {
        return Err(AppError::Invalid("A picked file has no valid path.".into()));
    }
    let config = config::snapshot(state);
    if !config.settings.ai.enabled {
        return Err(AppError::Invalid(
            "Turn on Generate commit message with AI first (Settings › AI).".into(),
        ));
    }
    let settings = provider.settings(&config.settings.ai);
    if !settings.enabled {
        return Err(AppError::Invalid(format!(
            "{} is turned off (Settings › AI).",
            provider.tool()
        )));
    }
    let model = settings
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty());
    let (repo_id, repo_name, repo_path) = config
        .repos
        .iter()
        .find(|r| r.id == entry.repo_id)
        .map(|r| {
            (
                r.id.clone(),
                Path::new(&r.path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                PathBuf::from(&r.path),
            )
        })
        .ok_or_else(|| AppError::NotFound(format!("repository {}", entry.repo_id)))?;
    let wanted = entry
        .worktree_path
        .as_deref()
        .and_then(|p| Path::new(p).canonicalize().ok());
    let tree = {
        let shared = state.pool.get(&repo_path)?;
        let repo = lock(&shared);
        worktrees::list_worktrees(&state.pool, &repo)?
            .into_iter()
            .find(|w| match &entry.branch {
                Some(b) => w.branch.as_deref() == Some(b.as_str()),
                None => Some(&w.path) == wanted.as_ref(),
            })
            .ok_or_else(|| {
                AppError::Invalid(format!(
                    "{} is not checked out.",
                    entry.branch.as_deref().unwrap_or("detached HEAD")
                ))
            })?
    };
    let head = Oid::from_str(&tree.head)
        .map_err(|_| AppError::Invalid("There is no commit to compare against yet.".into()))?;
    let (stat, patch) = checked_patch(state, &tree.path, &head, &include)?;
    let examples = style_examples(state, &repo_path, &head, &include)?;
    let branch = tree
        .branch
        .clone()
        .unwrap_or_else(|| tree.head.chars().take(7).collect());
    let template = settings
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty());
    if template.is_some_and(|t| !t.contains("{patch}")) {
        return Err(AppError::Invalid("The prompt needs {patch}.".into()));
    }
    let prompt = render(
        template.unwrap_or(DEFAULT_PROMPT),
        &branch,
        &repo_name,
        &stat,
        &patch,
        &examples,
    );
    let effort = provider
        .effort_supported()
        .then_some(
            settings
                .effort
                .as_deref()
                .map(str::trim)
                .filter(|e| !e.is_empty()),
        )
        .flatten();
    // Codex reads the override as a TOML string, which the command quotes.
    if provider == Provider::Codex
        && effort.is_some_and(|e| e.contains(['"', '\\']) || e.chars().any(char::is_control))
    {
        return Err(AppError::Invalid(
            "Effort cannot contain quotes, backslashes or line breaks.".into(),
        ));
    }
    let mut env = vec![("GITGEL_PROMPT".to_string(), prompt)];
    if let Some(model) = model {
        env.push(("GITGEL_MODEL".to_string(), model.to_string()));
    }
    if let Some(effort) = effort {
        env.push(("GITGEL_EFFORT".to_string(), effort.to_string()));
    }
    let run = run::launch(
        state,
        run::Launch {
            script_id: format!("{AI_PREFIX}generate"),
            name: format!("Generate with {}", provider.tool()),
            icon: "sparkles".into(),
            entry_key: entry_key(
                &repo_id,
                entry.branch.as_deref(),
                entry.worktree_path.as_deref(),
            ),
            repo_label: format!("{repo_name} / {branch}"),
            repo_id,
            also_rescan: Vec::new(),
            folder: tree.path.clone(),
            command: provider.command(model.is_some(), effort.is_some()),
            env,
            cleanup: Vec::new(),
        },
    )?;
    let finished = run.run_id.clone();
    let run = ScriptRun {
        buffered: None,
        buffered_end: None,
        ..run
    };
    let watcher = Watcher {
        state: state.clone(),
        run_id: finished,
        provider,
    };
    std::thread::spawn(move || watcher.finish());
    Ok(run)
}

/// What the watcher waits for: the run's end, or the stop it sends past the timeout.
struct Watcher {
    state: AppState,
    run_id: String,
    provider: Provider,
}

impl Watcher {
    fn finish(&self) {
        let tool = self.provider.tool();
        let done = GenerateFinished {
            run_id: self.run_id.clone(),
            summary: None,
            description: None,
            error: None,
            cancelled: false,
        };
        let done = match self.wait() {
            Err(e) => GenerateFinished {
                error: Some(e.to_string()),
                ..done
            },
            Ok(run) if run.stopped => GenerateFinished {
                cancelled: true,
                ..done
            },
            Ok(run) if run.status == ScriptRunStatus::Failed => GenerateFinished {
                error: Some(if run.last_line.is_empty() {
                    format!("{tool} could not start.")
                } else {
                    run.last_line.clone()
                }),
                ..done
            },
            Ok(run) => match run.exit_code {
                Some(0) => {
                    let text = run::clean_output(run.buffered.as_deref().unwrap_or(""));
                    let answer = match self.provider {
                        Provider::Opencode => opencode_text(&text),
                        Provider::Codex => codex_text(&text),
                        _ => {
                            if text.is_empty() {
                                Err(AppError::Invalid(format!("{tool} returned no message.")))
                            } else {
                                Ok(text)
                            }
                        }
                    };
                    match answer {
                        Ok(answer) => {
                            let message = parse(&answer);
                            GenerateFinished {
                                summary: Some(message.summary),
                                description: Some(message.description),
                                ..done
                            }
                        }
                        Err(e) => GenerateFinished {
                            error: Some(e.to_string()),
                            ..done
                        },
                    }
                }
                code => GenerateFinished {
                    error: Some(exit_error(tool, code, &run.last_line).to_string()),
                    ..done
                },
            },
        };
        if let Err(e) = self.state.app.emit(GENERATE_FINISHED, &done) {
            log::warn!("cannot emit {GENERATE_FINISHED}: {e}");
        }
    }

    /// The run's end; past `TIMEOUT` the run is stopped and the wait is an error.
    fn wait(&self) -> Result<ScriptRun, AppError> {
        let started = std::time::Instant::now();
        loop {
            let run = run::get_run(&self.state, &self.run_id)?;
            if run.status != ScriptRunStatus::Running {
                return Ok(run);
            }
            if started.elapsed() > TIMEOUT {
                let _ = run::stop(&self.state, &self.run_id);
                return Err(AppError::Invalid(format!(
                    "{} took too long (over {} s).",
                    self.provider.tool(),
                    TIMEOUT.as_secs()
                )));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

/// A non-zero exit: 127 (or "command not found") means the tool is not installed.
fn exit_error(tool: &str, code: Option<i32>, last: &str) -> AppError {
    if code == Some(127) || last.contains("command not found") {
        AppError::NotFound(format!("{tool} is not installed."))
    } else if last.is_empty() {
        AppError::Invalid(format!("{tool} exited with code {}.", code.unwrap_or(-1)))
    } else {
        AppError::Invalid(last.to_string())
    }
}

/// The checked files as stat lines and a patch (cut at `MAX_PATCH`).
fn checked_patch(
    state: &AppState,
    worktree: &Path,
    head: &Oid,
    include: &[String],
) -> Result<(Vec<String>, String), AppError> {
    let shared = state.pool.get(worktree)?;
    let wt = lock(&shared);
    wt.index()?.read(false)?;
    let tree = wt.find_commit(*head)?.tree()?;
    let mut opts = DiffOptions::new();
    opts.context_lines(3)
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true)
        .ignore_submodules(true);
    let diff = wt.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut opts))?;
    let wanted: HashSet<&str> = include.iter().map(String::as_str).collect();
    let filed = diff::changes(&diff, diff::NewSide::Workdir)?;
    let mut stat = Vec::new();
    let mut patch = String::new();
    for (i, delta) in diff.deltas().enumerate() {
        let path = |f: git2::DiffFile| {
            f.path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        let (old, new) = (path(delta.old_file()), path(delta.new_file()));
        if !wanted.contains(old.as_str()) && !wanted.contains(new.as_str()) {
            continue;
        }
        let mut text = git2::Patch::from_diff(&diff, i)?;
        let kind = filed
            .iter()
            .find(|f| f.path == new || f.old_path.as_deref() == Some(old.as_str()));
        let shown = if new.is_empty() { &old } else { &new };
        let binary = text.as_ref().is_none_or(|p| p.delta().flags().is_binary());
        match kind {
            Some(f) if binary => stat.push(format!("{:?} {shown} (binary)", f.kind)),
            Some(f) => stat.push(format!(
                "{:?} {shown} (+{} -{})",
                f.kind,
                f.add.unwrap_or(0),
                f.del.unwrap_or(0)
            )),
            None => stat.push(shown.clone()),
        }
        if binary {
            continue;
        }
        let buf = text.as_mut().expect("checked").to_buf()?;
        patch.push_str(&String::from_utf8_lossy(&buf));
    }
    if patch.chars().count() > MAX_PATCH {
        let cut: String = patch.chars().take(MAX_PATCH).collect();
        patch = format!("{cut}\n[… cut]");
    }
    Ok((stat, patch))
}

/// Up to `MAX_EXAMPLES` recent subjects from the branch, those touching the checked files
/// first, so the message matches this repository's own style.
fn style_examples(
    state: &AppState,
    repo_path: &Path,
    head: &Oid,
    include: &[String],
) -> Result<Vec<String>, AppError> {
    let shared = state.pool.get(repo_path)?;
    let repo = lock(&shared);
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME)?;
    walk.push(*head)?;
    let mut filed = Vec::new();
    let mut recent = Vec::new();
    for oid in walk.take(WALK_DEPTH).flatten() {
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        let Ok(Some(summary)) = commit.summary() else {
            continue;
        };
        let subject = summary.to_string();
        if filed.len() < MAX_FILE_EXAMPLES && touches(&repo, &commit, include)? {
            filed.push(subject.clone());
        }
        if recent.len() < MAX_EXAMPLES {
            recent.push(subject);
        }
        if filed.len() >= MAX_FILE_EXAMPLES && recent.len() >= MAX_EXAMPLES {
            break;
        }
    }
    let seen: HashSet<String> = filed.iter().cloned().collect();
    filed.extend(recent.into_iter().filter(|s| !seen.contains(s)));
    filed.truncate(MAX_EXAMPLES);
    Ok(filed)
}

/// Whether the commit changed one of the checked files (against its first parent, or the
/// empty tree for a root commit).
fn touches(repo: &Repository, commit: &git2::Commit, include: &[String]) -> Result<bool, AppError> {
    let new = commit.tree()?;
    let old = commit
        .parent_id(0)
        .ok()
        .and_then(|id| repo.find_commit(id).ok())
        .map(|p| p.tree())
        .transpose()?;
    let mut opts = DiffOptions::new();
    opts.disable_pathspec_match(true);
    for p in include {
        opts.pathspec(p);
    }
    let diff = repo.diff_tree_to_tree(old.as_ref(), Some(&new), Some(&mut opts))?;
    Ok(diff.stats()?.files_changed() > 0)
}

/// The prompt sent without one of its own: `{branch}` and `{repo}` name the work, `{stat}`
/// lists the checked files, `{patch}` is their diff, `{examples}` this repository's recent
/// subjects, newest first.
pub const DEFAULT_PROMPT: &str = "Write the commit message for the changes below. Match the style of this repository's recent commits:\n{examples}\nRules: do not run any commands or read any files; write the message only from the changes and examples below. The first line at most 72 characters. Then a blank line and a body only if this repository's history uses bodies. Output only the message, no fences, no explanations.\nChanges:\n{stat}\n{patch}";

/// Fills a prompt template; unknown `{names}` are left alone.
fn render(
    template: &str,
    branch: &str,
    repo: &str,
    stat: &[String],
    patch: &str,
    examples: &[String],
) -> String {
    let examples = examples
        .iter()
        .map(|s| format!("- {s}"))
        .collect::<Vec<_>>()
        .join("\n");
    template
        .replace("{branch}", branch)
        .replace("{repo}", repo)
        .replace("{stat}", &stat.join("\n"))
        .replace("{patch}", patch)
        .replace("{examples}", &examples)
}

/// opencode's `--format json` stream: the answer is the `text` events' `part.text` joined;
/// `error` events say why there is none.
fn opencode_text(stream: &str) -> Result<String, AppError> {
    let mut answer = String::new();
    let mut failure: Option<String> = None;
    for line in stream.lines() {
        let Ok(event) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        match event.get("type").and_then(serde_json::Value::as_str) {
            Some("text") => {
                if let Some(text) = event
                    .get("part")
                    .and_then(|p| p.get("text"))
                    .and_then(serde_json::Value::as_str)
                {
                    if !answer.is_empty() {
                        answer.push('\n');
                    }
                    answer.push_str(text);
                }
            }
            Some("error") => {
                let message = event
                    .get("error")
                    .and_then(|e| {
                        e.get("data")
                            .and_then(|d| d.get("message"))
                            .and_then(serde_json::Value::as_str)
                    })
                    .or_else(|| {
                        event
                            .get("error")
                            .and_then(|e| e.get("name"))
                            .and_then(serde_json::Value::as_str)
                    })
                    .unwrap_or("opencode failed");
                failure = Some(message.to_string());
            }
            _ => {}
        }
    }
    if !answer.trim().is_empty() {
        return Ok(answer);
    }
    Err(AppError::Invalid(failure.unwrap_or_else(|| {
        "opencode returned no message.".to_string()
    })))
}

/// Codex's terminal output: its banner, the prompt, warnings and trace come first; the
/// answer is the block after the last `codex` line, up to `tokens used`.
fn codex_text(output: &str) -> Result<String, AppError> {
    let lines: Vec<&str> = output.lines().collect();
    let answer = match lines.iter().rposition(|l| l.trim() == "codex") {
        Some(i) => {
            let rest = &lines[i + 1..];
            let end = rest
                .iter()
                .position(|l| l.trim() == "tokens used")
                .unwrap_or(rest.len());
            rest[..end].join("\n")
        }
        None => output.to_string(),
    };
    if answer.trim().is_empty() {
        Err(AppError::Invalid("Codex returned no message.".into()))
    } else {
        Ok(answer)
    }
}

/// The answer, without code fences or surrounding blank lines: its first line is the
/// summary, the rest (paragraphs kept) the description.
fn parse(text: &str) -> GeneratedMessage {
    let blank_or_fence = |l: &&str| l.trim().is_empty() || l.trim_start().starts_with("```");
    let lines: Vec<&str> = text.lines().map(str::trim_end).collect();
    let start = lines
        .iter()
        .position(|l| !blank_or_fence(l))
        .unwrap_or(lines.len());
    let end = lines
        .iter()
        .rposition(|l| !blank_or_fence(l))
        .map_or(start, |i| i + 1);
    let lines = &lines[start..end.max(start)];
    let summary: String = lines
        .first()
        .map_or("", |l| l.trim())
        .chars()
        .take(72)
        .collect();
    let body = lines.get(1..).unwrap_or_default();
    let body = &body[body
        .iter()
        .position(|l| !l.is_empty())
        .unwrap_or(body.len())..];
    GeneratedMessage {
        summary: summary.trim_end().to_string(),
        description: body.join("\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_splits_into_summary_and_description() {
        let m = parse("feat(sync): show progress\n\nLonger why here.\nTwo lines.\n\n- one\n  more");
        assert_eq!(m.summary, "feat(sync): show progress");
        assert_eq!(
            m.description,
            "Longer why here.\nTwo lines.\n\n- one\n  more"
        );
    }

    #[test]
    fn blank_lines_are_skipped_and_long_summaries_cut() {
        let m = parse("\n\n  only subject  \n");
        assert_eq!(m.summary, "only subject");
        assert!(m.description.is_empty());
        let long = "x".repeat(100);
        assert_eq!(parse(&long).summary.chars().count(), 72);
    }

    #[test]
    fn commands_carry_no_values() {
        assert_eq!(
            Provider::Claude.command(false, false),
            r#"claude -p "$GITGEL_PROMPT" --output-format text --permission-prompts none"#
        );
        assert_eq!(
            Provider::Claude.command(true, true),
            r#"claude -p "$GITGEL_PROMPT" --output-format text --permission-prompts none --model "$GITGEL_MODEL" --effort "$GITGEL_EFFORT""#
        );
        assert_eq!(
            Provider::Opencode.command(true, true),
            r#"opencode run --format json --agent plan --model "$GITGEL_MODEL" --variant "$GITGEL_EFFORT" "$GITGEL_PROMPT""#
        );
        assert_eq!(
            Provider::Cursor.command(false, false),
            r#"agent -p "$GITGEL_PROMPT" --trust --output-format text"#
        );
        assert_eq!(
            Provider::Antigravity.command(true, true),
            r#"agy -p "$GITGEL_PROMPT" --sandbox --output-format text --print-timeout 5m --model "$GITGEL_MODEL" --effort "$GITGEL_EFFORT""#
        );
        assert_eq!(
            Provider::Codex.command(false, true),
            r#"codex exec --ephemeral --sandbox read-only -c "model_reasoning_effort=\"$GITGEL_EFFORT\"" "$GITGEL_PROMPT""#
        );
        assert_eq!(
            Provider::Foundation.command(true, false),
            r#"fm respond --no-stream --model "$GITGEL_MODEL" "$GITGEL_PROMPT""#
        );
        // Effort is only offered where the CLI takes one.
        assert!(Provider::Opencode.effort_supported());
        assert!(Provider::Antigravity.effort_supported());
        assert!(Provider::Codex.effort_supported());
        assert!(Provider::Claude.effort_supported());
        assert!(!Provider::Cursor.effort_supported());
        assert!(!Provider::Foundation.effort_supported());
    }

    #[test]
    fn exits_map_to_not_installed_or_the_last_line() {
        assert!(matches!(
            exit_error("Cursor", Some(127), "agent: command not found"),
            AppError::NotFound(_)
        ));
        assert_eq!(
            exit_error("agy", Some(1), "").to_string(),
            "invalid: agy exited with code 1."
        );
        assert_eq!(
            exit_error("agy", Some(1), "boom").to_string(),
            "invalid: boom"
        );
    }

    #[test]
    fn fenced_answers_are_unwrapped() {
        let m = parse("\n```text\nfeat(x): ok\n\nBody.\n```\n");
        assert_eq!(m.summary, "feat(x): ok");
        assert_eq!(m.description, "Body.");
    }

    #[test]
    fn templates_fill_their_variables() {
        let out = render(
            "{repo} / {branch}:\n{stat}\n{patch}\n{examples}\n{unknown}",
            "feat/x",
            "web-app",
            &["M a.ts (+1 -0)".to_string()],
            "diff",
            &["first".to_string(), "second".to_string()],
        );
        assert_eq!(
            out,
            "web-app / feat/x:\nM a.ts (+1 -0)\ndiff\n- first\n- second\n{unknown}"
        );
        for name in ["{stat}", "{patch}", "{examples}"] {
            assert!(DEFAULT_PROMPT.contains(name), "{name}");
        }
    }

    #[test]
    fn opencode_keeps_only_the_answer_text() {
        let stream = concat!(
            "{\"type\":\"step_start\",\"timestamp\":1,\"sessionID\":\"ses_a\",\"part\":{\"type\":\"step-start\"}}\n",
            "{\"type\":\"tool_use\",\"timestamp\":2,\"sessionID\":\"ses_a\",\"part\":{\"type\":\"tool\",\"tool\":\"bash\",\"state\":{\"status\":\"completed\"}}}\n",
            "{\"type\":\"text\",\"timestamp\":3,\"sessionID\":\"ses_a\",\"part\":{\"type\":\"text\",\"text\":\"feat(history): generate message\"}}\n",
            "{\"type\":\"step_finish\",\"timestamp\":4,\"sessionID\":\"ses_a\",\"part\":{\"type\":\"step-finish\"}}\n",
        );
        assert_eq!(
            opencode_text(stream).unwrap(),
            "feat(history): generate message"
        );
    }

    #[test]
    fn codex_keeps_only_the_answer() {
        let output = concat!(
            "OpenAI Codex v0.153.2\n--------\nworkdir: /tmp/x\n--------\n",
            "user\nWrite the commit message.\ncodex\n\n",
            "warning: Ignoring unknown features requirement ultrafast_mode\n",
            "codex\nfix(sheets): reserve spacing in workflow steps layout\n",
            "tokens used\n22,129\n",
        );
        assert_eq!(
            codex_text(output).unwrap(),
            "fix(sheets): reserve spacing in workflow steps layout"
        );
        assert_eq!(codex_text("feat(x): plain").unwrap(), "feat(x): plain");
        assert!(codex_text("codex\ntokens used\n1\n").is_err());
    }

    #[test]
    fn opencode_errors_say_why() {
        let stream = "{\"type\":\"error\",\"timestamp\":1,\"sessionID\":\"ses_a\",\"error\":{\"name\":\"ProviderError\",\"data\":{\"message\":\"no auth\"}}}\n";
        let err = opencode_text(stream).unwrap_err();
        assert!(err.to_string().contains("no auth"), "{err:?}");
        let err = opencode_text("").unwrap_err();
        assert!(err.to_string().contains("no message"), "{err:?}");
    }
}
