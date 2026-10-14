"use strict";
// Tab "Salesforce": spricht mit dem lokalen Programm (salesforce-bot/server.py auf deinem Rechner).
// Die Kundendaten werden nur im Speicher dieser Seite gehalten, nie gespeichert oder hochgeladen.

const SF_API = "http://127.0.0.1:8766";
const sf = { rows: [], source: "", updated: "", running: false, online: null, loggedIn: false, error: "", log: [] };

async function sfCall(path, method = "GET") {
  const r = await fetch(SF_API + path, { method, cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
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
    sf.error = s.state === "error" ? s.message : "";
    $("#sf-login").hidden = !(sf.online && (!s.logged_in || s.state === "need_login"));
    $("#sf-run").disabled = sf.running;
    if (s.state === "need_login") sfInfo("Bitte zuerst bei Salesforce einloggen.", "warn");
    else if (sf.running) sfInfo(s.log[s.log.length - 1] || "Läuft …");
    else if (s.state === "error") sfInfo(s.message, "warn");
    else sfInfo(s.message || "");
    if (!sf.running && s.result_updated && s.result_updated !== sf.updated) {
      const res = await sfCall("/result");
      Object.assign(sf, { rows: res.rows, source: res.source, updated: res.updated });
    }
  } catch (_) {
    sf.online = false;
    sf.running = false;
    $("#sf-login").hidden = true;
    $("#sf-run").disabled = false;
    sfInfo("");
  }
  if (state.tab === "salesforce") render();
  if (sf.running && state.tab === "salesforce") setTimeout(sfRefresh, 1500);
}

async function sfStart(path) {
  try {
    await sfCall(path, "POST");
    sf.running = true;
    $("#sf-run").disabled = true;
    sfInfo("Gestartet …");
    setTimeout(sfRefresh, 800);
  } catch (e) {
    sf.online = false;
    sfInfo("");
    render();
  }
}

$("#sf-run").onclick = () => sfStart(`/run?days=${$("#sf-days").value}`);
$("#sf-login").onclick = () => sfStart("/login");
$("#sf-days").onchange = () => { sf.rows = []; sf.updated = ""; render(); };

function renderSalesforce() {
  const msg = $("#status-msg");
  const results = $("#results");
  if (sf.online === null) sfRefresh();
  msg.hidden = true;
  if (sf.online === false) {
    $("#summary").innerHTML = "Salesforce";
    results.innerHTML = `<div class="sf-empty"><h3>Das Salesforce-Programm läuft noch nicht</h3>
      <ol>
        <li>Im Ordner <b>salesforce-bot</b> auf deinem Rechner <b>Salesforce_starten.bat</b> doppelklicken. Das Fenster offen lassen.</li>
        <li>Hier auf <b>Liste erstellen</b> klicken.</li>
      </ol>
      <button id="sf-retry">Erneut verbinden</button>
      <p class="hint">Wenn der Browser nach dem „Zugriff auf Geräte im lokalen Netzwerk“ fragt, bitte erlauben. Das ist dein eigener Rechner.</p></div>`;
    $("#sf-retry").onclick = () => { sf.online = null; sfRefresh(); };
    return;
  }
  if (sf.running) {
    $("#summary").innerHTML = "Salesforce wird abgefragt …";
    results.innerHTML = `<div class="sf-empty"><h3>Einen Moment …</h3><pre class="sf-log">${esc(sf.log.join("\n"))}</pre>
      <p class="hint">Falls sich ein Browser-Fenster öffnet, ist das normal.</p></div>`;
    return;
  }
  if (!sf.rows.length) {
    $("#summary").innerHTML = sf.updated ? "Keine passenden Firmen gefunden." : "Noch keine Liste erstellt.";
    results.innerHTML = `<div class="sf-empty"><h3>${sf.updated ? "Keine Treffer" : "Auf „Liste erstellen“ klicken"}</h3>
      <p>Links Zeitraum wählen und auf <b>Liste erstellen</b> klicken.</p>${sf.error ? `<p class="warn">${esc(sf.error)}</p>` : ""}</div>`;
    return;
  }
  const text = $("#text").value.trim().toLowerCase();
  const rows = sf.rows.filter((r) => !text || `${r.name} ${r.plz} ${r.ort} ${r.betreuer}`.toLowerCase().includes(text));
  const partial = /UNVOLLST/.test(sf.source);
  $("#summary").innerHTML = `<b>${rows.length}</b> Firmen in Baden-Württemberg ohne Aktivität · Stand ${esc(fmtTime(sf.updated))} · ${esc(sf.source)}`;
  results.innerHTML = `${partial ? `<div class="sf-warn">Achtung: Die Liste ist unvollständig (Salesforce zeigt in Listenansichten höchstens 2000 Einträge).</div>` : ""}
    <div class="table-wrap"><table><thead><tr>
      <th>Firma</th><th>PLZ</th><th>Ort</th><th>Letzte Aktivität</th><th>Betreuer</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td class="name">${esc(r.name)}</td><td>${esc(r.plz)}</td><td>${esc(r.ort)}</td>
        <td>${r.letzte_aktivitaet === "nie" ? `<span class="badge chain">nie</span>` : esc(fmtDate(r.letzte_aktivitaet))}</td>
        <td>${esc(r.betreuer)}</td>
        <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">In Salesforce öffnen</a>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>`;
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }); } catch (_) { return iso; }
}

function exportSalesforce() {
  const esc2 = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Firma", "PLZ", "Ort", "Letzte Aktivität", "Betreuer", "Link"];
  const lines = sf.rows.map((r) => [r.name, r.plz, r.ort, r.letzte_aktivitaet, r.betreuer, r.url].map(esc2).join(";"));
  const blob = new Blob(["﻿" + [head.map(esc2).join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `salesforce_ohne_aktivitaet_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
