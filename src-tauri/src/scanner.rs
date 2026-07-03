use std::{
    env, fs,
    path::{Path, PathBuf},
};

use crate::models::{Cat, Disk, FsNode, FsNodeKind, ScanRoot, ScanRootKind};

const SYNTHETIC_TOTAL_BYTES: u64 = 256 * 1024 * 1024 * 1024;

pub fn list_scan_roots() -> Vec<ScanRoot> {
    let mut roots = Vec::with_capacity(28);

    #[cfg(windows)]
    {
        let mask = unsafe { windows_sys::Win32::Storage::FileSystem::GetLogicalDrives() };
        for index in 0..26 {
            if mask & (1 << index) == 0 {
                continue;
            }
            let letter = (b'A' + index as u8) as char;
            let path = format!("{letter}:\\");
            roots.push(ScanRoot {
                id: letter.to_string(),
                path,
                name: format!("{letter}:"),
                total_bytes: 0,
                kind: ScanRootKind::Drive,
            });
        }
    }

    #[cfg(not(windows))]
    roots.push(ScanRoot {
        id: "/".to_string(),
        path: "/".to_string(),
        name: "/".to_string(),
        total_bytes: 0,
        kind: ScanRootKind::Drive,
    });

    if let Some(home) = home_dir() {
        roots.push(ScanRoot {
            id: "home".to_string(),
            name: "Home".to_string(),
            path: home.to_string_lossy().into_owned(),
            total_bytes: 0,
            kind: ScanRootKind::Directory,
        });
    }

    roots
}

pub fn scan_root(path: Option<String>) -> Result<Disk, String> {
    let selected = path
        .map(PathBuf::from)
        .or_else(|| {
            list_scan_roots()
                .into_iter()
                .next()
                .map(|root| PathBuf::from(root.path))
        })
        .unwrap_or_else(|| PathBuf::from("."));

    let root_path = normalize_existing_or_raw(&selected);
    Ok(synthetic_disk(&root_path))
}

fn synthetic_disk(root_path: &Path) -> Disk {
    let root_name = root_display_name(root_path);
    let root_path_str = root_path.to_string_lossy().into_owned();
    let letter = drive_letter(root_path).unwrap_or_else(|| root_name.clone());

    let children = vec![
        FsNode {
            id: 2,
            path: join_display_path(&root_path_str, "Users"),
            parent_id: Some(1),
            name: "Users".to_string(),
            kind: FsNodeKind::Dir,
            cat: Cat::Doc,
            size: 18 * 1024 * 1024 * 1024,
            days: 2.0,
            count: 320,
            children: vec![FsNode {
                id: 5,
                path: join_display_path(&join_display_path(&root_path_str, "Users"), "Documents"),
                parent_id: Some(2),
                name: "Documents".to_string(),
                kind: FsNodeKind::Dir,
                cat: Cat::Doc,
                size: 6 * 1024 * 1024 * 1024,
                days: 8.0,
                count: 180,
                children: Vec::new(),
            }],
        },
        FsNode {
            id: 3,
            path: join_display_path(&root_path_str, "Program Files"),
            parent_id: Some(1),
            name: "Program Files".to_string(),
            kind: FsNodeKind::Dir,
            cat: Cat::App,
            size: 12 * 1024 * 1024 * 1024,
            days: 15.0,
            count: 140,
            children: Vec::new(),
        },
        FsNode {
            id: 4,
            path: join_display_path(&root_path_str, "pagefile.sys"),
            parent_id: Some(1),
            name: "pagefile.sys".to_string(),
            kind: FsNodeKind::File,
            cat: Cat::System,
            size: 4 * 1024 * 1024 * 1024,
            days: 0.0,
            count: 1,
            children: Vec::new(),
        },
    ];

    let used_bytes = children.iter().map(|node| node.size).sum();
    let count = children.iter().map(|node| node.count).sum();

    Disk {
        letter,
        label: root_name.clone(),
        total_bytes: SYNTHETIC_TOTAL_BYTES,
        root: FsNode {
            id: 1,
            path: root_path_str,
            parent_id: None,
            name: root_name,
            kind: FsNodeKind::Dir,
            cat: Cat::Other,
            size: used_bytes,
            days: 0.0,
            count,
            children,
        },
    }
}

fn normalize_existing_or_raw(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn root_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .or_else(|| drive_letter(path).map(|letter| format!("{letter}:")))
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn drive_letter(path: &Path) -> Option<String> {
    let text = path.to_string_lossy();
    let bytes = text.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        Some((bytes[0] as char).to_ascii_uppercase().to_string())
    } else {
        None
    }
}

fn join_display_path(base: &str, child: &str) -> String {
    let separator = std::path::MAIN_SEPARATOR;
    if base.ends_with(separator) {
        format!("{base}{child}")
    } else {
        format!("{base}{separator}{child}")
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}
