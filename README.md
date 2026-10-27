# Conclave

_Previously developed under the working title "AI Council"._

Kişisel, local-first multi-AI council masaüstü uygulaması (Tauri + Vue 3 + Quasar + SQLite).
Kaynak kod bilgisayarından çıkmaz; yalnızca seçtiğin parçalar, maskelenerek, seçtiğin AI sağlayıcısına gider.

Mimari ve kararlar: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/adr/](docs/adr/)

## Özellikler

- **Ideas:** fikir değerlendirme ve KILL THIS IDEA (Council: bağımsız analiz → çapraz eleştiri → Judge),
  karar + rubrik raporu, senin onayınla Decision Log ve Idea Graveyard, benzer fikir uyarısı.
- **Projects:** klasör ekleme, .gitignore'a uyan artımlı indeksleme, yerel kod araması, teknoloji tespiti.
- **Project Brain:** OBSERVED / INFERRED / USER CONFIRMED bilgiler; AI taslağı onayın olmadan Brain'e girmez.
- **Ask Project:** yerel aramayla seçilen kod parçalarıyla soru-cevap; referanslar kodla doğrulanır.
- **Audit / Findings:** AI'sız yerel tarama + Council denetimi, kural tabanlı P0–P3, kanıt doğrulama.
- **Git Changes / Review Changes:** durum, commit'ler, diff ve değişiklik incelemesi.
- **Sağlayıcılar:** OpenAI, Anthropic, Gemini, DeepSeek, Kimi, GLM. Anahtarlar OS anahtar deposunda.

## Geliştirme

Gereksinimler: Node 22+, Rust (stable), git, platform önkoşulları: https://tauri.app/start/prerequisites/

```bash
npm install
npm run tauri dev     # masaüstü uygulamasını geliştirme modunda açar
npm run tauri build   # macOS: .app/.dmg, Windows: NSIS installer
npm run typecheck
npm test              # TypeScript testleri (gerçek migration dosyalarıyla, in-memory SQLite)
cd src-tauri && cargo test   # Rust testleri
```

## İlk kullanım

1. Settings → en az bir sağlayıcıya API anahtarı, varsayılan model ve (maliyet takibi için) fiyat gir.
2. Ideas → bir fikir yaz → Council başlat.
3. Projects → klasör ekle → Overview / Brain / Ask / Audit / Git Changes.
