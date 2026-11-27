# Hinweise für Claude

Antworte auf Deutsch, kurz und direkt. Aufbau steht in der README.md.

## Repos
- **Finanzdienste/Bewerbungszentrale** (dieses, öffentlich): die App, live über GitHub Pages.
- **Finanzdienste/Bewerbungszentrale-Daten** (privat): Bewerbungen, Profil, Radar, Dateien.

## Regeln
- Keine persönlichen Daten in diesem Repo: keine Namen, Adressen, Mailadressen,
  Gehälter, Arbeitgeber aus dem Lebenslauf, Koordinaten der Wohnung. Was die App
  über die Person wissen muss, steht in `profil/main.json` im Daten-Repo.
  Der Test `oeffentlich` prüft das grob.
- Tokens und API-Schlüssel nie in Chat, Code, Commits oder Logs.
- Tests arbeiten nur mit erfundenen Daten (`tests/daten/`).

## Offline zuerst
Tobi, 22.11.2026: „Generell sollen all meine Apps auch so weit wie möglich
offline funktionieren.“ Das gilt für jede Änderung und jede neue Funktion:
- Was ohne Netz gehen kann, geht ohne Netz: App-Hülle und zuletzt geladene
  Daten liegen im Vorrat von `sw.js`, ebenso Bilder und Kartenkacheln, die
  man schon gesehen hat.
- Änderungen ohne Netz werden lokal gemerkt und von selbst nachgeschickt –
  beim Ereignis `online`, beim nächsten Abgleich und beim nächsten Start.
  Nichts geht verloren, nichts kommt doppelt an, und was sich inzwischen
  anderswo geändert hat, wird zusammengeführt statt überschrieben.
- Was nur mit Netz geht, wird ohne Netz vorgemerkt und läuft von selbst,
  sobald Netz da ist – Tobi, 22.11.2026: „sowas wie mails senden könnte er sich
  doch vormerken und dann machen sobald er internet hat“. Also Mails senden,
  KI-Aufträge und Ähnliches: sichtbar „wartet auf Netz“ (mit „Nicht senden“),
  vor dem Ausführen gegen den neuesten Stand geprüft, nie doppelt. Braucht es
  eine Anmeldung, die nur nach einem Tipp aufgeht (Google), reicht dann ein Tipp.
  Nur was sich nicht vormerken lässt (neue Angebote, eine Suche, Push), sagt
  ohne Netz in einem Satz, dass es Netz braucht; der Rest bleibt benutzbar.
- Neue Funktionen bekommen einen Test ohne Netz (Server aus oder Anfragen
  abbrechen – Playwrights `setOffline()` schneidet die Anfragen des Service
  Workers nicht ab).

## Ändern, prüfen, ausliefern
1. Ändern, dann `node tests/lauf.mjs` (alle Tests müssen grün sein). Neue Funktionen bekommen Tests.
2. In `sw.js` die `VERSION` hochzählen, neue Dateien in `SHELL` eintragen.
3. Committen, vor dem Push `git pull --rebase origin main`, auf `main` pushen. Keine History umschreiben.
4. Nach dem Push prüfen, ob das Pages-Deployment grün ist.

## Modell, Aufwand und neuer Chat
Was gerade läuft, zeigt `get_session` (`model`, `effort_level`, `context_usage`).
- **Nur melden, wenn etwas zu ändern ist** (Tobi, 26.11.2026: „Dass Opus okay
  ist brauch ich nicht zu wissen, ich brauch nur zu wissen wenn was geändert
  werden muss“): Kein Schlusssatz mehr wie „passt – nichts umstellen“. Sollte
  etwas umgestellt werden (Modell, Aufwand, neuer Chat), am Ende ein Satz mit
  Grund und dem genauen Befehl.
- **Neuer Chat – fast nie** (Tobi, 27.11.2026: „Also eigentlich brauch man
  doch nie nen neuen chat oder?“ – „Dann lass die Regel doch ändern“): Wird
  der Verlauf voll, fasst die Sitzung ihn bei etwa 90 % von selbst zusammen,
  und es geht weiter (am 27.11. von 79 % auf 27 %); das ist nicht schlechter
  als ein neuer Chat (Tobi, 26.11.: „dass hier Infos zusammengefasst wurden
  ist schlechter als bei nem neuen chat komplett von 0 zu beginnen?“ – nein).
  Darum keine Meldung nach Prozent mehr – bis 27.11. hieß es „ab etwa 80 %“
  (26.11.: „in allen Chats bescheid geben wenn ein neuer Chat nötig ist“),
  das kam kurz vor der Zusammenfassung und war überflüssig. Einen neuen Chat
  nur vorschlagen, wenn du merkst, dass du mit veraltetem oder
  widersprüchlichem Stand arbeitest, oder bei einem anderen Projekt – dann
  vorher alles Offene in die Dateien schreiben und einen kurzen Starttext
  zum Einfügen mitgeben. Die Schwelle der Zusammenfassung bleibt (Tobi
  fragte nach 95 %): Sie braucht selbst Platz, und eine einzige große
  Ausgabe (Testlauf, Bilder) kann Zehntausende Tokens haben.
- Mehr (vorschlagen, auf Antwort warten): `/model fable` mit `/effort high`,
  wenn eine Ursache nach dem ersten Durchgang unklar bleibt oder ein Fehler
  nach einer Korrektur wiederkommt. Fable kostet kein Nutzungsguthaben (Tobi, 26.11.2026; Guthaben kostet nur
  die Claude-API).
