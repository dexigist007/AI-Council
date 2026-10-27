//! API keys in the OS credential store (macOS Keychain, Windows Credential Manager).
//! There is deliberately no command that returns a key to the WebView (ADR-0004).
//!
//! macOS asks for the login password whenever an app without a matching code signature reads a
//! Keychain item, once per item. So on macOS all keys live in ONE item ("vault", a JSON map) and
//! every store is read at most once per app run and kept in memory: at most one prompt per launch,
//! none after "Always Allow" (until a differently signed build). Windows limits an item to ~2.5 KB,
//! so there each provider keeps its own item; it never prompts.

use std::collections::HashMap;
use std::sync::Mutex;

use keyring::Entry;

/// Keychain service name. Kept from the app's working title so saved keys stay found.
const SERVICE: &str = "com.dexigist.aicouncil";

/// Keys by provider, loaded from the store on first use. `None` = not loaded yet.
static CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn check(provider: &str) -> Result<(), String> {
    if crate::providers::lookup(provider).is_none() {
        return Err(format!("unknown provider: {provider}"));
    }
    Ok(())
}

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

/// Reads one item; a missing item is `None`, any other failure (e.g. access denied) an error.
fn get(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn remove(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(target_os = "macos")]
mod store {
    use super::*;

    const VAULT: &str = "vault";

    pub fn load() -> Result<HashMap<String, String>, String> {
        if let Some(json) = get(VAULT)? {
            return serde_json::from_str(&json).map_err(|e| format!("keychain vault is corrupt: {e}"));
        }
        // First run of this version: move per-provider items (older versions) into the vault.
        let mut keys = HashMap::new();
        for id in crate::providers::IDS {
            if let Some(k) = get(id)? {
                keys.insert((*id).to_string(), k);
            }
        }
        if !keys.is_empty() {
            save(&keys)?;
            for id in keys.keys() {
                let _ = remove(id); // best effort: the vault is the source of truth now
            }
        }
        Ok(keys)
    }

    pub fn save(keys: &HashMap<String, String>) -> Result<(), String> {
        let json = serde_json::to_string(keys).map_err(|e| e.to_string())?;
        entry(VAULT)?.set_password(&json).map_err(|e| e.to_string())
    }

    pub fn set(keys: &HashMap<String, String>, _provider: &str) -> Result<(), String> {
        save(keys)
    }

    pub fn delete(keys: &HashMap<String, String>, _provider: &str) -> Result<(), String> {
        save(keys)
    }
}

#[cfg(not(target_os = "macos"))]
mod store {
    use super::*;

    pub fn load() -> Result<HashMap<String, String>, String> {
        let mut keys = HashMap::new();
        for id in crate::providers::IDS {
            if let Some(k) = get(id)? {
                keys.insert((*id).to_string(), k);
            }
        }
        Ok(keys)
    }

    pub fn set(keys: &HashMap<String, String>, provider: &str) -> Result<(), String> {
        entry(provider)?.set_password(&keys[provider]).map_err(|e| e.to_string())
    }

    pub fn delete(_keys: &HashMap<String, String>, provider: &str) -> Result<(), String> {
        remove(provider)
    }
}

/// Runs `f` on the loaded keys, loading them from the store first if needed. A failed load is not
/// cached, so a denied prompt can be retried.
fn with_keys<T>(f: impl FnOnce(&mut HashMap<String, String>) -> Result<T, String>) -> Result<T, String> {
    let mut guard = CACHE.lock().map_err(|_| "secret cache poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(store::load()?);
    }
    f(guard.as_mut().expect("loaded above"))
}

/// Used by `ai_http`; never exposed as a command.
pub fn read(provider: &str) -> Result<String, String> {
    check(provider)?;
    with_keys(|keys| keys.get(provider).cloned().ok_or_else(|| format!("no API key saved for {provider}")))
}

#[tauri::command]
pub fn secret_set(provider: String, key: String) -> Result<(), String> {
    check(&provider)?;
    let key = key.trim();
    if key.is_empty() {
        return Err("empty key".into());
    }
    with_keys(|keys| {
        let previous = keys.insert(provider.clone(), key.to_string());
        store::set(keys, &provider).inspect_err(|_| {
            // Keep memory in step with the store when the write fails.
            match previous {
                Some(p) => keys.insert(provider.clone(), p),
                None => keys.remove(&provider),
            };
        })
    })
}

#[tauri::command]
pub fn secret_delete(provider: String) -> Result<(), String> {
    check(&provider)?;
    with_keys(|keys| {
        let Some(previous) = keys.remove(&provider) else { return Ok(()) };
        store::delete(keys, &provider).inspect_err(|_| {
            keys.insert(provider.clone(), previous);
        })
    })
}

#[tauri::command]
pub fn secret_exists(provider: String) -> Result<bool, String> {
    check(&provider)?;
    with_keys(|keys| Ok(keys.contains_key(&provider)))
}

/// Removes every stored key ("Delete all data" in Settings).
#[tauri::command]
pub fn secret_clear_all() -> Result<(), String> {
    let mut guard = CACHE.lock().map_err(|_| "secret cache poisoned".to_string())?;
    #[cfg(target_os = "macos")]
    remove("vault")?;
    for id in crate::providers::IDS {
        remove(id)?; // older per-provider items, and every item on Windows/Linux
    }
    *guard = Some(HashMap::new());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs a real OS credential store; on Linux run under `keyctl session -`.
    #[test]
    #[ignore]
    fn set_exists_read_delete_through_cache() {
        let p = "mistral".to_string();
        secret_delete(p.clone()).unwrap();
        assert!(!secret_exists(p.clone()).unwrap());
        secret_set(p.clone(), "  key-1  ".into()).unwrap();
        assert_eq!(read(&p).unwrap(), "key-1");
        // A fresh load from the store sees the same data the cache does.
        *CACHE.lock().unwrap() = None;
        assert!(secret_exists(p.clone()).unwrap());
        secret_delete(p.clone()).unwrap();
        *CACHE.lock().unwrap() = None;
        assert!(!secret_exists(p.clone()).unwrap());
        assert!(read("evil").is_err());
    }
}
