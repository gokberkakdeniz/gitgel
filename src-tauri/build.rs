fn main() {
    // tauri.conf.json takes the app version from package.json, which tauri-build does not watch:
    // without this a release bump leaves dev builds reporting the old version (and offering the
    // new one as an update).
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build()
}
