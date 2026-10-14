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
    host = urllib.parse.urlsplit(base).hostname
    for url, label, href in links_of(base, page):
        if urllib.parse.urlsplit(url).hostname not in (host, None):
            continue
        if any(w in label or w in href for w in words):
            return url
    return None


def analyze(home, impressum="", career=""):
    """Signale aus den Seiten (HTML-Text) ableiten."""
    out = {}
    imp_text = text_of(impressum) if impressum else ""
    home_text = text_of(home)
    rf = legal_form(imp_text) if imp_text else ""
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
    car = fetcher(car_url) if car_url and car_url != imp_url else None
    out = analyze(page, imp[1] if imp else "", car[1] if car else "")
    out["d"] = today
    return out


def run(targets, cache, today, max_count=8000, max_seconds=1200, workers=24, fetcher=None, log=print):
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
