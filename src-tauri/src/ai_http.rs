//! The single path from the app to AI provider APIs. Adds the key from the credential store,
//! sends the request, and either returns the body or streams SSE `data:` payloads over a channel.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::Notify;

use crate::providers::{self, Auth};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    provider: String,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    stream: bool,
    /// Set by the caller when the request may be cancelled with `ai_cancel`.
    request_id: Option<String>,
}

/// Pending cancellation signals, keyed by request id.
#[derive(Default)]
pub struct Cancels(Mutex<HashMap<String, Arc<Notify>>>);

impl Cancels {
    fn register(&self, id: &str) -> Arc<Notify> {
        let notify = Arc::new(Notify::new());
        self.0
            .lock()
            .unwrap()
            .insert(id.to_string(), notify.clone());
        notify
    }

    fn remove(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
}

#[tauri::command]
pub fn ai_cancel(request_id: String, cancels: State<'_, Cancels>) {
    if let Some(n) = cancels.0.lock().unwrap().get(&request_id) {
        // notify_one stores a permit, so a cancel that races ahead of the request still lands.
        n.notify_one();
    }
}

#[derive(Serialize)]
pub struct AiResponse {
    status: u16,
    /// Full body for non-streaming requests and for error responses; None when streamed.
    body: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum StreamEvent {
    /// One SSE `data:` payload, unparsed; each provider adapter parses its own format.
    Data(String),
}

/// Shared client. TLS roots are bundled (webpki), so this does not depend on the system trust
/// store; a build failure is reported as an error instead of crashing the app.
fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(20))
                // Long council turns can stream for many minutes; only stalls should fail.
                .read_timeout(Duration::from_secs(300))
                .build()
                .map_err(|e| format!("could not start the HTTP client: {e}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

#[tauri::command]
pub async fn ai_request(
    req: AiRequest,
    on_event: Channel<StreamEvent>,
    cancels: State<'_, Cancels>,
) -> Result<AiResponse, String> {
    let Some(id) = req.request_id.clone() else {
        return perform(req, on_event).await;
    };
    let cancelled = cancels.register(&id);
    let result = tokio::select! {
        r = perform(req, on_event) => r,
        _ = cancelled.notified() => Err("cancelled".to_string()),
    };
    cancels.remove(&id);
    result
}

async fn perform(req: AiRequest, on_event: Channel<StreamEvent>) -> Result<AiResponse, String> {
    let provider =
        providers::lookup(&req.provider).ok_or(format!("unknown provider: {}", req.provider))?;
    let url = providers::build_url(&provider, &req.path)?;
    let key = match provider.auth {
        Auth::None => String::new(),
        _ => crate::secrets::read(&req.provider)?,
    };

    let method = match req.method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        m => return Err(format!("unsupported method: {m}")),
    };
    let mut builder = client()?.request(method, url);
    builder = match provider.auth {
        Auth::Bearer => builder.bearer_auth(&key),
        Auth::Anthropic => builder
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01"),
        Auth::Google => builder.header("x-goog-api-key", &key),
        Auth::None => builder,
    };
    if let Some(body) = &req.body {
        builder = builder
            .header("content-type", "application/json")
            .body(serde_json::to_vec(body).map_err(|e| e.to_string())?);
    }

    let res = builder
        .send()
        .await
        .map_err(|e| format!("request failed: {}", error_chain(&e)))?;
    let status = res.status().as_u16();
    if !req.stream || !res.status().is_success() {
        let body = res.text().await.map_err(|e| e.to_string())?;
        return Ok(AiResponse {
            status,
            body: Some(body),
        });
    }

    let mut parser = SseParser::default();
    let mut bytes = res.bytes_stream();
    while let Some(chunk) = bytes.next().await {
        let chunk = chunk.map_err(|e| format!("stream interrupted: {}", error_chain(&e)))?;
        for data in parser.push(&chunk) {
            on_event
                .send(StreamEvent::Data(data))
                .map_err(|e| e.to_string())?;
        }
    }
    for data in parser.finish() {
        on_event
            .send(StreamEvent::Data(data))
            .map_err(|e| e.to_string())?;
    }
    Ok(AiResponse { status, body: None })
}

/// reqwest's Display hides the cause (DNS, TLS, proxy); include the whole source chain.
fn error_chain(e: &dyn std::error::Error) -> String {
    let mut msg = e.to_string();
    let mut cur = e.source();
    while let Some(src) = cur {
        msg.push_str(": ");
        msg.push_str(&src.to_string());
        cur = src.source();
    }
    msg
}

/// Minimal SSE parser: collects `data:` lines per event (blank line terminates an event).
/// Ignores `event:`, `id:` and comments; adapters read the type from the JSON payload.
#[derive(Default)]
struct SseParser {
    buf: Vec<u8>,
    data: Vec<String>,
}

impl SseParser {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            self.line(line.trim_end_matches(['\n', '\r']), &mut out);
        }
        out
    }

    fn finish(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        if !self.buf.is_empty() {
            let rest = String::from_utf8_lossy(&std::mem::take(&mut self.buf)).into_owned();
            self.line(rest.trim_end_matches(['\n', '\r']), &mut out);
        }
        self.line("", &mut out);
        out
    }

    fn line(&mut self, line: &str, out: &mut Vec<String>) {
        if line.is_empty() {
            if !self.data.is_empty() {
                out.push(self.data.join("\n"));
                self.data.clear();
            }
        } else if let Some(v) = line.strip_prefix("data:") {
            self.data.push(v.strip_prefix(' ').unwrap_or(v).to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SseParser;

    #[test]
    fn splits_events_across_chunks() {
        let mut p = SseParser::default();
        assert!(p.push(b"event: x\ndata: {\"a\"").is_empty());
        assert_eq!(
            p.push(b":1}\r\n\r\ndata: [DONE]\n\n"),
            vec!["{\"a\":1}", "[DONE]"]
        );
        assert_eq!(p.push(b"data: tail"), Vec::<String>::new());
        assert_eq!(p.finish(), vec!["tail"]);
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// End-to-end through keychain + URL guard + HTTP: a fake key must come back as a 401 from
    /// the real API. Needs network and a usable OS keyring: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn fake_key_reaches_provider_and_gets_401() {
        crate::secrets::secret_set("anthropic".into(), "sk-ant-invalid-test-key".into()).unwrap();
        assert!(crate::secrets::secret_exists("anthropic".into()).unwrap());
        let req = AiRequest {
            provider: "anthropic".into(),
            method: "GET".into(),
            path: "/models".into(),
            body: None,
            stream: false,
            request_id: None,
        };
        let res = tauri::async_runtime::block_on(perform(req, Channel::new(|_| Ok(())))).unwrap();
        crate::secrets::secret_delete("anthropic".into()).unwrap();
        assert_eq!(res.status, 401, "body: {:?}", res.body);
        assert!(!crate::secrets::secret_exists("anthropic".into()).unwrap());
    }
}
