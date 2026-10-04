//! In-app updates (§12 "Updates"): looks for a newer build in the Homebrew tap's
//! `gitgel/latest.json` (tauri-plugin-updater; endpoint and public key in tauri.conf.json) and,
//! when asked, downloads it, checks its signature, replaces Gitgel.app and restarts. It only
//! talks to GitHub and only writes the app bundle; repositories are never touched.

use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
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
    update: Option<Update>,
    installing: bool,
}

/// What the frontend shows: payload of `update-available` (null when there is none).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
}

fn info(update: &Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
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

/// Gitgel › Check for Updates…: checks now, whatever the setting, and answers in a dialog.
pub fn check_now(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match check(&app).await {
            Ok(Some(found)) => {
                let handle = app.clone();
                app.dialog()
                    .message(format!(
                        "Gitgel {} is available; you have {}. Gitgel restarts to finish the update.",
                        found.version, found.current_version
                    ))
                    .title("A new version of Gitgel is available")
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Update and Restart".into(),
                        "Later".into(),
                    ))
                    .show(move |ok| {
                        if ok {
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = install(handle.clone()).await {
                                    failed(&handle, "Cannot update Gitgel", &e.to_string());
                                }
                            });
                        }
                    });
            }
            Ok(None) => {
                app.dialog()
                    .message(format!(
                        "Gitgel {} is the newest version.",
                        app.package_info().version
                    ))
                    .title("You’re up to date")
                    .show(|_| {});
            }
            Err(e) => failed(&app, "Cannot check for updates", &e),
        }
    });
}

fn failed(app: &AppHandle, title: &str, detail: &str) {
    app.dialog()
        .message(detail)
        .title(title)
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .show(|_| {});
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
            app.restart()
        }
        Err(e) => {
            inner(&app).installing = false;
            log::warn!("update {} failed: {e}", update.version);
            Err(AppError::Io(e.to_string()))
        }
    }
}
