"""Baut die Web-Version: liest Betriebe aller Kreise aus dem OSM-Datenabzug
für Baden-Württemberg, sammelt News und schreibt statische JSON-Dateien plus
die Weboberfläche in einen Ausgabeordner.

    python -m leadgen.webexport --out site --pbf bw.osm.pbf --previous https://<user>.github.io/<repo>

Läuft automatisch per GitHub Actions. Fehlt für einen Kreis etwas, werden die
Daten des letzten erfolgreichen Laufs (von --previous) weiterverwendet.
"""

import argparse
import json
import os
import shutil
import sys
import urllib.request
from datetime import date

from . import news, osmimport, stroeer
from .categories import CATEGORIES
from .regions import KREISE

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")

# Felder, die in die Webdaten übernommen werden (leere Werte entfallen)
FIELDS = ["id", "name", "category", "kind", "address", "city", "phone", "email", "website",
          "brand", "start_date", "osm_version", "first_seen"]


def compact(lead):
    out = {k: lead[k] for k in FIELDS if lead.get(k) not in (None, "", False)}
    out["osm_timestamp"] = (lead.get("osm_timestamp") or "")[:10]
    if lead.get("chain"):
        out["chain"] = 1
    if lead.get("opening_hours"):
        out["hours"] = 1
    if lead.get("lat") is not None:
        out["lat"], out["lon"] = round(lead["lat"], 5), round(lead["lon"], 5)
    return out


WEBMAIL = {"gmail.com", "googlemail.com", "web.de", "gmx.de", "gmx.net", "t-online.de", "outlook.com", "outlook.de",
           "hotmail.com", "hotmail.de", "yahoo.com", "yahoo.de", "icloud.com", "freenet.de", "arcor.de", "aol.com"}


def norm_phone(value):
    """'+49 (0)711 12-34' -> '07111234' (deutsche Schreibweise ohne Zeichen)"""
    digits = "".join(c for c in value.replace("(0)", "") if c.isdigit() or c == "+")
    if digits.startswith("+49"):
        digits = "0" + digits[3:]
    elif digits.startswith("0049"):
        digits = "0" + digits[4:]
    digits = digits.replace("+", "")
    return digits if len(digits) >= 6 else ""


def norm_domain(value):
    value = value.strip().lower()
    if "@" in value:
        value = value.rsplit("@", 1)[1]
    for prefix in ("https://", "http://"):
        if value.startswith(prefix):
            value = value[len(prefix):]
    value = value.split("/")[0].split("?")[0].split(":")[0]
    if value.startswith("www."):
        value = value[4:]
    return "" if "." not in value or value in WEBMAIL else value


def search_row(lead, ags):
    """Eintrag im Suchindex für den Abgleich mit Fotos (Name, Telefon, Domain)."""
    phones = {norm_phone(p) for p in (lead.get("phone") or "").split(";")}
    domains = {norm_domain(lead.get(k) or "") for k in ("website", "email")}
    return [lead["id"], lead.get("name", ""), ags, " ".join(sorted(p for p in phones if p)),
            " ".join(sorted(d for d in domains if d))]


def fetch_previous(base, path):
    if not base:
        return None
    try:
        with urllib.request.urlopen(f"{base.rstrip('/')}/{path}", timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def carry_first_seen(leads, previous, today):
    """first_seen = Datum, an dem ein Betrieb erstmals im Scan auftauchte.

    Alles, was schon beim ersten vollständigen Scan eines Kreises (baseline)
    da war, gilt nicht als neu. Gibt die baseline zurück."""
    prev_leads = (previous or {}).get("leads") or []
    if not prev_leads:
        for lead in leads:
            lead.pop("first_seen", None)
        return today
    dates = [l["first_seen"] for l in prev_leads if l.get("first_seen")]
    baseline = previous.get("baseline") or min(dates + [previous.get("updated") or today])
    known = {l["id"]: l.get("first_seen", "") for l in prev_leads}
    for lead in leads:
        seen = known[lead["id"]] if lead["id"] in known else today
        lead["first_seen"] = seen if seen and seen > baseline else ""
    return baseline


def keep_previous(ags, out, previous):
    """Kreis ohne neue Daten: Stand vom letzten Lauf weiterverwenden."""
    if not previous:
        return {"updated": "", "count": 0}
    write(out, f"data/kreis/{ags}.json", previous)
    return {"updated": previous.get("updated", ""), "count": len(previous.get("leads", []))}


def export_news(ags, out, previous_base, today):
    path = f"data/news/{ags}.json"
    items = news.search_news(ags, days=60)
    if not items:
        previous = fetch_previous(previous_base, path)
        if previous:
            write(out, path, previous)
            return len(previous.get("items", []))
    write(out, path, {"kreis": ags, "updated": today, "items": items})
    return len(items)


def export_stroeer(boundaries, skip=False):
    """Ströer-Standorte für ganz BW laden und den Kreisen zuordnen.
    None = nicht (vollständig) geladen -> Daten vom letzten Lauf behalten."""
    if skip or not boundaries:
        return None
    from shapely.ops import unary_union

    print("Lade Ströer-Standorte …", flush=True)
    try:
        items, complete = stroeer.fetch_all(unary_union(list(boundaries.values())),
                                            log=lambda m: print(m, flush=True))
    except Exception as exc:
        print(f"Ströer: Abruf fehlgeschlagen: {exc}", flush=True)
        return None
    print(f"Ströer: {len(items)} Flächen geladen (vollständig: {complete})", flush=True)
    if not items:
        return None
    by_kreis = {ags: [] for ags in boundaries}
    for item, ags in zip(items, osmimport.assign_kreis(boundaries, [(i["lon"], i["lat"]) for i in items])):
        if ags:
            by_kreis[ags].append(item)
    return {"complete": complete, "items": by_kreis}


def write_stroeer(ags, out, previous_base, today, stroeer_by_kreis):
    path = f"data/stroeer/{ags}.json"
    items = (stroeer_by_kreis or {}).get("items", {}).get(ags) or []
    if not items or (stroeer_by_kreis and not stroeer_by_kreis["complete"]):
        previous = fetch_previous(previous_base, path)
        if previous and len(previous.get("items", [])) > len(items):
            write(out, path, previous)
            return len(previous["items"])
    if items:
        write(out, path, {"kreis": ags, "updated": today, "items": items})
    return len(items)


def write(out, path, payload):
    full = os.path.join(out, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="site")
    parser.add_argument("--pbf", default="baden-wuerttemberg-latest.osm.pbf",
                        help="OSM-Datei; wird von Geofabrik geladen, falls sie fehlt")
    parser.add_argument("--previous", default="", help="URL der bisher veröffentlichten Seite")
    parser.add_argument("--skip-stroeer", action="store_true", help="Ströer-Standorte nicht neu abrufen")
    args = parser.parse_args(argv)

    shutil.rmtree(args.out, ignore_errors=True)
    shutil.copytree(WEB_DIR, args.out)
    today = date.today().isoformat()

    if not os.path.exists(args.pbf):
        print(f"Lade {osmimport.GEOFABRIK_URL} …", flush=True)
        osmimport.download(args.pbf)
    print("Lese Betriebe aus OSM-Daten …", flush=True)
    leads_by_kreis, boundaries = osmimport.load(args.pbf)
    stroeer_by_kreis = export_stroeer(boundaries, args.skip_stroeer)

    status, updated, index = {}, 0, []
    for ags, kreis in KREISE.items():
        leads = leads_by_kreis.get(ags) or []
        previous = fetch_previous(args.previous, f"data/kreis/{ags}.json")
        if leads:
            baseline = carry_first_seen(leads, previous, today)
            rows = [compact(l) for l in leads]
            write(args.out, f"data/kreis/{ags}.json",
                  {"kreis": ags, "updated": today, "baseline": baseline, "leads": rows})
            status[ags] = {"updated": today, "count": len(leads)}
            updated += 1
        else:
            status[ags] = keep_previous(ags, args.out, previous)
            rows = (previous or {}).get("leads") or []
        index.extend(search_row(l, ags) for l in rows if l.get("id"))
        status[ags]["news"] = export_news(ags, args.out, args.previous, today)
        status[ags]["stroeer"] = write_stroeer(ags, args.out, args.previous, today, stroeer_by_kreis)
        print(f"{kreis['name']}: {status[ags]['count']} Betriebe, {status[ags]['news']} Meldungen, "
              f"{status[ags]['stroeer']} Ströer-Flächen", flush=True)

    write(args.out, "data/suche.json", {"fields": ["id", "name", "kreis", "phone", "domain"], "rows": index})
    write(args.out, "data/meta.json", {
        "generated": today,
        "kreise": list(KREISE.values()),
        "categories": [{"id": c["id"], "name": c["name"], "weight": c["weight"]} for c in CATEGORIES.values()],
        "topics": news.TOPIC_LABELS,
        "media": stroeer.MEDIA,
        "media_groups": stroeer.GROUPS,
        "status": status,
    })
    print(f"Fertig. {updated}/{len(KREISE)} Kreise aktualisiert.")
    return 0 if updated else 1


if __name__ == "__main__":
    sys.exit(main())
