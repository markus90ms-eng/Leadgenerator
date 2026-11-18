/* ELYSION & CO. – gemeinsame Logik (Daten, Layout, Merkliste, Anfrageliste)
   Produkte = Beispieldaten. Echte Fotos: img/<id>-1.jpg, img/<id>-2.jpg … ablegen
   und beim Produkt photos: <Anzahl> setzen (siehe README). */
const SHOP = "ELYSION";
const BRANDS = [
  {slug:"rolex", name:"Rolex", city:"Genf", since:1905, text:"Das Synonym für die Armbanduhr: Oyster-Gehäuse, Perpetual-Rotor und Modelle, die Wertstabilität über Generationen bewiesen haben."},
  {slug:"patek-philippe", name:"Patek Philippe", city:"Genf", since:1839, text:"Die Manufaktur der großen Komplikationen. Jede Uhr trägt das Genfer Siegel und wird über Generationen weitergegeben."},
  {slug:"audemars-piguet", name:"Audemars Piguet", city:"Le Brassus", since:1875, text:"Erfinder der luxuriösen Sportuhr aus Edelstahl. Die Royal Oak prägt bis heute das Genre."},
  {slug:"richard-mille", name:"Richard Mille", city:"Les Breuleux", since:2001, text:"Rennwagen-Technik am Handgelenk: Titan, Karbon und Saphir in radikal moderner Architektur."}
];
const PRODUCTS = [
  {id:1, brand:"Patek Philippe", name:"Grand Complications Celestial", ref:"6102P-001", year:2013, price:335500, material:"Platin", dial:"Blau", size:"44 mm", movement:"Handaufzug", set:"Box & Papiere", cond:"Sehr gut", style:{case:"#d9dde2",dial:"#14213d",strap:"#1b1b1f",ind:"#e8e8ee",type:"strap"}, isNew:true},
  {id:2, brand:"Patek Philippe", name:"Nautilus Chronograph", ref:"5980R-001", year:2013, price:100990, material:"Roségold", dial:"Braun", size:"40,5 mm", movement:"Automatik", set:"Ungetragen, nach PP-Service", cond:"Ungetragen", style:{case:"#c98f6b",dial:"#5a3a2b",strap:"#c98f6b",ind:"#f3dcc9",type:"bracelet",chrono:true}, isNew:true},
  {id:3, brand:"Patek Philippe", name:"Nautilus Damen", ref:"7010R-013", year:2025, price:75990, material:"Roségold", dial:"Violett", size:"32 mm", movement:"Automatik", set:"Box & Papiere", cond:"Ungetragen", style:{case:"#c98f6b",dial:"#5b3a7a",strap:"#c98f6b",ind:"#f3dcc9",type:"bracelet",bezelGem:true}},
  {id:4, brand:"Audemars Piguet", name:"Royal Oak Offshore T3", ref:"26215BC", year:2014, price:240990, material:"Weißgold", dial:"Schwarz", size:"42 mm", movement:"Automatik", set:"Werksseitig diamantbesetzt", cond:"Sehr gut", style:{case:"#e3e5e8",dial:"#16161a",strap:"#e3e5e8",ind:"#fff",type:"bracelet",chrono:true,bezelGem:true}},
  {id:5, brand:"Audemars Piguet", name:"Code 11.59 Green", ref:"15210ST", year:2022, price:16990, material:"Edelstahl", dial:"Grün", size:"41 mm", movement:"Automatik", set:"Box & Papiere", cond:"Sehr gut", style:{case:"#cfd3d8",dial:"#2f5d4a",strap:"#1d2a24",ind:"#eef3ee",type:"strap"}, isNew:true},
  {id:6, brand:"Rolex", name:"Daytona Rainbow", ref:"116598RBOW", year:2017, price:335990, material:"Gelbgold", dial:"Schwarz", size:"40 mm", movement:"Automatik", set:"Ungetragen", cond:"Ungetragen", style:{case:"#d9b04a",dial:"#101012",strap:"#d9b04a",ind:"#f6e3a8",type:"bracelet",chrono:true,bezelGem:true}},
  {id:7, brand:"Rolex", name:"Cosmograph Daytona Meteorit", ref:"116509", year:2022, price:95990, material:"Weißgold", dial:"Meteorit", size:"40 mm", movement:"Automatik", set:"Box & Papiere", cond:"Sehr gut", style:{case:"#e1e3e6",dial:"#7a7d83",strap:"#e1e3e6",ind:"#fff",type:"bracelet",chrono:true}},
  {id:8, brand:"Rolex", name:"Day-Date 40 Meteorit", ref:"228349RBR", year:2024, price:54990, material:"Weißgold", dial:"Meteorit", size:"40 mm", movement:"Automatik", set:"Box & Papiere", cond:"Neuwertig", style:{case:"#e1e3e6",dial:"#6c6f75",strap:"#e1e3e6",ind:"#fff",type:"bracelet"}, isNew:true},
  {id:9, brand:"Rolex", name:"Daytona Zenith", ref:"16520", year:1998, price:24990, material:"Edelstahl", dial:"Weiß", size:"40 mm", movement:"Automatik", set:"Vintage", cond:"Gut", style:{case:"#c9cdd2",dial:"#f2efe8",strap:"#c9cdd2",ind:"#1a1a1a",type:"bracelet",chrono:true,darkInd:true}},
  {id:10, brand:"Rolex", name:"Sky-Dweller Stahl/Gold", ref:"326933", year:2021, price:16990, material:"Stahl/Gold", dial:"Schwarz", size:"42 mm", movement:"Automatik", set:"Box & Papiere", cond:"Sehr gut", style:{case:"#cdb27a",dial:"#121214",strap:"#c4c8cd",ind:"#f3e6c0",type:"bracelet"}},
  {id:11, brand:"Rolex", name:"Milgauss Label Noir", ref:"116400GV", year:2023, price:28490, material:"Stahl, PVD", dial:"Schwarz", size:"40 mm", movement:"Automatik", set:"Custom-Umbau", cond:"Sehr gut", style:{case:"#2a2a2e",dial:"#0e0e10",strap:"#2a2a2e",ind:"#d8d8dd",type:"bracelet",bezelGem:true}},
  {id:12, brand:"Richard Mille", name:"RM 030 Titan", ref:"RM030 Ti", year:2014, price:145990, material:"Titan", dial:"Skelett", size:"50 mm", movement:"Automatik", set:"RM-Service 08/26", cond:"Sehr gut", style:{case:"#8e949c",dial:"#2b2f36",strap:"#e8e8e8",ind:"#fff",type:"strap",skeleton:true}}
];

/*CREDITS*/const CREDITS = {};
PRODUCTS.forEach(p => { if (CREDITS[p.id]) p.photos = 1; });

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const eur = n => new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const byId = id => PRODUCTS.find(p => p.id === id);
const slug = s => s.toLowerCase().replace(/\s+/g,"-");

/* ---------- Uhr als SVG (Platzhalter, bis Fotos in img/ liegen) ---------- */
function watchSVG(s, opts={}) {
  const {case:c, dial:d, strap:b, ind, type, chrono, bezelGem, skeleton, darkInd} = s;
  const cx=100, cy=130, vb = opts.zoom ? "42 72 116 116" : "0 0 200 260";
  const hAng = 305, mAng = 60;
  let marks = "";
  for (let i=0;i<12;i++){ const a=i*30*Math.PI/180, r1=52, r2=i%3===0?42:47;
    marks += `<line x1="${cx+Math.sin(a)*r1}" y1="${cy-Math.cos(a)*r1}" x2="${cx+Math.sin(a)*r2}" y2="${cy-Math.cos(a)*r2}" stroke="${ind}" stroke-width="${i%3===0?2.6:1.3}" stroke-linecap="round"/>`; }
  let gems = "";
  if (bezelGem){ const cols=["#e84a5f","#ff9a3c","#f9d423","#3ccf91","#3aa0ff","#8e6bff"];
    for(let i=0;i<24;i++){ const a=i*15*Math.PI/180;
      gems += `<circle cx="${cx+Math.sin(a)*60.5}" cy="${cy-Math.cos(a)*60.5}" r="2.5" fill="${cols[i%6]}" stroke="#fff" stroke-opacity=".6" stroke-width=".4"/>`; } }
  const band = type==="bracelet"
    ? `<g fill="${b}" stroke="rgba(0,0,0,.35)" stroke-width=".8">${[6,24,42,60,206,224,242].map(y=>`<rect x="77" y="${y}" width="46" height="17" rx="2.5"/>`).join("")}</g>
       <g fill="rgba(255,255,255,.18)">${[6,24,42,60,206,224,242].map(y=>`<rect x="77" y="${y}" width="46" height="4" rx="2"/>`).join("")}</g>`
    : `<g fill="${b}" stroke="rgba(0,0,0,.4)" stroke-width=".8"><path d="M80 0 H120 L125 72 H75 Z"/><path d="M75 188 H125 L120 260 H80 Z"/></g>
       <g stroke="rgba(255,255,255,.25)" stroke-width=".8" stroke-dasharray="3 3"><path d="M85 6 L87 70"/><path d="M115 6 L113 70"/><path d="M87 192 L85 254"/><path d="M113 192 L115 254"/></g>`;
  const hand = darkInd ? "#1a1a1a" : "#f4f1e8";
  const sub = chrono ? [[-18,0],[18,0],[0,20]].map(([x,y])=>`<circle cx="${cx+x}" cy="${cy+y}" r="11" fill="none" stroke="${ind}" stroke-opacity=".55" stroke-width=".8"/><circle cx="${cx+x}" cy="${cy+y}" r="8" fill="none" stroke="${ind}" stroke-opacity=".2" stroke-width=".5"/>`).join("") : "";
  const skel = skeleton ? `<circle cx="${cx-14}" cy="${cy+8}" r="14" fill="none" stroke="#c7ccd4" stroke-width="1.5"/><circle cx="${cx+16}" cy="${cy-10}" r="10" fill="none" stroke="#c7ccd4" stroke-width="1.5"/><circle cx="${cx-14}" cy="${cy+8}" r="3" fill="#c7ccd4"/>` : "";
  const uid = "g"+Math.random().toString(36).slice(2,7);
  return `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Armbanduhr">
    <defs><radialGradient id="${uid}" cx=".3" cy=".22" r=".95"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="${uid}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>
    ${band}
    <rect x="152" y="121" width="8" height="18" rx="2" fill="${c}" stroke="rgba(0,0,0,.45)" stroke-width=".8"/>
    <circle cx="${cx}" cy="${cy}" r="71" fill="${c}" stroke="rgba(0,0,0,.5)" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="71" fill="url(#${uid}m)"/>
    <circle cx="${cx}" cy="${cy}" r="66" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="56" fill="${d}" stroke="rgba(0,0,0,.6)" stroke-width="1.2"/>
    <circle cx="${cx}" cy="${cy}" r="56" fill="url(#${uid})"/>
    ${gems}${skel}${marks}${sub}
    <line x1="${cx}" y1="${cy}" x2="${cx+Math.sin(hAng*Math.PI/180)*28}" y2="${cy-Math.cos(hAng*Math.PI/180)*28}" stroke="${hand}" stroke-width="3.2" stroke-linecap="round"/>
    <line x1="${cx}" y1="${cy}" x2="${cx+Math.sin(mAng*Math.PI/180)*42}" y2="${cy-Math.cos(mAng*Math.PI/180)*42}" stroke="${hand}" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="3.2" fill="${hand}"/>
  </svg>`;
}
/* Echte Produktaufnahmen je Referenz; bei nicht verfügbarem Bild greift der SVG-Fallback. */
const PHOTO_URLS = {
  1:["https://patek-res.cloudinary.com/media/202099/51887"],
  2:["https://chronexttime.imgix.net/V/4/V48236/V48236_1.png?ar=1%3A1&auto=compress&auto=format&bg=FFFFFF&fit=fill&fm=png&q=85&w=900"],
  3:["https://cdn.vuahanghieu.com/unsafe/0x900/left/top/smart/filters%3Aquality%2890%29/https%3A/admin.vuahanghieu.com/upload/product/2024/02/dong-ho-nu-patek-philippe-7010r-013-mau-tim-65d6c47a08428-22022024105018.jpg"],
  4:["https://diamondsourcenyc.com/wp-content/uploads/2025/08/audemars-piguet-royal-oak-offshore-chronograph-ref-26215bc-zz-1239bc-01-luxury-swiss-347.jpg"],
  5:["https://www.jaztime.com/media/catalog/product/cache/be6cc9267cc77716448272b700c29484/a/u/audemars_piguet_code_11.59_selfwinding_stainless_steel_41mm_green_dial_15210st.oo.a056kb.01.jpg"],
  6:["https://sothebys-md.brightspotcdn.com/dims4/default/0a1706b/2147483647/strip/true/crop/2000x2000%2B0%2B0/resize/1200x1200%21/quality/90/?url=http%3A%2F%2Fsothebys-brightspot.s3.amazonaws.com%2Fmedia-desk%2Fwebnative%2Fimages%2F3b%2F1a%2F73433a204e20b9b6c21c4680d9be%2Fhk1614-d8pp6-076-01-t1-01.jpg"],
  7:["https://cdn.swisswatchexpo.com/productphotos/10/10/rolex-daytona-white-gold-meteorite-dial-chronograph-mens-watch-116509-74333_8696d.jpg"],
  8:["https://timepiecetradingllc.com/cdn/shop/files/Untitleddesign-2025-01-24T040234.085.png?v=1737845751"],
  9:["https://amsterdamvintagewatches.com/wp-content/uploads/2019/03/AVW-Rolex-Daytona-16520-1991-2-Side.jpg"],
  10:["https://static.wixstatic.com/media/60a371_160a395d9fb5446e9f9edf10aadbb40d~mv2.jpg/v1/fill/w_900%2Ch_900%2Cal_c%2Cq_85%2Cenc_avif%2Cquality_auto/60a371_160a395d9fb5446e9f9edf10aadbb40d~mv2.jpg"],
  11:["https://www.watchclub.com/upload/watches/originali/watch-club-rolex-milgauss-116400gv-box-and-certificate-ref-116400gv-year-2009-15213-wb.png11.jpg"],
  12:["https://firstclasstimepieces.com/cdn/shop/products/rm30tit_500x.png?v=1603480239"]
};
function media(p, i=0, opts={}) {
  const photos = PHOTO_URLS[p.id] || [];
  if (photos[i]) return '<img class="photo" src="' + photos[i] + '" alt="' + esc(p.brand+" "+p.name) + '" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="photo-fallback" hidden>' + watchSVG(p.style, {zoom: !!opts.zoom}) + '</span>';
  return watchSVG(p.style, {zoom: !!opts.zoom});
}

/* ---------- Speicher ---------- */
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } },
  set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let wish = store.get("el_wish"), cart = store.get("el_cart");

/* ---------- Karte ---------- */
const ICON_HEART = '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.700 3.700 4.500 7 4.500c2 0 3.500 1.100 5 3 1.500-1.900 3-3 5-3 3.300 0 5.400 3.200 4.200 6.600C19.500 15.900 12 20.500 12 20.500z"/></svg>';
function card(p){
  return `<article class="card">
    ${p.isNew?'<span class="tag">Neu</span>':""}
    <button class="heart ${wish.includes(p.id)?"on":""}" data-wish="${p.id}" aria-label="Merken">${ICON_HEART}</button>
    <a class="card-img" href="uhr.html#p${p.id}" aria-label="${esc(p.name)}">${media(p)}<span class="view">Uhr ansehen</span></a>
    <div class="card-body">
      <span class="brand">${esc(p.brand)}</span>
      <a class="name" href="uhr.html#p${p.id}">${esc(p.name)}</a>
      <span class="meta">${esc(p.material)} · Ref. ${esc(p.ref)} · ${p.year}</span>
      <span class="price">${eur(p.price)}</span>
    </div></article>`;
}

/* ---------- Layout (Header, Footer, Drawer) ---------- */
const NAV = [["kollektion.html","Kollektion"],["marken.html","Marken"],["service.html","Service"],["ueber-uns.html","Über uns"],["kontakt.html","Kontakt"]];
function buildLayout(){
  const here = location.pathname.split("/").pop() || "index.html";
  const link = ([h,t]) => `<a href="${h}" class="${h===here||(here==="uhr.html"&&h==="kollektion.html")?"on":""}">${t}</a>`;
  document.body.insertAdjacentHTML("afterbegin", `
  <div class="topbar">Echtheitsgarantie · Versicherter Versand · 14 Tage Rückgaberecht</div>
  <header class="header">
    <div class="header-in">
      <nav class="nav" aria-label="Hauptnavigation">${NAV.slice(0,3).map(link).join("")}</nav>
      <button class="ib menu-btn" id="menuBtn" aria-label="Menü"><svg viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h18"/></svg></button>
      <a href="index.html" class="logo">${SHOP}<small>Haute Horlogerie</small></a>
      <div class="actions">
        <nav class="nav" style="margin-right:22px">${NAV.slice(3).map(link).join("")}</nav>
        <button class="ib" id="wishBtn" aria-label="Merkliste">${ICON_HEART}<b class="badge" id="wishCount">0</b></button>
        <button class="ib" id="cartBtn" aria-label="Anfrageliste"><svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 016 0v2"/></svg><b class="badge" id="cartCount">0</b></button>
      </div>
    </div>
    <nav class="mnav" id="mnav">${NAV.map(link).join("")}</nav>
  </header>`);
  document.body.insertAdjacentHTML("beforeend", `
  <section class="news"><div class="wrap">
    <p class="eyebrow">Newsletter</p><h2 style="margin-top:12px">Neuzugänge zuerst erfahren</h2>
    <p class="muted" style="margin-top:10px">Eintragen und 10 € Willkommensgutschein erhalten.</p>
    <form id="nlForm"><input type="email" id="nlMail" placeholder="Ihre E-Mail-Adresse" required aria-label="E-Mail"><button class="btn solid">Anmelden</button></form>
  </div></section>
  <footer class="footer"><div class="wrap">
    <div class="f-grid">
      <div><div class="logo" style="text-align:left;padding:0">${SHOP}<small>Haute Horlogerie</small></div><p>Geprüfte Luxusuhren von Rolex, Patek Philippe, Audemars Piguet und Richard Mille. Diskret, versichert, mit Echtheitsgarantie.</p></div>
      <div><h4>Entdecken</h4><ul><li><a href="kollektion.html">Kollektion</a></li><li><a href="marken.html">Marken</a></li><li><a href="kollektion.html#neu">Neuzugänge</a></li></ul></div>
      <div><h4>Service</h4><ul><li><a href="service.html">Echtheitsgarantie</a></li><li><a href="service.html#versand">Versand &amp; Zahlung</a></li><li><a href="service.html#faq">Häufige Fragen</a></li><li><a href="kontakt.html">Kontakt</a></li></ul></div>
      <div><h4>Rechtliches</h4><ul><li><a href="rechtliches.html#impressum">Impressum</a></li><li><a href="rechtliches.html#datenschutz">Datenschutz</a></li><li><a href="rechtliches.html#agb">AGB</a></li><li><a href="ueber-uns.html">Über uns</a></li></ul></div>
    </div>
    <div class="fine"><span>© ${new Date().getFullYear()} ${SHOP} &amp; Co.</span><span>Alle Marken sind Eigentum ihrer Inhaber. Unabhängiger Händler, nicht mit den Herstellern verbunden. Produkte und Preise sind Beispieldaten.</span></div>
  </div></footer>
  <div class="overlay" id="overlay"></div>
  <aside class="drawer" id="cartDrawer" aria-label="Anfrageliste"><div class="d-head"><h3>Ihre Anfrage</h3><button class="ib" data-close aria-label="Schließen"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div class="d-body" id="cartBody"></div><div class="d-foot"><div class="total"><span>Summe</span><b id="cartTotal">0 €</b></div><button class="btn solid full" id="cartGo">Unverbindlich anfragen</button></div></aside>
  <aside class="drawer" id="wishDrawer" aria-label="Merkliste"><div class="d-head"><h3>Merkliste</h3><button class="ib" data-close aria-label="Schließen"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg></button></div><div class="d-body" id="wishBody"></div></aside>`);
}

const overlay = () => $("#overlay");
function openDrawer(id){ closeAll(); $(id).classList.add("open"); overlay().classList.add("on"); }
function closeAll(){ $$(".drawer").forEach(d=>d.classList.remove("open")); overlay().classList.remove("on"); }
const setBadge = (s,n)=>{ const b=$(s); b.textContent=n; b.classList.toggle("on",n>0); };
function row(p, extra){ return `<div class="row"><a class="th" href="uhr.html#p${p.id}">${media(p)}</a><div><div class="b">${esc(p.brand)}</div><div class="n">${esc(p.name)}</div><div class="p">${eur(p.price)}</div></div>${extra}</div>`; }
function renderLists(){
  const ci = cart.map(byId).filter(Boolean), wi = wish.map(byId).filter(Boolean);
  $("#cartBody").innerHTML = ci.length ? ci.map(p=>row(p,`<button class="rm" data-rmcart="${p.id}">Entfernen</button>`)).join("") : '<p class="d-empty">Ihre Anfrageliste ist leer.</p>';
  $("#wishBody").innerHTML = wi.length ? wi.map(p=>row(p,`<button class="rm" data-wish="${p.id}">Entfernen</button>`)).join("") : '<p class="d-empty">Ihre Merkliste ist leer.</p>';
  $("#cartTotal").textContent = eur(ci.reduce((s,p)=>s+p.price,0));
  $("#cartGo").disabled = !ci.length;
  setBadge("#cartCount",ci.length); setBadge("#wishCount",wi.length);
  $$("[data-wish]").forEach(b=>{ if(b.classList.contains("heart")) b.classList.toggle("on", wish.includes(+b.dataset.wish)); });
}
function toggleWish(id){ wish = wish.includes(id)?wish.filter(x=>x!==id):[...wish,id]; store.set("el_wish",wish); renderLists(); }
function addCart(id){ if(!cart.includes(id)){ cart.push(id); store.set("el_cart",cart); } renderLists(); openDrawer("#cartDrawer"); }

document.addEventListener("click", e=>{
  const t = e.target.closest("[data-wish],[data-add],[data-rmcart],[data-close]");
  if(!t) return;
  if(t.dataset.wish) toggleWish(+t.dataset.wish);
  else if(t.dataset.add) addCart(+t.dataset.add);
  else if(t.dataset.rmcart){ cart=cart.filter(x=>x!==+t.dataset.rmcart); store.set("el_cart",cart); renderLists(); }
  else closeAll();
});
document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeAll(); });

document.addEventListener("DOMContentLoaded", ()=>{
  buildLayout(); renderLists();
  overlay().onclick = closeAll;
  $("#cartBtn").onclick = ()=>openDrawer("#cartDrawer");
  $("#wishBtn").onclick = ()=>openDrawer("#wishDrawer");
  $("#menuBtn").onclick = ()=>$("#mnav").classList.toggle("open");
  $("#cartGo").onclick = ()=>{
    const items = cart.map(byId).filter(Boolean);
    try { sessionStorage.setItem("el_msg","Ich interessiere mich unverbindlich für:\n"+items.map(p=>`- ${p.brand} ${p.name} (Ref. ${p.ref}) – ${eur(p.price)}`).join("\n")); } catch {}
    location.href = "kontakt.html";
  };
  $("#nlForm").onsubmit = e=>{ e.preventDefault(); e.target.innerHTML='<p class="note">Vielen Dank. Ihren Gutschein erhalten Sie per E-Mail (Demo).</p>'; };
  if (typeof initPage === "function") initPage();
  renderLists();
});
