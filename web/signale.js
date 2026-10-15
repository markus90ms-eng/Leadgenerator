"use strict";
// ---------- Unternehmensgröße, Ampel, Nachschlage-Links und Mail ----------
// Alles geschätzt aus öffentlichen Signalen: Rechtsform (Name/Impressum),
// Anzahl Standorte (gleiche Website), Website-Check (Stellen, Shop, Kapital …).

const LEGAL_SIZE = { "AG": 3, "SE": 3, "KGaA": 3, "AG & Co. KG": 3, "GmbH & Co. KG": 2, "GmbH": 1, "gGmbH": 1,
  "KG": 1, "OHG": 1, "eG": 1, "UG": 0, "e.K.": 0, "GbR": 0, "e.V.": 0 };

function sizeClass(l) {
  const ws = l.ws || {};
  const rf = ws.rf || l.rf || "";
  const why = [];
  let pts = 0;
  if (rf) { pts += LEGAL_SIZE[rf] ?? 0; why.push(`Rechtsform ${rf}`); }
  if (l.st >= 10) { pts += 3; why.push(`${l.st} Standorte`); }
  else if (l.st >= 3) { pts += 2; why.push(`${l.st} Standorte`); }
  else if (l.st === 2) { pts += 1; why.push("2 Standorte"); }
  if (ws.kap >= 1000000) { pts += 2; why.push(`Kapital ${fmtEuro(ws.kap)}`); }
  else if (ws.kap >= 100000) { pts += 1; why.push(`Kapital ${fmtEuro(ws.kap)}`); }
  if (ws.jobs >= 5) { pts += 1; why.push(`${ws.jobs} offene Stellen`); }
  if (ws.std) { pts += 1; why.push("nennt mehrere Standorte"); }
  const cls = pts >= 4 ? "L" : pts >= 1 ? "M" : "S";
  if (!why.length) why.push("keine Angaben – vermutlich klein");
  return { cls, rank: { S: 1, M: 2, L: 3 }[cls], why };
}

function fmtEuro(n) {
  return n >= 1000000 ? `${(n / 1000000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Mio. €` : `${n.toLocaleString("de-DE")} €`;
}

// Ampel: Wie aktiv ist der Betrieb und gibt er Geld aus? (grün = gute Chancen)
function ampel(l, reason, size) {
  const ws = l.ws || {};
  const parts = [];
  if (ws.jobs) parts.push([2, `sucht Personal (${ws.jobs} Stellen)`]);
  else if (ws.kar) parts.push([1, "Karriereseite / sucht Personal"]);
  if (ws.shop) parts.push([1, "Online-Shop"]);
  if (ws.soc) parts.push([1, "aktiv in Social Media"]);
  if (size.cls === "L") parts.push([2, "größeres Unternehmen"]);
  else if (size.cls === "M") parts.push([1, "mittleres Unternehmen"]);
  if (l.st >= 2) parts.push([1, "mehrere Standorte"]);
  if (l.website) parts.push([1, "eigene Website"]);
  if (l.phone || l.email) parts.push([1, "erreichbar"]);
  if (reason) parts.push([1, "neu am Markt"]);
  if (l.u) parts.push([-1, "unsicherer Eintrag"]);
  if (!l.phone && !l.email && !l.website) parts.push([-2, "keine Kontaktdaten"]);
  const pts = parts.reduce((s, [p]) => s + p, 0);
  const color = pts >= 5 ? "g" : pts >= 3 ? "y" : "r";
  return { color, pts, why: parts.map(([p, w]) => `${p > 0 ? "+" : ""}${p} ${w}`) };
}

const AMPEL_LABEL = { g: "grün – gute Chancen", y: "gelb – prüfen", r: "rot – wenig Signale" };

function ampelHtml(l) {
  const tip = `${AMPEL_LABEL[l.ampel]}\n${l.ampel_why.join("\n")}\n\nGröße ${l.size} (geschätzt): ${l.size_why.join(", ")}`
    + (l.ws ? "" : "\nWebsite noch nicht geprüft");
  return `<span class="ampel" title="${esc(tip)}"><span class="dot ${l.ampel}"></span><span class="size">${l.size}</span></span>`;
}

function signalText(l) {
  const ws = l.ws || {};
  return [
    `Größe ${l.size} (geschätzt: ${l.size_why.join(", ")})`,
    ws.jobs ? `${ws.jobs} offene Stellen auf der Website` : ws.kar ? "hat eine Karriere-/Jobseite" : "",
    ws.shop ? "betreibt einen Online-Shop" : "",
    ws.soc ? "ist in Social Media aktiv" : "",
    l.st >= 2 ? `${l.st} Standorte mit gleicher Website` : "",
  ].filter(Boolean).join("; ");
}

// ---------- Nachschlagen ---------------------------------------------------
function lookupLinks(l) {
  const ort = l.city || (l.address || "").replace(/^.*\d{5}\s*/, "") || "";
  const q = encodeURIComponent;
  return `<div class="lookup">
    <a href="https://www.google.com/search?q=${q(`site:northdata.de "${l.name}" ${ort}`)}" target="_blank" rel="noopener" title="Umsatz, Mitarbeiter, Kapital bei North Data">North Data</a>
    <a href="https://www.handelsregister.de/rp_web/normalesuche.xhtml" target="_blank" rel="noopener" data-copy="${esc(l.name)}" title="Öffnet die Registersuche; der Firmenname wird kopiert">Register</a>
    <a href="https://www.arbeitsagentur.de/jobsuche/suche?angebotsart=1&was=${q(l.name)}&wo=${q(ort)}" target="_blank" rel="noopener" title="Offene Stellen in der Jobbörse">Jobs</a>
  </div>`;
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-copy]");
  if (!a) return;
  navigator.clipboard?.writeText(a.dataset.copy).catch(() => {});
  message(`„${a.dataset.copy}“ kopiert – in der Registersuche ins Feld „Firma“ einfügen (Strg+V).`, true);
});

// ---------- Mail (Outlook) ------------------------------------------------
const MAIL_TEMPLATES = {
  telefonat: "Nach dem Telefonat",
  termin: "Terminbestätigung",
  unterlagen: "Unterlagen wie besprochen",
};

function titleCase(s) {
  return String(s || "").toLowerCase().replace(/(^|[\s\-/(])([a-zäöü])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\bStr\b/g, "Str.");
}

function nextWeekdays(n = 2) {
  const days = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (out.length < n) {
    if (d.getDay() >= 1 && d.getDay() <= 5) out.push(days[d.getDay()]);
    d.setDate(d.getDate() + (out.length ? 2 : 1));
  }
  return out;
}

function mailText(l, opt) {
  const ort = leadCity(l);
  const anrede = opt.anrede === "Frau" && opt.name ? `Sehr geehrte Frau ${opt.name},`
    : opt.anrede === "Herr" && opt.name ? `Sehr geehrter Herr ${opt.name},` : "Sehr geehrte Damen und Herren,";
  const flaechen = (l.near?.items || []).slice(0, 3).map((i) =>
    `- ${mediaName(i.typ)}, ${titleCase(i.standort)}, ca. ${Math.round(i.dist / 10) * 10} m von Ihnen entfernt`);
  const flaechenText = flaechen.length
    ? `In direkter Nähe zu ${l.name} gibt es aktuell folgende Möglichkeiten:\n${flaechen.join("\n")}`
    : `Passende Flächen in ${ort} stelle ich Ihnen gern vor – klassisch als Plakat oder digital.`;
  const partner = `Wir haben den Stadtvertrag mit ${vertragspartner(l.kreis)} und vergeben unsere Werbeflächen derzeit neu. `
    + "Dabei möchten wir gezielt den Klein- und Mittelstand fördern.";
  const gruss = "Mit freundlichen Grüßen\nMarkus Schultheiß\nStröer AG";
  const [t1, t2] = nextWeekdays();
  if (opt.vorlage === "termin") {
    const datum = opt.datum ? new Date(opt.datum + "T12:00").toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }) : "[Datum]";
    return {
      subject: `Terminbestätigung ${opt.datum ? fmtDate(opt.datum) : ""} – Ströer Außenwerbung`.replace("  ", " "),
      body: `${anrede}\n\nvielen Dank für das freundliche Gespräch. Hiermit bestätige ich gern unseren Termin am ${datum}`
        + `${opt.zeit ? ` um ${opt.zeit} Uhr` : ""}${opt.ort ? ` (${opt.ort})` : ""}.\n\n`
        + `${flaechen.length ? `Ich bringe Ihnen die Standorte in Ihrer Nähe mit, unter anderem:\n${flaechen.join("\n")}\n\n` : ""}`
        + "Sollte etwas dazwischenkommen, erreichen Sie mich jederzeit per E-Mail oder telefonisch.\n\n"
        + `Ich freue mich auf unser Gespräch.\n\n${gruss}`,
    };
  }
  if (opt.vorlage === "unterlagen") {
    return {
      subject: `Unterlagen wie besprochen – Ströer Außenwerbung in ${ort}`,
      body: `${anrede}\n\nwie besprochen erhalten Sie anbei unsere Unterlagen zu den Werbemöglichkeiten in ${ort}.\n\n`
        + `${partner}\n\n${flaechenText}\n\n`
        + `Gern bespreche ich die Möglichkeiten mit Ihnen in einem kurzen Termin. Passt Ihnen ${t1} oder ${t2}?\n\n${gruss}`,
    };
  }
  return {
    subject: `Ihre Werbung in ${ort} – Ströer-Flächen in Ihrer Nähe`,
    body: `${anrede}\n\nvielen Dank für das freundliche Telefonat eben. Wie besprochen sende ich Ihnen gern die Informationen zu.\n\n`
      + `${partner}\n\n${flaechenText}\n\n`
      + `Gern zeige ich Ihnen in einem kurzen Termin, wie Sie damit Ihre Kunden direkt vor der Haustür erreichen. `
      + `Passt Ihnen dafür ${t1} oder ${t2}?\n\n${gruss}`,
  };
}

let mailLead = null;
function openMail(l) {
  mailLead = l;
  const dlg = $("#mail-dialog");
  const c = pipeEntry(l)?.contact || {};
  $("#mail-to").value = l.email || "";
  $("#mail-anrede").value = c.anrede || "";
  $("#mail-name").value = c.name || "";
  $("#mail-vorlage").value = load("mailVorlage", "telefonat");
  $("#mail-firma").textContent = l.name;
  updateMailPreview();
  dlg.showModal();
}

function mailOptions() {
  return { anrede: $("#mail-anrede").value, name: $("#mail-name").value.trim(), vorlage: $("#mail-vorlage").value,
    datum: $("#mail-datum").value, zeit: $("#mail-zeit").value, ort: $("#mail-ort").value.trim() };
}

function updateMailPreview() {
  const opt = mailOptions();
  $("#mail-termin").hidden = opt.vorlage !== "termin";
  $("#mail-anhang").hidden = opt.vorlage !== "unterlagen";
  const { subject, body } = mailText(mailLead, opt);
  $("#mail-subject").value = subject;
  $("#mail-body").value = body;
}

function sendMail() {
  const opt = mailOptions();
  const to = $("#mail-to").value.trim();
  const subject = $("#mail-subject").value;
  const body = $("#mail-body").value;
  // Ansprechpartner am Lead merken (landet damit auch in der Pipeline)
  if (opt.name) save(mailLead, { contact: { anrede: opt.anrede, name: opt.name } });
  store("mailVorlage", opt.vorlage);
  navigator.clipboard?.writeText(body).catch(() => {});
  const url = `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(body.replace(/\n/g, "\r\n"))}`;
  window.location.href = url;
  $("#mail-dialog").close();
  message(url.length > 1900
    ? "Outlook wird geöffnet. Der Text ist lang – falls er abgeschnitten ist: Er liegt in der Zwischenablage (Strg+V)."
    : "Outlook wird geöffnet. Der Text liegt zusätzlich in der Zwischenablage.", true);
}

function initMail() {
  ["#mail-anrede", "#mail-name", "#mail-vorlage", "#mail-datum", "#mail-zeit", "#mail-ort"].forEach((id) =>
    $(id).addEventListener("input", updateMailPreview));
  $("#mail-send").onclick = (e) => { e.preventDefault(); sendMail(); };
  $("#mail-copy").onclick = (e) => {
    e.preventDefault();
    navigator.clipboard?.writeText(`${$("#mail-subject").value}\n\n${$("#mail-body").value}`).catch(() => {});
    $("#mail-copy").textContent = "✓ Kopiert";
    setTimeout(() => ($("#mail-copy").textContent = "Text kopieren"), 1500);
  };
  $("#mail-cancel").onclick = (e) => { e.preventDefault(); $("#mail-dialog").close(); };
}

// ---------- Gruppen (gleiche Firmen-Website, über alle Kreise) -------------
const groupShard = (key) => ([...new TextEncoder().encode(key)].reduce((a, b) => a + b, 0) % 16).toString(16);
const groupFiles = {};
const groupData = {};

async function loadGroup(key) {
  if (groupData[key]) return groupData[key];
  const shard = groupShard(key);
  groupFiles[shard] ||= getJson(`data/gruppen/${shard}.json`).catch(() => ({}));
  groupData[key] = (await groupFiles[shard])[key] || null;
  return groupData[key];
}

function groupBadge(l) {
  if (!l.grp) return "";
  const p = state.pipeline["grp:" + l.grp];
  return `<button class="grp-btn${state.openGroup === l.id ? " open" : ""}" data-grp="${esc(l.id)}" title="Alle Standorte der Gruppe zeigen">`
    + `Gruppe ${esc(l.gn || l.grp)} · ${l.st} Standorte${l.go > 1 ? ` in ${l.go} Orten` : ""}</button>`
    + (l.grp_here > 1 ? `<span class="badge chain">${l.grp_here} davon in dieser Liste</span>` : "")
    + (l.st >= 20 || l.gz ? `<span class="badge ${l.gz ? "imp" : "chain"}" title="${l.gz ? "Zentrale laut Impressum der Website – dort fällt vermutlich die Entscheidung" : "Viele Standorte – Werbung wird vermutlich zentral entschieden"}">`
      + `${l.st >= 20 ? "zentral gesteuert" : "Zentrale"}${l.gz ? `: ${esc(l.gz)}${l.gzk && l.gzk !== l.kreis ? ` (${esc(kreisName(l.gzk))})` : ""}` : ""}</span>` : "")
    + (p && state.tab !== "pipeline" && p.status !== "neu"
      ? `<span class="badge fresh" title="Status gilt für alle Standorte der Gruppe">Gruppe: ${esc(STATUS_LABELS[p.status] || p.status)} ${fmtDate((p.updated || "").slice(0, 10))}</span>` : "");
}

async function toggleGroup(l) {
  if (state.openGroup === l.id) { state.openGroup = null; return render(); }
  state.openGroup = l.id;
  await loadGroup(l.grp);
  render();
}

function groupDetailHtml(l, colspan) {
  const g = groupData[l.grp];
  if (!g) return `<tr class="near-detail"><td colspan="${colspan}"><div class="near-box">Gruppe wird geladen …</div></td></tr>`;
  const here = $("#kreis").value;
  const members = [...g.members].sort((a, b) =>
    (b[3] === here) - (a[3] === here) || kreisName(a[3]).localeCompare(kreisName(b[3]), "de") || a[2].localeCompare(b[2], "de"));
  const kreise = Object.entries(g.kreise).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${kreisName(a)} (${n})`).join(", ");
  const items = members.map(([id, name, city, ags, phone, address, unsure]) => `<li>
      <span class="dist">${esc(city || "")}</span>
      <span class="where"><b>${esc(name)}</b>${unsure ? ' <span class="sub">(unsicher)</span>' : ""}<span class="sub"> · ${esc(address || kreisName(ags))} · ${esc(kreisName(ags))}</span></span>
      <span class="links">${phone ? `<a href="tel:${esc(phone)}">${phone === g.zentrale ? "★ " : ""}${esc(fmtPhone(phone))}</a>` : ""}</span>
    </li>`).join("");
  return `<tr class="near-detail"><td colspan="${colspan}"><div class="near-box">
    <div class="near-head">
      <b>Gruppe ${esc(g.name)}: ${g.n} Standorte in ${g.orte} Orten</b>
      ${g.zentrale ? `<span>Vermutlich Zentrale: <a href="tel:${esc(g.zentrale)}">★ ${esc(fmtPhone(g.zentrale))}</a></span>` : ""}
    </div>
    ${g.imp ? `<div class="grp-imp"><b>Zentrale laut Impressum:</b> ${esc(impressumText(g.imp))}${g.imp.k ? ` · ${esc(kreisName(g.imp.k))}` : ""}</div>` : `<div class="sub">Zentrale laut Impressum: noch nicht geprüft (wird nachts erfasst)</div>`}
    <div class="sub">Kreise: ${esc(kreise)} · Status, Notiz und Ansprechpartner gelten für die ganze Gruppe.</div>
    <ul class="near-list grp-list">${items}</ul>
  </div></td></tr>`;
}

// Eine Zeile pro Gruppe (die erste nach der aktuellen Sortierung)
function collapseGroups(rows) {
  const seen = new Map();
  const out = [];
  for (const l of rows) {
    if (!l.grp) { out.push(l); continue; }
    if (seen.has(l.grp)) { seen.get(l.grp).grp_here += 1; continue; }
    const first = { ...l, grp_here: 1 };
    seen.set(l.grp, first);
    out.push(first);
  }
  return out;
}

// ---------- Impressum ------------------------------------------------------
const impressumText = (imp) => [imp.f, imp.s, [imp.p, imp.o].filter(Boolean).join(" "), imp.t ? `Tel. ${imp.t}` : "", imp.r]
  .filter(Boolean).join(", ");

function impressumBadge(l) {
  const imp = l.ws?.imp;
  if (!imp) return "";
  const tip = esc(`Laut Impressum der Website:\n${impressumText(imp).replace(/, /g, "\n")}`);
  const plz = (l.address || "").match(/\b\d{5}\b/)?.[0];
  if (imp.p && plz && imp.p !== plz) {
    return `<span class="badge imp" title="${tip}">Sitz laut Impressum: ${esc(imp.o || imp.p)}</span>`;
  }
  return `<span class="badge imp ok" title="${tip}">✓ Impressum</span>`;
}

// Kreis des Firmensitzes bzw. der Gruppen-Zentrale (laut Impressum)
const sitzKreis = (l) => l.ws?.imp?.k || l.gzk || "";
function sitzMatches(l, mode) {
  if (!mode) return true;
  const known = l.ws?.imp || l.gz;
  if (mode === "bekannt") return !!known;
  const k = sitzKreis(l);
  if (!k) return false;
  const here = state.tab === "pipeline" || state.tab === "eigene" ? l.kreis : $("#kreis").value;
  return mode === "hier" ? k === here : k !== here;
}
