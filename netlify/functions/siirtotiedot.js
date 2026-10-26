// Siirtotietolomake → Fluid: etsii Toimitus-diilin domainilla, merkitsee "Siirtotiedot toimitettu" + "Asennusvalmis",
// lisää vastaukset diilin muistiinpanoihin ja labelin Asennusvalmis.
const FLUID = "https://api.fluidcrm.io/v1";
const PIPELINE = "9fc4d641-df8e-4b6a-b172-3a698d498f3a";

const json = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
const clean = d => String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const today = () => new Date().toISOString().slice(0, 10);
const fi = () => { const d = new Date(); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`; };

async function fluid(key, method, path, body) {
  const r = await fetch(FLUID + path, { method, headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok) throw new Error(`Fluid ${method} ${path} → ${r.status} ${j.error || t.slice(0, 200)}`);
  return j;
}
async function findDeal(key, domain) {
  let cursor = "", pages = 0;
  while (pages++ < 10) {
    const j = await fluid(key, "GET", `/deals?pipeline_id=${PIPELINE}&limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
    const list = j.data || [];
    const hit = list.find(d => clean((d.custom_fields || {}).Domain) === domain || clean(d.website) === domain || String(d.deal_name || d.title || "").toLowerCase().includes(domain));
    if (hit) return hit;
    cursor = (j.pagination || {}).next_cursor || j.next_cursor || "";
    if (!cursor) break;
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const key = process.env.FLUID_API_KEY;
  if (!key) return json(503, { ok: false, error: "FLUID_API_KEY puuttuu Netlifyn ympäristömuuttujista" });
  let d; try { d = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "bad json" }); }
  const domain = clean(d.domain);
  if (!domain) return json(400, { ok: false, error: "domain puuttuu" });

  const rows = [["Yritys", d.yritys], ["Yhteyshenkilö", d.yhteyshenkilo], ["Sähköposti", d.sahkoposti], ["Nykyinen toimittaja", d.valittaja], ["Toimittajan sähköposti", d.toimittaja_email], ["Avain", d.avain],
    ["DNS-hallinta", d.dns], ["Sähköposti missä", d.posti], ["Postilaatikot", d.postilaatikot], ["Posti, tarkennus", d.posti_muu], ["Webhotelli", d.webhotelli],
    ["Sivutoimittaja", d.sivutoimittaja], ["Irtisanomisaika", d.irtisanomisaika], ["Säilytettävä", d.sailytettava], ["Google", d.google],
    ["Lomakkeen viestit", d.lomake_email], ["Puhelin sivulle", d.lomake_puhelin], ["NordicHost-tili", [d.nh_email, d.nh_puhelin].filter(Boolean).join(" / ")], ["Lisätiedot", d.lisatiedot]];
  const teksti = rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");

  try {
    const deal = await findDeal(key, domain);
    if (!deal) return json(404, { ok: false, error: `Fluidista ei löydy diiliä domainille ${domain}` });
    const labels = (deal.labels || []).map(l => (typeof l === "string" ? l : l.name)).filter(Boolean);
    if (!labels.includes("Asennusvalmis")) labels.push("Asennusvalmis");
    const notes = (deal.notes ? deal.notes + "\n\n" : "") + `SIIRTOTIEDOT ${fi()} (asiakkaan lomake)\n${teksti}`;
    await fluid(key, "PATCH", `/deals?id=${deal.id}`, {
      notes, label: labels.join("|"),
      next_action: "Sulo: siirtotiedot saatu, tarkista ja valmistele domainsiirto",
      custom_fields: { "Siirtotiedot toimitettu": today(), "Asennusvalmis": true },
    });
    try { await fluid(key, "POST", "/activities", { deal_id: deal.id, type: "note", content: `Siirtotietolomake vastaanotettu ${fi()}` }); } catch (e) {}
    return json(200, { ok: true, deal_id: deal.id });
  } catch (e) {
    return json(502, { ok: false, error: e.message });
  }
};
