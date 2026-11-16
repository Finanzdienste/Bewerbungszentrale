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

## Ändern, prüfen, ausliefern
1. Ändern, dann `node tests/lauf.mjs` (alle Tests müssen grün sein). Neue Funktionen bekommen Tests.
2. In `sw.js` die `VERSION` hochzählen, neue Dateien in `SHELL` eintragen.
3. Committen, vor dem Push `git pull --rebase origin main`, auf `main` pushen. Keine History umschreiben.
4. Nach dem Push prüfen, ob das Pages-Deployment grün ist.
