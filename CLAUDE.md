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
- **Neuer Chat** (Tobi, 26.11.2026: „in allen Chats bescheid geben wenn ein
  neuer Chat nötig ist“): von selbst in einem Satz sagen, sobald einer nötig
  ist – wenn der Verlauf schon zusammengefasst wurde oder `get_session` mehr
  als etwa die Hälfte von `context_usage.max_tokens` belegt zeigt, wenn du
  frühere Entscheidungen nicht mehr sicher weißt, oder wenn ein ganz neues
  Thema anfängt. Vorher alles Offene in die Dateien schreiben und einen kurzen
  Starttext zum Einfügen mitgeben.
- Mehr (vorschlagen, auf Antwort warten): `/model fable` mit `/effort high`,
  wenn eine Ursache nach dem ersten Durchgang unklar bleibt oder ein Fehler
  nach einer Korrektur wiederkommt. Fable kostet kein Nutzungsguthaben (Tobi, 26.11.2026; Guthaben kostet nur
  die Claude-API).
