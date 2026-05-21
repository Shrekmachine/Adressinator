# Changelog

Alle wesentlichen Änderungen an Adressinator werden hier dokumentiert.

Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [1.3.0] — 2026-05-22

### Hinzugefügt

- App-**Logo** im Seitenkopf
- **Favicon** (`favicon.ico`, PNG-Varianten, Apple Touch Icon)

### Geändert

- CSP: `img-src 'self'` für Logo und Icons

## [1.2.0] — 2026-05-22

### Hinzugefügt

- Option **Verlauf beim Beenden löschen** (Checkbox, Einstellung bleibt gespeichert)
- **Content-Security-Policy** (Meta-Tag in `index.html`, optional `.htaccess` für Apache)
- Diese Changelog-Datei

### Geändert

- SFTP-Deployment-Pfad und Dokumentation im README ergänzt

## [1.1.0] — 2026-05-22

### Hinzugefügt

- **Kopieren** der drei Adressfelder in die Zwischenablage
- **Kopieren aus dem Verlauf** (Button pro Eintrag)
- Frühere Vorschläge (ab 1 Zeichen, bis zu 10 Treffer, kürzeres Debounce)

### Behoben

- Straße wird wieder zuverlässig übernommen (u. a. Photon-Typ `street`, Fallback aus Anzeigetext)

## [1.0.0] — 2026-05-22

### Hinzugefügt

- Adresssuche mit Autovervollständigung (Photon / OpenStreetMap, Deutschland)
- Felder: Straße und Nummer, PLZ, Stadt
- **Zurücksetzen** der aktuellen Eingabe
- **Verlauf** (lokal, max. 25 Einträge), erneut laden, einzeln entfernen, Verlauf leeren
