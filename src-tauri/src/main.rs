// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Set by Info.plist's LSEnvironment for malloc, which has read it by now; git, scripts and
    // editors started from Gitgel should not inherit it.
    std::env::remove_var("MallocLargeCache");
    // ssh-add's SSH_ASKPASS (`ssh.rs`): print the passphrase and stop, before Tauri starts.
    if gitgel_lib::ssh::askpass() {
        return;
    }
    gitgel_lib::run()
}
