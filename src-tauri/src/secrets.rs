//! API keys in the OS credential store (macOS Keychain, Windows Credential Manager).
//! There is deliberately no command that returns a key to the WebView (ADR-0004).

use keyring::Entry;

const SERVICE: &str = "com.dexigist.aicouncil";

fn entry(provider: &str) -> Result<Entry, String> {
    if crate::providers::lookup(provider).is_none() {
        return Err(format!("unknown provider: {provider}"));
    }
    Entry::new(SERVICE, provider).map_err(|e| e.to_string())
}

/// Used by `ai_http`; never exposed as a command.
pub fn read(provider: &str) -> Result<String, String> {
    entry(provider)?.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => format!("no API key saved for {provider}"),
        other => other.to_string(),
    })
}

#[tauri::command]
pub fn secret_set(provider: String, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("empty key".into());
    }
    entry(&provider)?
        .set_password(key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(provider: String) -> Result<(), String> {
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_exists(provider: String) -> Result<bool, String> {
    match entry(&provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
