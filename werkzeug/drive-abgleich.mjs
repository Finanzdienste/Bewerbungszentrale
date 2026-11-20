/**
 * Bewerbungsmappen in Google Drive abgleichen, ohne dass die App offen ist.
 *
 * Startet die App ohne Fenster (Chromium über Playwright), mit den Daten aus einem
 * ausgecheckten Daten-Repo, und lässt sie genau den Drive-Abgleich machen, den sie am
 * PC oder Handy auch macht: gleiche Ordner, gleiche Namen, gleiche Kennzeichen. Läuft im
 * Daten-Repo als GitHub Action (.github/workflows/mappen.yml).
 *
 *   DRIVE_TOKEN=… GOOGLE_CLIENT_ID=… node werkzeug/drive-abgleich.mjs <daten-ordner>
 *
 * DRIVE_TOKEN ist ein Zugriffstoken (eine Stunde gültig) für den Scope drive.file, geholt
 * mit dem Refresh-Token derselben Client-ID, die auch die App nutzt. Sonst sieht der
 * Abgleich die Ordner nicht, die die App angelegt hat. Das Token wird nie ausgegeben.
 */
import path from 'node:path';
import { appStarten, schliessen, warte } from '../tests/hilfe.mjs';

export async function driveLauf({ daten, token, clientId, echt = true, vorher, maxMin = 25 }) {
  const app = await appStarten({ daten, driveEcht: echt, breite: 1280, hoehe: 900 });
  const { seite, fehler } = app;
  if (vorher) await vorher(app);
  await seite.addInitScript(({ token, clientId }) => {
    localStorage.setItem('bewerbungszentrale.google.v1', JSON.stringify({ clientId, stand: new Date().toISOString() }));
    localStorage.setItem('bewerbungszentrale.drive.v1', JSON.stringify({ token, bis: Date.now() + 55 * 60 * 1000 }));
    localStorage.setItem('bewerbungszentrale.drive.an', JSON.stringify({ an: true }));
  }, { token, clientId });
  await seite.reload();
  await seite.waitForSelector('#v-uebersicht', { timeout: 60_000 }).catch(() => {});
  await seite.evaluate(() => window.bzPlattform?.abgleichen?.()).catch(() => {}); // alle Akten sicher geladen, bevor der Plan zählt
  const ende = Date.now() + maxMin * 60_000;
  let stand = null, fertigInFolge = 0;
  while (Date.now() < ende) {
    stand = await seite.evaluate(() => window.bzMappen?.() || null).catch(() => null);
    const d = stand?.drive;
    fertigInFolge = d?.fertig ? fertigInFolge + 1 : 0;
    if (fertigInFolge >= 3 || d?.wartet || (d?.fehler && !/keine Verbindung/i.test(d.fehler))) break; // dreimal in Folge fertig: kein Lauf mehr im Gang. Netzaussetzer: die App versucht es selbst noch einmal
    await warte(2000);
  }
  return { stand, fehler, app };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const daten = path.resolve(process.argv[2] || '.');
  const token = process.env.DRIVE_TOKEN || '', clientId = process.env.GOOGLE_CLIENT_ID || '';
  if (!token || !clientId) { console.error('DRIVE_TOKEN und GOOGLE_CLIENT_ID fehlen.'); process.exit(2); }
  let code = 1;
  try {
    const { stand, fehler } = await driveLauf({ daten, token, clientId });
    const d = stand?.drive || {};
    if (d.fertig) { console.log(`Google Drive: ${d.info}${d.fehler ? ' · ' + d.fehler : ''}`); code = 0; }
    else if (d.wartet) console.error('Google hat das Zugriffstoken abgelehnt. Refresh-Token neu holen (README, Abschnitt Mappen in Google Drive).');
    else console.error(`Abgleich nicht fertig geworden: ${d.fehler || d.info || 'kein Stand'}`);
    for (const f of fehler.slice(0, 5)) console.error(f);
  } catch (e) { console.error('Abgleich abgebrochen:', e?.message || e); }
  await schliessen?.();
  process.exit(code);
}
