//! Custom themes: the `themes` folder beside `config.json` (docs/SPEC.md §4 "Themes"). The
//! backend only hands the files over; the frontend checks them against the schema.

use std::path::Path;

use serde::Serialize;

/// The schema the built-in themes are written to, kept in the folder so a custom theme can name
/// it in `$schema`.
const SCHEMA: &str = include_str!("../../src/themes/theme.schema.json");
const SCHEMA_FILE: &str = "theme.schema.json";
/// A theme file is a few kilobytes; anything far larger is not one.
const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ThemeFile {
    /// The file name, for messages.
    pub name: String,
    pub content: String,
}

/// The `*.json` files of `dir` by name, unparsed. Creates the folder and keeps its copy of the
/// schema current. A folder or file that cannot be read is skipped.
pub fn read(dir: &Path) -> Vec<ThemeFile> {
    if std::fs::create_dir_all(dir).is_err() {
        return Vec::new();
    }
    let schema = dir.join(SCHEMA_FILE);
    if std::fs::read_to_string(&schema).ok().as_deref() != Some(SCHEMA) {
        let _ = std::fs::write(&schema, SCHEMA);
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<ThemeFile> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".json") || name == SCHEMA_FILE || name.starts_with('.') {
                return None;
            }
            let meta = entry.metadata().ok()?;
            if !meta.is_file() || meta.len() > MAX_BYTES {
                return None;
            }
            let content = std::fs::read_to_string(entry.path()).ok()?;
            Some(ThemeFile { name, content })
        })
        .collect();
    files.sort_by(|a, b| a.name.cmp(&b.name));
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_json_files_and_writes_the_schema() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("themes");
        assert_eq!(read(&dir), []);
        assert_eq!(
            std::fs::read_to_string(dir.join(SCHEMA_FILE)).unwrap(),
            SCHEMA
        );

        std::fs::write(dir.join("night.json"), "{\"id\":\"night\"}").unwrap();
        std::fs::write(dir.join("dawn.json"), "{").unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();
        std::fs::write(dir.join(SCHEMA_FILE), "old").unwrap();
        let names: Vec<String> = read(&dir).into_iter().map(|f| f.name).collect();
        assert_eq!(names, ["dawn.json", "night.json"]);
        assert_eq!(
            std::fs::read_to_string(dir.join(SCHEMA_FILE)).unwrap(),
            SCHEMA
        );
    }
}
