// Chat mesajlarından bağlantı ayıklama.
//
// Bulunan bağlantılar panelde TIKLANABİLİR hale geliyor, yani metin doğrudan
// güvenilmeyen bir kaynaktan geliyor. Bu yüzden yalnızca http/https kabul ediliyor;
// javascript:, data:, file: gibi şemalar hiçbir koşulda geçmiyor.

const KALIPLAR = [
  /\bhttps?:\/\/[^\s<>"'`]+/gi,          // tam adres
  /\bwww\.[^\s<>"'`]+/gi,                // www. ile başlayan
  // Şemasız "alan.adi/yol". Türkçe alan adları da geçsin diye Unicode harf sınıfı
  // kullanılıyor; \b ASCII tabanlı olduğu için başa lookbehind konuldu.
  /(?<![\p{L}\p{N}@._-])[\p{L}\p{N}][\p{L}\p{N}-]*(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,}\/[^\s<>"'`]*/giu,
];

// Cümle sonu noktalama ve kapanmamış parantezler adrese yapışıyor.
function kuyrukTemizle(url) {
  let s = url;
  for (;;) {
    const oncesi = s;
    s = s.replace(/[.,;:!?'"»”’]+$/, '');
    // Adreste açılmamış bir ')' varsa (ör. "(bak: site.com/x)") onu at.
    if (s.endsWith(')') && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) {
      s = s.slice(0, -1);
    }
    if (s === oncesi) return s;
  }
}

function normalize(ham) {
  const temiz = kuyrukTemizle(ham);
  const tam = /^https?:\/\//i.test(temiz) ? temiz : `https://${temiz}`;
  try {
    const u = new URL(tam);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

// Ayrıntılı sonuç: [{ raw, url }] — `raw` metinde geçen hâli, `url` normalize edilmiş
// adres. Panel, metni tıklanabilir yaparken `raw`ı arayıp `url`e bağlıyor; böylece
// "neyin link sayıldığı" kararı tek yerde, burada kalıyor.
//
// Mesajdaki benzersiz bağlantıları sırayla döndürür.
//
// Kalıplar sırayla uygulanıp eşleşmelerin metindeki ARALIĞI kaydediliyor: daha genel
// olan "alan adı + yol" kalıbı, önce yakalanmış bir adresin içinden parça koparamasın.
// (Örn. "örnek.com/x" içinden "rnek.com/x" çıkmasını bu engelliyor — 'ö' ASCII olmadığı
// için orada kelime sınırı oluşuyor.)
function linkleriBulDetayli(text) {
  const metin = String(text || '');
  const bulunan = [];
  const araliklar = [];

  for (const kalip of KALIPLAR) {
    for (const m of metin.matchAll(kalip)) {
      const bas = m.index;
      const son = bas + m[0].length;
      if (araliklar.some(([a, b]) => bas < b && son > a)) continue;

      const url = normalize(m[0]);
      if (!url) continue;

      araliklar.push([bas, son]);
      bulunan.push({ raw: kuyrukTemizle(m[0]), url, bas });
    }
  }

  // Metinde geçtikleri sıraya göre ver.
  return bulunan.sort((a, b) => a.bas - b.bas).map(({ raw, url }) => ({ raw, url }));
}

// Yalnızca benzersiz adresler (Linkler sekmesi için).
function linkleriBul(text) {
  const gorulen = new Set();
  return linkleriBulDetayli(text)
    .map((l) => l.url)
    .filter((u) => (gorulen.has(u) ? false : gorulen.add(u)));
}

// Panelde uzun adresleri kısaltarak göstermek için.
function kisaGoster(url, uzunluk = 60) {
  const s = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return s.length > uzunluk ? s.slice(0, uzunluk - 1) + '…' : s;
}

module.exports = { linkleriBul, linkleriBulDetayli, kisaGoster };
