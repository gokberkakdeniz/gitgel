pub mod base;
pub mod cache;
pub mod commands;
pub mod config;
pub mod error;
pub mod files;
pub mod git;
pub mod model;
pub mod projects;
pub mod repos;
pub mod review;
pub mod scan;
pub mod state;
pub mod watch;

use tauri::Manager;

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
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            log::info!("libgit2 {}", git::libgit2_version());
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
