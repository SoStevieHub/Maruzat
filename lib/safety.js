// Yayında ters tepmesin diye: gerçekten sıkıntıda görünen mesajlar AI'a hiç gitmez,
// panelde uyarı olarak görünür. Bu bir teşhis aracı değil, sadece "bununla dalga geçme" freni.

const RISK_KALIPLARI = [
  /intihar/i,
  /kendimi\s*(öld|old)/i,
  /canıma\s*kıy/i,
  /yaşamak\s*istemiyorum/i,
  /ölmek\s*istiyorum/i,
  /bilek\s*kes/i,
  /kendime\s*zarar/i,
  /hayatıma\s*son/i,
  /artık\s*dayanamıyorum/i,
  /\bkys\b/i,
  /kill\s*(my|your)self/i,
  /\bkms\b/i,
  /suicide/i,
  /self\s*harm/i,
];

// Chat'te yakılan ama mizah bağlamı olan kalıplar (yanlış alarmı azaltır).
const ISTISNALAR = [
  /güldüm.*öl/i,
  /gülmekten\s*öl/i,
  /öl(dü|üyorum)\s*(gülmekten|kahkahadan)/i,
];

function riskliMi(text) {
  const s = String(text || '');
  if (ISTISNALAR.some((r) => r.test(s))) return false;
  return RISK_KALIPLARI.some((r) => r.test(s));
}

module.exports = { riskliMi };
