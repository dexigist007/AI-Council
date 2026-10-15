//! Fixed endpoints and auth styles per provider.
//!
//! The base URL and auth header are decided here, never by the WebView: a compromised or buggy
//! frontend can choose a path on the provider's own API, but cannot send a key anywhere else.

pub enum Auth {
    /// `Authorization: Bearer <key>` (OpenAI and OpenAI-compatible APIs).
    Bearer,
    /// `x-api-key: <key>` plus a pinned API version header.
    Anthropic,
    /// `x-goog-api-key: <key>`.
    Google,
}

pub struct Provider {
    pub base_url: &'static str,
    pub auth: Auth,
}

pub fn lookup(id: &str) -> Option<Provider> {
    let (base_url, auth) = match id {
        "openai" => ("https://api.openai.com/v1", Auth::Bearer),
        "anthropic" => ("https://api.anthropic.com/v1", Auth::Anthropic),
        "gemini" => (
            "https://generativelanguage.googleapis.com/v1beta",
            Auth::Google,
        ),
        "deepseek" => ("https://api.deepseek.com/v1", Auth::Bearer),
        "kimi" => ("https://api.moonshot.ai/v1", Auth::Bearer),
        "glm" => ("https://api.z.ai/api/paas/v4", Auth::Bearer),
        _ => return None,
    };
    Some(Provider { base_url, auth })
}

/// Joins a provider base URL with a frontend-supplied path and checks the result stays on the
/// provider's host and under its base path.
pub fn build_url(p: &Provider, path: &str) -> Result<url::Url, String> {
    if !path.starts_with('/')
        || path.contains("..")
        || path.contains('@')
        || path.contains('\\')
        || path.contains("//")
    {
        return Err(format!("invalid path: {path}"));
    }
    let base = url::Url::parse(p.base_url).map_err(|e| e.to_string())?;
    let full = url::Url::parse(&format!("{}{}", p.base_url, path)).map_err(|e| e.to_string())?;
    if full.scheme() != "https"
        || full.host_str() != base.host_str()
        || !full.path().starts_with(base.path())
    {
        return Err(format!("path escapes provider API: {path}"));
    }
    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_normal_paths() {
        let p = lookup("gemini").unwrap();
        let u = build_url(&p, "/models/gemini-x:streamGenerateContent?alt=sse").unwrap();
        assert_eq!(u.host_str(), Some("generativelanguage.googleapis.com"));
        assert!(build_url(&lookup("glm").unwrap(), "/chat/completions").is_ok());
    }

    #[test]
    fn rejects_escapes() {
        let p = lookup("openai").unwrap();
        for bad in [
            "models",
            "/../x",
            "@evil.com/x",
            "//evil.com/x",
            "/x\\y",
            ".evil.com/x",
        ] {
            assert!(build_url(&p, bad).is_err(), "{bad} should be rejected");
        }
        assert!(lookup("evil").is_none());
    }
}
