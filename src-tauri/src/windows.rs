//! The small windows beside the main one (SPEC §7): About Gitgel, Software Update and What's New.
//! Each loads the same frontend with `?window=<label>`; opening one that is already open brings it
//! forward instead. They are children of the main window (kept in front of it, moved with it),
//! which is blocked while any is open: `aux-windows` tells it which are.
//! A window starts hidden and the page shows it once it has drawn and sized itself (`reveal`), so
//! it never flashes empty or jumps in height; only then is it attached to the main window, since
//! attaching orders a window onto the screen.

use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, Manager, Theme, TitleBarStyle, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::model::Appearance;
use crate::state::{lock, AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Aux {
    About,
    Update,
    WhatsNew,
}

impl Aux {
    pub fn label(self) -> &'static str {
        match self {
            Aux::About => "about",
            Aux::Update => "update",
            Aux::WhatsNew => "whats-new",
        }
    }

    pub fn from_label(label: &str) -> Option<Self> {
        [Aux::About, Aux::Update, Aux::WhatsNew]
            .into_iter()
            .find(|a| a.label() == label)
    }

    /// Title (hidden, but used by Window menu and Mission Control), width, height, resizable.
    /// About and Software Update size their height to their content once it renders.
    fn frame(self) -> (&'static str, f64, f64, bool) {
        match self {
            Aux::About => ("About Gitgel", 340.0, 420.0, false),
            Aux::Update => ("Software Update", 360.0, 320.0, false),
            Aux::WhatsNew => ("What’s New", 520.0, 640.0, true),
        }
    }
}

/// `bg.elevated` of each theme (docs/SPEC.md §4): the windows' ground.
const DARK_BG: Color = Color(0x21, 0x1f, 0x1c, 0xff);
const LIGHT_BG: Color = Color(0xff, 0xff, 0xff, 0xff);

pub fn open(app: &AppHandle, aux: Aux) {
    if let Some(window) = app.get_webview_window(aux.label()) {
        // Still loading: it shows itself when ready.
        if window.is_visible().unwrap_or(false) {
            let _ = window.set_focus();
        }
        return;
    }
    let (title, width, height, resizable) = aux.frame();
    let url = WebviewUrl::App(format!("index.html?window={}", aux.label()).into());
    let mut builder = WebviewWindowBuilder::new(app, aux.label(), url)
        .title(title)
        .inner_size(width, height)
        .resizable(resizable)
        .minimizable(false)
        .maximizable(false)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .center()
        .visible(false)
        .focused(true);
    if resizable {
        builder = builder.min_inner_size(420.0, 360.0);
    }
    // The ground matches the theme from the start, so the window never flashes the other one.
    let appearance = app
        .try_state::<AppState>()
        .map(|s| lock(&s.0.config).settings.appearance)
        .unwrap_or(Appearance::System);
    builder = match appearance {
        Appearance::Light => builder.theme(Some(Theme::Light)).background_color(LIGHT_BG),
        Appearance::Dark => builder.theme(Some(Theme::Dark)).background_color(DARK_BG),
        Appearance::GithubLight => builder.theme(Some(Theme::Light)).background_color(LIGHT_BG),
        Appearance::GithubDark => builder
            .theme(Some(Theme::Dark))
            .background_color(Color(0x16, 0x1b, 0x22, 0xff)),
        Appearance::System => {
            builder.background_color(if dark_system(app) { DARK_BG } else { LIGHT_BG })
        }
    };
    if let Err(e) = builder.build() {
        log::warn!("cannot open the {} window: {e}", aux.label());
        return;
    }
    announce(app, None);
}

/// Shows a window once its page has drawn and focuses it (which also brings the app forward
/// after an update's restart by an older version); a small one also becomes a child of the main
/// window (in front of it, moved with it).
pub fn reveal(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
    if window.label() == "main" {
        return;
    }
    if let Some(main) = window.app_handle().get_webview_window("main") {
        attach(&main, window);
    }
}

#[cfg(target_os = "macos")]
fn attach(parent: &WebviewWindow, child: &WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowOrderingMode};
    let (Ok(parent), Ok(child)) = (parent.ns_window(), child.ns_window()) else {
        return;
    };
    // SAFETY: both are live NSWindows owned by Tauri; this runs on the main thread (a sync
    // command).
    unsafe {
        let parent = &*parent.cast::<NSWindow>();
        let child = &*child.cast::<NSWindow>();
        parent.addChildWindow_ordered(child, NSWindowOrderingMode::Above);
    }
}

#[cfg(not(target_os = "macos"))]
fn attach(_parent: &WebviewWindow, _child: &WebviewWindow) {}

/// After a small window closed: the main window is usable again when none is left.
pub fn closed(app: &AppHandle, label: &str) {
    announce(app, Some(label));
    if open_labels(app, Some(label)).is_empty() {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_focus();
        }
    }
}

/// `aux-windows`: the labels of the small windows open now (the main window blocks itself).
fn announce(app: &AppHandle, closing: Option<&str>) {
    let _ = app.emit_to("main", "aux-windows", open_labels(app, closing));
}

fn open_labels(app: &AppHandle, closing: Option<&str>) -> Vec<&'static str> {
    [Aux::About, Aux::Update, Aux::WhatsNew]
        .into_iter()
        .map(Aux::label)
        .filter(|l| Some(*l) != closing && app.get_webview_window(l).is_some())
        .collect()
}

/// The macOS appearance, read from the main window.
fn dark_system(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.theme().ok())
        .is_none_or(|t| t != Theme::Light)
}
