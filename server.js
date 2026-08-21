const path = require('path');

// .env her zaman proje klasöründen okunsun (sunucu başka bir cwd'den başlatılabiliyor).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Pusher = require('pusher-js/node');

const { chat, configuredProviders } = require('./lib/llm');
const {
  USLUPLAR, uslupListesi, kullaniciMesaji,
  raporAyristir, raporSorunu, seslendirmeMetni,
} = require('./lib/prompts');
const { seslendir, getir: sesGetir, SESLER, VARSAYILAN_SES } = require('./lib/tts');
const { profilFotosu, yapilandirildiMi: avatarHazirMi } = require('./lib/avatar');
const { riskliMi } = require('./lib/safety');
const { linkleriBul, linkleriBulDetayli } = require('./lib/links');
const chatKaydi = require('./lib/log');

// ─── AYARLAR ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3200);
const CHATROOM_ID = process.env.KICK_CHATROOM_ID || '25098810';
const KANAL = process.env.KICK_CHANNEL_SLUG || 'sostevie';
const PUSHER_KEY = '32cbd69e4b950bf97679';   // Kick'in public Pusher app key'i
const PUSHER_CLUSTER = 'us2';
const MESAJ_TAMPONU = 200;                   // panelde tutulan son mesaj sayısı
const LINK_TAMPONU = 300;                    // Linkler sekmesinde tutulan son link sayısı
const ENGELLI = new Set(
  (process.env.BLOCKED_USERS || 'botrix').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);

// ─── DURUM ────────────────────────────────────────────────────────────────────
let mesajlar = [];
let linkler = [];      // { id, messageId, userId, user, color, url, at }
let sonrakiId = 1;
let sonrakiLinkId = 1;
let raporNonce = 0;

let overlayDurumu = {
  highlight: null,   // { id, userId, user, color, avatar, message, at }
  rapor: null,       // { teshis, skor, rapor, uslup, audioUrl, nonce, at }
};

const ayarlar = {
  uslup: 'doktor',
  ses: VARSAYILAN_SES,
  konusmaHizi: '0%',
  zemin: false,        // overlay'de yazının arkasına yukarı doğru açılan gradient
};

let pusherDurumu = { connected: false };

// Bağlı overlay istemcileri. Aynı anda birden fazla overlay açıkken (OBS kaynağı +
// tarayıcıda önizleme) hepsi aynı mp3'ü çalınca ses yankılı/duble duyuluyordu.
// Bu yüzden sesi yalnızca "ses sahibi" overlay çalar; diğerleri sessiz gösterir.
let overlaylar = [];      // { socketId, ad, bagliAt }
let sesSahibi = null;     // socketId

// ─── SUNUCU ───────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function yayinla(event, payload) {
  io.emit(event, payload);
}

function overlayGuncelle() {
  yayinla('overlay:state', overlayDurumu);
}

function overlaylariYayinla() {
  yayinla('overlay:liste', { overlaylar, sesSahibi });
}

// Sahip yoksa ya da ayrıldıysa en eski overlay'e devret.
function sesSahibiniDuzelt() {
  if (!overlaylar.some((o) => o.socketId === sesSahibi)) {
    sesSahibi = overlaylar.length ? overlaylar[0].socketId : null;
  }
}

// ─── KICK CHAT (Pusher) ───────────────────────────────────────────────────────
const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER, encrypted: true });
const kanal = pusher.subscribe(`chatrooms.${CHATROOM_ID}.v2`);
kanal.bind('App\\Events\\ChatMessageEvent', chatMesaji);

pusher.connection.bind('connected', () => {
  pusherDurumu = { connected: true };
  console.log(`✅ Kick chat bağlandı (chatroom ${CHATROOM_ID})`);
  yayinla('pusher:status', pusherDurumu);
});

pusher.connection.bind('disconnected', () => {
  pusherDurumu = { connected: false };
  console.log('⚠️  Kick chat bağlantısı koptu');
  yayinla('pusher:status', pusherDurumu);
});

pusher.connection.bind('error', (e) => {
  console.error('[pusher] hata:', e?.error?.data || e);
});

function chatMesaji(data) {
  const msg = data?.data || data;
  const sender = msg?.sender || {};
  const username = sender.username || sender.slug || 'bilinmeyen';
  const content = String(msg?.content || '').trim();

  if (!content) return;
  if (ENGELLI.has(username.toLowerCase())) return;

  const kayit = {
    id: sonrakiId++,
    userId: sender.id ?? null,
    user: username,
    slug: sender.slug || username,
    color: sender.identity?.color || '#53fc18',
    avatar: null,
    message: content,
    at: new Date().toISOString(),
    risk: riskliMi(content),
    // Panel metni tıklanabilir yaparken bunu kullanıyor; ayrıştırma tek yerde kalsın.
    links: linkleriBulDetayli(content),
  };

  mesajlar.push(kayit);
  if (mesajlar.length > MESAJ_TAMPONU) mesajlar = mesajlar.slice(-MESAJ_TAMPONU);

  const yeniLinkler = linkleriEkle(kayit);
  logla(kayit);

  yayinla('chat:message', kayit);
  if (yeniLinkler.length) yayinla('link:yeni', yeniLinkler);
  yayinla('log:bilgi', chatKaydi.bilgi());

  // Fotoğraf arkadan gelir; geldiğinde panele ve (yayındaysa) overlay'e iletilir.
  profilFotosu(kayit.userId).then((url) => {
    if (!url) return;
    for (const m of mesajlar) if (m.userId === kayit.userId) m.avatar = url;
    yayinla('chat:avatar', { userId: kayit.userId, avatar: url });
    if (overlayDurumu.highlight && overlayDurumu.highlight.userId === kayit.userId) {
      overlayDurumu.highlight.avatar = url;
      overlayGuncelle();
    }
  });
}

function mesajBul(id) {
  return mesajlar.find((m) => m.id === Number(id)) || null;
}

// Mesajdaki bağlantıları Linkler sekmesinin listesine ekler, eklenenleri döndürür.
// BotRix gibi engelli hesaplar chatMesaji'nin başında elendiği için buraya hiç gelmiyor.
function linkleriEkle(m) {
  const yeni = linkleriBul(m.message).map((url) => ({
    id: sonrakiLinkId++,
    messageId: m.id,
    userId: m.userId,
    user: m.user,
    color: m.color,
    avatar: m.avatar,
    url,
    at: m.at,
  }));
  if (!yeni.length) return [];
  linkler.push(...yeni);
  if (linkler.length > LINK_TAMPONU) linkler = linkler.slice(-LINK_TAMPONU);
  return yeni;
}

function logla(m) {
  chatKaydi.yaz({
    id: m.id, userId: m.userId, user: m.user, slug: m.slug,
    color: m.color, message: m.message, at: m.at, risk: m.risk,
  });
}

// Açılışta log dosyasından son mesajları ve linkleri geri yükler.
function logdanYukle() {
  let kayitlar;
  try {
    kayitlar = chatKaydi.oku();
  } catch (err) {
    console.error('[log] okunamadı:', err.message);
    return;
  }
  if (!kayitlar.length) return;

  sonrakiId = Math.max(...kayitlar.map((k) => Number(k.id) || 0)) + 1;

  // Linkler tüm geçmişten, mesaj listesi yalnızca son tampon kadar.
  for (const k of kayitlar) linkleriEkle({ ...k, avatar: null });
  mesajlar = kayitlar.slice(-MESAJ_TAMPONU).map((k) => ({
    ...k, avatar: null, links: linkleriBulDetayli(k.message),
  }));

  console.log(`📂 Log'dan yüklendi: ${kayitlar.length} mesaj, ${linkler.length} link`);
}

// ─── API ──────────────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    kanal: KANAL,
    chatroomId: CHATROOM_ID,
    usluplar: uslupListesi(),
    sesler: SESLER,
    saglayicilar: configuredProviders(),
    avatarAktif: avatarHazirMi(),
    ayarlar,
  });
});

app.get('/api/state', (req, res) => {
  res.json({
    mesajlar: mesajlar.slice(-100),
    linkler,
    log: chatKaydi.bilgi(),
    overlay: overlayDurumu,
    overlaylar,
    sesSahibi,
    pusher: pusherDurumu,
    ayarlar,
  });
});

// Kaydı sıfırla: log dosyası, mesaj tamponu ve link listesi birlikte temizlenir.
app.post('/api/log/temizle', (req, res) => {
  try {
    chatKaydi.temizle();
  } catch (err) {
    return res.status(500).json({ error: 'Log temizlenemedi: ' + err.message });
  }
  mesajlar = [];
  linkler = [];
  yayinla('chat:bulk', []);
  yayinla('link:bulk', []);
  yayinla('log:bilgi', chatKaydi.bilgi());
  console.log('🧹 Chat kaydı temizlendi');
  res.json({ ok: true, log: chatKaydi.bilgi() });
});

// Sesi hangi overlay'in çalacağını seç.
app.post('/api/overlay/ses-sahibi', (req, res) => {
  const { socketId } = req.body || {};
  if (!overlaylar.some((o) => o.socketId === socketId)) {
    return res.status(404).json({ error: 'Böyle bağlı bir overlay yok.' });
  }
  sesSahibi = socketId;
  overlaylariYayinla();
  res.json({ ok: true, sesSahibi });
});

// Ham kaydı indir (yedek almak ya da başka yerde incelemek için).
app.get('/api/log/indir', (req, res) => {
  const bilgi = chatKaydi.bilgi();
  if (!bilgi.satir) return res.status(404).json({ error: 'Kayıt boş.' });
  res.download(chatKaydi.DOSYA, 'chat-log.jsonl');
});

app.post('/api/ayarlar', (req, res) => {
  const { uslup, ses, konusmaHizi, zemin } = req.body || {};
  if (uslup && USLUPLAR[uslup]) ayarlar.uslup = uslup;
  if (ses && SESLER.some((s) => s.id === ses)) ayarlar.ses = ses;
  if (typeof konusmaHizi === 'string') ayarlar.konusmaHizi = konusmaHizi;
  if (typeof zemin === 'boolean') ayarlar.zemin = zemin;
  yayinla('ayarlar', ayarlar);
  res.json({ ok: true, ayarlar });
});

// Mesajı overlay'e bas.
app.post('/api/highlight', (req, res) => {
  const mesaj = mesajBul(req.body?.messageId);
  if (!mesaj) return res.status(404).json({ error: 'Mesaj bulunamadı (tampondan düşmüş olabilir).' });

  overlayDurumu.highlight = {
    id: mesaj.id,
    userId: mesaj.userId,
    user: mesaj.user,
    color: mesaj.color,
    avatar: mesaj.avatar,
    message: mesaj.message,
    at: new Date().toISOString(),
  };
  overlayDurumu.rapor = null;   // yeni mesaj gelince eski rapor düşer
  overlayGuncelle();
  res.json({ ok: true, overlay: overlayDurumu });
});

app.post('/api/highlight/temizle', (req, res) => {
  overlayDurumu = { highlight: null, rapor: null };
  overlayGuncelle();
  res.json({ ok: true });
});

// AI raporunu ÜRETİR ama overlay'e basmaz — önce panelde onaya düşer.
app.post('/api/analiz', async (req, res) => {
  const mesaj = mesajBul(req.body?.messageId);
  if (!mesaj) return res.status(404).json({ error: 'Mesaj bulunamadı.' });

  if (mesaj.risk) {
    return res.status(422).json({
      error: 'risk',
      detay: 'Bu mesaj gerçek bir sıkıntı işareti taşıyor olabilir. AI yorumu üretilmedi.',
    });
  }

  const uslupId = USLUPLAR[req.body?.uslup] ? req.body.uslup : ayarlar.uslup;

  // Model ara sıra talimatı ya da düşünme zincirini rapora sızdırıyor. Böyle bir
  // çıktıyı panele hiç göstermeyip yeniden istiyoruz.
  const elemeler = [];
  try {
    for (let deneme = 1; deneme <= 3; deneme++) {
      const sonuc = await chat(
        USLUPLAR[uslupId].system,
        kullaniciMesaji({ username: mesaj.user, message: mesaj.message }),
        { temperature: 1.0, maxTokens: 1400 },
      );
      const rapor = raporAyristir(sonuc.text);
      const sorun = raporSorunu(rapor);

      if (sorun) {
        elemeler.push(`${sonuc.provider}: ${sorun}`);
        console.warn(`[analiz] ${sonuc.provider} çıktısı elendi (${sorun}), yeniden deneniyor`);
        continue;
      }

      return res.json({
        ok: true,
        messageId: mesaj.id,
        uslup: uslupId,
        ...rapor,
        seslendirme: seslendirmeMetni(rapor),
        saglayici: `${sonuc.provider} / ${sonuc.model}`,
        denemeler: [...sonuc.attempts, ...elemeler],
      });
    }
    res.status(502).json({
      error: 'AI kullanılabilir bir rapor üretemedi:\n' + elemeler.join('\n'),
    });
  } catch (err) {
    console.error('[analiz] hata:', err.message || err);
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Onaylanan raporu overlay'e bas. sesli=true ise önce TTS üretilir.
app.post('/api/rapor/yayinla', async (req, res) => {
  const { teshis, skor, rapor, uslup, sesli } = req.body || {};
  if (!rapor || !String(rapor).trim()) return res.status(400).json({ error: 'Rapor metni boş.' });

  let audioUrl = null;
  if (sesli) {
    try {
      const ses = await seslendir(seslendirmeMetni({ teshis, rapor }), {
        voice: ayarlar.ses,
        rate: ayarlar.konusmaHizi,
      });
      audioUrl = ses.url;
    } catch (err) {
      console.error('[tts] hata:', err.message || err);
      return res.status(502).json({ error: 'Seslendirme başarısız: ' + String(err.message || err) });
    }
  }

  overlayDurumu.rapor = {
    teshis: String(teshis || '').trim(),
    skor: Number.isFinite(Number(skor)) ? Number(skor) : 50,
    rapor: String(rapor).trim(),
    uslup: uslup || ayarlar.uslup,
    audioUrl,
    nonce: ++raporNonce,
    at: new Date().toISOString(),
  };
  overlayGuncelle();
  res.json({ ok: true, overlay: overlayDurumu });
});

app.post('/api/rapor/temizle', (req, res) => {
  overlayDurumu.rapor = null;
  overlayGuncelle();
  res.json({ ok: true });
});

// Yayındaki raporun sesini overlay'de yeniden çal.
app.post('/api/rapor/tekrar-cal', (req, res) => {
  if (!overlayDurumu.rapor?.audioUrl) return res.status(400).json({ error: 'Yayında sesli rapor yok.' });
  overlayDurumu.rapor.nonce = ++raporNonce;
  overlayDurumu.rapor.at = new Date().toISOString();   // overlay 'tazelik' kontrolü buna bakıyor
  overlayGuncelle();
  res.json({ ok: true });
});

// Panelde ses önizlemesi (overlay'e dokunmaz).
app.post('/api/tts/onizle', async (req, res) => {
  try {
    const ses = await seslendir(req.body?.text || 'Hastanın dosyası incelenmiştir.', {
      voice: req.body?.ses || ayarlar.ses,
      rate: ayarlar.konusmaHizi,
    });
    res.json({ ok: true, url: ses.url, bytes: ses.bytes });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.get('/tts/:id.mp3', (req, res) => {
  const buf = sesGetir(req.params.id);
  if (!buf) return res.status(404).end();
  res.set('Content-Type', 'audio/mpeg');
  res.set('Cache-Control', 'no-store');
  res.send(buf);
});

// Chat'e bağlanmadan test etmek için sahte mesaj üretir.
app.post('/api/test/mesaj', (req, res) => {
  chatMesaji({
    data: {
      content: req.body?.message || 'test mesajı',
      // userId verilirse gerçek profil fotoğrafı da çekilir; 0 baş harf avatarına düşer.
      sender: {
        id: Number(req.body?.userId) || 0,
        username: req.body?.user || 'testkullanici',
        identity: { color: '#53fc18' },
      },
    },
  });
  res.json({ ok: true });
});

app.get('/', (req, res) => res.redirect('/admin.html'));

// ─── SOCKET ───────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Overlay sayfası açılışta kendini tanıtır; panel bu listeyi gösterir.
  socket.on('overlay:merhaba', ({ ad } = {}) => {
    if (overlaylar.some((o) => o.socketId === socket.id)) return;
    overlaylar.push({
      socketId: socket.id,
      ad: String(ad || '').slice(0, 40) || `overlay-${overlaylar.length + 1}`,
      bagliAt: new Date().toISOString(),
    });
    sesSahibiniDuzelt();
    overlaylariYayinla();
    console.log(`🖥️  Overlay bağlandı (${overlaylar.length} açık) · ses sahibi: ${sesSahibi}`);
  });

  socket.on('disconnect', () => {
    const oncekiSayi = overlaylar.length;
    overlaylar = overlaylar.filter((o) => o.socketId !== socket.id);
    if (overlaylar.length !== oncekiSayi) {
      sesSahibiniDuzelt();
      overlaylariYayinla();
      console.log(`🖥️  Overlay ayrıldı (${overlaylar.length} açık) · ses sahibi: ${sesSahibi}`);
    }
  });

  socket.emit('overlay:liste', { overlaylar, sesSahibi });
  socket.emit('chat:bulk', mesajlar.slice(-100));
  socket.emit('link:bulk', linkler);
  socket.emit('log:bilgi', chatKaydi.bilgi());
  socket.emit('overlay:state', overlayDurumu);
  socket.emit('pusher:status', pusherDurumu);
  socket.emit('ayarlar', ayarlar);
});

logdanYukle();

// Port doluysa yığın izi yerine anlaşılır bir mesaj bas (genelde zaten açık demektir).
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  ⛔  ${PORT} portu kullanımda — Mental0 muhtemelen zaten açık.`);
    console.error(`      Panel: http://localhost:${PORT}/admin.html`);
    console.error('      Başka bir kopya açmak istiyorsan önce eskisini kapat.');
    console.error('');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🧠  MENTAL0');
  console.log(`  Panel   : http://localhost:${PORT}/admin.html`);
  console.log(`  Overlay : http://localhost:${PORT}/overlay.html   (OBS Browser Source · 960x1080)`);
  console.log(`  Kanal   : ${KANAL} · chatroom ${CHATROOM_ID}`);
  console.log(`  LLM     : ${configuredProviders().join(' → ') || 'YAPILANDIRILMADI (.env)'}`);
  console.log(`  Avatar  : ${avatarHazirMi() ? 'Kick API aktif' : 'kapalı (baş harf avatarı)'}`);
  console.log('');
  console.log('  Kapatmak için bu pencerede Ctrl+C.');
  console.log('');

  // Kısayoldan açılınca paneli tarayıcıda aç. Sunucu dinlemeye başladıktan sonra
  // yapıldığı için "bağlanılamadı" sayfası çıkmıyor.
  if (process.env.OPEN_BROWSER === '1') {
    require('child_process').exec(`start "" "http://localhost:${PORT}/admin.html"`);
  }
});
