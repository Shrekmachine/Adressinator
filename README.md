# Adressinator

Statische Web-App zur Adresssuche mit Autovervollständigung für Deutschland. Vorschläge stammen von [Photon](https://github.com/komoot/photon) (OpenStreetMap) — kein API-Schlüssel nötig.

## Funktionen

- Adresse oder Teile davon eingeben; bis zu 10 Vorschläge während der Eingabe
- Übernahme in **Straße und Nummer**, **PLZ** und **Stadt**
- **Kopieren** der drei Felder in die Zwischenablage (zeilenweise)
- **Verlauf** der zuletzt gewählten Adressen (lokal im Browser, max. 25 Einträge)
- Kopieren und erneutes Laden aus dem Verlauf
- **Zurücksetzen** der aktuellen Eingabe

## Lokal starten

Die App nutzt `fetch` gegen eine externe API und sollte über HTTP(S) geöffnet werden, nicht als `file://`:

```bash
npx --yes serve .
```

Alternativ: beliebiger statischer Webserver oder die Erweiterung **Live Server** in VS Code/Cursor.

## Veröffentlichen

Es werden nur statische Dateien benötigt:

```
index.html
css/style.css
js/app.js
```

Auf jedem Webhosting mit HTTPS deployen (z. B. Unterordner oder Subdomain). Relative Pfade in `index.html` erlauben den Betrieb in einem Unterverzeichnis.

**Hinweis:** Die Zwischenablage funktioniert im Browser zuverlässig nur über **HTTPS** (oder `localhost`).

## Technik

- Vanilla HTML, CSS und JavaScript (ES-Module)
- Geocoding: `https://photon.komoot.io/api/`
- Verlauf: `localStorage` im Browser
- Suche auf Deutschland begrenzt (`bbox`)

## Hinweise

- Mindestens 1 Zeichen für Vorschläge
- Datenqualität hängt von OpenStreetMap ab; nicht jede Hausnummer ist erfasst
- Keine Daten werden an einen eigenen Server gesendet

## Lizenz

MIT — siehe [LICENSE](LICENSE).
