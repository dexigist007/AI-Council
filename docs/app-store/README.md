# Mac App Store — yayın kontrol listesi

Uygulama tarafındaki App Store gereksinimleri kodda karşılandı (sandbox izinleri, klasör yer imleri,
uygulama içi Git, veri gönderme onayı, gizlilik politikası, "tüm verileri sil", finansal tavsiye uyarısı,
şifreleme beyanı, ikon). Aşağıdakiler yalnızca senin yapabileceğin adımlar.

## 1. Apple tarafı (bir kez)
1. **Apple Developer Program** üyeliği (yıllık 99 USD) — developer.apple.com/programs.
2. **App ID**: Certificates, Identifiers & Profiles → Identifiers → App ID → Bundle ID
   `com.dexigist.aicouncil` (explicit). Ek yetenek (capability) gerekmez.
3. **Sertifikalar** (Xcode → Settings → Accounts → Manage Certificates ile en kolayı):
   - *Apple Distribution* (uygulamayı imzalar)
   - *Mac Installer Distribution* (.pkg'yi imzalar; Keychain'de "3rd Party Mac Developer Installer" adıyla görünür)
4. **Provisioning profile**: Profiles → *Mac App Store Connect* → App ID'yi ve Apple Distribution sertifikasını seç → indir.
5. **App Store Connect** → Apps → New App → macOS, Bundle ID'yi seç.
   - **İsim:** "AI Council" büyük olasılıkla alınmış (App Store'da "The AI Council", Setapp'te "AI Council" var).
     Ayırt edici bir isim seç, ör. *Council — AI Debate*, *Deliberate: AI Council*, *Concilium*. Uygulamanın
     içindeki adı değiştirmek gerekmez ama aynı olması karışıklığı önler.

## 2. Kodda doldurman gerekenler
- `src/config/app.ts` → `SUPPORT_EMAIL`: gizlilik politikasında görünen iletişim adresi. Boşsa
  `scripts/build-mas.sh` çalışmaz.
- Ardından `npx vite-node scripts/privacy-html.ts` ile `docs/app-store/privacy-policy.html`'i yeniden üret
  (metin uygulama içindeki politikadan gelir) ve sayfayı yayınla (GitHub Pages: repo Settings → Pages →
  `docs/` klasörü; ya da kendi alan adın). Bu adres App Store Connect'teki *Privacy Policy URL* olur.

## 3. Derleme ve yükleme (Mac'te)
```sh
export APPLE_TEAM_ID=XXXXXXXXXX
export MAS_APP_IDENTITY="Apple Distribution: Ad Soyad (XXXXXXXXXX)"
export MAS_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Ad Soyad (XXXXXXXXXX)"
export MAS_PROFILE=~/Downloads/AI_Council_MAS.provisionprofile
export BUILD_NUMBER=1            # her yüklemede artır
./scripts/build-mas.sh           # "AI Council.pkg" üretir
```
Yükleme: **Transporter** uygulamasıyla .pkg'yi sürükle-bırak; ya da App Store Connect API anahtarıyla
`ASC_KEY_ID` / `ASC_ISSUER_ID` ayarlayıp betiğin yüklemesine izin ver.

## 4. Göndermeden önce TestFlight'ta mutlaka dene
Sandbox davranışı yalnızca imzalı derlemede doğrulanabilir. TestFlight'tan kurup şunları kontrol et:
- [ ] Settings'te bir anahtar kaydet → uygulamayı kapat/aç → anahtar duruyor mu (Keychain sandbox'ta çalışıyor mu)?
- [ ] Bir sağlayıcıyla "Bağlantıyı test et" → önce onay penceresi çıkıyor mu, sonra yanıt geliyor mu?
- [ ] Projects → klasör ekle → dizinle → **uygulamayı kapatıp aç** → Files/Audit hâlâ çalışıyor mu (yer imleri)?
- [ ] Git Changes sekmesi ve Dashboard'daki Git durumu çalışıyor mu?
- [ ] Ollama kuruluysa yerel model çalışıyor mu (localhost)?
- [ ] Settings → Gizlilik ve veriler → Gizlilik politikası açılıyor mu; "Tüm verileri sil" her şeyi temizliyor mu?

## 5. App Store Connect formları
- **App Privacy:** "Data Not Collected" (gerekçe: `metadata.md`).
- **Age rating:** anketteki "yapay zekâ / kullanıcı tarafından oluşturulan içerik" sorularını dürüstçe yanıtla;
  büyük olasılıkla 13+ çıkar.
- **Fiyat:** Ücretsiz. **Uygunluk:** Çin anakarasını çıkar (üretken yapay zekâ uygulamaları orada ayrı izin ister).
- **Kategori:** Productivity (ikincil: Developer Tools).
- **Ekran görüntüleri:** `docs/app-store/screenshots/` (2880×1800).
- **Review notes:** `review-notes.md` — içine harcama limiti olan bir test API anahtarı koy; onaydan sonra anahtarı iptal et.
