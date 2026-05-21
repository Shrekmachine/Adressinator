# Adressinator

Statische Web-App zur Adresssuche mit Autovervollständigung für Deutschland. Vorschläge stammen von [Photon](https://github.com/komoot/photon) (OpenStreetMap) — kein API-Schlüssel nötig.

## Funktionen

- Adresse oder Teile davon eingeben; bis zu 10 Vorschläge während der Eingabe
- Übernahme in **Straße und Nummer**, **PLZ** und **Stadt**
- **Kopieren** der drei Felder in die Zwischenablage (zeilenweise)
- **Verlauf** der zuletzt gewählten Adressen (lokal im Browser, max. 25 Einträge)
- Optional: **Verlauf beim Beenden löschen** (Tab schließen / Seite verlassen)
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
favicon.ico
assets/logo.png
assets/favicon-16.png
assets/favicon-32.png
assets/apple-touch-icon.png
css/style.css
js/app.js
.htaccess          # optional, nur bei Apache-Hosting
```

Auf jedem Webhosting mit HTTPS deployen (z. B. Unterordner oder Subdomain). Relative Pfade in `index.html` erlauben den Betrieb in einem Unterverzeichnis.

**Hinweis:** Die Zwischenablage funktioniert im Browser zuverlässig nur über **HTTPS** (oder `localhost`).

## Sicherheit (Content-Security-Policy)

Die App setzt eine **CSP** — eine Whitelist, was der Browser laden und ausführen darf:

| Richtlinie | Erlaubt |
|------------|---------|
| `script-src`, `style-src` | nur eigene Dateien (`js/app.js`, `css/style.css`) |
| `connect-src` | eigene Origin + `https://photon.komoot.io` (Adresssuche) |
| `img-src` | eigene Origin (Logo) |
| `frame-ancestors 'none'` | Seite darf nicht in fremde iframes eingebettet werden |

**Zwei Varianten** (Inhalt identisch — eine reicht):

1. **`index.html`** — `<meta http-equiv="Content-Security-Policy" …>` (funktioniert überall, z. B. GitHub Pages)
2. **`.htaccess`** — HTTP-Header (Apache mit `mod_headers`, z. B. viele Strato-Pakete)

Nach dem Upload testen: Seite öffnen, Adresse suchen, kopieren. Bei blockierten Ressourcen zeigt die Browser-Konsole (F12) einen CSP-Fehler.

## Technik

- Vanilla HTML, CSS und JavaScript (ES-Module)
- Geocoding: `https://photon.komoot.io/api/`
- Verlauf: `localStorage` im Browser
- Suche auf Deutschland begrenzt (`bbox`)

## Hinweise

- Mindestens 1 Zeichen für Vorschläge
- Datenqualität hängt von OpenStreetMap ab; nicht jede Hausnummer ist erfasst
- Keine Daten werden an einen eigenen Server gesendet

## Changelog

Änderungshistorie: [CHANGELOG.md](CHANGELOG.md)

## Lizenz

MIT — siehe [LICENSE](LICENSE).
