use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

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
    let ValidPath { path: target } = validate_existing_path(&path)?;
    open_platform_path(&target)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreviewItem {
    path: String,
    estimated_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreviewSkipped {
    path: String,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreviewSummary {
    reviewed_count: usize,
    accepted_count: usize,
    skipped_count: usize,
    reclaimable_bytes: u64,
    summary: String,
    skipped: Vec<CleanupPreviewSkipped>,
}

#[tauri::command]
pub fn preview_cleanup(items: Vec<CleanupPreviewItem>) -> Result<CleanupPreviewSummary, String> {
    let mut summary = CleanupPreviewSummary {
        reviewed_count: items.len(),
        accepted_count: 0,
        skipped_count: 0,
        reclaimable_bytes: 0,
        summary: String::new(),
        skipped: Vec::new(),
    };

    for item in items {
        match validate_existing_path(&item.path) {
            Ok(_) => {
                summary.accepted_count += 1;
                summary.reclaimable_bytes = summary
                    .reclaimable_bytes
                    .saturating_add(item.estimated_bytes);
            }
            Err(reason) => {
                summary.skipped_count += 1;
                summary.skipped.push(CleanupPreviewSkipped {
                    path: item.path,
                    reason,
                });
            }
        }
    }

    summary.summary = format!(
        "Review only: {} of {} target(s) would reclaim {} bytes. No files were deleted.",
        summary.accepted_count, summary.reviewed_count, summary.reclaimable_bytes
    );

    Ok(summary)
}

struct ValidPath {
    path: PathBuf,
}

fn validate_existing_path(raw: &str) -> Result<ValidPath, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Path is empty.".to_string());
    }
    if trimmed.contains("#rest") {
        return Err("Synthetic grouped items cannot be used for file actions.".to_string());
    }

    let candidate = PathBuf::from(trimmed);
    let metadata =
        fs::symlink_metadata(&candidate).map_err(|_| "Path does not exist.".to_string())?;
    if is_reparse_or_symlink(&metadata) {
        return Err("Links and reparse points are not supported for this action.".to_string());
    }
    if !metadata.is_dir() && !metadata.is_file() {
        return Err("This filesystem entry type is not supported.".to_string());
    }

    let path = fs::canonicalize(&candidate)
        .map_err(|_| "Path could not be prepared for this action.".to_string())?;

    Ok(ValidPath { path })
}

#[cfg(windows)]
fn open_platform_path(target: &Path) -> Result<(), String> {
    let display_path = strip_verbatim_prefix(&target.to_string_lossy()).into_owned();
    let selected_arg = format!("/select,{display_path}");

    let mut command = Command::new("explorer");
    if target.parent().is_some() {
        command.arg(selected_arg);
    } else {
        command.arg(display_path);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|_| "Failed to open Explorer.".to_string())
}

#[cfg(target_os = "macos")]
fn open_platform_path(target: &Path) -> Result<(), String> {
    Command::new("open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Failed to open the path.".to_string())
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn open_platform_path(target: &Path) -> Result<(), String> {
    let launch_target = if target.is_file() {
        target.parent().unwrap_or(target)
    } else {
        target
    };

    Command::new("xdg-open")
        .arg(launch_target)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Failed to open the path.".to_string())
}

#[cfg(windows)]
fn is_reparse_or_symlink(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes()
        & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
        != 0
}

#[cfg(not(windows))]
fn is_reparse_or_symlink(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
fn strip_verbatim_prefix(path: &str) -> std::borrow::Cow<'_, str> {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        std::borrow::Cow::Owned(format!(r"\\{rest}"))
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        std::borrow::Cow::Borrowed(rest)
    } else {
        std::borrow::Cow::Borrowed(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, time::SystemTime};

    struct TempTree {
        root: PathBuf,
    }

    impl TempTree {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = env::temp_dir().join(format!(
                "fileshousing_commands_{name}_{}_{}",
                std::process::id(),
                unique
            ));
            fs::create_dir(&root).unwrap();
            Self { root }
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn path_validation_rejects_empty_synthetic_and_missing_paths() {
        assert!(validate_existing_path("").is_err());
        assert!(validate_existing_path("C:\\example#rest").is_err());

        let missing = env::temp_dir().join("fileshousing_missing_action_path");
        assert!(validate_existing_path(&missing.to_string_lossy()).is_err());
    }

    #[test]
    fn path_validation_accepts_existing_regular_file() {
        let temp = TempTree::new("valid_file");
        let file = temp.root.join("keep.txt");
        fs::write(&file, b"ok").unwrap();

        let validated = validate_existing_path(&file.to_string_lossy()).unwrap();
        assert!(validated.path.exists());
    }

    #[test]
    fn cleanup_preview_counts_only_valid_existing_paths() {
        let temp = TempTree::new("preview");
        let file = temp.root.join("candidate.bin");
        fs::write(&file, b"ok").unwrap();

        let summary = preview_cleanup(vec![
            CleanupPreviewItem {
                path: file.to_string_lossy().into_owned(),
                estimated_bytes: 12,
            },
            CleanupPreviewItem {
                path: format!("{}#rest", temp.root.to_string_lossy()),
                estimated_bytes: 99,
            },
        ])
        .unwrap();

        assert_eq!(summary.reviewed_count, 2);
        assert_eq!(summary.accepted_count, 1);
        assert_eq!(summary.skipped_count, 1);
        assert_eq!(summary.reclaimable_bytes, 12);
        assert_eq!(summary.skipped.len(), 1);
        assert!(summary.summary.contains("No files were deleted"));
    }
}
