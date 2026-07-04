mod models;
mod scanner;

#[cfg(not(test))]
mod commands;

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::list_scan_roots,
            commands::scan_root,
            commands::open_path_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run FilesHousing");
}
