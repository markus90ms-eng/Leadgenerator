# Leadgenerator BW

Vertriebstool zur Neukundensuche für Werbung (Außenwerbung / DOOH) in **Baden-Württemberg**.

- **Firmensuche** – alle 44 Stadt- und Landkreise, 17 Branchen (Autohäuser, Gastronomie, Fitness, Möbel, Handwerk …)
- **Neugründungen** – findet automatisch Betriebe, die neu eröffnet haben oder neu eingetragen wurden
- **News-Radar** – aktuelle Meldungen zu Neueröffnungen, Gründungen, Start-ups und neuen Standorten je Kreis
- **Werbepotenzial-Score** (0–100) – priorisiert nach Branche, Neueröffnung und Erreichbarkeit; Ketten werden abgewertet (Marketing läuft dort zentral)
- **Pipeline** – Status (Interessant → Kontaktiert → Termin → Angebot → Kunde) und Notizen je Lead, lokal gespeichert
- **CSV-Export** (Excel-tauglich) für CRM/Salesforce
- **Karte** mit allen Treffern

## Web-Version (ohne Installation)

**https://markus90ms-eng.github.io/Leadgenerator/**

Einfach im Browser öffnen. Die Daten für alle 44 Kreise sammelt GitHub Actions automatisch jeden Morgen (`.github/workflows/pages.yml`). Manuell aktualisieren: Reiter *Actions* → *Daten sammeln & Webseite veröffentlichen* → *Run workflow*.

Status und Notizen der Pipeline werden im Browser gespeichert; über *Meine Pipeline → Sicherung speichern* lassen sie sich als Datei sichern.

Einmalige Einrichtung: *Settings → Pages → Build and deployment → Source: GitHub Actions*.

## Lokale Version: Installation & Start

Benötigt nur **Python 3.9+** (keine weiteren Pakete).

- **Windows:** Doppelklick auf `start.bat`
- **Mac/Linux:** `./start.sh`

Der Browser öffnet sich unter http://127.0.0.1:8765.

> Die erste Suche pro Kreis/Branche dauert 30–90 Sekunden (OpenStreetMap-Abfrage). Danach liegen die Ergebnisse 24 h im Cache.

## Neugründungen automatisch suchen lassen

```
python app.py scan                                  # alle Kreise, letzte 6 Monate
python app.py scan --kreis 08115 08116 --monate 3
python app.py scan --branchen gastro fitness autohaus
python app.py kreise                                # Liste der Kreisschlüssel
```

Ergebnis: `exports/neugruendungen_JJJJ-MM-TT.csv`. Betriebe, die seit dem letzten Scan dazugekommen sind, sind in der Oberfläche als **„NEU seit letztem Scan“** markiert.

Wöchentlich automatisch (Windows-Aufgabenplanung): Aufgabe erstellen → Programm `python`, Argumente `app.py scan --kreis 08115 08116`, „Starten in“ = dieser Ordner.

## Wie werden Neugründungen erkannt?

| Signal | Quelle |
|---|---|
| Eröffnungsdatum (`start_date`/`opening_date`) im gewählten Zeitraum | OpenStreetMap |
| Betrieb im Zeitraum erstmals in der Karte eingetragen | OpenStreetMap |
| Betrieb taucht beim wiederholten Scan zum ersten Mal auf | eigene Datenbank |
| Pressemeldungen zu Eröffnung, Gründung, Start-up, Expansion | Google News |

Hinweis: Handelsregister-Neueintragungen und Gewerbeanmeldungen sind nicht frei maschinenlesbar verfügbar. Der News-Radar und der regelmäßige Scan decken einen großen Teil ab; Treffer lassen sich per „Als Lead merken“ in die Pipeline übernehmen.

## Datenschutz & Recht

Alle Leads, Status und Notizen liegen nur lokal in `leads.db`. Genutzt werden ausschließlich öffentliche Firmendaten (OpenStreetMap, © OpenStreetMap-Mitwirkende, ODbL). Bei der Kaltakquise die UWG-Regeln beachten (B2B-Anrufe nur bei mutmaßlicher Einwilligung, keine Werbe-E-Mails ohne Einwilligung).

## Tests

```
python -m unittest discover -s tests
```
