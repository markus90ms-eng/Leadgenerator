"""Baut die Web-Version: sammelt Firmen und News für alle Kreise und schreibt
statische JSON-Dateien plus die Weboberfläche in einen Ausgabeordner.

    python -m leadgen.webexport --out site --previous https://<user>.github.io/<repo>

Läuft automatisch per GitHub Actions. Fällt eine Abfrage aus, werden die Daten
des letzten erfolgreichen Laufs (von --previous) weiterverwendet.
"""

import argparse
import json
import os
import shutil
import sys
import time
import urllib.request
from datetime import date

from . import news, overpass
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
    Beim allerersten Lauf bleibt es leer (sonst wäre alles 'neu')."""
    if not previous:
        return
    known = {l["id"]: l.get("first_seen", "") for l in previous.get("leads", [])}
    for lead in leads:
        lead["first_seen"] = known.get(lead["id"], today)


def export_kreis(ags, out, previous_base, today, retries=2, skip=False):
    path = f"data/kreis/{ags}.json"
    previous = fetch_previous(previous_base, path)
    for attempt in range(0 if skip else retries):
        try:
            leads = overpass.search(ags, list(CATEGORIES))
            break
        except Exception as exc:
            print(f"    Versuch {attempt + 1} fehlgeschlagen: {exc}", flush=True)
            time.sleep(30 * (attempt + 1))
    else:
        if previous:
            print("    -> verwende Daten vom letzten Lauf", flush=True)
            write(out, path, previous)
            return previous.get("updated", ""), len(previous.get("leads", [])), False
        return "", 0, False
    carry_first_seen(leads, previous, today)
    payload = {"kreis": ags, "updated": today, "leads": [compact(l) for l in leads]}
    write(out, path, payload)
    return today, len(leads), True


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
    parser.add_argument("--previous", default="", help="URL der bisher veröffentlichten Seite")
    parser.add_argument("--kreis", nargs="*", default=list(KREISE))
    parser.add_argument("--pause", type=float, default=8.0, help="Sekunden zwischen OSM-Abfragen")
    parser.add_argument("--max-minutes", type=float, default=100,
                        help="Danach keine neuen OSM-Abfragen mehr, restliche Kreise behalten alte Daten")
    args = parser.parse_args(argv)

    shutil.rmtree(args.out, ignore_errors=True)
    shutil.copytree(WEB_DIR, args.out)
    today = date.today().isoformat()
    status, failed = {}, 0
    deadline = time.monotonic() + args.max_minutes * 60
    for i, ags in enumerate(args.kreis):
        print(f"[{i + 1}/{len(args.kreis)}] {KREISE[ags]['name']}", flush=True)
        skip = time.monotonic() > deadline
        if skip:
            print("    Zeitlimit erreicht -> keine neue Abfrage", flush=True)
        updated, count, ok = export_kreis(ags, args.out, args.previous, today, skip=skip)
        failed += not ok
        news_count = export_news(ags, args.out, args.previous, today)
        print(f"    {count} Betriebe, {news_count} Meldungen", flush=True)
        status[ags] = {"updated": updated, "count": count, "news": news_count}
        if not skip:
            time.sleep(args.pause)

    write(args.out, "data/meta.json", {
        "generated": today,
        "kreise": list(KREISE.values()),
        "categories": [{"id": c["id"], "name": c["name"], "weight": c["weight"]} for c in CATEGORIES.values()],
        "topics": news.TOPIC_LABELS,
        "status": status,
    })
    print(f"Fertig. {len(args.kreis) - failed}/{len(args.kreis)} Kreise aktualisiert.")
    # Nur abbrechen, wenn gar nichts geklappt hat
    return 1 if failed == len(args.kreis) else 0


if __name__ == "__main__":
    sys.exit(main())
