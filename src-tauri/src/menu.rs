//! The app menu: the standard macOS menus with Gitgel › About Gitgel (the app's own window),
//! Settings… (⌘,) and Check for Updates…, View › Font Size and the Help items (What's New first).
//! Items that ask for more before they finish end in "…" (macOS HIG; SPEC §0).

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID};
use tauri::{App, AppHandle, Emitter, Manager};

use crate::config;
use crate::logs;
use crate::state::AppState;
use crate::updates;
use crate::windows::{self, Aux};

const ABOUT: &str = "about";
const CHECK_UPDATES: &str = "check_updates";
const WHATS_NEW: &str = "whats_new";
const SETTINGS: &str = "settings";
const FONT_SMALLER: &str = "font_smaller";
const FONT_LARGER: &str = "font_larger";
const FONT_RESET: &str = "font_reset";
const DISCUSS: &str = "discuss";
const ISSUES: &str = "issues";

const DISCUSS_URL: &str = "https://github.com/gokberkakdeniz/gitgel/discussions";
pub const ISSUES_URL: &str = "https://github.com/gokberkakdeniz/gitgel/issues";

/// Font size steps, as a zoom of the whole window (percent), like a browser's.
const ZOOM_STEPS: [u32; 11] = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];

pub fn install(app: &App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let submenu = |text: &str| -> tauri::Result<Option<Submenu<_>>> {
        Ok(menu
            .items()?
            .into_iter()
            .filter_map(|k| k.as_submenu().cloned())
            .find(|s| s.text().is_ok_and(|t| t == text)))
    };

    // The first submenu is the app menu: About Gitgel opens the app's own About window instead
    // of the standard panel; Settings… and Check for Updates… follow it in their own group.
    if let Some(app_menu) = menu.items()?.first().and_then(|k| k.as_submenu().cloned()) {
        app_menu.remove_at(0)?;
        app_menu.insert(
            &MenuItem::with_id(app, ABOUT, "About Gitgel", true, None::<&str>)?,
            0,
        )?;
        app_menu.insert(
            &MenuItem::with_id(app, SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?,
            2,
        )?;
        app_menu.insert(
            &MenuItem::with_id(app, CHECK_UPDATES, "Check for Updates…", true, None::<&str>)?,
            3,
        )?;
        app_menu.insert(&PredefinedMenuItem::separator(app)?, 4)?;
    }

    // ⌘- ⌘. ⌘0: keys that need no Shift on Turkish and US layouts. Listed in lib/shortcuts.ts.
    if let Some(view) = submenu("View")? {
        let font = Submenu::with_items(
            app,
            "Font Size",
            true,
            &[
                &MenuItem::with_id(
                    app,
                    FONT_SMALLER,
                    "Decrease Font Size",
                    true,
                    Some("CmdOrCtrl+Minus"),
                )?,
                &MenuItem::with_id(
                    app,
                    FONT_LARGER,
                    "Increase Font Size",
                    true,
                    Some("CmdOrCtrl+Period"),
                )?,
                &MenuItem::with_id(
                    app,
                    FONT_RESET,
                    "Reset Font Size",
                    true,
                    Some("CmdOrCtrl+0"),
                )?,
            ],
        )?;
        view.insert(&font, 0)?;
        view.insert(&PredefinedMenuItem::separator(app)?, 1)?;
    }

    if let Some(help) = menu
        .get(HELP_SUBMENU_ID)
        .and_then(|k| k.as_submenu().cloned())
    {
        help.append_items(&[
            &MenuItem::with_id(app, WHATS_NEW, "What’s New", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, DISCUSS, "Discuss on GitHub", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                ISSUES,
                "Search or Report an Issue on GitHub",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                logs::SHOW_LOGS_ID,
                "Show Logs in Finder",
                true,
                None::<&str>,
            )?,
        ])?;
    }

    app.set_menu(menu)?;
    app.on_menu_event(on_event);
    Ok(())
}

fn on_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        ABOUT => windows::open(app, Aux::About),
        CHECK_UPDATES => {
            windows::open(app, Aux::Update);
            updates::check_now(app);
        }
        WHATS_NEW => windows::open(app, Aux::WhatsNew),
        SETTINGS => {
            let _ = app.emit("open-settings", ());
        }
        FONT_SMALLER => zoom(app, -1),
        FONT_LARGER => zoom(app, 1),
        FONT_RESET => zoom(app, 0),
        DISCUSS => open_url(DISCUSS_URL),
        ISSUES => open_url(ISSUES_URL),
        id if id == logs::SHOW_LOGS_ID => logs::show_logs(app),
        _ => {}
    }
}

pub fn open_url(url: &str) {
    if let Err(e) = tauri_plugin_opener::open_url(url, None::<&str>) {
        log::warn!("cannot open {url}: {e}");
    }
}

/// The next step up (1) or down (-1) from `current`, or 100 (0).
fn next_zoom(current: u32, dir: i32) -> u32 {
    match dir {
        0 => 100,
        d if d > 0 => ZOOM_STEPS
            .into_iter()
            .find(|&z| z > current)
            .unwrap_or(current),
        _ => ZOOM_STEPS
            .into_iter()
            .rev()
            .find(|&z| z < current)
            .unwrap_or(current),
    }
}

/// Changes the font size (the window's zoom) and remembers it in the config.
fn zoom(app: &AppHandle, dir: i32) {
    let state = app.state::<AppState>();
    let current = config::snapshot(&state).settings.zoom;
    let next = next_zoom(current, dir);
    if next == current {
        return;
    }
    let saved = config::update(&state, |c| {
        c.settings.zoom = next;
        Ok(())
    });
    if let Err(e) = saved {
        log::warn!("cannot save the font size: {e}");
    }
    apply_zoom(app, next);
}

/// Sets the window's zoom (percent).
pub fn apply_zoom(app: &AppHandle, percent: u32) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.set_zoom(f64::from(percent) / 100.0) {
            log::warn!("cannot set the zoom: {e}");
        }
    }
}

/// A saved zoom that is not a step (edited by hand) is clamped to the steps' range.
pub fn clamp_zoom(percent: u32) -> u32 {
    percent.clamp(ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.len() - 1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_steps() {
        assert_eq!(next_zoom(100, 1), 110);
        assert_eq!(next_zoom(100, -1), 90);
        assert_eq!(next_zoom(200, 1), 200);
        assert_eq!(next_zoom(50, -1), 50);
        assert_eq!(next_zoom(105, 1), 110);
        assert_eq!(next_zoom(105, -1), 100);
        assert_eq!(next_zoom(150, 0), 100);
        assert_eq!(clamp_zoom(10), 50);
    }
}
