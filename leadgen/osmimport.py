"""Liest Betriebe aller Kreise aus einem OSM-Datenabzug (.osm.pbf von Geofabrik).

Robuster als einzelne Overpass-Abfragen: eine Datei, ein Durchlauf, alle 44
Kreise. Benötigt die Pakete `osmium` (pyosmium) und `shapely`.
"""

import urllib.request

from .categories import CATEGORIES, classify
from .overpass import element_to_lead
from .regions import KREISE

GEOFABRIK_URL = "https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf"

POI_KEYS = sorted({key for cat in CATEGORIES.values() for key, _ in cat["filters"]})


def download(path, url=GEOFABRIK_URL):
    req = urllib.request.Request(url, headers={"User-Agent": "Leadgenerator-BW/1.0"})
    with urllib.request.urlopen(req, timeout=600) as resp, open(path, "wb") as fh:
        while chunk := resp.read(1 << 20):
            fh.write(chunk)


def match_kreis(tags):
    """AGS des Kreises, den eine Verwaltungsgrenze darstellt (oder None).

    Landkreise tragen den 5-stelligen Schlüssel, Stadtkreise oft den
    8-stelligen Gemeindeschlüssel (z. B. 08212000 für Karlsruhe)."""
    if tags.get("boundary") != "administrative" or tags.get("admin_level") not in ("6", "8"):
        return None
    ags = tags.get("de:amtlicher_gemeindeschluessel", "")
    rs = tags.get("de:regionalschluessel", "")
    for code in KREISE:
        if ags == code or rs == code + "0000000":
            return code
        if KREISE[code]["typ"] == "Stadtkreis" and ags == code + "000":
            return code
    if tags.get("admin_level") == "6":
        for code, kreis in KREISE.items():
            if tags.get("name") == kreis["osm_name"]:
                return code
    return None


def load(path):
    """Gibt ({ags: [lead, ...]}, {ags: Kreisgrenze}) für alle Kreise zurück."""
    import osmium
    import shapely

    wkb = osmium.geom.WKBFactory()
    boundaries = {}  # ags -> (admin_level, geometry)
    pois = []  # (el, lon, lat)

    fp = (osmium.FileProcessor(path)
          .with_locations()
          .with_areas(osmium.filter.TagFilter(("boundary", "administrative")))
          .with_filter(osmium.filter.KeyFilter(*POI_KEYS, "boundary")))

    for obj in fp:
        tags = dict(obj.tags)
        if obj.is_area():
            ags = match_kreis(tags)
            if ags:
                level = int(tags["admin_level"])
                if ags not in boundaries or level < boundaries[ags][0]:
                    geom = shapely.from_wkb(bytes.fromhex(wkb.create_multipolygon(obj)))
                    boundaries[ags] = (level, geom)
            continue
        if not tags.get("name") or not classify(tags):
            continue
        if obj.is_node():
            if not obj.location.valid():
                continue
            lon, lat, kind = obj.location.lon, obj.location.lat, "node"
        elif obj.is_way():
            coords = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
            if not coords:
                continue
            lon = sum(c[0] for c in coords) / len(coords)
            lat = sum(c[1] for c in coords) / len(coords)
            kind = "way"
        else:
            continue  # Relationen als Betrieb sind selten
        el = {"type": kind, "id": obj.id, "tags": tags, "lat": lat, "lon": lon,
              "version": obj.version or None,
              "timestamp": obj.timestamp.strftime("%Y-%m-%dT%H:%M:%SZ") if obj.timestamp.year > 1970 else ""}
        pois.append(el)

    missing = sorted(set(KREISE) - set(boundaries))
    if missing:
        print("Keine Grenze gefunden für: " + ", ".join(KREISE[a]["name"] for a in missing), flush=True)

    geoms = {a: g for a, (_, g) in boundaries.items()}
    result = {a: [] for a in geoms}
    seen = set()
    for el, ags in zip(pois, assign_kreis(geoms, [(el["lon"], el["lat"]) for el in pois])):
        if not ags or (el["type"], el["id"]) in seen:
            continue
        seen.add((el["type"], el["id"]))
        lead = element_to_lead(el, ags)
        if lead:
            result[ags].append(lead)
    return result, geoms


def assign_kreis(geoms, coords):
    """Ordnet (lon, lat)-Punkte einem Kreis zu. Gibt pro Punkt die AGS oder None zurück."""
    import shapely
    from shapely.strtree import STRtree

    codes = list(geoms)
    out = [None] * len(coords)
    if not codes or not coords:
        return out
    tree = STRtree([geoms[a] for a in codes])
    for point_idx, kreis_idx in zip(*tree.query(shapely.points(coords), predicate="within")):
        if out[point_idx] is None:
            out[point_idx] = codes[kreis_idx]
    return out
