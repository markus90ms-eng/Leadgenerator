"""Werbepotenzial-Score (0-100) als Priorisierungshilfe für die Akquise."""

from .categories import CATEGORIES


def score(lead):
    points = CATEGORIES.get(lead["category"], {}).get("weight", 20)
    reasons = [f"Branche +{points}"]

    def add(value, why):
        nonlocal points
        points += value
        reasons.append(f"{why} {'+' if value >= 0 else ''}{value}")

    if lead.get("new_reason") == "Neueröffnung":
        add(30, "Neueröffnung")
    elif lead.get("new_reason") == "Neu eingetragen":
        add(20, "Neu am Markt")
    if lead.get("website"):
        add(10, "Website")
    if lead.get("phone"):
        add(8, "Telefon")
    if lead.get("email"):
        add(7, "E-Mail")
    if lead.get("opening_hours"):
        add(5, "Aktiv (Öffnungszeiten)")
    if lead.get("chain"):
        add(-25, "Kette/Filiale (zentrales Marketing)")
    return max(0, min(100, points)), reasons
