# ADR-0004: API anahtarları WebView'a girmez
Durum: Kabul edildi

Anahtarlar OS keychain'de (`keyring` crate) tutulur. AI istekleri Rust `ai_http` komutu üzerinden
gider; Rust anahtarı ekler ve yanıtı stream eder. TS yalnızca istek gövdesini kurar. Ek fayda:
WebView CORS sorunları ortadan kalkar.
