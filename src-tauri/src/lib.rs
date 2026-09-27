pub mod base;
pub mod cache;
pub mod commands;
pub mod config;
pub mod error;
pub mod files;
pub mod git;
pub mod logs;
pub mod model;
pub mod projects;
pub mod repos;
pub mod review;
pub mod scan;
pub mod state;
pub mod timing;
pub mod watch;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, HELP_SUBMENU_ID};
use tauri::{Emitter, Manager};

const SETTINGS_ID: &str = "settings";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                // Watcher rounds are logged at debug level; show them in dev builds.
                .level_for(
                    "gitgel_lib",
                    if cfg!(debug_assertions) {
                        tauri_plugin_log::log::LevelFilter::Debug
                    } else {
                        tauri_plugin_log::log::LevelFilter::Info
                    },
                )
                // Enough history to debug from ("Help › Show Logs in Finder").
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            log::info!(
                "Gitgel {} · libgit2 {}",
                app.package_info().version,
                git::libgit2_version()
            );
            // The standard macOS menus, plus Gitgel › Settings… (⌘,) and Help › Show Logs in
            // Finder.
            let menu = Menu::default(app.handle())?;
            // The first submenu is the app menu; Settings goes after "About Gitgel".
            if let Some(app_menu) = menu.items()?.first().and_then(|k| k.as_submenu().cloned()) {
                app_menu.insert(&PredefinedMenuItem::separator(app)?, 1)?;
                app_menu.insert(
                    &MenuItem::with_id(app, SETTINGS_ID, "Settings…", true, Some("CmdOrCtrl+,"))?,
                    2,
                )?;
            }
            if let Some(help) = menu
                .get(HELP_SUBMENU_ID)
                .and_then(|k| k.as_submenu().cloned())
            {
                help.append(&MenuItem::with_id(
                    app,
                    logs::SHOW_LOGS_ID,
                    "Show Logs in Finder",
                    true,
                    None::<&str>,
                )?)?;
            }
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id() == logs::SHOW_LOGS_ID {
                    logs::show_logs(app);
                } else if event.id() == SETTINGS_ID {
                    let _ = app.emit("open-settings", ());
                }
            });
            let config_path = config::config_path(app.handle())?;
            let config = config::load(&config_path);
            let state = state::AppState::new(app.handle().clone(), config, config_path);
            // Folders are watched after the first scan (`get_scan`).
            watch::start(&state);
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::inspect_folders,
            commands::add_repos,
            commands::get_scan,
            commands::rescan_all,
            commands::get_review,
            commands::read_file_pair,
            commands::create_project,
            commands::rename_project,
            commands::delete_project,
            commands::add_entries,
            commands::remove_entries,
            commands::get_project_view,
            commands::get_base_options,
            commands::set_branch_base,
            commands::verify_ref,
            commands::commit_exists,
            commands::repoint_entry,
            commands::locate_repo,
            commands::remove_repo,
            commands::update_settings,
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        log::error!("gitgel stopped: {e}");
        eprintln!("gitgel stopped: {e}");
    }
}
