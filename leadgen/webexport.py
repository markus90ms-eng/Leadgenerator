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


def scan_kreis(ags, out, previous, today):
    """Eine OSM-Abfrage für den Kreis. Gibt die Anzahl Betriebe zurück oder None bei Fehler."""
    try:
        leads = overpass.search(ags, list(CATEGORIES))
    except Exception as exc:
        print(f"    OSM-Abfrage fehlgeschlagen: {exc}", flush=True)
        return None
    carry_first_seen(leads, previous, today)
    write(out, f"data/kreis/{ags}.json", {"kreis": ags, "updated": today, "leads": [compact(l) for l in leads]})
    return len(leads)


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
    parser.add_argument("--previous", default="", help="URL der bisher veröffentlichten Seite")
    parser.add_argument("--kreis", nargs="*", default=list(KREISE))
    parser.add_argument("--pause", type=float, default=8.0, help="Sekunden zwischen OSM-Abfragen")
    parser.add_argument("--max-minutes", type=float, default=110,
                        help="Danach keine neuen OSM-Abfragen mehr, restliche Kreise behalten alte Daten")
    args = parser.parse_args(argv)

    shutil.rmtree(args.out, ignore_errors=True)
    shutil.copytree(WEB_DIR, args.out)
    today = date.today().isoformat()
    deadline = time.monotonic() + args.max_minutes * 60

    # Kreise ohne Daten zuerst, dann die mit dem ältesten Datenstand
    prev_status = (fetch_previous(args.previous, "data/meta.json") or {}).get("status", {})
    order = sorted(args.kreis, key=lambda a: prev_status.get(a, {}).get("updated") or "")
    previous = {ags: fetch_previous(args.previous, f"data/kreis/{ags}.json") for ags in order}
    status = {ags: {"news": 0, **keep_previous(ags, args.out, previous[ags])} for ags in order}

    pending = list(order)
    for round_no in (1, 2):  # zweite Runde = erneuter Versuch für fehlgeschlagene Kreise
        failed = []
        for i, ags in enumerate(pending):
            if time.monotonic() > deadline:
                print(f"Zeitlimit erreicht – {len(pending) - i} Kreise behalten ihren alten Stand.", flush=True)
                failed += pending[i:]
                break
            print(f"[Runde {round_no} · {i + 1}/{len(pending)}] {KREISE[ags]['name']}", flush=True)
            count = scan_kreis(ags, args.out, previous[ags], today)
            if count is None:
                failed.append(ags)
            else:
                status[ags].update(updated=today, count=count)
                print(f"    {count} Betriebe", flush=True)
            time.sleep(args.pause)
        pending = failed
        if not pending:
            break
        time.sleep(args.pause * 5)

    print("News-Radar …", flush=True)
    for ags in order:
        status[ags]["news"] = export_news(ags, args.out, args.previous, today)

    write(args.out, "data/meta.json", {
        "generated": today,
        "kreise": list(KREISE.values()),
        "categories": [{"id": c["id"], "name": c["name"], "weight": c["weight"]} for c in CATEGORIES.values()],
        "topics": news.TOPIC_LABELS,
        "status": status,
    })
    print(f"Fertig. {len(order) - len(pending)}/{len(order)} Kreise aktualisiert.")
    # Nur abbrechen, wenn gar nichts geklappt hat
    return 1 if len(pending) == len(order) else 0


if __name__ == "__main__":
    sys.exit(main())
