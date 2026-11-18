# ELYSION – Luxusuhren-Shop (statisch)

Seiten: `index`, `kollektion`, `marken`, `uhr` (Detail, `uhr.html#p6`), `service`, `ueber-uns`, `kontakt`, `rechtliches`.
Gemeinsame Daten und Layout: `common.js`, Design: `styles.css`. Kein Build nötig; `index.html` im Browser öffnen.

## Produkte und Bilder
Die 12 Produktdatensätze liegen im Array `PRODUCTS` in `common.js`. Die echten Modellaufnahmen sind zentral in `PHOTO_URLS` hinterlegt und werden auf Startseite, Kollektion, Merkliste, Anfrageliste und Produktdetail verwendet. Die Detailgalerie zeigt nur tatsächlich hinterlegte Aufnahmen; wenn ein externer Bildhost nicht erreichbar ist, wird die gezeichnete Ersatzansicht angezeigt.

Für den kommerziellen Livebetrieb bitte die Nutzungsrechte jeder extern eingebundenen Produktaufnahme prüfen und idealerweise freigegebene Originaldateien in `img/<id>-1.jpg` ablegen. Keine Händler- oder Herstellerbilder ohne entsprechende Nutzungsrechte übernehmen.
