// Chat kaydı — her mesaj bir satır JSON olarak `data/chat-log.jsonl` dosyasına eklenir.
// Satır tabanlı olduğu için yazma ucuz (append), okuma kolay, temizlemek tek işlem.
// Sunucu yeniden başladığında panel boş kalmasın diye açılışta buradan geri yükleniyor.

const fs = require('fs');
const path = require('path');

const DIZIN = path.join(__dirname, '..', 'data');
const DOSYA = path.join(DIZIN, 'chat-log.jsonl');

// Satır sayısı bellekte tutuluyor: bilgi() her çağrıldığında dosyayı baştan
// ayrıştırmak, mesaj başına bir kez çağrılınca pahalıya geliyordu.
let satirSayisi = null;

function hazirla() {
  if (!fs.existsSync(DIZIN)) fs.mkdirSync(DIZIN, { recursive: true });
}

// Yazma yayını bloklamasın: hata olursa sadece konsola düşer.
function yaz(kayit) {
  hazirla();
  if (satirSayisi === null) satirSayisi = oku().length;
  satirSayisi++;
  fs.appendFile(DOSYA, JSON.stringify(kayit) + '\n', (err) => {
    if (err) console.error('[log] yazılamadı:', err.message);
  });
}

// Dosyadaki tüm kayıtları döndürür; bozuk satırlar sessizce atlanır.
function oku() {
  if (!fs.existsSync(DOSYA)) return [];
  const kayitlar = [];
  for (const satir of fs.readFileSync(DOSYA, 'utf8').split('\n')) {
    if (!satir.trim()) continue;
    try {
      kayitlar.push(JSON.parse(satir));
    } catch {
      // yarım yazılmış son satır olabilir, atla
    }
  }
  return kayitlar;
}

function temizle() {
  hazirla();
  fs.writeFileSync(DOSYA, '');
  satirSayisi = 0;
}

function bilgi() {
  if (!fs.existsSync(DOSYA)) return { satir: 0, bayt: 0, yol: DOSYA };
  if (satirSayisi === null) satirSayisi = oku().length;
  return { satir: satirSayisi, bayt: fs.statSync(DOSYA).size, yol: DOSYA };
}

module.exports = { yaz, oku, temizle, bilgi, DOSYA };
