"use strict";
// ---------- Eigene Leads aus Fotos (Fahrzeuge, Schilder, Plakate) ---------
// Texterkennung läuft im Browser (Tesseract); die Fotos verlassen das Gerät nicht.

const OCR = window.OCR_PATHS || {
  script: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
  corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
  langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu@1.0.0/4.0.0_best_int",
};

const WEBMAIL = new Set(["gmail.com", "googlemail.com", "web.de", "gmx.de", "gmx.net", "t-online.de", "outlook.com",
  "outlook.de", "hotmail.com", "hotmail.de", "yahoo.com", "yahoo.de", "icloud.com", "freenet.de", "arcor.de", "aol.com"]);
const NAME_STOP = new Set(["gmbh", "mbh", "co", "kg", "ag", "ug", "ohg", "gbr", "ek", "inh", "und", "der", "die", "das",
  "den", "dem", "des", "von", "fur", "mit", "the", "tel", "telefon", "fax", "mobil", "www", "info", "mail", "email",
  "de", "com", "str", "strasse", "gmbhco"]);

// Gleiche Regeln wie normPhone/normDomain in leadgen/webexport.py
function normPhone(value) {
  let d = String(value).replace("(0)", "").replace(/[^\d+]/g, "");
  if (d.startsWith("+49")) d = "0" + d.slice(3);
  else if (d.startsWith("0049")) d = "0" + d.slice(4);
  d = d.replace(/\+/g, "");
  return d.length >= 6 ? d : "";
}

function normDomain(value) {
  let v = String(value).trim().toLowerCase();
  if (v.includes("@")) v = v.split("@").pop();
  v = v.replace(/^https?:\/\//, "").split(/[/?:]/)[0].replace(/^www\./, "");
  return v.includes(".") && !WEBMAIL.has(v) ? v : "";
}

const foldName = (s) => String(s).toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u")
  .replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");
const nameTokens = (s) => foldName(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !NAME_STOP.has(t) && !/^\d+$/.test(t));

// Telefon, Website, E-Mail und Kandidaten für den Firmennamen aus dem erkannten Text
function extractFromText(text, lines = []) {
  const flat = text.replace(/[|]/g, " ");
  const emails = [...new Set((flat.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase()))];
  const domainRe = /\b(?:https?:\/\/)?(?:www\s?\.\s?)?((?:[a-z0-9äöü][a-z0-9äöü-]*\.)+(?:de|com|net|eu|info|org|biz|shop|online|gmbh|ag|at|ch|io|app|team|bayern|berlin|koeln|stuttgart))\b/gi;
  const domains = new Set();
  for (const m of flat.matchAll(domainRe)) {
    const before = flat[m.index - 1];
    if (before === "@") continue; // Teil einer E-Mail-Adresse
    const d = normDomain(m[1].replace(/\s/g, ""));
    if (d) domains.add(d);
  }
  for (const e of emails) { const d = normDomain(e); if (d) domains.add(d); }
  const phones = new Set();
  const phoneRe = /(?:(?:\+|00)\s?49\s?(?:\(0\))?|\b0)[\s\-/.()]*\d{2,5}(?:[\s\-/.()]*\d){3,10}/g;
  for (const m of flat.matchAll(phoneRe)) {
    const p = normPhone(m[0].trim());
    if (p.length >= 7 && p.length <= 14 && !/^0+$/.test(p)) phones.add(p);
  }
  // Größte Schrift zuerst – das ist meistens der Firmenname
  const names = lines
    .map((l) => ({ text: l.text.trim().replace(/\s+/g, " "), h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0, conf: l.confidence ?? 100 }))
    .filter((l) => l.conf >= 45 && (l.text.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 3
      && !/@|www|\.de\b|tel|fax|\d{4,}/i.test(l.text))
    .sort((a, b) => b.h - a.h)
    .slice(0, 3)
    .map((l) => l.text.replace(/^[^\wÄÖÜäöü]+|[^\wÄÖÜäöü.&)]+$/g, ""));
  return { phones: [...phones], domains: [...domains], emails, names };
}

// ---------- Suchindex aller Betriebe (data/suche.json) ---------------------
let searchIndex = null;
async function getSearchIndex() {
  if (searchIndex) return searchIndex;
  const data = await getJson("data/suche.json");
  const rows = data.rows.map(([id, name, kreis, phone, domain]) => ({ id, name, kreis, phones: phone ? phone.split(" ") : [], domains: domain ? domain.split(" ") : [] }));
  const byPhone = new Map(), byDomain = new Map(), byToken = new Map();
  rows.forEach((r, i) => {
    for (const p of r.phones) byPhone.set(p, [...(byPhone.get(p) || []), i]);
    for (const d of r.domains) byDomain.set(d, [...(byDomain.get(d) || []), i]);
    r.tokens = [...new Set(nameTokens(r.name))];
    for (const t of r.tokens) { if (!byToken.has(t)) byToken.set(t, []); byToken.get(t).push(i); }
  });
  const idf = (t) => Math.log(rows.length / (byToken.get(t)?.length || 1));
  searchIndex = { rows, byPhone, byDomain, byToken, idf };
  return searchIndex;
}

// Betriebe aus den Daten, die zum Foto passen (Telefon/Domain sicher, Name unscharf)
function findCandidates(ix, found, text) {
  const hits = new Map(); // row index -> {score, why}
  const add = (i, score, why) => {
    const h = hits.get(i) || { score: 0, why: [] };
    h.score += score;
    if (!h.why.includes(why)) h.why.push(why);
    hits.set(i, h);
  };
  for (const p of found.phones) {
    for (const i of ix.byPhone.get(p) || []) add(i, 100, "Telefon");
    if (p.length >= 8) { // Durchwahl oder fehlende Vorwahl
      for (const [q, list] of ix.byPhone) if (q !== p && (q.endsWith(p.slice(1)) || p.endsWith(q.slice(1))) && Math.min(p.length, q.length) >= 8) list.forEach((i) => add(i, 60, "Telefon"));
    }
  }
  for (const d of found.domains) for (const i of ix.byDomain.get(d) || []) add(i, 100, "Website");
  const minGot = Math.min(6, 0.5 * Math.log(ix.rows.length)); // mindestens ein seltener Namensbestandteil
  const partial = new Map(); // row index -> Map(token -> Gewicht)
  for (const [word, t, weight] of matchTokens(ix, new Set(nameTokens(text)))) {
    for (const i of ix.byToken.get(t)) {
      if (!partial.has(i)) partial.set(i, new Map());
      const m = partial.get(i);
      m.set(t, Math.max(m.get(t) || 0, ix.idf(t) * weight));
    }
  }
  for (const [i, m] of partial) {
    const r = ix.rows[i];
    const got = [...m.values()].reduce((s, v) => s + v, 0);
    const total = r.tokens.reduce((s, t) => s + ix.idf(t), 0);
    if (got >= minGot && got / total >= 0.7) add(i, Math.round(40 * got / total + got), "Name");
  }
  return [...hits.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 6)
    .map(([i, h]) => ({ ...ix.rows[i], why: h.why }));
}

// Wörter vom Foto auf Namensbestandteile abbilden – exakt oder mit kleinen Lesefehlern
function matchTokens(ix, words) {
  const out = [];
  for (const w of words) {
    if (ix.byToken.has(w)) { out.push([w, w, 1]); continue; }
    if (w.length < 5) continue;
    const maxDist = w.length >= 8 ? 2 : 1;
    for (const t of ix.byToken.keys()) {
      if (Math.abs(t.length - w.length) <= maxDist && t.length >= 5 && editDistance(w, t, maxDist) <= maxDist) out.push([w, t, 0.8]);
    }
  }
  return out;
}

function editDistance(a, b, max) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// ---------- Fotos verarbeiten ---------------------------------------------
let ocrWorker = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Texterkennung konnte nicht geladen werden (Internetverbindung?)."));
    document.head.append(s);
  });
}
async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) await loadScript(OCR.script);
  ocrWorker = await Tesseract.createWorker("deu", 1, {
    workerPath: OCR.workerPath, corePath: OCR.corePath, langPath: OCR.langPath,
    logger: (m) => {
      const job = state.queue.find((j) => j.status === "ocr");
      if (job && m.status === "recognizing text") { job.progress = Math.round(m.progress * 100); updateJobProgress(job); }
    },
  });
  return ocrWorker;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    img.src = URL.createObjectURL(file);
  });
}
function scaled(img, max, type = "image/jpeg", quality = 0.85) {
  const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * f);
  c.height = Math.round(img.naturalHeight * f);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return type ? c.toDataURL(type, quality) : c;
}

function addPhotos(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    state.queue.push({ key: Math.random().toString(36).slice(2), file, status: "wait", progress: 0 });
  }
  renderQueue();
  $("#queue").scrollIntoView({ behavior: "smooth", block: "start" });
  processQueue();
}

let processing = false;
async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    for (let job; (job = state.queue.find((j) => j.status === "wait"));) {
      job.status = "ocr";
      renderQueue();
      try {
        const img = await loadImage(job.file);
        job.thumb = scaled(img, 360, "image/jpeg", 0.6);
        renderQueue();
        const [worker, ix] = await Promise.all([getOcrWorker(), getSearchIndex()]);
        const { data } = await worker.recognize(scaled(img, 2000, null));
        job.text = data.text.trim();
        job.found = extractFromText(job.text, data.lines || []);
        job.candidates = findCandidates(ix, job.found, job.text);
        job.form = {
          name: job.found.names[0] || "", category: "", kreis: $("#kreis").value, address: "",
          phone: job.found.phones[0] || "", website: job.found.domains[0] || "", email: job.found.emails[0] || "",
        };
        job.match = "";
        job.status = "done";
        if (job.candidates.length) await pickCandidate(job, job.candidates[0].id); // Vorschlag, wird vor dem Speichern geprüft
      } catch (err) {
        job.status = "error";
        job.error = err.message || String(err);
      }
      job.file = null;
      renderQueue();
    }
  } finally {
    processing = false;
  }
}

async function fetchLead(cand) {
  const data = state.kreisData[cand.kreis] || await getJson(`data/kreis/${cand.kreis}.json`);
  if (!state.kreisData[cand.kreis]) {
    for (const l of data.leads) l.kreis = cand.kreis;
    state.kreisData[cand.kreis] = data;
  }
  return data.leads.find((l) => l.id === cand.id);
}

async function pickCandidate(job, id) {
  job.match = id;
  const cand = job.candidates.find((c) => c.id === id);
  if (!cand) return;
  try {
    const l = await fetchLead(cand);
    if (!l) return;
    job.lead = l;
    Object.assign(job.form, {
      name: l.name, category: l.category || "", kreis: cand.kreis, address: l.address || l.city || "",
      phone: l.phone || job.form.phone, website: l.website || job.form.website, email: l.email || job.form.email,
    });
  } catch (_) { /* Kreisdaten fehlen – Formular bleibt wie erkannt */ }
}

function updateJobProgress(job) {
  const el = document.querySelector(`[data-job="${job.key}"] .progress`);
  if (el) el.textContent = `Texterkennung … ${job.progress} %`;
}

const catOptions = (sel) => `<option value="">– Branche wählen –</option>` + state.meta.categories.map((c) =>
  `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
const kreisOptions = (sel) => state.meta.kreise.map((k) =>
  `<option value="${k.ags}" ${k.ags === sel ? "selected" : ""}>${esc(k.name)}</option>`).join("");

function jobHtml(job) {
  const img = job.thumb ? `<img src="${job.thumb}" alt="Foto">` : `<div class="ph"></div>`;
  if (job.status === "wait" || job.status === "ocr") {
    return `<div class="job" data-job="${job.key}">${img}<div class="job-body">
      <div class="progress">${job.status === "wait" ? "Wartet …" : `Texterkennung … ${job.progress || 0} %`}</div>
      <div class="hint">Beim ersten Foto wird die Texterkennung geladen (ca. 5 MB).</div></div></div>`;
  }
  if (job.status === "error") {
    return `<div class="job" data-job="${job.key}">${img}<div class="job-body">
      <div class="error">${esc(job.error)}</div><button data-drop="${job.key}">Entfernen</button></div></div>`;
  }
  const f = job.found;
  const chips = [...f.phones.map((p) => `☎ ${p}`), ...f.domains.map((d) => `🌐 ${d}`), ...f.emails.map((e) => `✉ ${e}`)]
    .map((c) => `<span class="badge topic">${esc(c)}</span>`).join("") || `<span class="sub">keine Telefonnummer/Website erkannt</span>`;
  const cands = job.candidates.map((c) => `<label class="check"><input type="radio" name="m-${job.key}" value="${esc(c.id)}" ${job.match === c.id ? "checked" : ""}>
      <span><b>${esc(c.name)}</b> <span class="sub">${esc(kreisName(c.kreis))} · erkannt über ${c.why.join(" + ")}${c.why.length === 1 && c.why[0] === "Name" ? " – bitte prüfen" : ""}</span></span></label>`).join("");
  const v = job.form;
  return `<div class="job" data-job="${job.key}">${img}<div class="job-body">
    <div class="found">${chips}</div>
    <div class="cands">
      <div class="label">${job.candidates.length ? "Passende Betriebe in deinen Daten" : "Kein passender Betrieb in den Daten gefunden – bitte Angaben prüfen"}</div>
      ${cands}
      ${job.candidates.length ? `<label class="check"><input type="radio" name="m-${job.key}" value="" ${job.match ? "" : "checked"}> <span>Keiner davon – eigene Angaben</span></label>` : ""}
    </div>
    <div class="form">
      <label>Firma<input data-f="name" value="${esc(v.name)}" placeholder="Firmenname"></label>
      <label>Branche<select data-f="category">${catOptions(v.category)}</select></label>
      <label>Adresse / Ort<input data-f="address" value="${esc(v.address)}" placeholder="z. B. Hauptstr. 5, Ostfildern"></label>
      <label>Kreis<select data-f="kreis">${kreisOptions(v.kreis)}</select></label>
      <label>Telefon<input data-f="phone" value="${esc(v.phone)}"></label>
      <label>Website<input data-f="website" value="${esc(v.website)}"></label>
      <label>E-Mail<input data-f="email" value="${esc(v.email)}"></label>
    </div>
    <details><summary>Erkannter Text</summary><pre>${esc(job.text) || "–"}</pre></details>
    <div class="job-actions">
      <button class="pitch-btn" data-keep="${job.key}">Als eigenen Lead speichern</button>
      <button data-drop="${job.key}">Verwerfen</button>
    </div>
  </div></div>`;
}

function renderQueue() {
  const el = $("#queue");
  if (!el) return;
  el.hidden = state.tab !== "eigene" || !state.queue.length;
  if (el.hidden) return;
  const open = state.queue.filter((j) => j.status !== "done").length;
  el.innerHTML = `<div class="queue-head"><b>Fotos prüfen</b> <span class="sub">${state.queue.length} Foto(s)${open ? `, ${open} in Arbeit` : ""}</span></div>`
    + state.queue.map(jobHtml).join("");
  el.querySelectorAll("[data-job]").forEach((card) => {
    const job = state.queue.find((j) => j.key === card.dataset.job);
    card.querySelectorAll("[data-f]").forEach((inp) => (inp.oninput = () => (job.form[inp.dataset.f] = inp.value)));
    card.querySelectorAll("input[type=radio]").forEach((r) => (r.onchange = async () => {
      if (r.value) await pickCandidate(job, r.value);
      else { job.match = ""; job.lead = null; }
      renderQueue();
    }));
  });
  el.querySelectorAll("[data-drop]").forEach((b) => (b.onclick = () => {
    state.queue = state.queue.filter((j) => j.key !== b.dataset.drop);
    renderQueue();
  }));
  el.querySelectorAll("[data-keep]").forEach((b) => (b.onclick = () => keepJob(b.dataset.keep, b)));
}

// Adresse -> Koordinaten (und Kreis) über OpenStreetMap-Nominatim, nur bei eigenen Angaben
async function geocode(address, ags) {
  const k = state.meta.kreise.find((x) => x.ags === ags);
  const q = `${address}, ${k ? k.osm_name : ""}, Baden-Württemberg`;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&q=${encodeURIComponent(q)}`);
    const [hit] = await res.json();
    return hit ? { lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5) } : null;
  } catch (_) {
    return null;
  }
}

async function keepJob(key, button) {
  const job = state.queue.find((j) => j.key === key);
  const f = job.form;
  if (!f.name.trim()) return message("Bitte einen Firmennamen eintragen.");
  button.disabled = true;
  const base = job.match && job.lead ? job.lead : {};
  const lead = {
    ...base,
    id: job.match ? `own:${job.match}` : `own:${Date.now().toString(36)}${key.slice(0, 4)}`,
    match: job.match || "",
    name: f.name.trim(), category: f.category, kreis: f.kreis, address: f.address.trim(),
    phone: f.phone.trim(), website: f.website.trim(), email: f.email.trim(),
    photo: job.thumb, ocr: (job.text || "").slice(0, 600), created: new Date().toISOString().slice(0, 10),
  };
  delete lead.first_seen;
  if (lead.lat == null && lead.address) Object.assign(lead, await geocode(lead.address, lead.kreis));
  state.eigene[lead.id] = lead;
  if (!storeEigene()) { delete state.eigene[lead.id]; button.disabled = false; return; }
  state.queue = state.queue.filter((j) => j !== job);
  renderQueue();
  await ensureOwnKreise();
  render();
}

function storeEigene() {
  try {
    localStorage.setItem("leadgen:eigene", JSON.stringify(state.eigene));
    return true;
  } catch (_) {
    message("Der Speicher im Browser ist voll. Bitte eine Sicherung speichern und alte eigene Leads löschen.");
    return false;
  }
}

function deleteOwn(id) {
  const l = state.eigene[id];
  if (!l || !confirm(`„${l.name}“ aus den eigenen Leads löschen?`)) return;
  delete state.eigene[id];
  delete state.pipeline[id];
  storeEigene();
  store("pipeline", state.pipeline);
  render();
}

// Ströer-Daten der Kreise nachladen, in denen eigene Leads liegen
async function ensureOwnKreise() {
  const need = [...new Set(Object.values(state.eigene).map((l) => l.kreis))].filter((a) => a && !state.stroeerData[a]);
  if (!need.length) return;
  await Promise.all(need.map(async (ags) => {
    state.stroeerData[ags] = await getJson(`data/stroeer/${ags}.json`).catch(() => ({ items: [] }));
  }));
  state.nearIndex = null;
}

function initEigene() {
  state.eigene = load("eigene", {});
  const input = $("#photo-input");
  input.onchange = () => { addPhotos([...input.files]); input.value = ""; };
  const drop = $("#photo-drop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addPhotos([...e.dataTransfer.files]); };
}
