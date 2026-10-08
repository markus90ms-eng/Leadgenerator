"use strict";

const state = {
  tab: "search",
  meta: null,
  kreisData: {},   // ags -> {updated, leads}
  newsData: {},    // ags -> {updated, items}
  stroeerData: {}, // ags -> {updated, items}
  nearIndex: null, // Raster der gefilterten Ströer-Flächen für die Umkreissuche
  openNear: new Set(), // Betriebe, deren Flächenliste aufgeklappt ist
  focus: null,     // Betrieb, auf den die Karte gerade zoomt
  pipeline: {},    // id -> {status, notes, updated, lead}
  eigene: {},      // id -> eigener Lead aus Foto (mit Vorschaubild)
  queue: [],       // Fotos, die gerade erkannt/geprüft werden
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

function score(l, reason, near) {
  const weight = state.meta.categories.find((c) => c.id === l.category)?.weight ?? 20;
  const parts = [[weight, "Branche"]];
  if (reason === "Neueröffnung") parts.push([30, "Neueröffnung"]);
  else if (reason) parts.push([20, "Neu am Markt"]);
  if (l.website) parts.push([10, "Website"]);
  if (l.phone) parts.push([8, "Telefon"]);
  if (l.email) parts.push([7, "E-Mail"]);
  if (l.hours) parts.push([5, "Aktiv (Öffnungszeiten)"]);
  if (near?.count) parts.push([10, "Ströer-Fläche im Umkreis"]);
  if (l.chain) parts.push([-25, "Kette/Filiale (zentrales Marketing)"]);
  const total = Math.max(0, Math.min(100, parts.reduce((s, [p]) => s + p, 0)));
  return [total, parts.map(([p, why]) => `${why} ${p > 0 ? "+" : ""}${p}`)];
}

function enrich(l, since) {
  const reason = newReason(l, since);
  const p = state.pipeline[l.id];
  const kreis = l.kreis || p?.lead?.kreis;
  const near = nearby(l, kreis);
  const [s, reasons] = score(l, reason, near);
  return { ...l, kreis, new_reason: reason, score: s, score_reasons: reasons, near, near_count: near?.count || 0,
    status: p?.status || "neu", notes: p?.notes || "" };
}

// ---------- Ströer-Werbeträger -------------------------------------------
const DEFAULT_MEDIA = ["GF", "VI", "VIP", "GVS", "GVN", "PVC", "PVR", "PVT", "PVI", "PVM", "PVS", "PVGI", "PVGO"];
const mediaName = (typ) => state.meta.media?.[typ] || typ;
const selectedMedia = () => new Set([...document.querySelectorAll("#media input:checked")].map((i) => i.value));

function stroeerItems(ags) {
  const media = selectedMedia();
  return (state.stroeerData[ags]?.items || []).filter((i) => media.has(i.typ));
}

// Grobe Meter-Distanz (für Umkreise bis wenige km genau genug)
function meters(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 111200, dx = (lon2 - lon1) * 111200 * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

// Raster pro Kreis, damit die Umkreissuche auch bei vielen Betrieben schnell bleibt
function nearIndex(ags) {
  const key = [...selectedMedia()].sort().join();
  if (state.nearIndex?.key !== key) state.nearIndex = { key, byKreis: {} };
  if (!state.nearIndex.byKreis[ags]) {
    const grid = new Map();
    for (const it of stroeerItems(ags)) {
      const cell = `${Math.floor(it.lat / 0.02)}|${Math.floor(it.lon / 0.03)}`;
      if (!grid.has(cell)) grid.set(cell, []);
      grid.get(cell).push(it);
    }
    state.nearIndex.byKreis[ags] = grid;
  }
  return state.nearIndex.byKreis[ags];
}

function nearby(l, ags) {
  if (l.lat == null || !state.stroeerData[ags]?.items?.length) return null;
  const radius = +$("#radius").value;
  const grid = nearIndex(ags), cy = Math.floor(l.lat / 0.02), cx = Math.floor(l.lon / 0.03);
  const hits = [];
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (const it of grid.get(`${y}|${x}`) || []) {
        const d = meters(l.lat, l.lon, it.lat, it.lon);
        if (d <= radius) hits.push({ ...it, dist: Math.round(d) });
      }
    }
  }
  hits.sort((a, b) => a.dist - b.dist);
  const byType = {};
  for (const h of hits) byType[h.typ] = (byType[h.typ] || 0) + 1;
  return { count: hits.length, nearest: hits[0] || null, byType, items: hits };
}

function renderMediaFilter() {
  const ags = $("#kreis").value;
  const items = state.stroeerData[ags]?.items || [];
  const counts = {};
  for (const i of items) counts[i.typ] = (counts[i.typ] || 0) + 1;
  const saved = load("media", DEFAULT_MEDIA);
  $("#media").innerHTML = Object.keys(state.meta.media || {}).map((typ) =>
    `<label><input type="checkbox" value="${typ}" ${saved.includes(typ) ? "checked" : ""}> ${esc(mediaName(typ))}
      <span class="count">${counts[typ] || 0}</span></label>`).join("");
  $("#stroeer-info").textContent = items.length
    ? `${items.length} Ströer-Flächen im Kreis · Stand ${fmtDate(state.stroeerData[ags].updated)}`
    : "Für diesen Kreis liegen noch keine Ströer-Daten vor.";
}

function setMedia(types) {
  document.querySelectorAll("#media input").forEach((i) => (i.checked = types.includes(i.value)));
  mediaChanged();
}

function mediaChanged() {
  store("media", [...selectedMedia()]);
  state.nearIndex = null;
  render();
}

function nearHtml(near) {
  if (!near) return `<span class="sub">–</span>`;
  if (!near.count) return `<span class="sub">keine im Umkreis</span>`;
  const types = Object.entries(near.byType).map(([t, n]) => `${n}× ${esc(mediaName(t))}`).join(", ");
  return `<b>${near.count}</b> ${near.count === 1 ? "Fläche" : "Flächen"} · nächste ${near.nearest.dist} m
    <div class="sub">${types}</div>`;
}

// Aufgeklappte Listen auf die sichtbare Breite der (scrollbaren) Tabelle begrenzen
function fitNearBoxes() {
  const wrap = document.querySelector(".table-wrap");
  if (wrap) wrap.style.setProperty("--wrap-w", wrap.clientWidth + "px");
}
window.addEventListener("resize", fitNearBoxes);

// ---------- Telefonpitch mit Claude --------------------------------------
const PITCH_LEITFADEN = (vertragspartner) => `„Guten Tag Frau/Herr …, mein Name ist Markus Schultheiß, ich rufe an im Namen der Ströer AG. ` +
  `Wir haben den Stadtvertrag mit ${vertragspartner}. Sie kennen doch bestimmt die großen Plakatflächen an den Straßen ` +
  `oder auch an den Bushaltestellen. Diese sind von uns. Wir sind in Mitverantwortung gezogen worden, dass wir nicht nur ` +
  `die großen Konzerne bevorzugen, sondern auch den Klein- und Mittelstand fördern. Darum vergeben wir die Plätze neu ` +
  `und suchen derzeit in Ihrer Branche nach einem Partner, mit dem wir in Zukunft zusammenarbeiten können …“`;

function leadCity(l) {
  if (l.city) return l.city;
  const m = (l.address || "").match(/\d{5}\s+(.+)$/);
  return m ? m[1] : kreisName(l.kreis).replace(/^Landkreis\s+|\s*\(Stadtkreis\)$/g, "");
}

// Vertragspartner ist der Kreis: "dem Landkreis Esslingen", "dem Rems-Murr-Kreis", "der Stadt Stuttgart"
function vertragspartner(ags) {
  const k = state.meta.kreise.find((x) => x.ags === ags);
  if (!k) return "dem Landkreis";
  return k.typ === "Stadtkreis" ? `der Stadt ${k.osm_name}` : `dem ${k.name}`;
}

function pitchPrompt(l) {
  const stadt = leadCity(l);
  const flaechen = l.near?.count
    ? l.near.items.slice(0, 6).map((i) => `${mediaName(i.typ)}, ${i.standort}, ${i.plz} ${i.ort} (${i.dist} m, SDAW ${i.id})`).join("; ")
    : `keine Ströer-Fläche im Umkreis von ${$("#radius").selectedOptions[0].text}`;
  const facts = [
    `Firma: ${l.name}`,
    `Branche: ${catName(l.category)}${l.kind ? ` (${l.kind})` : ""}`,
    l.address ? `Adresse: ${l.address}` : `Ort: ${stadt}`,
    `Website: ${l.website || "keine bekannt – bitte im Web nach der Firma suchen"}`,
    l.phone ? `Telefon: ${l.phone}` : "",
    `Ströer-Flächen in der Nähe: ${flaechen}`,
    l.photo ? `Gesehen: eigene Beobachtung (Werbung auf Fahrzeug/Schild)${l.ocr ? ` – Text auf dem Foto: „${l.ocr.replace(/\s+/g, " ").slice(0, 300)}“` : ""}` : "",
    l.new_reason ? `Besonderheit: ${l.new_reason}${l.start_date ? " (" + fmtDate(l.start_date) + ")" : ""}` : "",
  ].filter(Boolean).join("\n");
  return `Du bist mein Vertriebsassistent. Ich bin Markus Schultheiß, Ströer AG, und rufe gleich bei folgendem Unternehmen an:

${facts}

Aufgabe:
1. Sieh dir die Website an und fasse in 3 Stichpunkten zusammen: Was bietet die Firma, was ist aktuell (Aktionen, neue Produkte, Stellenanzeigen), wen spricht sie an?
2. Empfiehl, welche der Flächen in der Nähe am besten passt (klassisch oder digital) und warum.
3. Schreib einen Telefonpitch nach meinem Leitfaden, angepasst an diese Firma:
${PITCH_LEITFADEN(vertragspartner(l.kreis))}
Baue 1–2 konkrete Bezüge zur Website ein und ende mit einer Terminfrage.
4. Nenne die 3 wahrscheinlichsten Einwände (z. B. „kein Budget“, „machen nur Online“) mit kurzer Antwort.

Kurz und gesprochen formulieren, kein Fließtext-Roman.`;
}

function openPitch(l) {
  const prompt = pitchPrompt(l);
  // In die Zwischenablage, falls claude.ai das Feld nicht vorbelegt
  navigator.clipboard?.writeText(prompt).catch(() => {});
  window.open("https://claude.ai/new?q=" + encodeURIComponent(prompt), "_blank", "noopener");
  message(`Pitch-Anfrage für ${l.name} an Claude übergeben und in die Zwischenablage kopiert. Falls das Eingabefeld leer ist: Cmd+V (Windows: Strg+V).`, true);
}

const gmaps = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

// Aufgeklappte Liste der Flächen unter einem Betrieb
function nearDetailHtml(l, colspan) {
  const items = l.near.items.map((i) => `<li>
      <span class="dist">${i.dist} m</span>
      <span class="badge ${i.typ.startsWith("PV") ? "digital" : "classic"}">${esc(mediaName(i.typ))}</span>
      <span class="where"><b>${esc(i.standort)}</b>, ${esc(i.plz)} ${esc(i.ort)}<span class="sub"> · SDAW ${esc(i.id)}${i.netz ? " · Teil eines Netzes" : ""}</span></span>
      <span class="links">
        <a href="${gmaps(i.lat, i.lon)}" target="_blank" rel="noopener">Google Maps</a>
        ${i.foto ? `<a href="${esc(i.foto)}" target="_blank" rel="noopener">Foto</a>` : ""}
      </span>
    </li>`).join("");
  return `<tr class="near-detail"><td colspan="${colspan}"><div class="near-box">
    <div class="near-head">
      <b>Ströer-Flächen im Umkreis von ${$("#radius").selectedOptions[0].text} um ${esc(l.name)}</b>
      <button data-focus="${esc(l.id)}">Auf Karte zeigen</button>
    </div>
    <ul class="near-list">${items}</ul>
  </div></td></tr>`;
}

function focusOnMap(l) {
  state.focus = { id: l.id, lat: l.lat, lon: l.lon };
  if ($("#map").hidden) toggleMap(); else updateMap(state.visible || []);
  $("#map").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Setup ---------------------------------------------------------
async function init() {
  state.pipeline = load("pipeline", {});
  initEigene();
  try {
    state.meta = await getJson("data/meta.json");
  } catch (err) {
    $("#summary").textContent = "";
    return message("Die Daten werden gerade zum ersten Mal gesammelt. Bitte in etwa 30 Minuten neu laden.");
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
  kreisSel.onchange = () => { store("kreis", kreisSel.value); state.focus = null; loadKreis(); };
  $("#radius").value = load("radius", "500");
  $("#radius").onchange = () => { store("radius", $("#radius").value); render(); };
  $("#only-near").oninput = () => { state.limit = 200; render(); };
  $("#show-stroeer").oninput = () => render();
  $("#media").addEventListener("change", mediaChanged);
  document.querySelectorAll("[data-media]").forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    const g = a.dataset.media;
    setMedia(g === "alle" ? Object.keys(state.meta.media || {}) : g === "keine" ? [] : state.meta.media_groups?.[g] || []);
  }));

  const startTab = location.hash.slice(1);
  switchTab(["search", "new", "news", "pipeline", "eigene"].includes(startTab) ? startTab : "search");
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
  state.focus = null;
  state.limit = 200;
  history.replaceState(null, "", "#" + tab);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("aside [class*='only-']").forEach((el) => {
    el.hidden = !el.classList.contains("only-" + tab);
  });
  $("#export").hidden = tab === "news";
  $("#toggle-map").hidden = tab === "news";
  renderQueue();
  render();
  if (tab === "eigene") ensureOwnKreise().then(() => state.tab === "eigene" && render());
}

async function loadKreis() {
  const ags = $("#kreis").value;
  const info = state.meta.status?.[ags];
  $("#stand").textContent = info?.updated ? `Datenstand: ${fmtDate(info.updated)} · ${info.count} Betriebe` : "";
  if (state.kreisData[ags]) { renderMediaFilter(); return render(); }
  if (!info?.count) {
    $("#results").innerHTML = "";
    $("#summary").textContent = "";
    return message(`Für ${kreisName(ags)} liegen noch keine Daten vor. Die nächste Aktualisierung läuft automatisch.`);
  }
  message(`Lade ${kreisName(ags)} …`, true);
  try {
    const [companies, newsFeed, stroeerFeed] = await Promise.all([
      getJson(`data/kreis/${ags}.json`),
      getJson(`data/news/${ags}.json`).catch(() => ({ items: [] })),
      getJson(`data/stroeer/${ags}.json`).catch(() => ({ items: [] })),
    ]);
    for (const l of companies.leads) l.kreis = ags;
    state.kreisData[ags] = companies;
    state.newsData[ags] = newsFeed;
    state.stroeerData[ags] = stroeerFeed;
    state.nearIndex = null;
    message("");
  } catch (err) {
    message(err.message);
  }
  if ($("#kreis").value === ags) { renderMediaFilter(); render(); }
}

function message(text, loading = false) {
  const el = $("#status-msg");
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle("loading", loading);
}

// ---------- Filter & Darstellung -----------------------------------------
function currentRows() {
  if (state.tab === "eigene") return Object.values(state.eigene).map((l) => enrich(l, monthsAgo(12)));
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
  const pipe = state.tab === "pipeline" || state.tab === "eigene";
  const out = rows.filter((l) =>
    (pipe || !$("#hide-chains").checked || !l.chain) &&
    (pipe || !$("#need-contact").checked || l.phone || l.email || l.website) &&
    (state.tab !== "pipeline" || !status || l.status === status) &&
    (!$("#only-near").checked || l.near_count > 0) &&
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
  if (state.tab === "eigene") {
    $("#summary").innerHTML = all.length
      ? `<b>${rows.length}</b> eigene Leads`
      : "Noch keine eigenen Leads. Über „Fotos auswählen“ Bilder von Fahrzeug- oder Schildwerbung hochladen.";
  } else if (state.tab === "pipeline") {
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
    [null, "Kontakt"], ["near_count", "Ströer im Umkreis"], ["status", "Status"], [null, "Notiz"], [null, ""],
  ];
  const head = cols.map(([k, label]) =>
    `<th ${k ? `data-sort="${k}"` : ""}>${label}${state.sort.key === k ? (state.sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
  const body = rows.slice(0, state.limit).map((l) =>
    rowHtml(l) + (state.openNear.has(l.id) && l.near?.count ? nearDetailHtml(l, cols.length) : "")).join("");
  $("#results").innerHTML = `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    ${rows.length > state.limit ? `<div class="more"><button id="more">Weitere ${Math.min(200, rows.length - state.limit)} anzeigen</button></div>` : ""}</div>`;

  document.querySelectorAll("th[data-sort]").forEach((th) => (th.onclick = () => {
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "score" || k === "near_count" ? -1 : 1) };
    render();
  }));
  $("#more")?.addEventListener("click", () => { state.limit += 200; render(); });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  fitNearBoxes();
  document.querySelectorAll("button[data-near]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.near;
    state.openNear.has(id) ? state.openNear.delete(id) : state.openNear.add(id);
    render();
  }));
  document.querySelectorAll("button[data-del]").forEach((b) => (b.onclick = () => deleteOwn(b.dataset.del)));
  document.querySelectorAll("button[data-pitch]").forEach((b) => (b.onclick = () => openPitch(byId[b.dataset.pitch])));
  document.querySelectorAll("button[data-focus]").forEach((b) => (b.onclick = () => focusOnMap(byId[b.dataset.focus])));
  document.querySelectorAll("select[data-id]").forEach((s) => (s.onchange = () => save(byId[s.dataset.id], { status: s.value })));
  document.querySelectorAll("textarea[data-id]").forEach((t) => (t.onchange = () => save(byId[t.dataset.id], { notes: t.value })));
  updateMap(rows);
}

function rowHtml(l) {
  const scoreCls = l.score >= 60 ? "high" : l.score < 35 ? "low" : "";
  const badges = [
    l.new_reason ? `<span class="badge ${l.new_reason === "Neu im Scan" ? "fresh" : "new"}">${esc(l.new_reason)}${l.start_date ? " " + fmtDate(l.start_date) : l.new_reason === "Neu im Scan" ? " " + fmtDate(l.first_seen) : ""}</span>` : "",
    l.photo ? `<span class="badge foto">Eigenes Foto${l.created ? " " + fmtDate(l.created) : ""}</span>` : "",
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
  const osmId = l.match || l.id;
  const osm = osmId.startsWith("osm:") ? `https://www.openstreetmap.org/${osmId.slice(4)}` : "";
  return `<tr>
    <td><span class="score ${scoreCls}" title="${esc(l.score_reasons.join("\n"))}">${l.score}</span></td>
    <td class="name">${l.photo ? `<img class="thumb" src="${l.photo}" alt="">` : ""}${esc(l.name)}<div class="sub">${esc(l.kind)}</div>${badges}</td>
    <td>${esc(catName(l.category))}${state.tab === "pipeline" || state.tab === "eigene" ? `<div class="sub">${esc(kreisName(l.kreis))}</div>` : ""}</td>
    <td>${esc(l.address) || `<span class="sub">–</span>`}</td>
    <td class="contact">${contact}</td>
    <td class="near">${l.near?.count
      ? `<button class="near-btn${state.openNear.has(l.id) ? " open" : ""}" data-near="${esc(l.id)}" aria-expanded="${state.openNear.has(l.id)}">${nearHtml(l.near)}</button>`
      : nearHtml(l.near)}</td>
    <td><select data-id="${esc(l.id)}" aria-label="Status">${statusOpts}</select></td>
    <td><textarea data-id="${esc(l.id)}" placeholder="Notiz …" aria-label="Notiz">${esc(l.notes)}</textarea></td>
    <td class="contact">
      <button class="pitch-btn" data-pitch="${esc(l.id)}" title="Individuellen Telefonpitch mit Claude erstellen">Pitch</button>
      <a href="${google}" target="_blank" rel="noopener">Google</a>
      ${osm ? `<a href="${osm}" target="_blank" rel="noopener">Karte</a>` : ""}
      ${l.source_link ? `<a href="${esc(l.source_link)}" target="_blank" rel="noopener">Quelle</a>` : ""}
      ${state.tab === "eigene" ? `<button class="del-btn" data-del="${esc(l.id)}" title="Eigenen Lead löschen">Löschen</button>` : ""}
    </td>
  </tr>`;
}

function save(lead, patch) {
  const { new_reason, score, score_reasons, status, notes, near, near_count, photo, ocr, ...raw } = lead;
  const entry = state.pipeline[lead.id] || { status: "neu", notes: "", lead: raw };
  Object.assign(entry, patch, { updated: new Date().toISOString() });
  if (entry.status === "neu" && !entry.notes) delete state.pipeline[lead.id];
  else state.pipeline[lead.id] = entry;
  store("pipeline", state.pipeline);
  if (state.tab === "pipeline" || state.tab === "eigene") render();
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
    state.stroeerLayer = L.layerGroup().addTo(state.map);
    state.markers = L.layerGroup().addTo(state.map);
    state.focusLayer = L.layerGroup().addTo(state.map);
  }
  if (!el.hidden) { state.map?.invalidateSize(); render(); }
}

function updateMap(rows) {
  if (!state.map || $("#map").hidden) return;
  state.markers.clearLayers();
  state.stroeerLayer.clearLayers();
  state.focusLayer.clearLayers();
  if (state.tab !== "pipeline" && state.tab !== "eigene" && $("#show-stroeer").checked) {
    for (const it of stroeerItems($("#kreis").value)) {
      const digital = it.typ.startsWith("PV");
      L.circleMarker([it.lat, it.lon], { radius: 4, color: digital ? "#7b2cbf" : "#d9480f", weight: 1,
        fillColor: digital ? "#7b2cbf" : "#d9480f", fillOpacity: 0.9 })
        .bindPopup(`<b>${esc(mediaName(it.typ))}</b><br>${esc(it.standort)}<br>${esc(it.plz)} ${esc(it.ort)}`
          + `<br>SDAW ${esc(it.id)}${it.netz ? "<br>Teil eines Netzes" : ""}`
          + (it.foto ? `<br><a href="${esc(it.foto)}" target="_blank" rel="noopener">Foto</a>` : ""))
        .addTo(state.stroeerLayer);
    }
  }
  const pts = [];
  for (const l of rows.slice(0, 1500)) {
    if (l.lat == null) continue;
    const color = l.new_reason ? "#1f7a3d" : l.score >= 60 ? "#0b5cad" : "#8a93a3";
    L.circleMarker([l.lat, l.lon], { radius: 6, color, fillColor: color, fillOpacity: 0.8, weight: 1 })
      .bindPopup(`<b>${esc(l.name)}</b><br>${esc(catName(l.category))}<br>${esc(l.address)}<br>Score ${l.score}`
        + (l.near?.count ? `<br>${l.near.count} Ströer-Flächen im Umkreis` : ""))
      .addTo(state.markers);
    pts.push([l.lat, l.lon]);
  }
  const f = state.focus && rows.find((r) => r.id === state.focus.id);
  if (f) {
    // Umkreis einzeichnen und die Flächen darin hervorheben
    L.circle([f.lat, f.lon], { radius: +$("#radius").value, color: "#0b5cad", weight: 1, fillOpacity: 0.06 })
      .addTo(state.focusLayer);
    for (const it of f.near?.items || []) {
      const digital = it.typ.startsWith("PV");
      L.circleMarker([it.lat, it.lon], { radius: 9, color: "#fff", weight: 2,
        fillColor: digital ? "#7b2cbf" : "#d9480f", fillOpacity: 1 })
        .bindTooltip(`${it.dist} m · ${mediaName(it.typ)}<br>${esc(it.standort)}`)
        .bindPopup(`<b>${esc(mediaName(it.typ))}</b> · ${it.dist} m<br>${esc(it.standort)}<br>${esc(it.plz)} ${esc(it.ort)}`
          + `<br>SDAW ${esc(it.id)}<br><a href="${gmaps(it.lat, it.lon)}" target="_blank" rel="noopener">Google Maps</a>`
          + (it.foto ? ` · <a href="${esc(it.foto)}" target="_blank" rel="noopener">Foto</a>` : ""))
        .addTo(state.focusLayer);
    }
    L.circleMarker([f.lat, f.lon], { radius: 9, color: "#fff", weight: 2, fillColor: "#0b5cad", fillOpacity: 1 })
      .bindPopup(`<b>${esc(f.name)}</b><br>${esc(f.address)}`).addTo(state.focusLayer).openPopup();
    const zoom = { 250: 17, 500: 16, 1000: 15, 2000: 14 }[$("#radius").value] || 15;
    state.map.setView([f.lat, f.lon], zoom);
  } else if (pts.length) {
    state.map.fitBounds(pts, { padding: [20, 20], maxZoom: 14 });
  }
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
    ["Ströer-Flächen im Umkreis", (l) => l.near?.count ?? ""],
    ["Nächste Ströer-Fläche (m)", (l) => l.near?.nearest?.dist ?? ""],
    ["Nächste Ströer-Fläche", (l) => l.near?.nearest ? `${mediaName(l.near.nearest.typ)}: ${l.near.nearest.standort} (SDAW ${l.near.nearest.id})` : ""],
    ["Quelle", (l) => l.source_link || (l.photo ? "Eigenes Foto " + fmtDate(l.created) : "") ||
      (l.id.startsWith("osm:") ? "https://www.openstreetmap.org/" + l.id.slice(4) : "")],
  ];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [fields.map(([h]) => cell(h)).join(";")].concat(
    rows.map((l) => fields.map(([, f]) => cell(typeof f === "function" ? f(l) : l[f])).join(";")));
  const label = state.tab === "pipeline" || state.tab === "eigene" ? state.tab : `${state.tab}_${kreisName($("#kreis").value).replace(/\W+/g, "_")}`;
  download(`leads_${label}_${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
}

function saveBackup() {
  download(`leadgenerator_sicherung_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ version: 1, pipeline: state.pipeline, eigene: state.eigene }, null, 1), "application/json");
}

async function loadBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.pipeline) throw new Error("Keine Leadgenerator-Sicherung.");
    Object.assign(state.pipeline, data.pipeline);
    store("pipeline", state.pipeline);
    Object.assign(state.eigene, data.eigene || {});
    storeEigene();
    const own = Object.keys(data.eigene || {}).length;
    message(`${Object.keys(data.pipeline).length} Leads${own ? ` und ${own} eigene Leads` : ""} aus der Sicherung geladen.`, true);
    render();
  } catch (err) {
    message("Sicherung konnte nicht geladen werden: " + err.message);
  }
  e.target.value = "";
}

init();
