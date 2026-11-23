# Bewerbungszentrale

Bewerbungen, Stellenradar mit Karte, Unterlagen und Gesprächsvorbereitung als
App fürs Handy, für Tobi.

**Adresse:** <https://finanzdienste.github.io/Bewerbungszentrale/>
(in Chrome öffnen, dann Menü ⋮ → „App installieren“).

## Wie sie gebaut ist

- **Nur zum Ansehen:** In der App wird nichts eingetragen oder bearbeitet. Sie zeigt an,
  lässt Portal-Angaben kopieren, liefert die Mappen und sendet vorbereitete Mails per Knopf.
  Status, Notizen, Bürotage, Anschreiben und Antworten schreiben Morgenlauf, Postfach-Routine
  und Claude-Sitzungen ins Daten-Repo. Den Status setzt die App nur selbst, wenn sie eine Mail sendet.
- **Dashboard:** Suche und rechts daneben „Alle“: die ganze Liste mit Filtern (Stellen,
  Initiativ, Portal, Mail, Status) und Sortierung nach Score, Gehalt, Fahrzeit, Frist oder
  Neuheit, die Sortierung bleibt gemerkt. Darunter die Bereiche nach Stand; Suchtreffer, die in
  keinem Bereich stehen, verlinkt ein Hinweis auf „Alle“.
- **Anrufe:** Ist die App mit Tobis Bildschirmzeit-App verbunden und hat er dort die Anrufliste
  freigegeben, holt sie beim Start und bei „online“ (höchstens alle 5 Minuten) die Anrufe der
  letzten 14 Tage aus Supabase (`bildschirmzeit_anrufe_lesen`, Repo Bildschirmzeit) und ordnet sie
  über `kontakt.telefon` zu, auch Durchwahlen einer Zentrale („040 … -0“). Sie trägt selbst ein:
  Verlauf „Anruf“, bei verpasst „<Firma> zurückrufen“ (steht dann unter „Warten auf deine
  Antwort“), ein späteres Gespräch ab 20 Sekunden hakt das ab. Ohne Netz beim nächsten Mal, nichts
  doppelt. Nummern ohne Akte bleiben unberührt.
- **Kontakte:** Mit derselben Verbindung schickt sie beim Start und bei „online“ die Namen für die
  Nummern der Akten ab „beworben“ an Supabase (`bildschirmzeit_kontakte_setzen`): „Person (Firma)“
  oder nur die Firma, ohne Rechtsform, Nummer als +49…. Die ganze Liste ersetzt die alte; geschickt
  wird nur, was sich geändert hat (Stand im localStorage `bz-kontakte-gemeldet`, erst nach `true`).
  Hat Tobi in der Bildschirmzeit-App „Kontakte benennen“ freigegeben, benennt die damit die Kontakte
  auf dem Handy. Der Nur-Lesen-Link schickt nichts.
- **Akte:** drei Reiter. „Infos“ (Score, Ort, Anfahrt, Gehalt, Weg, Kontakt, Termine, Offenes,
  Briefing, Abschicken, Notizen, zugeklappt Firma/Passung und Anzeige), „Unterlagen“ (nach dem
  Versand die verschickte PDF, dazu Anschreiben, Motivationsschreiben, Lebenslauf, Zeugnisse,
  Anschreiben mit Zeugnissen (ohne Lebenslauf) und ganze Mappe als PDF, dazu Arbeits- und
  Abschlusszeugnisse getrennt, wenn es beide gibt (auch im Ordner „Allgemein“), alles davon auch in
  jedem Drive-Ordner, Dateinamen höchstens 50 Zeichen, bei englischen Anzeigen englisch wie `CV_…`, `Cover_Letter_…`, in „Portal-Infos.txt“ dazu Berufserfahrung, Ausbildung, Sprachen und Kenntnisse in den Feldern von Workday & Co. zum Kopieren (weil Workday den Lebenslauf falsch ausliest), Anschreiben und Begleitmail zum Kopieren) und „Verlauf“ (oben „Du bist dran“
  mit Antwortvorschlag oder Rückruf, darunter nur der Gesprächsverlauf mit den Mails im Wortlaut).
  Links zu Anzeigen und Portalen öffnen auf Android direkt in Firefox. In Chrome auf Android
  übergibt „In Firefox nutzen“ im Profil den Zugang per Link (nur im Anker) an Firefox.
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
- **Mappen-Ordner** (Edge/Chrome am PC): Im Profil unter „Bewerbungsmappen“ einmal einen Ordner
  wählen, dann legt die App jede freigegebene Portal-Bewerbung von selbst als Unterordner
  „Score Firma - Stelle“ ab, mit allem für den Upload in jedem Ordner (Anschreiben, Lebenslauf,
  Zeugnisse, ganze Mappe, `Portal-Infos.txt`). Dazu ein Ordner „Allgemein“ mit dem allgemeinen Lebenslauf und
  den Zeugnissen, z. B. für Profile bei Jobbörsen. Der Ordner-Zugriff liegt in IndexedDB; mit „Bei jedem Besuch zulassen“
  fragt Edge danach nicht mehr. Ordner erledigter Stellen räumt sie weg, aber nur die aus ihrer
  eigenen Liste `.bewerbungszentrale.json`. Ohne Änderung fasst sie das Laufwerk nicht an.
- **Mappen fürs Handy** (Google Drive): Dieselben Ordner legt die App in Google Drive unter
  „Bewerbungsmappen“ ab (`bzPlattform.drive`, Scope `drive.file`: die App sieht nur, was sie selbst
  angelegt hat). Braucht im Google-Cloud-Projekt der Gmail-Anmeldung zusätzlich die Google Drive API.
  Der Stand je Ordner steht in dessen `appProperties`; erledigte Ordner gehen in den Papierkorb. Die
  Anmeldung hält eine Stunde, am PC erneuert sie sich danach beim nächsten Klick still.
  Ohne offene App gleicht `werkzeug/drive-abgleich.mjs` ab: Es startet die App ohne Fenster mit einem
  ausgecheckten Daten-Repo und einem Zugriffstoken von außen und macht denselben Abgleich. Das Daten-Repo
  ruft es als GitHub Action auf (`.github/workflows/mappen.yml`, fünfmal am Tag).
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
Zugriffstoken hält eine Stunde (localStorage `bewerbungszentrale.gmail.v1`).
Gesendet wird nur, wenn die Person im Senden-Fenster tippt; in der Sammelliste
stehen nur Bewerbungen, die das Gegenlesen freigegeben hat.

**Postausgang (v66)** – Tobi, 22.11.2026: „sowas wie mails senden könnte er sich
doch vormerken und dann machen sobald er internet hat“. Ohne Netz (oder wenn
Google nicht erreichbar ist) heißt der Knopf im Senden-Fenster „Vormerken“. Die
Auswahl landet in `bewerbungszentrale.postausgang.v1` (nur ids, nur auf diesem
Gerät – so schickt kein zweites Gerät dieselbe Bewerbung), oben steht „1 Bewerbung
wartet auf den Versand“, in der Akte „Vorgemerkt“. Sobald Netz da ist (Ereignis
`online`, App wieder vorn, nächster Start), holt die App erst den neuesten Stand –
was inzwischen nicht mehr auf „gemerkt“ steht, fliegt raus – und sendet dann mit
gültiger Google-Anmeldung von selbst; sonst reicht ein Tipp auf „Jetzt senden“
(Google öffnet sein Anmeldefenster nur nach einem Tipp). Mappe und Mailtext
entstehen erst beim Senden. Ist unklar, ob eine Mail raus ist, wird sie nie ein
zweites Mal geschickt und die App hält an. Tests: `postausgang-tipp`,
`postausgang-selbst`, `postausgang-erledigt`.

## Bildschirmzeit für Tobis Widget

Android zählt die App als „Chrome“. Tobis Widget-App (Repo
[Finanzdienste/Bildschirmzeit](https://github.com/Finanzdienste/Bildschirmzeit))
zieht ihre Zeit seit dem 19.11.2026 von Chrome ab und zeigt sie als
„Bewerbungen“.

- `js/bildschirmzeit.js` ist eine **byte-gleiche Kopie** von
  `web/bildschirmzeit.js` aus dem Repo Bildschirmzeit: nur dort ändern, dann
  hierher (und nach Boxenstopp, Freizeit, Workout) kopieren und `VERSION` in
  `sw.js` hochzählen.
- `js/bildschirmzeit-start.js` (ein Modul) startet es als
  `bewerbungszentrale`. `index.html` ist ein klassisches Skript und läuft
  vorher, deshalb lässt `route()` den Link `#bildschirmzeit=…` stehen, bis das
  Modul ihn herausnimmt. Kommt der Link in die offene App, bleibt man in der
  Ansicht, auch in der Adresse.
- Verbunden wird nur über „Verbinden“ in der Widget-App (öffnet
  `…/Bewerbungszentrale/#bildschirmzeit=<Kennung>`). Ohne den Link misst,
  schickt und zeigt nichts davon etwas. Verbunden: ein kurzer Hinweis, unter
  „Profil & Daten“ der Stand von heute und „Trennen“.
- Gemeldet werden nur Sekunden je Tag an Supabase (öffentlicher Schlüssel,
  nur die `bildschirmzeit_`-Funktionen), keine Bewerbungsdaten. Der Service
  Worker speichert diese Anfragen nie.
- Geprüft von `node tests/lauf.mjs bildschirmzeit` (Supabase nachgebaut,
  erfundene Kennungen).

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
Mit `BZ_BROWSER=firefox` laufen dieselben Tests in Firefox (Playwright-Firefox
nötig, z. B. in einem eigenen `PLAYWRIGHT_BROWSERS_PATH`).
