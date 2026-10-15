# ADR-0006: Sağlayıcı endpoint'leri Rust'ta sabittir
Durum: Kabul edildi

Her sağlayıcının base URL'i ve yetki header'ı `src-tauri/src/providers.rs` içinde sabittir. WebView sadece
sağlayıcı kimliği ve o API altındaki yolu verir; Rust, sonuç URL'in sağlayıcının host'unda ve base yolunda
kaldığını doğrular. Böylece arayüz tarafındaki bir hata ya da enjeksiyon anahtarı başka bir adrese
gönderemez.

Sonuç: Özel endpoint (ör. GLM'nin Çin bölgesi `open.bigmodel.cn`, kendi proxy'n) gerekiyorsa Rust'taki
listeye eklenir; kullanıcı ayarından serbest URL girilmez. Şu anki seçimler: Kimi `api.moonshot.ai`,
GLM `api.z.ai` (uluslararası).
