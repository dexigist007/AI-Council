# AI Council — Mimari (Faz 0)

Kişisel, local-first, tek kullanıcılı masaüstü aracı (macOS + Windows). Birden fazla AI modelini
yapılandırılmış bir konsey olarak çalıştırır: (1) yeni fikirleri değerlendirir, (2) diskteki projeleri
indeksleyip denetler. Kendi backend'i yoktur; akış: `local → seçilmiş context → AI provider API`.

Onaylanan kararlar `docs/adr/` altındadır.

## 1. Katmanlar

```
Vue 3 + Quasar (WebView)
  pages / components / Pinia stores
  domain (TS): council, providers, prompts, context, findings, brain, cost
  db repositories ──(tauri-plugin-sql)──┐
Rust (ince katman)                      │
  secrets  : keyring (Keychain / Credential Manager)
  ai_http  : key'i keychain'den alıp HTTP isteği atar (streaming, Channel)
  indexer  : `ignore` crate ile walk + gitignore + binary/size filtresi
  git      : git CLI, sabit alt komut allowlist, shell yok
  fs       : dialog, yalnızca kayıtlı proje köklerinden okuma
                                        └── SQLite (WAL, FTS5)
```

Orkestrasyon tamamen TypeScript'te. API anahtarları WebView'a hiç girmez (ADR-0004).
Sağlayıcı endpoint'leri Rust'ta sabittir (ADR-0006).

## 2. Provider abstraction

```ts
interface AIProvider {
  id: ProviderId
  capabilities: { jsonSchema: boolean; promptCache: boolean; maxContext: number }
  chat(req: ChatRequest, onDelta?: (t: string) => void): Promise<ChatResponse>
  countTokens?(req: ChatRequest): Promise<number>
}
```

Adapter'lar: `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `OpenAICompatibleProvider`
(DeepSeek, Kimi, GLM — base_url + model ile). Uygulama yalnızca `ProviderRegistry.get(id)` görür.

## 3. Council engine

Orchestrator deterministik koddur (ADR-0002). Varsayılan akış (ADR-0003):

1. **Independent** — paralel; çıktı JSON: `claims[{id,text,type,confidence,evidence}]`, `risks`, `rubric`.
2. **Council State** — kod iddiaları birleştirir (gerekirse ucuz modelle kümeleme). Sonraki round'a uzun
   cevaplar değil, bu kompakt state gider.
3. **Critique** — Cross Review + Challenge birleşik: agree / disagree / missing / wrong-assumption + gerekçe.
4. **Revision** — yalnızca DEEP modda.
5. **Judge** — tercihen konsey dışı model; ayrışmalar raporda korunur.

BALANCED'da Critique her zaman çalışır: "ayrışma yok" kararını Critique'ten önce kodla güvenilir vermek
mümkün değil. FAST'te hiç çalışmaz. Her round öncesi temkinli bir bütçe tahmini yapılır (beklenen tam cevap
boyutuyla); limit aşılacaksa oturum o round başlamadan durur. Başarısız bir üye oturumu düşürmez, raporda
listelenir; Judge başarısızsa oturum başarısız olur. Geçici hatalar bir kez tekrar denenir, geçersiz JSON
bir kez onarılır; her deneme kayda geçer.

| Mod | Model | Round |
|---|---|---|
| FAST | 2 | Independent → Judge |
| BALANCED | 3 | Independent → Critique → Judge |
| DEEP | 4–6 | + Revision |
| KILL | preset | Roller fikri öldürmeye çalışır; ayakta kalırsa ayrıca belirtilir |

Fikir sonucu: karar (BUILD / VALIDATE / HOLD / REJECT) + rubrik (ADR-0001), 100'lük skor yok.

## 4. Veritabanı

```
projects(id, name, root_path, settings_json, created_at)
files(id, project_id, path, lang, size, hash, mtime, kind, indexed_at)
chunks(id, file_id, start_line, end_line, symbol, content, token_est)
chunks_fts   -- FTS5(content, symbol, path)
brain_facts(id, project_id, section, statement, source[observed|inferred|user_confirmed],
            evidence_json, origin_session_id, status[pending|active|superseded|rejected], updated_at)
ideas(id, title, body, status[draft|evaluating|build|validate|hold|rejected],
      reject_reason, revisit_condition, decided_session_id, created_at)   -- Graveyard = hold|rejected
sessions(id, project_id, idea_id, type, mode, status, config_json, final_report_json,
         est_cost, actual_cost, created_at)
session_messages(id, session_id, round, participant, provider, model, role, prompt_id,
                 prompt_version, request_files_json, response_text, response_json,
                 tokens_in, tokens_out, cached_tokens, cost, latency_ms)
findings(id, project_id, session_id, title, description, category, severity, confidence,
         verification, impact, risk, urgency, effort, priority, suggested_fix, status, fingerprint)
finding_evidence(id, finding_id, file_path, start_line, end_line, quote, verified)
decisions(id, project_id, title, reason, session_id, user_approved, decided_at)
provider_configs(provider, enabled, default_model, temperature, max_tokens, base_url)
model_prices(provider, model, in_per_mtok, out_per_mtok, cached_per_mtok)
```

İleride: `chunk_embeddings(chunk_id, model, vector)` (ör. sqlite-vec).

## 5. İndeksleme

- `ignore` crate: .gitignore + varsayılan exclusion (node_modules, vendor, dist, build, .cache, .git,
  Pods, DerivedData, coverage, tmp, logs) + proje bazlı include/exclude.
- Binary (NUL byte), >512KB, minified/generated dosyalar elenir; lock dosyaları yalnızca metadata.
- mtime + hash ile artımlı indeksleme.
- Chunk: ~80–150 satır, mümkünse fonksiyon/sınıf sınırında (regex). Tree-sitter sonra.
- Manifest'lerden dil/framework/dependency → OBSERVED.
- Retrieval: FTS5 BM25 + path/symbol eşleşmesi; sonraki adım read-only tool'larla agentic retrieval.
- Ask Project: arama terimleri sorudan doldurulur ama kullanıcı düzenler (AI ile terim üretimi yok);
  bulunan parçalar gönderimden önce listelenir ve seçilebilir (~12k token bütçe). Cevaptaki her referansın
  alıntısı, modele gönderilen metinde aranır; bulunamazsa UNVERIFIED, bulunursa satır numarası düzeltilir.
- FTS'te ayrıca tanımlayıcı parçaları tutulur (`loadPlaylist` → `load playlist`), böylece kelime parçasıyla
  arama kod tanımlayıcılarını bulur.
- Okunabilir klasörler: sadece kullanıcının native klasör diyaloğunda seçtiği kökler. İzin listesi Rust
  tarafında `roots.json`'da tutulur; WebView genişletemez. Kök dışına (sembolik link dahil) çıkan yollar
  reddedilir. `.env*`, anahtar ve sertifika dosyaları listelenir ama içerikleri hiç okunmaz.

## 6. Project Brain

Satır bazlı `brain_facts`. OBSERVED'ı yalnızca kod üretir; AI en fazla INFERRED yazar ve öneriler
`pending` bekler, kullanıcı onayıyla (gerekirse düzenleyerek) USER_CONFIRMED olur.

İlk taslak tek bir model çağrısıyla üretilir: dosya ağacı (sadece yollar), kök/docs README'leri ve
manifest'ler, maskelemeden geçirilerek gönderilir; gönderilecek dosyalar, maskeleme sayısı ve tahmini
maliyet çağrıdan önce gösterilir. Modelin uydurduğu dosya yolları kanıttan atılır. Yeni taslak sadece
bekleyen önerilerin yerini alır; onaylanmış veya reddedilmiş bilgilere dokunmaz.

Not: Tek modelli proje analizleri `sessions.type = 'ask_project'` altında, amacı `config.meta.purpose`
içinde kaydedilir. Sebep: SQLite'ta CHECK kısıtını değiştirmek tablo yeniden oluşturmayı gerektirir ve
yabancı anahtarlı alt tabloları riske atar. Yeni enum'lar için CHECK yerine uygulama tarafı doğrulama
tercih edilecek. Kararlar, reddedilen fikirler, açık işler
ayrı tutulmaz; ilgili tablolardan türetilir.

## 7. Findings ve öncelik

- AI her kanıt için dosya + satır + birebir alıntı verir; `EvidenceVerifier` alıntıyı dosyada arar,
  bulunamazsa `unverified`.
- AI impact / risk / urgency / effort girdilerini verir; P0–P3'ü deterministik formül hesaplar.
  Security + Critical → her zaman P0.
- `fingerprint` (kategori + ana dosya + başlığın anahtar kelimeleri) ile aynı bulgu tekrar kaydedilmez;
  tekrar görülen bulgunun durumu korunur (yanlış alarm işaretlenen geri açılmaz).
- Öncelik formülü (`domain/findings/priority.ts`): doğrulanmış kritik bulgu veya doğrulanmış yüksek
  önemli güvenlik/gizli bilgi bulgusu → P0; diğerleri önem, etki, risk, aciliyet ve eforla puanlanır.
  Kanıtı doğrulanamayan ya da "speculative" bulgular en fazla P2 olur.
- Yerel tarama (AI yok): yorum olarak yazılmış TODO/FIXME, kaynak koddaki olası gizli bilgiler (yorumlar,
  testler, dokümanlar ve yer tutucu değerler hariç; sadece bilinen anahtar biçimleri yüksek önem alır),
  800+ satırlık dosyalar, test dosyası olmaması.
- AI denetimi: her odak alanı için sabit bir anahtar kelime listesiyle yerel aramadan kaynak kod seçilir
  (toplam ~16k token, dokümanlar ve testler hariç); Council (rol seti alana göre) bulguları üretir, kanıtlar
  gönderilen metne karşı doğrulanır. Geliştirme fırsatları ayrı bir bulgu türü değil, raporun bir bölümüdür.

## 8. Güvenlik ve gizlilik

- Anahtarlar OS keychain'de; WebView görmez.
- Her çağrıdan önce gönderilecek dosya/satır, token tahmini ve provider gösterilir ve kaydedilir.
- Redaction: bilinen anahtar desenleri + entropi; `.env*`, `*.pem`, `id_rsa` vb. varsayılan gönderilmez.
- Prompt injection: kod içeriği veri olarak sınırlandırılır; modele yazma/komut/ağ aracı verilmez.
- Proje bazlı provider allowlist (veri yargı alanı).
- Git: shell yok, allowlist. fs scope: yalnızca kayıtlı proje kökleri.

## 9. Maliyet

Kullanıcı düzenlenebilir fiyat tablosu, oturum öncesi tahmin, `usage` ile gerçekleşen, oturum hard cap,
prompt caching.

## 10. MVP

Shell; SQLite + migration; proje + klasör seçimi; indeksleme + FTS5; OpenAI/Anthropic/Gemini +
OpenAICompatible; keychain + Rust HTTP proxy; Prompt Registry; Council (FAST/BALANCED);
New Idea + Kill + Graveyard; Ask Project; Basic audit → Findings; rapor ve oturum geçmişi;
redaction + gönderim önizlemesi + maliyet.

MVP dışı: Improvement Radar (audit'in "opportunities" bölümü olacak), Cross Project, Project Watch,
DEEP mod, embedding, tree-sitter. Review Changes MVP'ye sığmazsa ilk eklenecek.

## 11. Fazlar

| Faz | İçerik |
|---|---|
| 0 | Mimari + ADR'ler |
| 1 | Shell, routing, Quasar layout, sol menü |
| 2 | DB + migrations + repositories |
| 3 | Secrets + Rust `ai_http` + provider abstraction + Settings |
| 4 | Prompt Registry + Council engine + maliyet takibi |
| 5 | New Idea + Kill + Graveyard (ilk kullanılabilir sürüm) |
| 6 | Proje yönetimi + indeksleme + FTS |
| 7 | Project Brain |
| 8 | Ask Project |
| 9 | Audit + Findings + kanıt doğrulama + öncelik |
| 10 | Git + Review Changes |

## 12. Riskler

1. Halüsinasyonlu bulgular → kodla kanıt doğrulama.
2. Sağlayıcılar arası tutarsız yapılandırılmış çıktı → zod + tek seferlik repair.
3. Konseyin maliyetine değmemesi → Faz 5'te tek model vs konsey karşılaştırması.
4. Büyük repolarda FTS'in anlamsal soruları kaçırması → agentic retrieval.
5. Streaming IPC ve iptal yönetimi.
6. Windows yol/CRLF/uzun yol; macOS/Windows imzalama.
