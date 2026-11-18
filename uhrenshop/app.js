/* CHRONOS & CO. – Luxusuhren-Shop (statisch, ohne Abhängigkeiten)
   Produkte unten sind Beispieldaten – einfach durch echte Bestände ersetzen. */
const PRODUCTS = [
  {id:1, brand:"Patek Philippe", name:"Grand Complications Celestial", ref:"6102P-001", year:2013, price:335500, material:"Platin", dial:"Blau", set:"Box & Papiere", cond:"Sehr gut", style:{case:"#d9dde2",dial:"#14213d",strap:"#1b1b1f",ind:"#e8e8ee",type:"strap"}, isNew:true},
  {id:2, brand:"Patek Philippe", name:"Nautilus Chronograph", ref:"5980R-001", year:2013, price:100990, material:"Roségold", dial:"Braun", set:"Unworn, nach PP-Service", cond:"Ungetragen", style:{case:"#c98f6b",dial:"#5a3a2b",strap:"#c98f6b",ind:"#f3dcc9",type:"bracelet",chrono:true}, isNew:true},
  {id:3, brand:"Patek Philippe", name:"Nautilus Damen", ref:"7010R-013", year:2025, price:75990, material:"Roségold", dial:"Violett", set:"Box & Papiere", cond:"Ungetragen", style:{case:"#c98f6b",dial:"#5b3a7a",strap:"#c98f6b",ind:"#f3dcc9",type:"bracelet",bezelGem:true}},
  {id:4, brand:"Audemars Piguet", name:"Royal Oak Offshore T3 Chronograph", ref:"26215BC", year:2014, price:240990, material:"Weißgold", dial:"Schwarz", set:"Factory Diamond Set", cond:"Sehr gut", style:{case:"#e3e5e8",dial:"#16161a",strap:"#e3e5e8",ind:"#fff",type:"bracelet",chrono:true,bezelGem:true}},
  {id:5, brand:"Audemars Piguet", name:"Code 11.59 Green Dial", ref:"15210ST", year:2022, price:16990, material:"Edelstahl", dial:"Grün", set:"Box & Papiere", cond:"Sehr gut", style:{case:"#cfd3d8",dial:"#2f5d4a",strap:"#1d2a24",ind:"#eef3ee",type:"strap"}, isNew:true},
  {id:6, brand:"Rolex", name:"Daytona Rainbow", ref:"116598RBOW", year:2017, price:335990, material:"Gelbgold", dial:"Schwarz", set:"Ungetragen", cond:"Ungetragen", style:{case:"#d9b04a",dial:"#101012",strap:"#d9b04a",ind:"#f6e3a8",type:"bracelet",chrono:true,bezelGem:true}},
  {id:7, brand:"Rolex", name:"Cosmograph Daytona Meteorit", ref:"116509", year:2022, price:95990, material:"Weißgold", dial:"Meteorit", set:"Box & Papiere", cond:"Sehr gut", style:{case:"#e1e3e6",dial:"#7a7d83",strap:"#e1e3e6",ind:"#fff",type:"bracelet",chrono:true}},
  {id:8, brand:"Rolex", name:"Day-Date 40 Diamant-Indizes", ref:"228349RBR", year:2024, price:54990, material:"Weißgold", dial:"Meteorit", set:"Box & Papiere", cond:"Neuwertig", style:{case:"#e1e3e6",dial:"#6c6f75",strap:"#e1e3e6",ind:"#fff",type:"bracelet"}, isNew:true},
  {id:9, brand:"Rolex", name:"Daytona Zenith", ref:"16520", year:1998, price:24990, material:"Edelstahl", dial:"Weiß", set:"Vintage", cond:"Gut", style:{case:"#c9cdd2",dial:"#f2efe8",strap:"#c9cdd2",ind:"#1a1a1a",type:"bracelet",chrono:true,darkInd:true}},
  {id:10, brand:"Rolex", name:"Sky-Dweller Stahl/Gold", ref:"326933", year:2021, price:16990, material:"Stahl/Gold", dial:"Schwarz", set:"Box & Papiere", cond:"Sehr gut", style:{case:"#cdb27a",dial:"#121214",strap:"#c4c8cd",ind:"#f3e6c0",type:"bracelet"}},
  {id:11, brand:"Rolex", name:"Milgauss Label Noir Rainbow", ref:"116400GV", year:2023, price:28490, material:"Stahl, PVD", dial:"Schwarz", set:"Custom", cond:"Sehr gut", style:{case:"#2a2a2e",dial:"#0e0e10",strap:"#2a2a2e",ind:"#d8d8dd",type:"bracelet",bezelGem:true}},
  {id:12, brand:"Richard Mille", name:"RM 030 Titan", ref:"RM030 Ti", year:2014, price:145990, material:"Titan", dial:"Skelett", set:"RM-Service 08/26", cond:"Sehr gut", style:{case:"#8e949c",dial:"#2b2f36",strap:"#e8e8e8",ind:"#fff",type:"strap",skeleton:true}}
];

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const eur = n => new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- Uhr als SVG ---------- */
function watchSVG(s, time=[10,10,36]) {
  const {case:c, dial:d, strap:b, ind, type, chrono, bezelGem, skeleton, darkInd} = s;
  const cx = 100, cy = 130;
  const [h, m] = time;
  const hAng = (h % 12 + m/60) * 30, mAng = m * 6;
  let marks = "";
  for (let i = 0; i < 12; i++) {
    const a = i * 30 * Math.PI/180, r1 = 52, r2 = i % 3 === 0 ? 43 : 47;
    marks += `<line x1="${cx+Math.sin(a)*r1}" y1="${cy-Math.cos(a)*r1}" x2="${cx+Math.sin(a)*r2}" y2="${cy-Math.cos(a)*r2}" stroke="${ind}" stroke-width="${i%3===0?2.4:1.4}" stroke-linecap="round"/>`;
  }
  let gems = "";
  if (bezelGem) {
    const cols = ["#e84a5f","#ff9a3c","#f9d423","#3ccf91","#3aa0ff","#8e6bff"];
    for (let i = 0; i < 24; i++) {
      const a = i * 15 * Math.PI/180;
      gems += `<circle cx="${cx+Math.sin(a)*60}" cy="${cy-Math.cos(a)*60}" r="2.4" fill="${cols[i%cols.length]}" stroke="#fff" stroke-opacity=".5" stroke-width=".4"/>`;
    }
  }
  const links = type === "bracelet"
    ? [0,1,2,3].map(i => `<rect x="76" y="${i*0+0}" width="48" height="0"/>`).join("") +
      `<g fill="${b}" stroke="rgba(0,0,0,.25)" stroke-width=".8">
        ${[8,26,44,62].map(y=>`<rect x="76" y="${y}" width="48" height="16" rx="2"/>`).join("")}
        ${[204,222,240].map(y=>`<rect x="76" y="${y}" width="48" height="16" rx="2"/>`).join("")}
       </g>
       <g stroke="rgba(0,0,0,.15)" stroke-width=".6">${[8,26,44,62,204,222,240].map(y=>`<line x1="100" y1="${y}" x2="100" y2="${y+16}"/>`).join("")}</g>`
    : `<g fill="${b}" stroke="rgba(0,0,0,.3)" stroke-width=".8">
        <path d="M80 2 H120 L124 72 H76 Z"/><path d="M76 188 H124 L120 258 H80 Z"/></g>
       <g stroke="rgba(255,255,255,.25)" stroke-width=".8" stroke-dasharray="3 3"><path d="M84 6 L86 70"/><path d="M116 6 L114 70"/><path d="M86 192 L84 254"/><path d="M114 192 L116 254"/></g>`;
  const hand = darkInd ? "#1a1a1a" : "#f4f1e8";
  const sub = chrono ? `
    <circle cx="${cx-18}" cy="${cy}" r="11" fill="none" stroke="${ind}" stroke-opacity=".6" stroke-width=".8"/>
    <circle cx="${cx+18}" cy="${cy}" r="11" fill="none" stroke="${ind}" stroke-opacity=".6" stroke-width=".8"/>
    <circle cx="${cx}" cy="${cy+20}" r="11" fill="none" stroke="${ind}" stroke-opacity=".6" stroke-width=".8"/>` : "";
  const skel = skeleton ? `
    <circle cx="${cx-14}" cy="${cy+8}" r="14" fill="none" stroke="#c7ccd4" stroke-width="1.5"/>
    <circle cx="${cx+16}" cy="${cy-10}" r="10" fill="none" stroke="#c7ccd4" stroke-width="1.5"/>
    <circle cx="${cx-14}" cy="${cy+8}" r="3" fill="#c7ccd4"/>` : "";
  return `<svg viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Armbanduhr">
    ${links}
    <rect x="152" y="120" width="7" height="20" rx="2" fill="${c}" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>
    <circle cx="${cx}" cy="${cy}" r="70" fill="${c}" stroke="rgba(0,0,0,.4)" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="66" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="56" fill="${d}" stroke="rgba(0,0,0,.5)" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="56" fill="url(#g)" opacity=".35"/>
    ${gems}${skel}${marks}${sub}
    <line x1="${cx}" y1="${cy}" x2="${cx+Math.sin(hAng*Math.PI/180)*28}" y2="${cy-Math.cos(hAng*Math.PI/180)*28}" stroke="${hand}" stroke-width="3.2" stroke-linecap="round"/>
    <line x1="${cx}" y1="${cy}" x2="${cx+Math.sin(mAng*Math.PI/180)*42}" y2="${cy-Math.cos(mAng*Math.PI/180)*42}" stroke="${hand}" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="3.2" fill="${hand}"/>
    <defs><radialGradient id="g" cx=".3" cy=".25" r=".9"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
  </svg>`;
}

/* ---------- State ---------- */
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } },
  set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let wish = store.get("cc_wish");
let cart = store.get("cc_cart");
const state = {brand:"Alle", price:"all", sort:"new", q:""};

/* ---------- Grid ---------- */
const brands = ["Alle", ...new Set(PRODUCTS.map(p => p.brand))];
function renderChips() {
  $("#brandChips").innerHTML = brands.map(b => `<button class="chip ${b===state.brand?"active":""}" data-brand="${esc(b)}">${esc(b)}</button>`).join("");
}
function filtered() {
  let list = PRODUCTS.filter(p => state.brand === "Alle" || p.brand === state.brand);
  if (state.price !== "all") { const [lo,hi] = state.price.split("-").map(Number); list = list.filter(p => p.price >= lo && p.price < hi); }
  if (state.q) { const q = state.q.toLowerCase(); list = list.filter(p => `${p.brand} ${p.name} ${p.ref} ${p.material} ${p.dial}`.toLowerCase().includes(q)); }
  if (state.sort === "asc") list.sort((a,b)=>a.price-b.price);
  else if (state.sort === "desc") list.sort((a,b)=>b.price-a.price);
  else list.sort((a,b)=>b.id-a.id);
  return list;
}
function renderGrid() {
  const list = filtered();
  $("#resultCount").textContent = `${list.length} ${list.length===1?"Uhr":"Uhren"}`;
  $("#grid").innerHTML = list.length ? list.map(p => `
    <article class="card">
      ${p.isNew ? '<span class="tag">Neu</span>' : ""}
      <button class="heart ${wish.includes(p.id)?"on":""}" data-wish="${p.id}" aria-label="Merken">${wish.includes(p.id)?"♥":"♡"}</button>
      <div class="card-img" data-open="${p.id}">${watchSVG(p.style)}</div>
      <div class="card-body">
        <span class="brand">${esc(p.brand)}</span>
        <h3 class="title" data-open="${p.id}">${esc(p.name)}</h3>
        <span class="meta">${esc(p.material)} · Ref. ${esc(p.ref)} · ${p.year}</span>
        <span class="price">${eur(p.price)}</span>
        <button class="btn" data-add="${p.id}">Zur Anfrage</button>
      </div>
    </article>`).join("") : `<p class="empty">Keine Uhren gefunden. Passen Sie Ihre Filter an oder <a href="#kontakt"><u>fragen Sie uns direkt</u></a>.</p>`;
}

/* ---------- Drawer ---------- */
const overlay = $("#overlay");
function openDrawer(id){ closeAll(); $(id).classList.add("open"); overlay.classList.add("on"); }
function closeAll(){ $$(".drawer").forEach(d=>d.classList.remove("open")); $("#modal").classList.remove("open"); overlay.classList.remove("on"); }
const byId = id => PRODUCTS.find(p => p.id === id);

function row(p, extra) {
  return `<div class="row"><div class="thumb">${watchSVG(p.style)}</div>
    <div><div class="t"><b>${esc(p.brand)}</b><br>${esc(p.name)}</div><div class="p">${eur(p.price)}</div></div>${extra}</div>`;
}
function renderCart() {
  const items = cart.map(byId).filter(Boolean);
  $("#cartBody").innerHTML = items.length ? items.map(p => row(p, `<button class="rm" data-rmcart="${p.id}">Entfernen</button>`)).join("") : '<p class="empty-d">Ihre Anfrageliste ist leer.</p>';
  $("#cartTotal").textContent = eur(items.reduce((s,p)=>s+p.price,0));
  setBadge("#cartCount", items.length);
  $("#cartCheckout").disabled = !items.length;
}
function renderWish() {
  const items = wish.map(byId).filter(Boolean);
  $("#wishBody").innerHTML = items.length ? items.map(p => row(p, `<button class="rm" data-wish="${p.id}">Entfernen</button>`)).join("") : '<p class="empty-d">Ihre Merkliste ist leer.</p>';
  setBadge("#wishCount", items.length);
}
function setBadge(sel, n){ const b=$(sel); b.textContent=n; b.classList.toggle("on", n>0); }

function toggleWish(id){ wish = wish.includes(id) ? wish.filter(x=>x!==id) : [...wish,id]; store.set("cc_wish",wish); renderWish(); renderGrid(); }
function addCart(id){ if(!cart.includes(id)){ cart.push(id); store.set("cc_cart",cart); } renderCart(); openDrawer("#cartDrawer"); }
function rmCart(id){ cart = cart.filter(x=>x!==id); store.set("cc_cart",cart); renderCart(); }

/* ---------- Detail-Modal ---------- */
function openProduct(id) {
  const p = byId(id); if (!p) return;
  $("#modalCard").className = "modal-card";
  $("#modalCard").innerHTML = `
    <button class="icon-btn modal-x" data-close aria-label="Schließen">✕</button>
    <div class="m-img">${watchSVG(p.style)}</div>
    <div class="m-info">
      <span class="brand">${esc(p.brand)}</span>
      <h3>${esc(p.name)}</h3>
      <div class="m-price">${eur(p.price)}</div>
      <span class="m-note">inkl. gesetzl. MwSt. bzw. differenzbesteuert · versicherter Versand</span>
      <div class="specs">
        <div><span>Referenz</span><span>${esc(p.ref)}</span></div>
        <div><span>Baujahr</span><span>${p.year}</span></div>
        <div><span>Material</span><span>${esc(p.material)}</span></div>
        <div><span>Zifferblatt</span><span>${esc(p.dial)}</span></div>
        <div><span>Zustand</span><span>${esc(p.cond)}</span></div>
        <div><span>Lieferumfang</span><span>${esc(p.set)}</span></div>
      </div>
      <div class="m-actions">
        <button class="btn primary" data-add="${p.id}">Zur Anfrage</button>
        <button class="btn" data-ask="${p.id}">Frage stellen</button>
      </div>
    </div>`;
  $("#modal").classList.add("open"); overlay.classList.add("on");
}
function openText(title, text) {
  $("#modalCard").className = "modal-card text";
  $("#modalCard").innerHTML = `<button class="icon-btn modal-x" data-close aria-label="Schließen">✕</button><h3>${title}</h3><p>${text}</p>`;
  $("#modal").classList.add("open"); overlay.classList.add("on");
}
const LEGAL = {
  impressum: ["Impressum","Platzhalter: Bitte hier Firmenname, Anschrift, Vertretungsberechtigte, Kontakt, Handelsregister und USt-IdNr. gemäß § 5 DDG eintragen."],
  datenschutz: ["Datenschutz","Platzhalter: Bitte hier die Datenschutzerklärung gemäß DSGVO eintragen. Diese Demo speichert Merk- und Anfrageliste ausschließlich lokal im Browser."]
};

/* ---------- Events ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-brand],[data-wish],[data-add],[data-open],[data-rmcart],[data-close],[data-ask],[data-modal]");
  if (!t) return;
  if (t.dataset.brand) { state.brand = t.dataset.brand; renderChips(); renderGrid(); }
  else if (t.dataset.wish) toggleWish(+t.dataset.wish);
  else if (t.dataset.add) { $("#modal").classList.remove("open"); addCart(+t.dataset.add); }
  else if (t.dataset.open) openProduct(+t.dataset.open);
  else if (t.dataset.rmcart) rmCart(+t.dataset.rmcart);
  else if (t.dataset.ask) { const p = byId(+t.dataset.ask); closeAll(); $("#msgField").value = `Ich interessiere mich für: ${p.brand} ${p.name} (Ref. ${p.ref}).`; location.hash = "#kontakt"; }
  else if (t.dataset.modal) { e.preventDefault(); openText(...LEGAL[t.dataset.modal]); }
  else if (t.hasAttribute("data-close")) closeAll();
});
overlay.addEventListener("click", closeAll);
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeAll(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll(); });

$("#cartBtn").onclick = () => openDrawer("#cartDrawer");
$("#wishBtn").onclick = () => openDrawer("#wishDrawer");
$("#menuBtn").onclick = () => $("#nav").classList.toggle("open");
$$("#nav a").forEach(a => a.onclick = () => $("#nav").classList.remove("open"));
$("#searchBtn").onclick = () => { const s=$("#searchbar"); s.classList.toggle("open"); if (s.classList.contains("open")) $("#searchInput").focus(); };
$("#searchInput").oninput = e => { state.q = e.target.value.trim(); renderGrid(); };
$("#priceFilter").onchange = e => { state.price = e.target.value; renderGrid(); };
$("#sortSelect").onchange = e => { state.sort = e.target.value; renderGrid(); };

$("#cartCheckout").onclick = () => {
  const items = cart.map(byId).filter(Boolean);
  $("#msgField").value = "Ich interessiere mich unverbindlich für:\n" + items.map(p => `- ${p.brand} ${p.name} (Ref. ${p.ref}) – ${eur(p.price)}`).join("\n");
  closeAll(); location.hash = "#kontakt";
};
$("#contactForm").onsubmit = e => { e.preventDefault(); $("#formNote").hidden = false; e.target.reset(); };
$("#nlForm").onsubmit = e => { e.preventDefault(); e.target.innerHTML = "<p>Vielen Dank – Sie erhalten Ihren Gutschein per E-Mail (Demo).</p>"; };

/* ---------- Init ---------- */
$("#heroArt").innerHTML = watchSVG({case:"#d9b04a",dial:"#14213d",strap:"#d9b04a",ind:"#f6e3a8",type:"bracelet",chrono:true});
renderChips(); renderGrid(); renderCart(); renderWish();
