// Çok sağlayıcılı LLM zinciri. Sırayla denenir; biri limit/hata verince diğerine geçilir.
// Hepsi OpenAI uyumlu chat/completions ucu kullanır; .env'de tanımlı olanlar otomatik devreye girer.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Groq'ta her modelin AYRI günlük token kotası var; sırayla denenince kotalar toplanır.
const GROQ_VARSAYILAN = 'openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.6-27b';

// gpt-oss ve qwen3 reasoning modeli; sözlükleri farklı, yanlışını gönderince 400 döner.
// Rapor kalitesi doğrudan buna bağlı: 'low' ile model mesajı okumadan genel
// geçer cümleler kuruyordu. 'medium' biraz daha yavaş ama gözlem somutlaşıyor.
function reasoningAyari(model) {
  if (model.includes('gpt-oss')) return { reasoning_effort: 'medium' };
  // qwen3'te 'default' DENEME: düşünme zincirinin tamamını content'e sızdırıyor,
  // rapor yerine 3000+ karakterlik İngilizce muhakeme geliyor. 'none' şart.
  if (model.includes('qwen3')) return { reasoning_effort: 'none' };
  return {};
}

function providers() {
  const env = process.env;
  const list = [];

  if (env.GROQ_API_KEY) {
    const modeller = (env.GROQ_MODELS || GROQ_VARSAYILAN).split(',').map((s) => s.trim()).filter(Boolean);
    modeller.forEach((model, i) => {
      list.push({ name: `groq-${i + 1}`, url: GROQ_URL, key: env.GROQ_API_KEY, model, ekstra: reasoningAyari(model) });
    });
  }
  if (env.CEREBRAS_API_KEY) {
    list.push({ name: 'cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', key: env.CEREBRAS_API_KEY, model: env.CEREBRAS_MODEL || 'llama3.1-8b' });
  }
  if (env.OPENROUTER_API_KEY) {
    list.push({ name: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free' });
  }
  if (env.GEMINI_API_KEY) {
    list.push({ name: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.0-flash' });
  }
  if (env.OLLAMA_URL) {
    list.push({ name: 'ollama', url: `${env.OLLAMA_URL.replace(/\/$/, '')}/v1/chat/completions`, model: env.OLLAMA_MODEL || 'llama3.1' });
  }
  return list;
}

function configuredProviders() {
  return providers().map((p) => `${p.name} (${p.model})`);
}

async function callOne(p, system, user, opts) {
  const headers = { 'Content-Type': 'application/json' };
  if (p.key) headers.Authorization = `Bearer ${p.key}`;

  const res = await fetch(p.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: p.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: opts.temperature ?? 0.95,
      max_tokens: opts.maxTokens ?? 220,
      ...(p.ekstra || {}),
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${p.name} ${res.status}: ${body.slice(0, 150)}`);
  }
  const json = await res.json();
  const content = (json?.choices?.[0]?.message?.content ?? '').trim();
  if (!content) throw new Error(`${p.name}: boş yanıt`);
  return content;
}

// { text, provider, model, attempts } döner; hepsi düşerse hata fırlatır.
async function chat(system, user, opts = {}) {
  const list = providers();
  if (list.length === 0) {
    throw new Error('Hiç LLM sağlayıcısı yapılandırılmadı. .env dosyasına en az GROQ_API_KEY ekle.');
  }
  const attempts = [];
  for (const p of list) {
    try {
      const text = await callOne(p, system, user, opts);
      return { text, provider: p.name, model: p.model, attempts };
    } catch (err) {
      attempts.push(`${p.name}: ${String(err.message || err)}`);
      console.error(`[llm] ${p.name} başarısız, sıradakine geçiliyor →`, err.message || err);
    }
  }
  throw new Error('Tüm LLM sağlayıcıları başarısız oldu:\n' + attempts.join('\n'));
}

module.exports = { chat, configuredProviders };
