# Parkplatz-Autobuchung

1. `pip install -r requirements.txt && playwright install chromium`
2. Datei `parkplatz/.env` anlegen: `PARK_URL='<dein kompletter Link>'` (steht in .gitignore)
3. Erst testen: `python book_parkplatz.py --trocken --sichtbar`
4. Echt buchen: `python book_parkplatz.py --platz 20 --von 09:00 --bis 17:00`

Taeglich automatisch (Linux/Mac, Werktage 06:30, bucht den naechsten Werktag):
`30 6 * * 1-5 cd /pfad/parkplatz && python book_parkplatz.py >> log.txt 2>&1`

Die Schritte nach der Ergebnisliste (Klick auf den Platz, Buchen-Button) sind noch ungetestet.
Der Trockenlauf legt Screenshots/HTML in `debug/` ab; damit passe ich das Skript an.
