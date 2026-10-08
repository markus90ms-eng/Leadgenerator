"""Werbeträger-Standorte von der öffentlichen Ströer-Standortkarte (karte.stroeer.de).

Die Karte lädt ihre Standorte pro Kartenausschnitt nach. Wir fragen Baden-
Württemberg in Kacheln ab, behalten nur Ströer-eigene Flächen (erkennbar an
der Pächter-Nummer bzw. dem Anfang der SDAW-Nummer) mit öffentlichen
Stammdaten (Lage, Typ, Standortbezeichnung, Nummern) und ordnen sie den
Kreisen zu. Preise und Fremdflächen werden nicht übernommen.
"""

import http.cookiejar
import json
import time
import urllib.parse
import urllib.request
from collections import Counter

URL = "https://karte.stroeer.de/index.php?id=278&type=199"

# Pächter-Nummern der Ströer-Gesellschaften (= Anfang der SDAW-Nummer)
STROEER_PAECHTER = {"368", "252"}
USER_AGENT = "Mozilla/5.0 (Leadgenerator-BW)"

# Werbemedien laut Karte (Kürzel -> Name), Gruppen wie im Filter der Karte
MEDIA = {
    "AL": "Allgemeinstelle / Litfaßsäule",
    "BH": "Bahnhof / diverse Medien",
    "RI": "Blow Up / Riesenposter",
    "VI": "City-Light-Poster",
    "CI": "City-Star",
    "GZ": "Ganzsäule",
    "GF": "Großfläche",
    "GVN": "Mega-Light Net",
    "GVS": "Mega-Light Select",
    "VIP": "Premium-City-Light-Poster",
    "PVC": "DOOH City Light",
    "PVT": "DOOH City Tower",
    "PVGI": "DOOH Giant indoor",
    "PVGO": "DOOH Giant outdoor",
    "PVI": "DOOH Infoscreen",
    "PVM": "DOOH Mall",
    "PVR": "DOOH City Board",
    "PVS": "DOOH Station",
    "US": "Uhrenwerbung",
    "VKM": "Verkehrsmedien",
}
GROUPS = {
    "Out-of-Home klassisch": ["AL", "BH", "CI", "GZ", "GF", "US", "VKM"],
    "Premium Out-of-Home": ["RI", "VI", "VIP", "GVN", "GVS"],
    "Digital Out-of-Home": ["PVR", "PVC", "PVT", "PVI", "PVM", "PVS", "PVGI", "PVGO"],
}

# Grobe Ausdehnung von Baden-Württemberg; Kacheln außerhalb werden übersprungen
BW_BOUNDS = (47.50, 7.48, 49.82, 10.52)  # süd, west, nord, ost
TILE_LAT, TILE_LNG = 0.1, 0.15


def _flatten(prefix, value, out):
    """PHP-/jQuery-Schreibweise: a[b][c]=wert"""
    if isinstance(value, dict):
        for key, sub in value.items():
            _flatten(f"{prefix}[{key}]", sub, out)
    else:
        out.append((prefix, str(value)))
    return out


class Client:
    def __init__(self, pause=0.3, timeout=60):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.pause = pause
        self.timeout = timeout

    def get(self, params):
        query = urllib.parse.urlencode(_flatten("tx_stroeermaps_pi1", params, []) + [("_", str(int(time.time() * 1000)))])
        req = urllib.request.Request(URL + "&" + query, headers={
            "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*",
            "Referer": "https://karte.stroeer.de/index.php?id=278",
        })
        with self.opener.open(req, timeout=self.timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        time.sleep(self.pause)
        return data

    def tile(self, south, west, north, east, max_pages=30):
        """Alle Standorte eines Kartenausschnitts (die Karte liefert sie seitenweise)."""
        params = {
            "lat": round((south + north) / 2, 6),
            "lng": round((west + east) / 2, 6),
            "bounds": {"sw": f"{south},{west}", "ne": f"{north},{east}"},
            "fitBounds": 0,
            "redo": 0,
            "counter": 0,
            "zoom": 14,
            "filter": 0,
            "search": "",
            "clear": 1,
        }
        rows = []
        for page in range(max_pages):
            data = self.get(params)
            if not isinstance(data, list) or not data:
                break
            rows.extend(data[0] or [])
            more = data[1] if len(data) > 1 else 0
            if not more:
                break
            params.update(redo=1, counter=page + 1)
            params.pop("clear", None)
        return rows


def paechter_of(row):
    code = (row.get("Paechter") or "").lstrip("0")
    if code:
        return code
    sdaw = row.get("sdaw") or ""
    return next((p for p in STROEER_PAECHTER if sdaw.startswith(p)), "")


def is_stroeer(row):
    return paechter_of(row) in STROEER_PAECHTER


def parse(row):
    try:
        lat, lon = float(row["UTMBA"]), float(row["UTMLA"])
    except (KeyError, TypeError, ValueError):
        return None
    typ = row.get("Typ", "")
    return {
        "id": row.get("sdaw") or row.get("StoID") or row.get("uid"),
        "loc": row.get("uid", ""),
        "typ": typ,
        "art": row.get("Anschlagart") or MEDIA.get(typ, typ),
        "standort": " ".join((row.get("Standort") or "").split()),
        "plz": row.get("PLZ", ""),
        "ort": row.get("Ortname", ""),
        "stonr": row.get("StoNr", ""),
        "paechter": paechter_of(row),
        "netz": 1 if str(row.get("Netz", "0")) not in ("0", "") else 0,
        "foto": row.get("FotoName", ""),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
    }


def tiles(area=None):
    """Kacheln über BW; mit area (shapely-Geometrie) nur die, die BW berühren."""
    south, west, north, east = BW_BOUNDS
    lat = south
    while lat < north:
        lng = west
        while lng < east:
            box = (round(lat, 4), round(lng, 4), round(min(lat + TILE_LAT, north), 4), round(min(lng + TILE_LNG, east), 4))
            if area is None or _intersects(area, box):
                yield box
            lng += TILE_LNG
        lat += TILE_LAT


def _intersects(area, box):
    from shapely.geometry import box as shapely_box

    s, w, n, e = box
    return area.intersects(shapely_box(w, s, e, n))


def fetch_all(area=None, client=None, max_minutes=40, log=print):
    """Lädt alle Ströer-Standorte in BW. Gibt (liste, vollständig?) zurück."""
    client = client or Client()
    found, errors = {}, 0
    stats = Counter()  # nur zur Kontrolle im Protokoll: (Pächter, Typ) aller Flächen
    deadline = time.monotonic() + max_minutes * 60
    all_tiles = list(tiles(area))
    for i, box in enumerate(all_tiles):
        if time.monotonic() > deadline:
            log(f"Ströer: Zeitlimit nach {i}/{len(all_tiles)} Kacheln")
            return list(found.values()), False
        try:
            for row in client.tile(*box):
                stats[(paechter_of(row) or "?", row.get("Typ", "?"))] += 1
                if not is_stroeer(row):
                    continue
                item = parse(row)
                if item and item["id"]:
                    found[item["id"]] = item
        except Exception as exc:
            errors += 1
            log(f"Ströer: Kachel {box} fehlgeschlagen: {exc}")
            if errors >= 10 and not found:
                log("Ströer: zu viele Fehler, Abbruch")
                return [], False
        if (i + 1) % 50 == 0:
            log(f"Ströer: {i + 1}/{len(all_tiles)} Kacheln, {len(found)} Flächen")
    log("Ströer: Flächen je Pächter/Typ (alle, vor Filter): " +
        ", ".join(f"{p}/{t}: {n}" for (p, t), n in sorted(stats.items())))
    return list(found.values()), errors == 0
