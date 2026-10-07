"use strict";

const state = {
  tab: "search",
  meta: null,
  kreisData: {},   // ags -> {updated, leads}
  newsData: {},    // ags -> {updated, items}
  pipeline: {},    // id -> {status, notes, updated, lead}
  sort: { key: "score", dir: -1 },
  limit: 200,
  map: null,
  markers: null,
};
const $ = (sel) => document.querySelector(sel);
const STATUSES = ["neu", "interessant", "kontaktiert", "termin", "angebot", "kunde", "kein_interesse"];
const STATUS_LABELS = {
  neu: "Neu", interessant: "Interessant", kontaktiert: "Kontaktiert", termin: "Termin",
  angebot: "Angebot", kunde: "Kunde", kein_interesse: "Kein Interesse",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const catName = (id) => state.meta.categories.find((c) => c.id === id)?.name || id || "–";
const kreisName = (ags) => state.meta.kreise.find((k) => k.ags === ags)?.name || ags || "";
const fmtDate = (iso) => (iso ? iso.split("-").reverse().join(".") : "");

function store(key, value) {
  try { localStorage.setItem("leadgen:" + key, JSON.stringify(value)); } catch (_) {}
}
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem("leadgen:" + key)) ?? fallback; } catch (_) { return fallback; }
}

async function getJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(res.status === 404 ? "Für diesen Kreis liegen noch keine Daten vor." : res.statusText);
  return res.json();
}

// ---------- Neugründung & Score -------------------------------------------
function monthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function newReason(l, since) {
  if (l.start_date && l.start_date >= since) return "Neueröffnung";
  if (l.osm_version === 1 && l.osm_timestamp >= since) return "Neu eingetragen";
  if (l.first_seen && l.first_seen >= since) return "Neu im Scan";
  return "";
}

function score(l, reason) {
  const weight = state.meta.categories.find((c) => c.id === l.category)?.weight ?? 20;
  const parts = [[weight, "Branche"]];
  if (reason === "Neueröffnung") parts.push([30, "Neueröffnung"]);
  else if (reason) parts.push([20, "Neu am Markt"]);
  if (l.website) parts.push([10, "Website"]);
  if (l.phone) parts.push([8, "Telefon"]);
  if (l.email) parts.push([7, "E-Mail"]);
  if (l.hours) parts.push([5, "Aktiv (Öffnungszeiten)"]);
  if (l.chain) parts.push([-25, "Kette/Filiale (zentrales Marketing)"]);
  const total = Math.max(0, Math.min(100, parts.reduce((s, [p]) => s + p, 0)));
  return [total, parts.map(([p, why]) => `${why} ${p > 0 ? "+" : ""}${p}`)];
}

function enrich(l, since) {
  const reason = newReason(l, since);
  const [s, reasons] = score(l, reason);
  const p = state.pipeline[l.id];
  return { ...l, kreis: l.kreis || p?.lead?.kreis, new_reason: reason, score: s, score_reasons: reasons,
    status: p?.status || "neu", notes: p?.notes || "" };
}

// ---------- Setup ---------------------------------------------------------
async function init() {
  state.pipeline = load("pipeline", {});
  try {
    state.meta = await getJson("data/meta.json");
  } catch (err) {
    $("#summary").textContent = "";
    return message("Die Daten werden gerade zum ersten Mal gesammelt. Das dauert etwa eine Stunde – bitte später neu laden.");
  }

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
  $("#topics").innerHTML = Object.values(state.meta.topics).map((name) =>
    `<label><input type="checkbox" value="${esc(name)}" checked> ${esc(name)}</label>`).join("");
  for (const s of STATUSES) $("#status-filter").append(new Option(STATUS_LABELS[s], s));

  $("#cats-all").onclick = (e) => { e.preventDefault(); setAllCats(true); };
  $("#cats-none").onclick = (e) => { e.preventDefault(); setAllCats(false); };
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
  $("#export").onclick = exportCsv;
  $("#toggle-map").onclick = toggleMap;
  $("#backup-save").onclick = saveBackup;
  $("#backup-load").onchange = loadBackup;
  $("#min-score").oninput = () => { $("#min-score-val").textContent = $("#min-score").value; render(); };
  for (const id of ["#hide-chains", "#need-contact", "#text", "#status-filter", "#months", "#topics", "#cats"]) {
    $(id).addEventListener("input", () => { state.limit = 200; render(); });
  }
  $("#cats").addEventListener("change", () => store("cats", selectedCats()));
  kreisSel.onchange = () => { store("kreis", kreisSel.value); loadKreis(); };

  const startTab = location.hash.slice(1);
  switchTab(["search", "new", "news", "pipeline"].includes(startTab) ? startTab : "search");
  loadKreis();
}

function setAllCats(on) {
  document.querySelectorAll("#cats input").forEach((i) => (i.checked = on));
  store("cats", selectedCats());
  render();
}
const selectedCats = () => [...document.querySelectorAll("#cats input:checked")].map((i) => i.value);
const selectedTopics = () => [...document.querySelectorAll("#topics input:checked")].map((i) => i.value);

function switchTab(tab) {
  state.tab = tab;
  state.limit = 200;
  history.replaceState(null, "", "#" + tab);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("aside [class*='only-']").forEach((el) => {
    el.hidden = !el.classList.contains("only-" + tab);
  });
  $("#export").hidden = tab === "news";
  $("#toggle-map").hidden = tab === "news";
  render();
}

async function loadKreis() {
  const ags = $("#kreis").value;
  const info = state.meta.status?.[ags];
  $("#stand").textContent = info?.updated ? `Datenstand: ${fmtDate(info.updated)} · ${info.count} Betriebe` : "";
  if (state.kreisData[ags]) return render();
  message(`Lade ${kreisName(ags)} …`, true);
  try {
    const [companies, newsFeed] = await Promise.all([
      getJson(`data/kreis/${ags}.json`),
      getJson(`data/news/${ags}.json`).catch(() => ({ items: [] })),
    ]);
    for (const l of companies.leads) l.kreis = ags;
    state.kreisData[ags] = companies;
    state.newsData[ags] = newsFeed;
    message("");
  } catch (err) {
    message(err.message);
  }
  if ($("#kreis").value === ags) render();
}

function message(text, loading = false) {
  const el = $("#status-msg");
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle("loading", loading);
}

// ---------- Filter & Darstellung -----------------------------------------
function currentRows() {
  if (state.tab === "pipeline") {
    return Object.entries(state.pipeline).map(([id, p]) => enrich({ ...p.lead, id }, monthsAgo(12)));
  }
  const data = state.kreisData[$("#kreis").value];
  if (!data) return [];
  const since = monthsAgo(state.tab === "new" ? +$("#months").value : 12);
  const cats = new Set(selectedCats());
  const rows = [];
  for (const l of data.leads) {
    if (!cats.has(l.category)) continue;
    if (state.tab === "new" && !newReason(l, since)) continue;
    rows.push(enrich(l, since));
  }
  return rows;
}

function filtered(rows) {
  const minScore = +$("#min-score").value;
  const text = $("#text").value.trim().toLowerCase();
  const status = $("#status-filter").value;
  const pipe = state.tab === "pipeline";
  const out = rows.filter((l) =>
    (pipe || !$("#hide-chains").checked || !l.chain) &&
    (pipe || !$("#need-contact").checked || l.phone || l.email || l.website) &&
    (!pipe || !status || l.status === status) &&
    l.score >= minScore &&
    (!text || `${l.name} ${l.address} ${l.city} ${l.kind}`.toLowerCase().includes(text)));
  const { key, dir } = state.sort;
  return out.sort((a, b) => {
    const x = a[key] ?? "", y = b[key] ?? "";
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "de")) * dir;
  });
}

function render() {
  if (!state.meta) return;
  if (state.tab === "news") return renderNews();
  const all = currentRows();
  const rows = filtered(all);
  state.visible = rows;
  const neu = rows.filter((r) => r.new_reason).length;
  if (state.tab === "pipeline") {
    $("#summary").innerHTML = all.length
      ? `<b>${rows.length}</b> Leads in deiner Pipeline`
      : "Noch keine Leads gemerkt. Setze in der Firmensuche einen Status oder eine Notiz.";
  } else {
    $("#summary").innerHTML = all.length
      ? `<b>${rows.length}</b> von ${all.length} Betrieben` + (neu ? ` · <b>${neu}</b> neu am Markt` : "")
      : state.kreisData[$("#kreis").value] ? "Keine Betriebe – Branchen oder Zeitraum anpassen." : "";
  }
  if (!rows.length) {
    $("#results").innerHTML = all.length ? `<div class="empty">Keine Treffer mit diesen Filtern.</div>` : "";
    return updateMap([]);
  }

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
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  document.querySelectorAll("select[data-id]").forEach((s) => (s.onchange = () => save(byId[s.dataset.id], { status: s.value })));
  document.querySelectorAll("textarea[data-id]").forEach((t) => (t.onchange = () => save(byId[t.dataset.id], { notes: t.value })));
  updateMap(rows);
}

function rowHtml(l) {
  const scoreCls = l.score >= 60 ? "high" : l.score < 35 ? "low" : "";
  const badges = [
    l.new_reason ? `<span class="badge ${l.new_reason === "Neu im Scan" ? "fresh" : "new"}">${esc(l.new_reason)}${l.start_date ? " " + fmtDate(l.start_date) : l.new_reason === "Neu im Scan" ? " " + fmtDate(l.first_seen) : ""}</span>` : "",
    l.chain ? `<span class="badge chain">Kette${l.brand ? ": " + esc(l.brand) : ""}</span>` : "",
  ].join("");
  const site = l.website && /^https?:\/\//i.test(l.website) ? l.website : l.website ? "https://" + l.website : "";
  const contact = [
    l.phone ? `<a href="tel:${esc(l.phone.replace(/[^\d+]/g, ""))}">☎ ${esc(l.phone)}</a>` : "",
    l.email ? `<a href="mailto:${esc(l.email)}">✉ ${esc(l.email)}</a>` : "",
    site ? `<a href="${esc(site)}" target="_blank" rel="noopener">🌐 ${esc(l.website.replace(/^https?:\/\/(www\.)?/, ""))}</a>` : "",
  ].join("") || `<span class="sub">–</span>`;
  const statusOpts = STATUSES.map((s) => `<option value="${s}" ${l.status === s ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("");
  const google = `https://www.google.com/search?q=${encodeURIComponent(`${l.name} ${l.city || l.address || kreisName(l.kreis)}`)}`;
  const osm = l.id.startsWith("osm:") ? `https://www.openstreetmap.org/${l.id.slice(4)}` : "";
  return `<tr>
    <td><span class="score ${scoreCls}" title="${esc(l.score_reasons.join("\n"))}">${l.score}</span></td>
    <td class="name">${esc(l.name)}<div class="sub">${esc(l.kind)}</div>${badges}</td>
    <td>${esc(catName(l.category))}${state.tab === "pipeline" ? `<div class="sub">${esc(kreisName(l.kreis))}</div>` : ""}</td>
    <td>${esc(l.address) || `<span class="sub">–</span>`}</td>
    <td class="contact">${contact}</td>
    <td><select data-id="${esc(l.id)}" aria-label="Status">${statusOpts}</select></td>
    <td><textarea data-id="${esc(l.id)}" placeholder="Notiz …" aria-label="Notiz">${esc(l.notes)}</textarea></td>
    <td class="contact">
      <a href="${google}" target="_blank" rel="noopener">Google</a>
      ${osm ? `<a href="${osm}" target="_blank" rel="noopener">Karte</a>` : ""}
      ${l.source_link ? `<a href="${esc(l.source_link)}" target="_blank" rel="noopener">Quelle</a>` : ""}
    </td>
  </tr>`;
}

function save(lead, patch) {
  const { new_reason, score, score_reasons, status, notes, ...raw } = lead;
  const entry = state.pipeline[lead.id] || { status: "neu", notes: "", lead: raw };
  Object.assign(entry, patch, { updated: new Date().toISOString() });
  if (entry.status === "neu" && !entry.notes) delete state.pipeline[lead.id];
  else state.pipeline[lead.id] = entry;
  store("pipeline", state.pipeline);
  if (state.tab === "pipeline") render();
}

function renderNews() {
  const ags = $("#kreis").value;
  const topics = new Set(selectedTopics());
  const all = state.newsData[ags]?.items || [];
  const items = all.filter((n) => topics.has(n.topic));
  updateMap([]);
  $("#summary").innerHTML = all.length
    ? `<b>${items.length}</b> Meldungen der letzten 60 Tage zu Eröffnungen, Gründungen & Start-ups in ${esc(kreisName(ags))}`
    : state.newsData[ags] ? "Keine Meldungen gefunden." : "";
  $("#results").innerHTML = items.length ? `<div class="news-list">${items.map((n, i) => `
    <div class="news-item">
      <div>
        <a class="title" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <div class="meta"><span class="badge topic">${esc(n.topic)}</span> ${esc(n.ort)} · ${esc(n.source)} · ${fmtDate(n.published)}</div>
      </div>
      <button data-news="${i}">${state.pipeline["news:" + n.link] ? "✓ In Pipeline" : "Als Lead merken"}</button>
    </div>`).join("")}</div>` : "";
  document.querySelectorAll("button[data-news]").forEach((b) => (b.onclick = () => {
    const n = items[+b.dataset.news];
    save({ id: "news:" + n.link, name: n.title, category: "", kind: n.topic, kreis: ags, address: n.ort,
      source_link: n.link, chain: 0 }, { status: "interessant" });
    b.textContent = "✓ In Pipeline";
  }));
}

// ---------- Karte ---------------------------------------------------------
function toggleMap() {
  const el = $("#map");
  el.hidden = !el.hidden;
  if (!el.hidden && !state.map && window.L) {
    state.map = L.map("map").setView([48.66, 9.0], 8);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
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
    if (l.lat == null) continue;
    const color = l.new_reason ? "#1f7a3d" : l.score >= 60 ? "#0b5cad" : "#8a93a3";
    L.circleMarker([l.lat, l.lon], { radius: 6, color, fillColor: color, fillOpacity: 0.8, weight: 1 })
      .bindPopup(`<b>${esc(l.name)}</b><br>${esc(catName(l.category))}<br>${esc(l.address)}<br>Score ${l.score}`)
      .addTo(state.markers);
    pts.push([l.lat, l.lon]);
  }
  if (pts.length) state.map.fitBounds(pts, { padding: [20, 20], maxZoom: 14 });
}

// ---------- Export & Sicherung -------------------------------------------
function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv() {
  const rows = state.visible || [];
  if (!rows.length) return message("Keine Daten zum Exportieren.");
  const fields = [
    ["Score", "score"], ["Neu", "new_reason"], ["Betrieb", "name"], ["Branche", (l) => catName(l.category)],
    ["Art", "kind"], ["Adresse", "address"], ["Kreis", (l) => kreisName(l.kreis)], ["Telefon", "phone"],
    ["E-Mail", "email"], ["Website", "website"], ["Kette", (l) => (l.chain ? "ja" : "")],
    ["Status", (l) => STATUS_LABELS[l.status]], ["Notiz", "notes"], ["Eröffnung", "start_date"],
    ["Quelle", (l) => l.source_link || (l.id.startsWith("osm:") ? "https://www.openstreetmap.org/" + l.id.slice(4) : "")],
  ];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [fields.map(([h]) => cell(h)).join(";")].concat(
    rows.map((l) => fields.map(([, f]) => cell(typeof f === "function" ? f(l) : l[f])).join(";")));
  const label = state.tab === "pipeline" ? "pipeline" : `${state.tab}_${kreisName($("#kreis").value).replace(/\W+/g, "_")}`;
  download(`leads_${label}_${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
}

function saveBackup() {
  download(`leadgenerator_sicherung_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ version: 1, pipeline: state.pipeline }, null, 1), "application/json");
}

async function loadBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.pipeline) throw new Error("Keine Leadgenerator-Sicherung.");
    Object.assign(state.pipeline, data.pipeline);
    store("pipeline", state.pipeline);
    message(`${Object.keys(data.pipeline).length} Leads aus der Sicherung geladen.`, true);
    render();
  } catch (err) {
    message("Sicherung konnte nicht geladen werden: " + err.message);
  }
  e.target.value = "";
}

init();
