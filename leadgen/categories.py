"""Gewerbe-Kategorien und wie sie in OpenStreetMap getaggt sind.

"weight" ist das Grund-Werbepotenzial (0-40) der Branche für Außenwerbung /
Digital-Out-of-Home. Branchen mit lokaler Kundschaft und freiem Werbebudget
(Autohaus, Möbel, Fitness, Gastro) liegen oben; Branchen mit Werbebeschränkungen
(Ärzte nach Heilmittelwerbegesetz, Anwälte nach Berufsrecht) unten.
"""

# id: (Anzeigename, Gewicht, [(OSM-Key, Regex für Werte)])
_CATEGORIES = [
    ("autohaus", "Autohäuser & Kfz", 40, [("shop", "^(car|car_repair|motorcycle|tyres|car_parts)$"), ("amenity", "^(car_rental|car_wash)$")]),
    ("moebel", "Möbel, Küchen & Einrichtung", 38, [("shop", "^(furniture|kitchen|interior_decoration|bed|carpet|lighting|bathroom_furnishing|flooring)$")]),
    ("fitness", "Fitness & Sport", 35, [("leisure", "^(fitness_centre|sports_centre)$"), ("shop", "^(sports|bicycle|outdoor)$")]),
    ("gastro", "Gastronomie", 30, [("amenity", "^(restaurant|cafe|bar|pub|fast_food|biergarten|ice_cream|nightclub)$")]),
    ("hotel", "Hotels & Unterkünfte", 30, [("tourism", "^(hotel|motel|guest_house|hostel|apartment)$")]),
    ("einzelhandel", "Einzelhandel (Mode, Elektronik, ...)", 30, [("shop", "^(clothes|shoes|electronics|mobile_phone|computer|jewelry|optician|gift|toys|books|fashion_accessories|bag|boutique|perfumery|watches|hifi|department_store|mall|variety_store)$")]),
    ("lebensmittel", "Lebensmittel & Getränke", 26, [("shop", "^(bakery|butcher|beverages|wine|deli|organic|confectionery|coffee|farm|greengrocer|supermarket)$")]),
    ("beauty", "Friseur, Kosmetik & Wellness", 28, [("shop", "^(hairdresser|beauty|cosmetics|massage|tattoo|nail_salon)$"), ("leisure", "^(sauna)$")]),
    ("immobilien", "Immobilien & Bauträger", 32, [("office", "^(estate_agent|property_management|construction_company|architect)$")]),
    ("handwerk", "Handwerk", 28, [("craft", ".")]),
    ("baumarkt", "Bau, Garten & Heimwerk", 30, [("shop", "^(doityourself|hardware|garden_centre|trade|paint|tiles|houseware|appliance)$")]),
    ("freizeit", "Freizeit & Entertainment", 32, [("amenity", "^(cinema|theatre|casino|events_venue)$"), ("leisure", "^(bowling_alley|escape_game|amusement_arcade|trampoline_park|water_park|miniature_golf)$"), ("tourism", "^(theme_park|zoo)$")]),
    ("bildung", "Fahrschulen, Sprach- & Musikschulen", 30, [("amenity", "^(driving_school|language_school|music_school|dancing_school|prep_school)$"), ("shop", "^(music)$")]),
    ("finanzen", "Banken & Versicherungen", 25, [("amenity", "^(bank)$"), ("office", "^(insurance|financial|financial_advisor)$")]),
    ("dienstleister", "Firmen, Agenturen & IT", 25, [("office", "^(company|it|advertising_agency|consulting|employment_agency|logistics|telecommunication|coworking)$")]),
    ("gesundheit", "Gesundheit (Ärzte, Apotheken, Pflege)", 15, [("amenity", "^(doctors|dentist|pharmacy|clinic|veterinary)$"), ("healthcare", "^(physiotherapist|optometrist|hearing_care|alternative)$"), ("shop", "^(medical_supply|hearing_aids)$")]),
    ("recht", "Rechts- & Steuerberatung", 12, [("office", "^(lawyer|tax_advisor|accountant|notary)$")]),
]

CATEGORIES = {
    cid: {"id": cid, "name": name, "weight": weight, "filters": filters}
    for cid, name, weight, filters in _CATEGORIES
}


def classify(tags):
    """Ordnet OSM-Tags der ersten passenden Kategorie zu (oder None)."""
    import re

    for cid, cat in CATEGORIES.items():
        for key, pattern in cat["filters"]:
            value = tags.get(key)
            if value and re.search(pattern, value):
                return cid
    return None
