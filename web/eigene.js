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

const TLDS = "de|com|net|eu|info|org|biz|shop|online|gmbh|ag|at|ch|io|app|team|bayern|berlin|koeln|stuttgart";
const STREET = "(?:straße|strasse|str\\.?|weg|platz|gasse|allee|ring|steige|steig|damm|ufer|markt|hof|tor|graben|berg|halde)";

// Ist `part` eine am Bildrand abgeschnittene Form von `full`? Am Schnitt darf ein
// angeschnittener Buchstabe falsch gelesen sein: "ireinerei-metzger.de" ~ "schreinerei-metzger.de"
function isCutOff(part, full) {
  if (!part || !full || part === full || part.length >= full.length + 1) return false;
  let n = 0;
  while (n < part.length && part[part.length - 1 - n] === full[full.length - 1 - n]) n++;
  if (n < Math.max(8, part.length - 2) || n >= full.length) return false;
  // "metzger.de" ist eine eigene Adresse, kein Ausschnitt von "schreinerei-metzger.de"
  return !(n === part.length && /[-.]/.test(full[full.length - n - 1]));
}

// Telefon, Website, E-Mail, Adresse und Kandidaten für den Firmennamen aus dem erkannten Text
function extractFromText(text, lines = [], plzTable = {}) {
  const flat = text.replace(/[|®©]/g, " ");
  const emails = [...new Set((flat.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase()))];
  const domains = new Set();
  const domainRe = new RegExp(`\\b(?:https?:\\/\\/)?(?:www\\s?\\.\\s?)?((?:[a-z0-9äöü][a-z0-9äöü-]*\\.)+(?:${TLDS}))\\b`, "gi");
  for (const m of flat.matchAll(domainRe)) {
    if (flat[m.index - 1] === "@") continue; // Teil einer E-Mail-Adresse
    const d = normDomain(m[1].replace(/\s/g, ""));
    if (d) domains.add(d);
  }
  // Typische Lesefehler: "rurw.firma.d", "vvww. firma .de", "www.firma.d e"
  const sloppyRe = new RegExp(`\\b[wvrnmu]{2,5}\\s?[.,·]\\s?([a-z0-9äöü][a-z0-9äöü-]{2,})\\s?[.,·]\\s?(${TLDS}|d)(?![a-z])`, "gi");
  for (const m of flat.matchAll(sloppyRe)) {
    const d = normDomain(`${m[1]}.${m[2].toLowerCase() === "d" ? "de" : m[2]}`);
    if (d) domains.add(d);
  }
  for (const e of emails) { const d = normDomain(e); if (d) domains.add(d); }
  // Abgeschnittene Webadresse ("ireinerei-metzger.de") mit der E-Mail-Domain vervollständigen
  for (const d of [...domains]) {
    if ([...domains].some((x) => x !== d && isCutOff(d, x))) domains.delete(d);
  }

  const phones = new Set();
  const phoneRe = /(?:(?:\+|00)\s?49\s?(?:\(0\))?|\b0)[\s\-–/.()]*\d{2,5}(?:[\s\-–/.()]*\d){3,10}/g;
  for (const m of flat.matchAll(phoneRe)) {
    const p = normPhone(m[0].trim());
    if (p.length >= 7 && p.length <= 14 && !/^0+$/.test(p) && !/^0\d{4}$/.test(p)) phones.add(p);
  }

  // Adresse: "Oberamteistraße 1 · 72764 Reutlingen"
  let address = "", plz = "", ort = "", addrLine = -1;
  const textLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  textLines.forEach((line, n) => {
    if (plz) return;
    const m = line.match(/\b([6-9]\d{4})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]{2,}(?:\s(?:am|an|im|ob|unter|bei|in)\s[A-ZÄÖÜ][a-zäöüß]+)?)/);
    if (!m) return;
    plz = m[1];
    ort = plzTable[plz]?.[1] || m[2].replace(/[^A-Za-zÄÖÜäöüß-]+$/, "");
    const st = line.match(new RegExp(`([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]*${STREET})\\s*(\\d+\\s?[a-zA-Z]?)`, "i"));
    const prev = !st && n > 0 ? textLines[n - 1].match(new RegExp(`([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]*${STREET})\\s*(\\d+\\s?[a-zA-Z]?)`, "i")) : null;
    const street = st || prev;
    address = `${street ? `${street[1]} ${street[2].replace(/\s/g, "")}, ` : ""}${plz} ${ort}`;
    addrLine = street && !st ? n - 1 : n;
  });

  // Firmenname: Zeile über der Adresse, dann größte Schrift, zuletzt Name aus der Webadresse
  const looksLikeName = (t) => (t.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 4 && !/@|www|\.de\b|tel|fax|\d{4,}/i.test(t)
    && (t.match(/[A-Za-zÄÖÜäöüß]/g) || []).length / t.replace(/\s/g, "").length > 0.75;
  const clean = (t) => t.replace(/^[^\wÄÖÜäöü]+|[^\wÄÖÜäöü.&)]+$/g, "").replace(/^(?:\S{1,2}\s+)+(?=\S{3,})/, "");
  const names = [];
  if (addrLine > 0 && looksLikeName(textLines[addrLine - 1])) names.push(clean(textLines[addrLine - 1]));
  lines
    .map((l) => ({ text: l.text.trim().replace(/\s+/g, " "), h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0, conf: l.confidence ?? 100 }))
    .filter((l) => l.conf >= 70 && looksLikeName(l.text) && (l.text.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 5)
    .sort((a, b) => b.h - a.h)
    .slice(0, 2)
    .forEach((l) => names.push(clean(l.text)));
  for (const d of domains) {
    const core = d.split(".")[0];
    if (core.length >= 3 && !WEBMAIL.has(d)) names.push(core.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));
  }
  return { phones: [...phones], domains: [...domains], emails, names: [...new Set(names)], address, plz, ort,
    kreis: plzTable[plz]?.[0] || "" };
}

// ---------- Suchindex aller Betriebe (data/suche.json) ---------------------
// Suchindex liegt pro Kreis in data/suche/<ags>.json; geladen werden nur die
// Kreise, auf die das Foto hindeutet (PLZ, Vorwahl) plus der gewählte Kreis.
const searchIndex = { rows: [], byPhone: new Map(), byDomain: new Map(), byToken: new Map(), loaded: new Set(),
  meta: null, idf(t) { return Math.log(this.rows.length / (this.byToken.get(t)?.length || 1)); } };

async function getSearchMeta() {
  if (!searchIndex.meta) searchIndex.meta = await getJson("data/suche/meta.json").catch(() => ({ plz: {}, vorwahl: {} }));
  return searchIndex.meta;
}

async function loadShards(kreise) {
  const ix = searchIndex;
  const todo = [...kreise].filter((a) => a && !ix.loaded.has(a));
  const shards = await Promise.all(todo.map((a) => getJson(`data/suche/${a}.json`).catch(() => ({ rows: [] }))));
  todo.forEach((a) => ix.loaded.add(a));
  for (const shard of shards) {
    for (const [id, name, kreis, phone, domain, plz] of shard.rows) {
      const i = ix.rows.length;
      const r = { id, name, kreis, plz: plz || "", phones: phone ? phone.split(" ") : [], domains: domain ? domain.split(" ") : [],
        tokens: [...new Set(nameTokens(name))] };
      ix.rows.push(r);
      for (const p of r.phones) { if (!ix.byPhone.has(p)) ix.byPhone.set(p, []); ix.byPhone.get(p).push(i); }
      for (const d of r.domains) { if (!ix.byDomain.has(d)) ix.byDomain.set(d, []); ix.byDomain.get(d).push(i); }
      for (const t of r.tokens) { if (!ix.byToken.has(t)) ix.byToken.set(t, []); ix.byToken.get(t).push(i); }
    }
  }
  return ix;
}

// Kreise, auf die das Foto hindeutet
function hintedKreise(found, meta) {
  const out = new Set([found.kreis, $("#kreis").value]);
  for (const p of found.phones) {
    for (const n of [6, 5, 4]) if (meta.vorwahl?.[p.slice(0, n)]) { out.add(meta.vorwahl[p.slice(0, n)]); break; }
  }
  out.delete("");
  out.delete(undefined);
  return out;
}

// Betriebe aus den Daten, die zum Foto passen (Telefon/Domain sicher, Name unscharf, PLZ als Bestätigung)
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
    if (p.length >= 8) { // Zentrale vs. Durchwahl: 07031 1234-0 / 07031 1234-56
      for (const [q, list] of ix.byPhone) if (q !== p && q.length >= 8 && (q.startsWith(p) || p.startsWith(q))) list.forEach((i) => add(i, 60, "Telefon"));
    }
  }
  for (const d of found.domains) {
    for (const i of ix.byDomain.get(d) || []) add(i, 100, "Website");
    // Am Bildrand abgeschnitten: "ireinerei-metzger.de" passt zu "schreinerei-metzger.de"
    if (d.length >= 8) for (const [q, list] of ix.byDomain) if (q !== d && isCutOff(d, q)) list.forEach((i) => add(i, 80, "Website"));
  }
  const minGot = Math.min(6, 0.5 * Math.log(ix.rows.length)); // mindestens ein seltener Namensbestandteil
  const partial = new Map(); // row index -> Map(token -> Gewicht)
  const words = new Set(nameTokens(text + " " + found.domains.map((d) => d.split(".")[0]).join(" ")));
  for (const [, t, weight] of matchTokens(ix, words)) {
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
  if (found.plz) {
    for (const [i, h] of hits) {
      const r = ix.rows[i];
      if (r.plz === found.plz) add(i, 60, "PLZ");
      else if (found.kreis && r.kreis !== found.kreis) h.score -= 30; // anderer Kreis als auf dem Foto
    }
  }
  const sorted = [...hits.entries()].sort((a, b) => b[1].score - a[1].score);
  const top = sorted[0]?.[1].score || 0;
  return sorted
    .filter(([, h]) => h.score >= top * 0.5 && h.score > 0)
    .slice(0, 5)
    .map(([i, h]) => ({ ...ix.rows[i], why: h.why, sure: h.why.some((w) => w !== "Name") }));
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

// Graustufen mit kräftigem Kontrast, wahlweise invertiert
function contrastCopy(src, invert) {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    g = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
    if (invert) g = 255 - g;
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function addPhotos(files, { scroll = true, folderEntries = [] } = {}) {
  files.forEach((file, i) => {
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)) return;
    state.queue.push({ key: Math.random().toString(36).slice(2), file, status: "wait", progress: 0,
      entry: folderEntries[i] || null, fileName: file.name });
  });
  renderQueue();
  updateQueueBadge();
  if (scroll && state.tab === "eigene") $("#queue").scrollIntoView({ behavior: "smooth", block: "start" });
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
        const [worker, meta] = await Promise.all([getOcrWorker(), getSearchMeta()]);
        // Zwei Durchgänge: normal und invertiert (helle Schrift auf dunklem Grund)
        const big = scaled(img, 3200, null);
        const texts = [], lines = [];
        for (const [n, canvas] of [[1, big], [2, contrastCopy(big, true)]]) {
          job.pass = n;
          const { data } = await worker.recognize(canvas);
          texts.push(data.text.trim());
          lines.push(...(data.lines || []));
        }
        job.text = texts.join("\n");
        job.found = extractFromText(job.text, lines, meta.plz || {});
        const ix = await loadShards(hintedKreise(job.found, meta));
        job.candidates = findCandidates(ix, job.found, job.text);
        job.form = {
          name: job.found.names[0] || "", category: "", kreis: job.found.kreis || $("#kreis").value,
          address: job.found.address, phone: job.found.phones[0] || "", website: job.found.domains[0] || "",
          email: job.found.emails[0] || "",
        };
        job.ocrForm = { ...job.form };
        job.match = "";
        job.status = "done";
        // Sicherer Treffer (Telefon, Website oder PLZ) wird vorausgewählt, reiner Namenstreffer nur vorgeschlagen
        if (job.candidates[0]?.sure) await pickCandidate(job, job.candidates[0].id);
        else if (job.candidates[0]) job.form.name = job.candidates[0].name;
      } catch (err) {
        job.status = "error";
        job.error = err.message || String(err);
      }
      job.file = null;
      if (job.entry) await moveToDone(job);
      renderQueue();
      updateQueueBadge();
    }
  } finally {
    processing = false;
  }
}

// Vollständige Daten eines Treffers (aus der Kreisdatei, ggf. aus den unsicheren Einträgen)
const leadFiles = {};
async function fetchLead(cand) {
  const find = (list) => (list || []).find((l) => l.id === cand.id);
  const known = state.kreisData[cand.kreis];
  let hit = find(known?.leads) || find(known?.unsure);
  for (const file of [`${cand.kreis}.json`, `${cand.kreis}-unsicher.json`]) {
    if (hit) break;
    leadFiles[file] ||= getJson(`data/kreis/${file}`).then((d) => d.leads).catch(() => []);
    hit = find(await leadFiles[file]);
  }
  return hit ? { ...hit, kreis: cand.kreis } : null;
}

// Kein sicherer Treffer: alle Kreise durchsuchen (lädt den ganzen Index)
async function searchEverywhere(job) {
  job.searching = true;
  renderQueue();
  try {
    const ix = await loadShards(state.meta.kreise.map((k) => k.ags));
    job.candidates = findCandidates(ix, job.found, job.text);
    if (job.candidates[0]?.sure) await pickCandidate(job, job.candidates[0].id);
  } finally {
    job.searching = false;
    job.searchedAll = true;
    renderQueue();
  }
}

// Website: die vollständige Adresse aus den Daten statt einer abgeschnittenen vom Foto
function completeWebsite(fromPhoto, fromData, sure) {
  if (!fromData) return fromPhoto || "";
  if (!fromPhoto) return fromData;
  const a = normDomain(fromPhoto), b = normDomain(fromData);
  return isCutOff(a, b) || sure ? fromData : fromPhoto;
}

// Impressum: aus dem nächtlichen Website-Check, sonst Link zum Selbst-Nachsehen
function impressumHint(job) {
  const imp = job.lead?.ws?.imp;
  if (imp) return `<div class="grp-imp"><b>Laut Impressum:</b> ${esc(impressumText(imp))}</div>`;
  const d = normDomain(job.form.website || "");
  return d ? `<div class="sub">Impressum noch nicht geprüft · <a href="https://${esc(d)}/impressum" target="_blank" rel="noopener">Impressum öffnen</a>
    · <a href="https://${esc(d)}" target="_blank" rel="noopener">Website öffnen</a></div>` : "";
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
      name: l.name, category: l.category || "", kreis: cand.kreis, address: l.address || job.found.address || l.city || "",
      phone: job.ocrForm.phone || l.phone || "", website: completeWebsite(job.ocrForm.website, l.website, cand.sure),
      email: job.ocrForm.email || l.email || "",
    });
  } catch (_) { /* Kreisdaten fehlen – Formular bleibt wie erkannt */ }
}

function updateJobProgress(job) {
  const el = document.querySelector(`[data-job="${job.key}"] .progress`);
  if (el) el.textContent = `Texterkennung (Durchgang ${job.pass || 1}/2) … ${job.progress} %`;
}

const catOptions = (sel) => `<option value="">– Branche wählen –</option>` + (state.meta.groups || [{ id: undefined, name: "" }]).map((g) =>
  `<optgroup label="${esc(g.name)}">${state.meta.categories.filter((c) => c.group === g.id).map((c) =>
    `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</optgroup>`).join("");
const kreisOptions = (sel) => state.meta.kreise.map((k) =>
  `<option value="${k.ags}" ${k.ags === sel ? "selected" : ""}>${esc(k.name)}</option>`).join("");

function jobHtml(job) {
  const img = job.thumb ? `<img src="${job.thumb}" alt="Foto">` : `<div class="ph"></div>`;
  if (job.status === "wait" || job.status === "ocr") {
    return `<div class="job" data-job="${job.key}">${img}<div class="job-body">
      <div class="progress">${job.status === "wait" ? "Wartet …" : `Texterkennung … ${job.progress || 0} %`}</div>
      <div class="hint">Beim ersten Foto wird die Texterkennung geladen (ca. 5 MB). Pro Foto dauert es einige Sekunden.</div></div></div>`;
  }
  if (job.status === "error") {
    return `<div class="job" data-job="${job.key}">${img}<div class="job-body">
      <div class="error">${esc(job.error)}</div><button data-drop="${job.key}">Entfernen</button></div></div>`;
  }
  const f = job.found;
  const chips = [...f.phones.map((p) => `☎ ${p}`), ...f.domains.map((d) => `🌐 ${d}`), ...f.emails.map((e) => `✉ ${e}`)]
    .map((c) => `<span class="badge topic">${esc(c)}</span>`).join("") || `<span class="sub">keine Telefonnummer/Website erkannt</span>`;
  const cands = job.candidates.map((c) => `<label class="check"><input type="radio" name="m-${job.key}" value="${esc(c.id)}" ${job.match === c.id ? "checked" : ""}>
      <span><b>${esc(c.name)}</b> <span class="sub">${esc(kreisName(c.kreis))} · erkannt über ${c.why.join(" + ")}${c.sure ? "" : " – bitte prüfen"}</span></span></label>`).join("");
  const v = job.form;
  return `<div class="job" data-job="${job.key}">${img}<div class="job-body">
    <div class="found">${chips}</div>
    <div class="cands">
      <div class="label">${job.candidates.length ? "Passende Betriebe in deinen Daten" : "Kein passender Betrieb in den Daten gefunden – bitte Angaben prüfen"}</div>
      ${!job.searchedAll && !job.candidates.some((c) => c.sure) ? `<button data-everywhere="${job.key}" ${job.searching ? "disabled" : ""}>${job.searching ? "Suche in allen Kreisen …" : "In allen Kreisen suchen"}</button>` : ""}
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
    ${impressumHint(job)}
    <details><summary>Erkannter Text</summary><pre>${esc(job.text) || "–"}</pre></details>
    <div class="job-actions">
      <button class="pitch-btn" data-keep="${job.key}">Als eigenen Lead speichern</button>
      <button data-drop="${job.key}">Verwerfen</button>
    </div>
  </div></div>`;
}

function renderQueue() {
  updateQueueBadge();
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
      else { job.match = ""; job.lead = null; job.form = { ...job.ocrForm }; }
      renderQueue();
    }));
  });
  el.querySelectorAll("[data-drop]").forEach((b) => (b.onclick = () => {
    state.queue = state.queue.filter((j) => j.key !== b.dataset.drop);
    renderQueue();
  }));
  el.querySelectorAll("[data-keep]").forEach((b) => (b.onclick = () => keepJob(b.dataset.keep, b)));
  el.querySelectorAll("[data-everywhere]").forEach((b) => (b.onclick = () =>
    searchEverywhere(state.queue.find((j) => j.key === b.dataset.everywhere))));
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

// ---------- Foto-Ordner auf dem PC (Edge/Chrome: File System Access API) ----
// Neue Fotos werden beim Öffnen der Seite eingelesen und danach in den
// Unterordner "eingelesen" verschoben. Der Ordner-Zugriff wird im Browser
// gespeichert (IndexedDB), die Fotos verlassen den Rechner nicht.
const FOLDER_DONE = "eingelesen";
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const folder = { handle: null, busy: false, inFlight: new Set() };

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("leadgenerator", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const idbGet = (key) => idb("readonly", (s) => s.get(key)).catch(() => null);
const idbSet = (key, value) => idb("readwrite", (s) => (value === undefined ? s.delete(key) : s.put(value, key))).catch(() => {});

function folderStatus(text) {
  $("#folder-status").textContent = text;
  $("#folder-actions").hidden = !folder.handle;
  $("#folder-connect").textContent = folder.handle ? "📁 Anderen Ordner wählen" : "📁 Ordner verbinden";
}

async function folderPermission(ask) {
  if (!folder.handle) return false;
  const opts = { mode: "readwrite" };
  if (await folder.handle.queryPermission(opts) === "granted") return true;
  return ask ? (await folder.handle.requestPermission(opts)) === "granted" : false;
}

async function connectFolder() {
  try {
    folder.handle = await window.showDirectoryPicker({ id: "leadgen-fotos", mode: "readwrite" });
  } catch (_) {
    return; // abgebrochen
  }
  await idbSet("folder", folder.handle);
  scanFolder(true);
}

async function disconnectFolder() {
  folder.handle = null;
  await idbSet("folder", undefined);
  folderStatus("Kein Ordner verbunden.");
}

async function scanFolder(ask = false) {
  if (!folder.handle || folder.busy) return;
  if (!(await folderPermission(ask))) {
    folderStatus(`Ordner „${folder.handle.name}“: Zugriff muss bestätigt werden – auf „Ordner jetzt prüfen“ klicken.`);
    return;
  }
  folder.busy = true;
  try {
    const files = [], entries = [];
    for await (const entry of folder.handle.values()) {
      if (entry.kind !== "file" || !IMAGE_RE.test(entry.name) || folder.inFlight.has(entry.name)) continue;
      folder.inFlight.add(entry.name);
      files.push(await entry.getFile());
      entries.push(entry);
    }
    const heic = [];
    for await (const entry of folder.handle.values()) if (entry.kind === "file" && /\.hei[cf]$/i.test(entry.name)) heic.push(entry.name);
    folderStatus(`Verbunden: „${folder.handle.name}“ · zuletzt geprüft ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
      + (files.length === 1 ? " · 1 neues Foto" : files.length ? ` · ${files.length} neue Fotos` : " · keine neuen Fotos")
      + (heic.length ? ` · ${heic.length} HEIC-Fotos können nicht gelesen werden (am iPhone: Einstellungen → Kamera → Formate → „Maximale Kompatibilität“)` : ""));
    if (files.length) {
      addPhotos(files, { scroll: false, folderEntries: entries });
      message(`${files.length === 1 ? "1 neues Foto" : `${files.length} neue Fotos`} aus dem Ordner „${folder.handle.name}“ werden eingelesen – zur Prüfung im Reiter „Eigene Leads“.`, true);
    }
  } catch (err) {
    folderStatus(`Ordner konnte nicht gelesen werden: ${err.message}`);
  } finally {
    folder.busy = false;
  }
}

// Eingelesenes Foto in den Unterordner "eingelesen" verschieben (nicht löschen)
async function moveToDone(job) {
  try {
    const done = await folder.handle.getDirectoryHandle(FOLDER_DONE, { create: true });
    let name = job.fileName;
    try { await done.getFileHandle(name); name = name.replace(/(\.\w+)$/, `_${Date.now()}$1`); } catch (_) { /* frei */ }
    if (job.entry.move) {
      try { await job.entry.move(done, name); job.moved = true; return; } catch (_) { /* Fallback unten */ }
    }
    const file = await job.entry.getFile();
    const target = await done.getFileHandle(name, { create: true });
    const out = await target.createWritable();
    await out.write(file);
    await out.close();
    await folder.handle.removeEntry(job.fileName);
    job.moved = true;
  } catch (err) {
    job.moveError = err.message;
  } finally {
    folder.inFlight.delete(job.fileName);
  }
}

function updateQueueBadge() {
  const btn = document.querySelector('#tabs button[data-tab="eigene"]');
  if (!btn) return;
  const open = state.queue.length;
  btn.textContent = open ? `Eigene Leads (${open})` : "Eigene Leads";
}

async function initFolder() {
  if (!window.showDirectoryPicker) {
    $("#folder-box").hidden = true;
    return;
  }
  $("#folder-connect").onclick = connectFolder;
  $("#folder-scan").onclick = () => scanFolder(true);
  $("#folder-disconnect").onclick = disconnectFolder;
  folder.handle = await idbGet("folder");
  if (!folder.handle) return folderStatus("Kein Ordner verbunden.");
  await scanFolder(false);
  setInterval(() => document.visibilityState === "visible" && scanFolder(false), 10 * 60 * 1000);
}

function initEigene() {
  initFolder();
  state.eigene = load("eigene", {});
  const input = $("#photo-input");
  input.onchange = () => { addPhotos([...input.files]); input.value = ""; };
  const drop = $("#photo-drop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addPhotos([...e.dataTransfer.files]); };
}
