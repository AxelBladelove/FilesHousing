use std::{path::PathBuf, process::Command};

use crate::{
    models::{Disk, ScanRoot},
    scanner,
};

#[tauri::command]
pub fn list_scan_roots() -> Vec<ScanRoot> {
    scanner::list_scan_roots()
}

#[tauri::command]
pub fn scan_root(path: Option<String>) -> Result<Disk, String> {
    scanner::scan_root(path)
}

#[tauri::command]
pub fn open_path_in_explorer(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let target = path
        .canonicalize()
        .map_err(|err| format!("path does not exist or cannot be opened: {err}"))?;

    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("failed to open Explorer: {err}"))
    }

    #[cfg(not(windows))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("failed to open path: {err}"))
    }
}
