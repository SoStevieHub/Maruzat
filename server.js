const path = require('path');

// .env her zaman proje klasöründen okunsun (sunucu başka bir cwd'den başlatılabiliyor).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Pusher = require('pusher-js/node');

const { chat, configuredProviders } = require('./lib/llm');
const { USLUPLAR, uslupListesi, kullaniciMesaji, raporAyristir, seslendirmeMetni } = require('./lib/prompts');
const { seslendir, getir: sesGetir, SESLER, VARSAYILAN_SES } = require('./lib/tts');
const { profilFotosu, yapilandirildiMi: avatarHazirMi } = require('./lib/avatar');
const { riskliMi } = require('./lib/safety');

// ─── AYARLAR ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3200);
const CHATROOM_ID = process.env.KICK_CHATROOM_ID || '25098810';
const KANAL = process.env.KICK_CHANNEL_SLUG || 'sostevie';
const PUSHER_KEY = '32cbd69e4b950bf97679';   // Kick'in public Pusher app key'i
const PUSHER_CLUSTER = 'us2';
const MESAJ_TAMPONU = 200;                   // panelde tutulan son mesaj sayısı
const ENGELLI = new Set(
  (process.env.BLOCKED_USERS || 'botrix').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);

// ─── DURUM ────────────────────────────────────────────────────────────────────
let mesajlar = [];
let sonrakiId = 1;
let raporNonce = 0;

let overlayDurumu = {
  highlight: null,   // { id, userId, user, color, avatar, message, at }
  rapor: null,       // { teshis, skor, rapor, uslup, audioUrl, nonce, at }
};

const ayarlar = {
  uslup: 'doktor',
  ses: VARSAYILAN_SES,
  konusmaHizi: '0%',
};

let pusherDurumu = { connected: false };

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
  };

  mesajlar.push(kayit);
  if (mesajlar.length > MESAJ_TAMPONU) mesajlar = mesajlar.slice(-MESAJ_TAMPONU);
  yayinla('chat:message', kayit);

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
  res.json({ mesajlar: mesajlar.slice(-100), overlay: overlayDurumu, pusher: pusherDurumu, ayarlar });
});

app.post('/api/ayarlar', (req, res) => {
  const { uslup, ses, konusmaHizi } = req.body || {};
  if (uslup && USLUPLAR[uslup]) ayarlar.uslup = uslup;
  if (ses && SESLER.some((s) => s.id === ses)) ayarlar.ses = ses;
  if (typeof konusmaHizi === 'string') ayarlar.konusmaHizi = konusmaHizi;
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

  try {
    const sonuc = await chat(
      USLUPLAR[uslupId].system,
      kullaniciMesaji({ username: mesaj.user, message: mesaj.message }),
      { temperature: 1.0, maxTokens: 800 },
    );
    const rapor = raporAyristir(sonuc.text);
    res.json({
      ok: true,
      messageId: mesaj.id,
      uslup: uslupId,
      ...rapor,
      seslendirme: seslendirmeMetni(rapor),
      saglayici: `${sonuc.provider} / ${sonuc.model}`,
      denemeler: sonuc.attempts,
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
  socket.emit('chat:bulk', mesajlar.slice(-100));
  socket.emit('overlay:state', overlayDurumu);
  socket.emit('pusher:status', pusherDurumu);
  socket.emit('ayarlar', ayarlar);
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
});
