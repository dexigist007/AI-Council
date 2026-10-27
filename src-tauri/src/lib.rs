// Native layer stays thin: secrets, ai_http, indexer, git and fs commands land here in later phases.

mod ai_http;
mod git;
mod projects;
mod providers;
mod secrets;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Database file name, resolved by the sql plugin inside the app config directory.
/// Must match `DB_URL` in `src/db/client.ts`.
const DB_URL: &str = "sqlite:ai-council.db";

#[derive(serde::Serialize)]
struct AppInfo {
    version: &'static str,
    os: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
    }
}

/// Append-only: never edit a shipped migration, add a new one.
/// The same files are applied in tests (`src/db/testing.ts`).
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "core",
            sql: include_str!("../migrations/0001_core.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "indexing",
            sql: include_str!("../migrations/0002_indexing.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "settings",
            sql: include_str!("../migrations/0003_settings.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// The app was renamed from "AI Council" (com.dexigist.aicouncil) to Conclave, which moved its
/// config dir. Copy the database and project list over once, so earlier users keep their data.
/// Runs before the frontend opens the database. Failures are logged, never fatal.
fn migrate_from_working_title(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(new_dir) = app.path().app_config_dir() else { return };
    let Some(old_dir) = new_dir.parent().map(|p| p.join("com.dexigist.aicouncil")) else { return };
    if new_dir.join("ai-council.db").exists() || !old_dir.join("ai-council.db").exists() {
        return;
    }
    if let Err(e) = copy_files(&old_dir, &new_dir, &["ai-council.db", "ai-council.db-wal", "ai-council.db-shm", "roots.json"]) {
        eprintln!("could not move data from {}: {e}", old_dir.display());
    }
}

fn copy_files(from: &std::path::Path, to: &std::path::Path, names: &[&str]) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for name in names {
        let src = from.join(name);
        if src.exists() {
            std::fs::copy(&src, to.join(name))?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ai_http::Cancels::default())
        .setup(|app| {
            migrate_from_working_title(app.handle());
            app.manage(projects::load_roots(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_exists,
            secrets::secret_clear_all,
            ai_http::ai_request,
            ai_http::ai_cancel,
            projects::project_pick_folder,
            projects::project_forget_root,
            projects::project_forget_all,
            projects::project_default_excludes,
            projects::project_scan,
            projects::project_read_files,
            git::git_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running Conclave");
}

#[cfg(test)]
mod rename_tests {
    use super::copy_files;

    #[test]
    fn copies_present_files_and_skips_missing() {
        let base = std::env::temp_dir().join(format!("conclave-mig-{}", std::process::id()));
        let (old, new) = (base.join("old"), base.join("new"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("ai-council.db"), b"db").unwrap();
        copy_files(&old, &new, &["ai-council.db", "roots.json"]).unwrap();
        assert_eq!(std::fs::read(new.join("ai-council.db")).unwrap(), b"db");
        assert!(!new.join("roots.json").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }
}
