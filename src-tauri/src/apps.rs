//! The entry menus' open items: a worktree folder opened in Finder, an installed editor or the
//! terminal chosen in Settings (docs/SPEC.md §9 "Open items"). Nothing here touches git.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};

use crate::error::AppError;
use crate::model::{OpenApp, Settings, TerminalChoice, TerminalOption};

/// `(id, name, bundle id)`, in menu order; the terminal comes after them.
const APPS: &[(&str, &str, &str)] = &[
    ("finder", "Finder", "com.apple.finder"),
    ("cursor", "Cursor", "com.todesktop.230313mzl4w4u92"),
    ("vscode", "VS Code", "com.microsoft.VSCode"),
    ("windsurf", "Windsurf", "com.exafunction.windsurf"),
    ("zed", "Zed", "dev.zed.Zed"),
    ("sublime", "Sublime Text", "com.sublimetext.4"),
];

/// The known terminals: choice, display name, bundle id. Automatic tries them in this order:
/// the first installed wins.
const TERMINALS: &[(TerminalChoice, &str, &str)] = &[
    (TerminalChoice::Iterm, "iTerm2", "com.googlecode.iterm2"),
    (TerminalChoice::Wezterm, "WezTerm", "com.github.wez.wezterm"),
    (TerminalChoice::Terminal, "Terminal", "com.apple.Terminal"),
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

/// The listed apps that are installed, in menu order, then the chosen terminal, which is always
/// listed (`found` is false when it is not installed).
pub fn installed(settings: &Settings) -> Vec<OpenApp> {
    let editors = APPS.iter().filter_map(|(id, name, bundle)| {
        let path = app_path(bundle)?;
        Some(OpenApp {
            id: (*id).into(),
            name: (*name).into(),
            icon: icon(&path),
            found: true,
        })
    });
    let term = resolve_terminal(settings);
    let terminal = OpenApp {
        id: TERMINAL.into(),
        name: term.name,
        icon: term.app_path.as_deref().and_then(icon),
        found: term.action.is_some(),
    };
    editors.chain(std::iter::once(terminal)).collect()
}

/// Opens `path` (a folder) in the app `app` (an id from `installed`).
pub fn open_folder(path: &str, app: &str, settings: &Settings) -> Result<(), AppError> {
    check_folder(Path::new(path))?;
    if app == TERMINAL {
        return open_in_terminal(path, settings);
    }
    let app_path = bundle_id(app)
        .and_then(app_path)
        .ok_or_else(|| AppError::NotFound(format!("app {app}")))?;
    tauri_plugin_opener::open_path(path, Some(app_path)).map_err(|e| {
        log::warn!("cannot open {path} in {app}: {e}");
        AppError::Io(e.to_string())
    })
}

/// Opens `file` (a path relative to `folder`) in the app `app` (an id from `installed`, not the
/// terminal); Finder shows the file selected.
pub fn open_file(folder: &str, file: &str, app: &str) -> Result<(), AppError> {
    check_folder(Path::new(folder))?;
    let rel = Path::new(file);
    if rel.is_absolute() || rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(AppError::NotFound(format!("file {file}")));
    }
    let path = Path::new(folder).join(rel);
    if !path.is_file() {
        return Err(AppError::NotFound(format!("file {}", path.display())));
    }
    let shown = path.to_string_lossy();
    let result = if app == "finder" {
        tauri_plugin_opener::reveal_item_in_dir(&path)
    } else if app == TERMINAL {
        return Err(AppError::NotFound(format!("app {app}")));
    } else {
        let app_path = bundle_id(app)
            .and_then(app_path)
            .ok_or_else(|| AppError::NotFound(format!("app {app}")))?;
        tauri_plugin_opener::open_path(&path, Some(app_path))
    };
    result.map_err(|e| {
        log::warn!("cannot open {shown} in {app}: {e}");
        AppError::Io(e.to_string())
    })
}

fn open_in_terminal(folder: &str, settings: &Settings) -> Result<(), AppError> {
    let term = resolve_terminal(settings);
    match term.action {
        Some(TerminalAction::OpenApp(path)) => tauri_plugin_opener::open_path(folder, Some(path))
            .map_err(|e| {
                log::warn!("cannot open {folder} in {}: {e}", term.name);
                AppError::Io(e.to_string())
            }),
        Some(TerminalAction::Wezterm(bundle)) => {
            let binary = Path::new(&bundle).join("Contents/MacOS/wezterm");
            spawn_detached(
                &binary.to_string_lossy(),
                &["start", "--cwd", folder],
                folder,
            )
        }
        Some(TerminalAction::Shell(template)) => run_command(&template, folder),
        None => Err(AppError::NotFound(format!("terminal {}", term.name))),
    }
}

/// How a folder opens in the resolved terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
enum TerminalAction {
    /// With the app's bundle (`open_path`).
    OpenApp(String),
    /// With `<bundle>/Contents/MacOS/wezterm start --cwd <folder>`.
    Wezterm(String),
    /// In the login shell; every `%` becomes the folder.
    Shell(String),
}

/// The terminal Settings resolves to: its display name, its app bundle for the icon (if any)
/// and how to open in it (`None` when it is not installed).
struct ResolvedTerminal {
    name: String,
    app_path: Option<String>,
    action: Option<TerminalAction>,
}

/// Terminal, iTerm2 and WezTerm with their install state, for the Settings dropdown.
pub fn terminal_options() -> Vec<TerminalOption> {
    TERMINALS
        .iter()
        .map(|(choice, name, bundle)| TerminalOption {
            choice: *choice,
            name: (*name).into(),
            found: app_path(bundle).is_some(),
        })
        .collect()
}

/// At launch an explicit terminal that is no longer installed falls back to Automatic (an Other
/// command cannot be checked, so it is left alone). True when the settings changed.
pub fn reset_missing_terminal(settings: &mut Settings) -> bool {
    reset_missing_terminal_with(settings, app_path)
}

fn reset_missing_terminal_with(
    settings: &mut Settings,
    bundle: impl Fn(&str) -> Option<String>,
) -> bool {
    let installed = TERMINALS
        .iter()
        .any(|(choice, _, id)| *choice == settings.terminal && bundle(id).is_some());
    if !installed
        && TERMINALS
            .iter()
            .any(|(choice, _, _)| *choice == settings.terminal)
    {
        log::info!(
            "terminal {:?} is not installed; falling back to Automatic",
            settings.terminal
        );
        settings.terminal = TerminalChoice::Auto;
        return true;
    }
    false
}

fn resolve_terminal(settings: &Settings) -> ResolvedTerminal {
    resolve_terminal_with(settings, app_path, find_other)
}

fn resolve_terminal_with(
    settings: &Settings,
    bundle: impl Fn(&str) -> Option<String> + Copy,
    find: impl Fn(&str) -> Option<String> + Copy,
) -> ResolvedTerminal {
    match settings.terminal {
        TerminalChoice::Auto => pick_auto(bundle).unwrap_or(ResolvedTerminal {
            name: "Terminal".into(),
            app_path: None,
            action: None,
        }),
        TerminalChoice::Terminal => known("Terminal", "com.apple.Terminal", bundle),
        TerminalChoice::Iterm => known("iTerm2", "com.googlecode.iterm2", bundle),
        TerminalChoice::Wezterm => match bundle("com.github.wez.wezterm") {
            Some(path) => ResolvedTerminal {
                name: "WezTerm".into(),
                app_path: Some(path.clone()),
                action: Some(TerminalAction::Wezterm(path)),
            },
            None => ResolvedTerminal {
                name: "WezTerm".into(),
                app_path: None,
                action: None,
            },
        },
        TerminalChoice::Other => resolve_other(&settings.terminal_command, bundle, find),
    }
}

/// The first installed of iTerm2, WezTerm, Terminal.
fn pick_auto(bundle: impl Fn(&str) -> Option<String>) -> Option<ResolvedTerminal> {
    TERMINALS.iter().find_map(|(choice, name, id)| {
        let path = bundle(id)?;
        let action = if *choice == TerminalChoice::Wezterm {
            TerminalAction::Wezterm(path.clone())
        } else {
            TerminalAction::OpenApp(path.clone())
        };
        Some(ResolvedTerminal {
            name: (*name).into(),
            app_path: Some(path),
            action: Some(action),
        })
    })
}

/// A Terminal/iTerm2 choice: no action when not installed.
fn known(name: &str, id: &str, bundle: impl Fn(&str) -> Option<String>) -> ResolvedTerminal {
    match bundle(id) {
        Some(path) => ResolvedTerminal {
            name: name.into(),
            app_path: Some(path.clone()),
            action: Some(TerminalAction::OpenApp(path)),
        },
        None => ResolvedTerminal {
            name: name.into(),
            app_path: None,
            action: None,
        },
    }
}

/// An `other` terminal: empty means Automatic; a word or path that resolves to an app opens
/// with it; anything else is a command run in the login shell.
fn resolve_other(
    input: &str,
    bundle: impl Fn(&str) -> Option<String> + Copy,
    find: impl Fn(&str) -> Option<String> + Copy,
) -> ResolvedTerminal {
    let command = input.trim();
    if command.is_empty() {
        return pick_auto(bundle).unwrap_or(ResolvedTerminal {
            name: "Terminal".into(),
            app_path: None,
            action: None,
        });
    }
    if let Some(path) = find(command) {
        let name = app_stem(&path);
        return ResolvedTerminal {
            name,
            app_path: Some(path.clone()),
            action: Some(TerminalAction::OpenApp(path)),
        };
    }
    let first = first_word(command);
    let (name, app_path) = match find(first) {
        Some(path) => (app_stem(&path), Some(path)),
        None => (first.to_string(), None),
    };
    ResolvedTerminal {
        name,
        app_path,
        action: Some(TerminalAction::Shell(command.into())),
    }
}

fn app_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.into())
}

fn first_word(command: &str) -> &str {
    command.split_whitespace().next().unwrap_or(command)
}

/// Every `%` in the command becomes the folder, single-quoted for the shell.
fn fill_command(template: &str, folder: &str) -> String {
    template.replace('%', &shell_quote(folder))
}

/// `'...'`; an inner `'` becomes `'\''`.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Runs an Other command with the folder as working directory: `$SHELL -l -c <command>`
/// (`/bin/zsh` without `$SHELL`). Detached: stdio is null and a thread reaps the child.
fn run_command(template: &str, folder: &str) -> Result<(), AppError> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    spawn_detached(
        &shell,
        &["-l", "-c", &fill_command(template, folder)],
        folder,
    )
}

// The one `Command` exception (SPEC §0): terminals are started here and never run git.
#[allow(clippy::disallowed_methods)]
fn spawn_detached(program: &str, args: &[&str], cwd: &str) -> Result<(), AppError> {
    let mut child = std::process::Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            log::warn!("cannot start {program}: {e}");
            AppError::Io(e.to_string())
        })?;
    // Reap the child without waiting for it.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
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

    fn with_terminal(terminal: TerminalChoice, command: &str) -> Settings {
        Settings {
            terminal,
            terminal_command: command.into(),
            ..Settings::default()
        }
    }

    /// No bundle is installed.
    fn no_bundle(_: &str) -> Option<String> {
        None
    }

    /// Nothing resolves to an app.
    fn no_app(_: &str) -> Option<String> {
        None
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
        // A choice whose app is not installed has no action.
        let missing = known("iTerm2", "com.googlecode.iterm2", no_bundle);
        assert_eq!(missing.name, "iTerm2");
        assert!(missing.action.is_none());
    }

    #[test]
    fn automatic_takes_the_first_installed() {
        let iterm = |id: &str| (id == "com.googlecode.iterm2").then(|| "/iTerm.app".into());
        let wezterm = |id: &str| (id == "com.github.wez.wezterm").then(|| "/WezTerm.app".into());
        let term = |id: &str| (id == "com.apple.Terminal").then(|| "/Terminal.app".into());
        let all = |id: &str| iterm(id).or_else(|| wezterm(id)).or_else(|| term(id));

        let auto = Settings {
            terminal: TerminalChoice::Auto,
            ..Settings::default()
        };
        let resolved = resolve_terminal_with(&auto, all, no_app);
        assert_eq!(resolved.name, "iTerm2");
        assert!(matches!(resolved.action, Some(TerminalAction::OpenApp(_))));

        let resolved = resolve_terminal_with(&auto, wezterm, no_app);
        assert_eq!(resolved.name, "WezTerm");
        assert!(matches!(resolved.action, Some(TerminalAction::Wezterm(_))));

        let resolved = resolve_terminal_with(&auto, term, no_app);
        assert_eq!(resolved.name, "Terminal");

        // Nothing installed: no action, still listed under a name.
        let resolved = resolve_terminal_with(&auto, no_bundle, no_app);
        assert!(resolved.action.is_none());
    }

    #[test]
    fn launch_resets_a_missing_explicit_terminal_to_automatic() {
        let installed = |id: &str| (id == "com.apple.Terminal").then(|| "/Terminal.app".into());
        let mut settings = with_terminal(TerminalChoice::Iterm, "");
        assert!(reset_missing_terminal_with(&mut settings, installed));
        assert_eq!(settings.terminal, TerminalChoice::Auto);

        // Installed, Automatic and Other are left alone.
        let mut settings = with_terminal(TerminalChoice::Terminal, "");
        assert!(!reset_missing_terminal_with(&mut settings, installed));
        let mut settings = with_terminal(TerminalChoice::Other, "No Such Terminal");
        assert!(!reset_missing_terminal_with(&mut settings, no_bundle));
        let mut settings = Settings::default();
        assert!(!reset_missing_terminal_with(&mut settings, no_bundle));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn terminal_options_list_the_known_terminals() {
        // Terminal ships with macOS.
        let options = terminal_options();
        assert_eq!(options.len(), 3);
        let terminal = options
            .iter()
            .find(|o| o.choice == TerminalChoice::Terminal)
            .expect("Terminal");
        assert_eq!(terminal.name, "Terminal");
        assert!(terminal.found);
    }

    #[test]
    fn percent_becomes_the_shell_quoted_folder() {
        assert_eq!(shell_quote("/Users/me/wt"), "'/Users/me/wt'");
        assert_eq!(shell_quote("/Users/me/o'clock"), "'/Users/me/o'\\''clock'");
        assert_eq!(
            fill_command("wezterm start --cwd %", "/Users/me/my dir"),
            "wezterm start --cwd '/Users/me/my dir'"
        );
        assert_eq!(
            fill_command("cd % && exec $SHELL -l", "/a"),
            "cd '/a' && exec $SHELL -l"
        );
        assert_eq!(fill_command("echo %%", "/a"), "echo '/a''/a'");
    }

    #[test]
    fn other_is_an_app_or_a_command() {
        // An empty command means Automatic.
        let blank = with_terminal(TerminalChoice::Other, "  ");
        let resolved = resolve_terminal_with(&blank, no_bundle, no_app);
        assert!(resolved.action.is_none());

        // A word or path that resolves to an app opens with it.
        let ghostty =
            |input: &str| (input == "Ghostty").then(|| "/Applications/Ghostty.app".into());
        let app = with_terminal(TerminalChoice::Other, "Ghostty");
        let resolved = resolve_terminal_with(&app, no_bundle, ghostty);
        assert_eq!(resolved.name, "Ghostty");
        assert!(matches!(resolved.action, Some(TerminalAction::OpenApp(_))));

        // Anything else is a command; its name is the app its first word names if one is
        // found, else the first word.
        let cmd = with_terminal(TerminalChoice::Other, "wezterm start --cwd %");
        let resolved = resolve_terminal_with(&cmd, no_bundle, ghostty);
        assert_eq!(resolved.name, "wezterm");
        assert!(matches!(resolved.action, Some(TerminalAction::Shell(_))));

        let resolved = resolve_terminal_with(&cmd, no_bundle, |input| {
            (input == "wezterm").then(|| "/Applications/WezTerm.app".into())
        });
        assert_eq!(resolved.name, "WezTerm");
        assert_eq!(
            resolved.app_path.as_deref(),
            Some("/Applications/WezTerm.app")
        );
        assert!(matches!(resolved.action, Some(TerminalAction::Shell(_))));
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
        assert_eq!(
            find_other(dir.path().join("Notes.app").to_str().unwrap()),
            None
        );
        assert_eq!(find_other("  "), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_first_and_terminal_last_with_icons() {
        // Finder and Terminal ship with macOS; Automatic finds at least Terminal.
        let apps = installed(&Settings::default());
        assert_eq!(apps[0].id, "finder");
        assert!(apps[0].found);
        let last = apps.last().unwrap();
        assert_eq!(last.id.as_str(), TERMINAL);
        assert!(last.found);
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
            let resolved = resolve_terminal(&settings);
            assert_eq!(resolved.name, "Terminal");
            assert!(resolved
                .app_path
                .as_deref()
                .is_some_and(|p| p.ends_with("Terminal.app")));
            assert!(matches!(resolved.action, Some(TerminalAction::OpenApp(_))));
        }
    }
}
