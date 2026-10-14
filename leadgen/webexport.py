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
import re
import shutil
import sys
import urllib.request
from collections import Counter
from datetime import date

from . import news, osmimport, overture, stroeer
from .categories import CATEGORIES, GROUPS
from .regions import KREISE

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")

# Felder, die in die Webdaten übernommen werden (leere Werte entfallen)
FIELDS = ["id", "name", "category", "kind", "address", "city", "phone", "email", "website",
          "brand", "start_date", "osm_version", "first_seen"]


def compact(lead):
    """Lead für die Webdaten verkleinern (auch auf bereits verkleinerte Leads anwendbar)."""
    out = {k: lead[k] for k in FIELDS if lead.get(k) not in (None, "", False)}
    if lead.get("osm_timestamp"):
        out["osm_timestamp"] = lead["osm_timestamp"][:10]
    if lead.get("chain"):
        out["chain"] = 1
    if lead.get("opening_hours") or lead.get("hours"):
        out["hours"] = 1
    if lead.get("unsure") or lead.get("u"):
        out["u"] = 1  # unsicherer Eintrag (Overture, geringe Konfidenz)
    if lead.get("operator_type") or lead.get("pt"):
        out["pt"] = lead.get("operator_type") or lead.get("pt")
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


def plz_of(lead):
    m = re.search(r"\b(\d{5})\b", lead.get("address") or "")
    return m.group(1) if m else ""


def search_row(lead, ags):
    """Eintrag im Suchindex für den Abgleich mit Fotos (Name, Telefon, Domain, PLZ)."""
    phones = {norm_phone(p) for p in (lead.get("phone") or "").split(";")}
    domains = {norm_domain(lead.get(k) or "") for k in ("website", "email")}
    return [lead["id"], lead.get("name", ""), ags, " ".join(sorted(p for p in phones if p)),
            " ".join(sorted(d for d in domains if d)), plz_of(lead)]


def plz_table(rows_by_kreis):
    """PLZ -> [Kreis, Ort] nach Mehrheit der Betriebe (zum Einordnen von Adressen auf Fotos)."""
    votes = {}
    for ags, rows in rows_by_kreis:
        for lead in rows:
            plz = plz_of(lead)
            if plz:
                votes.setdefault(plz, Counter())[(ags, lead.get("city") or "")] += 1
    table = {}
    for plz, counter in votes.items():
        kreis = Counter()
        for (ags, _), n in counter.items():
            kreis[ags] += n
        best = kreis.most_common(1)[0][0]
        city = Counter({c: n for (a, c), n in counter.items() if a == best and c}).most_common(1)
        table[plz] = [best, city[0][0] if city else ""]
    return table


MOBILE = ("015", "016", "017")


def vorwahl_table(rows_by_kreis, min_count=15, share=0.6):
    """Vorwahl (4-6 Stellen inkl. 0) -> Kreis, wenn die Mehrheit der Betriebe dort liegt."""
    votes = {}
    for ags, rows in rows_by_kreis:
        for lead in rows:
            for p in {norm_phone(x) for x in (lead.get("phone") or "").split(";")} - {""}:
                if p.startswith(MOBILE):
                    continue
                for n in (4, 5, 6):
                    votes.setdefault(p[:n], Counter())[ags] += 1
    table = {}
    for prefix, counter in votes.items():
        ags, n = counter.most_common(1)[0]
        total = sum(counter.values())
        if total >= min_count and n / total >= share:
            table[prefix] = ags
    return table


def export_overture(boundaries, skip=False):
    """Overture-Betriebe je Kreis, oder None (nicht geladen -> Bestand vom letzten Lauf nutzen)."""
    if skip or not boundaries:
        return None
    try:
        return overture.load(boundaries, log=lambda m: print(m, flush=True))
    except Exception as exc:
        print(f"Overture: Abruf fehlgeschlagen: {exc}", flush=True)
        return None


def fetch_previous(base, path):
    if not base:
        return None
    try:
        with urllib.request.urlopen(f"{base.rstrip('/')}/{path}", timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def source_of(lead_id):
    """'osm:node/1' -> 'osm', 'ov:…' -> 'ov'"""
    return lead_id.split(":", 1)[0] if ":" in lead_id else ""


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
    sources = {source_of(l["id"]) for l in prev_leads}
    for lead in leads:
        if source_of(lead["id"]) not in sources:
            lead.pop("first_seen", None)  # neue Datenquelle: Bestand, nicht "neu"
            continue
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
    parser.add_argument("--skip-overture", action="store_true", help="Overture-Betriebe nicht neu abrufen")
    args = parser.parse_args(argv)

    shutil.rmtree(args.out, ignore_errors=True)
    shutil.copytree(WEB_DIR, args.out)
    today = date.today().isoformat()

    if not os.path.exists(args.pbf):
        print(f"Lade {osmimport.GEOFABRIK_URL} …", flush=True)
        osmimport.download(args.pbf)
    print("Lese Betriebe aus OSM-Daten …", flush=True)
    leads_by_kreis, boundaries = osmimport.load(args.pbf)
    overture_by_kreis = export_overture(boundaries, args.skip_overture)
    stroeer_by_kreis = export_stroeer(boundaries, args.skip_stroeer)

    status, updated, all_rows = {}, 0, []
    for ags, kreis in KREISE.items():
        leads = leads_by_kreis.get(ags) or []
        previous = fetch_previous(args.previous, f"data/kreis/{ags}.json")
        if overture_by_kreis is not None:
            extra = overture_by_kreis.get(ags) or []
        else:  # Overture nicht erreichbar: Einträge vom letzten Lauf weiterverwenden
            unsure = fetch_previous(args.previous, f"data/kreis/{ags}-unsicher.json") or {}
            extra = [l for l in ((previous or {}).get("leads") or []) + (unsure.get("leads") or [])
                     if l.get("id", "").startswith("ov:")]
        osm_count = len(leads)
        if leads:
            leads, dupes = overture.merge(leads, extra)
            print(f"{kreis['name']}: {osm_count} aus OSM + {len(leads) - osm_count} aus Overture "
                  f"({dupes} Dubletten zusammengeführt)", flush=True)
        if leads:
            baseline = carry_first_seen(leads, previous, today)
            rows = [compact(l) for l in leads]
            sure = [r for r in rows if not r.get("u")]
            write(args.out, f"data/kreis/{ags}.json",
                  {"kreis": ags, "updated": today, "baseline": baseline, "leads": sure})
            # Unsichere Einträge separat – die Seite lädt sie nur auf Wunsch
            write(args.out, f"data/kreis/{ags}-unsicher.json",
                  {"kreis": ags, "updated": today, "leads": [r for r in rows if r.get("u")]})
            status[ags] = {"updated": today, "count": len(sure), "unsure": len(rows) - len(sure), "osm": osm_count}
            updated += 1
        else:
            status[ags] = keep_previous(ags, args.out, previous)
            rows = (previous or {}).get("leads") or []
        write(args.out, f"data/suche/{ags}.json", {"kreis": ags, "rows": [search_row(l, ags) for l in rows if l.get("id")]})
        all_rows.append((ags, rows))
        status[ags]["news"] = export_news(ags, args.out, args.previous, today)
        status[ags]["stroeer"] = write_stroeer(ags, args.out, args.previous, today, stroeer_by_kreis)
        print(f"{kreis['name']}: {status[ags]['count']} Betriebe, {status[ags]['news']} Meldungen, "
              f"{status[ags]['stroeer']} Ströer-Flächen", flush=True)

    write(args.out, "data/suche/meta.json", {"fields": ["id", "name", "kreis", "phone", "domain", "plz"],
                                             "plz": plz_table(all_rows), "vorwahl": vorwahl_table(all_rows)})
    write(args.out, "data/meta.json", {
        "generated": today,
        "kreise": list(KREISE.values()),
        "groups": [{"id": g, "name": n} for g, n in GROUPS],
        "categories": [{"id": c["id"], "name": c["name"], "group": c["group"], "weight": c["weight"]}
                       for c in CATEGORIES.values()],
        "sources": ["OpenStreetMap-Mitwirkende (ODbL)", overture.ATTRIBUTION],
        "topics": news.TOPIC_LABELS,
        "media": stroeer.MEDIA,
        "media_groups": stroeer.GROUPS,
        "status": status,
    })
    print(f"Fertig. {updated}/{len(KREISE)} Kreise aktualisiert.")
    return 0 if updated else 1


if __name__ == "__main__":
    sys.exit(main())
