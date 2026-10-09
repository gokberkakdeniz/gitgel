//! SSH key passphrases (SPEC §15 "SSH passphrase"): saving one in the login Keychain with Apple's
//! `ssh-add --apple-use-keychain`, which also checks it and adds the key to the agent. The
//! passphrase reaches ssh-add through `SSH_ASKPASS`: Gitgel's own binary, started with
//! `GITGEL_ASKPASS=1`, prints `GITGEL_ASKPASS_SECRET` (`main.rs`). It is never logged or kept.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::AppError;

/// ssh-add asks again after a wrong passphrase, and the askpass answers the same: stop it then.
const TIMEOUT: Duration = Duration::from_secs(10);

// A `Command` exception (SPEC §0): it runs ssh-add, never git.
#[allow(clippy::disallowed_methods)]
pub fn remember(key: &str, passphrase: &str) -> Result<(), AppError> {
    let path = std::path::Path::new(key);
    if !path.is_absolute() || !path.is_file() {
        return Err(AppError::Invalid(format!("no key at {key}")));
    }
    let exe = std::env::current_exe()?;
    let mut child = Command::new("/usr/bin/ssh-add")
        .arg("--apple-use-keychain")
        .arg(path)
        .env("SSH_ASKPASS", exe)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("GITGEL_ASKPASS", "1")
        .env("GITGEL_ASKPASS_SECRET", passphrase)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return if status.success() {
                log::info!("saved the passphrase of {key} in the Keychain");
                Ok(())
            } else {
                log::warn!("ssh-add could not save the passphrase of {key} ({status})");
                Err(AppError::Invalid(
                    "The passphrase could not be saved.".into(),
                ))
            };
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            log::warn!("ssh-add did not accept the passphrase of {key}");
            return Err(AppError::Invalid(
                "The passphrase could not be saved.".into(),
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// `SSH_ASKPASS` mode, before anything else starts: the passphrase `remember` handed over.
/// Returns false when this process is not an askpass.
pub fn askpass() -> bool {
    if std::env::var_os("GITGEL_ASKPASS").is_none() {
        return false;
    }
    if let Some(secret) = std::env::var_os("GITGEL_ASKPASS_SECRET") {
        use std::io::Write;
        use std::os::unix::ffi::OsStrExt;
        let mut out = std::io::stdout();
        let _ = out.write_all(secret.as_bytes());
        let _ = out.write_all(b"\n");
    }
    true
}
