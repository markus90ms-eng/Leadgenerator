"""Firmenstandorte aus Overture Maps (Thema "places").

Offener Datensatz der Overture Maps Foundation (u. a. Meta, Microsoft,
Foursquare, Registerdaten von BrightQuery), Lizenz CDLA-Permissive-2.0.
Ergänzt OpenStreetMap vor allem um Handwerks- und Dienstleistungsbetriebe ohne
Ladengeschäft. Gelesen wird direkt aus dem öffentlichen S3-Bucket, nur der
Ausschnitt Baden-Württemberg. Benötigt das Paket `pyarrow`.
"""

import re

from .categories import classify_overture, overture_kind

BUCKET = "overturemaps-us-west-2"
REGION = "us-west-2"
COLUMNS = ["id", "names", "confidence", "websites", "emails", "phones", "brand", "addresses",
           "operating_status", "taxonomy", "bbox"]
BW_BOUNDS = (47.50, 7.48, 49.82, 10.52)  # süd, west, nord, ost
MIN_CONFIDENCE = 0.5   # darunter: zu unsicher
SURE = 0.7             # darunter: als "unsicher" gekennzeichnet
ATTRIBUTION = "Overture Maps Foundation (CDLA-Permissive-2.0)"

# Domains, die keine eigene Firmen-Website sind (für den Dubletten-Abgleich wertlos)
PLATFORMS = {"facebook.com", "instagram.com", "google.com", "business.site", "sites.google.com", "linktr.ee",
             "wixsite.com", "jimdo.com", "jimdofree.com", "booking.com", "tripadvisor.de", "tripadvisor.com",
             "yelp.de", "yelp.com", "linkedin.com", "xing.com", "twitter.com", "x.com", "youtube.com", "tiktok.com",
             "goo.gl", "bit.ly", "t-online.de", "gmx.de", "web.de", "wordpress.com", "blogspot.com", "ebay.de",
             "ebay-kleinanzeigen.de", "kleinanzeigen.de", "gelbeseiten.de", "dasoertliche.de", "11880.com"}


def norm_phone(value):
    """Telefonnummer in deutsche Schreibweise ohne Zeichen: '+49 7131 57-0' -> '0713157 0'."""
    digits = re.sub(r"\D", "", (value or "").replace("(0)", ""))
    if digits.startswith("0049"):
        digits = "0" + digits[4:]
    elif digits.startswith("049") and len(digits) >= 12:
        digits = "0" + digits[3:]
    elif digits.startswith("49") and len(digits) >= 11:
        digits = "0" + digits[2:]
    elif digits and not digits.startswith("0"):
        digits = "0" + digits
    while digits.startswith("049") and len(digits) >= 12:  # doppelte Ländervorwahl: +49 49 711 …
        digits = "0" + digits[3:]
    return digits if 7 <= len(digits) <= 14 else ""


def norm_domain(value):
    value = (value or "").strip().lower()
    if "@" in value:
        value = value.rsplit("@", 1)[1]
    value = re.sub(r"^[a-z]+://", "", value).split("/")[0].split("?")[0].split(":")[0]
    if value.startswith("www."):
        value = value[4:]
    return value if "." in value else ""


def _bbox_filter(bounds):
    import pyarrow.compute as pc

    south, west, north, east = bounds
    x, y = pc.field("bbox", "xmin"), pc.field("bbox", "ymin")
    return (x >= west) & (x <= east) & (y >= south) & (y <= north)


def latest_release(fs):
    import pyarrow.fs as pafs

    infos = fs.get_file_info(pafs.FileSelector(f"{BUCKET}/release/", recursive=False))
    names = sorted(i.base_name for i in infos if i.type == pafs.FileType.Directory)
    if not names:
        raise RuntimeError("Keine Overture-Version gefunden")
    return names[-1]


def place_to_lead(row):
    """Overture-Datensatz -> Lead (oder None, wenn kein Werbekunde / zu unsicher)."""
    if row.get("operating_status") == "permanently_closed":
        return None
    confidence = row.get("confidence") or 0
    if confidence < MIN_CONFIDENCE:
        return None
    address = ((row.get("addresses") or [None])[0]) or {}
    if address.get("country") and address["country"] != "DE":
        return None
    taxonomy = row.get("taxonomy") or {}
    category = classify_overture(taxonomy.get("primary"), taxonomy.get("hierarchy"))
    name = ((row.get("names") or {}).get("primary") or "").strip()
    if not category or not name:
        return None
    phone = next((p for p in map(norm_phone, row.get("phones") or []) if p), "")
    website = (row.get("websites") or [""])[0] or ""
    if confidence < SURE and not (phone or website):
        return None  # unsicher und nicht erreichbar -> wertlos
    bbox = row.get("bbox") or {}
    street = (address.get("freeform") or "").strip()
    city = (address.get("locality") or "").strip()
    brand = ((row.get("brand") or {}).get("names") or {}).get("primary") or ""
    return {
        "id": "ov:" + row["id"].replace("-", "")[:16],
        "name": name,
        "category": category,
        "kind": overture_kind(taxonomy.get("primary")),
        "address": ", ".join(filter(None, [street, " ".join(filter(None, [address.get("postcode"), city]))])),
        "city": city,
        "phone": phone,
        "email": (row.get("emails") or [""])[0] or "",
        "website": website,
        "chain": bool(brand),
        "brand": brand,
        "lat": bbox.get("ymin"),
        "lon": bbox.get("xmin"),
        "unsure": confidence < SURE,
    }


def read_places(bounds=BW_BOUNDS, release=None, log=print):
    """Liest alle Orte im Ausschnitt und gibt die brauchbaren als Leads zurück."""
    import pyarrow.dataset as ds
    import pyarrow.fs as pafs

    fs = pafs.S3FileSystem(anonymous=True, region=REGION)
    release = release or latest_release(fs)
    log(f"Overture: lese Version {release} …")
    dataset = ds.dataset(f"{BUCKET}/release/{release}/theme=places/type=place/", filesystem=fs, format="parquet")
    leads, total = [], 0
    for batch in dataset.to_batches(filter=_bbox_filter(bounds), columns=COLUMNS):
        for row in batch.to_pylist():
            total += 1
            lead = place_to_lead(row)
            if lead:
                leads.append(lead)
    log(f"Overture: {total} Orte im Ausschnitt, {len(leads)} als Betrieb übernommen")
    return leads, release


def load(geoms, log=print, reader=None):
    """Gibt {ags: [lead, ...]} für alle Kreise zurück (Zuordnung über die Kreisgrenzen)."""
    from .osmimport import assign_kreis

    leads, _ = (reader or read_places)(log=log)
    result = {a: [] for a in geoms}
    for lead, ags in zip(leads, assign_kreis(geoms, [(l["lon"], l["lat"]) for l in leads])):
        if ags:
            lead["kreis"] = ags
            result[ags].append(lead)
    return result


# ---------- Dubletten zusammenführen ---------------------------------------
_STOP = {"gmbh", "mbh", "co", "kg", "ag", "ug", "ohg", "gbr", "ek", "e", "k", "inh", "und", "der", "die", "das",
         "the", "in", "am", "an", "im", "von", "fur", "fuer", "haftungsbeschrankt"}


def name_tokens(name):
    s = name.lower().replace("ä", "a").replace("ö", "o").replace("ü", "u").replace("ß", "ss")
    return {t for t in re.split(r"[^a-z0-9]+", s) if len(t) >= 2 and t not in _STOP}


def similar_names(a, b):
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False
    common = ta & tb
    return len(common) / min(len(ta), len(tb)) >= 0.6 or (len(common) >= 2)


def _meters(a, b):
    dy = (a["lat"] - b["lat"]) * 111200
    dx = (a["lon"] - b["lon"]) * 111200 * 0.66  # cos(48.5°)
    return (dx * dx + dy * dy) ** 0.5


def _cell(lead):
    return int(lead["lat"] / 0.002), int(lead["lon"] / 0.003)


def merge(primary, extra, contact_radius=300, name_radius=150):
    """Fügt `extra` (Overture) zu `primary` (OSM) hinzu, ohne Dubletten.

    Gleich ist ein Betrieb, wenn Telefon oder Website übereinstimmen und er in
    der Nähe liegt, oder wenn der Name sehr ähnlich ist und er nah dran liegt.
    Bei einer Dublette werden fehlende Kontaktdaten im vorhandenen Eintrag
    ergänzt. Gibt (zusammengeführte Liste, Anzahl Dubletten) zurück."""
    by_phone, by_domain, grid = {}, {}, {}
    out = []

    def index(lead):
        if lead.get("lat") is None:
            return
        for p in {norm_phone(x) for x in (lead.get("phone") or "").split(";")} - {""}:
            by_phone.setdefault(p, []).append(lead)
        d = norm_domain(lead.get("website") or "")
        if d and d not in PLATFORMS:
            by_domain.setdefault(d, []).append(lead)
        grid.setdefault(_cell(lead), []).append(lead)

    def find(lead):
        if lead.get("lat") is None:
            return None
        cands = []
        p = norm_phone(lead.get("phone") or "")
        if p:
            cands += by_phone.get(p, [])
        d = norm_domain(lead.get("website") or "")
        if d and d not in PLATFORMS:
            cands += by_domain.get(d, [])
        for c in cands:
            if _meters(c, lead) <= contact_radius:
                return c
        cy, cx = _cell(lead)
        for y in (cy - 1, cy, cy + 1):
            for x in (cx - 1, cx, cx + 1):
                for c in grid.get((y, x), []):
                    if _meters(c, lead) <= name_radius and similar_names(c["name"], lead["name"]):
                        return c
        return None

    for lead in primary:
        out.append(lead)
        index(lead)
    dupes = 0
    for lead in extra:
        match = find(lead)
        if match is None:
            out.append(lead)
            index(lead)
            continue
        dupes += 1
        for key in ("phone", "website", "email", "address", "city"):
            if not match.get(key) and lead.get(key):
                match[key] = lead[key]
        if match.get("unsure") and not lead.get("unsure"):
            match["unsure"] = False
    return out, dupes
