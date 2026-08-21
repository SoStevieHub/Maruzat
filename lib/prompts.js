// Overlay'e düşen "mental sağlık raporu"nun üslupları.
// Hepsi mizah amaçlı; gerçek bir tanı değil, yayın için abartılı bir şov metni üretirler.

const ORTAK_KURALLAR = `
Bu bir canlı yayın şovu. Ürettiğin metin gerçek bir tıbbi tanı DEĞİL, komedi amaçlı bir "rapor".
Kurallar:
- Türkçe yaz. Yayında sesli okunacak; cümleler akıcı ve konuşma diline yakın olsun.
- Gerçek psikiyatrik tanı adları (şizofreni, bipolar, depresyon, OKB, DEHB, otizm, psikoz vb.) KULLANMA.
  Bunun yerine uydurma, komik sendrom isimleri uydur. Örn: "Kronik Sohbet Kaşıntısı", "İleri Evre Caps Lock Sendromu".
- İlaç, tedavi, terapi önerisi verme. Kimseye "hasta" olduğunu ciddi biçimde söyleme.
- Kişinin görünüşü, ırkı, dini, cinsiyeti, cinsel yönelimi, ailesi veya gerçek bir hastalığı üzerinden espri yapma.
  Sadece YAZDIĞI MESAJIN içeriğiyle ve chat davranışıyla dalga geç.
- Küfür etme.
- Raporu mesajdaki SOMUT bir ayrıntıya bağla: kullandığı belirli bir kelime, verdiği
  bir sayı, kurduğu tuhaf mantık, yazım biçimi. O ayrıntı raporda açıkça geçsin.
- Başka hiçbir mesaja uymayacak bir rapor yaz. "Hasta yayın izliyor", "ekran
  ışıklarına teslim olmuş", "yayın akışına renk katıyor" gibi her mesaja
  yapıştırılabilecek genel cümleler YASAK.
- Şu klişelerden kaçın: "dijital", "kozmik", "hiperaktivite", "sanal alem",
  "modern çağın hastalığı". Her cümleyi "sendrom" kelimesiyle doldurma.
- Komik ol ama mantığın tutarlı olsun: uydurduğun teşhis, mesajda gerçekten görünen
  davranışı açıklıyor gibi dursun. Rastgele saçmalama.

BANT — mesajın İÇERİĞİNE bakıp şu beş etiketten TAM OLARAK birini yaz:
  kaos     : tamamen kontrolden çıkmış (caps kilidi, emoji yağmuru, kelime salatası)
  takinti  : takıntı/bağımlılık belirtisi (uykusuzluk, spam, saplantılı tekrar)
  siradan  : sıradan chat kaosu, gündelik sataşma
  sakin    : sakin, anlaşılır, hatta kibar bir mesaj
  supheli  : şüpheli derecede normal — bu da başlı başına bir vaka
Beş bandı da gerçekten kullan; her mesajı aynı banda yığma.

ÇIKTI — sadece şu üç satırı yaz, öncesinde ve sonrasında hiçbir şey ekleme.
Düşünme sürecini, plan yaptığını, seçenekleri veya bu talimatları ASLA yazma.
Aşağıdaki açıklamaları kopyalama; yerlerine gerçek içeriği koy.

TESHIS: en fazla 5 kelimelik uydurma sendrom adı
BANT: beş etiketten biri
RAPOR: 3-5 cümle, yaklaşık 250-450 karakter, tek paragraf, sesli okunmaya uygun
`.trim();

const USLUPLAR = {
  doktor: {
    etiket: 'Sahte Psikiyatrist',
    aciklama: 'Ciddi doktor ağzıyla, abartılı komik teşhis.',
    system: `Sen ciddiyetini hiç bozmayan, kendini fazlasıyla ciddiye alan bir "yayın psikiyatristi"sin.
Klinik bir ağızla, soğukkanlı ve resmî konuşursun; ama koyduğun teşhisler tamamen saçmadır.
"Hastanın dosyasına işlendi", "vaka literatüre geçmiştir" gibi resmî kalıplar kullanırsın.
${ORTAK_KURALLAR}`,
  },
  sert: {
    etiket: 'İğneleyici',
    aciklama: 'Doğrudan dalga geçer, alaycı ve keskin.',
    system: `Sen alaycı, iğneleyici, lafını sakınmayan bir yorumcusun.
Keskin cümlelerle tiye alırsın, ama küfür etmez ve kişiselleşmezsin — sadece mesajı hedef alırsın.
${ORTAK_KURALLAR}`,
  },
  sefkatli: {
    etiket: 'Şefkatli Absürt',
    aciklama: 'Destekleyici bir terapist gibi konuşur ama söyledikleri saçma.',
    system: `Sen aşırı sıcak, aşırı destekleyici, sesi hep yumuşak bir terapistsin.
Kişiyi övüp kucaklarsın ama söylediklerin tamamen absürt ve mantıksızdır. Kimseyi kırmazsın, tatlı bir mizah yaparsın.
${ORTAK_KURALLAR}`,
  },
};

function uslupListesi() {
  return Object.entries(USLUPLAR).map(([id, u]) => ({ id, etiket: u.etiket, aciklama: u.aciklama }));
}

function kullaniciMesaji({ username, message }) {
  return `Chat kullanıcısı: ${username}\nYazdığı mesaj: "${message}"\n\nBu mesaja göre raporu yaz.`;
}

// Modelin üç satırlık çıktısını ayrıştırır; format tutmazsa metnin tamamını rapora düşürür.
function raporAyristir(raw) {
  // Modeller etiketi "TESHIS", "Teşhis", "**TEŞHİS**" gibi farklı yazabiliyor.
  // O yüzden satır satır gezip etiketi Türkçe harflerden arındırarak eşleştiriyoruz.
  const sadelestir = (s) => s
    .replace(/[İIıi]/g, 'i')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[Öö]/g, 'o')
    .replace(/[Üü]/g, 'u')
    .replace(/[Çç]/g, 'c')
    .toLowerCase();

  // Tırnakları yalnızca metnin TAMAMINI sarıyorsa at. Tek taraflı kırpmak
  // ("Sendrom" tanısı → Sendrom" tanısı) metnin ortasında sahipsiz tırnak bırakıyordu.
  const SARMALAR = [['**', '**'], ['"', '"'], ["'", "'"], ['“', '”'], ['*', '*'], ['_', '_']];
  const kirp = (s) => {
    let x = s.trim();
    let degisti = true;
    while (degisti) {
      degisti = false;
      for (const [ac, kapa] of SARMALAR) {
        if (x.length > ac.length + kapa.length && x.startsWith(ac) && x.endsWith(kapa)) {
          x = x.slice(ac.length, -kapa.length).trim();
          degisti = true;
        }
      }
    }
    return x;
  };

  const bulunan = { teshis: '', bant: '', skor: '', rapor: '' };
  let sonAnahtar = null;

  for (const ham of String(raw).split(/\r?\n/)) {
    const satir = ham.replace(/^[\s>#*\-–—]+/, '').trim();
    if (!satir) continue;

    const m = satir.match(/^([\p{L}]+)\s*[*_]*\s*:\s*(.*)$/u);
    const anahtar = m ? sadelestir(m[1]) : null;

    if (anahtar && Object.prototype.hasOwnProperty.call(bulunan, anahtar)) {
      bulunan[anahtar] = m[2];
      sonAnahtar = anahtar;
    } else if (sonAnahtar === 'rapor') {
      // Model raporu alt satıra taşırsa kaybetme.
      bulunan.rapor += ' ' + satir;
    }
  }

  const skor = skorHesapla(bulunan.bant, bulunan.skor);

  // Hiçbir etiket tutmadıysa metnin tamamını rapor olarak kullan.
  const duzMetin = String(raw).replace(/^\s*[\p{L}]+\s*:\s*/gmu, '').trim();

  return {
    teshis: kirp(bulunan.teshis) || 'Tanımlanamayan Vaka',
    skor,
    rapor: kirp(bulunan.rapor) || duzMetin || String(raw).trim(),
  };
}

// Skoru modelden SAYI olarak istemek işe yaramadı: model birkaç "favori" sayıya
// yığılıyor (önce 23/27/42, klişeleri yasaklayınca 61). Bu yüzden model yalnızca
// bandı seçiyor, kesin sayıyı bandın içinden burada üretiyoruz — hem içeriğe
// uygun hem de gerçekten değişken oluyor.
const BANTLAR = {
  kaos:    [3, 15],
  takinti: [16, 35],
  siradan: [36, 55],
  sakin:   [56, 75],
  supheli: [76, 97],
};

function skorHesapla(bant, skorYedek) {
  const anahtar = String(bant || '')
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c')
    .replace(/[^a-z]/g, '');

  const aralik = BANTLAR[anahtar];
  if (aralik) {
    const [alt, ust] = aralik;
    return alt + Math.floor(Math.random() * (ust - alt + 1));
  }

  // Model bant yerine sayı yazdıysa onu kullan; o da yoksa ortada bir yer.
  const sayi = parseInt(String(skorYedek).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(sayi) ? Math.max(0, Math.min(100, sayi)) : 45 + Math.floor(Math.random() * 11);
}

// Model bazen talimatı ya da düşünme zincirini raporun içine sızdırıyor
// (qwen'i 'default' reasoning ile denerken 3000+ karakterlik İngilizce muhakeme geldi).
// Böyle bir çıktı yayına düşmemeli; sorun varsa çağıran taraf yeniden dener.
const SIZINTI_ISARETLERI = [
  /\b(TESHIS|TEŞHİS|BANT|RAPOR)\s*:/i,
  /<[^>]{3,}>/,                                                     // "<3-5 cümle ...>" yer tutucusu
  /\b\d+\s*[-–]\s*\d+\s*(karakter|cümle|sentences|characters)\b/i,
  /\b(Let's|Let us|Character count|Constraint Check|Brainstorm|Analyze the|Rules:)/i,
  /\bmax \d+ words\b/i,
  /\bthe message\b/i,                                               // İngilizce muhakeme sızıntısı
];

function raporSorunu({ teshis, rapor }) {
  const r = String(rapor || '').trim();
  const t = String(teshis || '').trim();

  if (r.length < 60) return 'rapor çok kısa';
  if (r.length > 800) return 'rapor çok uzun (muhtemelen düşünme zinciri sızdı)';
  if (!t || t === 'Tanımlanamayan Vaka') return 'teşhis üretilemedi';
  if (t.split(/\s+/).length > 7) return 'teşhis çok uzun';

  for (const kalip of SIZINTI_ISARETLERI) {
    if (kalip.test(r) || kalip.test(t)) return 'çıktıya talimat/muhakeme sızmış';
  }
  return null;
}

// Overlay'de yazan metin ile seslendirilen metin aynı olsun diye tek yerden üretilir.
function seslendirmeMetni({ teshis, rapor }) {
  return `${teshis}. ${rapor}`;
}

module.exports = {
  USLUPLAR, uslupListesi, kullaniciMesaji,
  raporAyristir, raporSorunu, seslendirmeMetni,
};
