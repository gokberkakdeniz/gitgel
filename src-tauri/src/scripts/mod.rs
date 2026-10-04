//! The user's scripts (SPEC §14): stored in the config, imported and exported as one file;
//! `run` starts them.

pub mod git;
pub mod run;

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config;
use crate::error::AppError;
use crate::model::{Config, ScriptConfig, ScriptInputKind};
use crate::state::AppState;

/// The file `Export…` writes and `Import…` reads.
#[derive(Debug, Serialize, Deserialize)]
struct ScriptsFile {
    version: u32,
    scripts: Vec<ScriptConfig>,
}

/// Name, command and inputs a script must have to be saved.
pub fn validate(script: &ScriptConfig) -> Result<(), AppError> {
    if script.name.trim().is_empty() {
        return Err(AppError::Invalid("A script needs a name".into()));
    }
    if script.command.trim().is_empty() {
        return Err(AppError::Invalid("A script needs a command".into()));
    }
    if script.show_in.is_empty() {
        return Err(AppError::Invalid("A script needs a menu to show in".into()));
    }
    let mut ids = HashSet::new();
    for input in &script.inputs {
        let valid = !input.id.is_empty()
            && input
                .id
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
        if !valid {
            return Err(AppError::Invalid(format!(
                "Input ID “{}” may only use A–Z, 0–9 and _",
                input.id
            )));
        }
        if !ids.insert(input.id.as_str()) {
            return Err(AppError::Invalid(format!(
                "Two inputs share the ID {}",
                input.id
            )));
        }
        if input.kind == ScriptInputKind::Select && input.options.is_empty() {
            return Err(AppError::Invalid(format!(
                "Input {} needs at least one option",
                input.id
            )));
        }
    }
    Ok(())
}

/// Trims the parts that are compared or shown.
fn tidy(mut script: ScriptConfig) -> ScriptConfig {
    script.name = script.name.trim().to_string();
    script.when = script.when.trim().to_string();
    script.show_in.dedup();
    script
}

/// Saves a script: a new one (empty id) is added last, a known id is replaced in place, and an
/// unknown id is added back (Undo after a remove).
pub fn save_script(state: &AppState, script: ScriptConfig) -> Result<Config, AppError> {
    validate(&script)?;
    config::update(state, |config| {
        put(config, script);
        Ok(config.clone())
    })
}

fn put(config: &mut Config, script: ScriptConfig) {
    let script = tidy(script);
    if script.id.is_empty() {
        config.scripts.push(ScriptConfig {
            id: config::new_id("s"),
            ..script
        });
    } else if let Some(slot) = config.scripts.iter_mut().find(|s| s.id == script.id) {
        *slot = script;
    } else {
        config.scripts.push(script);
    }
}

pub fn delete_script(state: &AppState, script_id: &str) -> Result<Config, AppError> {
    config::update(state, |config| {
        remove(config, script_id)?;
        Ok(config.clone())
    })
}

fn remove(config: &mut Config, script_id: &str) -> Result<(), AppError> {
    let before = config.scripts.len();
    config.scripts.retain(|s| s.id != script_id);
    if config.scripts.len() == before {
        return Err(AppError::NotFound(script_id.into()));
    }
    Ok(())
}

/// `ids` must name every script once.
pub fn reorder_scripts(state: &AppState, ids: &[String]) -> Result<Config, AppError> {
    config::update(state, |config| {
        reorder(config, ids)?;
        Ok(config.clone())
    })
}

fn reorder(config: &mut Config, ids: &[String]) -> Result<(), AppError> {
    let known: HashSet<&str> = config.scripts.iter().map(|s| s.id.as_str()).collect();
    let given: HashSet<&str> = ids.iter().map(String::as_str).collect();
    if ids.len() != config.scripts.len() || known != given {
        return Err(AppError::Invalid(
            "The order must list every script once".into(),
        ));
    }
    let mut scripts = std::mem::take(&mut config.scripts);
    config.scripts = ids
        .iter()
        .filter_map(|id| {
            let i = scripts.iter().position(|s| &s.id == id)?;
            Some(scripts.remove(i))
        })
        .collect();
    Ok(())
}

/// Writes every script to `path`, without ids (they belong to this machine's config).
pub fn export_scripts(state: &AppState, path: &Path) -> Result<(), AppError> {
    let scripts = config::snapshot(state)
        .scripts
        .into_iter()
        .map(|s| ScriptConfig {
            id: String::new(),
            ..s
        })
        .collect();
    let text = serde_json::to_string_pretty(&ScriptsFile {
        version: 1,
        scripts,
    })?;
    std::fs::write(path, text)?;
    Ok(())
}

/// Reads an exported file for the import preview. Ids come back empty.
pub fn read_scripts_file(path: &Path) -> Result<Vec<ScriptConfig>, AppError> {
    let text = std::fs::read_to_string(path)?;
    let file: ScriptsFile = serde_json::from_str(&text)
        .map_err(|e| AppError::Invalid(format!("Not a Gitgel scripts file: {e}")))?;
    if file.version != 1 {
        return Err(AppError::Invalid(format!(
            "Unknown scripts file version {}",
            file.version
        )));
    }
    Ok(file
        .scripts
        .into_iter()
        .map(|s| {
            tidy(ScriptConfig {
                id: String::new(),
                ..s
            })
        })
        .collect())
}

/// Adds the picked scripts, all with "Ask before running" on. A script whose name is already
/// taken replaces that script when its name is in `replace` (keeping its id and place);
/// otherwise it is added as "<name> (2)" (Keep both).
pub fn import_scripts(
    state: &AppState,
    scripts: Vec<ScriptConfig>,
    replace: &[String],
) -> Result<Config, AppError> {
    for script in &scripts {
        validate(script)?;
    }
    config::update(state, |config| {
        add_imported(config, scripts, replace);
        Ok(config.clone())
    })
}

fn add_imported(config: &mut Config, scripts: Vec<ScriptConfig>, replace: &[String]) {
    for script in scripts {
        let script = ScriptConfig {
            ask_first: true,
            ..tidy(script)
        };
        match position_by_name(config, &script.name) {
            Some(i) if replace.iter().any(|n| same_name(n, &script.name)) => {
                let id = config.scripts[i].id.clone();
                config.scripts[i] = ScriptConfig { id, ..script };
            }
            Some(_) => {
                let name = free_name(config, &script.name);
                config.scripts.push(ScriptConfig {
                    id: config::new_id("s"),
                    name,
                    ..script
                });
            }
            None => config.scripts.push(ScriptConfig {
                id: config::new_id("s"),
                ..script
            }),
        }
    }
}

fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

fn position_by_name(config: &Config, name: &str) -> Option<usize> {
    config.scripts.iter().position(|s| same_name(&s.name, name))
}

/// `<name> (2)`, `(3)`, … the first one not taken.
fn free_name(config: &Config, name: &str) -> String {
    (2..)
        .map(|n| format!("{name} ({n})"))
        .find(|candidate| position_by_name(config, candidate).is_none())
        .unwrap_or_else(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ScriptFolder, ScriptInput, ScriptMenu};

    fn script(name: &str) -> ScriptConfig {
        ScriptConfig {
            name: name.into(),
            command: "echo hi".into(),
            ..ScriptConfig::default()
        }
    }

    #[test]
    fn validation() {
        assert!(validate(&script("Run tests")).is_ok());
        assert!(validate(&script("  ")).is_err());
        assert!(validate(&ScriptConfig {
            show_in: vec![],
            ..script("x")
        })
        .is_err());
        assert!(validate(&ScriptConfig {
            command: " ".into(),
            ..script("x")
        })
        .is_err());
        let input = |id: &str| ScriptInput {
            id: id.into(),
            ..ScriptInput::default()
        };
        assert!(validate(&ScriptConfig {
            inputs: vec![input("PORT"), input("API_2")],
            ..script("x")
        })
        .is_ok());
        for bad in [
            vec![input("port")],
            vec![input("")],
            vec![input("A"), input("A")],
        ] {
            assert!(validate(&ScriptConfig {
                inputs: bad,
                ..script("x")
            })
            .is_err());
        }
        assert!(validate(&ScriptConfig {
            inputs: vec![ScriptInput {
                kind: ScriptInputKind::Select,
                ..input("API")
            }],
            ..script("x")
        })
        .is_err());
    }

    #[test]
    fn missing_fields_default() {
        let s: ScriptConfig = serde_json::from_value(
            serde_json::json!({ "name": "Run tests", "command": "pnpm test" }),
        )
        .unwrap();
        assert_eq!(s.icon, "prompt");
        assert_eq!(s.runs_in, ScriptFolder::Worktree);
        assert_eq!(s.show_in, [ScriptMenu::Branches, ScriptMenu::Project]);
        assert!(!s.open_output);
        assert!(!s.ask_first && !s.disabled && s.inputs.is_empty());
    }

    #[test]
    fn file_round_trip_has_no_ids() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("gitgel-scripts.json");
        let file = ScriptsFile {
            version: 1,
            scripts: vec![ScriptConfig {
                id: String::new(),
                disabled: true,
                ..script("Run tests")
            }],
        };
        std::fs::write(&path, serde_json::to_string(&file).unwrap()).unwrap();
        let read = read_scripts_file(&path).unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].name, "Run tests");
        assert!(read[0].id.is_empty());
        assert!(read[0].disabled);

        std::fs::write(&path, r#"{"version": 2, "scripts": []}"#).unwrap();
        assert!(read_scripts_file(&path).is_err());
        std::fs::write(&path, "nope").unwrap();
        assert!(read_scripts_file(&path).is_err());
    }

    fn with(ids: &[(&str, &str)]) -> Config {
        Config {
            scripts: ids
                .iter()
                .map(|(id, name)| ScriptConfig {
                    id: (*id).into(),
                    ..script(name)
                })
                .collect(),
            ..Config::default()
        }
    }

    #[test]
    fn put_adds_replaces_and_restores() {
        let mut config = with(&[("s_1", "Run tests")]);
        put(&mut config, script("  Lint  "));
        assert_eq!(config.scripts.len(), 2);
        assert_eq!(config.scripts[1].name, "Lint");
        assert!(config.scripts[1].id.starts_with("s_"));
        put(
            &mut config,
            ScriptConfig {
                id: "s_1".into(),
                ..script("Test")
            },
        );
        assert_eq!(config.scripts[0].name, "Test");
        put(
            &mut config,
            ScriptConfig {
                id: "s_9".into(),
                ..script("Back")
            },
        );
        assert_eq!(config.scripts[2].id, "s_9");
    }

    #[test]
    fn remove_drops_the_script() {
        let mut config = with(&[("s_1", "a"), ("s_2", "b")]);
        remove(&mut config, "s_1").unwrap();
        assert_eq!(config.scripts.len(), 1);
        assert!(remove(&mut config, "s_1").is_err());
    }

    #[test]
    fn reorder_needs_every_id_once() {
        let mut config = with(&[("s_1", "a"), ("s_2", "b"), ("s_3", "c")]);
        let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        reorder(&mut config, &ids(&["s_3", "s_1", "s_2"])).unwrap();
        let names: Vec<&str> = config.scripts.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["c", "a", "b"]);
        assert!(reorder(&mut config, &ids(&["s_1", "s_2"])).is_err());
        assert!(reorder(&mut config, &ids(&["s_1", "s_1", "s_2"])).is_err());
    }

    #[test]
    fn import_replaces_or_keeps_both_and_asks_first() {
        let mut config = with(&[("s_1", "Run tests")]);
        add_imported(
            &mut config,
            vec![
                ScriptConfig {
                    command: "pnpm test --coverage".into(),
                    ..script("run tests")
                },
                script("Deploy preview"),
            ],
            &["Run tests".into()],
        );
        assert_eq!(config.scripts.len(), 2);
        assert_eq!(config.scripts[0].id, "s_1");
        assert_eq!(config.scripts[0].command, "pnpm test --coverage");
        assert!(config.scripts.iter().all(|s| s.ask_first));

        add_imported(
            &mut config,
            vec![ScriptConfig {
                disabled: true,
                ..script("Lint")
            }],
            &[],
        );
        assert!(config.scripts[2].disabled);

        add_imported(&mut config, vec![script("Deploy preview")], &[]);
        assert_eq!(config.scripts[3].name, "Deploy preview (2)");
        assert_ne!(config.scripts[3].id, config.scripts[1].id);
    }

    #[test]
    fn free_names_count_up() {
        let config = with(&[("s_1", "Run tests"), ("s_2", "run tests (2)")]);
        assert_eq!(free_name(&config, "Run tests"), "Run tests (3)");
        assert_eq!(position_by_name(&config, " RUN TESTS "), Some(0));
    }
}
