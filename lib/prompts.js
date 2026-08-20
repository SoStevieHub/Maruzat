// Overlay'e düşen "mental sağlık raporu"nun üslupları.
// Hepsi mizah amaçlı; gerçek bir tanı değil, yayın için abartılı bir şov metni üretirler.

const ORTAK_KURALLAR = `
Bu bir canlı yayın şovu. Ürettiğin metin gerçek bir tıbbi tanı DEĞİL, komedi amaçlı bir "rapor".
Kurallar:
- Türkçe yaz. Kısa, vurucu, yayında sesli okunacak şekilde akıcı olsun.
- Gerçek psikiyatrik tanı adları (şizofreni, bipolar, depresyon, OKB, DEHB, otizm, psikoz vb.) KULLANMA.
  Bunun yerine uydurma, komik sendrom isimleri uydur. Örn: "Kronik Sohbet Kaşıntısı", "İleri Evre Caps Lock Sendromu".
- İlaç, tedavi, terapi önerisi verme. Kimseye "hasta" olduğunu ciddi biçimde söyleme.
- Kişinin görünüşü, ırkı, dini, cinsiyeti, cinsel yönelimi, ailesi veya gerçek bir hastalığı üzerinden espri yapma.
  Sadece YAZDIĞI MESAJIN içeriğiyle ve chat davranışıyla dalga geç.
- Küfür etme.
BANT — mesajın İÇERİĞİNE bakıp şu beş etiketten TAM OLARAK birini yaz:
  kaos     : tamamen kontrolden çıkmış (caps kilidi, emoji yağmuru, kelime salatası)
  takinti  : takıntı/bağımlılık belirtisi (uykusuzluk, spam, saplantılı tekrar)
  siradan  : sıradan chat kaosu, gündelik sataşma
  sakin    : sakin, anlaşılır, hatta kibar bir mesaj
  supheli  : şüpheli derecede normal — bu da başlı başına bir vaka
Beş bandı da gerçekten kullan; her mesajı aynı banda yığma.

Çıktı formatı — tam olarak şu üç satır, başka hiçbir şey yazma:
TESHIS: <en fazla 5 kelimelik uydurma sendrom adı>
BANT: <yukarıdaki beş etiketten biri>
RAPOR: <2-3 cümle, en fazla 260 karakter>
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
Kısa ve keskin cümlelerle tiye alırsın, ama küfür etmez ve kişiselleşmezsin — sadece mesajı hedef alırsın.
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

  const kirp = (s) => s.trim().replace(/^[*_"'\s]+|[*_"'\s]+$/g, '');

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
    .replace(/[ıi̇]/g, 'i').replace(/[şs]/g, 's').replace(/[ğg]/g, 'g')
    .replace(/[öo]/g, 'o').replace(/[üu]/g, 'u').replace(/[çc]/g, 'c')
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

// Overlay'de yazan metin ile seslendirilen metin aynı olsun diye tek yerden üretilir.
function seslendirmeMetni({ teshis, rapor }) {
  return `${teshis}. ${rapor}`;
}

module.exports = { USLUPLAR, uslupListesi, kullaniciMesaji, raporAyristir, seslendirmeMetni };
