// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ssh-add's SSH_ASKPASS (`ssh.rs`): print the passphrase and stop, before Tauri starts.
    if gitgel_lib::ssh::askpass() {
        return;
    }
    gitgel_lib::run()
}
