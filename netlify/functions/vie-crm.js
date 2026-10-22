// Vie CRM:ään: tilausvahvistus → FluidCRM Toimitus-putki (Vahvistus lähetetty) + muistutus.
// Avain Netlifyn ympäristömuuttujassa FLUID_API_KEY (ei koskaan repossa).
const FLUID = "https://api.fluidcrm.io/v1";
const PIPELINE = "9fc4d641-df8e-4b6a-b172-3a698d498f3a";                 // Toimitus
const STAGE_VAHVISTUS = "1bdc5933-ef3b-4bfe-a3c6-ab8d2779c473";         // Vahvistus lähetetty

const json = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
const clean = d => String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const firstEur = s => { const m = String(s || "").match(/([\d\s ]+(?:[.,]\d{1,2})?)\s*€/); return m ? parseFloat(m[1].replace(/[\s ]/g, "").replace(",", ".")) || 0 : 0; };
const isoDate = s => { const m = String(s || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : (String(s || "").match(/^\d{4}-\d{2}-\d{2}/) ? s.slice(0, 10) : ""); };
function plusBusinessDays(n, hour) { const d = new Date(); while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; } d.setUTCHours(hour - 2, 0, 0, 0); return d.toISOString(); }

async function fluid(key, method, path, body) {
  const r = await fetch(FLUID + path, { method, headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok) throw new Error(`Fluid ${method} ${path} → ${r.status} ${j.error || t.slice(0, 200)}`);
  return j;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  const key = process.env.FLUID_API_KEY;
  if (!key) return json(503, { ok: false, error: "FLUID_API_KEY puuttuu Netlifyn ympäristömuuttujista" });
  let d; try { d = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { ok: false, error: "bad json" }); }
  if (!d.asiakas || !d.sahkoposti || !d.domain) return json(400, { ok: false, error: "asiakas, sahkoposti tai domain puuttuu" });

  const domain = clean(d.domain);
  const kickoff = d.aloituspalaveri ? String(d.aloituspalaveri).slice(0, 10) : "";
  const cf = { Domain: domain, "Vahvistus #": d.tilausnumero || "", "Myyjä": d.myyja || "" };
  const kp = isoDate(d.paivays); if (kp) cf["Kauppapäivä"] = kp;
  if (kickoff) cf["Aloituspalaveri"] = kickoff;
  cf["Siirtotiedot pyydetty"] = new Date().toISOString().slice(0, 10);   // lomakelinkki lähtee vahvistuksen mukana
  const siirtoLinkki = `https://ryyderintilausvahvistus.netlify.app/siirtotiedot/?domain=${encodeURIComponent(domain)}&yritys=${encodeURIComponent(d.asiakas)}&email=${encodeURIComponent(d.sahkoposti)}&nimi=${encodeURIComponent(d.yhteyshenkilo || "")}`;
  Object.keys(cf).forEach(k => { if (!cf[k]) delete cf[k]; });

  const body = {
    stage_id: STAGE_VAHVISTUS,
    contact: { name: d.yhteyshenkilo || d.asiakas, email: String(d.sahkoposti).trim().toLowerCase(), company: d.asiakas, phone: d.puhelin || undefined, website: "https://" + domain },
    deal: {
      deal_name: `${d.asiakas} – ${domain}`,
      value: firstEur(d.kertaluonteiset) || undefined,
      source: "tilausvahvistus",
      notes: `Tilausvahvistus ${d.tilausnumero || ""} ${d.paivays || ""}\nMyyjä: ${d.myyja || ""}\nY-tunnus: ${d.ytunnus || ""}\nLaskutusosoite: ${d.laskutusosoite || ""}\n\n${d.tilausrivit || ""}\n${d.kertaluonteiset ? "Kertamaksu: " + d.kertaluonteiset + "\n" : ""}${d.kuukausittain ? "Hosting: " + d.kuukausittain + "\n" : ""}Laskutus: ${d.laskutus || ""}\nMaksuehto: ${d.maksuehto || ""}\n${d.lisatiedot || ""}\n\nSiirtotietolomake: ${siirtoLinkki}`,
      next_action: `Ville: lähetä vahvistus Visma Signiin ja siirtotietolomake ${siirtoLinkki}` + (kickoff ? ` · Aloituspalaveri ${kickoff}` : " · sovi aloituspalaveri"),
    },
    custom_fields: cf,
    external: { source: "tilausvahvistus", id: `${d.tilausnumero || "x"}|${domain}` },
  };
  try {
    const r = await fluid(key, "POST", "/ingest", body);
    let reminder = false;
    if (r.created_deal) {
      try { await fluid(key, "POST", "/reminders", { deal_id: r.deal_id, reminder_at: plusBusinessDays(2, 9), note: `Onko ${d.asiakas} allekirjoittanut tilausvahvistuksen Visma Signissa? Jos ei, soita. Allekirjoitettu → siirrä vaiheeseen Vahvistus allekirjoitettu.` }); reminder = true; } catch (e) {}
    }
    return json(200, { ok: true, deal_id: r.deal_id, created: !!r.created_deal, updated: !!r.updated_deal, reminder, url: "https://fluidcrm.io/deals" });
  } catch (e) {
    return json(502, { ok: false, error: e.message });
  }
};
