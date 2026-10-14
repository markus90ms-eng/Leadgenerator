"use strict";
// Tab "Salesforce": spricht mit dem lokalen Programm (salesforce-bot/server.py auf deinem Rechner).
// Die Kundendaten werden nur im Speicher dieser Seite gehalten, nie gespeichert oder hochgeladen.

const SF_API = "http://127.0.0.1:8766";
const sf = { imported: false, netError: "", state: "", message: "", rows: [], source: "", updated: "", hasBookings: false, running: false, online: null, loggedIn: false, error: "", log: [], limit: 300, sort: { key: "score", dir: -1 } };

async function sfCall(path, method = "GET") {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(SF_API + path, { method, cache: "no-store", signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 409 ? " (läuft bereits)" : ""));
    return await r.json();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "keine Antwort nach 15 Sekunden" : e.message);
  } finally {
    clearTimeout(timer);
  }
}

function sfInfo(text, cls) {
  const el = $("#sf-info");
  el.textContent = text || "";
  el.className = "stand" + (cls ? " " + cls : "");
}

async function sfRefresh() {
  try {
    const s = await sfCall("/status");
    sf.online = true;
    sf.loggedIn = s.logged_in;
    sf.running = s.state === "running";
    sf.log = s.log || [];
    sf.state = s.state;
    sf.message = s.message || "";
    sf.error = s.state === "error" ? s.message : "";
    $("#sf-login").hidden = !(sf.online && (!s.logged_in || s.state === "need_login"));
    $("#sf-run").disabled = sf.running;
    if (s.state === "need_login") sfInfo("Bitte zuerst bei Salesforce einloggen.", "warn");
    else if (sf.running) sfInfo(s.log[s.log.length - 1] || "Läuft …");
    else if (s.state === "error") sfInfo(s.message, "warn");
    else sfInfo(s.message || "");
    if (!sf.running && !sf.imported && s.result_updated && s.result_updated !== sf.updated) {
      const res = await sfCall("/result");
      Object.assign(sf, { rows: res.rows.map(sfEnrich), source: res.source, updated: res.updated, hasBookings: !!res.has_bookings });
      sfFillSelects();
    }
  } catch (e) {
    sf.online = false;
    sf.netError = sf.netError || e.message;
    sf.running = false;
    $("#sf-login").hidden = true;
    $("#sf-run").disabled = false;
    sfInfo("");
  }
  if (state.tab === "salesforce") render();
  if (sf.running && state.tab === "salesforce") setTimeout(sfRefresh, 1500);
}

async function sfStart(path) {
  // sofort sichtbar reagieren, dann erst die Anfrage senden
  sf.imported = false;
  sf.running = true;
  sf.state = "running";
  sf.log = ["Starte ..."];
  sf.netError = "";
  $("#sf-run").disabled = true;
  sfInfo("Starte …");
  render();
  try {
    await sfCall(path, "POST");
    setTimeout(sfRefresh, 800);
  } catch (e) {
    sf.running = false;
    sf.state = "";
    sf.netError = e.message;
    $("#sf-run").disabled = false;
    sfInfo("Fehler: " + e.message, "warn");
    sfRefresh();
  }
}

// Klicks und Filter über das ganze Dokument abfangen: funktioniert unabhängig von der Lade-Reihenfolge der Skripte.
const SF_VERSION = "10";
try { const saved = localStorage.getItem("sf-liste"); if (saved) window.addEventListener("load", () => { $("#sf-liste").value = saved; }); } catch (_) {}
document.addEventListener("click", (e) => {
  if (e.target.closest("#sf-run")) {
    const liste = ($("#sf-liste").value || "").trim();
    try { localStorage.setItem("sf-liste", liste); } catch (_) {}
    const params = [];
    if (liste) params.push("liste=" + encodeURIComponent(liste));
    if ($("#sf-headed") && $("#sf-headed").checked) params.push("headed=1");
    sfStart("/run" + (params.length ? "?" + params.join("&") : ""));
  }
  else if (e.target.closest("#sf-login")) sfStart("/login");
});
document.addEventListener("input", (e) => {
  if (!e.target.closest("#sf-filters")) return;
  sf.limit = 300;
  $("#sf-minscore-val").textContent = $("#sf-minscore").value;
  render();
});

const sfMonthsAgo = (m) => { const d = new Date(); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); };
const sfDaysSince = (iso) => (iso && iso !== "nie" ? Math.floor((Date.now() - new Date(iso)) / 864e5) : null);
const sfEur = (n) => (n ? Math.round(n).toLocaleString("de-DE") + " €" : "–");

// Potenzial 0-100 mit nachvollziehbaren Gründen
function sfEnrich(r) {
  const why = [];
  let score = 0;
  const add = (pts, text) => { if (pts > 0) { score += pts; why.push(`+${pts} ${text}`); } };
  if (r.gebucht_anzahl > 0) {
    add(30, "schon gebucht (Ex-Kunde)");
    add(Math.min(25, Math.round(Math.log10(r.gebucht_umsatz + 1) * 5)), `bisheriger Umsatz ${sfEur(r.gebucht_umsatz)}`);
    const m = (Date.now() - new Date(r.letzte_buchung)) / (864e5 * 30.4);
    if (r.letzte_buchung) add(m >= 6 && m <= 36 ? 15 : m > 36 ? 5 : 0, `letzte Buchung vor ${Math.round(m)} Monaten`);
  }
  const idle = sfDaysSince(r.letzte_aktivitaet);
  if (idle === null) add(10, "noch nie Aktivität");
  else if (idle >= 180) add(20, "seit über 6 Monaten keine Betreuung");
  else if (idle >= 90) add(15, "seit über 3 Monaten keine Betreuung");
  if ((r.mitarbeiter || 0) >= 50 || (r.jahresumsatz || 0) >= 1e7) add(10, "größeres Unternehmen");
  return { ...r, score: Math.min(100, score), why };
}

function sfFillSelects() {
  const fill = (sel, values) => {
    const cur = $(sel).value;
    $(sel).innerHTML = `<option value="">alle</option>` + [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"))
      .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    $(sel).value = cur;
  };
  fill("#sf-owner", sf.rows.map((r) => r.betreuer));
  fill("#sf-branche", sf.rows.map((r) => r.branche));
}

function sfFiltered() {
  const tokens = $("#sf-text").value.toLowerCase().split(/[,;]+|\s{2,}/).map((t) => t.trim()).filter(Boolean);
  const idleCut = +$("#sf-idle").value ? sfMonthsAgo(+$("#sf-idle").value) : null;
  const bookCut = +$("#sf-lastbook").value ? sfMonthsAgo(+$("#sf-lastbook").value) : null;
  const minRev = +$("#sf-minrev").value, owner = $("#sf-owner").value, br = $("#sf-branche").value, minScore = +$("#sf-minscore").value;
  const mustBook = $("#sf-booked").checked || bookCut || minRev;
  return sf.rows.filter((r) =>
    (!tokens.length || tokens.some((t) => (/^\d+$/.test(t) ? r.plz.startsWith(t) : r.ort.toLowerCase().includes(t) || r.name.toLowerCase().includes(t)))) &&
    (!idleCut || r.letzte_aktivitaet === "nie" || r.letzte_aktivitaet < idleCut) &&
    (!mustBook || r.gebucht_anzahl > 0) &&
    (!bookCut || (r.letzte_buchung && r.letzte_buchung < bookCut)) &&
    (!minRev || r.gebucht_umsatz >= minRev) &&
    (!owner || r.betreuer === owner) && (!br || r.branche === br) && r.score >= minScore);
}

function renderSalesforceInner() {
  const msg = $("#status-msg");
  const results = $("#results");
  if (sf.online === null) sfRefresh();
  msg.hidden = true;
  if (sf.online === false && !sf.rows.length) {
    $("#summary").innerHTML = "Salesforce";
    results.innerHTML = `<div class="sf-empty"><h3>Das Salesforce-Programm läuft noch nicht</h3>
      <ol>
        <li>Im Ordner <b>salesforce-bot</b> auf deinem Rechner <b>Salesforce_starten.bat</b> doppelklicken. Das Fenster offen lassen.</li>
        <li>Hier auf <b>Liste erstellen</b> klicken.</li>
      </ol>
      <p>Oder ohne Programm: links bei <b>CSV importieren</b> eine aus Salesforce exportierte Liste auswählen.</p>
      <button id="sf-retry">Erneut verbinden</button>
      ${sf.netError ? `<p class="hint">Technische Meldung: ${esc(sf.netError)}</p>` : ""}
      <p class="hint">Wenn der Browser nach dem „Zugriff auf Geräte im lokalen Netzwerk“ fragt, bitte erlauben. Das ist dein eigener Rechner.</p></div>`;
    $("#sf-retry").onclick = () => { sf.online = null; sfRefresh(); };
    return;
  }
  if (sf.running && !sf.imported) {
    $("#summary").innerHTML = "Salesforce wird abgefragt …";
    results.innerHTML = `<div class="sf-empty"><h3>Einen Moment …</h3><pre class="sf-log">${esc(sf.log.join("\n"))}</pre>
      <p class="hint">Falls sich ein Browser-Fenster öffnet, ist das normal. Bei vielen Firmen kann es ein paar Minuten dauern.</p></div>`;
    return;
  }
  if (!sf.rows.length) {
    $("#summary").innerHTML = sf.updated ? "Keine Firmen gefunden." : "Noch keine Liste erstellt.";
    results.innerHTML = `<div class="sf-empty"><h3>${sf.updated ? "Keine Treffer" : "Auf „Liste erstellen“ klicken"}</h3>
      <p>Links auf <b>Liste erstellen</b> klicken. Danach kannst du nach Ort, PLZ, Betreuung und Buchungen filtern.</p>${sf.error ? `<p class="warn">${esc(sf.error)}</p>` : ""}</div>`;
    return;
  }
  const { key, dir } = sf.sort;
  const rows = sfFiltered().sort((x, y) => {
    const a = x[key] ?? "", b = y[key] ?? "";
    return (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "de")) * dir;
  });
  sf.visible = rows;
  const partial = /UNVOLLST/.test(sf.source);
  $("#summary").innerHTML = `<b>${rows.length}</b> von ${sf.rows.length} Firmen · Stand ${esc(fmtTime(sf.updated))} · ${esc(sf.source)}`;
  const arrow = (k) => (sf.sort.key === k ? (sf.sort.dir > 0 ? " ▲" : " ▼") : "");
  const th = (k, label) => `<th data-sort="${k}">${label}${arrow(k)}</th>`;
  results.innerHTML = `${partial ? `<div class="sf-warn">Achtung: Die Liste ist unvollständig (Salesforce zeigt in Listenansichten höchstens 2000 Einträge).</div>` : ""}
    ${!sf.hasBookings ? `<div class="sf-warn">Keine Buchungsdaten verfügbar. Die Filter „gebucht“ und „Umsatz“ zeigen deshalb keine Treffer.</div>` : ""}
    <div class="table-wrap"><table><thead><tr>
      ${th("score", "Potenzial")}${th("name", "Firma")}${th("plz", "PLZ / Ort")}${th("branche", "Branche")}${th("letzte_aktivitaet", "Letzte Aktivität")}
      ${th("gebucht_umsatz", "Bisher gebucht")}${th("betreuer", "Betreuer")}<th></th></tr></thead><tbody>
      ${rows.slice(0, sf.limit).map((r) => `<tr>
        <td><span class="score ${r.score >= 60 ? "high" : r.score >= 35 ? "mid" : "low"}" title="${esc(r.why.join("\n"))}">${r.score}</span></td>
        <td class="name">${esc(r.name)}${r.typ ? `<div class="sub">${esc(r.typ)}</div>` : ""}</td>
        <td>${esc(r.plz)} ${esc(r.ort)}${r.strasse ? `<div class="sub">${esc(r.strasse)}</div>` : ""}</td>
        <td>${esc(r.branche)}</td>
        <td>${r.letzte_aktivitaet === "nie" ? `<span class="badge chain">nie</span>` : esc(fmtDate(r.letzte_aktivitaet))}</td>
        <td>${r.gebucht_anzahl ? `${r.gebucht_anzahl}× · ${sfEur(r.gebucht_umsatz)}<div class="sub">zuletzt ${esc(fmtDate(r.letzte_buchung))}</div>` : `<span class="sub">–</span>`}</td>
        <td>${esc(r.betreuer)}</td>
        <td class="contact">${r.telefon ? `<a href="tel:${esc(r.telefon)}">${esc(r.telefon)}</a>` : ""}${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">In Salesforce öffnen</a>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>
    ${rows.length > sf.limit ? `<p><button id="sf-more">Weitere ${Math.min(300, rows.length - sf.limit)} anzeigen (${rows.length - sf.limit} übrig)</button></p>` : ""}`;
  results.querySelectorAll("th[data-sort]").forEach((el) => (el.onclick = () => {
    const k = el.dataset.sort;
    sf.sort = { key: k, dir: sf.sort.key === k ? -sf.sort.dir : k === "score" || k === "gebucht_umsatz" ? -1 : 1 };
    render();
  }));
  if ($("#sf-more")) $("#sf-more").onclick = () => { sf.limit += 300; render(); };
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }); } catch (_) { return iso; }
}

function exportSalesforce() {
  const esc2 = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cols = [["Potenzial", "score"], ["Firma", "name"], ["PLZ", "plz"], ["Ort", "ort"], ["Straße", "strasse"], ["Branche", "branche"],
    ["Letzte Aktivität", "letzte_aktivitaet"], ["Buchungen", "gebucht_anzahl"], ["Umsatz bisher", "gebucht_umsatz"],
    ["Letzte Buchung", "letzte_buchung"], ["Betreuer", "betreuer"], ["Telefon", "telefon"], ["Website", "website"], ["Link", "url"]];
  const rows = sf.visible || [];
  if (!rows.length) return message("Keine Daten zum Exportieren.");
  const lines = rows.map((r) => cols.map(([, k]) => esc2(r[k])).join(";"));
  download(`salesforce_${new Date().toISOString().slice(0, 10)}.csv`, "\ufeff" + [cols.map(([h]) => esc2(h)).join(";"), ...lines].join("\r\n"), "text/csv;charset=utf-8");
}


// Hinweis oben im Hauptbereich (gut sichtbar), z. B. "bitte einloggen" oder Fehlermeldung
function sfBanner() {
  if (!sf.online || sf.running) return "";
  if (sf.state === "need_login" || !sf.loggedIn) {
    return `<div class="sf-empty sf-banner"><h3>Schritt 1: Bei Salesforce einloggen</h3>
      <p>Es öffnet sich ein Browser-Fenster. Dort ganz normal bei Salesforce anmelden. Danach hier auf <b>Liste erstellen</b> klicken.</p>
      <button class="primary" data-sflogin>Bei Salesforce einloggen</button></div>`;
  }
  if (sf.state === "error") {
    return `<div class="sf-warn"><b>Fehler:</b> ${esc(sf.message)}<br>Schick diese Meldung weiter, dann lässt sich das beheben.</div>`;
  }
  if (sf.state === "done" && sf.message) return `<div class="sf-ok">${esc(sf.message)}</div>`;
  return "";
}

function renderSalesforce() {
  renderSalesforceInner();
  const html = sfBanner();
  if (html) $("#results").insertAdjacentHTML("afterbegin", html);
  document.querySelectorAll("[data-sflogin]").forEach((b) => (b.onclick = () => sfStart("/login")));
}


// ---------- CSV-Import (aus Salesforce exportierter Bericht / Liste) ----------

function sfParseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [";", ",", "\t"].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function sfIsoDate(str) {
  const t = String(str || "").trim().split(/[ T]/)[0];
  if (!t) return "nie";
  let m;
  if ((m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/))) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return t;
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "unbekannt";
}

function sfImportCsv(text, filename) {
  const table = sfParseCsv(text);
  if (table.length < 2) return message("Die Datei ist leer oder wurde nicht erkannt.");
  const head = table[0].map((h) => h.trim());
  const find = (...res) => head.findIndex((h) => res.some((r) => r.test(h)));
  const col = {
    name: find(/^(account ?name|accountname|firmenname|name)$/i, /account.?name|accountname/i, /firma/i),
    plz: find(/billing.*(zip|postal)/i, /rechnungsadresse.*(plz|postleitzahl)/i, /^(plz|postleitzahl)$/i, /postal|postleitzahl|\bplz\b/i),
    ort: find(/billing.*city/i, /rechnungsadresse.*(ort|stadt)/i, /^(ort|stadt)$/i),
    strasse: find(/billing.*street/i, /rechnungsadresse.*stra(ß|ss)e/i),
    act: find(/last activity/i, /letzte aktivit/i),
    owner: find(/(account|konto).*(owner|inhaber)/i, /^(owner|inhaber)/i, /inhaber|owner/i),
    branche: find(/industry|branche/i),
    tel: find(/^(phone|telefon)/i),
    web: find(/website/i),
    typ: find(/^(type|typ)$/i),
  };
  if (col.plz < 0 || col.name < 0) {
    return message(`Spalten nicht gefunden. Gebraucht werden Account-Name und PLZ. Gefunden: ${head.join(", ")}`);
  }
  const g = (r, i) => (i >= 0 ? (r[i] || "").trim() : "");
  const rows = table.slice(1)
    .map((r) => ({
      id: "", name: g(r, col.name), plz: g(r, col.plz), ort: g(r, col.ort), strasse: g(r, col.strasse),
      letzte_aktivitaet: col.act >= 0 ? sfIsoDate(g(r, col.act)) : "unbekannt",
      betreuer: g(r, col.owner), typ: g(r, col.typ), branche: g(r, col.branche), telefon: g(r, col.tel), website: g(r, col.web),
      jahresumsatz: null, mitarbeiter: null, gebucht_anzahl: 0, gebucht_umsatz: 0, letzte_buchung: "", url: "",
    }))
    .filter((r) => r.name && /^\d{5}$/.test(r.plz) && /^(7|88|89)/.test(r.plz));  // nur BW, Fußzeilen des Exports fallen raus
  Object.assign(sf, { rows: rows.map(sfEnrich), source: `CSV-Import (${filename})`, updated: new Date().toISOString(), hasBookings: false, imported: true, running: false });
  sfFillSelects();
  sfInfo(`${rows.length} BW-Firmen aus ${filename} gelesen.` + (col.act < 0 ? " Spalte „Letzte Aktivität“ fehlt." : ""), col.act < 0 ? "warn" : "");
  render();
}

document.addEventListener("change", (e) => {
  if (!e.target.closest("#sf-csv")) return;
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((t) => sfImportCsv(t, file.name));
  e.target.value = "";
});
