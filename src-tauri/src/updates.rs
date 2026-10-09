//! In-app updates (§12 "Updates"): looks for a newer build in the Homebrew tap's
//! `gitgel/latest.json` (tauri-plugin-updater; endpoint and public key in tauri.conf.json) and,
//! when asked, downloads it, checks its signature, replaces Gitgel.app and restarts. It only
//! talks to GitHub and only writes the app bundle; repositories are never touched.

use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::config;
use crate::error::AppError;
use crate::state::AppState;

/// Automatic checks run at launch and when the window gains focus, at most this often. Wall
/// time, so a Mac that slept overnight checks on the next focus.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// Managed state: the newest update found, and whether one is being installed.
#[derive(Default)]
pub struct Updates(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    last_check: Option<SystemTime>,
    /// The last `update-check` sent, for a Software Update window that opens after it.
    answer: Option<UpdateCheck>,
    update: Option<Update>,
    installing: bool,
}

/// What the frontend shows: payload of `update-available` (null when there is none).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// The feed's `notes`: CHANGELOG.md sections of the last versions, newest first.
    pub notes: Option<String>,
}

/// Payload of `update-check`: Gitgel › Check for Updates… as the Software Update window shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateCheck {
    Checking {
        current_version: String,
    },
    UpToDate {
        current_version: String,
    },
    Available {
        version: String,
        current_version: String,
        notes: Option<String>,
    },
    Failed {
        current_version: String,
        message: String,
    },
}

fn info(update: &Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
    }
}

fn inner(app: &AppHandle) -> std::sync::MutexGuard<'_, Inner> {
    crate::state::lock(&app.state::<Updates>().inner().0)
}

/// The update found by the last check, if any (`get_update`).
pub fn current(app: &AppHandle) -> Option<UpdateInfo> {
    inner(app).update.as_ref().map(info)
}

/// Checks in the background when Settings allows it and the last check is old enough.
pub fn check_if_due(app: &AppHandle) {
    if !config::snapshot(&app.state::<AppState>())
        .settings
        .check_updates
    {
        return;
    }
    {
        let mut inner = inner(app);
        let now = SystemTime::now();
        let due = inner.last_check.is_none_or(|t| {
            now.duration_since(t)
                .map_or(true, |elapsed| elapsed >= CHECK_EVERY)
        });
        if !due {
            return;
        }
        inner.last_check = Some(now);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = check(&app).await {
            log::warn!("update check failed: {e}");
        }
    });
}

/// Settings › Check for updates changed: turning it off hides a found update, turning it on
/// checks at once.
pub fn setting_changed(app: &AppHandle, on: bool) {
    {
        let mut inner = inner(app);
        inner.last_check = None;
        if !on && !inner.installing {
            inner.update = None;
        }
    }
    if on {
        check_if_due(app);
    } else {
        let _ = app.emit("update-available", None::<UpdateInfo>);
    }
}

fn send_check(app: &AppHandle, check: UpdateCheck) {
    inner(app).answer = Some(check.clone());
    let _ = app.emit("update-check", check);
}

/// What the Software Update window shows when it opens: the last `update-check`.
pub fn last_answer(app: &AppHandle) -> Option<UpdateCheck> {
    inner(app).answer.clone()
}

/// Gitgel › Check for Updates…: checks now, whatever the setting. The frontend's Software Update
/// window follows `update-check` and installs through `install_update`.
pub fn check_now(app: &AppHandle) {
    let current_version = app.package_info().version.to_string();
    send_check(
        app,
        UpdateCheck::Checking {
            current_version: current_version.clone(),
        },
    );
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let answer = match check(&app).await {
            Ok(Some(found)) => UpdateCheck::Available {
                version: found.version,
                current_version: found.current_version,
                notes: found.notes,
            },
            Ok(None) => UpdateCheck::UpToDate { current_version },
            Err(message) => UpdateCheck::Failed {
                current_version,
                message,
            },
        };
        send_check(&app, answer);
    });
}

/// Asks the endpoint for a newer version, keeps the answer and emits `update-available`.
async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let found = update.as_ref().map(info);
    match &found {
        Some(f) => log::info!("update check: {} available", f.version),
        None => log::info!("update check: up to date"),
    }
    {
        let mut inner = inner(app);
        // An install in progress keeps the update it started with.
        if inner.installing {
            return Ok(found);
        }
        inner.update = update;
    }
    let _ = app.emit("update-available", &found);
    Ok(found)
}

/// Starts the installed app through LaunchServices (`open -n`), as a launch from the Dock would,
/// so it comes to the front with its window focused; false when it could not, and the caller
/// falls back to `app.restart()`, which runs the binary itself and leaves it in the background.
// A `Command` exception (SPEC §0): it starts Gitgel itself and never runs git.
#[allow(clippy::disallowed_methods)]
fn relaunch() -> bool {
    let bundle = std::env::current_exe().ok().and_then(|exe| {
        exe.ancestors()
            .nth(3)
            .filter(|p| p.extension().is_some_and(|e| e == "app"))
            .map(|p| p.to_path_buf())
    });
    let Some(bundle) = bundle else { return false };
    match std::process::Command::new("/usr/bin/open")
        .arg("-n")
        .arg(&bundle)
        .status()
    {
        Ok(s) if s.success() => true,
        Ok(s) => {
            log::warn!("open {} exited with {s}", bundle.display());
            false
        }
        Err(e) => {
            log::warn!("cannot run open: {e}");
            false
        }
    }
}

/// Downloads the update found by the last check, replaces the app and restarts. Emits
/// `update-progress` (percent, or null while the size is unknown) as it downloads.
pub async fn install(app: AppHandle) -> Result<(), AppError> {
    // A dev build runs from target/, not from a bundle the updater could replace.
    if cfg!(debug_assertions) {
        return Err(AppError::Forbidden(
            "updates are installed only by release builds".into(),
        ));
    }
    let update = {
        let mut inner = inner(&app);
        if inner.installing {
            return Err(AppError::Forbidden(
                "an update is already installing".into(),
            ));
        }
        let update = inner
            .update
            .clone()
            .ok_or_else(|| AppError::NotFound("no update available".into()))?;
        inner.installing = true;
        update
    };
    log::info!("installing update {}", update.version);
    let _ = app.emit("update-progress", Some(0u32));
    let mut downloaded = 0u64;
    let mut last = Some(0u32);
    let result = update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let percent = total
                    .filter(|&t| t > 0)
                    .map(|t| (downloaded.saturating_mul(100) / t).min(100) as u32);
                if percent != last {
                    last = percent;
                    let _ = app.emit("update-progress", percent);
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(()) => {
            log::info!("update {} installed; restarting", update.version);
            if relaunch() {
                app.exit(0);
                return Ok(());
            }
            app.restart()
        }
        Err(e) => {
            inner(&app).installing = false;
            log::warn!("update {} failed: {e}", update.version);
            Err(AppError::Io(e.to_string()))
        }
    }
}
