# AI Council

Kişisel, local-first multi-AI council masaüstü uygulaması (Tauri + Vue 3 + Quasar + SQLite).
Mimari: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Geliştirme

Gereksinimler: Node 22+, Rust (stable), platform önkoşulları: https://tauri.app/start/prerequisites/

```bash
npm install
npm run tauri dev     # masaüstü uygulamasını geliştirme modunda açar
npm run tauri build   # macOS: .app/.dmg, Windows: NSIS installer
npm run typecheck
```
