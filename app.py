#!/usr/bin/env python3
"""Leadgenerator BW – Vertriebstool zur Neukundensuche in Baden-Württemberg.

Start der Oberfläche:   python app.py
Automatischer Scan:     python app.py scan --kreis 08115 08116 --monate 6
"""

import argparse
import csv
import json
import os
import sys
import threading
import urllib.parse
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from leadgen import service
from leadgen.categories import CATEGORIES
from leadgen.db import STATUSES, Store
from leadgen.news import TOPIC_LABELS
from leadgen.regions import KREISE

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.environ.get("LEADGEN_DB", os.path.join(BASE_DIR, "leads.db"))


class Handler(SimpleHTTPRequestHandler):
    store = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s\n" % (fmt % args))

    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _params(self):
        query = urllib.parse.urlparse(self.path).query
        return {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}

    def _route(self, routes):
        path = urllib.parse.urlparse(self.path).path
        for prefix, handler in routes:
            if path == prefix or (prefix.endswith("/") and path.startswith(prefix)):
                try:
                    self._json(handler(path))
                except KeyError as exc:
                    self._json({"error": f"Nicht gefunden: {exc}"}, 404)
                except ValueError as exc:
                    self._json({"error": str(exc)}, 400)
                except Exception as exc:
                    self._json({"error": str(exc)}, 502)
                return True
        return False

    def do_GET(self):
        p = self._params()
        cats = [c for c in p.get("cats", "").split(",") if c]
        refresh = p.get("refresh") == "1"
        routes = [
            ("/api/meta", lambda _: {
                "kreise": list(KREISE.values()),
                "categories": [{"id": c["id"], "name": c["name"], "weight": c["weight"]} for c in CATEGORIES.values()],
                "statuses": STATUSES,
                "topics": TOPIC_LABELS,
            }),
            ("/api/search", lambda _: service.search_companies(self.store, p["kreis"], cats, refresh)),
            ("/api/new", lambda _: service.find_new(
                self.store, p["kreis"], cats, int(p.get("months", 6)), refresh)),
            ("/api/news", lambda _: service.news_radar(
                self.store, p["kreis"], [t for t in p.get("topics", "").split(",") if t],
                int(p.get("days", 30)), refresh)),
            ("/api/pipeline", lambda _: self.store.pipeline()),
        ]
        if not self._route(routes):
            super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")

        def update(path):
            lead_id = urllib.parse.unquote(path[len("/api/leads/"):])
            self.store.update(lead_id, body.get("status"), body.get("notes"))
            return {"ok": True}

        def manual(_):
            lead = {
                "id": "manuell:" + datetime.now().strftime("%Y%m%d%H%M%S%f"),
                "name": body.get("name") or "Unbenannt",
                "category": body.get("category", ""),
                "kind": "",
                "kreis": body.get("kreis", ""),
                "address": body.get("address", ""),
                "city": "",
                "phone": "", "email": "",
                "website": body.get("website", ""),
                "source_link": body.get("source_link", ""),
                "new_reason": body.get("new_reason", "Aus News-Radar"),
            }
            self.store.add_manual(lead)
            return {"ok": True, "id": lead["id"]}

        if not self._route([("/api/leads/", update), ("/api/manual", manual)]):
            self._json({"error": "Unbekannter Pfad"}, 404)


def serve(port, open_browser):
    Handler.store = Store(DB_PATH)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(f"Leadgenerator BW läuft auf {url}  (Beenden mit Strg+C)")
    if open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")


EXPORT_FIELDS = ["new_reason", "score", "name", "category", "kind", "address", "phone", "email",
                 "website", "start_date", "status", "notes", "osm_url"]


def scan(kreise, months, cats):
    """Automatischer Scan nach Neugründungen – für Windows-Aufgabenplanung / cron."""
    store = Store(DB_PATH)
    export_dir = os.path.join(BASE_DIR, "exports")
    os.makedirs(export_dir, exist_ok=True)
    path = os.path.join(export_dir, f"neugruendungen_{datetime.now():%Y-%m-%d}.csv")
    total = 0
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh, delimiter=";")
        writer.writerow(["kreis"] + EXPORT_FIELDS)
        for ags in kreise:
            name = KREISE[ags]["name"]
            try:
                leads = service.find_new(store, ags, cats, months, refresh=True)
            except Exception as exc:
                print(f"  {name}: Fehler – {exc}")
                continue
            print(f"  {name}: {len(leads)} neue Betriebe ({sum(l['fresh'] for l in leads)} seit letztem Scan)")
            for lead in leads:
                writer.writerow([name] + [lead.get(f, "") for f in EXPORT_FIELDS])
            total += len(leads)
    print(f"{total} Leads exportiert nach {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    s = sub.add_parser("scan", help="Neugründungen automatisch suchen und als CSV exportieren")
    s.add_argument("--kreis", nargs="*", default=list(KREISE), help="AGS der Kreise (Standard: alle)")
    s.add_argument("--monate", type=int, default=6)
    s.add_argument("--branchen", nargs="*", default=[], help=f"Kategorien: {', '.join(CATEGORIES)}")
    sub.add_parser("kreise", help="Liste aller Kreise mit Schlüssel")
    args = parser.parse_args()

    if args.cmd == "scan":
        scan(args.kreis, args.monate, args.branchen)
    elif args.cmd == "kreise":
        for k in KREISE.values():
            print(f"{k['ags']}  {k['name']}")
    else:
        serve(args.port, not args.no_browser)


if __name__ == "__main__":
    main()
