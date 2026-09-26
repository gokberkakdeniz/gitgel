//! Help › Show Logs in Finder: writes the app's logs, with a short header, to a file in
//! Downloads and reveals it, ready to attach to a bug report.

use std::path::PathBuf;
use std::time::SystemTime;

use tauri::{AppHandle, Manager};

use crate::config;
use crate::error::AppError;
use crate::git;
use crate::state::AppState;

pub const SHOW_LOGS_ID: &str = "show_logs";

pub fn show_logs(app: &AppHandle) {
    match export_logs(app) {
        Ok(path) => {
            log::info!("logs exported to {}", path.display());
            if let Err(e) = tauri_plugin_opener::reveal_item_in_dir(&path) {
                log::warn!("cannot reveal {}: {e}", path.display());
            }
        }
        Err(e) => log::warn!("cannot export logs: {e}"),
    }
}

fn export_logs(app: &AppHandle) -> Result<PathBuf, AppError> {
    let paths = app.path();
    let log_dir = paths
        .app_log_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    let downloads = paths
        .download_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;

    // Rotated files first, the current one last.
    let mut files: Vec<(SystemTime, PathBuf)> = std::fs::read_dir(&log_dir)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "log"))
        .map(|p| {
            let modified = p
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            (modified, p)
        })
        .collect();
    files.sort();

    let now = chrono::Utc::now();
    let mut text = format!(
        "Gitgel {} ({} {})\nlibgit2 {}\nexported {}\n",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        git::libgit2_version(),
        now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    );
    if let Some(state) = app.try_state::<AppState>() {
        let config = config::snapshot(&state);
        text.push_str(&format!(
            "{} repositories, {} projects, active threshold {} days, default base order {}\n",
            config.repos.len(),
            config.projects.len(),
            config.settings.active_days,
            config.settings.default_base_order.join(" → "),
        ));
    }
    for (_, file) in &files {
        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        text.push_str(&format!("\n===== {name} =====\n"));
        text.push_str(&String::from_utf8_lossy(&std::fs::read(file)?));
    }

    let out = downloads.join(format!("Gitgel-logs-{}.log", now.format("%Y%m%d-%H%M%S")));
    std::fs::write(&out, text)?;
    Ok(out)
}
