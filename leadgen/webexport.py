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

from . import news, osmimport
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
    args = parser.parse_args(argv)

    shutil.rmtree(args.out, ignore_errors=True)
    shutil.copytree(WEB_DIR, args.out)
    today = date.today().isoformat()

    if not os.path.exists(args.pbf):
        print(f"Lade {osmimport.GEOFABRIK_URL} …", flush=True)
        osmimport.download(args.pbf)
    print("Lese Betriebe aus OSM-Daten …", flush=True)
    leads_by_kreis = osmimport.load(args.pbf)

    status, updated = {}, 0
    for ags, kreis in KREISE.items():
        leads = leads_by_kreis.get(ags) or []
        previous = fetch_previous(args.previous, f"data/kreis/{ags}.json")
        if leads:
            baseline = carry_first_seen(leads, previous, today)
            write(args.out, f"data/kreis/{ags}.json",
                  {"kreis": ags, "updated": today, "baseline": baseline, "leads": [compact(l) for l in leads]})
            status[ags] = {"updated": today, "count": len(leads)}
            updated += 1
        else:
            status[ags] = keep_previous(ags, args.out, previous)
        status[ags]["news"] = export_news(ags, args.out, args.previous, today)
        print(f"{kreis['name']}: {status[ags]['count']} Betriebe, {status[ags]['news']} Meldungen", flush=True)

    write(args.out, "data/meta.json", {
        "generated": today,
        "kreise": list(KREISE.values()),
        "categories": [{"id": c["id"], "name": c["name"], "weight": c["weight"]} for c in CATEGORIES.values()],
        "topics": news.TOPIC_LABELS,
        "status": status,
    })
    print(f"Fertig. {updated}/{len(KREISE)} Kreise aktualisiert.")
    return 0 if updated else 1


if __name__ == "__main__":
    sys.exit(main())
