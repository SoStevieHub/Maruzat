# 🧠 Mental0

Kick chat'ini okur, panelden seçtiğin mesajı şeffaf bir overlay'e basar ve istersen
AI'ın o mesaj hakkında yazdığı mizahi "mental sağlık raporu"nu yazılı + sesli olarak
yayına verir.

> Üretilen rapor **komedi amaçlıdır**, gerçek bir tanı değildir. Hiçbir şey senin
> onayın olmadan overlay'e düşmez: AI önce panelde taslak üretir, sen okur/düzeltir,
> sonra yayına verirsin.

---

## Kurulum

```bash
npm install
```

`.env.example` dosyasını `.env` olarak kopyala ve doldur:

| Değişken | Zorunlu | Ne işe yarar |
|---|---|---|
| `KICK_CHATROOM_ID` | ✅ | Chat'in Pusher odası. `sostevie` için hazır geliyor. |
| `KICK_CHANNEL_SLUG` | – | Sadece panelde gösterilen kanal adı. |
| `GROQ_API_KEY` | ✅ | AI raporunu üretir. [console.groq.com](https://console.groq.com) — ücretsiz. |
| `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` | – | Zincire eklenir; Groq'un kotası dolunca devralırlar. |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | – | Profil fotoğrafları için. Boşsa baş harf avatarı kullanılır. |
| `TTS_VOICE` | – | Varsayılan `tr-TR-EmelNeural`. Seslendirme ücretsiz, anahtar gerekmez. |

Çalıştır:

```bash
npm start
```

Ya da `Baslat.bat` dosyasına çift tıkla — bağımlılıklar eksikse kurar, sunucuyu
başlatır ve hazır olunca paneli tarayıcıda açar. Masaüstündeki **Mental0** kısayolu
da bunu çalıştırır. Kapatmak için siyah pencerede Ctrl+C.

- **Panel:** http://localhost:3200/admin.html
- **Overlay:** http://localhost:3200/overlay.html

## OBS ayarı

Browser Source ekle:

- URL: `http://localhost:3200/overlay.html`
- Genişlik **960**, yükseklik **1080** (1920×1080 sahnede ekranın sol yarısı)
- ✅ *Control audio via OBS* — AI'ın sesi yayına bu kaynaktan gider
- ❌ *Shutdown source when not visible* — kapalı kalsın, yoksa yayında görünmez
- Custom CSS kutusunu **boş bırak**; sayfa zaten tamamen şeffaf

## Kullanım

1. Soldaki canlı chat listesinden bir mesaj seç.
2. **Öne Çıkar** → mesaj + avatar overlay'e düşer.
3. **AI Analiz** → mesajı overlay'e basar ve raporu panelde taslak olarak üretir.
4. Taslağı oku, istersen teşhisi/skoru/metni elle düzelt, **Yeniden üret** ile başka bir
   varyant al veya **🎧 Sesi dinle** ile önce kendin duy. Raporlar 250-460 karakter
   civarında; sesli okunduğunda 25-35 saniye tutuyor, kısa istiyorsan panelde kırp.
5. **Yayına ver (yazılı)** ya da **Yayına ver (sesli)**.
6. **Raporu kaldır** raporu indirir, **Overlay'i tamamen temizle** her şeyi siler.

Üst bardan üslup (Sahte Psikiyatrist / İğneleyici / Şefkatli Absürt), ses (Emel / Ahmet),
konuşma hızı, **overlay zemini** ve **açık/koyu tema** değiştirilir.

### Sekmeler

- **Sohbet** — akan chat. Mesajlardaki bağlantılar tıklanabilir (yeni sekmede açılır).
- **Linkler** — sadece chat'te paylaşılan bağlantılar, en yenisi üstte. Her satırdan
  kaynak mesajı doğrudan öne çıkarabilir ya da AI'a verebilirsin.

### Chat kaydı

Her mesaj `data/chat-log.jsonl` dosyasına satır satır yazılır. Sunucu yeniden
başladığında panel bu dosyadan geri yüklenir, sohbet ve linkler kaybolmaz.
Alttaki çubuktan kaydı indirebilir ya da **🧹 Kaydı temizle** ile sıfırlayabilirsin
(dosya + sohbet listesi + linkler birlikte silinir, geri alınamaz).

### Ses hangi overlay'den çıkar

Overlay birden fazla yerde açıkken (OBS kaynağı + tarayıcıda önizleme) hepsi aynı
mp3'ü çalıyor ve ses duble/yankılı duyuluyordu. Artık overlay'ler sunucuya kaydoluyor
ve sesi **yalnızca biri** çalar; diğerleri raporu sessizce gösterir. Panelin sağ
üstündeki listeden hangisi olduğunu seçersin.

Overlay'i `overlay.html?ad=OBS` gibi açarsan panelde o adla görünür — hangisinin
OBS olduğunu ayırt etmek kolaylaşır. Yayına başlamadan listeden OBS kaynağının
seçili olduğunu doğrula.

### Overlay zemini

"overlay zemini" işaretlenirse overlay'de yazının arkasına, aşağıda koyu olup yukarı
doğru şeffaflaşan bir gradient gelir. Yalnızca içeriğin kapladığı alanı örter; sağ
kenarda da maskeyle söner, böylece ekranın ortasında keskin bir kesim oluşmaz.
Kapalıyken overlay tamamen şeffaftır.

## Mimari

```
server.js          Express + Socket.IO + Kick chat (Pusher) + tüm API uçları
lib/llm.js         Çok sağlayıcılı LLM zinciri — biri kota/hata verince sıradakine geçer
lib/prompts.js     Üç üslup + modelin çıktısını ayrıştırma
lib/tts.js         Edge neural TTS; mp3 bellekte tutulur, /tts/<id>.mp3 ile servis edilir
lib/avatar.js      Kick public API'den profil fotoğrafı (cache'li), yoksa null
lib/safety.js      Gerçekten sıkıntı işareti taşıyan mesajları AI'a hiç göndermeme freni
public/overlay.html  OBS kaynağı — şeffaf, 960×1080, Oswald Light + Regular
public/admin.html    Kontrol paneli
```

### Bilinmesi gereken kısıtlar

- **`kick.com/api/v2/*` Cloudflare'e takılıyor** (Node'dan `403 Request blocked by
  security policy`). Bu yüzden profil fotoğrafı oradan değil, `api.kick.com` resmî
  public API'sinden `client_credentials` app token'ıyla çekiliyor. Kullanıcı OAuth'una
  gerek yok, ama `KICK_CLIENT_ID`/`SECRET` gerekiyor.
- **Chat bağlantısı resmî değil**, Kick'in public Pusher kanalını dinliyor
  (`chatrooms.<ID>.v2`). Kurulumu sıfır ama Kick bir gün değiştirirse kırılır;
  o durumda resmî webhook API'sine geçmek gerekir.
- **Groq'ta llama modelleri kaldırıldı** (2026). Varsayılan zincir artık
  `openai/gpt-oss-120b → openai/gpt-oss-20b → qwen/qwen3.6-27b`. Her modelin **ayrı**
  günlük token kotası var, sırayla denenince kotalar toplanıyor.
- Bu modeller reasoning modeli; `reasoning_effort` sözlükleri farklı
  (`gpt-oss`: `low|medium|high`, `qwen3`: `none|default`) — yanlışını gönderince 400 döner.
  `lib/llm.js` bunu modele göre ayarlıyor.
- **Overlay'de `requestAnimationFrame` kullanma.** OBS kaynağı gizliyken tarayıcı kare
  üretmediği için geri çağrılar hiç çalışmıyor ve içerik görünmez kalıyor. Animasyon
  tetiklemek için senkron reflow (`void el.offsetWidth`) kullanılıyor.
- **Rapor uzunluğu ve `reasoning_effort` birbirine bağlı.** gpt-oss'ta `low` ile
  model mesajı gerçekten okumadan genel geçer cümleler kuruyor; `medium` gözlemi
  somutlaştırıyor. Ama qwen3'te `default` denemesi felaket: düşünme zincirinin
  tamamını `content`e sızdırıyor (3000+ karakterlik İngilizce muhakeme). qwen3
  **`none` kalmalı**.
- **Modelin çıktısı doğrulanmadan yayına verilmemeli.** `raporSorunu()` talimat
  yankısını, yer tutucuları, İngilizce muhakeme sızıntısını ve absürt uzunlukları
  yakalıyor; `/api/analiz` böyle bir çıktıyı atıp 3 kez yeniden deniyor.
- **Skoru modelden sayı olarak isteme.** Model birkaç favori sayıya yığılıyor
  (önce 23/27/42; klişeleri yasaklayınca hepsi 61 oldu) ve verdiği sayı içerikle
  tutarsız kalıyor. Model artık sadece bir *bant* seçiyor (kaos/takinti/siradan/
  sakin/supheli), kesin sayıyı `lib/prompts.js` bandın içinden üretiyor.
- Rapor sesi sadece **60 saniyeden yeni** raporlarda çalınır; OBS kaynağı yenilenince
  eski bir rapor kendini tekrar seslendirmesin diye.

### Test

Chat'e bağlanmadan denemek için panelin üstündeki "test mesajı yaz…" kutusunu kullan
ya da:

```bash
curl -X POST http://localhost:3200/api/test/mesaj -H "Content-Type: application/json" -d "{\"user\":\"deneme\",\"message\":\"selam\"}"
```
