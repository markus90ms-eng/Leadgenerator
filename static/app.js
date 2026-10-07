"use strict";

const state = {
  tab: "search",
  meta: null,
  data: { search: [], new: [], news: [], pipeline: [] },
  sort: { key: "score", dir: -1 },
  limit: 200,
  map: null,
  markers: null,
};
const $ = (sel) => document.querySelector(sel);
const STATUS_LABELS = {
  neu: "Neu", interessant: "Interessant", kontaktiert: "Kontaktiert", termin: "Termin",
  angebot: "Angebot", kunde: "Kunde", kein_interesse: "Kein Interesse",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function catName(id) {
  return state.meta.categories.find((c) => c.id === id)?.name || id || "–";
}
function kreisName(ags) {
  return state.meta.kreise.find((k) => k.ags === ags)?.name || ags || "";
}
function store(key, value) {
  try { localStorage.setItem("leadgen:" + key, JSON.stringify(value)); } catch (_) {}
}
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem("leadgen:" + key)) ?? fallback; } catch (_) { return fallback; }
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- Setup ---------------------------------------------------------
async function init() {
  state.meta = await api("/api/meta");

  const kreisSel = $("#kreis");
  const groups = {};
  for (const k of state.meta.kreise) (groups[k.bezirk] ||= []).push(k);
  for (const [bezirk, kreise] of Object.entries(groups)) {
    const og = document.createElement("optgroup");
    og.label = bezirk;
    for (const k of kreise) og.append(new Option(k.name, k.ags));
    kreisSel.append(og);
  }
  kreisSel.value = load("kreis", "08111");

  const savedCats = load("cats", state.meta.categories.filter((c) => c.weight >= 28).map((c) => c.id));
  $("#cats").innerHTML = state.meta.categories.map((c) =>
    `<label><input type="checkbox" value="${c.id}" ${savedCats.includes(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("");
  $("#topics").innerHTML = Object.entries(state.meta.topics).map(([id, name]) =>
    `<label><input type="checkbox" value="${id}" checked> ${esc(name)}</label>`).join("");
  for (const s of state.meta.statuses) $("#status-filter").append(new Option(STATUS_LABELS[s] || s, s));

  $("#cats-all").onclick = (e) => { e.preventDefault(); setAllCats(true); };
  $("#cats-none").onclick = (e) => { e.preventDefault(); setAllCats(false); };
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
  $("#go").onclick = run;
  $("#export").onclick = exportCsv;
  $("#toggle-map").onclick = toggleMap;
  $("#min-score").oninput = () => { $("#min-score-val").textContent = $("#min-score").value; render(); };
  for (const id of ["#hide-chains", "#need-contact", "#only-new", "#text", "#status-filter"]) {
    $(id).addEventListener("input", () => { state.limit = 200; render(); });
  }
  $("#kreis").onchange = () => store("kreis", $("#kreis").value);
  $("#cats").onchange = () => store("cats", selectedCats());
  switchTab("search");
}

function setAllCats(on) {
  document.querySelectorAll("#cats input").forEach((i) => (i.checked = on));
  store("cats", selectedCats());
}
const selectedCats = () => [...document.querySelectorAll("#cats input:checked")].map((i) => i.value);
const selectedTopics = () => [...document.querySelectorAll("#topics input:checked")].map((i) => i.value);

function switchTab(tab) {
  state.tab = tab;
  state.limit = 200;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("aside [class*='only-']").forEach((el) => {
    el.hidden = !el.classList.contains("only-" + tab);
  });
  $("#go").textContent = { search: "Firmen suchen", new: "Neugründungen finden", news: "News durchsuchen", pipeline: "Pipeline laden" }[tab];
  $("#export").hidden = tab === "news";
  $("#toggle-map").hidden = tab === "news";
  if (tab === "pipeline") run();
  else render();
}

// ---------- Laden ---------------------------------------------------------
async function run() {
  const tab = state.tab;
  const kreis = $("#kreis").value;
  const refresh = $("#refresh").checked ? "&refresh=1" : "";
  const cats = selectedCats().join(",");
  const urls = {
    search: `/api/search?kreis=${kreis}&cats=${cats}${refresh}`,
    new: `/api/new?kreis=${kreis}&cats=${cats}&months=${$("#months").value}${refresh}`,
    news: `/api/news?kreis=${kreis}&topics=${selectedTopics().join(",")}&days=${$("#days").value}${refresh}`,
    pipeline: "/api/pipeline",
  };
  if ((tab === "search" || tab === "new") && !cats) return message("Bitte mindestens eine Branche wählen.");
  $("#go").disabled = true;
  message(tab === "pipeline" ? "Lade Pipeline …" : `Suche in ${kreisName(kreis)} … das kann bei der ersten Abfrage etwas dauern.`, true);
  try {
    state.data[tab] = await api(urls[tab]);
    state.limit = 200;
    message("");
    $("#refresh").checked = false;
  } catch (err) {
    message("Fehler: " + err.message + " – bitte später erneut versuchen (der OSM-Server ist manchmal ausgelastet).");
  } finally {
    $("#go").disabled = false;
    if (state.tab === tab) render();
  }
}

function message(text, loading = false) {
  const el = $("#status-msg");
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle("loading", loading);
}

// ---------- Filter & Darstellung -----------------------------------------
function filtered() {
  const rows = state.data[state.tab] || [];
  if (state.tab === "news") return rows;
  const minScore = +$("#min-score").value;
  const text = $("#text").value.trim().toLowerCase();
  const status = $("#status-filter").value;
  const out = rows.filter((l) =>
    (state.tab === "pipeline" || !$("#hide-chains").checked || !l.chain) &&
    (state.tab === "pipeline" || !$("#need-contact").checked || l.phone || l.email || l.website) &&
    (state.tab !== "search" || !$("#only-new").checked || l.new_reason) &&
    (state.tab !== "pipeline" || !status || l.status === status) &&
    (l.score ?? 0) >= minScore &&
    (!text || `${l.name} ${l.address} ${l.city} ${l.kind}`.toLowerCase().includes(text)));
  const { key, dir } = state.sort;
  return out.sort((a, b) => {
    if (state.tab !== "pipeline" && a.fresh !== b.fresh) return a.fresh ? -1 : 1;
    const x = a[key] ?? "", y = b[key] ?? "";
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "de")) * dir;
  });
}

function render() {
  if (state.tab === "news") return renderNews();
  const rows = filtered();
  const all = state.data[state.tab] || [];
  const fresh = rows.filter((r) => r.fresh).length;
  const neu = rows.filter((r) => r.new_reason).length;
  $("#summary").innerHTML = all.length
    ? `<b>${rows.length}</b> von ${all.length} Betrieben` +
      (neu ? ` · <b>${neu}</b> Neugründungen/-eröffnungen` : "") +
      (fresh ? ` · <b>${fresh}</b> neu seit letztem Scan` : "")
    : state.tab === "pipeline" ? "Noch keine Leads bearbeitet – setze in der Suche einen Status oder eine Notiz." : "Kreis und Branchen wählen, dann suchen.";

  if (!all.length) { $("#results").innerHTML = ""; updateMap([]); return; }
  if (!rows.length) { $("#results").innerHTML = `<div class="empty">Keine Treffer mit diesen Filtern.</div>`; updateMap([]); return; }

  const cols = [
    ["score", "Score"], ["name", "Betrieb"], ["category", "Branche"], ["address", "Adresse"],
    [null, "Kontakt"], ["status", "Status"], [null, "Notiz"], [null, ""],
  ];
  const head = cols.map(([k, label]) =>
    `<th ${k ? `data-sort="${k}"` : ""}>${label}${state.sort.key === k ? (state.sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
  const body = rows.slice(0, state.limit).map(rowHtml).join("");
  $("#results").innerHTML = `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    ${rows.length > state.limit ? `<div class="more"><button id="more">Weitere ${Math.min(200, rows.length - state.limit)} anzeigen</button></div>` : ""}</div>`;

  document.querySelectorAll("th[data-sort]").forEach((th) => (th.onclick = () => {
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "score" ? -1 : 1) };
    render();
  }));
  $("#more")?.addEventListener("click", () => { state.limit += 200; render(); });
  document.querySelectorAll("select[data-id]").forEach((s) => (s.onchange = () => save(s.dataset.id, { status: s.value })));
  document.querySelectorAll("textarea[data-id]").forEach((t) => (t.onchange = () => save(t.dataset.id, { notes: t.value })));
  updateMap(rows);
}

function rowHtml(l) {
  const scoreCls = l.score >= 60 ? "high" : l.score < 35 ? "low" : "";
  const badges = [
    l.fresh ? `<span class="badge fresh">NEU seit letztem Scan</span>` : "",
    l.new_reason ? `<span class="badge new">${esc(l.new_reason)}${l.start_date ? " " + esc(l.start_date) : ""}</span>` : "",
    l.chain ? `<span class="badge chain">Kette${l.brand ? ": " + esc(l.brand) : ""}</span>` : "",
  ].join("");
  const site = l.website && /^https?:\/\//i.test(l.website) ? l.website : l.website ? "https://" + l.website : "";
  const contact = [
    l.phone ? `<a href="tel:${esc(l.phone.replace(/[^\d+]/g, ""))}">☎ ${esc(l.phone)}</a>` : "",
    l.email ? `<a href="mailto:${esc(l.email)}">✉ ${esc(l.email)}</a>` : "",
    site ? `<a href="${esc(site)}" target="_blank" rel="noopener">🌐 ${esc(l.website.replace(/^https?:\/\/(www\.)?/, ""))}</a>` : "",
  ].join("") || `<span class="sub">–</span>`;
  const statusOpts = state.meta.statuses.map((s) =>
    `<option value="${s}" ${l.status === s ? "selected" : ""}>${STATUS_LABELS[s] || s}</option>`).join("");
  const google = `https://www.google.com/search?q=${encodeURIComponent(`${l.name} ${l.city || l.address || kreisName(l.kreis)}`)}`;
  return `<tr>
    <td><span class="score ${scoreCls}" title="${esc((l.score_reasons || []).join("\n"))}">${l.score ?? "–"}</span></td>
    <td class="name">${esc(l.name)}<div class="sub">${esc(l.kind)}</div>${badges}</td>
    <td>${esc(catName(l.category))}${state.tab === "pipeline" ? `<div class="sub">${esc(kreisName(l.kreis))}</div>` : ""}</td>
    <td>${esc(l.address) || `<span class="sub">–</span>`}</td>
    <td class="contact">${contact}</td>
    <td><select data-id="${esc(l.id)}">${statusOpts}</select></td>
    <td><textarea data-id="${esc(l.id)}" placeholder="Notiz …">${esc(l.notes)}</textarea></td>
    <td class="contact">
      <a href="${google}" target="_blank" rel="noopener">Google</a>
      ${l.osm_url ? `<a href="${esc(l.osm_url)}" target="_blank" rel="noopener">Karte</a>` : ""}
      ${l.source_link ? `<a href="${esc(l.source_link)}" target="_blank" rel="noopener">Quelle</a>` : ""}
    </td>
  </tr>`;
}

async function save(id, patch) {
  try {
    await api(`/api/leads/${encodeURIComponent(id)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    for (const list of Object.values(state.data)) {
      const lead = list.find?.((l) => l.id === id);
      if (lead) Object.assign(lead, patch);
    }
  } catch (err) {
    message("Speichern fehlgeschlagen: " + err.message);
  }
}

function renderNews() {
  const items = state.data.news;
  updateMap([]);
  $("#summary").innerHTML = items.length
    ? `<b>${items.length}</b> Meldungen zu Neueröffnungen, Gründungen & Start-ups in ${esc(kreisName($("#kreis").value))}`
    : "Kreis und Themen wählen, dann „News durchsuchen“.";
  if (!items.length) { $("#results").innerHTML = ""; return; }
  $("#results").innerHTML = `<div class="news-list">${items.map((n, i) => `
    <div class="news-item">
      <div>
        <a class="title" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <div class="meta"><span class="badge topic">${esc(n.topic)}</span> ${esc(n.ort)} · ${esc(n.source)} · ${esc(n.published)}</div>
      </div>
      <button data-news="${i}">Als Lead merken</button>
    </div>`).join("")}</div>`;
  document.querySelectorAll("button[data-news]").forEach((b) => (b.onclick = async () => {
    const n = items[+b.dataset.news];
    const name = prompt("Firmenname für den Lead:", n.title);
    if (!name) return;
    try {
      await api("/api/manual", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kreis: $("#kreis").value, address: n.ort, source_link: n.link, new_reason: n.topic }),
      });
      b.textContent = "✓ In Pipeline";
      b.disabled = true;
    } catch (err) { message("Speichern fehlgeschlagen: " + err.message); }
  }));
}

// ---------- Karte ---------------------------------------------------------
function toggleMap() {
  const el = $("#map");
  el.hidden = !el.hidden;
  if (!el.hidden && !state.map && window.L) {
    state.map = L.map("map").setView([48.66, 9.0], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap-Mitwirkende", maxZoom: 19,
    }).addTo(state.map);
    state.markers = L.layerGroup().addTo(state.map);
  }
  if (!el.hidden) { state.map?.invalidateSize(); render(); }
}

function updateMap(rows) {
  if (!state.map || $("#map").hidden) return;
  state.markers.clearLayers();
  const pts = [];
  for (const l of rows.slice(0, 1500)) {
    if (l.lat == null || l.lon == null) continue;
    const color = l.fresh ? "#0b5cad" : l.new_reason ? "#1f7a3d" : l.score >= 60 ? "#2e9e57" : "#8a93a3";
    L.circleMarker([l.lat, l.lon], { radius: 6, color, fillColor: color, fillOpacity: 0.8, weight: 1 })
      .bindPopup(`<b>${esc(l.name)}</b><br>${esc(catName(l.category))}<br>${esc(l.address)}<br>Score ${l.score}`)
      .addTo(state.markers);
    pts.push([l.lat, l.lon]);
  }
  if (pts.length) state.map.fitBounds(pts, { padding: [20, 20], maxZoom: 14 });
}

// ---------- Export --------------------------------------------------------
function exportCsv() {
  const rows = filtered();
  if (!rows.length) return message("Keine Daten zum Exportieren.");
  const fields = [
    ["Score", "score"], ["Neu", "new_reason"], ["Betrieb", "name"], ["Branche", (l) => catName(l.category)],
    ["Art", "kind"], ["Adresse", "address"], ["Kreis", (l) => kreisName(l.kreis)], ["Telefon", "phone"],
    ["E-Mail", "email"], ["Website", "website"], ["Kette", (l) => (l.chain ? "ja" : "")],
    ["Status", (l) => STATUS_LABELS[l.status] || l.status], ["Notiz", "notes"],
    ["Eröffnung", "start_date"], ["Quelle", (l) => l.osm_url || l.source_link || ""],
  ];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [fields.map(([h]) => cell(h)).join(";")].concat(
    rows.map((l) => fields.map(([, f]) => cell(typeof f === "function" ? f(l) : l[f])).join(";")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const kreis = kreisName($("#kreis").value).replace(/\W+/g, "_");
  a.download = `leads_${state.tab}_${state.tab === "pipeline" ? "alle" : kreis}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

init().catch((err) => message("Start fehlgeschlagen: " + err.message));
