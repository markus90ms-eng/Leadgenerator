#!/usr/bin/env python3
"""Bucht automatisch einen Parkplatz im Gingco-Buchungssystem (Ströer).

Aufruf:
    PARK_URL='https://stroeer.share.gingco.cloud/index.php?...' \
    python book_parkplatz.py --platz 20 --von 09:00 --bis 17:00 --datum 2026-10-26

Ohne --datum wird der naechste Werktag gebucht (--tage-voraus N ueberschreibt das).
Die URL enthaelt den persoenlichen Zugangstoken -> nur ueber PARK_URL / .env, nie ins Git.
"""
import argparse
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout, sync_playwright

DEBUG_DIR = Path(__file__).parent / "debug"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--platz", default="20", help="Nummer des Parkplatzes (Default 20)")
    p.add_argument("--von", default="09:00")
    p.add_argument("--bis", default="17:00")
    p.add_argument("--datum", help="YYYY-MM-DD; Default: naechster Werktag")
    p.add_argument("--tage-voraus", type=int, help="Datum = heute + N Tage (Wochenende wird uebersprungen)")
    p.add_argument("--typ", default="7,0", help='Objekttyp: "7,0" alle Parkplaetze, "7,36" Mitarbeiter, "7,22" E-Parkplatz')
    p.add_argument("--trocken", action="store_true", help="Alles ausfuellen, aber NICHT final buchen")
    p.add_argument("--sichtbar", action="store_true", help="Browser sichtbar starten")
    return p.parse_args()


def load_url():
    url = os.environ.get("PARK_URL")
    env = Path(__file__).parent / ".env"
    if not url and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("PARK_URL="):
                url = line.split("=", 1)[1].strip().strip("'\"")
    if not url:
        sys.exit("PARK_URL fehlt (Umgebungsvariable oder parkplatz/.env).")
    return url


def zieldatum(a) -> date:
    if a.datum:
        return datetime.strptime(a.datum, "%Y-%m-%d").date()
    d = date.today() + timedelta(days=a.tage_voraus if a.tage_voraus is not None else 1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def dump(page, name):
    DEBUG_DIR.mkdir(exist_ok=True)
    page.screenshot(path=str(DEBUG_DIR / f"{name}.png"), full_page=True)
    (DEBUG_DIR / f"{name}.html").write_text(page.content(), encoding="utf-8")


def main():
    a = parse_args()
    url = load_url()
    d = zieldatum(a)
    print(f"Buche Parkplatz {a.platz} am {d} von {a.von} bis {a.bis}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not a.sichtbar)
        page = browser.new_page(locale="de-DE", viewport={"width": 1400, "height": 1000})
        page.goto(url, wait_until="networkidle")
        dump(page, "1_start")

        # Objekttyp, Datum, Zeiten setzen (IDs aus der Suchseite)
        page.select_option("#objecttype", a.typ)
        page.select_option("#monthyear", f"{d.year}-{d.month}")
        page.select_option("#day", str(d.day))
        for sel, wert in (("#timeselect1", a.von), ("#timeselect2", a.bis)):
            page.fill(sel, wert)
            page.press(sel, "Enter")
        page.wait_for_timeout(500)

        # Listenansicht der Suchergebnisse laden (Seite macht selbst ein Form-Submit)
        with page.expect_navigation(wait_until="networkidle"):
            page.evaluate("reload_complete_listview()")
        dump(page, "2_ergebnisse")

        # Parkplatz suchen: "Parkplatz 20", aber nicht "Parkplatz 200"
        treffer = page.get_by_text(re.compile(rf"Parkplatz\s*{re.escape(a.platz)}(?!\d)", re.I)).first
        try:
            treffer.wait_for(timeout=10000)
        except PWTimeout:
            dump(page, "fehler_platz_nicht_gefunden")
            sys.exit(f"Parkplatz {a.platz} nicht gefunden (evtl. schon belegt). Siehe parkplatz/debug/.")
        treffer.click()
        page.wait_for_load_state("networkidle")
        dump(page, "3_nach_klick")

        if a.trocken:
            print("Trockenlauf: nicht gebucht. Siehe parkplatz/debug/.")
            return

        # Buchung bestaetigen
        knopf = page.get_by_role("button", name=re.compile(r"^(Jetzt )?(buchen|bestätigen|reservieren)", re.I)).first
        if not knopf.count():
            knopf = page.get_by_role("link", name=re.compile(r"^(Jetzt )?(buchen|bestätigen|reservieren)", re.I)).first
        knopf.click()
        page.wait_for_load_state("networkidle")
        dump(page, "4_nach_buchung")

        text = page.inner_text("body")
        if re.search(r"erfolgreich|bestätigt|gebucht", text, re.I):
            print("OK: Buchung scheint erfolgreich. Siehe parkplatz/debug/4_nach_buchung.png")
        else:
            sys.exit("Keine Bestaetigung gefunden - bitte debug/4_nach_buchung.png pruefen.")
        browser.close()


if __name__ == "__main__":
    main()
