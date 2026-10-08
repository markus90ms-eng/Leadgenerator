import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from leadgen import news, overpass, service, stroeer  # noqa: E402
from leadgen.categories import classify  # noqa: E402
from leadgen.db import Store  # noqa: E402
from leadgen.regions import KREISE  # noqa: E402

RECENT = overpass.iso_months_ago(1)

OVERPASS_RESPONSE = {
    "elements": [
        {"type": "node", "id": 1, "lat": 48.68, "lon": 9.01, "version": 4, "timestamp": "2020-01-01T00:00:00Z",
         "tags": {"name": "Autohaus Müller", "shop": "car", "phone": "+49 7031 12345",
                  "website": "autohaus-mueller.de", "addr:street": "Hauptstr.", "addr:housenumber": "5",
                  "addr:postcode": "71034", "addr:city": "Böblingen"}},
        {"type": "way", "id": 2, "center": {"lat": 48.7, "lon": 9.0}, "version": 1, "timestamp": RECENT,
         "tags": {"name": "Pasta Nova", "amenity": "restaurant"}},
        {"type": "node", "id": 3, "lat": 48.7, "lon": 9.0, "version": 3, "timestamp": RECENT,
         "tags": {"name": "FitBox", "leisure": "fitness_centre", "start_date": RECENT[:7]}},
        {"type": "node", "id": 4, "lat": 48.7, "lon": 9.0, "version": 9, "timestamp": RECENT,
         "tags": {"name": "McDonald's", "amenity": "fast_food", "brand": "McDonald's"}},
        {"type": "node", "id": 5, "lat": 48.7, "lon": 9.0, "tags": {"amenity": "restaurant"}},  # ohne Name
    ]
}

STROEER_ROWS = [
    {"uid": "8115003:368:223774:GF", "sdaw": "368000022377402", "StoID": "7123", "Paechter": "0368",
     "StoNr": "223774", "Ortname": "B\u00f6blingen", "PLZ": "71034", "Anschlagart": "Gro\u00dffl\u00e4chen alle",
     "Standort": "TALSTR  10 PH LI/SINDELFINGER ALLEE", "Typ": "GF", "Netz": "0",
     "UTMBA": "48.6890684872", "UTMLA": "9.0077559091", "PreisFormatted": "47,85 \u20ac",
     "FotoName": "https://karte.stroeer.de/fileadmin/photos/08115003/135/00223774.jpg"},
    {"uid": "x", "sdaw": "252999", "Typ": "PVC", "UTMBA": "49.4", "UTMLA": "9.4", "Netz": "0"},  # außerhalb
    {"uid": "y", "sdaw": "135000009467301", "Paechter": "0135", "Typ": "GF",  # Fremdfläche
     "UTMBA": "48.6844566287", "UTMLA": "8.9943058044", "Netz": "0"},
]


def fake_stroeer_get(params):
    # Erste Seite mit Daten und "weitere vorhanden", zweite Seite leer
    if params.get("redo"):
        return [[], 0, []]
    return [STROEER_ROWS, 1, []]


RSS = b"""<?xml version="1.0"?><rss><channel>
<item><title>Neues Caf\xc3\xa9 er\xc3\xb6ffnet in B\xc3\xb6blingen - SZ/BZ</title><link>https://example.com/a</link>
<pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate><source url="https://szbz.de">SZ/BZ</source></item>
</channel></rss>"""


class StroeerTest(unittest.TestCase):
    def test_parse_and_paging(self):
        calls = []
        with mock.patch.object(stroeer.Client, "get", side_effect=lambda p: calls.append(dict(p)) or fake_stroeer_get(p)):
            rows = stroeer.Client(pause=0).tile(48.6, 8.9, 48.7, 9.05)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["clear"], 1)
        self.assertEqual((calls[1]["redo"], calls[1]["counter"]), (1, 1))
        item = stroeer.parse(rows[0])
        self.assertEqual(item["standort"], "TALSTR 10 PH LI/SINDELFINGER ALLEE")
        self.assertEqual((item["lat"], item["paechter"]), (48.689068, "368"))
        self.assertEqual([stroeer.is_stroeer(r) for r in rows], [True, True, False])

    def test_flatten_params(self):
        flat = dict(stroeer._flatten("tx", {"bounds": {"sw": "1,2"}, "zoom": 14}, []))
        self.assertEqual(flat, {"tx[bounds][sw]": "1,2", "tx[zoom]": "14"})

    def test_tiles_cover_bw(self):
        boxes = list(stroeer.tiles())
        self.assertGreater(len(boxes), 300)
        self.assertTrue(any(s <= 48.689 <= n and w <= 9.007 <= e for s, w, n, e in boxes))


class RegionsTest(unittest.TestCase):
    def test_all_44_kreise(self):
        self.assertEqual(len(KREISE), 44)
        self.assertEqual(sum(k["typ"] == "Stadtkreis" for k in KREISE.values()), 9)


class OverpassTest(unittest.TestCase):
    def test_query_contains_area_and_filters(self):
        q = overpass.build_query("08115", ["gastro"], newer_than="2026-01-01T00:00:00Z")
        self.assertIn('"de:amtlicher_gemeindeschluessel"="08115"', q)
        self.assertIn('"name"="Landkreis Böblingen"', q)
        self.assertIn('(newer:"2026-01-01T00:00:00Z")(area.kreis)', q)
        self.assertIn("out center meta;", q)

    def test_classify(self):
        self.assertEqual(classify({"shop": "car"}), "autohaus")
        self.assertEqual(classify({"craft": "electrician"}), "handwerk")
        self.assertIsNone(classify({"amenity": "bench"}))

    def test_parse_and_detect_new(self):
        with mock.patch.object(overpass, "run_query", return_value=OVERPASS_RESPONSE):
            leads = overpass.search("08115", [])
        self.assertEqual([l["name"] for l in leads], ["Autohaus Müller", "Pasta Nova", "FitBox", "McDonald's"])
        auto = leads[0]
        self.assertEqual(auto["address"], "Hauptstr. 5, 71034 Böblingen")
        self.assertEqual(leads[1]["lat"], 48.7)
        self.assertTrue(leads[3]["chain"])
        new = {l["name"]: l["new_reason"] for l in overpass.detect_new(leads, overpass.iso_months_ago(6))}
        self.assertEqual(new, {"Pasta Nova": "Neu eingetragen", "FitBox": "Neueröffnung"})


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.tmp.name, "t.db"))

    def tearDown(self):
        self.store.conn.close()
        self.tmp.cleanup()

    def test_search_scores_and_fresh_detection(self):
        with mock.patch.object(overpass, "run_query", return_value=OVERPASS_RESPONSE) as rq:
            leads = service.search_companies(self.store, "08115", ["autohaus", "gastro"])
            self.assertEqual(rq.call_count, 2)
            self.assertTrue(all(not l["fresh"] for l in leads))  # Erster Scan: nichts "neu seit letztem Scan"
            by_name = {l["name"]: l for l in leads}
            self.assertGreater(by_name["Autohaus Müller"]["score"], by_name["McDonald's"]["score"])
            self.assertEqual(by_name["Pasta Nova"]["new_reason"], "Neu eingetragen")

            # Status setzen -> landet in der Pipeline
            self.store.update("osm:node/1", status="kontaktiert", notes="Rückruf Freitag")
            self.assertEqual([l["name"] for l in self.store.pipeline()], ["Autohaus Müller"])

            # Neuer Betrieb taucht beim nächsten Scan auf -> fresh
            extra = {"type": "node", "id": 99, "lat": 1, "lon": 1, "tags": {"name": "Burger Lab", "amenity": "restaurant"}}
            rq.return_value = {"elements": OVERPASS_RESPONSE["elements"] + [extra]}
            leads = service.search_companies(self.store, "08115", ["autohaus", "gastro"], refresh=True)
            self.assertEqual(leads[0]["name"], "Burger Lab")
            self.assertTrue(leads[0]["fresh"])
            auto = next(l for l in leads if l["name"] == "Autohaus Müller")
            self.assertEqual((auto["status"], auto["notes"]), ("kontaktiert", "Rückruf Freitag"))

    def test_search_uses_cache(self):
        with mock.patch.object(overpass, "run_query", return_value=OVERPASS_RESPONSE) as rq:
            service.search_companies(self.store, "08115", ["gastro"])
            service.search_companies(self.store, "08115", ["gastro"])
            self.assertEqual(rq.call_count, 1)

    def test_find_new(self):
        with mock.patch.object(overpass, "run_query", return_value=OVERPASS_RESPONSE):
            leads = service.find_new(self.store, "08115", [], months=6)
        self.assertEqual({l["name"] for l in leads}, {"Pasta Nova", "FitBox"})
        self.assertEqual(leads[0]["name"], "FitBox")  # Neueröffnung + Fitness schlägt Gastro

    def test_invalid_status(self):
        with self.assertRaises(ValueError):
            self.store.update("x", status="quatsch")


class NewsTest(unittest.TestCase):
    def test_parse_and_dedupe(self):
        items = news.search_news("08115", ["eroeffnung"], fetch=lambda url: RSS)
        self.assertEqual(len(items), 1)  # gleicher Artikel aus 4 Orts-Abfragen -> 1x
        self.assertEqual(items[0]["title"], "Neues Café eröffnet in Böblingen")
        self.assertEqual(items[0]["published"], "2026-10-05")
        self.assertEqual(items[0]["topic"], "Neueröffnung")

    def test_feed_url(self):
        url = news.feed_url('"Startup" "Ulm"', 30)
        self.assertIn("news.google.com/rss/search", url)
        self.assertIn("when%3A30d", url)


try:
    import osmium  # noqa: F401
    import shapely  # noqa: F401
    HAS_OSMIUM = True
except ImportError:
    HAS_OSMIUM = False

MINI_OSM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "mini.osm")


@unittest.skipUnless(HAS_OSMIUM, "osmium/shapely nicht installiert")
class WebExportTest(unittest.TestCase):
    def test_osm_import_assigns_kreis(self):
        from leadgen import osmimport

        leads, boundaries = osmimport.load(MINI_OSM)
        self.assertEqual(list(boundaries), ["08115"])
        names = {l["name"]: l for l in leads["08115"]}
        self.assertEqual(set(names), {"Autohaus Müller", "FitBox", "Pasta Nova"})  # ohne "Außerhalb" und Bank
        self.assertEqual(names["Pasta Nova"]["id"], "osm:way/200")
        self.assertEqual(names["FitBox"]["start_date"], "2026-09-01")
        self.assertEqual(names["Autohaus Müller"]["osm_version"], 3)

    def test_match_kreis(self):
        from leadgen.osmimport import match_kreis

        base = {"boundary": "administrative", "admin_level": "6"}
        self.assertEqual(match_kreis({**base, "de:amtlicher_gemeindeschluessel": "08115"}), "08115")
        self.assertEqual(match_kreis({**base, "de:amtlicher_gemeindeschluessel": "08212000"}), "08212")
        self.assertEqual(match_kreis({**base, "de:regionalschluessel": "084360000000"}), "08436")
        self.assertEqual(match_kreis({**base, "name": "Ortenaukreis"}), "08317")
        self.assertIsNone(match_kreis({**base, "admin_level": "8", "de:amtlicher_gemeindeschluessel": "08115003"}))

    def test_export_and_first_seen(self):
        from leadgen import webexport

        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "site")
            real = news.search_news
            prev = {"updated": "2026-01-01", "leads": [{"id": "osm:node/10", "first_seen": ""}]}
            with mock.patch.object(news, "search_news", lambda ags, topics=None, days=30: real(ags, topics, days, fetch=lambda u: RSS)), \
                    mock.patch.object(webexport, "fetch_previous",
                                      lambda base, path: prev if path == "data/kreis/08115.json" else None):
                with mock.patch.object(stroeer.Client, "get", side_effect=fake_stroeer_get):
                    self.assertEqual(webexport.main(["--out", out, "--pbf", MINI_OSM, "--previous", "x"]), 0)
            with open(os.path.join(out, "data/kreis/08115.json"), encoding="utf-8") as fh:
                leads = {l["name"]: l for l in json.load(fh)["leads"]}
            self.assertNotIn("first_seen", leads["Autohaus Müller"])  # schon bekannt
            self.assertTrue(leads["Pasta Nova"]["first_seen"])  # neu seit letztem Lauf
            self.assertTrue(os.path.exists(os.path.join(out, "index.html")))
            with open(os.path.join(out, "data/meta.json"), encoding="utf-8") as fh:
                status = json.load(fh)["status"]
            self.assertEqual(status["08115"]["count"], 3)
            self.assertEqual(status["08111"]["count"], 0)
            self.assertEqual(status["08115"]["stroeer"], 1)  # einer innerhalb, einer außerhalb des Kreises
            with open(os.path.join(out, "data/stroeer/08115.json"), encoding="utf-8") as fh:
                item = json.load(fh)["items"][0]
            self.assertEqual((item["typ"], item["id"], item["paechter"]), ("GF", "368000022377402", "368"))
            self.assertNotIn("preis", item)

    def test_first_seen_ignores_empty_or_baseline_data(self):
        from leadgen.webexport import carry_first_seen

        leads = [{"id": "a"}, {"id": "b"}]
        # Vorher leerer Stand -> nichts ist "neu"
        self.assertEqual(carry_first_seen(leads, {"updated": "2026-10-01", "leads": []}, "2026-10-08"), "2026-10-08")
        self.assertFalse(any(l.get("first_seen") for l in leads))
        # Alter Stand ohne baseline, in dem alles am selben Tag "neu" war -> zählt als baseline
        prev = {"updated": "2026-10-07", "leads": [{"id": "a", "first_seen": "2026-10-07"}]}
        self.assertEqual(carry_first_seen(leads, prev, "2026-10-08"), "2026-10-07")
        self.assertEqual([l["first_seen"] for l in leads], ["", "2026-10-08"])


class ServerTest(unittest.TestCase):
    def test_api_roundtrip(self):
        import app

        tmp = tempfile.TemporaryDirectory()
        app.Handler.store = Store(os.path.join(tmp.name, "t.db"))
        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            meta = json.load(urllib.request.urlopen(base + "/api/meta"))
            self.assertEqual(len(meta["kreise"]), 44)
            self.assertIn("<title>Leadgenerator BW</title>", urllib.request.urlopen(base + "/").read().decode())
            with mock.patch.object(overpass, "run_query", return_value=OVERPASS_RESPONSE):
                leads = json.load(urllib.request.urlopen(base + "/api/search?kreis=08115&cats=gastro"))
            self.assertEqual({l["name"] for l in leads}, {"Pasta Nova", "McDonald's"})
            req = urllib.request.Request(base + "/api/leads/" + urllib.request.quote(leads[0]["id"], safe=""),
                                         data=json.dumps({"status": "termin"}).encode(), method="POST")
            self.assertTrue(json.load(urllib.request.urlopen(req))["ok"])
            pipeline = json.load(urllib.request.urlopen(base + "/api/pipeline"))
            self.assertEqual(pipeline[0]["status"], "termin")
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(base + "/api/search?kreis=99999")
            self.assertEqual(ctx.exception.code, 404)
        finally:
            server.shutdown()
            app.Handler.store.conn.close()
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
