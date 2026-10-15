"""Website-Check: liest öffentliche Firmen-Websites und leitet daraus Signale ab.

Pro Domain höchstens vier Abrufe (robots.txt, Startseite, Impressum,
Karriere-Seite). Sperren in der robots.txt werden beachtet. Gespeichert werden
nur Firmenmerkmale, keine Personendaten:

    rf   Rechtsform (aus dem Impressum)
    hr   im Handelsregister eingetragen (HRA/HRB im Impressum)
    kap  Stamm-/Grundkapital in Euro, falls angegeben
    jobs Anzahl erkannter Stellenanzeigen ("m/w/d") auf der Karriere-Seite
    kar  Karriere-/Jobseite vorhanden
    shop Online-Shop (Warenkorb)
    soc  verlinkt Social Media
    std  nennt mehrere Standorte/Filialen
    d    Datum des Checks; rb=1: per robots.txt gesperrt, err=1: nicht erreichbar
"""

import hashlib
import html
import re
import time
import urllib.parse
import urllib.request
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor, as_completed

USER_AGENT = "Mozilla/5.0 (compatible; Leadgenerator-BW/1.0; +https://markus90ms-eng.github.io/Leadgenerator/)"
ROBOT_NAME = "Leadgenerator-BW"
MAX_BYTES = 800_000
RECHECK_DAYS = 90
VERSION = 4  # 2: mit Impressum-Daten (imp), 3: Anschrift auch über getrennte Seitenelemente,
#              4: Impressum auch ohne Link (/impressum), passende Firma bei mehreren im Impressum


def is_current(sig, strict=False):
    """Muss ein Ergebnis neu geprüft werden? Ohne `strict` (Einzelbetriebe) reicht Version 3 bzw.
    Version 2 mit erkannter Anschrift; Gruppen werden immer mit der neuesten Version geprüft."""
    v = (sig or {}).get("v", 1)
    if strict:
        return v >= VERSION
    return v >= 3 or (v == 2 and bool((sig.get("imp") or {}).get("p")))

# Kurze Kürzel nur in korrekter Schreibweise (sonst Treffer in normalem Text)
LEGAL_FORMS = [
    ("GmbH & Co. KG", r"(?i:gmbh)\s*(?:&|\+|und)\s*(?i:co)\.?\s*KG\b"),
    ("AG & Co. KG", r"\bAG\s*(?:&|\+|und)\s*(?i:co)\.?\s*KG\b"),
    ("KGaA", r"\bKGaA\b"),
    ("SE", r"\bSE\b"),
    ("AG", r"\bAG\b|(?i:aktiengesellschaft)"),
    ("gGmbH", r"\bgGmbH\b"),
    ("UG", r"\bUG\b|(?i:unternehmergesellschaft)"),
    ("GmbH", r"(?i:\bgmbh\b|gesellschaft mit beschränkter haftung)"),
    ("KG", r"\bKG\b|(?i:kommanditgesellschaft)"),
    ("OHG", r"\bOHG\b|(?i:offene handelsgesellschaft)"),
    ("eG", r"\beG\b|(?i:eingetragene genossenschaft)"),
    ("e.K.", r"\be\.\s?(?:K|Kfm|Kfr)\.|(?i:eingetragene[rs]? kauf(?:mann|frau))"),
    ("GbR", r"\bGbR\b"),
    ("e.V.", r"\be\.\s?V\."),
]
_LEGAL_RE = [(name, re.compile(p)) for name, p in LEGAL_FORMS]
# "Registergericht: AG Stuttgart" ist das Amtsgericht, keine Aktiengesellschaft
_COURT = re.compile(r"\b(?:Amtsgericht|AG)\s*[:\-]?\s*(?=[A-ZÄÖÜ][a-zäöüß])")


def legal_form(text):
    """Rechtsform aus Firmenname oder Impressum ('' wenn keine erkennbar).
    Bei mehreren gilt die zuerst genannte (im Impressum steht die eigene Firma oben)."""
    text = _COURT.sub(" ", (text or "")[:20000])
    best = None
    for order, (name, rx) in enumerate(_LEGAL_RE):
        m = rx.search(text)
        if m and (best is None or (m.start(), order) < best[:2]):
            best = (m.start(), order, name)
    return best[2] if best else ""


def domain_of(url):
    url = (url or "").strip().lower()
    if not url:
        return ""
    if "://" not in url:
        url = "http://" + url
    host = urllib.parse.urlsplit(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


def shard_of(domain):
    return hashlib.md5(domain.encode()).hexdigest()[0]


# ---------- Abruf ---------------------------------------------------------
def fetch(url, timeout=10):
    """(End-URL, HTML-Text) oder None."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.5",
                                               "Accept-Language": "de-DE,de;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = resp.headers.get("Content-Type", "")
            if "html" not in ctype and "text" not in ctype:
                return None
            raw = resp.read(MAX_BYTES)
            charset = resp.headers.get_content_charset() or "utf-8"
            return resp.geturl(), raw.decode(charset, errors="replace")
    except Exception:
        return None


def robots_allows(base, fetcher=None):
    got = (fetcher or fetch)(urllib.parse.urljoin(base, "/robots.txt"))
    if not got:
        return True  # keine robots.txt -> erlaubt
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(got[1].splitlines())
    return rp.can_fetch(ROBOT_NAME, base + "/") and rp.can_fetch(ROBOT_NAME, base + "/impressum")


# ---------- Auswertung ----------------------------------------------------
_TAGS = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>|<[^>]+>", re.S | re.I)
_LINK = re.compile(r"<a\b[^>]*?href\s*=\s*[\"']([^\"'#]+)[\"'][^>]*>(.*?)</a>", re.S | re.I)
_JOB = re.compile(r"\b[mwdx]\s*/\s*[mwdx]\s*/\s*[mwdx]\b", re.I)
_KAPITAL = re.compile(r"(?:stamm|grund)kapital[^0-9]{0,30}([0-9][0-9.\s]*(?:,[0-9]{2})?)\s*(?:€|eur|euro)", re.I)


def text_of(page):
    return html.unescape(re.sub(r"\s+", " ", _TAGS.sub(" ", page)))


def links_of(base, page):
    for href, label in _LINK.findall(page):
        yield urllib.parse.urljoin(base, href.strip()), text_of(label).strip().lower(), href.lower()


def find_link(base, page, words):
    domain = domain_of(base)
    for url, label, href in links_of(base, page):
        if domain_of(url) != domain:  # www. und ohne www. gelten als gleiche Website
            continue
        if any(w in label or w in href for w in words):
            return url
    return None


_PLZ_ORT = re.compile(r"\b(?:D-?\s?)?(\d{5})\s+([A-ZÄÖÜ][\wäöüßÄÖÜ.\-]*(?:\s+(?:am|an|im|ob|unter|bei|in|a\.|i\.)\s*[A-ZÄÖÜ][\wäöüß.\-]*|\s+[A-ZÄÖÜ][a-zäöüß]+)?)")
_STREET = re.compile(r"([A-ZÄÖÜ][\wäöüßÄÖÜ.\- ]{2,40}?(?:stra(?:ß|ss)e|str\.|weg|platz|gasse|allee|ring|damm|ufer|steige|steig|markt|hof|tor|graben|berg|halde|park|feld|wiesen?|garten)\s*\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)", re.I)
_STREET_WORD = re.compile(r"((?:(?:Am|An der|Im|In der|Auf der|Zum|Zur)\s+)?[A-ZÄÖÜ][\wäöüß.\-]*(?:stra(?:ß|ss)e|str\.|weg|platz|gasse|allee|ring|damm|ufer|steige|steig|markt|hof|tor|graben|berg|halde|park|feld|wiesen?|garten)\s*\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)", re.I)
_REGISTER = re.compile(r"\b(HR\s?[AB])\s*:?\s*(\d{2,7}\s?[A-Z]?)\b")
_COURT_NAME = re.compile(r"(?:Amtsgericht|Registergericht[:\s]*(?:Amtsgericht)?|AG)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+(?:am|an|im|i\.)\s*[A-ZÄÖÜ]?[\w.]+)?)")
_SKIP_LINE = re.compile(r"impressum|angaben gem|§\s*5|tmg|ddg|kontakt|anschrift|verantwortlich|vertreten", re.I)


_FORM_END = re.compile(r"^(.*?\b(?:GmbH\s*(?:&|\+|und)\s*Co\.?\s*KG|gGmbH|GmbH|AG|KGaA|KG|e\.\s?V\.|eG|UG(?:\s*\(haftungsbeschränkt\))?|SE|OHG|GbR|e\.\s?K(?:fm|fr)?\.)(?!\w))", re.I)


def cut_after_form(name):
    """'Bickel GmbH, Werderstr. 85/1' -> 'Bickel GmbH' (danach folgen oft Adresse oder Personen)."""
    m = _FORM_END.match(name or "")
    return m.group(1).strip() if m else (name or "").strip()


def impressum_lines(page):
    parts = re.split(r"<br\s*/?>|</(?:p|div|li|h\d|td|tr|span|address)>|\n", page, flags=re.I)
    return [t for t in (text_of(p).strip(" ,;|") for p in parts) if t]


def _fold(text):
    t = (text or "").lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return re.sub(r"[^a-z0-9]", "", t)


def _fits_domain(firm, domain):
    """Passt der Firmenname zur Website? 'Johanniter-Unfall-Hilfe e.V.' ~ johanniter.de"""
    core = (domain or "").split(".")[0]
    name = _fold(firm)
    parts = [p for p in re.split(r"[^a-z0-9]+", core) if len(p) >= 4]
    return bool(name) and (_fold(core) in name or any(_fold(p) in name for p in parts))


def _is_firm_line(line):
    return len(line) <= 90 and legal_form(line) and not _SKIP_LINE.search(line) \
        and not _REGISTER.search(line) and "@" not in line


def _address(lines, i, j):
    """PLZ/Ort, Straße (und Telefon) in lines[i:j]."""
    out = {}
    for k in range(i, min(j, len(lines))):
        line = lines[k]
        if "p" not in out:
            m = _PLZ_ORT.search(line)
            if m and not re.search(r"postfach", line, re.I):
                out["p"], out["o"] = m.group(1), m.group(2).strip(" .,")
                st = _STREET.search(line[:m.start()]) or (k > i and _STREET.search(lines[k - 1]))
                if st:
                    out["s"] = re.sub(r"\s+", " ", st.group(1)).strip()
        if "t" not in out and re.search(r"\b(tel|telefon|fon|phone)\b", line, re.I):
            m = re.search(r"(\+?\d[\d\s/()\-–.]{5,}\d)", line)
            if m:
                out["t"] = re.sub(r"\s+", " ", m.group(1)).strip()
    return out


def impressum_data(page, domain=""):
    """Firmierung, Anschrift, Telefon und Registereintrag aus dem Impressum (nur Firmendaten).

    Stehen mehrere Firmen im Impressum (z. B. Verein und Stiftung), wird die genommen,
    deren Name zur Website passt; die übrigen stehen in 'fx'."""
    lines = impressum_lines(page)[:200]
    firms = [i for i, line in enumerate(lines) if _is_firm_line(line)]
    blocks = []
    for n, i in enumerate(firms):
        nxt = firms[n + 1] if n + 1 < len(firms) else i + 12
        block = {"f": cut_after_form(re.sub(r"\s+", " ", lines[i])), **_address(lines, i, min(nxt, i + 12))}
        if not any(b["f"] == block["f"] for b in blocks):
            blocks.append(block)
    out = {}
    if blocks:
        def rank(b):
            return (not (domain and _fits_domain(b["f"], domain)), "p" not in b, blocks.index(b))
        out = dict(min(blocks, key=rank))
        others = [b["f"] for b in blocks if b["f"] != out["f"]][:4]
        if others:
            out["fx"] = others
    if "p" not in out:
        out.update({k: v for k, v in _address(lines, 0, len(lines)).items() if k not in out})
    if "t" not in out:
        tel = _address(lines, 0, len(lines)).get("t")
        if tel:
            out["t"] = tel
    text = " ".join(lines)
    if "p" not in out:  # PLZ und Ort in getrennten Seitenelementen
        m = _PLZ_ORT.search(text)
        if m:
            out["p"], out["o"] = m.group(1), m.group(2).split()[0].strip(" .,")
            streets = _STREET_WORD.findall(text[max(0, m.start() - 80):m.start()])
            if streets:
                out["s"] = re.sub(r"\s+", " ", streets[-1]).strip()
    reg = _REGISTER.search(text)
    if reg:
        court = _COURT_NAME.search(text)
        out["r"] = f"{reg.group(1).replace(' ', '')} {reg.group(2).strip()}" + (f", Amtsgericht {court.group(1)}" if court else "")
    return out if ("p" in out or "f" in out) else {}


def analyze(home, impressum="", career="", domain=""):
    """Signale aus den Seiten (HTML-Text) ableiten."""
    out = {}
    imp_text = text_of(impressum) if impressum else ""
    home_text = text_of(home)
    imp = impressum_data(impressum, domain) if impressum else {}
    if imp:
        out["imp"] = imp
    rf = legal_form(imp.get("f") or imp_text) if imp_text else ""
    if rf:
        out["rf"] = rf
    if re.search(r"\bHR\s?[AB]\b\s*\d|handelsregister", imp_text, re.I):
        out["hr"] = 1
    m = _KAPITAL.search(imp_text)
    if m:
        try:
            out["kap"] = int(float(re.sub(r"[.\s]", "", m.group(1)).replace(",", ".")))
        except ValueError:
            pass
    if career:
        out["kar"] = 1
        lines = {t for t in (text_of(l).strip()[:120] for l in re.split(r"[\n\r]|</(?:a|li|h\d|p|div|td)>", career, flags=re.I))
                 if _JOB.search(t)}
        if lines:
            out["jobs"] = min(len(lines), 99)
    elif re.search(r"wir suchen|stellenangebote|wir stellen ein|jetzt bewerben", home_text, re.I):
        out["kar"] = 1
    if re.search(r"warenkorb|in den korb|zur kasse|onlineshop|online-shop|/cart\b|/warenkorb", home, re.I):
        out["shop"] = 1
    if re.search(r"(instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|youtube\.com)/", home, re.I):
        out["soc"] = 1
    if re.search(r"unsere standorte|unsere filialen|niederlassungen|standorte in", home_text, re.I):
        out["std"] = 1
    return out


def _looks_like_impressum(page):
    """Schutz gegen Seiten, die für jede Adresse die Startseite liefern."""
    text = text_of(page)
    return bool(re.search(r"impressum|imprint|angaben gem", text, re.I)) and bool(_PLZ_ORT.search(text))


def check(url, today, fetcher=None):
    """Eine Firmen-Website prüfen -> Signal-Dict (immer mit 'd')."""
    fetcher = fetcher or fetch
    host = urllib.parse.urlsplit(url if "://" in url else "http://" + url).hostname or ""
    domain = domain_of(url)
    roots = list(dict.fromkeys([f"https://{host}", f"https://{domain}", f"http://{host}"]))
    for root in roots:
        home = fetcher(root + "/")
        if home:
            break
    else:
        return {"d": today, "err": 1}
    if not robots_allows(root, fetcher):
        return {"d": today, "rb": 1}
    final, page = home
    imp_url = find_link(final, page, ("impressum", "imprint", "legal notice"))
    car_url = find_link(final, page, ("karriere", "jobs", "stellenangebote", "stellen", "career", "ausbildung"))
    imp = fetcher(imp_url) if imp_url else None
    if not imp:  # kein Link auf der Startseite (z. B. per JavaScript) -> übliche Adressen probieren
        for path in ("/impressum/", "/impressum", "/imprint", "/impressum.html"):
            got = fetcher(urllib.parse.urljoin(final, path))
            if got and _looks_like_impressum(got[1]):
                imp = got
                break
    car = fetcher(car_url) if car_url and car_url != imp_url else None
    out = analyze(page, imp[1] if imp else "", car[1] if car else "", domain)
    out["d"] = today
    out["v"] = VERSION
    return out


def run(targets, cache, today, max_count=8000, max_seconds=1200, workers=48, fetcher=None, log=print):
    """Prüft bis zu max_count Domains aus `targets` ([(domain, url)], nach Priorität) und
    trägt die Ergebnisse in `cache` ein. Gibt die Anzahl geprüfter Domains zurück."""
    todo = targets[:max_count]
    if not todo:
        return 0
    deadline = time.monotonic() + max_seconds
    done = 0
    log(f"Website-Check: {len(todo)} Websites werden geprüft …")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {}
        it = iter(todo)
        for domain, url in it:  # Arbeitsvorrat begrenzt halten, damit das Zeitlimit greift
            futures[pool.submit(check, url, today, fetcher)] = domain
            if len(futures) >= workers * 2:
                break
        while futures:
            for fut in as_completed(list(futures)):
                domain = futures.pop(fut)
                try:
                    cache[domain] = fut.result()
                except Exception:
                    cache[domain] = {"d": today, "err": 1}
                done += 1
                if done % 500 == 0:
                    log(f"Website-Check: {done}/{len(todo)}")
                if time.monotonic() < deadline:
                    nxt = next(it, None)
                    if nxt:
                        futures[pool.submit(check, nxt[1], today, fetcher)] = nxt[0]
                break
    log(f"Website-Check: {done} Websites geprüft")
    return done
