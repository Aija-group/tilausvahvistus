// Varmistusajo 10 min välein (netlify.toml schedule): hakee Netlify Formsin lähetykset ja vie ne toimitusputken
// Apps Scriptille palvelimelta. Skripti käsittelee saman tilauksen vain kerran, joten jo käsitellyt palautuvat duplicate:true.
// Kytkee myös Netlifyn webhookin takaisin päälle, jos Netlify on sammuttanut sen (hitaan vastauksen jälkeen).
// Vaatii Netlifyn ympäristömuuttujan NETLIFY_TOKEN (Personal access token, scope functions).
const SITE = "9e793567-4138-4798-8dae-f60af1eb7230";
const API = "https://api.netlify.com/api/v1";
const PUTKI_URL = "https://script.google.com/macros/s/AKfycbzXKL8abPr58mJYhr96OJN3CqS5r0R7siYjSKrvzB9dBMNC7jOGe1baWFQU7hwz0-Kh/exec";
const ALKAEN = "2026-10-27T12:00:00Z";   // vanhempia ei käsitellä automaattisesti (27.10. aamun tilaukset ajettu käsin)
const IKKUNA_H = 72;                      // kuinka vanhoja lähetyksiä tarkistetaan

async function netlify(token, method, path, body) {
  const r = await fetch(API + path, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok) throw new Error(`Netlify ${method} ${path} → ${r.status} ${t.slice(0, 200)}`);
  return j;
}

async function putkeen(payload) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(PUTKI_URL, { method: "POST", redirect: "follow", signal: ac.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch (e) {}
    return j.ok ? (j.duplicate ? "duplicate" : "ok") : "http " + r.status + " " + txt.slice(0, 120);
  } catch (e) { return "virhe " + e.message; } finally { clearTimeout(t); }
}

exports.handler = async () => {
  const token = process.env.NETLIFY_TOKEN;
  if (!token) return { statusCode: 503, body: "NETLIFY_TOKEN puuttuu" };
  const raja = new Date(Math.max(Date.now() - IKKUNA_H * 3600e3, Date.parse(ALKAEN))).toISOString();
  const tulos = { webhook: "ok", lahetykset: [] };

  // 1) Webhook takaisin päälle, jos sammunut
  try {
    const hooks = await netlify(token, "GET", `/hooks?site_id=${SITE}`);
    for (const h of hooks) {
      if (h.type === "url" && h.event === "submission_created" && h.disabled) {
        await netlify(token, "POST", `/hooks/${h.id}/enable`); tulos.webhook = "kytketty takaisin " + h.id;
      }
    }
  } catch (e) { tulos.webhook = "virhe " + e.message; }

  // 2) Lomakkeiden lähetykset ikkunan sisällä → skriptille (skripti ohittaa jo käsitellyt)
  try {
    const forms = await netlify(token, "GET", `/sites/${SITE}/forms`);
    for (const f of forms) {
      const subs = await netlify(token, "GET", `/forms/${f.id}/submissions?per_page=50`);
      for (const s of subs) {
        if (s.created_at < raja) continue;
        const tila = await putkeen({ id: s.id, form_name: f.name, source: "tarkista-tilaukset", created_at: s.created_at, data: s.data });
        tulos.lahetykset.push(`${f.name} ${s.id} ${(s.data || {}).asiakas || ""} → ${tila}`);
      }
    }
  } catch (e) { tulos.virhe = e.message; }

  console.log(JSON.stringify(tulos));
  return { statusCode: 200, body: JSON.stringify(tulos) };
};
