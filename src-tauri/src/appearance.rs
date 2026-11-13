//! The window's appearance at launch. The main window starts hidden (`tauri.conf.json`); its
//! native theme and background are set from Settings › Appearance, and the page shows it once it
//! has drawn (`reveal_window`), so it never flashes white or the other theme while it loads.

use tauri::window::Color;
use tauri::{AppHandle, Manager, Theme};

use crate::model::Appearance;

/// `bg.main` of each theme (docs/SPEC.md §4).
const DARK_BG: Color = Color(0x14, 0x13, 0x11, 0xff);
const LIGHT_BG: Color = Color(0xfb, 0xfa, 0xf7, 0xff);

pub fn show_main_window(app: &AppHandle, appearance: Appearance) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let theme = match appearance {
        Appearance::System => None,
        Appearance::Light => Some(Theme::Light),
        Appearance::Dark => Some(Theme::Dark),
    };
    if let Err(e) = window.set_theme(theme) {
        log::warn!("cannot set the window theme: {e}");
    }
    // With System, the window now reports the macOS appearance.
    let dark = !matches!(theme.map_or_else(|| window.theme(), Ok), Ok(Theme::Light));
    if let Err(e) = window.set_background_color(Some(if dark { DARK_BG } else { LIGHT_BG })) {
        log::warn!("cannot set the window background: {e}");
    }
    // In case the page never says it is ready.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        if !window.is_visible().unwrap_or(true) {
            log::warn!("the page did not show the window; showing it");
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}
