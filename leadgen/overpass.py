"""Firmendaten aus OpenStreetMap über die Overpass-API (kostenlos, ohne Key)."""

import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from .categories import CATEGORIES, classify
from .regions import get_kreis

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "Leadgenerator-BW/1.0 (Vertriebstool, Kontakt ueber GitHub)"
TIMEOUT = 180


class OverpassError(RuntimeError):
    pass


def _area_statement(kreis):
    # Über den Amtlichen Gemeindeschlüssel, mit Name als Rückfallebene.
    return (
        f'(area["boundary"="administrative"]["de:amtlicher_gemeindeschluessel"="{kreis["ags"]}"];'
        f'area["boundary"="administrative"]["admin_level"="6"]["name"="{kreis["osm_name"]}"];)->.kreis;'
    )


def build_query(ags, category_ids, newer_than=None):
    """Baut die Overpass-QL-Abfrage.

    newer_than: ISO-Datum; dann werden nur Objekte geliefert, die seitdem in
    OSM angelegt oder geändert wurden (Basis für die Neugründungs-Erkennung).
    """
    kreis = get_kreis(ags)
    newer = f'(newer:"{newer_than}")' if newer_than else ""
    parts = []
    for cid in category_ids:
        for key, pattern in CATEGORIES[cid]["filters"]:
            parts.append(f'nwr["{key}"~"{pattern}"]["name"]{newer}(area.kreis);')
    return (
        f"[out:json][timeout:{TIMEOUT}];"
        + _area_statement(kreis)
        + "(" + "".join(parts) + ");"
        + "out center meta;"
    )


def run_query(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    last_error = None
    for url in ENDPOINTS:
        req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT + 20) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if payload.get("remark") and not payload.get("elements"):
                raise OverpassError(payload["remark"])
            return payload
        except Exception as exc:  # nächsten Server probieren
            last_error = exc
    raise OverpassError(f"Overpass nicht erreichbar: {last_error}")


def _address(tags):
    street = " ".join(filter(None, [tags.get("addr:street"), tags.get("addr:housenumber")]))
    city = " ".join(filter(None, [tags.get("addr:postcode"), tags.get("addr:city")]))
    return ", ".join(filter(None, [street, city]))


def _first(tags, *keys):
    for key in keys:
        if tags.get(key):
            return tags[key].split(";")[0].strip()
    return ""


def _parse_date(value):
    """OSM-Datumsangaben wie 2026, 2026-05 oder 2026-05-01 -> date-String YYYY-MM-DD."""
    if not value:
        return ""
    value = value.strip()[:10]
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


def element_to_lead(el, ags):
    tags = el.get("tags", {})
    category = classify(tags)
    if not category or not tags.get("name"):
        return None
    lat = el.get("lat") or el.get("center", {}).get("lat")
    lon = el.get("lon") or el.get("center", {}).get("lon")
    kind = tags.get("shop") or tags.get("amenity") or tags.get("craft") or tags.get("office") \
        or tags.get("leisure") or tags.get("tourism") or tags.get("healthcare") or ""
    return {
        "id": f"osm:{el['type']}/{el['id']}",
        "name": tags["name"],
        "category": category,
        "kind": kind,
        "kreis": ags,
        "address": _address(tags),
        "city": tags.get("addr:city", ""),
        "phone": _first(tags, "phone", "contact:phone", "contact:mobile"),
        "email": _first(tags, "email", "contact:email"),
        "website": _first(tags, "website", "contact:website", "url"),
        "opening_hours": tags.get("opening_hours", ""),
        "chain": bool(tags.get("brand") or tags.get("brand:wikidata")),
        "brand": tags.get("brand", ""),
        "lat": lat,
        "lon": lon,
        "start_date": _parse_date(tags.get("start_date") or tags.get("opening_date")),
        "osm_version": el.get("version"),
        "osm_timestamp": el.get("timestamp", ""),
        "osm_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
    }


def search(ags, category_ids, newer_than=None):
    payload = run_query(build_query(ags, category_ids, newer_than))
    leads, seen = [], set()
    for el in payload.get("elements", []):
        lead = element_to_lead(el, ags)
        if lead and lead["id"] not in seen and (not category_ids or lead["category"] in category_ids):
            seen.add(lead["id"])
            leads.append(lead)
    return leads


def detect_new(leads, since):
    """Markiert Neugründungen/Neueröffnungen.

    - Eröffnungsdatum (start_date/opening_date) liegt nach `since` -> "Neueröffnung"
    - Objekt wurde seit `since` erstmals in OSM eingetragen (Version 1) -> "Neu eingetragen"
    """
    since_date = since[:10]
    result = []
    for lead in leads:
        reason = None
        if lead["start_date"] and lead["start_date"] >= since_date:
            reason = "Neueröffnung"
        elif lead.get("osm_version") == 1 and lead.get("osm_timestamp", "")[:10] >= since_date:
            reason = "Neu eingetragen"
        if reason:
            result.append({**lead, "new_reason": reason})
    return result


def iso_months_ago(months):
    now = datetime.now(timezone.utc)
    year, month = now.year, now.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(now.day, 28)
    return f"{year:04d}-{month:02d}-{day:02d}T00:00:00Z"
