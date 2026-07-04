use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{Instant, SystemTime},
};

use crate::models::{Cat, Disk, FsNode, FsNodeKind, ScanRoot, ScanRootKind};

const TOP_CHILDREN: usize = 32;
const ROOT_CHILDREN: usize = 48;
const MAX_SCAN_DEPTH: usize = 96;

pub fn list_scan_roots() -> Vec<ScanRoot> {
    let mut roots = platform_scan_roots();

    if let Some(home) = home_dir() {
        let home_id = "home".to_string();
        let home_path = home.to_string_lossy().into_owned();
        if !roots.iter().any(|root| path_eq(&root.path, &home_path)) {
            roots.push(ScanRoot {
                id: home_id,
                name: "Home".to_string(),
                path: home_path,
                total_bytes: volume_total_bytes(&home).unwrap_or(0),
                kind: ScanRootKind::Directory,
            });
        }
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

    let root_path = normalize_existing(&selected)?;
    let metadata = fs::symlink_metadata(&root_path)
        .map_err(|err| format!("unable to inspect {}: {err}", root_path.display()))?;
    if is_reparse_or_symlink(&metadata) {
        return Err(format!(
            "refusing to scan reparse point {}",
            root_path.display()
        ));
    }

    let now = SystemTime::now();
    let started = Instant::now();
    let root_name = root_display_name(&root_path);
    let root = if metadata.is_dir() {
        scan_dir(&root_path, root_name.clone(), None, 0, now)
    } else if metadata.is_file() {
        scan_file(&root_path, root_name.clone(), None, &metadata, now)
    } else {
        return Err(format!(
            "unsupported filesystem entry {}",
            root_path.display()
        ));
    };

    eprintln!(
        "fileshousing scan {}: {} files, {} bytes in {:.2?}",
        root_path.display(),
        root.count,
        root.size,
        started.elapsed()
    );

    let label = root_display_name(&root_path);
    let letter = drive_letter(&root_path).unwrap_or_else(|| label.clone());
    let total_bytes = volume_total_bytes(&root_path).unwrap_or(root.size);

    Ok(Disk {
        letter,
        label,
        total_bytes,
        root,
    })
}

fn scan_dir(
    path: &Path,
    name: String,
    parent_id: Option<u64>,
    depth: usize,
    now: SystemTime,
) -> FsNode {
    let id = stable_path_id(path);
    if depth >= MAX_SCAN_DEPTH {
        return FsNode {
            id,
            path: path_to_string(path),
            parent_id,
            name,
            kind: FsNodeKind::Dir,
            cat: Cat::Other,
            size: 0,
            days: 0.0,
            count: 0,
            children: Vec::new(),
        };
    }

    let limit = if depth == 0 {
        ROOT_CHILDREN
    } else {
        TOP_CHILDREN
    };
    let mut acc = ChildAccumulator::new(limit);

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            if let Some(child) = scan_entry(&entry, id, depth + 1, now) {
                acc.add(child);
            }
        }
    }

    let (children, stats) = acc.finish(path, id);
    FsNode {
        id,
        path: path_to_string(path),
        parent_id,
        name,
        kind: FsNodeKind::Dir,
        cat: stats.cats.dominant(),
        size: stats.size,
        days: stats.days(),
        count: stats.count,
        children,
    }
}

fn scan_entry(
    entry: &fs::DirEntry,
    parent_id: u64,
    depth: usize,
    now: SystemTime,
) -> Option<FsNode> {
    let path = entry.path();
    let metadata = fs::symlink_metadata(&path).ok()?;
    if is_reparse_or_symlink(&metadata) {
        return None;
    }

    let name = entry.file_name().to_string_lossy().into_owned();
    if metadata.is_dir() {
        Some(scan_dir(&path, name, Some(parent_id), depth, now))
    } else if metadata.is_file() {
        Some(scan_file(&path, name, Some(parent_id), &metadata, now))
    } else {
        None
    }
}

fn scan_file(
    path: &Path,
    name: String,
    parent_id: Option<u64>,
    metadata: &fs::Metadata,
    now: SystemTime,
) -> FsNode {
    FsNode {
        id: stable_path_id(path),
        path: path_to_string(path),
        parent_id,
        cat: categorize_file(path, &name),
        name,
        kind: FsNodeKind::File,
        size: metadata.len(),
        days: metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|duration| duration.as_secs_f64() / 86_400.0)
            .unwrap_or(0.0),
        count: 1,
        children: Vec::new(),
    }
}

struct CatSizes {
    values: [u64; 11],
}

impl CatSizes {
    fn new() -> Self {
        Self { values: [0; 11] }
    }

    fn add(&mut self, cat: Cat, size: u64) {
        self.values[cat_index(cat)] = self.values[cat_index(cat)].saturating_add(size);
    }

    fn dominant(&self) -> Cat {
        let mut best_idx = cat_index(Cat::Other);
        let mut best_size = 0;
        for (idx, size) in self.values.iter().enumerate() {
            if *size > best_size {
                best_size = *size;
                best_idx = idx;
            }
        }
        cat_from_index(best_idx)
    }
}

struct NodeStats {
    size: u64,
    count: u64,
    days: f64,
    cats: CatSizes,
}

impl NodeStats {
    fn new() -> Self {
        Self {
            size: 0,
            count: 0,
            days: f64::INFINITY,
            cats: CatSizes::new(),
        }
    }

    fn add_node(&mut self, node: &FsNode) {
        self.size = self.size.saturating_add(node.size);
        self.count = self.count.saturating_add(node.count);
        self.days = self.days.min(node.days);
        self.cats.add(node.cat, node.size);
    }

    fn days(&self) -> f64 {
        if self.days.is_finite() {
            self.days
        } else {
            0.0
        }
    }
}

struct RestAgg {
    size: u64,
    count: u64,
    days: f64,
    cats: CatSizes,
}

impl RestAgg {
    fn new() -> Self {
        Self {
            size: 0,
            count: 0,
            days: f64::INFINITY,
            cats: CatSizes::new(),
        }
    }

    fn add_node(&mut self, node: FsNode) {
        self.size = self.size.saturating_add(node.size);
        self.count = self.count.saturating_add(node.count);
        self.days = self.days.min(node.days);
        self.cats.add(node.cat, node.size);
    }
}

struct ChildAccumulator {
    shown: Vec<FsNode>,
    rest: RestAgg,
    stats: NodeStats,
    limit: usize,
}

impl ChildAccumulator {
    fn new(limit: usize) -> Self {
        Self {
            shown: Vec::with_capacity(limit + 1),
            rest: RestAgg::new(),
            stats: NodeStats::new(),
            limit,
        }
    }

    fn add(&mut self, child: FsNode) {
        self.stats.add_node(&child);
        if child.size == 0 {
            return;
        }
        if self.shown.len() < self.limit {
            self.shown.push(child);
            return;
        }

        let mut min_idx = 0;
        let mut min_size = self.shown[0].size;
        for (idx, node) in self.shown.iter().enumerate().skip(1) {
            if node.size < min_size {
                min_idx = idx;
                min_size = node.size;
            }
        }

        if child.size > min_size {
            let evicted = self.shown.swap_remove(min_idx);
            self.rest.add_node(evicted);
            self.shown.push(child);
        } else {
            self.rest.add_node(child);
        }
    }

    fn finish(mut self, path: &Path, parent_id: u64) -> (Vec<FsNode>, NodeStats) {
        self.shown
            .sort_unstable_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
        if self.rest.size > 0 {
            let rest_count = self.rest.count;
            self.shown.push(FsNode {
                id: stable_rest_id(path),
                path: format!("{}#rest", path_to_string(path)),
                parent_id: Some(parent_id),
                name: format!("{rest_count} smaller items"),
                kind: FsNodeKind::Rest,
                cat: self.rest.cats.dominant(),
                size: self.rest.size,
                days: if self.rest.days.is_finite() {
                    self.rest.days
                } else {
                    0.0
                },
                count: rest_count,
                children: Vec::new(),
            });
            self.shown
                .sort_unstable_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
        }
        (self.shown, self.stats)
    }
}

fn categorize_file(path: &Path, name: &str) -> Cat {
    if is_system_file(name)
        || has_path_component(
            path,
            &["Windows", "System Volume Information", "$Recycle.Bin"],
        )
    {
        return Cat::System;
    }
    if has_path_component(path, &["steamapps", "XboxGames"]) {
        return Cat::Game;
    }

    let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    if ext_in(
        ext,
        &[
            "mp4", "mkv", "mov", "avi", "wmv", "webm", "m4v", "flv", "braw", "r3d", "mts", "m2ts",
        ],
    ) {
        Cat::Video
    } else if ext_in(
        ext,
        &[
            "jpg", "jpeg", "png", "gif", "bmp", "svg", "webp", "heic", "tif", "tiff", "raw", "psd",
            "ai",
        ],
    ) {
        Cat::Image
    } else if ext_in(ext, &["mp3", "wav", "flac", "m4a", "aac", "ogg", "wma"]) {
        Cat::Audio
    } else if ext_in(
        ext,
        &[
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "md", "csv", "epub",
            "one",
        ],
    ) {
        Cat::Doc
    } else if ext_in(
        ext,
        &[
            "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "cs", "cpp", "c", "h", "hpp",
            "json", "toml", "yaml", "yml", "html", "css", "scss", "sql", "php", "rb", "swift",
            "kt", "lock", "xml",
        ],
    ) {
        Cat::Code
    } else if ext_in(
        ext,
        &[
            "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "cab", "tgz", "zst",
        ],
    ) {
        Cat::Archive
    } else if ext_in(
        ext,
        &[
            "exe", "msi", "dll", "sys", "com", "bat", "cmd", "ps1", "appx", "msix", "jar",
        ],
    ) || has_path_component(path, &["Program Files", "Program Files (x86)"])
    {
        Cat::App
    } else if ext_in(
        ext,
        &[
            "db", "sqlite", "sqlite3", "parquet", "dat", "bin", "blob", "ldb", "log", "cache",
        ],
    ) {
        Cat::Data
    } else {
        Cat::Other
    }
}

fn ext_in(ext: &str, values: &[&str]) -> bool {
    values.iter().any(|value| ext.eq_ignore_ascii_case(value))
}

fn is_system_file(name: &str) -> bool {
    ["pagefile.sys", "hiberfil.sys", "swapfile.sys"]
        .iter()
        .any(|value| name.eq_ignore_ascii_case(value))
}

fn has_path_component(path: &Path, names: &[&str]) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|value| names.iter().any(|name| value.eq_ignore_ascii_case(name)))
    })
}

#[cfg(windows)]
fn platform_scan_roots() -> Vec<ScanRoot> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};

    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;

    let mask = unsafe { GetLogicalDrives() };
    let mut roots = Vec::with_capacity(26);
    for index in 0..26 {
        if mask & (1 << index) == 0 {
            continue;
        }

        let letter = (b'A' + index as u8) as char;
        let path = format!("{letter}:\\");
        let wide = wide_null(Path::new(&path).as_os_str());
        let drive_type = unsafe { GetDriveTypeW(wide.as_ptr()) };
        if drive_type != DRIVE_FIXED && drive_type != DRIVE_REMOVABLE {
            continue;
        }

        let label = volume_label(Path::new(&path)).unwrap_or_else(|| "Local Disk".to_string());
        roots.push(ScanRoot {
            id: letter.to_string(),
            path,
            name: format!("{letter}: {label}"),
            total_bytes: volume_total_bytes(Path::new(&format!("{letter}:\\"))).unwrap_or(0),
            kind: ScanRootKind::Drive,
        });
    }
    roots
}

#[cfg(not(windows))]
fn platform_scan_roots() -> Vec<ScanRoot> {
    vec![ScanRoot {
        id: "/".to_string(),
        path: "/".to_string(),
        name: "/".to_string(),
        total_bytes: 0,
        kind: ScanRootKind::Drive,
    }]
}

#[cfg(windows)]
fn volume_total_bytes(path: &Path) -> Option<u64> {
    disk_space(path).map(|(total, _free)| total)
}

#[cfg(not(windows))]
fn volume_total_bytes(_path: &Path) -> Option<u64> {
    None
}

#[cfg(windows)]
fn disk_space(path: &Path) -> Option<(u64, u64)> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let root = windows_volume_root(path)?;
    let wide = wide_null(root.as_os_str());
    let mut free_to_user = 0u64;
    let mut total = 0u64;
    let mut free_total = 0u64;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_to_user,
            &mut total,
            &mut free_total,
        )
    };
    if ok == 0 {
        None
    } else {
        Some((total, free_to_user))
    }
}

#[cfg(windows)]
fn volume_label(path: &Path) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::GetVolumeInformationW;

    let root = windows_volume_root(path)?;
    let wide = wide_null(root.as_os_str());
    let mut label = [0u16; 260];
    let ok = unsafe {
        GetVolumeInformationW(
            wide.as_ptr(),
            label.as_mut_ptr(),
            label.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };
    if ok == 0 {
        return None;
    }
    let len = label.iter().position(|value| *value == 0).unwrap_or(0);
    if len == 0 {
        None
    } else {
        Some(String::from_utf16_lossy(&label[..len]))
    }
}

#[cfg(windows)]
fn windows_volume_root(path: &Path) -> Option<PathBuf> {
    drive_letter(path).map(|letter| PathBuf::from(format!("{letter}:\\")))
}

#[cfg(windows)]
fn wide_null(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain([0]).collect()
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
fn stable_path_id(path: &Path) -> u64 {
    use std::os::windows::ffi::OsStrExt;

    let mut hash = 0xcbf29ce484222325u64;
    for unit in path.as_os_str().encode_wide() {
        let folded = if (b'A' as u16..=b'Z' as u16).contains(&unit) {
            unit + 32
        } else {
            unit
        };
        hash = fnv_step(hash, (folded & 0xff) as u8);
        hash = fnv_step(hash, (folded >> 8) as u8);
    }
    nonzero_hash(hash)
}

#[cfg(not(windows))]
fn stable_path_id(path: &Path) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in path.to_string_lossy().bytes() {
        hash = fnv_step(hash, byte.to_ascii_lowercase());
    }
    nonzero_hash(hash)
}

fn stable_rest_id(path: &Path) -> u64 {
    let mut hash = stable_path_id(path);
    for byte in b"#rest" {
        hash = fnv_step(hash, *byte);
    }
    nonzero_hash(hash)
}

fn fnv_step(hash: u64, byte: u8) -> u64 {
    (hash ^ byte as u64).wrapping_mul(1_099_511_628_211)
}

fn nonzero_hash(hash: u64) -> u64 {
    if hash == 0 {
        1
    } else {
        hash
    }
}

fn normalize_existing(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    fs::canonicalize(path).or_else(|_| Ok(path.to_path_buf()))
}

fn root_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .or_else(|| drive_letter(path).map(|letter| format!("{letter}:")))
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn drive_letter(path: &Path) -> Option<String> {
    use std::path::{Component, Prefix};

    if let Some(Component::Prefix(prefix)) = path.components().next() {
        let letter = match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => letter,
            _ => return None,
        };
        return Some((letter as char).to_ascii_uppercase().to_string());
    }

    let text = path.to_string_lossy();
    let bytes = text.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        Some((bytes[0] as char).to_ascii_uppercase().to_string())
    } else {
        None
    }
}

#[cfg(not(windows))]
fn drive_letter(path: &Path) -> Option<String> {
    let text = strip_verbatim_prefix(&path.to_string_lossy());
    let bytes = text.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        Some((bytes[0] as char).to_ascii_uppercase().to_string())
    } else {
        None
    }
}

fn path_to_string(path: &Path) -> String {
    strip_verbatim_prefix(&path.to_string_lossy()).into_owned()
}

fn strip_verbatim_prefix(path: &str) -> std::borrow::Cow<'_, str> {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        std::borrow::Cow::Owned(format!(r"\\{rest}"))
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        std::borrow::Cow::Borrowed(rest)
    } else {
        std::borrow::Cow::Borrowed(path)
    }
}

fn path_eq(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn cat_index(cat: Cat) -> usize {
    match cat {
        Cat::Video => 0,
        Cat::Image => 1,
        Cat::Audio => 2,
        Cat::Doc => 3,
        Cat::Code => 4,
        Cat::Archive => 5,
        Cat::App => 6,
        Cat::Game => 7,
        Cat::System => 8,
        Cat::Data => 9,
        Cat::Other => 10,
    }
}

fn cat_from_index(index: usize) -> Cat {
    match index {
        0 => Cat::Video,
        1 => Cat::Image,
        2 => Cat::Audio,
        3 => Cat::Doc,
        4 => Cat::Code,
        5 => Cat::Archive,
        6 => Cat::App,
        7 => Cat::Game,
        8 => Cat::System,
        9 => Cat::Data,
        _ => Cat::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
                "fileshousing_{name}_{}_{}",
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
    fn scan_synthetic_tree_keeps_top_children_bounded() {
        let temp = TempTree::new("scan_tree");

        for dir_idx in 0..6 {
            let dir = temp.root.join(format!("dir_{dir_idx}"));
            fs::create_dir(&dir).unwrap();
            for file_idx in 0..12 {
                let file = fs::File::create(dir.join(format!("file_{file_idx}.bin"))).unwrap();
                file.set_len(((dir_idx + 1) * (file_idx + 1) * 1024) as u64)
                    .unwrap();
            }
        }
        for file_idx in 0..80 {
            let file = fs::File::create(temp.root.join(format!("loose_{file_idx}.dat"))).unwrap();
            file.set_len(((file_idx + 1) * 512) as u64).unwrap();
        }

        let started = Instant::now();
        let node = scan_dir(&temp.root, "root".to_string(), None, 0, SystemTime::now());
        let elapsed = started.elapsed();
        eprintln!(
            "scanner timing check: {} files, {} bytes, {:?}",
            node.count, node.size, elapsed
        );

        assert_eq!(node.count, 152);
        assert!(node.children.len() <= ROOT_CHILDREN + 1);
        assert!(node
            .children
            .iter()
            .any(|child| matches!(child.kind, FsNodeKind::Rest)));
        for child in &node.children {
            assert!(child.children.len() <= TOP_CHILDREN + 1);
        }
    }

    #[test]
    fn classification_matches_frontend_categories() {
        assert!(matches!(
            categorize_file(Path::new("movie.MKV"), "movie.MKV"),
            Cat::Video
        ));
        assert!(matches!(
            categorize_file(Path::new("photo.webp"), "photo.webp"),
            Cat::Image
        ));
        assert!(matches!(
            categorize_file(Path::new("song.flac"), "song.flac"),
            Cat::Audio
        ));
        assert!(matches!(
            categorize_file(Path::new("notes.md"), "notes.md"),
            Cat::Doc
        ));
        assert!(matches!(
            categorize_file(Path::new("main.rs"), "main.rs"),
            Cat::Code
        ));
        assert!(matches!(
            categorize_file(Path::new("backup.7z"), "backup.7z"),
            Cat::Archive
        ));
        assert!(matches!(
            categorize_file(Path::new("setup.exe"), "setup.exe"),
            Cat::App
        ));
        assert!(matches!(
            categorize_file(Path::new("pagefile.sys"), "pagefile.sys"),
            Cat::System
        ));
        assert!(matches!(
            categorize_file(Path::new("store.sqlite3"), "store.sqlite3"),
            Cat::Data
        ));
    }

    #[test]
    fn stable_ids_are_repeatable_and_case_folded() {
        let upper = stable_path_id(Path::new("A/B.TXT"));
        let lower = stable_path_id(Path::new("a/b.txt"));
        assert_eq!(upper, lower);
        assert_eq!(upper, stable_path_id(Path::new("A/B.TXT")));
        assert_ne!(upper, stable_rest_id(Path::new("A/B.TXT")));
    }

    #[test]
    fn scan_root_reports_missing_path_without_panicking() {
        let missing = env::temp_dir().join("fileshousing_missing_scan_root");
        let result = scan_root(Some(missing.to_string_lossy().into_owned()));
        assert!(result.is_err());
    }

    #[test]
    fn verbatim_windows_paths_are_serialized_for_ui_actions() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\Users\Axel").as_ref(),
            r"C:\Users\Axel"
        );
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share").as_ref(),
            r"\\server\share"
        );
    }
}
