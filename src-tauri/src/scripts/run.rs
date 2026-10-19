//! Running the user's scripts (SPEC §14 "Running"): `$SHELL -l -c <command>` in the branch's
//! worktree or repository folder, with the branch in `GITGEL_*` variables, in a pty. Output is
//! kept per run (2 MB), streamed as `script-output`, and the end is `script-exited`, after which
//! the repo is rescanned.
//!
//! User scripts are started here, and Gitgel's own git actions (`super::git`, SPEC §0) through
//! `launch`.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::config;
use crate::error::AppError;
use crate::git::{refs, worktrees};
use crate::model::{
    entry_key, CommandVar, EntryRef, ScriptConfig, ScriptFolder, ScriptOutputChunk, ScriptRun,
    ScriptRunStatus, UpdateReason,
};
use crate::scan;
use crate::state::{lock, AppState};

pub const SCRIPT_OUTPUT: &str = "script-output";
pub const SCRIPT_EXITED: &str = "script-exited";
/// ssh asked for a key's passphrase in a run (SPEC §15 "SSH passphrase").
pub const SSH_PASSPHRASE: &str = "ssh-passphrase";

/// Output kept per run; the oldest is dropped past it.
const MAX_OUTPUT: usize = 2 * 1024 * 1024;
/// Finished runs kept for their output panel; the oldest go first.
const KEEP_FINISHED: usize = 20;
/// Stop sends SIGINT, then SIGKILL after this.
const STOP_GRACE: Duration = Duration::from_secs(3);
/// After the process ends, how long its output may still arrive (a background child can keep
/// the pty open).
const DRAIN: Duration = Duration::from_secs(1);

#[derive(Default)]
pub struct Runs {
    runs: HashMap<String, Run>,
    finished: VecDeque<String>,
}

struct Run {
    info: ScriptRun,
    output: String,
    /// Process (and process group) id while running.
    pid: Option<u32>,
    /// What the user types goes here.
    writer: Option<Box<dyn Write + Send>>,
    /// The pty, kept open until the run ends; resized with the panel.
    master: Option<Box<dyn MasterPty + Send>>,
    /// Bytes of output so far, dropped ones included.
    written: u64,
    started: Instant,
    /// Repositories rescanned when it ends besides `info.repo_id` (a git action over several).
    also_rescan: Vec<String>,
    /// Temporary files removed when it ends (a git action's index copies).
    cleanup: Vec<PathBuf>,
    /// `written` when the last passphrase prompt was reported, so each is reported once.
    asked_at: u64,
}

/// A run to start: what its toast and panel show, and the command.
pub(crate) struct Launch {
    pub script_id: String,
    pub name: String,
    pub icon: String,
    pub entry_key: String,
    pub repo_label: String,
    pub repo_id: String,
    pub also_rescan: Vec<String>,
    pub folder: PathBuf,
    pub command: String,
    pub env: Vec<(String, String)>,
    pub cleanup: Vec<PathBuf>,
}

/// What the menu knows about the branch besides the entry itself.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RunContext {
    /// The base in use, as the menu shows it.
    pub base: Option<String>,
    /// The project, when run from a Project entry menu.
    pub project: Option<String>,
}

/// Everything a run needs, resolved from the config and the repository.
struct Prepared {
    name: String,
    folder: PathBuf,
    repo_id: String,
    repo_label: String,
    entry_key: String,
    env: Vec<(String, String)>,
}

fn shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
}

/// `{branch}`, `{base}` and `{repo}` in a script's name.
pub fn fill_name(name: &str, branch: &str, base: &str, repo: &str) -> String {
    name.replace("{branch}", branch)
        .replace("{base}", base)
        .replace("{repo}", repo)
}

fn prepare(
    state: &AppState,
    script: &ScriptConfig,
    entry: &EntryRef,
    inputs: &BTreeMap<String, String>,
    ctx: &RunContext,
) -> Result<Prepared, AppError> {
    super::validate(script)?;
    let config = config::snapshot(state);
    let repo_cfg = config
        .repos
        .iter()
        .find(|r| r.id == entry.repo_id)
        .ok_or_else(|| AppError::NotFound(format!("repository {}", entry.repo_id)))?;
    let shared = state.pool.get(Path::new(&repo_cfg.path))?;
    let repo = lock(&shared);
    let trees = worktrees::list_worktrees(&state.pool, &repo)?;
    let wanted = entry
        .worktree_path
        .as_deref()
        .and_then(|p| Path::new(p).canonicalize().ok());
    let tree = trees.iter().find(|w| match &entry.branch {
        Some(b) => w.branch.as_deref() == Some(b.as_str()),
        None => Some(&w.path) == wanted.as_ref(),
    });
    let head = match (tree, &entry.branch) {
        (Some(t), _) => t.head.clone(),
        (None, Some(b)) => {
            refs::resolve_commit(&repo, &format!("refs/heads/{b}")).unwrap_or_default()
        }
        (None, None) => String::new(),
    };
    let main = trees
        .iter()
        .find(|w| w.name.is_none())
        .map(|w| w.path.clone())
        .unwrap_or_else(|| PathBuf::from(&repo_cfg.path));
    drop(repo);

    let branch = entry.branch.clone().unwrap_or_default();
    let repo_name = Path::new(&repo_cfg.path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let label_branch = if branch.is_empty() {
        head.chars().take(7).collect()
    } else {
        branch.clone()
    };
    let folder = match script.runs_in {
        ScriptFolder::Repo => main.clone(),
        ScriptFolder::Worktree => tree.map(|t| t.path.clone()).ok_or_else(|| {
            AppError::Invalid(format!(
                "{label_branch} is not checked out, so “{}” cannot run in its worktree",
                script.name
            ))
        })?,
    };
    let base = ctx.base.clone().unwrap_or_default();
    let mut env = vec![
        ("GITGEL_BRANCH".to_string(), branch.clone()),
        ("GITGEL_BASE".to_string(), base.clone()),
        (
            "GITGEL_WORKTREE".to_string(),
            tree.map(|t| t.path.to_string_lossy().into_owned())
                .unwrap_or_default(),
        ),
        (
            "GITGEL_REPO".to_string(),
            main.to_string_lossy().into_owned(),
        ),
        ("GITGEL_REPO_NAME".to_string(), repo_name.clone()),
        ("GITGEL_HEAD".to_string(), head),
    ];
    if let Some(project) = &ctx.project {
        env.push(("GITGEL_PROJECT".to_string(), project.clone()));
    }
    // Only the inputs the dialog showed are sent; hidden ones are not set at all.
    for input in &script.inputs {
        if let Some(value) = inputs.get(&input.id) {
            env.push((format!("GITGEL_INPUT_{}", input.id), value.clone()));
        }
    }
    Ok(Prepared {
        name: fill_name(&script.name, &label_branch, &base, &repo_name),
        folder,
        repo_id: entry.repo_id.clone(),
        repo_label: format!("{repo_name} / {label_branch}"),
        entry_key: entry_key(
            &entry.repo_id,
            entry.branch.as_deref(),
            entry.worktree_path.as_deref(),
        ),
        env,
    })
}

/// Starts a script for an entry. A script already running for that entry is not started again;
/// its run is returned. A process that cannot start gives a `failed` run.
pub fn run_script(
    state: &AppState,
    script: ScriptConfig,
    entry: EntryRef,
    inputs: BTreeMap<String, String>,
    ctx: RunContext,
) -> Result<ScriptRun, AppError> {
    let p = prepare(state, &script, &entry, &inputs, &ctx)?;
    if !script.id.is_empty() {
        let runs = lock(&state.runs);
        let same = runs.runs.values().find(|r| {
            r.info.status == ScriptRunStatus::Running
                && r.info.script_id == script.id
                && r.info.entry_key == p.entry_key
        });
        if let Some(r) = same {
            return Ok(r.info.clone());
        }
    }

    launch(
        state,
        Launch {
            script_id: script.id.clone(),
            name: p.name,
            icon: script.icon.clone(),
            entry_key: p.entry_key,
            repo_label: p.repo_label,
            repo_id: p.repo_id,
            also_rescan: Vec::new(),
            folder: p.folder,
            command: script.command.clone(),
            env: p.env,
            cleanup: Vec::new(),
        },
    )
}

/// Starts a command in a pty and records its run. A process that cannot start gives a `failed`
/// run.
pub(crate) fn launch(state: &AppState, l: Launch) -> Result<ScriptRun, AppError> {
    let info = ScriptRun {
        run_id: config::new_id("run"),
        script_id: l.script_id,
        name: l.name.clone(),
        icon: l.icon,
        entry_key: l.entry_key,
        repo_label: l.repo_label.clone(),
        repo_id: l.repo_id,
        folder: l.folder.to_string_lossy().into_owned(),
        command: l.command.clone(),
        command_vars: command_vars(&l.command, &l.env),
        status: ScriptRunStatus::Running,
        exit_code: None,
        signal: None,
        stopped: false,
        started_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        ended_at: None,
        last_line: String::new(),
        buffered: None,
        buffered_end: None,
    };
    let run_id = info.run_id.clone();
    lock(&state.runs).runs.insert(
        run_id.clone(),
        Run {
            info: info.clone(),
            output: String::new(),
            pid: None,
            writer: None,
            master: None,
            written: 0,
            started: Instant::now(),
            also_rescan: l.also_rescan,
            cleanup: l.cleanup,
            asked_at: 0,
        },
    );
    log::info!("script “{}” started in {}", l.name, l.repo_label);
    let started = spawn_pty(&l.command, &l.folder, &l.env, events(state, &run_id)).map(
        |(pid, writer, master)| {
            if let Some(run) = lock(&state.runs).runs.get_mut(&run_id) {
                run.pid = pid;
                run.writer = Some(writer);
                run.master = Some(master);
            }
        },
    );
    if let Err(e) = started {
        log::warn!("script “{}” could not start: {e}", l.name);
        finish(state, &run_id, Ended::Failed(e.to_string()));
    }
    get_run(state, &run_id).map(|r| ScriptRun {
        buffered: None,
        buffered_end: None,
        ..r
    })
}

// ---- Starting ----

/// A run's output as text to parse: escapes stripped, the pty's `\r\n` back to `\n`.
pub(crate) fn clean_output(text: &str) -> String {
    strip_escapes(text).replace("\r\n", "\n").trim().to_string()
}

/// The env vars the command names (`$VAR` / `${VAR}`) with their values, for the output
/// panel's hover. Display only: the panel's tokenizer decides which ones it marks (not in
/// single quotes, not after `\`), so a name that also shows up there just goes unused.
pub(crate) fn command_vars(command: &str, env: &[(String, String)]) -> Vec<CommandVar> {
    let named = |name: &str| {
        let plain = format!("${name}");
        command.match_indices(&plain).any(|(i, _)| {
            !command[i + plain.len()..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
        }) || command.contains(&format!("${{{name}}}"))
    };
    env.iter()
        .filter(|(name, _)| named(name))
        .map(|(name, value)| CommandVar {
            name: name.clone(),
            value: value.clone(),
        })
        .collect()
}

/// Runs a fixed read-only command in a pty and returns its output; no run is recorded.
/// Past `timeout` the process group is killed and the probe is an error.
pub(crate) fn probe(
    command: &str,
    env: &[(String, String)],
    timeout: Duration,
) -> Result<String, AppError> {
    let (tx, rx) = mpsc::channel();
    let out = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let sink = out.clone();
    let done = std::sync::Mutex::new(tx);
    let on: OnEvent = std::sync::Arc::new(move |event| match event {
        Event::Output(text) => {
            sink.lock().unwrap().push_str(&text);
        }
        Event::Ended(ended) => {
            let _ = done.lock().unwrap().send(ended);
        }
    });
    // The writer and the pty stay alive until the run ends; dropping them would hang it up.
    let spawned = spawn_pty(command, &std::env::temp_dir(), env, on)?;
    let pid = spawned.0;
    let _keep = spawned;
    match rx.recv_timeout(timeout) {
        Ok(_) => Ok(clean_output(&out.lock().unwrap())),
        Err(_) => {
            if let Some(pid) = pid {
                signal_group(pid, libc::SIGKILL);
            }
            Err(AppError::Invalid("The check took too long.".into()))
        }
    }
}

/// What a started process reports, in order: output, then one end.
enum Event {
    Output(String),
    Ended(Ended),
}

type OnEvent = std::sync::Arc<dyn Fn(Event) + Send + Sync>;

/// Events of one run, into the run's record and `script-output`.
fn events(state: &AppState, run_id: &str) -> OnEvent {
    let (state, run_id) = (state.clone(), run_id.to_string());
    std::sync::Arc::new(move |event| match event {
        Event::Output(text) => append(&state, &run_id, &text),
        Event::Ended(ended) => {
            // Closing the pty lets any reader still waiting on it end.
            if let Some(run) = lock(&state.runs).runs.get_mut(&run_id) {
                run.writer = None;
                run.master = None;
            }
            finish(&state, &run_id, ended);
        }
    })
}

fn io_error(e: impl std::fmt::Display) -> AppError {
    AppError::Io(e.to_string())
}

type PtyParts = (
    Option<u32>,
    Box<dyn Write + Send>,
    Box<dyn MasterPty + Send>,
);

/// A script, in a pty (`TERM=xterm-256color`). The child is a session leader (setsid), so
/// its pid is also its process group. Returns the pid, the writer for typed input and the pty.
fn spawn_pty(
    command: &str,
    folder: &Path,
    env: &[(String, String)],
    on: OnEvent,
) -> Result<PtyParts, AppError> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(io_error)?;
    let mut cmd = CommandBuilder::new(shell());
    cmd.args(["-l", "-c", command]);
    cmd.cwd(folder);
    cmd.env("TERM", "xterm-256color");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(io_error)?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(io_error)?;
    let writer = pair.master.take_writer().map_err(io_error)?;
    let pid = child.process_id();
    let (tx, rx) = mpsc::channel();
    spawn_reader(reader, on.clone(), tx);
    std::thread::spawn(move || {
        let ended = match child.wait() {
            Ok(status) => Ended::Exited(
                status
                    .signal()
                    .is_none()
                    .then(|| i32::try_from(status.exit_code()).unwrap_or(i32::MAX)),
                status.signal().map(pty_signal_name),
            ),
            Err(e) => Ended::Failed(e.to_string()),
        };
        // Output may still arrive after the process ends (a background child keeps the pty open).
        let _ = rx.recv_timeout(DRAIN);
        on(Event::Ended(ended));
    });
    Ok((pid, writer, pair.master))
}

/// Reads a stream until it ends, reporting its text. UTF-8 split across reads is kept whole.
fn spawn_reader(mut stream: Box<dyn Read + Send>, on: OnEvent, done: mpsc::Sender<()>) {
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        while let Ok(n) = stream.read(&mut chunk) {
            if n == 0 {
                break;
            }
            pending.extend_from_slice(&chunk[..n]);
            let text = take_utf8(&mut pending);
            if !text.is_empty() {
                on(Event::Output(text));
            }
        }
        if !pending.is_empty() {
            on(Event::Output(
                String::from_utf8_lossy(&pending).into_owned(),
            ));
        }
        let _ = done.send(());
    });
}

/// The complete UTF-8 text at the front of `pending`; an incomplete character stays.
fn take_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let text = s.to_string();
            pending.clear();
            text
        }
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
            pending.drain(..valid);
            text
        }
        Err(_) => {
            let text = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            text
        }
    }
}

fn append(state: &AppState, run_id: &str, text: &str) {
    let end = {
        let mut runs = lock(&state.runs);
        let Some(run) = runs.runs.get_mut(run_id) else {
            return;
        };
        run.output.push_str(text);
        run.written += text.len() as u64;
        if run.output.len() > MAX_OUTPUT {
            let mut cut = run.output.len() - MAX_OUTPUT;
            while !run.output.is_char_boundary(cut) {
                cut += 1;
            }
            run.output.drain(..cut);
        }
        if let Some(line) = last_line(text) {
            run.info.last_line = line;
        }
        // A prompt may arrive split across reads: look at the end of the whole output.
        let asked = passphrase_prompt(&run.output)
            .filter(|(at, _)| run.written - (run.output.len() - at) as u64 >= run.asked_at);
        let asked = asked.map(|(_, key)| {
            run.asked_at = run.written;
            key
        });
        (run.written, asked)
    };
    let (end, asked) = end;
    let chunk = ScriptOutputChunk {
        run_id: run_id.to_string(),
        data: text.to_string(),
        end,
    };
    if let Err(e) = state.app.emit(SCRIPT_OUTPUT, chunk) {
        log::warn!("cannot emit {SCRIPT_OUTPUT}: {e}");
    }
    if let Some(key) = asked {
        log::info!("run {run_id}: ssh asks for a passphrase");
        let payload = SshPassphrase {
            run_id: run_id.to_string(),
            key,
        };
        if let Err(e) = state.app.emit(SSH_PASSPHRASE, payload) {
            log::warn!("cannot emit {SSH_PASSPHRASE}: {e}");
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SshPassphrase {
    run_id: String,
    key: String,
}

/// ssh's `Enter passphrase for key '<path>': ` at the very end of `output` (nothing but spaces
/// after it): where it starts and the key's path.
pub fn passphrase_prompt(output: &str) -> Option<(usize, String)> {
    const ASK: &str = "Enter passphrase for key '";
    let at = output.rfind(ASK)?;
    let rest = &output[at + ASK.len()..];
    let end = rest.find("':")?;
    if !rest[end + 2..].trim().is_empty() {
        return None;
    }
    Some((at, rest[..end].to_string()))
}

/// The last non-empty line of `text`, without terminal escapes.
pub fn last_line(text: &str) -> Option<String> {
    strip_escapes(text)
        .split(['\n', '\r'])
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .map(str::to_string)
}

fn strip_escapes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            if !c.is_control() || c == '\n' || c == '\r' || c == '\t' {
                out.push(c);
            }
            continue;
        }
        match chars.next() {
            // CSI: parameters up to a final byte in @–~.
            Some('[') => {
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            // OSC: up to BEL or ESC \.
            Some(']') => {
                while let Some(c) = chars.next() {
                    if c == '\u{7}' {
                        break;
                    }
                    if c == '\u{1b}' {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// portable-pty describes a signal as "Interrupt: 2"; this gives "SIGINT".
fn pty_signal_name(described: &str) -> String {
    described
        .rsplit(": ")
        .next()
        .and_then(|n| n.parse().ok())
        .map_or_else(|| described.to_string(), signal_name)
}

fn signal_name(n: i32) -> String {
    match n {
        libc::SIGHUP => "SIGHUP".into(),
        libc::SIGINT => "SIGINT".into(),
        libc::SIGKILL => "SIGKILL".into(),
        libc::SIGTERM => "SIGTERM".into(),
        libc::SIGPIPE => "SIGPIPE".into(),
        _ => format!("signal {n}"),
    }
}

// ---- Ending ----

enum Ended {
    /// Exit code (none when a signal ended it) and signal.
    Exited(Option<i32>, Option<String>),
    /// Could not start, or could not be waited for.
    Failed(String),
}

fn finish(state: &AppState, run_id: &str, ended: Ended) {
    let (info, also_rescan) = {
        let mut guard = lock(&state.runs);
        let runs = &mut *guard;
        let Some(run) = runs.runs.get_mut(run_id) else {
            return;
        };
        match ended {
            Ended::Exited(code, signal) => {
                run.info.status = ScriptRunStatus::Exited;
                run.info.exit_code = code;
                run.info.signal = signal;
            }
            Ended::Failed(message) => {
                run.info.status = ScriptRunStatus::Failed;
                run.info.last_line = message;
            }
        }
        run.info.ended_at =
            Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        run.pid = None;
        run.writer = None;
        run.master = None;
        log::info!(
            "script “{}” in {}: {} after {:.1}s",
            run.info.name,
            run.info.repo_label,
            match (&run.info.status, run.info.exit_code, &run.info.signal) {
                (ScriptRunStatus::Failed, _, _) => "could not start".to_string(),
                (_, Some(code), _) => format!("exit {code}"),
                (_, None, Some(signal)) => signal.clone(),
                _ => "ended".to_string(),
            },
            run.started.elapsed().as_secs_f64()
        );
        let info = run.info.clone();
        let also_rescan = std::mem::take(&mut run.also_rescan);
        for file in std::mem::take(&mut run.cleanup) {
            let _ = std::fs::remove_file(file);
        }
        runs.finished.push_back(run_id.to_string());
        while runs.finished.len() > KEEP_FINISHED {
            if let Some(old) = runs.finished.pop_front() {
                runs.runs.remove(&old);
            }
        }
        (info, also_rescan)
    };
    if let Err(e) = state.app.emit(SCRIPT_EXITED, &info) {
        log::warn!("cannot emit {SCRIPT_EXITED}: {e}");
    }
    // The script may have committed, rebased or pushed (SPEC §14 "Decisions"); a message
    // generation (`ai:…`) never writes, so it rescans nothing.
    if info.status == ScriptRunStatus::Exited && !info.script_id.starts_with(crate::ai::AI_PREFIX) {
        let mut layout_changed = false;
        for repo_id in std::iter::once(&info.repo_id).chain(&also_rescan) {
            layout_changed |= scan::rescan_repo(state, repo_id, UpdateReason::Rescan, None);
        }
        // A worktree it added or removed is watched, or no longer, right away.
        if layout_changed {
            crate::watch::sync_watches(state);
        }
    }
}

// ---- While running ----

pub fn get_run(state: &AppState, run_id: &str) -> Result<ScriptRun, AppError> {
    let runs = lock(&state.runs);
    let run = runs
        .runs
        .get(run_id)
        .ok_or_else(|| AppError::NotFound(format!("script run {run_id}")))?;
    Ok(ScriptRun {
        buffered: Some(run.output.clone()),
        buffered_end: Some(run.written),
        ..run.info.clone()
    })
}

/// Sends typed text to a running script.
pub fn write_input(state: &AppState, run_id: &str, data: &str) -> Result<(), AppError> {
    let mut runs = lock(&state.runs);
    let writer = runs
        .runs
        .get_mut(run_id)
        .and_then(|r| r.writer.as_mut())
        .ok_or_else(|| AppError::NotFound(format!("running script {run_id}")))?;
    writer.write_all(data.as_bytes())?;
    writer.flush()?;
    Ok(())
}

/// SIGINT to the script's process group, SIGKILL if it is still running after `STOP_GRACE`.
pub fn stop(state: &AppState, run_id: &str) -> Result<(), AppError> {
    let pid = {
        let mut runs = lock(&state.runs);
        let run = runs
            .runs
            .get_mut(run_id)
            .ok_or_else(|| AppError::NotFound(format!("script run {run_id}")))?;
        run.info.stopped = true;
        run.pid
    };
    let Some(pid) = pid else {
        return Ok(());
    };
    signal_group(pid, libc::SIGINT);
    let (state, run_id) = (state.clone(), run_id.to_string());
    std::thread::spawn(move || {
        std::thread::sleep(STOP_GRACE);
        let still = lock(&state.runs)
            .runs
            .get(&run_id)
            .and_then(|r| r.pid)
            .is_some();
        if still {
            signal_group(pid, libc::SIGKILL);
        }
    });
    Ok(())
}

fn signal_group(pid: u32, signal: i32) {
    if let Ok(pid) = i32::try_from(pid) {
        // SAFETY: kill(2) with a negative pid signals that process group; no memory is touched.
        if unsafe { libc::kill(-pid, signal) } != 0 {
            log::warn!(
                "cannot signal script {pid}: {}",
                std::io::Error::last_os_error()
            );
        }
    }
}

/// The output panel's size, so the pty wraps lines as the panel shows them.
pub fn resize(state: &AppState, run_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
    let runs = lock(&state.runs);
    if let Some(master) = runs.runs.get(run_id).and_then(|r| r.master.as_ref()) {
        master
            .resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(io_error)?;
    }
    Ok(())
}

/// A running git action (`script_id` `git:…`) in this repository, by name.
pub(super) fn git_action_running(state: &AppState, repo_id: &str) -> bool {
    lock(&state.runs).runs.values().any(|r| {
        r.info.status == ScriptRunStatus::Running
            && r.info.script_id.starts_with(super::git::ACTION_PREFIX)
            && (r.info.repo_id == repo_id || r.also_rescan.iter().any(|id| id == repo_id))
    })
}

pub fn running_count(state: &AppState) -> usize {
    lock(&state.runs)
        .runs
        .values()
        .filter(|r| r.info.status == ScriptRunStatus::Running)
        .count()
}

/// Quitting: every running script's process group gets SIGKILL.
fn stop_all(state: &AppState) {
    let pids: Vec<u32> = lock(&state.runs)
        .runs
        .values()
        .filter_map(|r| r.pid)
        .collect();
    for pid in pids {
        signal_group(pid, libc::SIGKILL);
    }
}

/// Window close or ⌘Q with scripts running: asks first, then quits and stops them.
pub fn confirm_quit(app: &AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    let n = running_count(&state);
    let handle = app.clone();
    app.dialog()
        .message("Quitting stops them.")
        .title(if n == 1 {
            "1 script is running. Quit anyway?".to_string()
        } else {
            format!("{n} scripts are running. Quit anyway?")
        })
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".into(),
            "Cancel".into(),
        ))
        .show(move |quit| {
            if quit {
                stop_all(&state);
                handle.exit(0);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_filled_in() {
        assert_eq!(
            fill_name(
                "Rebase on {base}… ({repo}/{branch})",
                "feat/x",
                "main",
                "web-app"
            ),
            "Rebase on main… (web-app/feat/x)"
        );
    }

    #[test]
    fn passphrase_prompt_only_at_the_end() {
        let key = "/Users/me/.ssh/id_ed25519";
        let asked = format!("Fetching origin\r\nEnter passphrase for key '{key}': ");
        assert_eq!(passphrase_prompt(&asked), Some((17, key.to_string())));
        // Answered: more output after it.
        assert_eq!(
            passphrase_prompt(&format!("{asked}\r\nremote: Counting objects")),
            None
        );
        // Still arriving.
        assert_eq!(
            passphrase_prompt("Enter passphrase for key '/Users/me/.ss"),
            None
        );
        assert_eq!(passphrase_prompt("no prompt here"), None);
    }

    #[test]
    fn command_vars_are_the_named_env_vars() {
        let var = |name: &str, value: &str| CommandVar {
            name: name.into(),
            value: value.into(),
        };
        let env = vec![
            ("GITGEL_BRANCH".to_string(), "feat/x".to_string()),
            ("GITGEL_PATH_1".to_string(), "a".to_string()),
            ("GITGEL_PATH_10".to_string(), "j".to_string()),
            ("GITGEL_MESSAGE".to_string(), "do it".to_string()),
            ("GIT_LITERAL_PATHSPECS".to_string(), "1".to_string()),
        ];
        assert_eq!(
            command_vars(
                "git checkout ${GITGEL_BRANCH} -m \"$GITGEL_MESSAGE\" -- \"$GITGEL_PATH_10\"",
                &env
            ),
            vec![
                var("GITGEL_BRANCH", "feat/x"),
                var("GITGEL_PATH_10", "j"),
                var("GITGEL_MESSAGE", "do it"),
            ]
        );
    }

    #[test]
    fn last_line_skips_escapes_and_blank_lines() {
        assert_eq!(last_line("a\nb\n\n").as_deref(), Some("b"));
        assert_eq!(
            last_line("\u{1b}[32m ✓ 35 passed\u{1b}[0m\r\n").as_deref(),
            Some("✓ 35 passed")
        );
        assert_eq!(
            last_line("\u{1b}]0;title\u{7}done").as_deref(),
            Some("done")
        );
        assert_eq!(last_line("  \n\r\n"), None);
    }

    #[test]
    fn utf8_split_across_reads_is_kept_whole() {
        // "ç" is c3 a7; a read that ends after c3 keeps it for the next one.
        let mut pending = vec![b'a', 0xc3];
        assert_eq!(take_utf8(&mut pending), "a");
        assert_eq!(pending, [0xc3]);
        pending.push(0xa7);
        assert_eq!(take_utf8(&mut pending), "ç");
        assert!(pending.is_empty());
    }

    /// Runs `spawn` and collects its output until it ends.
    fn collect(
        spawn: impl FnOnce(OnEvent) -> Option<u32>,
        while_running: impl FnOnce(Option<u32>),
    ) -> (String, Ended) {
        let (tx, rx) = mpsc::channel();
        let out = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let sink = out.clone();
        let tx = std::sync::Mutex::new(tx);
        let pid = spawn(std::sync::Arc::new(move |event| match event {
            Event::Output(text) => sink.lock().unwrap().push_str(&text),
            Event::Ended(e) => {
                let _ = tx.lock().unwrap().send(e);
            }
        }));
        while_running(pid);
        let ended = rx
            .recv_timeout(Duration::from_secs(20))
            .expect("script ended");
        let text = out.lock().unwrap().clone();
        (text, ended)
    }

    fn pty(command: &str, env: &[(&str, &str)]) -> (String, Ended) {
        let dir = tempfile::TempDir::new().unwrap();
        pty_in(dir.path(), command, env)
    }

    fn pty_in(dir: &Path, command: &str, env: &[(&str, &str)]) -> (String, Ended) {
        let env: Vec<(String, String)> = env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let parts = std::cell::RefCell::new(None);
        let result = collect(
            |on| {
                let (pid, writer, master) = spawn_pty(command, dir, &env, on).unwrap();
                *parts.borrow_mut() = Some((writer, master));
                pid
            },
            |_| {},
        );
        drop(parts);
        result
    }

    /// The git actions' commands, through the user's shell and real git (SPEC §15).
    #[test]
    fn git_actions_stash_apply_and_drop() {
        use crate::git::testutil::TestRepo;
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 1);
        t.checkout_main();
        t.write_file(t.path(), "a.txt", b"changed\n");
        t.write_file(t.path(), "new.txt", b"new\n");
        let folder = t.path().to_string_lossy().into_owned();
        let message = "before $(echo hacked) 'it' \"q\"";

        let step = super::super::git::PushStep {
            untracked: true,
            paths: 0,
            unstage: 0,
        };
        let (out, ended) = pty(
            &super::super::git::push_command(&[step], true),
            &[("GITGEL_FOLDER_1", &folder), ("GITGEL_MESSAGE", message)],
        );
        assert!(matches!(ended, Ended::Exited(Some(0), None)), "{out}");
        let stack = crate::git::stash::list(&t.repo).unwrap();
        assert_eq!(stack.len(), 1);
        assert_eq!(stack[0].message, message);
        assert!(!t.path().join("new.txt").exists());

        let (out, ended) = pty_in(
            t.path(),
            "git stash apply 'stash@{0}'",
            &[("GIT_PAGER", "cat")],
        );
        assert!(matches!(ended, Ended::Exited(Some(0), None)), "{out}");
        assert_eq!(std::fs::read(t.path().join("a.txt")).unwrap(), b"changed\n");
        assert!(t.path().join("new.txt").exists());

        let (out, ended) = pty_in(t.path(), "git stash drop 'stash@{0}'", &[]);
        assert!(matches!(ended, Ended::Exited(Some(0), None)), "{out}");
        assert!(crate::git::stash::list(&t.repo).unwrap().is_empty());
    }

    /// Stash changes with files picked: only those go, literally (SPEC §15).
    #[test]
    fn git_action_stashes_picked_files_only() {
        use crate::git::testutil::TestRepo;
        let t = TestRepo::new();
        t.commit_on(
            "main",
            &[("a.txt", Some(b"a\n")), ("b*.txt", Some(b"b\n"))],
            "base",
            1,
        );
        t.checkout_main();
        t.write_file(t.path(), "a.txt", b"A\n");
        t.write_file(t.path(), "b*.txt", b"B\n");
        t.write_file(t.path(), "new.txt", b"new\n");
        t.write_file(t.path(), "keep.txt", b"keep\n");
        let folder = t.path().to_string_lossy().into_owned();
        let step = super::super::git::PushStep {
            untracked: true,
            paths: 2,
            unstage: 0,
        };
        let (out, ended) = pty(
            &super::super::git::push_command(&[step], false),
            &[
                ("GITGEL_FOLDER_1", &folder),
                ("GITGEL_PATH_1_1", "b*.txt"),
                ("GITGEL_PATH_1_2", "new.txt"),
                ("GIT_LITERAL_PATHSPECS", "1"),
            ],
        );
        assert!(matches!(ended, Ended::Exited(Some(0), None)), "{out}");
        let read = |p: &str| std::fs::read(t.path().join(p)).ok();
        assert_eq!(read("b*.txt").as_deref(), Some(&b"b\n"[..]));
        assert_eq!(read("new.txt"), None);
        assert_eq!(read("a.txt").as_deref(), Some(&b"A\n"[..]));
        assert_eq!(read("keep.txt").as_deref(), Some(&b"keep\n"[..]));
        assert_eq!(crate::git::stash::list(&t.repo).unwrap().len(), 1);
    }

    /// Discard (SPEC §15): picked files go back to HEAD, staged parts too, a staged new file and
    /// an untracked one are removed; the rest stays.
    #[test]
    fn git_action_discards_picked_files_only() {
        use crate::git::testutil::TestRepo;
        let t = TestRepo::new();
        t.commit_on(
            "main",
            &[("a.txt", Some(b"a\n")), ("b*.txt", Some(b"b\n"))],
            "base",
            1,
        );
        t.checkout_main();
        t.write_file(t.path(), "a.txt", b"staged\n");
        t.stage(t.path(), "a.txt");
        t.write_file(t.path(), "a.txt", b"staged and more\n");
        t.write_file(t.path(), "b*.txt", b"keep\n");
        t.write_file(t.path(), "added.txt", b"added\n");
        t.stage(t.path(), "added.txt");
        t.write_file(t.path(), "new.txt", b"new\n");
        let folder = t.path().to_string_lossy().into_owned();
        let step = super::super::git::DiscardStep {
            restore: 2,
            keep: 0,
            clean: 1,
        };
        let (out, ended) = pty(
            &super::super::git::discard_command(&[step]),
            &[
                ("GITGEL_FOLDER_1", &folder),
                ("GITGEL_PATH_1_1", "a.txt"),
                ("GITGEL_PATH_1_2", "added.txt"),
                ("GITGEL_CLEAN_1_1", "new.txt"),
                ("GIT_LITERAL_PATHSPECS", "1"),
            ],
        );
        assert!(matches!(ended, Ended::Exited(Some(0), None)), "{out}");
        let read = |p: &str| std::fs::read(t.path().join(p)).ok();
        assert_eq!(read("a.txt").as_deref(), Some(&b"a\n"[..]));
        assert_eq!(read("added.txt"), None);
        assert_eq!(read("new.txt"), None);
        assert_eq!(read("b*.txt").as_deref(), Some(&b"keep\n"[..]));
        let (staged, _) = crate::git::worktrees::staged(&t.repo).unwrap();
        assert!(staged.is_empty(), "{staged:?}");
    }

    /// A stash apply that conflicts leaves the file unmerged: it is listed as `C` (SPEC §15).
    #[test]
    fn conflicted_files_are_listed_as_conflicts() {
        use crate::git::testutil::TestRepo;
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 2);
        t.checkout_main();
        t.write_file(t.path(), "a.txt", b"stashed\n");
        t.stash(false, "change");
        t.commit_on("main", &[("a.txt", Some(b"committed\n"))], "move on", 1);
        t.checkout_main();
        let (out, ended) = pty_in(
            t.path(),
            "git stash apply 'stash@{0}'",
            &[("GIT_PAGER", "cat")],
        );
        assert!(matches!(ended, Ended::Exited(Some(1), None)), "{out}");
        let list = crate::git::diff::uncommitted(&t.repo).unwrap();
        let kinds: Vec<_> = list.iter().map(|f| (f.path.as_str(), f.kind)).collect();
        assert_eq!(kinds, [("a.txt", crate::model::FileKind::C)]);
        // History's sections: unstaged only, against HEAD.
        let split = crate::git::diff::index_changes(&t.repo).unwrap();
        assert!(split.staged.is_empty(), "{:?}", split.staged);
        assert_eq!(split.unstaged, list);
    }

    /// Stage / Unstage (History's sections): whole files into the index and out of it.
    #[test]
    fn git_action_stages_and_unstages_whole_files() {
        use crate::git::testutil::TestRepo;
        let t = TestRepo::new();
        t.commit_on(
            "main",
            &[("a.txt", Some(b"a\n")), ("b*.txt", Some(b"b\n"))],
            "base",
            1,
        );
        t.checkout_main();
        t.write_file(t.path(), "a.txt", b"a2\n");
        t.write_file(t.path(), "b*.txt", b"b2\n");
        t.stage(t.path(), "b*.txt");
        t.write_file(t.path(), "new.txt", b"new\n");
        let folder = t.path().to_string_lossy().into_owned();
        let shape = super::super::git::StageShape {
            stage: 2,
            unstage: 1,
            unborn: false,
        };
        let (out, ended) = pty(
            &super::super::git::stage_command(shape),
            &[
                ("GITGEL_FOLDER", &folder),
                ("GITGEL_STAGE_1", "a.txt"),
                ("GITGEL_STAGE_2", "new.txt"),
                ("GITGEL_UNSTAGE_1", "b*.txt"),
                ("GIT_LITERAL_PATHSPECS", "1"),
            ],
        );
        assert!(matches!(ended, Ended::Exited(Some(0), None)), "{out}");
        let split = crate::git::diff::index_changes(&t.repo).unwrap();
        let paths = |l: &[crate::model::FileChange]| {
            let mut p: Vec<String> = l.iter().map(|f| f.path.clone()).collect();
            p.sort();
            p
        };
        assert_eq!(paths(&split.staged), ["a.txt", "new.txt"]);
        assert_eq!(paths(&split.unstaged), ["b*.txt"]);
    }

    /// Picked lines (SPEC §15 "Stage"): the new staged version goes into the index, the working
    /// tree and the mode stay, and a name with spaces or quotes is no problem.
    #[test]
    fn git_action_stages_picked_lines() {
        use crate::git::testutil::TestRepo;
        let t = TestRepo::new();
        t.commit_on("main", &[("a b'\"$x.txt", Some(b"one\ntwo\n"))], "base", 1);
        t.checkout_main();
        t.write_file(t.path(), "a b'\"$x.txt", b"one\nONE\ntwo\nTWO\n");
        let dir = tempfile::TempDir::new().unwrap();
        let blob = dir.path().join("blob");
        std::fs::write(&blob, b"one\nONE\ntwo\n").unwrap();
        let folder = t.path().to_string_lossy().into_owned();
        let (out, ended) = pty(
            &super::super::git::stage_lines_command(),
            &[
                ("GITGEL_FOLDER", &folder),
                ("GITGEL_PATH", "a b'\"$x.txt"),
                ("GITGEL_MODE", "100644"),
                ("GITGEL_BLOB", &blob.to_string_lossy()),
            ],
        );
        assert!(matches!(ended, Ended::Exited(Some(0), None)), "{out}");
        let mut index = t.repo.index().unwrap();
        index.read(true).unwrap();
        let entry = index.get_path(Path::new("a b'\"$x.txt"), 0).unwrap();
        assert_eq!(entry.mode, 0o100644);
        let staged = t.repo.find_blob(entry.id).unwrap();
        assert_eq!(staged.content(), b"one\nONE\ntwo\n");
        assert_eq!(
            std::fs::read(t.path().join("a b'\"$x.txt")).unwrap(),
            b"one\nONE\ntwo\nTWO\n"
        );
    }

    /// Discard of an Unstaged row (SPEC §15): the file goes back to what is staged, not to HEAD.
    #[test]
    fn git_action_discards_back_to_the_index() {
        use crate::git::testutil::TestRepo;
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 1);
        t.checkout_main();
        t.write_file(t.path(), "a.txt", b"staged\n");
        t.stage(t.path(), "a.txt");
        t.write_file(t.path(), "a.txt", b"staged and later\n");
        let folder = t.path().to_string_lossy().into_owned();
        let step = super::super::git::DiscardStep {
            restore: 0,
            keep: 1,
            clean: 0,
        };
        let (out, ended) = pty(
            &super::super::git::discard_command(&[step]),
            &[
                ("GITGEL_FOLDER_1", &folder),
                ("GITGEL_KEEP_1_1", "a.txt"),
                ("GIT_LITERAL_PATHSPECS", "1"),
            ],
        );
        assert!(matches!(ended, Ended::Exited(Some(0), None)), "{out}");
        assert_eq!(std::fs::read(t.path().join("a.txt")).unwrap(), b"staged\n");
        let (staged, _) = crate::git::worktrees::staged(&t.repo).unwrap();
        assert_eq!(staged, ["a.txt"]);
    }

    /// Picked files while other files are staged: the stash holds the picked ones only, and the
    /// staged ones that were not picked stay staged (git alone would put them in the stash too).
    #[test]
    fn git_action_leaves_unpicked_staged_files_out() {
        use crate::git::testutil::TestRepo;
        let t = TestRepo::new();
        t.commit_on("main", &[("a.txt", Some(b"a\n"))], "base", 1);
        t.checkout_main();
        t.write_file(t.path(), "a.txt", b"A\n");
        t.write_file(t.path(), "kept.txt", b"kept\n");
        t.stage(t.path(), "kept.txt");
        t.write_file(t.path(), "picked.txt", b"picked\n");
        t.stage(t.path(), "picked.txt");
        let (_, index) = crate::git::worktrees::staged(&t.repo).unwrap();
        let dir = tempfile::TempDir::new().unwrap();
        let copy = dir.path().join("index");
        std::fs::copy(index, &copy).unwrap();
        let folder = t.path().to_string_lossy().into_owned();
        let step = super::super::git::PushStep {
            untracked: false,
            paths: 2,
            unstage: 1,
        };
        let (out, ended) = pty(
            &super::super::git::push_command(&[step], false),
            &[
                ("GITGEL_FOLDER_1", &folder),
                ("GITGEL_PATH_1_1", "a.txt"),
                ("GITGEL_PATH_1_2", "picked.txt"),
                ("GITGEL_UNSTAGE_1_1", "kept.txt"),
                ("GITGEL_INDEX_1", &copy.to_string_lossy()),
                ("GIT_LITERAL_PATHSPECS", "1"),
            ],
        );
        assert!(matches!(ended, Ended::Exited(Some(0), None)), "{out}");
        let stash = crate::git::stash::list(&t.repo).unwrap();
        let files: Vec<String> = crate::git::stash::changes(&t.repo, &stash[0].sha)
            .unwrap()
            .files
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert_eq!(files, ["a.txt", "picked.txt"]);
        let (still, _) = crate::git::worktrees::staged(&t.repo).unwrap();
        assert_eq!(still, ["kept.txt"]);
        assert!(!t.path().join("picked.txt").exists());
        assert_eq!(std::fs::read(t.path().join("a.txt")).unwrap(), b"a\n");
    }

    #[test]
    fn variables_reach_the_script_and_values_are_never_run() {
        let (out, ended) = pty(
            r#"printf '%s|%s' "$GITGEL_BRANCH" "$GITGEL_INPUT_TITLE""#,
            &[
                ("GITGEL_BRANCH", "feat/x"),
                ("GITGEL_INPUT_TITLE", "$(echo hacked); `id`"),
            ],
        );
        assert_eq!(out, "feat/x|$(echo hacked); `id`");
        assert!(matches!(ended, Ended::Exited(Some(0), None)));
    }

    #[test]
    fn exit_code_and_last_line() {
        let (out, ended) = pty("echo first; echo 'second' >&2; exit 3", &[]);
        assert!(out.contains("first") && out.contains("second"));
        assert!(matches!(ended, Ended::Exited(Some(3), None)));
    }

    #[test]
    fn stop_interrupts_the_process_group() {
        let dir = tempfile::TempDir::new().unwrap();
        let started = Instant::now();
        let parts = std::cell::RefCell::new(None);
        let (_, ended) = collect(
            |on| {
                let (pid, writer, master) =
                    spawn_pty("sleep 100; echo after", dir.path(), &[], on).unwrap();
                *parts.borrow_mut() = Some((writer, master));
                pid
            },
            |pid| {
                std::thread::sleep(Duration::from_millis(300));
                signal_group(pid.unwrap(), libc::SIGINT);
            },
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        // The shell either dies of SIGINT or exits 130; it never reaches `echo after`.
        assert!(
            matches!(
                ended,
                Ended::Exited(None, Some(ref s)) if s == "SIGINT"
            ) || matches!(ended, Ended::Exited(Some(130), None))
        );
    }

    #[test]
    fn scripts_run_in_a_terminal() {
        let dir = tempfile::TempDir::new().unwrap();
        let parts = std::cell::RefCell::new(None);
        let (out, ended) = collect(
            |on| {
                let command = r#"read answer; [ -t 0 ] && echo "tty:$answer:$TERM""#;
                let (pid, writer, master) = spawn_pty(command, dir.path(), &[], on).unwrap();
                *parts.borrow_mut() = Some((writer, master));
                pid
            },
            |_| {
                let mut parts = parts.borrow_mut();
                let writer = &mut parts.as_mut().unwrap().0;
                writer.write_all(b"yes\n").unwrap();
                writer.flush().unwrap();
            },
        );
        drop(parts);
        assert!(out.contains("tty:yes:xterm-256color"), "{out:?}");
        assert!(matches!(ended, Ended::Exited(Some(0), None)));
    }
    #[test]
    fn signals_have_names() {
        assert_eq!(signal_name(libc::SIGINT), "SIGINT");
        assert_eq!(signal_name(64), "signal 64");
        assert_eq!(pty_signal_name("Interrupt: 2"), "SIGINT");
        assert_eq!(pty_signal_name("odd"), "odd");
    }

    #[test]
    fn cleaned_output_has_no_escapes_or_returns() {
        assert_eq!(
            clean_output("\u{1b}[32mhello\u{1b}[0m\r\n\r\nworld  "),
            "hello\n\nworld"
        );
    }
}
