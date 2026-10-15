"use strict";
// Salesforce-Bestand (lokaler Scan) mit den Betrieben der Firmensuche abgleichen:
// erst Adresse (PLZ + Straße + Hausnummer), dann Name. Die Daten kommen nur vom lokalen Programm und bleiben im Browser.

const sfs = { rows: null, idx: {}, cache: {}, loadedAt: 0, loading: false };
state.openSf = new Set();

const sfsNorm = (s) => (s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
const SFS_STOP = new Set("gmbh mbh co kg ag ug ek e k v ohg gbr und the inh inhaber haftungsbeschraenkt eg se kgaa der die das de".split(" "));
const sfsTokens = (s) => sfsNorm(s).split(" ").filter((t) => t.length >= 2 && !SFS_STOP.has(t));

function sfsAddr(a) {
  const m = (a || "").match(/\b(\d{5})\b/);
  const plz = m ? m[1] : "";
  let street = (m ? a.slice(0, m.index) : a || "").replace(/[,\s]+$/, "").split(",")[0];
  const hn = street.match(/(\d+)\s*[a-zA-Z]?\s*(?:[-/]\s*\d+\s*[a-zA-Z]?)?\s*$/);
  const nr = hn ? hn[1] : "";
  if (hn) street = street.slice(0, hn.index);
  const key = sfsNorm(street).replace(/strasse|str\b/g, "str").replace(/\s+/g, "");
  return { plz, key, nr };
}

function sfsLoad(force) {
  if (sfs.loading || (!force && Date.now() - sfs.loadedAt < 60000)) return;
  sfs.loading = true;
  sfcCall("/scan").then((d) => {
    sfs.rows = d.rows || [];
    sfs.idx = {};
    sfs.cache = {};
    for (const r of sfs.rows) {
      const a = sfsAddr(`${r.strasse || ""}, ${r.plz || ""}`);
      if (!a.plz || !a.key) continue;
      (sfs.idx[a.plz] ||= []).push({ r, a, t: sfsTokens(r.name) });
    }
    sfs.loadedAt = Date.now();
    render();
  }).catch(() => { sfs.loadedAt = Date.now(); }).finally(() => { sfs.loading = false; });
}

function sfsMatch(l) {
  if (!sfs.rows) return null;
  if (l.id in sfs.cache) return sfs.cache[l.id];
  const a = sfsAddr(l.address);
  const lt = sfsTokens(l.name);
  let best = null;
  for (const c of sfs.idx[a.plz] || []) {
    if (c.a.key !== a.key || (a.nr && c.a.nr && a.nr !== c.a.nr)) continue; // Adresse muss stimmen
    const shared = lt.filter((t) => t.length >= 3 && c.t.some((u) => u === t || (t.length >= 5 && u.length >= 5 && (u.startsWith(t) || t.startsWith(u)))));
    if (!shared.length) continue; // Name muss zumindest teilweise passen (Impressum-Name weicht oft ab)
    if (!best || shared.length > best.n) best = { ...c, n: shared.length, shared };
  }
  return (sfs.cache[l.id] = best && { acc: best.r, shared: best.shared, hnr: !!(a.nr && best.a.nr) });
}

function sfsState(m) {
  const a = m.acc;
  if (a.sperre || (a.sperre_status && !/^[-–—\s]*$/.test(a.sperre_status))) return { c: "r", txt: "gesperrt, nicht kontaktieren" };
  if (a.offen && a.offen.length && a.offen_blockt !== false) return { c: "y", txt: "offene Aufgabe/Termin geplant (" + a.offen.join(", ") + ")", offen: true };
  if (!a.letzter_kontakt) return { c: "n", txt: a.gelesen ? "Kontaktdatum nicht lesbar" : "Kontaktdatum noch nicht gelesen" };
  const days = Math.floor((Date.now() - new Date(a.letzter_kontakt).getTime()) / 864e5);
  return days > 90 ? { c: "g", txt: "frei: letzter Kontakt über 3 Monate her", days } : { c: "y", txt: "kürzlich kontaktiert (unter 3 Monate)", days };
}

const sfsAttr = (a) => (a.opps > 0 || a.vg > 0);
const sfsAttrTxt = (a) => [a.opps > 0 ? a.opps + " Opportunit" + (a.opps === 1 ? "y" : "ies") : "", a.vg > 0 ? a.vg + " Vertriebsgesellschaft" + (a.vg === 1 ? "" : "en") : ""].filter(Boolean).join(", ");

function sfsDot(l) {
  const m = sfsMatch(l);
  if (!m) return "";
  const s = sfsState(m);
  const star = s.c === "g" && sfsAttr(m.acc);
  const tip = s.txt + (star ? " – besonders attraktiv: " + sfsAttrTxt(m.acc) : "");
  return `<div><button class="sfs-dot ${s.c}${star ? " star" : ""}" data-sfs="${esc(l.id)}" title="Salesforce: ${esc(tip)} – klicken für Details" aria-expanded="${state.openSf.has(l.id)}">S${star ? "<i>★</i>" : ""}</button></div>`;
}

function sfsMonths(d) { return d < 60 ? `vor ${d} Tagen` : `vor ${Math.round(d / 30)} Monaten`; }

function sfsDetailHtml(l, colspan) {
  const m = sfsMatch(l);
  if (!m) return "";
  const a = m.acc, s = sfsState(m);
  const offen = a.offen && a.offen.length
    ? `<tr><td>Offene Aufgaben</td><td><b class="${a.offen_blockt === false ? "" : "sfs-bad"}">${esc(a.offen.join(", "))}</b> (geplanter Anruf/Termin) · ${a.offen_blockt === false ? "ohne Kommentar, zählt nicht als belegt" : esc(a.offen_hinweis || "belegt")}${a.offen_kommentar ? `<div class="sub">Kommentar: „${esc(a.offen_kommentar)}“</div>` : ""}</td></tr>` : "";
  const kontakt = a.letzter_kontakt ? `<b>${fmtDate(a.letzter_kontakt)}</b> (${sfsMonths(s.days)})${a.quelle ? " · Quelle: " + esc(a.quelle) : ""}${a.quellen ? `<div class="sub">Aktivität-Feld: ${esc(fmtDate(a.quellen.feld) || "–")} · Verlauf: ${esc(fmtDate(a.quellen.verlauf) || "–")} · Zuletzt geändert: ${esc(fmtDate(a.quellen.geaendert) || "–")}</div>` : ""}` : esc(s.txt);
  const sperre = s.c === "r" ? `<b class="sfs-bad">ja${a.sperre_status ? ": " + esc(a.sperre_status) : ""}</b>` : "nein";
  const frei = s.c === "g" ? `<b class="sfs-good">ja, älter als 3 Monate</b>` : s.c === "y" ? (s.offen ? "nein, offene Aufgabe/Termin " + esc(a.offen.join(", ")) : "nein, kürzlich kontaktiert") : s.c === "r" ? "nein, gesperrt" : "unklar";
  return `<tr class="near-detail"><td colspan="${colspan}"><div class="near-box">
    <div class="near-head"><b>Salesforce: ${esc(a.name)}</b>
      ${a.url ? `<a class="pitch-btn" href="${esc(a.url)}" target="_blank" rel="noopener">In Salesforce öffnen ↗</a>` : ""}</div>
    <table class="sfs-table">
      <tr><td>Treffer</td><td>Adresse stimmt (${esc(a.strasse)}, ${esc(a.plz)} ${esc(a.ort)}) · Name passt in: ${esc(m.shared.join(", "))}</td></tr>
      <tr><td>Firmenstatus</td><td>${esc(a.status || "–")}</td></tr>
      <tr><td>Letzter Kontakt</td><td>${kontakt}</td></tr>
      ${offen}
      <tr><td>Gesperrt</td><td>${sperre}</td></tr>
      <tr><td>Frei?</td><td>${frei}</td></tr>
      ${sfsAttr(a) ? `<tr><td>Potenzial</td><td><b class="${s.c === "g" ? "sfs-good" : ""}">${s.c === "g" ? "★ besonders attraktiv: " : ""}${esc(sfsAttrTxt(a))}</b> im Account${a.kontakte ? " · " + a.kontakte + " Kontakte" : ""}</td></tr>` : ""}
    </table></div></td></tr>`;
}

function sfsMatches(l) {
  const f = $("#sfs-filter")?.value;
  if (!f || !sfs.rows) return true;
  const m = sfsMatch(l);
  if (f === "nein") return !m;
  if (!m) return false;
  if (f === "ja") return true;
  const st = sfsState(m);
  if (f === "attraktiv") return st.c === "g" && sfsAttr(m.acc);
  return st.c === { frei: "g", kuerzlich: "y", gesperrt: "r" }[f];
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-sfs]");
  if (!b) return;
  const id = b.dataset.sfs;
  state.openSf.has(id) ? state.openSf.delete(id) : state.openSf.add(id);
  render();
});
document.addEventListener("change", (e) => { if (e.target.closest("#sfs-filter")) { state.limit = 200; render(); } });
window.addEventListener("focus", () => sfsLoad());
window.addEventListener("load", () => sfsLoad(true));
