// Profil fotoğrafı çözümü.
//
// kick.com/api/v2/* uçları Cloudflare tarafından bloklanıyor (Node'dan 403 "Request blocked by
// security policy"), o yüzden fotoğrafı resmî Kick public API'sinden çekiyoruz. Bunun için
// kullanıcı OAuth'una gerek yok; app-level client_credentials token'ı yetiyor.
// Anahtar yoksa veya kullanıcı bulunamazsa null döner ve arayüz baş harf avatarına düşer.

const TOKEN_URL = 'https://id.kick.com/oauth/token';
const USERS_URL = 'https://api.kick.com/public/v1/users';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6 saat
const NEG_TTL_MS = 15 * 60 * 1000;        // bulunamayanı 15dk tekrar deneme

const cache = new Map();   // userId -> { url, expires }
const bekleyen = new Map();// userId -> Promise (aynı anda tek istek)

let token = null;          // { value, expires }

function yapilandirildiMi() {
  return Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET);
}

async function appToken() {
  if (token && token.expires > Date.now() + 30000) return token.value;
  if (!yapilandirildiMi()) return null;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.KICK_CLIENT_ID,
    client_secret: process.env.KICK_CLIENT_SECRET,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
  const json = await res.json();
  token = { value: json.access_token, expires: Date.now() + (json.expires_in || 3600) * 1000 };
  return token.value;
}

async function apidenCek(userId) {
  const t = await appToken();
  if (!t) return null;

  const res = await fetch(`${USERS_URL}?id=${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) {
    token = null; // süresi dolmuş olabilir, bir sonraki denemede yenilenir
    throw new Error('401 unauthorized');
  }
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);

  const json = await res.json();
  const kayit = Array.isArray(json?.data) ? json.data[0] : null;
  return kayit?.profile_picture || null;
}

// Her zaman çözülür; hata durumunda null döner (arayüz baş harf avatarı gösterir).
async function profilFotosu(userId) {
  if (!userId || !yapilandirildiMi()) return null;

  const key = String(userId);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;
  if (bekleyen.has(key)) return bekleyen.get(key);

  const p = (async () => {
    try {
      const url = await apidenCek(key);
      cache.set(key, { url, expires: Date.now() + (url ? CACHE_TTL_MS : NEG_TTL_MS) });
      return url;
    } catch (err) {
      console.error(`[avatar] ${key} çekilemedi:`, err.message || err);
      cache.set(key, { url: null, expires: Date.now() + NEG_TTL_MS });
      return null;
    } finally {
      bekleyen.delete(key);
    }
  })();

  bekleyen.set(key, p);
  return p;
}

module.exports = { profilFotosu, yapilandirildiMi };
