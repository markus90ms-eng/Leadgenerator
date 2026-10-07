"""Stadt- und Landkreise in Baden-Württemberg.

Schlüssel = Amtlicher Gemeindeschlüssel (AGS) auf Kreisebene. Damit wird das
Gebiet in OpenStreetMap eindeutig gefunden. "orte" sind die wichtigsten Städte
im Kreis – sie werden für den News-Radar (Neueröffnungen / Gründungen) genutzt.
"""

REGIERUNGSBEZIRKE = {
    "081": "Regierungsbezirk Stuttgart",
    "082": "Regierungsbezirk Karlsruhe",
    "083": "Regierungsbezirk Freiburg",
    "084": "Regierungsbezirk Tübingen",
}

# (AGS, Anzeigename, OSM-Name, Typ, wichtige Orte)
_KREISE = [
    ("08111", "Stuttgart (Stadtkreis)", "Stuttgart", "Stadtkreis", ["Stuttgart"]),
    ("08115", "Landkreis Böblingen", "Landkreis Böblingen", "Landkreis", ["Böblingen", "Sindelfingen", "Leonberg", "Herrenberg"]),
    ("08116", "Landkreis Esslingen", "Landkreis Esslingen", "Landkreis", ["Esslingen", "Filderstadt", "Nürtingen", "Kirchheim unter Teck"]),
    ("08117", "Landkreis Göppingen", "Landkreis Göppingen", "Landkreis", ["Göppingen", "Geislingen an der Steige", "Eislingen"]),
    ("08118", "Landkreis Ludwigsburg", "Landkreis Ludwigsburg", "Landkreis", ["Ludwigsburg", "Bietigheim-Bissingen", "Kornwestheim"]),
    ("08119", "Rems-Murr-Kreis", "Rems-Murr-Kreis", "Landkreis", ["Waiblingen", "Fellbach", "Schorndorf", "Backnang"]),
    ("08121", "Heilbronn (Stadtkreis)", "Heilbronn", "Stadtkreis", ["Heilbronn"]),
    ("08125", "Landkreis Heilbronn", "Landkreis Heilbronn", "Landkreis", ["Neckarsulm", "Eppingen", "Bad Rappenau", "Weinsberg"]),
    ("08126", "Hohenlohekreis", "Hohenlohekreis", "Landkreis", ["Künzelsau", "Öhringen"]),
    ("08127", "Landkreis Schwäbisch Hall", "Landkreis Schwäbisch Hall", "Landkreis", ["Schwäbisch Hall", "Crailsheim"]),
    ("08128", "Main-Tauber-Kreis", "Main-Tauber-Kreis", "Landkreis", ["Tauberbischofsheim", "Wertheim", "Bad Mergentheim"]),
    ("08135", "Landkreis Heidenheim", "Landkreis Heidenheim", "Landkreis", ["Heidenheim an der Brenz", "Giengen"]),
    ("08136", "Ostalbkreis", "Ostalbkreis", "Landkreis", ["Aalen", "Schwäbisch Gmünd", "Ellwangen"]),
    ("08211", "Baden-Baden (Stadtkreis)", "Baden-Baden", "Stadtkreis", ["Baden-Baden"]),
    ("08212", "Karlsruhe (Stadtkreis)", "Karlsruhe", "Stadtkreis", ["Karlsruhe"]),
    ("08215", "Landkreis Karlsruhe", "Landkreis Karlsruhe", "Landkreis", ["Bruchsal", "Ettlingen", "Bretten", "Stutensee"]),
    ("08216", "Landkreis Rastatt", "Landkreis Rastatt", "Landkreis", ["Rastatt", "Gaggenau", "Bühl"]),
    ("08221", "Heidelberg (Stadtkreis)", "Heidelberg", "Stadtkreis", ["Heidelberg"]),
    ("08222", "Mannheim (Stadtkreis)", "Mannheim", "Stadtkreis", ["Mannheim"]),
    ("08225", "Neckar-Odenwald-Kreis", "Neckar-Odenwald-Kreis", "Landkreis", ["Mosbach", "Buchen"]),
    ("08226", "Rhein-Neckar-Kreis", "Rhein-Neckar-Kreis", "Landkreis", ["Weinheim", "Sinsheim", "Wiesloch", "Leimen", "Schwetzingen"]),
    ("08231", "Pforzheim (Stadtkreis)", "Pforzheim", "Stadtkreis", ["Pforzheim"]),
    ("08235", "Landkreis Calw", "Landkreis Calw", "Landkreis", ["Calw", "Nagold", "Bad Wildbad"]),
    ("08236", "Enzkreis", "Enzkreis", "Landkreis", ["Mühlacker", "Neuenbürg", "Remchingen"]),
    ("08237", "Landkreis Freudenstadt", "Landkreis Freudenstadt", "Landkreis", ["Freudenstadt", "Horb am Neckar"]),
    ("08311", "Freiburg im Breisgau (Stadtkreis)", "Freiburg im Breisgau", "Stadtkreis", ["Freiburg"]),
    ("08315", "Landkreis Breisgau-Hochschwarzwald", "Landkreis Breisgau-Hochschwarzwald", "Landkreis", ["Müllheim", "Titisee-Neustadt", "Breisach"]),
    ("08316", "Landkreis Emmendingen", "Landkreis Emmendingen", "Landkreis", ["Emmendingen", "Waldkirch", "Kenzingen"]),
    ("08317", "Ortenaukreis", "Ortenaukreis", "Landkreis", ["Offenburg", "Lahr", "Kehl", "Achern"]),
    ("08325", "Landkreis Rottweil", "Landkreis Rottweil", "Landkreis", ["Rottweil", "Schramberg", "Oberndorf am Neckar"]),
    ("08326", "Schwarzwald-Baar-Kreis", "Schwarzwald-Baar-Kreis", "Landkreis", ["Villingen-Schwenningen", "Donaueschingen", "St. Georgen"]),
    ("08327", "Landkreis Tuttlingen", "Landkreis Tuttlingen", "Landkreis", ["Tuttlingen", "Spaichingen"]),
    ("08335", "Landkreis Konstanz", "Landkreis Konstanz", "Landkreis", ["Konstanz", "Singen", "Radolfzell"]),
    ("08336", "Landkreis Lörrach", "Landkreis Lörrach", "Landkreis", ["Lörrach", "Weil am Rhein", "Rheinfelden (Baden)"]),
    ("08337", "Landkreis Waldshut", "Landkreis Waldshut", "Landkreis", ["Waldshut-Tiengen", "Bad Säckingen"]),
    ("08415", "Landkreis Reutlingen", "Landkreis Reutlingen", "Landkreis", ["Reutlingen", "Metzingen", "Pfullingen"]),
    ("08416", "Landkreis Tübingen", "Landkreis Tübingen", "Landkreis", ["Tübingen", "Rottenburg am Neckar", "Mössingen"]),
    ("08417", "Zollernalbkreis", "Zollernalbkreis", "Landkreis", ["Balingen", "Albstadt", "Hechingen"]),
    ("08421", "Ulm (Stadtkreis)", "Ulm", "Stadtkreis", ["Ulm"]),
    ("08425", "Alb-Donau-Kreis", "Alb-Donau-Kreis", "Landkreis", ["Ehingen (Donau)", "Laichingen", "Blaubeuren"]),
    ("08426", "Landkreis Biberach", "Landkreis Biberach", "Landkreis", ["Biberach an der Riß", "Laupheim", "Riedlingen"]),
    ("08435", "Bodenseekreis", "Bodenseekreis", "Landkreis", ["Friedrichshafen", "Überlingen", "Markdorf"]),
    ("08436", "Landkreis Ravensburg", "Landkreis Ravensburg", "Landkreis", ["Ravensburg", "Weingarten", "Wangen im Allgäu", "Leutkirch"]),
    ("08437", "Landkreis Sigmaringen", "Landkreis Sigmaringen", "Landkreis", ["Sigmaringen", "Pfullendorf", "Bad Saulgau"]),
]

KREISE = {
    ags: {
        "ags": ags,
        "name": name,
        "osm_name": osm_name,
        "typ": typ,
        "orte": orte,
        "bezirk": REGIERUNGSBEZIRKE[ags[:3]],
    }
    for ags, name, osm_name, typ, orte in _KREISE
}


def get_kreis(ags):
    kreis = KREISE.get(ags)
    if not kreis:
        raise KeyError(f"Unbekannter Kreis: {ags}")
    return kreis
