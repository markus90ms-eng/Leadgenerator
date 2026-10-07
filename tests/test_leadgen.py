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

from leadgen import news, overpass, service  # noqa: E402
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

RSS = b"""<?xml version="1.0"?><rss><channel>
<item><title>Neues Caf\xc3\xa9 er\xc3\xb6ffnet in B\xc3\xb6blingen - SZ/BZ</title><link>https://example.com/a</link>
<pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate><source url="https://szbz.de">SZ/BZ</source></item>
</channel></rss>"""


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


class WebExportTest(unittest.TestCase):
    def test_export_and_first_seen(self):
        from leadgen import webexport

        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "site")
            real = news.search_news
            prev = {"leads": [{"id": "osm:node/1", "first_seen": ""}]}
            with mock.patch.object(overpass, "run_query", return_value=OVERPASS_RESPONSE), \
                    mock.patch.object(news, "search_news", lambda ags, topics=None, days=30: real(ags, topics, days, fetch=lambda u: RSS)), \
                    mock.patch.object(webexport, "fetch_previous", lambda base, path: prev if "kreis" in path else None):
                self.assertEqual(webexport.main(["--out", out, "--kreis", "08115", "--pause", "0"]), 0)
            with open(os.path.join(out, "data/kreis/08115.json"), encoding="utf-8") as fh:
                leads = {l["name"]: l for l in json.load(fh)["leads"]}
            self.assertNotIn("first_seen", leads["Autohaus Müller"])  # schon bekannt
            self.assertTrue(leads["Pasta Nova"]["first_seen"])  # neu seit letztem Lauf
            self.assertTrue(os.path.exists(os.path.join(out, "index.html")))
            with open(os.path.join(out, "data/meta.json"), encoding="utf-8") as fh:
                self.assertEqual(json.load(fh)["status"]["08115"]["count"], 4)


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
