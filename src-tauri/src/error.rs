//! `AppError`, the error type every command returns.

#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "code", content = "message", rename_all = "snake_case")]
pub enum AppError {
    /// From libgit2 errors (conversion in `git/mod.rs`).
    #[error("git error: {0}")]
    Git(String),
    #[error("not a git repository: {0}")]
    NotARepo(String),
    #[error("name conflict: {0}")]
    NameConflict(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("io: {0}")]
    Io(String),
    /// Input the user can fix, e.g. a script without a name.
    #[error("invalid: {0}")]
    Invalid(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_code_and_message() {
        let json = serde_json::to_value(AppError::NotFound("p_1".into())).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "code": "not_found", "message": "p_1" })
        );
    }
}
