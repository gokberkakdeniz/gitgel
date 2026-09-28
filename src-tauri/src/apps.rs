//! The entry menus' open items: a worktree folder opened in Finder, an installed editor or the
//! terminal chosen in Settings (docs/SPEC.md §9 "Open items"). Nothing here touches git.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::error::AppError;
use crate::model::{OpenApp, Settings, TerminalChoice};

/// `(id, name, bundle id)`, in menu order; the terminal comes after them.
const APPS: &[(&str, &str, &str)] = &[
    ("finder", "Finder", "com.apple.finder"),
    ("cursor", "Cursor", "com.todesktop.230313mzl4w4u92"),
    ("vscode", "VS Code", "com.microsoft.VSCode"),
    ("windsurf", "Windsurf", "com.exafunction.windsurf"),
    ("zed", "Zed", "dev.zed.Zed"),
    ("sublime", "Sublime Text", "com.sublimetext.4"),
];

/// The id of the terminal item, whichever app it is.
const TERMINAL: &str = "terminal";

/// Where an `other` terminal given by name is looked for.
const APP_DIRS: &[&str] = &[
    "/Applications",
    "/Applications/Utilities",
    "/System/Applications",
    "/System/Applications/Utilities",
];

/// The listed apps that are installed, in menu order, then the chosen terminal if found.
pub fn installed(settings: &Settings) -> Vec<OpenApp> {
    let editors = APPS.iter().filter_map(|(id, name, bundle)| {
        let path = app_path(bundle)?;
        Some(OpenApp {
            id: (*id).into(),
            name: (*name).into(),
            icon: icon(&path),
        })
    });
    let terminal = terminal(settings).map(|(name, path)| OpenApp {
        id: TERMINAL.into(),
        name,
        icon: icon(&path),
    });
    editors.chain(terminal).collect()
}

/// Opens `path` (a folder) in the app `app` (an id from `installed`).
pub fn open_folder(path: &str, app: &str, settings: &Settings) -> Result<(), AppError> {
    check_folder(Path::new(path))?;
    let app_path = if app == TERMINAL {
        terminal(settings).map(|(_, path)| path)
    } else {
        bundle_id(app).and_then(app_path)
    }
    .ok_or_else(|| AppError::NotFound(format!("app {app}")))?;
    tauri_plugin_opener::open_path(path, Some(app_path)).map_err(|e| {
        log::warn!("cannot open {path} in {app}: {e}");
        AppError::Io(e.to_string())
    })
}

/// The chosen terminal's name and bundle path, if it is installed.
fn terminal(settings: &Settings) -> Option<(String, String)> {
    let known = |name: &str, bundle: &str| app_path(bundle).map(|p| (name.to_string(), p));
    match settings.terminal {
        TerminalChoice::Terminal => known("Terminal", "com.apple.Terminal"),
        TerminalChoice::Iterm => known("iTerm2", "com.googlecode.iterm2"),
        TerminalChoice::Wezterm => known("WezTerm", "com.github.wez.wezterm"),
        TerminalChoice::Other => {
            let path = find_other(&settings.terminal_app)?;
            let name = Path::new(&path).file_stem()?.to_string_lossy().into_owned();
            Some((name, path))
        }
    }
}

/// An `other` terminal: a `.app` path, an app name in the usual folders (with or without
/// `.app`), or a bundle id.
fn find_other(input: &str) -> Option<String> {
    let input = input.trim();
    if input.is_empty() {
        return None;
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if input.starts_with('/') || input.starts_with('~') {
        let path = match (input.strip_prefix("~/"), &home) {
            (Some(rest), Some(home)) => home.join(rest),
            _ => PathBuf::from(input),
        };
        return is_app(&path).then(|| path.to_string_lossy().into_owned());
    }
    let mut dirs: Vec<PathBuf> = APP_DIRS.iter().map(PathBuf::from).collect();
    dirs.extend(home.map(|h| h.join("Applications")));
    find_in_dirs(input, &dirs).or_else(|| app_path(input))
}

fn find_in_dirs(name: &str, dirs: &[PathBuf]) -> Option<String> {
    let lower = name.to_lowercase();
    let wanted = if lower.ends_with(".app") {
        lower
    } else {
        format!("{lower}.app")
    };
    dirs.iter().find_map(|dir| {
        std::fs::read_dir(dir).ok()?.flatten().find_map(|e| {
            let path = e.path();
            (e.file_name().to_string_lossy().to_lowercase() == wanted && is_app(&path))
                .then(|| path.to_string_lossy().into_owned())
        })
    })
}

fn is_app(path: &Path) -> bool {
    path.is_dir()
        && path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("app"))
}

fn bundle_id(id: &str) -> Option<&'static str> {
    APPS.iter().find(|(i, _, _)| *i == id).map(|(_, _, b)| *b)
}

fn check_folder(path: &Path) -> Result<(), AppError> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("folder {}", path.display())))
    }
}

/// The app's icon as a PNG data URL, cached per app path (icons do not change while we run).
fn icon(app_path: &str) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = crate::state::lock(cache).get(app_path) {
        return hit.clone();
    }
    let url = icon_png(app_path).map(|png| {
        use base64::Engine;
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        )
    });
    crate::state::lock(cache).insert(app_path.to_string(), url.clone());
    url
}

/// Where Launch Services finds the app with this bundle id, wherever it is installed.
#[cfg(target_os = "macos")]
fn app_path(bundle: &str) -> Option<String> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| {
        let url = NSWorkspace::sharedWorkspace()
            .URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle))?;
        url.path().map(|p| p.to_string())
    })
}

/// The icon Finder shows for the app, for 16 × 16 pt (32 px on a Retina screen), as PNG.
#[cfg(target_os = "macos")]
fn icon_png(app_path: &str) -> Option<Vec<u8>> {
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};
    objc2::rc::autoreleasepool(|_| {
        let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(app_path));
        let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(16.0, 16.0));
        // SAFETY: `rect` is a valid rect for the call; no context or hints.
        let cg = unsafe { image.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
        let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg);
        // SAFETY: an empty properties dictionary is valid for PNG.
        let data = unsafe {
            rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        }?;
        Some(data.to_vec())
    })
}

#[cfg(not(target_os = "macos"))]
fn app_path(_bundle: &str) -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
fn icon_png(_app_path: &str) -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_terminal(terminal: TerminalChoice, app: &str) -> Settings {
        Settings {
            terminal,
            terminal_app: app.into(),
            ..Settings::default()
        }
    }

    #[test]
    fn ids_are_unique_and_known() {
        for (i, (id, _, bundle)) in APPS.iter().enumerate() {
            assert!(APPS[..i].iter().all(|(other, _, _)| other != id), "{id}");
            assert_ne!(*id, TERMINAL);
            assert_eq!(bundle_id(id), Some(*bundle));
        }
        assert_eq!(bundle_id("notepad"), None);
    }

    #[test]
    fn only_existing_folders_open() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "a").unwrap();
        assert!(check_folder(dir.path()).is_ok());
        assert!(matches!(check_folder(&file), Err(AppError::NotFound(_))));
        assert!(matches!(
            check_folder(&dir.path().join("missing")),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn unknown_app_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        let settings = Settings::default();
        assert!(matches!(
            open_folder(path, "notepad", &settings),
            Err(AppError::NotFound(_))
        ));
        let missing = with_terminal(TerminalChoice::Other, "No Such Terminal");
        assert!(matches!(
            open_folder(path, TERMINAL, &missing),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn other_terminal_by_name_or_path() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("Kitty.app");
        std::fs::create_dir(&app).unwrap();
        std::fs::write(dir.path().join("Notes.app"), "not a bundle").unwrap();
        let dirs = [dir.path().join("missing"), dir.path().to_path_buf()];
        let found = Some(app.to_string_lossy().into_owned());
        assert_eq!(find_in_dirs("kitty", &dirs), found);
        assert_eq!(find_in_dirs("Kitty.app", &dirs), found);
        assert_eq!(find_in_dirs("Notes", &dirs), None);
        assert_eq!(find_in_dirs("Alacritty", &dirs), None);
        assert_eq!(find_other(app.to_str().unwrap()), found);
        assert_eq!(find_other(dir.path().join("Notes.app").to_str().unwrap()), None);
        assert_eq!(find_other("  "), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_first_and_terminal_last_with_icons() {
        // Both ship with macOS.
        let apps = installed(&Settings::default());
        assert_eq!(apps[0].id, "finder");
        let last = apps.last().unwrap();
        assert_eq!((last.id.as_str(), last.name.as_str()), (TERMINAL, "Terminal"));
        let icon = last.icon.as_deref().expect("icon");
        assert!(icon.starts_with("data:image/png;base64,"), "{icon:.40}");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn other_terminal_is_named_after_its_app() {
        let by_name = with_terminal(TerminalChoice::Other, "terminal");
        let by_path = with_terminal(
            TerminalChoice::Other,
            "/System/Applications/Utilities/Terminal.app",
        );
        for settings in [by_name, by_path] {
            let (name, path) = terminal(&settings).expect("Terminal");
            assert_eq!(name, "Terminal");
            assert!(path.ends_with("Terminal.app"), "{path}");
        }
    }
}
