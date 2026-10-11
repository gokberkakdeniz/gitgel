//! Keeps the app's memory down between scans. libgit2 caches objects per open repository (up to
//! 256 MB in total), which speeds a scan up but is not needed afterwards: the results live in
//! `cache.rs`. Freed blocks go back to macOS because the app is launched with
//! `MallocLargeCache=0` (`Info.plist`); malloc would otherwise keep the large ones for reuse.

use crate::state::AppState;

/// The process's physical footprint in MB (Activity Monitor's "Memory" column).
pub fn footprint_mb() -> u64 {
    let mut info = std::mem::MaybeUninit::<libc::rusage_info_v2>::zeroed();
    // SAFETY: `info` is a valid, writable rusage_info_v2 for the V2 flavour.
    let rc = unsafe {
        libc::proc_pid_rusage(
            std::process::id() as i32,
            libc::RUSAGE_INFO_V2,
            info.as_mut_ptr() as *mut libc::rusage_info_t,
        )
    };
    if rc != 0 {
        return 0;
    }
    // SAFETY: filled in by the successful call above.
    unsafe { info.assume_init() }.ri_phys_footprint >> 20
}

extern "C" {
    fn malloc_zone_pressure_relief(zone: *mut libc::c_void, goal: libc::size_t) -> libc::size_t;
}

/// After a full scan: closes the pooled repositories and hands freed memory back to macOS.
pub fn release(state: &AppState) {
    let before = footprint_mb();
    state.pool.clear();
    // SAFETY: a null zone means every malloc zone; goal 0 means release as much as possible.
    unsafe { malloc_zone_pressure_relief(std::ptr::null_mut(), 0) };
    log::info!(
        "memory: {before} → {} MB after closing repositories",
        footprint_mb()
    );
}
