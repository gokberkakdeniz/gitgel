pub mod appearance;
pub mod apps;
pub mod base;
pub mod cache;
pub mod commands;
pub mod config;
pub mod error;
pub mod files;
pub mod git;
pub mod history;
pub mod logs;
pub mod memory;
pub mod menu;
pub mod model;
pub mod nearest;
pub mod projects;
pub mod repos;
pub mod review;
pub mod scan;
pub mod scripts;
pub mod ssh;
pub mod state;
pub mod timing;
pub mod trash;
pub mod updates;
pub mod watch;
pub mod windows;

use tauri::{Manager, RunEvent, WindowEvent};

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Updates::default())
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
            updates::check_if_due(app.handle());
            Ok(())
        })
        // Automatic update checks run at launch and on focus, at most every 6 hours.
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(true) => updates::check_if_due(window.app_handle()),
            WindowEvent::Destroyed if windows::Aux::from_label(window.label()).is_some() => {
                windows::closed(window.app_handle(), window.label());
            }
            // Closing the main window with scripts running asks first (SPEC §14).
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                let app = window.app_handle();
                if scripts::run::running_count(&app.state::<state::AppState>()) > 0 {
                    api.prevent_close();
                    scripts::run::confirm_quit(app);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::inspect_folders,
            commands::add_repos,
            commands::get_scan,
            commands::rescan_all,
            commands::get_review,
            commands::get_commit_changes,
            commands::get_stash_changes,
            commands::get_history,
            commands::read_file_pair,
            commands::get_remote_url,
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
            commands::set_repo_pinned,
            commands::update_settings,
            commands::get_open_apps,
            commands::get_terminal_options,
            commands::open_folder,
            commands::open_file,
            commands::get_update,
            commands::check_for_updates,
            commands::install_update,
            commands::report_issue,
            commands::open_remote_link,
            commands::get_update_check,
            commands::open_window,
            commands::reveal_window,
            commands::remember_ssh_key,
            commands::save_script,
            commands::delete_script,
            commands::reorder_scripts,
            commands::export_scripts,
            commands::read_scripts_file,
            commands::import_scripts,
            commands::run_script,
            commands::write_script_input,
            commands::stop_script,
            commands::get_script_run,
            commands::resize_script,
            commands::stash_push,
            commands::stash_apply,
            commands::stash_drop,
            commands::git_fetch,
            commands::git_pull,
            commands::git_rebase_on_base,
            commands::git_operation,
            commands::git_commit,
            commands::git_discard,
            commands::get_staged_paths,
            commands::git_push,
        ])
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|app, event| {
                // ⌘Q with scripts running asks first; `exit(0)` after the answer passes.
                if let RunEvent::ExitRequested {
                    api, code: None, ..
                } = event
                {
                    if let Some(state) = app.try_state::<state::AppState>() {
                        if scripts::run::running_count(&state) > 0 {
                            api.prevent_exit();
                            scripts::run::confirm_quit(app);
                        }
                    }
                }
            })
        });
    if let Err(e) = result {
        log::error!("gitgel stopped: {e}");
        eprintln!("gitgel stopped: {e}");
    }
}
