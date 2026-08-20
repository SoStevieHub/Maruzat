// Microsoft Edge'in neural TTS'i (ücretsiz, API anahtarı gerektirmez).
// Üretilen mp3 bellekte tutulur ve /tts/<id>.mp3 adresinden servis edilir; diske yazmıyoruz.

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const VARSAYILAN_SES = process.env.TTS_VOICE || 'tr-TR-EmelNeural';

// Son üretilen sesler; overlay istediğinde çekebilsin diye kısa süre bellekte kalır.
const kasa = new Map();
const KASA_LIMIT = 30;
let sayac = 0;

function sakla(buffer) {
  const id = `r${Date.now().toString(36)}${(sayac++).toString(36)}`;
  kasa.set(id, buffer);
  while (kasa.size > KASA_LIMIT) kasa.delete(kasa.keys().next().value);
  return id;
}

function getir(id) {
  return kasa.get(id) || null;
}

// SSML'i bozacak karakterleri ayıklar; msedge-tts metni SSML'e gömüyor.
function temizle(text) {
  return String(text || '')
    .replace(/[<>&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

async function seslendir(text, { voice = VARSAYILAN_SES, rate = '0%', pitch = '0Hz' } = {}) {
  const temiz = temizle(text);
  if (!temiz) throw new Error('Seslendirilecek metin boş.');

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

  const buffer = await new Promise((resolve, reject) => {
    const parcalar = [];
    const { audioStream } = tts.toStream(temiz, { rate, pitch });
    const zamanAsimi = setTimeout(() => reject(new Error('TTS zaman aşımı (30sn)')), 30000);

    audioStream.on('data', (c) => parcalar.push(c));
    audioStream.on('end', () => { clearTimeout(zamanAsimi); resolve(Buffer.concat(parcalar)); });
    audioStream.on('error', (e) => { clearTimeout(zamanAsimi); reject(e); });
  });

  if (!buffer.length) throw new Error('TTS boş ses döndürdü.');

  const id = sakla(buffer);
  return { id, url: `/tts/${id}.mp3`, bytes: buffer.length };
}

// Panelde seçilebilen Türkçe sesler.
const SESLER = [
  { id: 'tr-TR-EmelNeural', etiket: 'Emel (kadın)' },
  { id: 'tr-TR-AhmetNeural', etiket: 'Ahmet (erkek)' },
];

module.exports = { seslendir, getir, SESLER, VARSAYILAN_SES };
