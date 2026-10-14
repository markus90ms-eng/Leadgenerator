"use strict";
// Abgleich der Betriebe mit Salesforce: Gibt es schon einen Account, und ist er frei zum Kontaktieren?
// Läuft über das lokale Programm (salesforce-bot/server.py). Ergebnisse bleiben nur in diesem Browser.

const SFC_API = "http://127.0.0.1:8766";
const sfc = { results: {}, running: false };
try { sfc.results = JSON.parse(localStorage.getItem("leadgen:sfcheck") || "{}"); } catch (_) {}
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

function sfcBadge(l) {
  const r = sfc.results[l.id];
  if (!r) return "";
  const m = r.matches?.[0];
  const owner = m?.owner ? ` (${esc(m.owner)})` : "";
  const tip = esc(r.note || "");
  const link = m?.url ? ` <a href="${esc(m.url)}" target="_blank" rel="noopener">öffnen</a>` : "";
  switch (r.status) {
    case "frei": return `<span class="badge new" title="${tip}">✓ Nicht in Salesforce</span>`;
    case "potenzial": return `<span class="badge new" title="${tip}">✓ Potenzial-Account, keine Sperre${owner}</span>${link}`;
    case "ruhend": return `<span class="badge topic" title="${tip}">⏳ Ex-Kunde / inaktiv${owner}</span>${link}`;
    case "vergeben": return `<span class="badge taken" title="${tip}">🔒 Nicht kontaktieren (Sperre oder Kunde)${owner}</span>${link}`;
    case "unklar": return `<span class="badge chain" title="${tip}">? In Salesforce, Details unklar${owner}</span>${link}`;
    default: return `<span class="badge chain" title="${tip}">⚠ Abgleich fehlgeschlagen</span>`;
  }
}

function sfcMatches(l) {
  const f = $("#sfc-filter").value;
  if (!f) return true;
  const r = sfc.results[l.id];
  return f === "ungeprueft" ? !r : !!r && r.status === f;
}

async function sfcRun() {
  if (sfc.running) return;
  const rows = (state.visible || []).filter((l) => !sfc.results[l.id] || sfc.results[l.id].status === "fehler").slice(0, 40);
  if (!rows.length) return message("Keine ungeprüften Betriebe in der aktuellen Ansicht.");
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
