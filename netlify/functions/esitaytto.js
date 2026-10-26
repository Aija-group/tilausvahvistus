// Esitäyttö domainista: hakee yrityksen sivulta Y-tunnuksen, sähköpostit ja puhelimet,
// ja täydentää nimen + osoitteen PRH:n avoimesta YTJ-rajapinnasta. Ei tallenna mitään.
const PRH = "https://avoindata.prh.fi/opendata-ytj-api/v3/companies";
const json = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
const clean = d => String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

function validYtunnus(s) {
  const m = /^(\d{7})-(\d)$/.exec(s); if (!m) return false;
  const w = [7, 9, 10, 5, 8, 4, 2], sum = [...m[1]].reduce((a, c, i) => a + +c * w[i], 0), r = sum % 11;
  const chk = r === 0 ? 0 : r === 1 ? -1 : 11 - r;
  return chk === +m[2];
}
async function getText(url, ms = 8000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; AijaGroup-esitaytto/1.0)", "Accept": "text/html,*/*" } });
    if (!r.ok) return "";
    return (await r.text()).slice(0, 600000);
  } catch (e) { return ""; } finally { clearTimeout(t); }
}
function strip(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
function extract(html, domain) {
  const text = strip(html) + " " + (html.match(/mailto:[^"'\s>]+/gi) || []).join(" ") + " " + (html.match(/tel:[^"'\s>]+/gi) || []).join(" ");
  const yt = new Set();
  for (const m of text.matchAll(/\b(\d{7})\s?-\s?(\d)\b/g)) { const id = m[1] + "-" + m[2]; if (validYtunnus(id)) yt.add(id); }
  const bad = /example|sentry|wixpress|wordpress|\.png|\.jpg|\.svg|@2x|noreply|no-reply/i;
  const emails = [...new Set((text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(e => e.toLowerCase()).filter(e => !bad.test(e)))];
  const own = emails.filter(e => e.endsWith("@" + domain)), other = emails.filter(e => !e.endsWith("@" + domain));
  const noYt = text.replace(/\b\d{7}\s?-\s?\d\b/g, " ");
  const seen = new Set(), phones = [];
  for (const m of noYt.matchAll(/(?<![\d-])(?:\+358|0)\s?[1-9]\d?(?:[\s-]?\d){6,8}(?![\d-])/g)) {
    const p = m[0].replace(/\s+/g, " ").trim(), key = p.replace(/\D/g, "").replace(/^358/, "0");
    if (key.length < 9 || key.length > 11 || seen.has(key)) continue;
    seen.add(key); phones.push(p);
  }
  return { ytunnukset: [...yt], emails: [...own, ...other].slice(0, 5), phones: phones.slice(0, 3) };
}
function company(c) {
  const name = (c.names || []).find(n => !n.endDate && n.type === "1")?.name || (c.names || []).find(n => !n.endDate)?.name || "";
  const addr = (c.addresses || []).find(a => a.type === 2) || (c.addresses || [])[0];
  let line = "";
  if (addr) {
    const street = [addr.street, addr.buildingNumber, addr.entrance, addr.apartmentNumber].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const box = addr.postOfficeBox ? "PL " + addr.postOfficeBox : "";
    const city = (addr.postOffices || []).find(p => p.languageCode === "1")?.city || (addr.postOffices || [])[0]?.city || "";
    const cityCase = city ? city.charAt(0) + city.slice(1).toLowerCase() : "";
    line = [addr.co ? "c/o " + addr.co : "", street || box, [addr.postCode, cityCase].filter(Boolean).join(" ")].filter(Boolean).join("\n");
  }
  return { ytunnus: c.businessId?.value || c.businessId || "", company: name, address: line };
}
async function prhById(id) {
  try { const r = await fetch(PRH + "?businessId=" + encodeURIComponent(id)); const d = await r.json(); const c = (d.companies || [])[0]; return c ? company(c) : null; } catch (e) { return null; }
}
async function prhByName(name) {
  try { const r = await fetch(PRH + "?name=" + encodeURIComponent(name)); const d = await r.json(); const list = d.companies || []; return list.length === 1 ? company(list[0]) : null; } catch (e) { return null; }
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const domain = clean(q.domain || (event.body && (JSON.parse(event.body || "{}").domain)));
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain)) return json(400, { ok: false, error: "domain puuttuu tai on virheellinen" });

  let html = await getText("https://" + domain + "/");
  if (!html) html = await getText("https://www." + domain + "/");
  let found = extract(html, domain);
  if (!found.ytunnukset.length && html) {
    for (const path of ["/yhteystiedot", "/yhteystiedot/", "/contact", "/yritys", "/tietoa-meista"]) {
      const h2 = await getText("https://" + domain + path, 5000); if (!h2) continue;
      const f2 = extract(h2, domain);
      found = { ytunnukset: f2.ytunnukset, emails: [...new Set([...found.emails, ...f2.emails])].slice(0, 5), phones: [...new Set([...found.phones, ...f2.phones])].slice(0, 3) };
      if (found.ytunnukset.length) break;
    }
  }
  let yritys = null, lahde = "";
  if (found.ytunnukset.length) { yritys = await prhById(found.ytunnukset[0]); lahde = "sivu + YTJ"; }
  if (!yritys) { yritys = await prhByName(domain.split(".")[0].replace(/-/g, " ")); if (yritys) lahde = "YTJ nimihaku"; }
  return json(200, { ok: true, domain, sivuLoytyi: !!html, lahde, ...(yritys || {}), ytunnukset: found.ytunnukset, emails: found.emails, phones: found.phones });
};
