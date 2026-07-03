use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[allow(dead_code)]
#[serde(rename_all = "lowercase")]
pub enum Cat {
    Video,
    Image,
    Audio,
    Doc,
    Code,
    Archive,
    App,
    Game,
    System,
    Data,
    Other,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[allow(dead_code)]
#[serde(rename_all = "lowercase")]
pub enum FsNodeKind {
    Dir,
    File,
    Rest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsNode {
    pub id: u64,
    pub path: String,
    pub parent_id: Option<u64>,
    pub name: String,
    pub kind: FsNodeKind,
    pub cat: Cat,
    pub size: u64,
    pub days: f64,
    pub count: u64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FsNode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    pub letter: String,
    pub label: String,
    pub total_bytes: u64,
    pub root: FsNode,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRoot {
    pub id: String,
    pub path: String,
    pub name: String,
    pub total_bytes: u64,
    pub kind: ScanRootKind,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScanRootKind {
    Drive,
    Directory,
}
