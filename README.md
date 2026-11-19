# Bewerbungszentrale

Bewerbungen, Stellenradar mit Karte, Unterlagen und Gesprächsvorbereitung als
App fürs Handy, für Tobi.

**Adresse:** <https://finanzdienste.github.io/Bewerbungszentrale/>
(in Chrome öffnen, dann Menü ⋮ → „App installieren“).

## Wie sie gebaut ist

- **Vanilla-JS-PWA ohne Bauschritt**, live über GitHub Pages. Alles hier ist
  öffentlich lesbar, darum stehen hier keine persönlichen Daten.
- `index.html` ist die App (ursprünglich ein Claude-Artifact, das mit
  `window.claude.use()` arbeitet). `js/plattform.js` stellt diese Fähigkeiten
  ohne Claude bereit:
  - **db**: Dokumente als JSON im privaten Repo
    **Finanzdienste/Bewerbungszentrale-Daten** (`apps/<id>.json`,
    `profil/main.json`, `radarpaket/`, `radar/`, `radarwahl/`, `firmenwahl/`,
    `system/lauf.json`). Laden über Git-Baum + GraphQL, Zwischenspeicher in
    IndexedDB (die App startet auch offline), Schreiben über die Contents-API
    (ein Commit pro Änderung, 2,5 s gesammelt), Abgleich jede Minute.
  - **assets**: Zeugnisse und Foto unter `dateien/<id>.<endung>` im Daten-Repo;
    die App kennt sie als `/_blob/<id>`.
  - **sample** (KI): eigener Schlüssel, Anthropic (`sk-ant-…`, claude-opus-5-5)
    oder Google (`AQ.…`, gemini-3.8-flash), direkt vom Handy.
  - **downloads**: Datei speichern per Download-Link.
- **Mappen-Ordner** (Edge/Chrome am PC): Unter „Bereit zum Abschicken“ einmal einen Ordner
  wählen, dann legt die App jede freigegebene Portal-Bewerbung von selbst als Unterordner
  „Score Firma - Stelle“ ab, mit allem für den Upload in jedem Ordner (Anschreiben, Lebenslauf,
  Zeugnisse, ganze Mappe, `Portal-Infos.txt`). Der Ordner-Zugriff liegt in IndexedDB; mit „Bei jedem Besuch zulassen“
  fragt Edge danach nicht mehr. Ordner erledigter Stellen räumt sie weg, aber nur die aus ihrer
  eigenen Liste `.bewerbungszentrale.json`. Ohne Änderung fasst sie das Laufwerk nicht an.
- **Teilen**: „Per WhatsApp teilen“ und „Per Mail-App senden“ geben die
  Bewerbungsmappe (PDF) über das Teilen-Menü des Handys weiter.
- `karte/`: Kartenpakete (OpenStreetMap über Protomaps, Raum Hamburg) und
  Schriften für die Karte, als Base64-Text. `schrift/`: Inter und Source
  Serif 4 (beide SIL Open Font License) für die PDF-Unterlagen.
- `sw.js`: App-Hülle offline, Karte und Schriften aus dem Zwischenspeicher.

## Zugang

Ein Fine-grained Token von GitHub, das nur **Bewerbungszentrale-Daten** lesen
und schreiben darf (Contents: Read and write). Er steht nur im localStorage
des Handys, nie im Code. Hat der Boxenstopp-Token auch Zugriff auf das
Daten-Repo, nimmt die App ihn automatisch (gleiche Adresse).

Darf ein Token nur lesen (Contents: Read-only), läuft die App im Lesemodus: alles ansehen und
als PDF laden, nichts wird gespeichert, kein Mailversand. So lässt sich die App zum Gegenlesen
teilen, ohne dass jemand etwas ändern kann.

Aufs Handy kommt er über das Einrichten-Fenster beim ersten Start oder per
Link `…/Bewerbungszentrale/#zugang=<Token>&ki=<KI-Schlüssel>`. Später ändern:
`…/Bewerbungszentrale/#einrichten`.

Senden per Gmail: eine eigene Google-Cloud-App (Gmail API an, OAuth-Client
„Webanwendung“ mit der Pages-Adresse als JavaScript-Quelle, die Person als
Testnutzer). Die Client-ID kommt per Link `…/#google=<Client-ID>` oder über
das Fenster beim ersten Senden. Die App fragt nur `gmail.send` an, das
Zugriffstoken bleibt im Speicher der Seite. Gesendet wird nur, wenn die Person
im Senden-Fenster tippt; in der Sammelliste stehen nur Bewerbungen, die das
Gegenlesen freigegeben hat.

## Läufe

Der tägliche Morgenlauf (Stellensuche, Bewertung, Unterlagen, Gegenlesen) ist
eine GitHub Action im Daten-Repo, das Postfach eine Claude-Sitzung. Beide
schreiben das Daten-Repo mit `werkzeug/db.py` (dort beschrieben). Das Ergebnis
des Gegenlesens steht in `pruefung` der Akte, mit dem Fingerabdruck `fassung`
der Unterlagen (SHA-1 über Pythons `json.dumps(sort_keys=True)`, die App rechnet
ihn genauso nach und merkt so, wenn seitdem etwas geändert wurde).

## Tests

`npm install`, dann `npm test` (alle) oder `node tests/lauf.mjs teilen ki`
(einzelne). Die Tests arbeiten mit Attrappen für GitHub und KI
(`tests/attrappe.mjs`) und nur mit erfundenen Daten (`tests/daten/`).
