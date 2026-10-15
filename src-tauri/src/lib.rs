// Native layer stays thin: secrets, ai_http, indexer, git and fs commands land here in later phases.

mod ai_http;
mod providers;
mod secrets;

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
    vec![Migration {
        version: 1,
        description: "core",
        sql: include_str!("../migrations/0001_core.sql"),
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .manage(ai_http::Cancels::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_exists,
            ai_http::ai_request,
            ai_http::ai_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Council");
}
