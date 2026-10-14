"use strict";
// Abgleich der Betriebe mit Salesforce: Gibt es schon einen Account, und ist er frei zum Kontaktieren?
// Läuft über das lokale Programm (salesforce-bot/server.py). Ergebnisse bleiben nur in diesem Browser.

const SFC_API = "http://127.0.0.1:8766";
const sfc = { results: {}, running: false };
try { sfc.results = JSON.parse(localStorage.getItem("leadgen:sfcheck") || "{}"); } catch (_) {}
function sfcSyncVersion(v) {
  // Neue Programmversion -> alte gemerkte Ergebnisse verwerfen (sie stammen evtl. von einer älteren Suche)
  if (!v) return false;
  let old = "";
  try { old = localStorage.getItem("leadgen:sfcver") || ""; localStorage.setItem("leadgen:sfcver", v); } catch (_) {}
  if (old === v) return false;
  sfc.results = {};
  sfcSave();
  return true;
}
const sfcSave = () => { try { localStorage.setItem("leadgen:sfcheck", JSON.stringify(sfc.results)); } catch (_) {} };

async function sfcCall(path, method = "GET", body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(SFC_API + path, {
      method, signal: ctl.signal, cache: "no-store",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 409 ? " (es läuft schon eine Abfrage)" : ""));
    return await r.json();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "keine Antwort vom Programm" : e.message);
  } finally {
    clearTimeout(timer);
  }
}

function sfcBadge(l, compact = false) {
  const r = sfc.results[l.id];
  if (!r) return "";
  const m = r.matches?.[0];
  const owner = m?.owner ? ` (${esc(m.owner)})` : "";
  const tip = esc(r.note || "");
  const link = m?.url ? ` <a href="${esc(m.url)}" target="_blank" rel="noopener">öffnen</a>` : "";
  const act = compact ? "" : m?.letzter_kontakt ? `<span class="badge chain" title="Jüngeres Datum aus Letzte Aktivität und Zuletzt geändert (${esc(m.kontakt_quelle || "")})">${m.tage_seit_kontakt > 90 ? "⏳ " : ""}letzter Kontakt ${fmtDate(m.letzter_kontakt)}</span>` : "";
  switch (r.status) {
    case "frei": return `<span class="badge new" title="${tip}">✓ Nicht in Salesforce</span>`;
    case "potenzial": return `<span class="badge new" title="${tip}">✓ Potenzial-Account, nicht gesperrt${owner}</span>${act}${link}`;
    case "kunde": return `<span class="badge topic" title="${tip}">👤 Bestandskunde, nicht gesperrt${owner}</span>${act}${link}`;
    case "ruhend": return `<span class="badge topic" title="${tip}">⏳ Ex-Kunde / inaktiv, nicht gesperrt${owner}</span>${act}${link}`;
    case "vergeben": return `<span class="badge taken" title="${tip}">🔒 Gesperrt, nicht kontaktieren${owner}</span>${act}${link}`;
    case "unklar": return `<span class="badge chain" title="${tip}">? ${esc(m?.firmenstatus || "Account gefunden, bitte prüfen")}${owner}</span>${act}${link}`;
    default: return `<span class="badge chain" title="${tip}">⚠ Abgleich fehlgeschlagen</span>`;
  }
}

function sfcMatches(l) {
  const f = $("#sfc-filter").value;
  if (!f) return true;
  const r = sfc.results[l.id];
  if (f === "ungeprueft") return !r;
  const days = { inaktiv3m: 90, inaktiv6m: 180, inaktiv12m: 365 }[f];
  if (days) return !!r && (r.matches?.[0]?.tage_seit_kontakt ?? -1) > days;
  if (f === "kontakt_unbekannt") return !!r && r.status !== "frei" && r.status !== "fehler" && r.matches?.[0]?.tage_seit_kontakt == null;
  return !!r && r.status === f;
}

async function sfcRun() {
  if (sfc.running) return;
  const force = !!($("#sfc-force") && $("#sfc-force").checked);
  const rows = (state.visible || []).filter((l) => force || !sfc.results[l.id] || sfc.results[l.id].status === "fehler").slice(0, 40);
  if (!rows.length) return message("Alle Betriebe in dieser Ansicht sind schon geprüft. Auf der Abgleich-Seite „Auch bereits geprüfte erneut prüfen“ anhaken oder die Ergebnisse löschen.");
  const leads = rows.map((l) => ({ id: l.id, name: l.name, phone: l.phone || "", plz: ((l.address || "").match(/\b\d{5}\b/) || [""])[0] }));
  sfc.running = true;
  $("#sfc-run").disabled = true;
  message(`Gleiche ${leads.length} Betriebe mit Salesforce ab … Das dauert ein paar Minuten.`, true);
  try {
    await sfcCall("/check", "POST", { leads });
    await sfcPoll();
  } catch (e) {
    message(`Abgleich nicht möglich: ${e.message}. Läuft „Salesforce_starten.bat“ und bist du bei Salesforce eingeloggt?`);
  }
  sfc.running = false;
  $("#sfc-run").disabled = false;
}

async function sfcPoll() {
  for (;;) {
    const s = await sfcCall("/status");
    sfcSyncVersion(s.version);
    Object.assign(sfc.results, await sfcCall("/checks"));
    sfcSave();
    if (s.state === "running") {
      message(`Salesforce-Abgleich läuft: ${esc((s.log || []).slice(-1)[0] || "")}`, true);
      render();
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    $("#status-msg").hidden = true;
    if (s.state === "need_login") message("Bitte zuerst im Tab „Salesforce“ bei Salesforce einloggen.");
    else if (s.state === "error") message("Fehler beim Abgleich: " + s.message);
    render();
    return;
  }
}

document.addEventListener("click", (e) => { if (e.target.closest("#sfc-run")) sfcRun(); });
document.addEventListener("change", (e) => {
  if (e.target.closest("#sfc-filter")) { state.limit = 200; render(); }
});
