# Leadgenerator BW

Vertriebstool zur Neukundensuche für Werbung (Außenwerbung / DOOH) in **Baden-Württemberg**.

- **Firmensuche** – alle 44 Stadt- und Landkreise, rund 95 Unterbranchen in 19 Hauptbranchen (z. B. Bau & Handwerk → Bad, Sanitär & Heizung), aufklappbar und mit Anzahl je Kreis. Quellen: OpenStreetMap und Overture Maps (u. a. Handwerksbetriebe ohne Ladengeschäft), Dubletten werden zusammengeführt; unsichere Einträge lassen sich zuschalten.
- **Neugründungen** – findet automatisch Betriebe, die neu eröffnet haben oder neu eingetragen wurden
- **News-Radar** – aktuelle Meldungen zu Neueröffnungen, Gründungen, Start-ups und neuen Standorten je Kreis
- **Werbepotenzial-Score** (0–100) – priorisiert nach Branche, Neueröffnung und Erreichbarkeit; Ketten werden abgewertet (Marketing läuft dort zentral)
- **Pipeline** – Status (Interessant → Kontaktiert → Termin → Angebot → Kunde) und Notizen je Lead, lokal gespeichert
- **CSV-Export** (Excel-tauglich) für CRM/Salesforce
- **Karte** mit allen Treffern
- **Pitch mit Claude** – Knopf pro Betrieb öffnet claude.ai mit einer fertigen Anfrage (Firmendaten, Ströer-Flächen in der Nähe, Gesprächsleitfaden); Claude sieht sich die Website an und schreibt einen individuellen Telefonpitch inkl. Einwandbehandlung.
- **Eigene Leads aus Fotos** – Fotos von Fahrzeug-, Schild- oder Plakatwerbung hochladen (auch mehrere, am Handy direkt aus Kamera/Galerie). Die Texterkennung läuft im Browser, erkennt Telefonnummer, Website, E-Mail und Firmenname und gleicht sie mit allen Betrieben in BW ab. Nach kurzer Prüfung wird daraus ein Lead mit Ströer-Flächen, Score, Pipeline und Pitch-Knopf. Die Fotos bleiben auf dem Gerät.
- **Größe & Ampel** – geschätzte Unternehmensgröße (S/M/L) aus Rechtsform, Anzahl Standorte und Website-Angaben; Ampel (grün/gelb/rot) aus Aktivitätssignalen wie „sucht Personal“, Online-Shop, Social Media. Filter „ab mittel“, „nur grün“, „sucht Personal“. Edeka, Rewe & Co. zählen als Händlerverbund (oft selbstständige Kaufleute), nicht als Kette.
- **Website-Check** – jede Nacht werden einige Tausend Firmen-Websites geprüft (Startseite, Impressum, Karriereseite; robots.txt wird beachtet, keine Personendaten). Nach etwa zwei bis drei Wochen sind alle Websites einmal erfasst, danach wird alle 90 Tage aufgefrischt.
- **Gruppen** – Betriebe mit gleicher Firmen-Website (z. B. alle Kinderhäuser eines Trägers) werden über alle Kreise als Gruppe erkannt: Abzeichen mit Anzahl Standorte, aufklappbare Liste mit vermuteter Zentrale, Schalter „Gruppen zusammenfassen“. Status, Notiz und Ansprechpartner gelten für die ganze Gruppe.
- **Mail an Outlook** – Knopf „Mail“ bzw. Klick auf die E-Mail-Adresse: Vorlage wählen (nach dem Telefonat, Terminbestätigung, Unterlagen), Ansprechpartner eintragen, Text prüfen, in Outlook öffnen. Nur nach vorherigem Kontakt verwenden (UWG).
- **Nachschlagen** – Links zu North Data, Handelsregister und Jobbörse je Betrieb.
- **Ströer-Werbeträger im Umkreis** – zeigt pro Betrieb die Ströer-Flächen in der Nähe (Großfläche, City-Light, DOOH …), filterbar nach Trägerart, mit Kartenebene und CSV-Spalten. Quelle: öffentliche Ströer-Standortkarte; nur Ströer-eigene Flächen (Pächter 368, 252), ohne Preise.

## Web-Version (ohne Installation)

**https://markus90ms-eng.github.io/Leadgenerator/**

Einfach im Browser öffnen. Die Daten für alle 44 Kreise sammelt GitHub Actions automatisch jeden Morgen aus dem aktuellen OpenStreetMap-Abzug (Geofabrik) und dem offenen Overture-Maps-Datensatz „places“ (`.github/workflows/pages.yml`). Manuell aktualisieren: Reiter *Actions* → *Daten sammeln & Webseite veröffentlichen* → *Run workflow*.

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

Alle Leads, Status und Notizen liegen nur lokal in `leads.db` bzw. im Browser. Genutzt werden ausschließlich offen lizenzierte Firmendaten: © OpenStreetMap-Mitwirkende (ODbL) und Overture Maps Foundation (CDLA-Permissive-2.0). Bei der Kaltakquise die UWG-Regeln beachten (B2B-Anrufe nur bei mutmaßlicher Einwilligung, keine Werbe-E-Mails ohne Einwilligung).

## Tests

```
python -m unittest discover -s tests
```
