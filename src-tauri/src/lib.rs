pub mod appearance;
pub mod apps;
pub mod base;
pub mod cache;
pub mod commands;
pub mod config;
pub mod error;
pub mod files;
pub mod git;
pub mod logs;
pub mod memory;
pub mod menu;
pub mod model;
pub mod nearest;
pub mod projects;
pub mod repos;
pub mod review;
pub mod scan;
pub mod state;
pub mod timing;
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
                // Every line ends with the app's memory footprint, to see what makes it grow.
                .format(|out, message, record| {
                    out.finish(format_args!(
                        "[{}][{}][{}] {message} · {} MB",
                        chrono::Local::now().format("%Y-%m-%d][%H:%M:%S"),
                        record.target(),
                        record.level(),
                        memory::footprint_mb()
                    ))
                })
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
            menu::install(app)?;
            let config_path = config::config_path(app.handle())?;
            let mut config = config::load(&config_path);
            // A chosen terminal that is no longer installed falls back to Automatic.
            if apps::reset_missing_terminal(&mut config.settings) {
                if let Err(e) = config::save(&config_path, &config) {
                    log::warn!("cannot save the terminal fallback: {e}");
                }
            }
            let zoom = config.settings.zoom;
            let appearance = config.settings.appearance;
            let state = state::AppState::new(app.handle().clone(), config, config_path);
            // Folders are watched after the first scan (`get_scan`).
            watch::start(&state);
            app.manage(state);
            menu::apply_zoom(app.handle(), zoom);
            appearance::show_main_window(app.handle(), appearance);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::inspect_folders,
            commands::add_repos,
            commands::get_scan,
            commands::rescan_all,
            commands::get_review,
            commands::get_commit_changes,
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
            commands::get_open_apps,
            commands::get_terminal_options,
            commands::open_folder,
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        log::error!("gitgel stopped: {e}");
        eprintln!("gitgel stopped: {e}");
    }
}
