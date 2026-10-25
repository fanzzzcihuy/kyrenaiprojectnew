// Fungsi serverless Vercel: meneruskan chat ke Groq. API key diambil dari Environment Variable GROQ_API_KEY.
const SYSTEM = 'Kamu adalah Killua AI, asisten AI yang ramah, santai, dan cerdas. Developermu bernama Kyren. Jawab dalam bahasa yang dipakai pengguna, singkat dan jelas.';
const MAX_PER_MINUTE = 15; // batas pesan per pengunjung (per IP) tiap menit, berlaku per instance server

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > MAX_PER_MINUTE;
}

let model = process.env.GROQ_MODEL || '';
async function pickModel(key) {
  if (model) return model;
  const prefer = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { 'Authorization': 'Bearer ' + key } });
    const ids = ((await r.json()).data || []).map(m => m.id);
    model = prefer.find(id => ids.includes(id)) || ids.find(id => !/whisper|tts|guard|orpheus|embed|safeguard|distil|compound/i.test(id)) || prefer[0];
  } catch (e) { model = prefer[0]; }
  return model;
}

function clean(msgs) {
  if (!Array.isArray(msgs)) return null;
  const out = msgs.slice(-20)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

function fail(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: { message } }));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'Metode tidak didukung.');
  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) return fail(res, 500, 'Server belum dikonfigurasi.');

  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
  if (limited(ip)) return fail(res, 429, 'Terlalu banyak pesan. Tunggu sebentar lalu coba lagi.');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const messages = clean(body && body.messages);
  if (!messages) return fail(res, 400, 'Permintaan tidak valid.');

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
      body: JSON.stringify({
        model: await pickModel(KEY),
        stream: true,
        max_tokens: 800,
        messages: [{ role: 'system', content: SYSTEM }, ...messages]
      })
    });
    if (!r.ok) {
      console.error('Groq error', r.status, await r.text().catch(() => ''));
      if (!process.env.GROQ_MODEL) model = '';
      return fail(res, r.status === 429 ? 429 : 502, r.status === 429 ? 'Killua AI sedang ramai. Coba lagi sebentar lagi.' : 'Killua AI sedang bermasalah. Coba lagi nanti.');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 502, 'Killua AI sedang bermasalah. Coba lagi nanti.');
    else res.end();
  }
};
