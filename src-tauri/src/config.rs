//! Loading and saving `config.json`. Only the backend reads or writes it.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppError;
use crate::model::Config;
use crate::state::AppState;

pub const CONFIG_CHANGED: &str = "config-changed";

/// `~/Library/Application Support/com.gitgel.desktop/config.json`; creates the folder.
pub fn config_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

/// Reads the config. A missing file gives the default; an unreadable one is renamed to
/// `config.broken-<unix>.json` and the default is used.
pub fn load(path: &Path) -> Config {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Config::default(),
        Err(e) => {
            log::warn!("cannot read {}: {e}", path.display());
            set_aside(path);
            return Config::default();
        }
    };
    match serde_json::from_str(&text) {
        Ok(config) => config,
        Err(e) => {
            log::warn!("cannot parse {}: {e}", path.display());
            set_aside(path);
            Config::default()
        }
    }
}

fn set_aside(path: &Path) {
    let broken = path.with_file_name(format!(
        "config.broken-{}.json",
        chrono::Utc::now().timestamp()
    ));
    match std::fs::rename(path, &broken) {
        Ok(()) => log::warn!("moved the broken config to {}", broken.display()),
        Err(e) => log::warn!("cannot move the broken config aside: {e}"),
    }
}

/// Writes to `config.json.tmp`, then renames over `config.json`.
pub fn save(path: &Path, config: &Config) -> Result<(), AppError> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(config)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Applies `f` to the config, saves it and emits `config-changed`. If `f` or the save fails,
/// nothing changes. Every config mutation goes through here.
pub fn update<T>(
    state: &AppState,
    f: impl FnOnce(&mut Config) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let (out, config) = {
        let mut current = state.config.lock().unwrap_or_else(|e| e.into_inner());
        let mut next = current.clone();
        let out = f(&mut next)?;
        save(&state.config_path, &next)?;
        *current = next.clone();
        (out, next)
    };
    if let Err(e) = state.app.emit(CONFIG_CHANGED, &config) {
        log::warn!("cannot emit {CONFIG_CHANGED}: {e}");
    }
    Ok(out)
}

pub fn snapshot(state: &AppState) -> Config {
    state
        .config
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// `r_` / `p_` followed by 8 hex characters.
pub fn new_id(prefix: &str) -> String {
    format!(
        "{prefix}_{}",
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{EntryConfig, LastKnownTip, ProjectConfig, RepoConfig};
    use serde_json::json;
    use tempfile::TempDir;

    #[test]
    fn missing_file_gives_default() {
        let dir = TempDir::new().unwrap();
        let config = load(&dir.path().join("config.json"));
        assert_eq!(config.version, 1);
        assert!(config.repos.is_empty() && config.projects.is_empty());
        assert!(config.branch_bases.is_empty());
        assert_eq!(
            config.settings.default_base_order,
            ["origin/HEAD", "main", "master"]
        );
        assert_eq!(config.settings.active_days, 14);
    }

    #[test]
    fn round_trips_the_handoff_shape() {
        let value = json!({
            "version": 1,
            "repos": [{ "id": "r_1", "path": "/Users/me/code/web-app" }],
            "branchBases": { "r_1:feat/stacked": "feat/parent" },
            "projects": [{
                "id": "p_1",
                "name": "Session auth refresh",
                "createdAt": "2026-09-20T09:00:00Z",
                "entries": [{ "repoId": "r_1", "branch": "session-token-refresh", "worktreePath": null,
                              "lastKnownTip": { "sha": "3be91a0", "seenAt": "2026-09-23T10:00:00Z" } }]
            }],
            "settings": {
                "defaultBaseOrder": ["origin/HEAD", "main", "master"],
                "activeDays": 14,
                "diffView": "unified",
                "ignoreWhitespace": true,
                "zoom": 125,
                "appearance": "system",
                "diffContext": "whole",
                "diffContextLines": 5,
                "terminal": "other",
                "terminalCommand": "Ghostty",
                "checkUpdates": false,
                "lastSeenVersion": "0.1.15",
                "prompts": { "removeRepositories": true, "discardChanges": false,
                             "discardStash": true, "deleteProjects": false,
                             "abortOperation": true },
                "ai": {
                    "enabled": false, "provider": "opencode",
                    "order": ["opencode", "codex"],
                    "opencode": { "enabled": true, "model": "fast", "effort": "max", "prompt": null },
                    "claude": { "enabled": true, "model": null, "effort": null, "prompt": null },
                    "cursor": { "enabled": true, "model": null, "effort": null, "prompt": null },
                    "antigravity": { "enabled": true, "model": null, "effort": "high", "prompt": null },
                    "codex": { "enabled": true, "model": null, "effort": null, "prompt": null }
                }
            },
            "scripts": [{
                "id": "s_1", "name": "Run tests", "icon": "test", "command": "pnpm test",
                "inputs": [{ "id": "PORT", "label": "Port", "type": "text", "default": "3000",
                             "options": [], "required": true, "when": "" }],
                "runsIn": "worktree", "showIn": ["branches"], "when": "branch.checkedOut",
                "openOutput": true, "askFirst": false, "disabled": false
            }],
            "pinnedRepos": ["r_1"]
        });
        let config: Config = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(
            config.repos,
            [RepoConfig {
                id: "r_1".into(),
                path: "/Users/me/code/web-app".into()
            }]
        );
        assert_eq!(
            config.projects[0],
            ProjectConfig {
                id: "p_1".into(),
                name: "Session auth refresh".into(),
                created_at: "2026-09-20T09:00:00Z".into(),
                entries: vec![EntryConfig {
                    repo_id: "r_1".into(),
                    branch: Some("session-token-refresh".into()),
                    worktree_path: None,
                    last_known_tip: Some(LastKnownTip {
                        sha: "3be91a0".into(),
                        seen_at: "2026-09-23T10:00:00Z".into(),
                    }),
                }],
            }
        );
        assert_eq!(serde_json::to_value(&config).unwrap(), value);

        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.json");
        save(&path, &config).unwrap();
        assert_eq!(load(&path), config);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn settings_added_later_default_when_missing() {
        let config: Config = serde_json::from_value(json!({
            "version": 1,
            "settings": { "defaultBaseOrder": ["main"], "activeDays": 7 }
        }))
        .unwrap();
        assert_eq!(config.settings.active_days, 7);
        assert_eq!(config.settings.diff_view, crate::model::DiffLayout::Split);
        assert!(!config.settings.ignore_whitespace);
        assert_eq!(config.settings.zoom, 100);
        assert_eq!(config.settings.appearance, crate::model::Appearance::System);
        assert_eq!(
            config.settings.diff_context,
            crate::model::DiffContext::Changes
        );
        assert_eq!(config.settings.diff_context_lines, 3);
        assert_eq!(config.settings.terminal, crate::model::TerminalChoice::Auto);
        assert_eq!(config.settings.terminal_command, "");
        assert_eq!(config.settings.prompts, crate::model::Prompts::default());
        assert!(config.settings.prompts.discard_changes);
        assert!(config.scripts.is_empty());
    }

    #[test]
    fn context_lines_outside_the_choices_read_as_3() {
        for (value, expected) in [
            (json!(10), 10),
            (json!(7), 3),
            (json!("five"), 3),
            (json!(-1), 3),
        ] {
            let config: Config = serde_json::from_value(json!({
                "version": 1,
                "settings": { "diffContext": "whole", "diffContextLines": value }
            }))
            .unwrap();
            assert_eq!(config.settings.diff_context_lines, expected);
            assert_eq!(
                config.settings.diff_context,
                crate::model::DiffContext::Whole
            );
        }
    }

    #[test]
    fn broken_file_is_set_aside() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, "{ not json").unwrap();

        assert_eq!(load(&path), Config::default());
        assert!(!path.exists());
        let names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 1);
        assert!(names[0].starts_with("config.broken-") && names[0].ends_with(".json"));
    }

    #[test]
    fn ids_have_prefix_and_eight_hex_chars() {
        let id = new_id("r");
        assert_eq!(id.len(), 10);
        assert!(id.starts_with("r_"));
        assert!(id[2..].chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(new_id("p"), new_id("p"));
    }
}
