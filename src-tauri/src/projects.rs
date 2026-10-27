//! Project folders: selection, the allowlist of readable roots, scanning and reading.
//!
//! The WebView can only read files under roots the user picked in a native folder dialog.
//! The allowlist lives in `roots.json` in the app config dir, so it survives restarts and a
//! compromised frontend cannot widen it.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Defaults from the requirements plus common build/cache dirs; users add more per project.
pub const DEFAULT_EXCLUDES: &[&str] = &[
    "node_modules/",
    "vendor/",
    "dist/",
    "build/",
    ".cache/",
    ".git/",
    "Pods/",
    "DerivedData/",
    "coverage/",
    "tmp/",
    "logs/",
    ".gradle/",
    ".idea/",
    ".next/",
    ".nuxt/",
    "__pycache__/",
    ".venv/",
    "venv/",
    "target/",
    "*.min.js",
    "*.min.css",
    "*.map",
];
/// Files above this size are listed but not read.
const MAX_FILE_BYTES: u64 = 512 * 1024;
/// Stop listing after this many files; a sign that excludes are missing.
const MAX_FILES: usize = 20_000;
const MEDIA_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "icns", "tif", "tiff", "psd", "mp3", "wav",
    "ogg", "flac", "aac", "m4a", "mp4", "mov", "avi", "mkv", "webm", "pdf", "zip", "gz", "tgz",
    "rar", "7z", "jar", "aar", "apk", "aab", "ipa", "dmg", "exe", "dll", "so", "dylib", "a", "o",
    "class", "woff", "woff2", "ttf", "otf", "eot", "sqlite", "db", "bin",
];
const LOCK_FILES: &[&str] = &[
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "composer.lock",
    "Podfile.lock",
    "poetry.lock",
    "Gemfile.lock",
    "go.sum",
    "pubspec.lock",
];

/// Readable roots. On macOS each root may hold a security-scoped grant (see `scoped`), which keeps
/// the folder readable inside the App Sandbox after a relaunch; dropping it ends the access.
#[derive(Default)]
pub struct Roots(Mutex<Vec<PathBuf>>, Mutex<Vec<(PathBuf, scoped::Grant)>>);

/// One saved root. Older versions stored a bare path list; both formats load.
#[derive(Serialize, Deserialize, Clone)]
struct RootEntry {
    path: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bookmark: Option<Vec<u8>>,
}

fn roots_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("roots.json"))
}

fn read_entries(app: &AppHandle) -> Vec<RootEntry> {
    let Some(text) = roots_file(app).ok().and_then(|f| fs::read_to_string(f).ok()) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<RootEntry>>(&text)
        .or_else(|_| {
            serde_json::from_str::<Vec<PathBuf>>(&text)
                .map(|ps| ps.into_iter().map(|path| RootEntry { path, bookmark: None }).collect())
        })
        .unwrap_or_default()
}

fn write_entries(app: &AppHandle, entries: &[RootEntry]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(roots_file(app)?, json).map_err(|e| e.to_string())
}

/// Loads saved roots and re-opens their security-scoped grants. A root whose grant cannot be
/// resolved stays listed (outside the sandbox the plain path still works); inside the sandbox
/// reads then fail with a clear error and the user can pick the folder again.
pub fn load_roots(app: &AppHandle) -> Roots {
    let mut entries = read_entries(app);
    let mut grants = Vec::new();
    let mut changed = false;
    for e in &mut entries {
        let Some(bookmark) = e.bookmark.clone() else { continue };
        match scoped::open(&bookmark) {
            Ok(opened) => {
                if opened.stale || opened.path != e.path {
                    e.path = opened.path.clone();
                    e.bookmark = scoped::create(&e.path).ok().or(e.bookmark.take());
                    changed = true;
                }
                grants.push((e.path.clone(), opened.grant));
            }
            Err(err) => eprintln!("project folder {} needs to be picked again: {err}", e.path.display()),
        }
    }
    if changed {
        let _ = write_entries(app, &entries);
    }
    Roots(Mutex::new(entries.into_iter().map(|e| e.path).collect()), Mutex::new(grants))
}

/// Resolves `root` and checks it was picked by the user.
pub fn allowed_root(roots: &Roots, root: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(root).map_err(|e| format!("cannot open {root}: {e}"))?;
    if roots.0.lock().unwrap().iter().any(|r| r == &canonical) {
        Ok(canonical)
    } else {
        Err(format!("folder is not a registered project: {root}"))
    }
}

/// Opens the native folder picker and registers the choice. Returns the canonical path.
#[tauri::command]
pub async fn project_pick_folder(
    app: AppHandle,
    roots: State<'_, Roots>,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let Some(picked) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    // Create the bookmark now, while the dialog's sandbox extension for this folder is active.
    let bookmark = scoped::create(&canonical).ok();
    let mut entries = read_entries(&app);
    entries.retain(|e| e.path != canonical);
    entries.push(RootEntry { path: canonical.clone(), bookmark });
    write_entries(&app, &entries)?;
    let mut list = roots.0.lock().unwrap();
    if !list.contains(&canonical) {
        list.push(canonical.clone());
    }
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn project_default_excludes() -> Vec<&'static str> {
    DEFAULT_EXCLUDES.to_vec()
}

#[tauri::command]
pub fn project_forget_root(
    app: AppHandle,
    roots: State<'_, Roots>,
    root: String,
) -> Result<(), String> {
    let Ok(canonical) = fs::canonicalize(&root) else {
        return Ok(());
    };
    let mut entries = read_entries(&app);
    entries.retain(|e| e.path != canonical);
    write_entries(&app, &entries)?;
    roots.0.lock().unwrap().retain(|r| r != &canonical);
    roots.1.lock().unwrap().retain(|(p, _)| p != &canonical); // drops the grant: access ends
    Ok(())
}

/// Forgets every project folder and ends all folder grants ("Delete all data" in Settings).
#[tauri::command]
pub fn project_forget_all(app: AppHandle, roots: State<'_, Roots>) -> Result<(), String> {
    write_entries(&app, &[])?;
    roots.0.lock().unwrap().clear();
    roots.1.lock().unwrap().clear();
    Ok(())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanEntry {
    /// Relative to the root, always with `/` separators.
    path: String,
    size: u64,
    mtime_ms: u64,
    /// Why the file is listed but its content is not read; None means indexable.
    skip: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    entries: Vec<ScanEntry>,
    truncated: bool,
}

fn rel_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    Some(
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

/// Credentials and keys are never read, so they can never be sent to a model.
pub fn is_sensitive(name: &str) -> bool {
    let lower = name.to_lowercase();
    (lower.starts_with(".env") && lower != ".env.example" && lower != ".env.sample")
        || [
            "id_rsa",
            "id_dsa",
            "id_ecdsa",
            "id_ed25519",
            "credentials.json",
            "service-account.json",
            ".npmrc",
            ".pypirc",
            ".netrc",
        ]
        .contains(&lower.as_str())
        || [
            ".pem",
            ".key",
            ".p12",
            ".pfx",
            ".keystore",
            ".jks",
            ".mobileprovision",
        ]
        .iter()
        .any(|e| lower.ends_with(e))
}

fn looks_binary(path: &Path) -> bool {
    let mut buf = [0u8; 8000];
    match fs::File::open(path).and_then(|mut f| f.read(&mut buf)) {
        Ok(n) => buf[..n].contains(&0),
        Err(_) => true,
    }
}

fn skip_reason(path: &Path, size: u64) -> Option<&'static str> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if is_sensitive(&name) {
        Some("sensitive")
    } else if LOCK_FILES.contains(&name.as_str()) {
        Some("lockfile")
    } else if MEDIA_EXT.contains(&ext.as_str()) {
        Some("binary")
    } else if size > MAX_FILE_BYTES {
        Some("too_large")
    } else if looks_binary(path) {
        Some("binary")
    } else {
        None
    }
}

pub fn scan(root: &Path, excludes: &[String]) -> Result<ScanResult, String> {
    let mut overrides = ignore::overrides::OverrideBuilder::new(root);
    for pattern in DEFAULT_EXCLUDES
        .iter()
        .map(|s| s.to_string())
        .chain(excludes.iter().cloned())
    {
        let p = pattern.trim();
        if p.is_empty() || p.starts_with('#') {
            continue;
        }
        // In override syntax a leading "!" means "ignore".
        overrides
            .add(&format!("!{}", p.trim_start_matches('!')))
            .map_err(|e| format!("bad exclude '{p}': {e}"))?;
    }
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false) // dotfiles like .github matter; .git is excluded explicitly
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false) // honour .gitignore even outside a git repo
        .overrides(overrides.build().map_err(|e| e.to_string())?)
        .build();

    let mut entries = Vec::new();
    let mut truncated = false;
    for item in walker {
        let Ok(item) = item else { continue };
        if !item.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if entries.len() >= MAX_FILES {
            truncated = true;
            break;
        }
        let Ok(meta) = item.metadata() else { continue };
        let Some(path) = rel_path(root, item.path()) else {
            continue;
        };
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        entries.push(ScanEntry {
            skip: skip_reason(item.path(), meta.len()),
            path,
            size: meta.len(),
            mtime_ms,
        });
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ScanResult { entries, truncated })
}

#[tauri::command]
pub async fn project_scan(
    roots: State<'_, Roots>,
    root: String,
    excludes: Vec<String>,
) -> Result<ScanResult, String> {
    let root = allowed_root(&roots, &root)?;
    tauri::async_runtime::spawn_blocking(move || scan(&root, &excludes))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct FileContent {
    path: String,
    content: Option<String>,
    error: Option<String>,
}

/// Resolves a relative path under the root, refusing anything that escapes it (including via symlinks).
pub fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("invalid path: {rel}"));
    }
    let full = fs::canonicalize(root.join(rel_path)).map_err(|e| e.to_string())?;
    if !full.starts_with(root) {
        return Err(format!("path escapes project: {rel}"));
    }
    Ok(full)
}

#[derive(Deserialize)]
pub struct ReadRequest {
    root: String,
    paths: Vec<String>,
}

#[tauri::command]
pub async fn project_read_files(
    roots: State<'_, Roots>,
    req: ReadRequest,
) -> Result<Vec<FileContent>, String> {
    let root = allowed_root(&roots, &req.root)?;
    tauri::async_runtime::spawn_blocking(move || {
        req.paths
            .into_iter()
            .map(|path| {
                let read = resolve_inside(&root, &path).and_then(|full| {
                    let name = full
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    if is_sensitive(&name) {
                        return Err("sensitive file is never read".to_string());
                    }
                    let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
                    if meta.len() > MAX_FILE_BYTES {
                        return Err("file too large".to_string());
                    }
                    fs::read(&full)
                        .map(|b| String::from_utf8_lossy(&b).into_owned())
                        .map_err(|e| e.to_string())
                });
                match read {
                    Ok(content) => FileContent {
                        path,
                        content: Some(content),
                        error: None,
                    },
                    Err(error) => FileContent {
                        path,
                        content: None,
                        error: Some(error),
                    },
                }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aic-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        for (p, c) in [
            ("src/main.ts", "console.log(1)"),
            ("src/gen/out.ts", "generated"),
            ("node_modules/x/index.js", "x"),
            (".gitignore", "src/gen/\n"),
            (".env", "SECRET=1"),
            (".env.example", "SECRET="),
            ("package-lock.json", "{}"),
            ("logo.png", "png"),
            ("docs/a.md", "# hi"),
            ("custom/skip.txt", "x"),
        ] {
            let f = dir.join(p);
            fs::create_dir_all(f.parent().unwrap()).unwrap();
            fs::write(f, c).unwrap();
        }
        fs::write(dir.join("bin.dat"), [0u8, 1, 2]).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn scan_applies_gitignore_defaults_and_skip_rules() {
        let root = fixture();
        let res = scan(&root, &["custom/".to_string()]).unwrap();
        let got: Vec<(&str, Option<&str>)> = res
            .entries
            .iter()
            .map(|e| (e.path.as_str(), e.skip))
            .collect();
        assert_eq!(
            got,
            vec![
                (".env", Some("sensitive")),
                (".env.example", None),
                (".gitignore", None),
                ("bin.dat", Some("binary")),
                ("docs/a.md", None),
                ("logo.png", Some("binary")),
                ("package-lock.json", Some("lockfile")),
                ("src/main.ts", None),
            ]
        );
        assert!(!res.truncated);
    }

    #[test]
    fn resolve_inside_rejects_escapes() {
        let root = fixture();
        assert!(resolve_inside(&root, "src/main.ts").is_ok());
        for bad in [
            "../etc/passwd",
            "/etc/passwd",
            "src/../../x",
            "./src/main.ts",
        ] {
            assert!(resolve_inside(&root, bad).is_err(), "{bad}");
        }
    }
}

/// Security-scoped bookmarks (macOS App Sandbox). Elsewhere these are no-ops.
#[cfg(target_os = "macos")]
mod scoped {
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSData, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL};
    use std::path::{Path, PathBuf};

    /// Keeps a folder readable until dropped. NSURL is immutable and documented thread-safe.
    pub struct Grant(Retained<NSURL>);
    unsafe impl Send for Grant {}
    unsafe impl Sync for Grant {}
    impl Drop for Grant {
        fn drop(&mut self) {
            unsafe { self.0.stopAccessingSecurityScopedResource() };
        }
    }

    pub struct Opened {
        pub grant: Grant,
        pub path: PathBuf,
        pub stale: bool,
    }

    pub fn create(path: &Path) -> Result<Vec<u8>, String> {
        let url = NSURL::from_directory_path(path).ok_or("invalid folder path")?;
        url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope
                | NSURLBookmarkCreationOptions::SecurityScopeAllowOnlyReadAccess,
            None,
            None,
        )
        .map(|d| d.to_vec())
        .map_err(|e| e.localizedDescription().to_string())
    }

    pub fn open(bookmark: &[u8]) -> Result<Opened, String> {
        let data = NSData::with_bytes(bookmark);
        let mut stale = Bool::NO;
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data,
                NSURLBookmarkResolutionOptions::WithSecurityScope,
                None,
                &mut stale,
            )
        }
        .map_err(|e| e.localizedDescription().to_string())?;
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return Err("access to the folder was revoked".into());
        }
        let path = url.to_file_path().ok_or("bookmark has no file path")?;
        Ok(Opened { grant: Grant(url), path, stale: stale.as_bool() })
    }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
mod scoped {
    use std::path::{Path, PathBuf};

    pub struct Grant;
    pub struct Opened {
        pub grant: Grant,
        pub path: PathBuf,
        pub stale: bool,
    }

    pub fn create(_path: &Path) -> Result<Vec<u8>, String> {
        Err("bookmarks are only used on macOS".into())
    }

    pub fn open(_bookmark: &[u8]) -> Result<Opened, String> {
        Err("bookmarks are only used on macOS".into())
    }
}
