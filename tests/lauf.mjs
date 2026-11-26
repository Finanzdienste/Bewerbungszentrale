/*
 * Alle Tests: node tests/lauf.mjs  (oder einzelne: node tests/lauf.mjs laden teilen)
 * Arbeiten nur mit den erfundenen Daten aus tests/daten/.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { appStarten, schliessen, warte, WURZEL, FIREFOX } from './hilfe.mjs';

const tests = {};
const test = (name, f) => { tests[name] = f; };
const zuAkte = async (seite, id) => { await seite.goto('http://app.test/Bewerbungszentrale/#liste'); await seite.waitForSelector(`#v-liste [data-open="${id}"]`, { timeout: 20000 }); await seite.click(`#v-liste [data-open="${id}"]`); await warte(500); };
const json = (gh, p) => JSON.parse(gh.dateien.get(p).toString('utf8'));

test('einrichten', async () => {
  const { seite, gh, fehler } = await appStarten({ speicher: {} });
  await seite.waitForSelector('#bz-einrichten', { timeout: 10000 });
  await seite.fill('#bz-e-token', 'github_pat_falsch_000000000000000000');
  await seite.click('#bz-e-los');
  await seite.waitForFunction(() => /kennt diesen Schlüssel nicht/.test(document.querySelector('#bz-e-fehler')?.textContent || ''));
  await seite.fill('#bz-e-token', gh.token);
  await seite.click('#bz-e-los');
  await seite.waitForSelector('#bz-einrichten', { state: 'detached', timeout: 10000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-portal"]', { timeout: 20000 });
  const gespeichert = await seite.evaluate(() => JSON.parse(localStorage.getItem('bewerbungszentrale.zugang.v1')).token);
  assert.equal(gespeichert, gh.token);
  assert.deepEqual(fehler, []);
});

test('zugang-link', async () => {
  const { seite, gh } = await appStarten({ speicher: {} });
  await seite.goto(`http://app.test/Bewerbungszentrale/#zugang=${gh.token}`);
  await seite.reload();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-portal"]', { timeout: 20000 });
  assert.equal(await seite.locator('#bz-einrichten').count(), 0);
  assert.ok(!/zugang=/.test(await seite.evaluate(() => location.href)), 'Schlüssel bleibt nicht in der Adresse');
});

test('laden', async () => {
  const { seite, fehler } = await appStarten();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-mail"]', { timeout: 20000 });
  assert.equal(await seite.locator('.rang-item[data-open]').count(), 3);
  assert.deepEqual(fehler, []);
});

test('ohne-graphql', async () => {
  const { seite, gh, fehler } = await appStarten({ graphql: false });
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-mail"]', { timeout: 20000 });
  assert.ok(gh.log.some((x) => x.includes('/git/blobs/')), 'über REST geladen');
  assert.deepEqual(fehler, []);
});

test('schreiben', async () => {
  const { seite, gh, fehler } = await appStarten();
  await zuAkte(seite, 'test-portal');
  await seite.evaluate(() => window.bzStatusSetzen('test-portal', 'beworben')); // in der App passiert das beim Senden
  await seite.waitForFunction(() => window.bzPlattform.offen() === 0 && true, null, { timeout: 2000 }).catch(() => {});
  for (let i = 0; i < 40 && !gh.log.some((x) => x.startsWith('PUT') && x.includes('apps/test-portal.json')); i++) await warte(250);
  const roh = gh.dateien.get('apps/test-portal.json').toString('utf8');
  assert.ok(roh.endsWith('\n') && roh.startsWith('{\n "'), 'JSON mit 1 Leerzeichen und Zeilenumbruch');
  assert.equal(json(gh, 'apps/test-portal.json').status, 'beworben');
  assert.ok(gh.log.some((x) => x.includes('App: apps/test-portal gespeichert')));
  assert.deepEqual(fehler, []);
});

test('aussortiert', async () => {
  const { seite, gh, fehler } = await appStarten();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#aussortiert', { timeout: 20000 });
  assert.equal(await seite.locator('.rang-item[data-open="test-raus"]').count(), 0, 'nicht in der normalen Liste');
  assert.match(await seite.textContent('#aussortiert summary'), /1 Stelle passt nicht/);
  await seite.click('#aussortiert summary');
  assert.match(await seite.textContent('#aussortiert'), /Zeitwerk Personal GmbH[\s\S]*Zeitarbeit/);
  await seite.click('#aussortiert [data-act="zurueckholen"][data-rid="test-raus"]');
  await seite.waitForSelector('.rang-item[data-open="test-raus"]', { timeout: 5000 });
  for (let i = 0; i < 40 && json(gh, 'apps/test-raus.json').verworfen; i++) await warte(250);
  const d = json(gh, 'apps/test-raus.json');
  assert.equal(d.verworfen, false);
  assert.equal(d.ausgewaehlt, true, 'der Morgenlauf sortiert sie nicht noch einmal aus');
  assert.equal(d.aussortiert, undefined);
  assert.ok(d.verlauf.some((v) => /zurückgeholt/.test(v.text)));
  assert.equal(await seite.locator('#aussortiert').count(), 0, 'nichts mehr aussortiert');
  assert.deepEqual(fehler, []);
});

test('nachholen', async () => {
  const { seite, gh, fehler } = await appStarten();
  gh.schalter.schreibenHaengt = true;
  await zuAkte(seite, 'test-portal');
  await seite.evaluate(() => window.bzStatusSetzen('test-portal', 'beworben'));
  const offen = () => seite.evaluate(() => new Promise((ok) => { const r = indexedDB.open('bewerbungszentrale', 1); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('offen:apps/test-portal.json'); g.onsuccess = () => ok(g.result || null); g.onerror = () => ok(null); }; r.onerror = () => ok(null); }));
  let o = null;
  for (let i = 0; i < 40 && !(o = await offen()); i++) await warte(250);
  assert.ok(o && o.daten.status === 'beworben', 'offene Änderung in IndexedDB gemerkt');
  for (let i = 0; i < 40 && !gh.log.some((x) => x.includes('hängt: apps/test-portal.json')); i++) await warte(250);
  // Inzwischen ändert der Morgenlauf dieselbe Akte
  const d = json(gh, 'apps/test-portal.json');
  d.notizen = 'vom Lauf'; d.verlauf = [...(d.verlauf || []), { id: 'lauf1', datum: '2026-11-18', typ: 'notiz', text: 'Vom Lauf' }];
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify(d, null, 1) + '\n'));
  assert.equal(json(gh, 'apps/test-portal.json').status, 'gemerkt');
  // App wird geschlossen und später wieder geöffnet
  gh.schalter.schreibenHaengt = false;
  await seite.reload();
  for (let i = 0; i < 60 && json(gh, 'apps/test-portal.json').status !== 'beworben'; i++) await warte(250);
  const e = json(gh, 'apps/test-portal.json');
  assert.equal(e.status, 'beworben', 'beim nächsten Start nachgeholt');
  assert.equal(e.notizen, 'vom Lauf', 'Änderung des Laufs bleibt');
  assert.ok(e.verlauf.some((v) => v.id === 'lauf1') && e.verlauf.some((v) => v.typ === 'status'), 'Verlauf beider Seiten');
  for (let i = 0; i < 20 && await offen(); i++) await warte(250);
  assert.equal(await offen(), null, 'danach nichts mehr offen');
  assert.deepEqual(fehler, []);
});

test('nachschicken', async () => {
  const { seite, ctx, gh, fehler } = await appStarten();
  await zuAkte(seite, 'test-portal');
  // Kein Netz: die Änderung kommt nicht an und bleibt offen
  const kappen = (r) => r.abort('internetdisconnected');
  await ctx.route('https://api.github.com/**', kappen);
  await seite.evaluate(() => window.bzStatusSetzen('test-portal', 'beworben'));
  await warte(4000);
  assert.equal(json(gh, 'apps/test-portal.json').status, 'gemerkt', 'ohne Netz nichts angekommen');
  assert.ok(await seite.evaluate(() => window.bzPlattform.offen()) > 0, 'Änderung wartet');
  // Inzwischen ändert der Morgenlauf dieselbe Akte
  const d = json(gh, 'apps/test-portal.json');
  d.notizen = 'vom Lauf'; d.verlauf = [...(d.verlauf || []), { id: 'lauf2', datum: '2026-11-22', typ: 'notiz', text: 'Vom Lauf' }];
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify(d, null, 1) + '\n'));
  // Netz wieder da, die App bleibt offen
  await ctx.unroute('https://api.github.com/**', kappen);
  await seite.evaluate(() => window.dispatchEvent(new Event('online')));
  for (let i = 0; i < 60 && json(gh, 'apps/test-portal.json').status !== 'beworben'; i++) await warte(250);
  const e = json(gh, 'apps/test-portal.json');
  assert.equal(e.status, 'beworben', 'ohne Neustart nachgeschickt');
  assert.equal(e.notizen, 'vom Lauf', 'Änderung des Laufs bleibt');
  assert.ok(e.verlauf.some((v) => v.id === 'lauf2') && e.verlauf.some((v) => v.typ === 'status'), 'Verlauf beider Seiten');
  for (let i = 0; i < 20 && await seite.evaluate(() => window.bzPlattform.offen()); i++) await warte(250);
  assert.equal(await seite.evaluate(() => window.bzPlattform.offen()), 0, 'danach nichts mehr offen');
  const commits = gh.log.filter((x) => x.includes('App: apps/test-portal gespeichert')).length;
  await seite.evaluate(() => window.dispatchEvent(new Event('online')));
  await warte(1500);
  assert.equal(gh.log.filter((x) => x.includes('App: apps/test-portal gespeichert')).length, commits, 'kein doppelter Commit');
  assert.deepEqual(fehler, []);
});

test('eine-je-firma', async () => {
  const { seite, gh, fehler } = await appStarten();
  const leer = json(gh, 'apps/test-raus.json');
  // eine zweite Stelle bei derselben Firma wie test-portal (andere Schreibweise), zurückgestellt
  gh.dateien.set('apps/test-firma2.json', Buffer.from(JSON.stringify({ ...leer, firma: 'Hafen Muster Aktiengesellschaft Hamburg', position: 'Zweite Stelle (m/w/d)',
    aussortiert: { art: 'firma', grund: 'Eine Bewerbung je Firma: zuerst die andere Stelle', datum: '2026-11-18', von: 'Claude' } }, null, 1) + '\n'));
  // und eine abgeschickte Bewerbung bei der Firma von test-mail
  gh.dateien.set('apps/test-aktiv.json', Buffer.from(JSON.stringify({ ...leer, firma: 'Klima Beispiel GmbH & Co. KG', position: 'Andere Stelle', verworfen: false, aussortiert: undefined, status: 'beworben', beworbenAm: '2026-11-10' }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash', { timeout: 20000 });
  await seite.waitForFunction(() => !document.querySelector('#dash [data-bereich="bereit"] [data-open="test-mail"]'), null, { timeout: 10000 });
  assert.equal(await seite.locator('#mailFeld [data-act="sammel-mail"]').count(), 0, 'nichts senden, wo schon eine Bewerbung läuft');
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  // die zurückgestellte Stelle wartet still im Daten-Repo (rückt nach einer Absage nach), in der App steht sie nirgends
  await seite.waitForSelector('#aussortiert', { timeout: 20000 });
  await seite.click('#aussortiert summary');
  assert.match(await seite.textContent('#aussortiert summary'), /1 Stelle passt nicht/);
  assert.doesNotMatch(await seite.textContent('#v-liste'), /Zweite Stelle/);
  assert.equal(await seite.locator('[data-rid="test-firma2"], [data-open="test-firma2"]').count(), 0);
  assert.deepEqual(fehler, []);
});

test('alle-filter', async () => {
  // „Alle“ neben der Suche führt zur Liste mit Filtern und Sortierung (auch nach Gehalt), alles ohne Netz
  const { seite, ctx, gh, fehler } = await appStarten();
  const setze = (id, f) => gh.dateien.set(`apps/${id}.json`, Buffer.from(JSON.stringify({ ...json(gh, `apps/${id}.json`), ...f }, null, 1) + '\n'));
  setze('test-mail', { gehaltWunsch: 72000, anfahrt: { min: 20 } });
  setze('test-portal', { gehaltMin: 55000, gehaltMax: 65000, anfahrt: { min: 45 } });
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash', { timeout: 20000 });
  await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === 'app.test' ? r.fallback() : r.abort('internetdisconnected'))); // ab hier kein Netz
  await seite.fill('#dashQ', 'Muster');
  await seite.click('.dash-kopf .dash-alle');
  await seite.waitForSelector('#v-liste .radar-list', { timeout: 10000 });
  assert.equal(await seite.evaluate(() => location.hash), '#liste/alle');
  const reihe = () => seite.$$eval('#v-liste .radar-list [data-open]', (xs) => xs.map((x) => x.dataset.open));
  assert.deepEqual(await reihe(), ['test-portal'], 'die Suche kommt mit');
  assert.equal(await seite.$eval('#q', (x) => x.value), 'Muster');
  await seite.fill('#q', '');
  await seite.waitForFunction(() => document.querySelectorAll('#v-liste .radar-list [data-open]').length === 3, null, { timeout: 5000 });
  assert.deepEqual(await reihe(), ['test-portal', 'test-mail', 'test-leer'], 'Standard: nach Score');
  await seite.selectOption('#listSortier', 'gehalt');
  await seite.waitForFunction(() => document.querySelector('#v-liste .radar-list [data-open]')?.dataset.open === 'test-mail', null, { timeout: 5000 });
  assert.deepEqual(await reihe(), ['test-mail', 'test-portal', 'test-leer'], 'Gehalt: 72k, dann Spanne 55–65k, ohne Angabe am Ende');
  assert.match(await seite.textContent('#v-liste [data-open="test-mail"]'), /ca\. 72k €/);
  await seite.selectOption('#listSortier', 'fahrt');
  await seite.waitForFunction(() => document.querySelector('#v-liste .radar-list [data-open]')?.dataset.open === 'test-mail', null, { timeout: 5000 });
  assert.deepEqual(await reihe(), ['test-mail', 'test-portal', 'test-leer']);
  await seite.click('#v-liste [data-lweg="portal"]');
  await seite.waitForFunction(() => !document.querySelector('#v-liste [data-open="test-mail"]'), null, { timeout: 5000 });
  assert.deepEqual(await reihe(), ['test-portal', 'test-leer'], 'nur Portal');
  await seite.click('#v-liste [data-lweg="portal"]');
  await seite.waitForFunction(() => document.querySelectorAll('#v-liste .radar-list [data-open]').length === 3, null, { timeout: 5000 });
  await seite.reload(); // Sortierung bleibt gemerkt
  await seite.waitForSelector('#listSortier', { timeout: 20000 });
  assert.equal(await seite.$eval('#listSortier', (x) => x.value), 'fahrt');
  assert.deepEqual(fehler.filter((f) => !/Failed to fetch|NetworkError|internetdisconnected|ERR_INTERNET/i.test(f)), []);
});

test('anrufe', async () => {
  // Verpasster Anruf aus der Bildschirmzeit-App (Supabase) → Verlauf „Anruf“ und „zurückrufen“; ein späteres Gespräch hakt ab.
  // Ohne Netz geht nichts verloren, nichts kommt doppelt. Erfundene Nummern.
  const jetzt = Date.now(), vor = (min) => new Date(jetzt - min * 60000).toISOString();
  const anrufe = { liste: [
    { zeit: vor(30), nummer: '+494012345617', name: null, art: 'verpasst', sekunden: 0 },
    { zeit: vor(20), nummer: '017600000000', name: 'Erika Beispiel', art: 'eingehend', sekunden: 50 },
  ], abbruch: 1 };
  const { seite, gh, fehler } = await appStarten({ anrufe, bildschirmzeit: 'q'.repeat(43) });
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...json(gh, 'apps/test-mail.json'), kontakt: { name: 'Erika Beispiel', rolle: 'Personal', email: 'bewerbung@klima-beispiel.test', telefon: '040 1234 56-0' } }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash', { timeout: 20000 });
  // erster Versuch ohne Netz: nichts eingetragen
  await seite.evaluate(() => window.bzAnrufe.abgleichen());
  for (let i = 0; i < 20 && !(anrufe.abrufe || []).length; i++) await warte(250);
  assert.equal(anrufe.abrufe.length >= 1, true, 'die App fragt Supabase');
  assert.equal(anrufe.abrufe[0].p_kennung, 'q'.repeat(43));
  await warte(500);
  assert.equal((json(gh, 'apps/test-mail.json').verlauf || []).filter((v) => v.typ === 'anruf').length, 0, 'ohne Netz nichts eingetragen');
  // wieder Netz: „online“ holt es nach
  await seite.evaluate(() => window.dispatchEvent(new Event('online')));
  for (let i = 0; i < 60 && !(json(gh, 'apps/test-mail.json').verlauf || []).some((v) => v.typ === 'anruf'); i++) await warte(250);
  let a = json(gh, 'apps/test-mail.json');
  const eintraege = a.verlauf.filter((v) => v.typ === 'anruf');
  assert.equal(eintraege.length, 1, 'nur der Anruf mit passender Nummer (Zentrale mit Durchwahl), die fremde Nummer nicht');
  assert.match(eintraege[0].text, /^Verpasster Anruf von Klima Beispiel GmbH \(\+494012345617\)$/);
  const ruf = a.aufgaben.find((k) => !k.erledigt && /zurückrufen/.test(k.text));
  assert.ok(ruf, 'Aufgabe „zurückrufen“');
  assert.match(ruf.text, /^Klima Beispiel GmbH zurückrufen \(verpasster Anruf /);
  await seite.waitForSelector('#dash [data-bereich="antwort"] [data-open="test-mail"]', { timeout: 10000 });
  // noch einmal: nichts doppelt
  await seite.evaluate((t) => window.bzAnrufe.abgleichen(t), jetzt + 10 * 60000);
  await warte(1000);
  a = json(gh, 'apps/test-mail.json');
  assert.equal(a.verlauf.filter((v) => v.typ === 'anruf').length, 1, 'nichts doppelt');
  assert.equal(a.aufgaben.filter((k) => /zurückrufen/.test(k.text)).length, 1);
  // Rückruf mit Gespräch: die Aufgabe ist erledigt
  anrufe.liste.push({ zeit: vor(5), nummer: '04012345617', name: null, art: 'ausgehend', sekunden: 240 });
  await seite.evaluate((t) => window.bzAnrufe.abgleichen(t), jetzt + 20 * 60000);
  for (let i = 0; i < 60 && json(gh, 'apps/test-mail.json').verlauf.filter((v) => v.typ === 'anruf').length < 2; i++) await warte(250);
  a = json(gh, 'apps/test-mail.json');
  assert.match(a.verlauf.filter((v) => v.typ === 'anruf').pop().text, /^Anruf bei Klima Beispiel GmbH \(04012345617\), 4 Min\.$/);
  assert.equal(a.aufgaben.filter((k) => !k.erledigt && /zurückrufen/.test(k.text)).length, 0, 'zurückgerufen: erledigt');
  assert.deepEqual(fehler, []);
});

test('kontakte', async () => {
  // Kontaktnamen und Anruf-Briefings fürs Handy: Akten ab „beworben“ an Supabase (die Widget-App benennt damit Kontakte und
  // zeigt das Briefing beim Anruf). Ohne Netz geht nichts verloren, Unverändertes geht nicht noch einmal raus. Erfundene Daten.
  const kontakte = { gesetzt: [], abbruch: 1 };
  const { seite, gh, fehler } = await appStarten({ kontakte, bildschirmzeit: 'q'.repeat(43) });
  const setzen = (id, felder) => gh.dateien.set(`apps/${id}.json`, Buffer.from(JSON.stringify({ ...json(gh, `apps/${id}.json`), ...felder }, null, 1) + '\n'));
  setzen('test-mail', { status: 'beworben', beworbenAm: '2026-11-20', gehaltWunsch: 64000, briefing: 'Sie ruft vom Handy an: 0171 2223334. Sonst die Zentrale.',
    notizen: 'Offene Frage fürs Gespräch: Wie groß ist das Team?\nMeine eigene Nummer 040 000000 steht hier nur zum Test.',
    kontakt: { name: 'Frau Erika Beispiel', rolle: 'Personal', email: 'bewerbung@klima-beispiel.test', telefon: '040 1234 56-0' } });
  setzen('test-raus', { status: 'interview', kontakt: { name: '', rolle: '', email: '', telefon: '+49 171 0000000' } });
  setzen('test-portal', { status: 'gemerkt', kontakt: { name: 'Max Muster', rolle: '', email: '', telefon: '030 999999' } });
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash', { timeout: 20000 });
  // erster Versuch ohne Netz
  for (let i = 0; i < 40 && !kontakte.abgebrochen; i++) await warte(250);
  assert.equal(kontakte.abgebrochen, 1, 'die App versucht es');
  assert.equal(kontakte.gesetzt.length, 0);
  // wieder Netz: „online“ schickt es
  await seite.evaluate(() => window.dispatchEvent(new Event('online')));
  for (let i = 0; i < 40 && !kontakte.gesetzt.length; i++) await warte(250);
  assert.equal(kontakte.gesetzt.length, 1);
  assert.equal(kontakte.gesetzt[0].p_kennung, 'q'.repeat(43));
  const l = kontakte.gesetzt[0].p_kontakte;
  assert.deepEqual(l.map((e) => e.akte), ['test-mail', 'test-raus'], 'nur Akten ab „beworben“, nach Akte sortiert');
  const [m, r] = l;
  assert.deepEqual({ name: m.name, firma: m.firma, nummer: m.nummer, basis: m.basis, weitere: m.weitere },
    { name: 'Erika Beispiel (Klima Beispiel)', firma: 'Klima Beispiel', nummer: '+49401234560', basis: '+4940123456', weitere: ['+491712223334'] },
    'Name ohne Frau/Herr und Rechtsform, Nummer +49…, Zentrale ohne Durchwahl, weitere Nummer aus dem Briefing (die eigene nicht)');
  assert.match(m.briefing, /^Klima Beispiel GmbH – Energiecontroller \(m\/w\/d\)\nBeworben am 20\.11\.2026 · Stand: Beworben\nAnsprechperson: Frau Erika Beispiel, Personal\nForderung 64\.000\s€/);
  assert.match(m.briefing, /Offen fürs Gespräch:\n- Wie groß ist das Team\?/);
  assert.match(m.briefing, /\n\nSie ruft vom Handy an: 0171 2223334/, 'am Ende Claudes Gesprächs-Briefing');
  assert.deepEqual({ name: r.name, nummer: r.nummer, basis: r.basis }, { name: 'Zeitwerk Personal', nummer: '+491710000000', basis: null });
  // unverändert: nicht noch einmal – erst nach 12 Stunden wieder (falls drüben etwas verloren ging)
  await seite.evaluate(() => window.bzKontakte.melden());
  await warte(500);
  assert.equal(kontakte.gesetzt.length, 1, 'nichts doppelt');
  await seite.evaluate(() => { const [s] = localStorage.getItem('bz-kontakte-gemeldet-3').split('|'); localStorage.setItem('bz-kontakte-gemeldet-3', `${s}|${Date.now() - 13 * 3600e3}`); });
  await seite.evaluate(() => window.bzKontakte.melden());
  for (let i = 0; i < 40 && kontakte.gesetzt.length < 2; i++) await warte(250);
  assert.equal(kontakte.gesetzt.length, 2, 'nach 12 Stunden noch einmal');
  kontakte.gesetzt.pop();
  // eine neue Bewerbung: die ganze Liste neu
  setzen('test-portal', { status: 'beworben' });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  for (let i = 0; i < 40 && kontakte.gesetzt.length < 2; i++) await warte(250);
  assert.equal(kontakte.gesetzt.length, 2);
  assert.equal(kontakte.gesetzt[1].p_kontakte.length, 3);
  assert.equal(kontakte.gesetzt[1].p_kontakte.find((x) => x.akte === 'test-portal').name, 'Max Muster (Hafen Muster)');
  // Firmennamen und Nummern im Text
  const f = await seite.evaluate(() => ['Muster Personal GmbH & Co. KG', 'Beispiel & Co (Kunde offen)', 'B.E.I.S.P.I.E.L. GmbH', 'Gesellschaft für Beispiele, Muster und Proben mbH']
    .map((x) => window.bzKontakte.firma(x)));
  assert.deepEqual(f, ['Muster Personal', 'Beispiel', 'B.E.I.S.P.I.E.L.', 'Gesellschaft für Beispiele']);
  const n = await seite.evaluate(() => window.bzKontakte.nummernIn('Ruf an: +49 40 1234-56 oder (040) 765 43 21, Termin am 01.03.2027, Kennziffer 0012345, Fax 04193 7535-43'));
  assert.deepEqual(n, ['+4940123456', '+49407654321', '+494193753543']);
  assert.deepEqual(fehler, []);
});

test('nachschlagen', async () => {
  // Was die Widget-App zu einer unbekannten Nummer nachgeschlagen hat, kommt in die Akte; ein Anruf von der Nummer passt dann auch.
  const jetzt = Date.now(), vor = (min) => new Date(jetzt - min * 60000).toISOString();
  const nachschlag = { liste: [{ nummer: '+4930555666', zeit: vor(30), wer: 'Hafen Muster AG, Personalabteilung', akte: 'test-portal' },
    { nummer: '+4930777888', zeit: vor(20), wer: 'Werbeanruf', akte: null }], abbruch: 1 };
  const anrufe = { liste: [{ zeit: vor(30), nummer: '+4930555666', name: null, art: 'verpasst', sekunden: 0 }] };
  const { seite, gh, fehler } = await appStarten({ anrufe, nachschlag, bildschirmzeit: 'q'.repeat(43) });
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...json(gh, 'apps/test-portal.json'), status: 'beworben', kontakt: { name: 'Max Muster', rolle: '', email: '', telefon: '' } }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash', { timeout: 20000 });
  for (let i = 0; i < 40 && nachschlag.abbruch; i++) await warte(250);
  await warte(500);
  assert.equal((json(gh, 'apps/test-portal.json').verlauf || []).length, 0, 'ohne Netz nichts eingetragen');
  await seite.evaluate((t) => window.bzAnrufe.abgleichen(t), jetzt + 10 * 60000);
  for (let i = 0; i < 60 && !(json(gh, 'apps/test-portal.json').verlauf || []).some((v) => v.typ === 'anruf'); i++) await warte(250);
  let a = json(gh, 'apps/test-portal.json');
  assert.equal(a.kontakt.telefon, '+4930555666', 'die Nummer steht jetzt im Kontakt');
  assert.match(a.verlauf.find((v) => v.nachschlag).text, /^Nummer \+4930555666 beim Anruf nachgeschlagen: Hafen Muster AG, Personalabteilung$/);
  assert.ok(a.verlauf.some((v) => v.typ === 'anruf'), 'und der Anruf passt zur Akte');
  assert.ok(a.aufgaben.some((k) => !k.erledigt && /zurückrufen/.test(k.text)));
  // noch einmal: nichts doppelt
  await seite.evaluate((t) => window.bzAnrufe.abgleichen(t), jetzt + 20 * 60000);
  await warte(1000);
  a = json(gh, 'apps/test-portal.json');
  assert.equal(a.verlauf.filter((v) => v.nachschlag).length, 1);
  assert.deepEqual(fehler, []);
});

test('akte-link', async () => {
  // #akte/<id> aus der Mitteilung der Widget-App öffnet die Akte, sobald sie geladen ist
  const { seite, fehler } = await appStarten();
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => { location.hash = '#akte/test-mail'; });
  await seite.waitForFunction(() => /Klima Beispiel/.test(document.querySelector('#drBody')?.textContent || ''), null, { timeout: 15000 });
  assert.equal(await seite.evaluate(() => location.hash), '#uebersicht');
  assert.deepEqual(fehler, []);
});

test('ki-fuer-widget', async () => {
  // #bildschirmzeit-ki aus der Widget-App: ein Tipp gibt den Claude-Schlüssel per bildschirmzeit://ki#… weiter, an keinen Server.
  const { seite, fehler } = await appStarten();
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  const art = await seite.evaluate(() => window.bzPlattform.kiFuerWidget());
  await seite.evaluate(() => { window.bzOeffnen = (u) => { window.__ziel = u; }; location.hash = '#bildschirmzeit-ki'; });
  await seite.waitForSelector('#mdl', { timeout: 5000 });
  assert.equal(await seite.evaluate(() => location.hash), '#uebersicht', 'der Anker ist gleich wieder weg');
  assert.equal(art, 'claude');
  await seite.click('#kwJa');
  assert.equal(await seite.evaluate(() => window.__ziel), 'bildschirmzeit://ki#sk-ant-test-00000000000000000000000000');
  assert.deepEqual(fehler, []);
  // der Nur-Lesen-Link gibt keinen Schlüssel weiter
  const nur = await appStarten({ nurLesen: true });
  await nur.seite.waitForSelector('#lesemodus', { timeout: 20000 });
  assert.equal(await nur.seite.evaluate(() => window.bzPlattform.kiFuerWidget()), '');
  assert.equal(await nur.seite.evaluate(() => window.bzPlattform.kiAnWidget()), false);
});

test('ki-fuer-widget-eintragen', async () => {
  // noch kein Schlüssel: im Dialog einfügen, merken, weitergeben – ohne GitHub-Schlüssel noch einmal und ohne Netz
  const { seite, ctx, fehler } = await appStarten({ ohneKi: true });
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  assert.equal(await seite.evaluate(() => window.bzPlattform.kiFuerWidget()), '');
  await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === 'app.test' ? r.fallback() : r.abort('internetdisconnected'))); // ab hier kein Netz
  await seite.evaluate(() => { window.bzOeffnen = (u) => { window.__ziel = u; }; location.hash = '#bildschirmzeit-ki'; });
  await seite.waitForSelector('#kwSchluessel', { timeout: 5000 });
  await seite.fill('#kwSchluessel', 'AIza' + 'x'.repeat(35));
  await seite.click('#kwSpeichern');
  assert.match(await seite.textContent('#kwFehler'), /beginnt mit sk-ant-/, 'nur Claude-Schlüssel');
  assert.equal(await seite.evaluate(() => window.__ziel || ''), '');
  await seite.fill('#kwSchluessel', '  sk-ant-test-11111111111111111111111111 ');
  await seite.click('#kwSpeichern');
  assert.equal(await seite.evaluate(() => window.__ziel), 'bildschirmzeit://ki#sk-ant-test-11111111111111111111111111');
  assert.equal(await seite.$('#mdl'), null, 'Dialog zu');
  assert.equal(await seite.evaluate(() => window.bzPlattform.kiFuerWidget()), 'claude', 'gemerkt, beim nächsten Mal reicht „Schlüssel geben“');
  assert.deepEqual(fehler.filter((f) => !/internetdisconnected|Failed to fetch|NetworkError/i.test(f)), []);
});

test('datei-anbieten', async () => {
  // Dauert das Erstellen länger als eine Sekunde, kommt ein Knopf „PDF öffnen“, dessen Tipp die Datei lädt. Ohne Netz.
  // (Gedacht war er für Firefox am Handy; die Ursache für about:blank dort war aber das download-Attribut, siehe „pdf-firefox-handy“.)
  const { seite, ctx, fehler } = await appStarten();
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await zuAkte(seite, 'test-mail');
  await seite.click('[data-tab="unterlagen"]');
  await seite.waitForSelector('#pdfKarte [data-teil="brief"]', { timeout: 10000 });
  await ctx.route('https://api.github.com/**', (r) => r.abort('internetdisconnected')); // ohne Netz zum Daten-Repo (wie im Test „pdf“)
  // Firefox ohne navigator.userActivation (26.11.2026: weiter about:blank): Die App misst den Tipp selbst. Schriften kommen langsam,
  // das Erstellen dauert also länger als eine Sekunde – dann der Knopf, nicht das stille Öffnen.
  await seite.evaluate(() => Object.defineProperty(navigator, 'userActivation', { configurable: true, value: undefined }));
  await seite.route('**/schrift/**', async (r) => { await warte(1500); await r.fallback(); });
  await seite.click('#pdfKarte [data-teil="brief"]');
  await seite.waitForSelector('#dlOeffnen', { timeout: 60000 });
  await seite.click('#dlZu');
  await seite.waitForFunction(() => !document.querySelector('#mdl'), null, { timeout: 5000 });
  await seite.unroute('**/schrift/**');
  await seite.evaluate(() => Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false, hasBeenActive: true } }));
  await seite.click('#pdfKarte [data-teil="brief"]');
  await seite.waitForSelector('#dlOeffnen', { timeout: 60000 });
  assert.match(await seite.textContent('#mdl'), /Anschreiben_.*\.pdf ist erstellt/);
  assert.equal(await seite.textContent('#dlOeffnen'), 'PDF öffnen');
  const [d] = await Promise.all([seite.waitForEvent('download', { timeout: 20000 }), seite.click('#dlOeffnen')]);
  assert.match(d.suggestedFilename(), /^Anschreiben_.*\.pdf$/);
  await seite.waitForFunction(() => !document.querySelector('#mdl'), null, { timeout: 5000 });
  // frischer Tipp: wie bisher sofort
  await seite.evaluate(() => Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true, hasBeenActive: true } }));
  const [d2] = await Promise.all([seite.waitForEvent('download', { timeout: 60000 }), seite.click('#pdfKarte [data-teil="brief"]')]);
  assert.match(d2.suggestedFilename(), /^Anschreiben_.*\.pdf$/);
  assert.equal(await seite.$('#dlOeffnen'), null);
  assert.deepEqual(fehler.filter((f) => !/internetdisconnected|Failed to fetch|NetworkError/i.test(f)), []);
});

test('pdf-firefox-handy', async () => {
  // Firefox auf Android zeigt PDFs selbst an. Trägt der Link das download-Attribut, verlegt es die Anzeige in einen neuen Tab
  // ohne Adresse; die installierte App zeigt dann nur about:blank (Tobi, 25. und 26.11.2026; Mozilla-Fehler 1953287).
  // Dort öffnet die App die PDF deshalb als normalen Link in einem neuen Fenster, unter einer echten Adresse vom Service Worker.
  const { seite, ctx, fehler } = await appStarten();
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await zuAkte(seite, 'test-mail');
  await seite.click('[data-tab="unterlagen"]');
  await seite.waitForSelector('#pdfKarte [data-teil="brief"]', { timeout: 10000 });
  await ctx.route('https://api.github.com/**', (r) => r.abort('internetdisconnected')); // ohne Netz zum Daten-Repo
  const geladen = []; seite.on('download', (d) => geladen.push(d.suggestedFilename()));
  // Firefox am Handy nachbilden. Service Worker und Vorrat gibt es in der Testumgebung nicht (kein https): beides nachbilden,
  // die Antwort des Service Workers gibt die Route unten.
  await seite.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Android 14; Mobile; rv:161.0) Gecko/161.0 Firefox/161.0' });
    window.__offen = [];
    window.open = (...a) => { window.__offen.push(a); return null; };
    window.__vorrat = new Map();
    const vorrat = { put: async (u, r) => { window.__vorrat.set(String(u), r); }, delete: async (u) => window.__vorrat.delete(String(u)), keys: async () => [...window.__vorrat.keys()].map((url) => ({ url })) };
    Object.defineProperty(window, 'caches', { configurable: true, value: { open: async (n) => { window.__vorratName = n; return vorrat; } } });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
    window.__tipp = (gilt) => Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: gilt, hasBeenActive: true } });
  });
  const ausgabe = /^http:\/\/app\.test\/Bewerbungszentrale\/ausgabe\/[0-9a-z]{9}-[0-9a-z]+\/Anschreiben_[A-Za-z0-9_-]+\.pdf$/;
  const alsSw = (r) => r.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'X-Bz-Ausgabe': '1' }, body: '%PDF-1.4 test' });
  await seite.route('**/ausgabe/**', alsSw);

  // 1) Der Tipp gilt noch: gleich ein neues Fenster mit der echten Adresse, kein Download-Link und kein Knopf
  await seite.evaluate(() => window.__tipp(true));
  await seite.click('#pdfKarte [data-teil="brief"]');
  await seite.waitForFunction(() => window.__offen.length === 1, null, { timeout: 60000 });
  const [adresse, ziel, art] = await seite.evaluate(() => window.__offen[0]);
  assert.match(adresse, ausgabe, 'echte Adresse mit dem Dateinamen');
  assert.equal(ziel, '_blank'); assert.equal(art, 'noopener');
  assert.equal(await seite.$('#dlOeffnen'), null, 'kein Knopf nötig');
  const abgelegt = await seite.evaluate(async (u) => { const r = window.__vorrat.get(u); const b = new Uint8Array(await r.clone().arrayBuffer()); return { name: window.__vorratName, typ: r.headers.get('Content-Type'), marke: r.headers.get('X-Bz-Ausgabe'), anfang: String.fromCharCode(...b.slice(0, 5)), groesse: b.length }; }, adresse);
  assert.deepEqual({ name: abgelegt.name, typ: abgelegt.typ, marke: abgelegt.marke, anfang: abgelegt.anfang }, { name: 'bz-ausgabe-v1', typ: 'application/pdf', marke: '1', anfang: '%PDF-' }, 'die PDF liegt für den Service Worker bereit');
  assert.ok(abgelegt.groesse > 1000);

  // 2) Der Tipp gilt nicht mehr (Erstellen dauerte zu lange): Knopf mit normalem Link, ohne download-Attribut
  await seite.evaluate(() => window.__tipp(false));
  await seite.click('#pdfKarte [data-teil="brief"]');
  await seite.waitForSelector('#dlOeffnen', { timeout: 60000 });
  const knopf = await seite.$eval('#dlOeffnen', (a) => ({ href: a.href, ziel: a.target, laden: a.hasAttribute('download'), rel: a.rel, text: a.textContent }));
  assert.match(knopf.href, ausgabe);
  assert.deepEqual({ ziel: knopf.ziel, laden: knopf.laden, rel: knopf.rel, text: knopf.text }, { ziel: '_blank', laden: false, rel: 'noopener', text: 'PDF öffnen' });
  assert.equal(await seite.evaluate(() => window.__offen.length), 1, 'ohne gültigen Tipp kein Versuch, selbst ein Fenster zu öffnen');
  const [neu] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }), seite.click('#dlOeffnen')]);
  assert.ok(neu, 'der Tipp auf den Knopf öffnet ein neues Fenster');
  await neu.close().catch(() => {});
  await seite.waitForFunction(() => !document.querySelector('#mdl'), null, { timeout: 5000 });

  // 3) Nur die neuesten sechs bleiben liegen
  await seite.evaluate(async () => { window.__tipp(true); const d = await window.claude.use('downloads'); for (let i = 0; i < 8; i++) { window.__tipp(true); await d.save({ filename: `Probe_${i}.pdf`, data: new Uint8Array([37, 80, 68, 70]) }); await new Promise((r) => setTimeout(r, 5)); } });
  const liegt = await seite.evaluate(() => [...window.__vorrat.keys()].sort().map((u) => u.split('/').pop()));
  assert.deepEqual(liegt, ['Probe_2.pdf', 'Probe_3.pdf', 'Probe_4.pdf', 'Probe_5.pdf', 'Probe_6.pdf', 'Probe_7.pdf']);

  // 4) Der Service Worker kennt die Adresse noch nicht (älterer Stand) oder es gibt keinen: derselbe Link auf die Blob-Adresse
  await seite.unroute('**/ausgabe/**', alsSw);
  const blob1 = await seite.evaluate(async () => { window.__tipp(true); const d = await window.claude.use('downloads'); await d.save({ filename: 'Alt.pdf', data: new Uint8Array([37, 80, 68, 70]) }); return window.__offen.at(-1); });
  assert.match(blob1[0], /^blob:http:\/\/app\.test\//); assert.equal(blob1[2], 'noopener');
  assert.equal(await seite.evaluate(() => [...window.__vorrat.keys()].some((u) => u.endsWith('/Alt.pdf'))), false, 'nichts bleibt liegen, was nicht ausgeliefert wird');
  const blob2 = await seite.evaluate(async () => { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: null } }); window.__tipp(false); const d = await window.claude.use('downloads'); await d.save({ filename: 'Ohne.pdf', data: new Uint8Array([37, 80, 68, 70]) }); const a = document.querySelector('#dlOeffnen'); return { href: a.href, ziel: a.target, laden: a.hasAttribute('download') }; });
  assert.match(blob2.href, /^blob:http:\/\/app\.test\//); assert.deepEqual({ ziel: blob2.ziel, laden: blob2.laden }, { ziel: '_blank', laden: false });
  await seite.click('#dlZu');

  // 5) Was keine PDF ist, lädt auch dort wie bisher herunter; und kein einziger PDF-Download-Link bis hierher
  assert.deepEqual(geladen, [], 'keine PDF über einen Download-Link');
  const [csv] = await Promise.all([seite.waitForEvent('download', { timeout: 10000 }), seite.evaluate(async () => { window.__tipp(true); document.body.dispatchEvent(new Event('click', { bubbles: true })); const d = await window.claude.use('downloads'); await d.save({ filename: 'Liste.csv', data: 'a;b' }); })]);
  assert.equal(csv.suggestedFilename(), 'Liste.csv');
  assert.deepEqual(fehler.filter((f) => !/internetdisconnected|Failed to fetch|NetworkError/i.test(f)), []);
});

test('sw-ausgabe', async () => {
  // Der Service Worker liefert die abgelegten PDFs unter ihrer echten Adresse aus: allein aus dem Vorrat, ohne Netz.
  const quelle = fs.readFileSync(path.join(WURZEL, 'sw.js'), 'utf8');
  const hoerer = {}, vorraete = new Map(), netz = [];
  const vorrat = (n) => { if (!vorraete.has(n)) vorraete.set(n, new Map()); const m = vorraete.get(n); const schluessel = (u) => (typeof u === 'string' ? u : u.url); return { match: async (u) => m.get(schluessel(u))?.clone(), put: async (u, r) => { m.set(schluessel(u), r); }, addAll: async () => {} }; };
  const welt = {
    self: { location: new URL('https://app.test/Bewerbungszentrale/sw.js'), addEventListener: (art, f) => { hoerer[art] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async (n) => vorrat(n), match: async () => undefined, keys: async () => [...vorraete.keys()], delete: async (n) => vorraete.delete(n) },
    fetch: async (r) => { netz.push(typeof r === 'string' ? r : r.url); throw new TypeError('kein Netz'); },
  };
  new Function(...Object.keys(welt), quelle)(...Object.values(welt));
  const adresse = 'https://app.test/Bewerbungszentrale/ausgabe/0mabc1234-x1y2z3/Anschreiben_Test_Firma.pdf';
  await (await welt.caches.open('bz-ausgabe-v1')).put(adresse, new Response(new Uint8Array([37, 80, 68, 70, 45]), { headers: { 'Content-Type': 'application/pdf', 'X-Bz-Ausgabe': '1' } }));
  const holen = async (url, mode = 'navigate') => { let antwort = null; hoerer.fetch({ request: { method: 'GET', url, mode }, respondWith: (p) => { antwort = p; } }); return antwort && await antwort; };
  for (const [url, mode] of [[adresse, 'navigate'], [adresse, 'cors'], [adresse + '?neu=1', 'navigate']]) { // neues Fenster, Probe der App, mit Anhängsel
    const da = await holen(url, mode);
    assert.equal(da.status, 200, url); assert.equal(da.headers.get('Content-Type'), 'application/pdf'); assert.equal(da.headers.get('X-Bz-Ausgabe'), '1');
    assert.equal(Buffer.from(await da.arrayBuffer()).toString('latin1'), '%PDF-');
  }
  const weg = await holen('https://app.test/Bewerbungszentrale/ausgabe/0mabc0000-aaaaaa/Fehlt.pdf');
  assert.equal(weg.status, 404, 'nicht mehr da: ein klarer Satz statt der Fehlerseite des Servers');
  assert.match(await weg.text(), /liegt nicht mehr vor/);
  assert.deepEqual(netz, [], 'für diese Adressen geht nichts ins Netz');
  assert.equal(await holen('https://anderswo.test/Bewerbungszentrale/ausgabe/x/y.pdf'), null, 'fremde Adressen bleiben unberührt');
  await holen('https://app.test/Bewerbungszentrale/'); // die App selbst: wie bisher erst das Netz
  assert.deepEqual(netz, ['https://app.test/Bewerbungszentrale/']);
});

test('kontakte-nur-lesen', async () => {
  // der Nur-Lesen-Link (für Freunde) schickt nichts
  const kontakte = { gesetzt: [] };
  const { seite, gh, fehler } = await appStarten({ kontakte, bildschirmzeit: 'q'.repeat(43), nurLesen: true });
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...json(gh, 'apps/test-mail.json'), status: 'beworben', kontakt: { name: 'Erika Beispiel', telefon: '040 123456' } }, null, 1) + '\n'));
  await seite.waitForSelector('#lesemodus', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash', { timeout: 20000 });
  await seite.evaluate(() => window.bzKontakte.melden());
  await warte(1500);
  assert.equal(kontakte.gesetzt.length, 0);
  assert.deepEqual(fehler, []);
});

test('gehalt', async () => {
  const { seite, gh, fehler } = await appStarten();
  const a = json(gh, 'apps/test-portal.json');
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...a, gehaltWunsch: 64000, gehaltBegruendung: 'Erfundene Begründung aus Vergleichsanzeigen.', gehaltAuto: true,
    anschreiben: a.anschreiben.replace('Mit freundlichen', 'Meine Gehaltsvorstellung liegt bei 61.000 Euro brutto im Jahr.\n\nMit freundlichen') }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await zuAkte(seite, 'test-portal');
  const h = seite.locator('#gwunschGrund');
  await seite.waitForFunction(() => /Erfundene Begründung/.test(document.querySelector('#gwunschGrund')?.textContent || ''), null, { timeout: 10000 });
  assert.match(await h.textContent(), /Vorschlag des Morgenlaufs: Erfundene Begründung/);
  assert.match(await h.textContent(), /steht noch 61\.000.*sag Claude Bescheid/, 'warnt, wenn der Brief eine andere Zahl nennt');
  assert.match(await seite.textContent('#gwunsch'), /Forderung: 64\.000/);
  assert.equal(await seite.locator('#d-gwunsch').count(), 0, 'nur Anzeige, kein Eingabefeld');
  assert.deepEqual(fehler, []);
});

test('weg-portal-mit-mail', async () => {
  // eine Kontakt-Mailadresse macht aus einer Portal-Bewerbung keine Mail-Bewerbung
  const { seite, gh, fehler } = await appStarten();
  const a = json(gh, 'apps/test-portal.json');
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...a, kontakt: { name: 'Erika Beispiel', rolle: 'Recruiterin', email: 'karriere@beispiel.test', telefon: '' } }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await zuAkte(seite, 'test-portal');
  await seite.waitForFunction(() => /Erika Beispiel/.test(document.querySelector('#drBody')?.textContent || ''), null, { timeout: 10000 });
  const t = await seite.textContent('#drBody .fakten');
  assert.match(t, /Über das Portal der Firma/);
  assert.doesNotMatch(t, /Per Mail an/);
  assert.match(t, /Erika Beispiel.*karriere@beispiel\.test/s, 'Mailadresse steht beim Kontakt');
  const abs = await seite.textContent('#drBody .abschicken');
  assert.match(await seite.textContent('#drBody > #anzeigeOben, #drBody #anzeigeOben'), /Zur Anzeige und zum Bewerbungsportal/);
  assert.equal(await seite.evaluate(() => { const o = document.querySelector('#anzeigeOben'); return o && o.parentElement.firstElementChild === o; }), true, 'Link ganz oben in Infos');
  assert.doesNotMatch(abs, /Per Gmail|Geht an/, 'kein Mail-Versand bei Portal-Bewerbung');
  assert.equal(await seite.locator('#drBody [data-act="gmail-api"], #drBody [data-act="gmail-senden"]').count(), 0);
  assert.deepEqual(fehler, []);
});

test('anfahrt', async () => {
  const { seite, gh, fehler } = await appStarten();
  const a = json(gh, 'apps/test-portal.json');
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...a, anfahrt: { min: 40, art: 'oepnv', weg: 'Bus 1 bis Testplatz, dann 3 min zu Fuß', oepnv: 40, rad: 55, auto: 45,
    tage: 3, tageGrund: 'laut Anzeige: 2 Tage Homeoffice', stunden: 4, genau: true } }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForFunction(() => /4 Std\. Fahrt pro Woche/.test(document.querySelector('#v-liste [data-open="test-portal"]')?.textContent || ''), null, { timeout: 10000 });
  const punkte = () => seite.evaluate(() => parseInt(document.querySelector('#v-liste [data-open="test-portal"] .radar-score')?.textContent || '', 10));
  assert.equal(await punkte(), 77, 'Gesamt 80 minus 3 für 4 Stunden Fahrt');
  await zuAkte(seite, 'test-portal');
  await seite.waitForSelector('#fahrtText', { timeout: 10000 });
  assert.match(await seite.textContent('#fahrtText'), /40 min einfach mit ÖPNV und Rad: Bus 1 bis Testplatz/);
  assert.match(await seite.textContent('#fahrtText'), /Auto 45 min/);
  assert.match(await seite.textContent('#fahrtStunden'), /2 Tage Homeoffice\. Rund 4 Stunden pro Woche.*3 Punkte/);
  assert.equal(await seite.locator('#d-btage').count(), 0, 'nur Anzeige, kein Eingabefeld');
  // Bürotage, die die Person im Chat nennt, trägt Claude ein
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...json(gh, 'apps/test-portal.json'), buerotage: 5 }, null, 1) + '\n'));
  await seite.click('#drClose');
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await zuAkte(seite, 'test-portal');
  await seite.waitForFunction(() => /Laut deiner Angabe\. Rund 6,5 Stunden pro Woche.*8 Punkte/.test(document.querySelector('#fahrtStunden')?.textContent || ''), null, { timeout: 10000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-portal"]', { timeout: 10000 });
  assert.equal(await punkte(), 72, 'mit 5 Bürotagen minus 8');
  assert.deepEqual(fehler, []);
});

test('anfahrt-geschaetzt', async () => {
  const { seite, gh, fehler } = await appStarten();
  const a = json(gh, 'apps/test-portal.json');
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...a, anfahrt: { min: 50, art: 'oepnv', weg: 'Bus 2 bis Teststraße', oepnv: 50, tage: 4,
    tageGrund: 'keine Angabe zum Homeoffice (angenommen 4 Bürotage)', geschaetzt: true, stunden: 6.5, genau: true } }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForFunction(() => /≈ 6,5 Std\. Fahrt pro Woche/.test(document.querySelector('#v-liste [data-open="test-portal"]')?.textContent || ''), null, { timeout: 10000 });
  await zuAkte(seite, 'test-portal');
  await seite.waitForSelector('#fahrtStunden', { timeout: 10000 });
  assert.match(await seite.textContent('#fahrtStunden'), /geschätzt, die Anzeige nennt keine Bürotage/);
  assert.deepEqual(fehler, []);
});

test('suche-autofill', async () => {
  const { seite, fehler } = await appStarten();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-portal"]', { timeout: 20000 });
  // so trägt ein Passwortmanager die Mailadresse ein: Wert setzen und input auslösen, ohne dass das Feld den Fokus hat
  await seite.evaluate(() => { const q = document.querySelector('#q'); q.blur(); q.value = 'max@example.org'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await warte(300);
  assert.equal(await seite.inputValue('#q'), '', 'Autofill wird verworfen');
  assert.ok(await seite.locator('[data-open="test-portal"]').count() > 0, 'Liste bleibt sichtbar');
  await seite.fill('#q', 'Beispiel');
  await warte(300);
  assert.equal(await seite.inputValue('#q'), 'Beispiel', 'echte Suche bleibt');
  assert.deepEqual(fehler, []);
});

test('laden-viel', async () => {
  // viele Akten: Pakete zu 40, mehrere gleichzeitig, alle kommen an (erfundene Daten)
  const { seite, gh, fehler } = await appStarten();
  const vorlage = json(gh, 'apps/test-portal.json');
  for (let i = 0; i < 130; i++) gh.dateien.set(`apps/test-viel-${i}.json`, Buffer.from(JSON.stringify({ ...vorlage, firma: `Viel Beispiel ${i} GmbH`, position: `Stelle ${i}` }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash', { timeout: 20000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForFunction(() => document.querySelectorAll('[data-open^="test-viel-"]').length >= 130, null, { timeout: 20000 });
  assert.ok(gh.log.filter((x) => x === 'POST /graphql').length >= 4, '130 Akten in mindestens 4 Paketen');
  assert.deepEqual(fehler, []);
});

test('reiter', async () => {
  // beim Wechsel des Reiters ist nur die neue Seite sichtbar, die alte verschwindet
  const { seite, fehler } = await appStarten({ breite: 1400, hoehe: 900 });
  const sichtbar = () => seite.evaluate(() => [...document.querySelectorAll('section.view')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.id));
  for (const [hash, id] of [['#uebersicht', 'v-uebersicht'], ['#liste', 'v-liste'], ['#karte', 'v-karte'], ['#termine', 'v-termine'], ['#profil', 'v-profil'], ['#uebersicht', 'v-uebersicht']]) {
    await seite.goto('http://app.test/Bewerbungszentrale/' + hash); await warte(400);
    assert.deepEqual(await sichtbar(), [id], `${hash} zeigt nur ${id}`);
  }
  assert.deepEqual(fehler, []);
});

test('aufgaben', async () => {
  // nur echte To-dos: keine Versand-Aufgaben (die stehen unter „Bereit zum Abschicken“), keine Hinweise, nichts aus zurückgestellten Akten
  const { seite, gh, fehler } = await appStarten({ breite: 1400, hoehe: 900 });
  const a = json(gh, 'apps/test-portal.json');
  const auf = (text) => ({ id: Math.random().toString(36).slice(2), text, faellig: '2026-11-10', erledigt: false });
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...a, aufgaben: [auf('Über das Portal bewerben (Bewerbungsmappe aus der App hochladen)'), auf('Beispiel GmbH nimmt keine Initiativbewerbungen an, offene Stellen beobachtet der Radar'), auf('Vor der Bewerbung klären: Ist Hamburg als Arbeitsort möglich?'), auf('Postanschrift im Impressum nachsehen'), auf('Arbeitsprobe an die Fachabteilung schicken')] }, null, 1) + '\n'));
  gh.dateien.set('apps/test-zurueck.json', Buffer.from(JSON.stringify({ ...a, firma: 'Zurück Beispiel GmbH', keinBrief: true, aufgaben: [auf('Etwas Altes erledigen')] }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.goto('http://app.test/Bewerbungszentrale/#termine');
  await seite.waitForFunction(() => /Arbeitsprobe an die Fachabteilung/.test(document.querySelector('#v-termine')?.textContent || ''), null, { timeout: 10000 });
  const text = await seite.textContent('#v-termine');
  assert.doesNotMatch(text, /Über das Portal bewerben/);
  assert.doesNotMatch(text, /nimmt keine Initiativbewerbungen an/);
  assert.doesNotMatch(text, /Etwas Altes erledigen/);
  assert.doesNotMatch(text, /Ist Hamburg als Arbeitsort möglich/, 'Prüfpunkte vor dem Absenden stehen in der Akte');
  assert.doesNotMatch(text, /Postanschrift im Impressum/);
  assert.deepEqual(fehler, []);
});

test('firefox', async () => {
  // Stellenanzeigen öffnen auf Android in Firefox (Intent), nicht im Fenster der App
  const html = fs.readFileSync(path.join(WURZEL, 'index.html'), 'utf8');
  const i = html.indexOf('function firefoxIntent'); const src = html.slice(i, html.indexOf('\n', i));
  const firefoxIntent = new Function(`${src}; return firefoxIntent;`)();
  assert.equal(firefoxIntent('https://www.doerner.de/job/test?x=1'), 'intent://www.doerner.de/job/test?x=1#Intent;scheme=https;package=org.mozilla.firefox;end');
  assert.equal(firefoxIntent('mailto:a@b.test'), 'mailto:a@b.test');
  const j = html.indexOf('function mitIntent'); const mitIntent = new Function(`${html.slice(j, html.indexOf('\n', j))}; return mitIntent;`)();
  assert.equal(mitIntent('Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'), true, 'Chrome auf Android: an Firefox geben');
  assert.equal(mitIntent('Mozilla/5.0 (Android 14; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0'), false, 'schon in Firefox: normaler Tab');
  assert.equal(mitIntent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'), false);
  const { seite, fehler } = await appStarten();
  await zuAkte(seite, 'test-portal');
  await seite.waitForSelector('.fakten', { timeout: 10000 });
  assert.equal(await seite.locator('#anzeigeOben a[data-ff]').count(), 1, 'Anzeige-Link ganz oben und markiert');
  // Installierte App in Firefox am Handy: kein Intent (den nimmt Firefox dort still nicht an, v80: „passiert nichts“), der Link geht normal auf
  await seite.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Android 14; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0' });
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => /display-mode/.test(q) ? { matches: /standalone/.test(q), media: q, addEventListener() {}, removeEventListener() {} } : mm(q);
  });
  const sprung = [];
  seite.on('request', (r) => { if (r.url().startsWith('intent:')) sprung.push(r.url()); });
  const [neu] = await Promise.all([seite.context().waitForEvent('page', { timeout: 10000 }).catch(() => null), seite.click('#anzeigeOben a[data-ff]')]);
  assert.ok(neu, 'Link öffnet ein neues Fenster');
  assert.deepEqual(sprung, [], 'kein Intent aus der Firefox-App');
  await neu.close();
  assert.deepEqual(fehler, []);
});

test('dateinamen', async () => {
  // höchstens 50 Zeichen, Firma ohne Rechtsform und ohne halbe Wörter (ein Portal hat einen 51 Zeichen langen Lebenslauf abgelehnt)
  const html = fs.readFileSync(path.join(WURZEL, 'index.html'), 'utf8');
  const g = (n, e = '\n') => { const i = html.indexOf(n); return html.slice(i, html.indexOf(e, i) + e.length); };
  const { dateiName } = new Function('P', `${g('const RECHTSFORM')}${g('function firmaKurz', '\n}\n')}${g('const DATEI_EN')}${g('function dateiName', '\n}\n')}${g('const asciiName')}; return { dateiName };`)(() => ({ name: 'Max Muster' }));
  assert.equal(dateiName('Lebenslauf', { firma: 'MUSTER DÖRNER GmbH & Co. KG' }), 'Lebenslauf_Max_Muster_MUSTER_DOERNER.pdf');
  assert.equal(dateiName('Motivationsschreiben', { firma: 'Hafen Muster AG' }), 'Motivationsschreiben_Max_Muster_Hafen_Muster.pdf');
  assert.equal(dateiName('Motivationsschreiben', { firma: 'Testklinikum Beispielstadt-Musterhausen (TBM)' }), 'Motivationsschreiben_Max_Muster_Testklinikum.pdf', 'an der Wortgrenze gekürzt');
  assert.equal(dateiName('Motivationsschreiben', { firma: 'Beispieluniversitätsklinikum Musterstadt' }), 'Motivationsschreiben_Max_Muster.pdf', 'lieber ohne Firma als ein halbes Wort');
  assert.equal(dateiName('Zeugnisse', {}), 'Zeugnisse_Max_Muster.pdf');
  // englische Anzeige: englische Dateinamen, Zeugnisse bleiben deutsch
  const en = { firma: 'Wind Beispiel GmbH', sprache: 'en' };
  assert.equal(dateiName('Anschreiben', en), 'Cover_Letter_Max_Muster_Wind_Beispiel.pdf');
  assert.equal(dateiName('Lebenslauf', en), 'CV_Max_Muster_Wind_Beispiel.pdf');
  assert.equal(dateiName('Motivationsschreiben', en), 'Motivation_Letter_Max_Muster_Wind_Beispiel.pdf');
  assert.equal(dateiName('Anschreiben_Zeugnisse', en), 'Cover_Letter_References_Max_Muster_Wind.pdf');
  assert.equal(dateiName('Bewerbung', en), 'Application_Max_Muster_Wind_Beispiel.pdf');
  for (const f of ['Erfundene Beispiel Versorgungsgesellschaft mbH & Co. KG', 'Ä', 'A B C D E F G H', '']) for (const art of ['Anschreiben', 'Motivationsschreiben', 'Lebenslauf', 'Bewerbung']) {
    const n = dateiName(art, { firma: f }); assert.ok(n.length <= 50 && /^[A-Za-z0-9_-]+\.pdf$/.test(n), n);
  }
});

test('nach-firefox', async () => {
  // Chrome auf Android: ein Knopf übergibt den Zugang per Link an Firefox; Firefox liest ihn ein und löscht ihn aus der Adresse
  const ua = 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
  const { seite, ctx, gh, fehler } = await appStarten();
  await ctx.addInitScript((u) => { Object.defineProperty(navigator, 'userAgent', { get: () => u }); window.__ziel = []; }, ua);
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.reload();
  await seite.waitForSelector('#dash', { timeout: 20000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#profil');
  await seite.waitForSelector('#firefoxPanel [data-act="nach-firefox"]', { timeout: 20000 });
  const link = await seite.evaluate(() => window.bzPlattform.uebergabeLink());
  assert.match(link, new RegExp(`^http://app\\.test/Bewerbungszentrale/#zugang=${gh.token}&ki=sk-ant-test-0+&google=${GOOGLE_ID.replace(/\./g, '\\.')}$`));
  // der Knopf geht über einen Intent an Firefox; den Sprung selbst fängt der Test ab
  // Den Knopf nur in Chromium drücken: Firefox kennt intent:// nicht und zeigt dafür manchmal eine Fehlerseite (auf dem Handy gibt es den Knopf dort ohnehin nicht)
  if (!FIREFOX) {
    const [anfrage] = await Promise.all([seite.waitForEvent('request', { predicate: (r) => r.url().startsWith('intent:'), timeout: 10000 }).catch(() => null), seite.click('[data-act="nach-firefox"]')]);
    assert.ok(anfrage && anfrage.url().startsWith('intent://app.test/Bewerbungszentrale/'), 'Sprung an Firefox');
  }
  // der Anker mit dem Zugang steht vor dem Intent-Teil (Android nimmt beim Lesen das letzte #)
  const html = fs.readFileSync(path.join(WURZEL, 'index.html'), 'utf8'); const i = html.indexOf('function firefoxIntent');
  const firefoxIntent = new Function(`${html.slice(i, html.indexOf('\n', i))}; return firefoxIntent;`)();
  assert.equal(firefoxIntent(link), `intent://${link.slice('http://'.length)}#Intent;scheme=http;package=org.mozilla.firefox;end`);
  if (!FIREFOX) assert.equal(await seite.evaluate(() => navigator.clipboard.readText()), link, 'Link liegt auch in der Zwischenablage');
  // Firefox: leerer Speicher, der Link richtet alles ein und verschwindet aus der Adresse
  const ff = await appStarten({ speicher: {} });
  await ff.seite.goto(link);
  await ff.seite.reload();
  await ff.seite.waitForSelector('#dash', { timeout: 20000 });
  assert.equal(await ff.seite.locator('#bz-einrichten').count(), 0, 'kein Einrichten-Fenster');
  assert.doesNotMatch(ff.seite.url(), /zugang=/, 'Zugang nicht mehr in der Adresse');
  assert.equal(await ff.seite.evaluate(() => JSON.parse(localStorage.getItem('bewerbungszentrale.google.v1')).clientId), GOOGLE_ID);
  // Firefox selbst zeigt den Knopf nicht
  assert.equal(await ff.seite.locator('#firefoxPanel').count(), 0);
  // ging der Anker unterwegs verloren: den Link aus der Zwischenablage ins Schlüsselfeld einfügen reicht
  const ff2 = await appStarten({ speicher: {} });
  await ff2.seite.waitForSelector('#bz-einrichten #bz-e-token', { timeout: 20000 });
  await ff2.seite.fill('#bz-e-token', link);
  await ff2.seite.click('#bz-e-los');
  await ff2.seite.waitForSelector('#dash', { timeout: 20000 });
  assert.equal(await ff2.seite.evaluate(() => JSON.parse(localStorage.getItem('bewerbungszentrale.google.v1')).clientId), GOOGLE_ID);
  assert.equal(await ff2.seite.evaluate(() => JSON.parse(localStorage.getItem('bewerbungszentrale.zugang.v1')).token), gh.token);
  assert.deepEqual([...fehler, ...ff.fehler, ...ff2.fehler], []);
});

test('firmengruppe', async () => {
  // Konzerntöchter zählen zur Mutter (eine Bewerbung je Firma), wie firma_gruppe() im Morgenlauf. Erfundene Zusätze, echte Firmennamen sind öffentlich.
  const html = fs.readFileSync(path.join(WURZEL, 'index.html'), 'utf8');
  const g = (n, e = '\n') => { const i = html.indexOf(n); return html.slice(i, html.indexOf(e, i) + e.length); };
  const firmaGruppe = new Function(`${g('const FIRMA_WEG')}${g('const FIRMA_GENERISCH')}${g('const FIRMA_ALIAS')}${g('function firmaGruppe', '\n}\n')}; return firmaGruppe;`)();
  assert.equal(firmaGruppe('HPC Hamburg Port Consulting GmbH'), firmaGruppe('Hamburger Hafen und Logistik AG'));
  assert.equal(firmaGruppe('HHLA Container Technik GmbH'), firmaGruppe('Hamburger Hafen und Logistik AG'));
  assert.equal(firmaGruppe('HANSAINVEST Hanseatische Investment-GmbH'), firmaGruppe('SIGNAL IDUNA Krankenversicherung a. G.'));
  assert.notEqual(firmaGruppe('Hamburger Energienetze GmbH'), firmaGruppe('Hamburger Energiewerke GmbH'));
});

test('empfaenger', async () => {
  // reine Funktion aus index.html, ohne Browser
  const html = fs.readFileSync(path.join(WURZEL, 'index.html'), 'utf8');
  const i = html.indexOf('function empfaengerName'); const src = html.slice(i, html.indexOf('\n}\n', i) + 3);
  const empfaengerName = new Function(`${src}; return empfaengerName;`)();
  const f = (name, an) => empfaengerName({ kontakt: { name }, anschreiben: an });
  const zwei = 'Bewerbung\n\nSehr geehrte Frau Beispiel-Muster, sehr geehrter Herr Probe,\n\nText';
  assert.equal(f('Erika Beispiel-Muster', zwei), 'Frau Erika Beispiel-Muster', 'Anrede vor dem eigenen Nachnamen zählt');
  assert.equal(f('Paul Probe', zwei), 'Herrn Paul Probe');
  assert.equal(f('Max Muster', 'Sehr geehrter Herr Dr. Muster,'), 'Herrn Max Muster');
  assert.equal(f('Herr Max Muster', ''), 'Herrn Max Muster');
  assert.equal(f('Anna Gauß', 'Sehr geehrte Frau Gauß, sehr geehrter Herr Klein,'), 'Frau Anna Gauß');
});

test('konflikt', async () => {
  const { seite, gh, fehler } = await appStarten();
  await zuAkte(seite, 'test-mail');
  // Ein Lauf ändert dieselbe Akte, bevor die App schreibt
  const d = json(gh, 'apps/test-mail.json'); d.notizen = 'vom Lauf'; gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify(d, null, 1) + '\n'));
  await seite.evaluate(() => window.bzStatusSetzen('test-mail', 'beworben'));
  for (let i = 0; i < 60 && json(gh, 'apps/test-mail.json').status !== 'beworben'; i++) await warte(250);
  assert.equal(json(gh, 'apps/test-mail.json').status, 'beworben', 'Schreiben klappt nach 409');
  assert.ok(gh.log.some((x) => x.startsWith('GET') && x.includes('/contents/apps/test-mail.json')), 'aktuelle sha geholt');
  assert.deepEqual(fehler.filter((f) => !/409/.test(f)), []);
});

test('abgleich', async () => {
  const { seite, gh } = await appStarten();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-portal"]', { timeout: 20000 });
  const neu = { ...json(gh, 'apps/test-leer.json'), firma: 'Neu vom Morgenlauf GmbH' };
  gh.dateien.set('apps/test-neu.json', Buffer.from(JSON.stringify(neu, null, 1) + '\n'));
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('[data-open="test-neu"]', { timeout: 5000 });
  gh.dateien.delete('apps/test-neu.json');
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('[data-open="test-neu"]', { state: 'detached', timeout: 5000 });
});

test('cache', async () => {
  const { seite, ctx } = await appStarten();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-portal"]', { timeout: 20000 });
  await warte(500);
  await ctx.route('https://api.github.com/**', (r) => r.abort('internetdisconnected'));
  await seite.reload();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-portal"]', { timeout: 10000 });
});

test('teilen', async () => {
  const { seite, fehler } = await appStarten({ teilen: true });
  await zuAkte(seite, 'test-portal');
  await seite.click('[data-act="wa-teilen"]');
  await seite.waitForFunction(() => { const e = document.querySelector('#wa-anhang'); return e && !e.querySelector('.pulse'); }, null, { timeout: 60000 });
  assert.match(await seite.textContent('#wa-anhang'), /Bewerbung_Max_Muster_Hafen_Muster\.pdf/);
  await seite.click('#wa-share');
  await seite.waitForFunction(() => window.__geteilt, null, { timeout: 5000 });
  const g = await seite.evaluate(() => window.__geteilt);
  assert.equal(g.dateien.length, 1);
  assert.equal(g.dateien[0].typ, 'application/pdf');
  assert.ok(g.dateien[0].groesse > 5000);
  assert.match(g.text, /drüberschauen/);
  assert.match(await seite.evaluate(() => navigator.clipboard.readText()), /drüberschauen/, 'Text liegt in der Zwischenablage (WhatsApp nimmt ihn zur PDF nicht mit)');
  assert.match(await seite.textContent('#wa-st'), /Text ist kopiert/);
  assert.deepEqual(fehler, []);
});

test('mail-teilen', async () => {
  const { seite, fehler } = await appStarten({ teilen: true });
  await zuAkte(seite, 'test-mail');
  await seite.click('details.manuell summary');
  await seite.click('[data-act="mail-teilen"]');
  await seite.waitForFunction(() => { const e = document.querySelector('#wa-anhang'); return e && !e.querySelector('.pulse'); }, null, { timeout: 60000 });
  assert.equal((await seite.textContent('#wa-an')).trim(), 'bewerbung@example.org');
  await seite.click('#wa-share');
  await seite.waitForFunction(() => window.__geteilt, null, { timeout: 5000 });
  const g = await seite.evaluate(() => window.__geteilt);
  assert.match(g.title, /Energiecontroller/);
  assert.equal(await seite.evaluate(() => navigator.clipboard.readText()), 'bewerbung@example.org', 'Empfänger liegt in der Zwischenablage');
  assert.equal(g.dateien.length, 1);
  assert.deepEqual(fehler, []);
});

test('ohne-teilen', async () => {
  const { seite } = await appStarten();
  await zuAkte(seite, 'test-portal');
  await seite.click('[data-act="wa-teilen"]');
  await seite.waitForSelector('#wa-pdf:not([hidden])', { timeout: 60000 });
  const [dl] = await Promise.all([seite.waitForEvent('download'), seite.click('#wa-pdf')]);
  assert.match(dl.suggestedFilename(), /\.pdf$/);
  assert.match(await seite.getAttribute('#wa-open', 'href') || '#', /^#|^https:\/\/wa\.me/);
});

test('ki', async () => {
  const { seite, ki, fehler } = await appStarten({ ki: async () => 'Bewerbung als Datenanalyst (m/w/d)\n\nSehr geehrte Damen und Herren,\n\nErfundener Testbrief.\n\nMit freundlichen Grüßen\nMax Muster' });
  await zuAkte(seite, 'test-leer');
  assert.equal(await seite.locator('#drawer [data-ki]').count(), 0, 'keine KI-Knöpfe in der Akte');
  assert.match(await seite.evaluate(async () => (await (await window.claude.use('sample'))('Testbrief', { cache: false })).text), /Erfundener Testbrief/);
  const a = ki.anfragen[0];
  assert.equal(a.body.model, 'claude-opus-5-5');
  assert.equal(a.body.stream, true);
  assert.equal(a.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.deepEqual(fehler, []);
});

test('nur-ansicht', async () => {
  // in der Akte gibt es nichts einzutragen: keine Eingabefelder, kein Status zum Umschalten, nichts zum Löschen
  const { seite, gh, fehler } = await appStarten({ speicher: { 'bewerbungszentrale.zugang.v1': JSON.stringify({ token: 'github_pat_test_0000000000000000000000' }) } });
  const offen = () => seite.evaluate(() => [...document.querySelectorAll('#drawer input, #drawer textarea, #drawer select')].filter((e) => e.type !== 'hidden' && !e.readOnly).map((e) => e.id || e.tagName));
  for (const id of ['test-mail', 'test-portal', 'test-leer']) {
    await zuAkte(seite, id);
    await seite.evaluate(() => document.querySelectorAll('#drawer details').forEach((d) => { d.open = true; }));
    assert.deepEqual(await offen(), [], `${id}: Infos ohne Eingabefelder`);
    await seite.click('[data-tab="verlauf"]');
    await seite.evaluate(() => document.querySelectorAll('#drawer details').forEach((d) => { d.open = true; }));
    assert.deepEqual(await offen(), [], `${id}: Verlauf ohne Eingabefelder`);
    assert.equal(await seite.locator('#drawer [data-act="del-ask"], #drawer [data-vdel], #drawer [data-kdel], #drawer [data-tdel], #drawer [data-task], #drawer [data-status], #drawer [data-act="mark-beworben"], #drawer [data-act="verwerfen"]').count(), 0, `${id}: nichts zum Ändern`);
    await seite.click('#drClose');
  }
  await seite.goto('http://app.test/Bewerbungszentrale/#profil');
  await seite.waitForSelector('#v-profil h1', { timeout: 10000 });
  assert.equal(await seite.locator('#v-profil [data-p], #v-profil [data-ps], #v-profil #upFile').count(), 0, 'Profil ohne Formulare');
  assert.ok(gh.token);
  assert.deepEqual(fehler, []);
});


const bis = async (f, ms = 10000) => { for (let i = 0; i < ms / 250; i++) { if (f()) return true; await warte(250); } return false; };
const GOOGLE_ID = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';
const mimeTeile = (mime) => {
  const kopf = mime.split('\r\n\r\n')[0];
  const betreff = (kopf.match(/^Subject: ((?:.*)(?:\r\n .*)*)/m) || [])[1].split('\r\n ').map((w) => (w.match(/^=\?UTF-8\?B\?(.+)\?=$/) ? Buffer.from(RegExp.$1, 'base64').toString('utf8') : w)).join('');
  const grenze = (kopf.match(/boundary="([^"]+)"/) || [])[1];
  const teile = mime.split('--' + grenze).slice(1, -1).map((t) => { const [k, ...r] = t.replace(/^\r\n/, '').split('\r\n\r\n'); return { kopf: k, inhalt: Buffer.from(r.join('\r\n\r\n').replace(/\s+/g, ''), 'base64') }; });
  return { kopf, betreff, teile };
};

test('gegenlesen', async () => {
  const { seite, gh, fehler } = await appStarten();
  await seite.waitForSelector('#dash', { timeout: 20000 });
  assert.match(await seite.textContent('#dash [data-bereich="bereit"] summary'), /Vorbereitet\s*1/);
  assert.match(await seite.textContent('#mailFeld'), /1 per Mail schicken/);
  assert.equal(await seite.locator('#dash [data-bereich="bereit"] [data-open="test-mail"]').count(), 1, 'freigegebene Mail-Bewerbung steht unter Vorbereitet');
  assert.equal(await seite.locator('#mailFeld [data-act="sammel-mail"]').count(), 1);
  await zuAkte(seite, 'test-mail');
  // App erkennt dieselbe Fassung wie der Morgenlauf: freigegeben, und dann kein Prüfergebnis in der Akte
  assert.equal(await seite.locator('#pruefung').count(), 0, 'freigegeben: kein Prüfkasten');
  const abs = await seite.textContent('#drBody .abschicken');
  assert.doesNotMatch(abs, /Gegengelesen|Note \d|klären|frühesten Eintritt/, 'keine Note, kein Inhalt, keine Fragen');
  await seite.click('#drClose');
  await zuAkte(seite, 'test-portal');
  assert.match(await seite.textContent('#pruefung'), /^Noch nicht fertig\. Claude überarbeitet die Bewerbung/);
  assert.doesNotMatch(await seite.textContent('#drBody .abschicken'), /zehn Jahre|Klarer Einstieg|Note 71/, 'keine Mängel und keine Note');
  assert.equal(await seite.locator('#pruefung button, #pruefung details').count(), 0);
  assert.deepEqual(fehler, []);
});

test('gegenlesen-neu', async () => {
  const { seite, gh, fehler } = await appStarten();
  const a = json(gh, 'apps/test-portal.json');
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...a, ueberarbeiten: { datum: '2026-11-18', maengel: ['Erfundener Punkt'] } }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await zuAkte(seite, 'test-portal');
  await seite.waitForFunction(() => /Noch nicht fertig/.test(document.querySelector('#pruefung')?.textContent || ''), null, { timeout: 10000 });
  assert.deepEqual(fehler, []);
});


test('gmail-einrichten', async () => {
  const { seite, fehler } = await appStarten({ google: true });
  await zuAkte(seite, 'test-mail');
  await seite.click('[data-act="gmail-api"]');
  await seite.waitForSelector('#ge-id');
  await seite.fill('#ge-id', 'keine-client-id');
  await seite.click('#ge-ok');
  assert.match(await seite.textContent('#ge-st'), /Darin steckt keine Client-ID/);
  await seite.fill('#ge-id', ` Client-ID: ${GOOGLE_ID.slice(0, 20)}\u200b${GOOGLE_ID.slice(20).replace('abcdef', 'ABCDEF')}\n`); // so kommt es beim Einfügen am Handy manchmal an
  await seite.click('#ge-ok');
  await seite.waitForSelector('#sm-los:not([disabled])', { timeout: 5000 });
  assert.equal(await seite.evaluate(() => JSON.parse(localStorage.getItem('bewerbungszentrale.google.v1')).clientId), GOOGLE_ID);
  assert.match(await seite.textContent('#sm-los'), /Jetzt senden/);
  assert.deepEqual(fehler, []);
});

test('sammel-mail', async () => {
  const { seite, gh, gmail, fehler } = await appStarten({ google: true });
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.reload();
  await seite.waitForSelector('#mailFeld [data-act="sammel-mail"]', { timeout: 20000 });
  await seite.click('#mailFeld [data-act="sammel-mail"]');
  await seite.waitForSelector('#sm-los:not([disabled])', { timeout: 5000 });
  assert.equal(await seite.locator('#sm-liste li').count(), 1, 'nur freigegebene Mail-Bewerbungen');
  assert.equal(gmail.length, 0, 'nichts gesendet vor dem Tippen');
  await seite.click('#sm-los');
  const ok = await bis(() => json(gh, 'apps/test-mail.json').status === 'beworben', 60000);
  if (!ok) console.log('  Stand:', await seite.textContent('#modalRoot').catch(() => '?'), fehler, gmail.length);
  assert.ok(ok, 'Akte steht auf beworben');
  assert.equal(gmail.length, 1);
  const g = gmail[0];
  assert.equal(g.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(g.kopf['content-type'], 'application/json');
  assert.equal(g.kopf.authorization, 'Bearer ya29.test-token');
  const m = mimeTeile(g.mime);
  assert.match(m.kopf, /^To: bewerbung@example\.org\r\n/);
  assert.equal(m.betreff, 'Bewerbung als Energiecontroller (m/w/d), Max Muster');
  assert.equal(m.teile.length, 2);
  assert.match(m.teile[0].inhalt.toString('utf8'), /^Sehr geehrte Frau Test,\r\n/);
  assert.match(m.teile[1].kopf, /Content-Type: application\/pdf; name="Bewerbung_Max_Muster_[^"]+\.pdf"/);
  assert.equal(m.teile[1].inhalt.subarray(0, 5).toString(), '%PDF-');
  const d = json(gh, 'apps/test-mail.json');
  assert.equal(d.gmailThreadId, 'thread-1');
  assert.ok(d.verlauf.some((v) => v.typ === 'mail' && /per Gmail an bewerbung@example\.org/.test(v.text)));
  assert.match(await seite.textContent('#sm-st'), /1 von 1 gesendet/);
  assert.match(await seite.textContent('#sm-liste'), /Gesendet und eingetragen/);
  assert.equal(await seite.evaluate(() => window.__anmeldungen), 1);
  assert.deepEqual(fehler, []);
});

test('gmail-probe', async () => {
  const { seite, gh, gmail, fehler } = await appStarten({ google: true });
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.reload();
  await zuAkte(seite, 'test-mail');
  await seite.click('[data-act="gmail-api"]');
  await seite.waitForSelector('#sm-probe:not([disabled])', { timeout: 5000 });
  await seite.click('#sm-probe');
  await seite.waitForFunction(() => /Probe an max@example\.org gesendet/.test(document.querySelector('#sm-st')?.textContent || ''), null, { timeout: 60000 });
  assert.equal(gmail.length, 1);
  const m = mimeTeile(gmail[0].mime);
  assert.match(m.kopf, /^To: max@example\.org\r\n/);
  assert.equal(m.betreff, '[Probe] Bewerbung als Energiecontroller (m/w/d), Max Muster');
  assert.match(m.teile[0].inhalt.toString('utf8'), /bewerbung@example\.org/);
  assert.equal(m.teile[1].inhalt.subarray(0, 5).toString(), '%PDF-');
  await warte(800);
  assert.equal(json(gh, 'apps/test-mail.json').status, 'gemerkt', 'Probe ändert die Akte nicht');
  assert.equal(await seite.locator('#sm-los:not([disabled])').count(), 1, 'danach kann echt gesendet werden');
  assert.deepEqual(fehler, []);
});

test('mail-antwort', async () => {
  // vorbereitete Antwort aus der Akte per Gmail senden: ohne Anhang, im selben Verlauf, Aufgabe „antworten“ wird erledigt
  const { seite, gh, gmail, fehler } = await appStarten({ google: true });
  const a = json(gh, 'apps/test-mail.json');
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...a, status: 'rueckmeldung', gmailThreadId: 'thread-alt',
    mail: { typ: 'antwort', text: 'Betreff: Re: Bewerbung als Testposition\n\nHallo Testteam,\n\ndrei Bürotage sind grundsätzlich möglich.\n\nViele Grüße\nMax Muster' },
    aufgaben: [...(a.aufgaben || []), { id: 'antw1', text: 'Testfirma antworten: Bürotage', faellig: '2026-11-20', erledigt: false }] }, null, 1) + '\n'));
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.reload();
  await zuAkte(seite, 'test-mail');
  await seite.click('[data-tab="verlauf"]');
  assert.match(await seite.textContent('#duBistDran'), /Testfirma antworten/, 'oben steht, was zu tun ist');
  assert.match(await seite.textContent('#mailKarte h3'), /Antwortvorschlag/);
  await seite.waitForSelector('[data-act="mail-gmail"]:not([hidden])', { timeout: 10000 });
  await seite.click('[data-act="mail-gmail"]');
  await seite.waitForSelector('#mg-send', { timeout: 5000 });
  assert.equal(await seite.inputValue('#mg-betreff'), 'Re: Bewerbung als Testposition');
  await seite.click('#mg-send');
  assert.ok(await bis(() => gmail.length === 1, 30000), 'Mail gesendet');
  const g = gmail[0];
  assert.equal(JSON.parse(g.roh).threadId, 'thread-alt', 'Antwort im selben Gmail-Verlauf');
  assert.match(g.mime, /^To: bewerbung@example\.org\r\n/);
  assert.match(g.mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.doesNotMatch(g.mime, /multipart/);
  assert.ok(await bis(() => (json(gh, 'apps/test-mail.json').aufgaben || []).find(k => k.id === 'antw1')?.erledigt === true, 15000), 'Aufgabe erledigt');
  assert.deepEqual(fehler, []);
});

test('ordner', async () => {
  // Portal-Mappen automatisch in einen Ordner: einmal wählen, dann je Stelle ein Ordner mit Score davor; Erledigtes räumt die App weg, Fremdes nicht
  const { seite, gh, fehler } = await appStarten();
  const a = json(gh, 'apps/test-mail.json');
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...a, kontakt: { ...a.kontakt, email: '' }, link: 'https://example.org/stelle/1', kennziffer: 'K-17' }, null, 1) + '\n'));
  await seite.addInitScript(() => {
    window.__pdf = 0; window.__manifest = 0;
    const datei = (name, text = '') => ({ kind: 'file', name, daten: new TextEncoder().encode(text),
      async getFile() { return new Blob([this.daten]); },
      async createWritable() { const f = this, teile = []; return { async write(d) { teile.push(d); }, async close() { f.daten = new Uint8Array(await new Blob(teile).arrayBuffer()); if (f.name.endsWith('.pdf')) window.__pdf++; if (f.name === '.bewerbungszentrale.json') window.__manifest++; } }; } });
    const ordner = (name) => { const kinder = new Map(); return { kind: 'directory', name, kinder,
      async getDirectoryHandle(n, o = {}) { let k = kinder.get(n); if (!k) { if (!o.create) throw new DOMException('fehlt', 'NotFoundError'); k = ordner(n); kinder.set(n, k); } return k; },
      async getFileHandle(n, o = {}) { let k = kinder.get(n); if (!k) { if (!o.create) throw new DOMException('fehlt', 'NotFoundError'); k = datei(n); kinder.set(n, k); } return k; },
      async removeEntry(n) { if (!kinder.delete(n)) throw new DOMException('fehlt', 'NotFoundError'); },
      async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; } }; };
    const w = ordner('Bewerbungen');
    w.kinder.set('99 Alte Firma - Erledigt', ordner('99 Alte Firma - Erledigt'));
    w.kinder.set('Eigene Notizen', ordner('Eigene Notizen'));
    w.kinder.set('Zeugnisse_Alt.pdf', datei('Zeugnisse_Alt.pdf', '%PDF alt'));
    w.kinder.set('.bewerbungszentrale.json', datei('.bewerbungszentrale.json', JSON.stringify({ zeugnisse: 'Zeugnisse_Alt.pdf', ordner: { '99 Alte Firma - Erledigt': 'x' } })));
    window.__wurzel = w;
    window.showDirectoryPicker = async () => w;
  });
  await seite.reload();
  await seite.waitForSelector('#dash', { timeout: 20000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#profil');
  await seite.waitForSelector('#ordner-zeile [data-act="ordner-waehlen"]', { timeout: 20000 });
  assert.equal(await seite.locator('[data-act="ordner-export"]').count(), 0, 'kein Export-Knopf');
  await seite.click('#ordner-zeile [data-act="ordner-waehlen"]');
  await seite.waitForFunction(() => window.__manifest >= 1, null, { timeout: 60000 });
  const stand = await seite.evaluate(async () => {
    const w = window.__wurzel, aus = {};
    for (const [n, k] of w.kinder) aus[n] = k.kind === 'file' ? new TextDecoder().decode(k.daten.slice(0, 4000)) : Object.fromEntries([...k.kinder].map(([m, f]) => [m, new TextDecoder().decode(f.daten.slice(0, 4000))]));
    return aus;
  });
  const namen = Object.keys(stand);
  const stelle = namen.find((n) => /Klima/.test(n));
  assert.ok(stelle, 'Ordner der Stelle: ' + namen.join(', '));
  assert.match(stelle, /^\d{2} Klima Beispiel GmbH - Energiecontroller$/, 'Score davor, ohne (m/w/d)');
  const inhalt = stand[stelle];
  const pdfs = Object.keys(inhalt).filter((n) => n.endsWith('.pdf')).sort();
  assert.equal(pdfs.length, 6, 'Anschreiben, Motivationsschreiben, Lebenslauf, Zeugnisse, Anschreiben mit Zeugnissen, Mappe: ' + pdfs.join(', '));
  assert.ok(['Anschreiben_', 'Motivationsschreiben_', 'Anschreiben_Zeugnisse_', 'Lebenslauf_', 'Zeugnisse_', 'Bewerbung_'].every((v) => pdfs.some((n) => n.startsWith(v))), 'alles in jedem Ordner');
  for (const n of pdfs) assert.ok(inhalt[n].startsWith('%PDF'), n + ' ist ein PDF');
  const info = inhalt['Portal-Infos.txt'];
  assert.match(info, /Link zur Anzeige: https:\/\/example\.org\/stelle\/1\r\n/);
  assert.match(info, /Kennziffer: K-17/);
  assert.match(info, /Gehaltsvorstellung: /);
  // Block für Formulare wie Workday, die den Lebenslauf falsch auslesen
  assert.match(info, /BERUFSERFAHRUNG\r\n\r\nTätigkeitsbezeichnung: Sachbearbeiter Controlling\r\n.*\r\nStandort: Hamburg\r\nVon: 03\.2025\r\nBis: aktuelle Arbeitsstelle/);
  assert.match(info, /Tätigkeitsbezeichnung: Praktikant Einkauf\r\n.*\r\nStandort: Musterstadt\r\nVon: 09\.2021\r\nBis: 01\.2022/);
  assert.match(info, /AUSBILDUNG\r\n\r\nEinrichtung: .+\r\nAbschluss: Bachelor\r\nFachbereich: BWL/);
  assert.match(info, /Sehr geehrte Damen und Herren,/, 'Anschreiben zum Einfügen, ohne Betreffzeile');
  assert.doesNotMatch(info, /Bewerbung als Energiecontroller \(m\/w\/d\)\r\n\r\nSehr geehrte/);
  assert.ok(!namen.some((n) => /^Zeugnisse_.*\.pdf$/.test(n)), 'keine Zeugnisse mehr im Hauptordner, auch die alte Kopie ist weg');
  assert.ok(!namen.includes('99 Alte Firma - Erledigt'), 'erledigter Ordner aus der eigenen Liste weg');
  assert.ok(namen.includes('Eigene Notizen'), 'fremde Ordner bleiben');
  const allg = Object.keys(stand.Allgemein || {}).sort();
  assert.equal(allg.length, 2, 'Allgemein: ' + allg.join(', '));
  assert.ok(allg.some((n) => /^Lebenslauf_[A-Za-z_]+\.pdf$/.test(n)) && allg.some((n) => /^Zeugnisse_/.test(n)), 'allgemeiner Lebenslauf ohne Firma und Zeugnisse');
  for (const n of allg) assert.ok(stand.Allgemein[n].startsWith('%PDF'), n);
  assert.ok(!namen.some((n) => /Hafen Muster/.test(n)), 'nur freigegebene Bewerbungen');
  assert.deepEqual(Object.keys(JSON.parse(stand['.bewerbungszentrale.json']).ordner), [stelle]);
  await seite.waitForFunction(() => /liegen automatisch in „Bewerbungen“: 1 Stelle/.test(document.querySelector('#ordner-zeile')?.textContent || ''), null, { timeout: 10000 });
  // nochmal abgleichen ohne Änderung: keine PDFs neu bauen
  const pdfVorher = await seite.evaluate(() => window.__pdf);
  await seite.evaluate(() => { location.hash = '#pipeline'; });
  await warte(6000);
  assert.equal(await seite.evaluate(() => window.__pdf), pdfVorher, 'unveränderte Stelle wird nicht neu gebaut');
  assert.equal(await seite.evaluate(() => window.__manifest), 1, 'ohne Änderung kein Schreibzugriff');
  assert.deepEqual(fehler, []);
});

test('drive', async () => {
  // dieselben Mappen fürs Handy in Google Drive: einmal verbinden, dann je Stelle ein Ordner; Erledigtes in den Papierkorb, Fremdes bleibt
  const { seite, gh, drive, fehler } = await appStarten({ google: true, driveAbbruch: 2, driveStart: [
    { id: 'w1', name: 'Bewerbungsmappen', mimeType: 'application/vnd.google-apps.folder', appProperties: { bz: 'wurzel' } },
    { id: 'alt1', name: '99 Alte Firma - Erledigt', mimeType: 'application/vnd.google-apps.folder', parents: ['w1'], appProperties: { bz: 'stelle', stand: 'x' } },
    { id: 'eig1', name: 'Eigene Notizen', mimeType: 'application/vnd.google-apps.folder', parents: ['w1'] },
    // erledigt, aber mit einer Datei darin, die nicht von der App ist: Drive lässt den Ordner nicht in den Papierkorb
    { id: 'alt2', name: '98 Andere Firma - Erledigt', mimeType: 'application/vnd.google-apps.folder', parents: ['w1'], appProperties: { bz: 'stelle', stand: 'x' } },
    { id: 'alt2a', name: 'Anschreiben_alt.pdf', mimeType: 'application/pdf', parents: ['alt2'] },
    { id: 'fremd1', name: 'Von Hand abgelegt.pdf', mimeType: 'application/pdf', parents: ['alt2'], fremd: true },
    // Allgemein mit altem Stand und fremder Datei: wird im selben Ordner neu befüllt
    { id: 'ag1', name: 'Allgemein', mimeType: 'application/vnd.google-apps.folder', parents: ['w1'], appProperties: { bz: 'allgemein', stand: 'alt' } },
    { id: 'ag1a', name: 'Lebenslauf_alt.pdf', mimeType: 'application/pdf', parents: ['ag1'] },
    { id: 'fremd2', name: 'Foto von Hand.jpg', mimeType: 'image/jpeg', parents: ['ag1'], fremd: true },
  ] });
  const a = json(gh, 'apps/test-mail.json');
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...a, kontakt: { ...a.kontakt, email: '' } }, null, 1) + '\n'));
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.reload();
  await seite.waitForSelector('#dash', { timeout: 20000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#profil');
  await seite.waitForSelector('#ordner-zeile [data-act="drive-verbinden"]', { timeout: 20000 });
  assert.match(await seite.textContent('#ordner-zeile'), /Drive einmal verbinden/);
  await seite.click('#ordner-zeile [data-act="drive-verbinden"]');
  const fertig = () => drive.kinder('w1').find((f) => /Klima/.test(f.name) && f.appProperties.stand);
  assert.ok(await bis(() => !!fertig(), 60000), 'Ordner der Stelle mit Stand: ' + drive.log.slice(-5).join(', '));
  const o = fertig();
  assert.match(o.name, /^\d{2} Klima Beispiel GmbH - Energiecontroller$/);
  const drin = drive.kinder(o.id), namen = drin.map((f) => f.name).sort();
  assert.equal(drin.length, 7, namen.join(', '));
  assert.ok(['Anschreiben_', 'Motivationsschreiben_', 'Anschreiben_Zeugnisse_', 'Lebenslauf_', 'Zeugnisse_', 'Bewerbung_'].every((v) => namen.some((n) => n.startsWith(v) && n.endsWith('.pdf'))));
  for (const f of drin.filter((f) => f.name.endsWith('.pdf'))) { assert.equal(f.inhalt.subarray(0, 4).toString(), '%PDF', f.name); assert.equal(f.mimeType, 'application/pdf'); }
  assert.match(drin.find((f) => f.name === 'Portal-Infos.txt').inhalt.toString('utf8'), /Gehaltsvorstellung: /);
  assert.equal(drive.log.filter((x) => x === 'abgebrochen').length, 2, 'zwei Netzaussetzer, trotzdem durchgelaufen');
  assert.equal(drive.dateien.get('alt1').trashed, true, 'erledigter Ordner in den Papierkorb');
  assert.equal(drive.dateien.get('eig1').trashed, false, 'fremder Ordner bleibt');
  assert.equal(drive.dateien.get('alt2a').trashed, true, 'eigene Datei im erledigten Ordner weg');
  assert.equal(drive.dateien.get('fremd1').trashed, false, 'fremde Datei bleibt');
  assert.equal(drive.dateien.get('alt2').appProperties.bz, 'fremd', 'Ordner mit fremder Datei lässt die App danach in Ruhe');
  assert.equal(drive.dateien.get('ag1').trashed, false, 'Allgemein im selben Ordner neu befüllt');
  assert.equal(drive.dateien.get('ag1a').trashed, true);
  assert.equal(drive.dateien.get('fremd2').trashed, false);
  const ag = drive.kinder('w1').filter((f) => f.appProperties?.bz === 'allgemein');
  assert.equal(ag.length, 1, 'ein Ordner Allgemein');
  assert.equal(ag[0].name, 'Allgemein');
  assert.deepEqual(drive.kinder(ag[0].id).map((f) => f.name.split('_')[0]).sort(), ['Lebenslauf', 'Zeugnisse']);
  assert.equal([...drive.dateien.values()].filter((f) => f.appProperties?.bz === 'wurzel').length, 1, 'vorhandener Hauptordner wird weiterbenutzt');
  await seite.waitForFunction(() => /Bewerbungsmappen“: 1 Stelle/.test(document.querySelector('#ordner-zeile')?.textContent || ''), null, { timeout: 10000 });
  const uploads = drive.log.filter((x) => x.includes('upload')).length;
  await seite.evaluate(() => { location.hash = '#pipeline'; });
  await warte(6000);
  assert.equal(drive.log.filter((x) => x.includes('upload')).length, uploads, 'ohne Änderung nichts neu hochladen');
  assert.deepEqual(fehler, []);
});

test('schaetzung', async () => {
  // jede Stelle hat einen Score: ohne Analyse und Wertung schätzt die App grob und zeigt es mit ≈
  const { seite, gh, fehler } = await appStarten();
  const leer = json(gh, 'apps/test-raus.json');
  gh.dateien.set('apps/test-direkt.json', Buffer.from(JSON.stringify({ firma: 'Beratung Muster GmbH', position: 'Controller Einkauf und ERP', status: 'rueckmeldung', interesse: 3, verworfen: false,
    erstellt: '2026-11-19T12:00:00Z', verlauf: [], aufgaben: [], kontakt: { name: '', rolle: '', email: '', telefon: '' }, stellenText: leer.stellenText || '' }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('#v-liste [data-open="test-direkt"] .radar-score', { timeout: 10000 });
  const text = await seite.textContent('#v-liste [data-open="test-direkt"] .radar-score');
  assert.match(text, /^≈\d{2}Schätzung$/, text);
  assert.match(await seite.getAttribute('#v-liste [data-open="test-direkt"] .radar-score', 'title'), /Grob geschätzt.*Eignung offen/);
  assert.deepEqual(fehler, []);
});

test('drive-lauf', async () => {
  // Abgleich ohne offene App (GitHub Action im Daten-Repo): App ohne Fenster, Zugriffstoken von außen, sonst derselbe Abgleich
  const { driveLauf } = await import('../werkzeug/drive-abgleich.mjs');
  const { stand, fehler, app } = await driveLauf({ daten: path.join(WURZEL, 'tests/daten'), token: 'ya29.test-lauf', clientId: GOOGLE_ID, echt: false, maxMin: 2,
    vorher: async ({ gh }) => { const a = json(gh, 'apps/test-mail.json'); gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...a, kontakt: { ...a.kontakt, email: '' } }, null, 1) + '\n')); } });
  assert.ok(stand?.drive?.fertig, JSON.stringify(stand));
  assert.match(stand.drive.info, /^1 Stelle, Stand/);
  const w = [...app.drive.dateien.values()].find((f) => f.appProperties?.bz === 'wurzel');
  assert.ok(w, 'Hauptordner angelegt');
  const kinder = app.drive.kinder(w.id).map((f) => f.name);
  assert.ok(kinder.some((n) => /^\d{2} Klima/.test(n)) && kinder.includes('Allgemein'), kinder.join(', '));
  assert.deepEqual(fehler, []);
});

test('eingang', async () => {
  // Eingangsbestätigung verschiebt die Karte nicht: sie bleibt bei „Beworben“ mit Hinweis, „Rückmeldung“ ist für echte Antworten
  const { seite, gh, fehler } = await appStarten({ breite: 1280 });
  const a = json(gh, 'apps/test-mail.json');
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...a, status: 'beworben', beworbenAm: '2026-11-18', eingangAm: '2026-11-18', maxStufe: 1 }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await seite.goto('http://app.test/Bewerbungszentrale/#pipeline');
  await seite.waitForSelector('#v-pipeline .card[data-id="test-mail"]', { timeout: 10000 });
  assert.match(await seite.textContent('#v-pipeline .card[data-id="test-mail"]'), /Eingang bestätigt/);
  assert.match(await seite.getAttribute('#v-pipeline .card[data-id="test-mail"]', 'aria-label'), /Beworben$/);
  assert.ok(await seite.locator('text=Rückmeldung').count() > 0, 'Spalte heißt Rückmeldung');
  assert.equal(await seite.locator('text=In Prüfung').count(), 0);
  assert.deepEqual(fehler, []);
});

test('dashboard', async () => {
  // drei Reiter (Dashboard, Karte, Profil), Kacheln je Stand öffnen genau diese Bewerbungen, Unterseiten mit Zurück-Link
  const { seite, gh, fehler } = await appStarten({ breite: 412 });
  const a = json(gh, 'apps/test-mail.json');
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...a, status: 'beworben', beworbenAm: '2026-11-18', maxStufe: 1 }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.goto('http://app.test/Bewerbungszentrale/#uebersicht');
  assert.deepEqual(await seite.$$eval('.tabbar a', (as) => as.map((x) => x.textContent.trim())), ['Dashboard', 'Karte', 'Profil']);
  await seite.waitForSelector('#dash', { timeout: 10000 });
  assert.doesNotMatch(await seite.textContent('#v-uebersicht'), /Radar/, 'kein Radar mehr im Dashboard');
  await seite.waitForSelector('#dash [data-bereich="beworben"]', { timeout: 10000 });
  assert.match(await seite.textContent('#dash [data-bereich="beworben"] summary'), /Beworben\s*1/);
  assert.equal(await seite.getAttribute('#dash [data-bereich="beworben"]', 'open'), null, 'Beworben ist zu, Vorbereitet offen');
  assert.notEqual(await seite.getAttribute('#dash [data-bereich="bereit"]', 'open'), null);
  await seite.click('#dash [data-bereich="beworben"] summary');
  await seite.waitForSelector('#dash [data-bereich="beworben"] [data-open="test-mail"]', { state: 'visible', timeout: 5000 });
  const hoehe = await seite.evaluate(() => document.querySelector('.dash-kopf .search').getBoundingClientRect().height);
  assert.ok(hoehe < 70, `Suchfeld ist ${hoehe}px hoch`);
  // „Alle“ als Knopf rechts neben der Suche (Filter und Sortierung stecken in der Liste dahinter)
  assert.equal(await seite.locator('#v-uebersicht [data-dweg], #dashWeg').count(), 0);
  const [r1, r2] = await seite.evaluate(() => [document.querySelector('.dash-kopf .search'), document.querySelector('.dash-kopf .dash-alle')].map((e) => e.getBoundingClientRect().toJSON()));
  assert.ok(r2.left >= r1.right - 1 && Math.abs(r2.top - r1.top) < 12, '„Alle“ steht rechts neben der Suche');
  assert.ok(r2.right <= 412, 'passt in die Breite');
  await seite.click('#dash [data-bereich="beworben"] summary'); // wieder zu
  await seite.fill('#dashQ', 'Klima Beispiel');
  await seite.waitForSelector('#dash [data-bereich="beworben"] [data-open="test-mail"]', { state: 'visible', timeout: 5000 });
  assert.equal(await seite.locator('#dash [data-open="test-portal"]').count(), 0, 'Suche klappt die Bereiche mit Treffern auf');
  await seite.fill('#dashQ', 'Hafen Muster'); // steht in keinem Bereich (noch nicht fertig): Hinweis auf „Alle“
  await seite.waitForFunction(() => !document.querySelector('#dash [data-open="test-mail"]') && /1 weiterer Treffer unter „Alle“/.test(document.querySelector('#dash')?.textContent || ''), null, { timeout: 5000 });
  assert.doesNotMatch(await seite.textContent('#v-uebersicht'), /Jetzt dran|Brauchen deinen Blick/);
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...json(gh, 'apps/test-mail.json'), aufgaben: [{ id: 'rr1', text: 'Testfirma zurückrufen (Fr bis 14 Uhr)', faellig: '2026-11-20', erledigt: false }],
    verlauf: [{ id: 'v1', datum: '2026-11-19', typ: 'mail', text: 'Erfundene Mail der Testfirma mit einem längeren Text, der auf dem Handy über mehrere Zeilen umbricht und nicht unter die Kopfzeile rutschen darf.' },
      { id: 'v3', datum: '2026-11-21', typ: 'notiz', text: 'Interne Notiz, gehört nicht in den Gesprächsverlauf' },
      { id: 'v2', datum: '2026-11-20T07:55:56Z', typ: 'mail', text: 'Zusammenfassung, die nicht erscheinen soll', mail: { von: 'Erika Beispiel <erika@beispiel.test>', an: ['ich@beispiel.test'], betreff: 'AW: Erfundene Stelle', datum: '2026-11-20T07:55:56Z', text: 'Hallo,\n\nhätten Sie nächste Woche Zeit für ein Kennenlernen?\n\nViele Grüße\nErika Beispiel', richtung: 'rein' } }] }, null, 1) + '\n'));
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.fill('#dashQ', '');
  await seite.waitForSelector('#dash [data-bereich="antwort"] [data-open="test-mail"]', { timeout: 10000 });
  assert.match(await seite.textContent('#dash [data-bereich="antwort"]'), /Warten auf deine Antwort\s*1.*zurückrufen/s);
  assert.equal(await seite.locator('#dash [data-bereich="beworben"] [data-open="test-mail"]').count(), 0, 'steht nur unter „Warten auf deine Antwort“');
  assert.match(await seite.textContent('#dash [data-bereich="rueckmeldung"] summary'), /Warten auf deren Rückmeldung/);
  const doppelt = await seite.evaluate(() => { const ids = [...document.querySelectorAll('#dash .bereich:not([data-bereich="alle"]) [data-open]')].map((li) => li.dataset.open); return ids.filter((x, i) => ids.indexOf(x) !== i); });
  assert.deepEqual(doppelt, [], 'jede Bewerbung nur in einem Bereich');
  assert.equal(await seite.locator('#mailFeld').count(), 0, 'keine Mail-Bewerbung bereit');
  assert.equal(await seite.locator('#dash [data-bereich="alle"]').count(), 0, '„Alle“ ist jetzt der Knopf oben');
  assert.equal(await seite.locator('#dash [data-bereich="vorbereitung"]').count(), 0, 'kein Bereich „In Vorbereitung“');
  // Akte: nur „Infos“ und „Verlauf“; im Verlauf steht oben, was zu tun ist
  await seite.click('#dash [data-bereich="antwort"] [data-open="test-mail"]');
  await seite.waitForSelector('#drHead [data-tab]', { timeout: 5000 });
  assert.deepEqual(await seite.$$eval('#drHead [data-tab]', (bs) => bs.map((x) => x.textContent.trim())), ['Infos', 'Unterlagen', 'Verlauf']);
  const [rt, rc] = await seite.evaluate(() => [document.querySelector('#drHead .dr-tabs'), document.querySelector('#drStatus')].map((e) => e.getBoundingClientRect().toJSON()));
  assert.ok(rt.right <= rc.left + 1 || rt.bottom <= rc.top + 1, 'Reiter und Status überlappen nicht');
  await seite.waitForSelector('.fakten', { timeout: 5000 });
  await seite.click('[data-tab="verlauf"]');
  await seite.waitForSelector('#duBistDran', { timeout: 5000 });
  assert.match(await seite.textContent('#duBistDran'), /zurückrufen/);
  assert.ok(await seite.evaluate(() => document.querySelector('#duBistDran').getBoundingClientRect().top < document.querySelector('.timeline, .empty-mini').getBoundingClientRect().top), 'Aufgabe steht über dem Verlauf');
  // Kopfzeile (Art, Datum) steht über dem Text, nicht daneben
  assert.ok(await seite.locator('.timeline li').count() > 0);
  const ueber = await seite.evaluate(() => [...document.querySelectorAll('.timeline li')].every((li) => li.querySelector('.h').getBoundingClientRect().bottom <= li.querySelector('.b, .mv').getBoundingClientRect().top + 1));
  assert.ok(ueber, 'Verlauf-Einträge überlappen nicht');
  // Gesprächsverlauf: Mails im Wortlaut und gleich offen, neueste oben, keine Notizen
  const mv = seite.locator('#vm-v2');
  assert.match(await mv.textContent(), /Erika Beispiel.*AW: Erfundene Stelle.*hätten Sie nächste Woche Zeit/s);
  assert.doesNotMatch(await seite.textContent('.timeline'), /Zusammenfassung, die nicht erscheinen soll/);
  assert.doesNotMatch(await seite.textContent('.timeline'), /Interne Notiz/);
  assert.equal(await mv.locator('.mv-t').isVisible(), true, 'Volltext ohne Aufklappen');
  assert.equal(await mv.locator('.mv-t').textContent(), 'Hallo,\n\nhätten Sie nächste Woche Zeit für ein Kennenlernen?\n\nViele Grüße\nErika Beispiel');
  assert.match(await mv.locator('.mv-meta').textContent(), /Erika Beispiel <erika@beispiel\.test> an ich@beispiel\.test/);
  assert.equal(await seite.locator('.timeline li:first-child #vm-v2').count(), 1, 'neueste oben');
  assert.equal(await seite.locator('#drBody details').count(), 0, 'im Verlauf muss nichts aufgeklappt werden');
  assert.match(await seite.textContent('.timeline li:first-child .h'), /20\.11\.2026, \d\d:\d\d/);
  assert.equal((await seite.textContent('#drStatus')).trim(), 'Beworben');
  assert.equal(await seite.locator('#drawer select').count(), 0, 'Status nur zum Ansehen');
  await seite.click('[data-act="close"]');
  await seite.click('.tabbar a[data-tab="karte"]');
  await seite.waitForFunction(() => !document.querySelector('#v-karte').hidden, null, { timeout: 10000 });
  assert.match(await seite.textContent('#v-karte'), /bereit zum Abschicken/);
  assert.equal(await seite.getAttribute('.tabbar a[data-tab="karte"]', 'aria-current'), 'page');
  assert.equal(await seite.isVisible('#zurueck'), false);
  assert.deepEqual(fehler, []);
});

test('wohnort', async () => {
  // Wohnort im Profil setzen: landet als heim im Profil (Daten-Repo), oben gibt es keine Knöpfe zum Anlegen mehr
  const { seite, gh, fehler } = await appStarten({ breite: 1280 });
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  assert.equal(await seite.locator('#btnNew, #btnPaste').count(), 0, 'keine Knöpfe oben');
  await seite.goto('http://app.test/Bewerbungszentrale/#profil');
  await seite.waitForSelector('#wohnortPanel #wohnortSlot', { timeout: 10000 });
  await seite.evaluate(() => window.bzWohnortSetzen(53.58123, 10.08456));
  assert.ok(await bis(() => { const p = JSON.parse(gh.dateien.get('profil/main.json').toString('utf8')); return p.heim && p.heim.lat === 53.5812 && p.heim.lon === 10.0846; }, 15000), 'Wohnort gespeichert, auf 4 Stellen gerundet');
  assert.match(await seite.textContent('#wohnortSt'), /Gespeichert/);
  // http://app.test ist kein sicherer Kontext, deshalb Standort im Browser nachbauen
  await seite.evaluate(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 53.57001, longitude: 10.09002, accuracy: 12 } }), 50) } }));
  await seite.click('[data-act="wohnort-gps"]');
  assert.ok(await bis(() => { const p = JSON.parse(gh.dateien.get('profil/main.json').toString('utf8')); return p.heim && p.heim.lat === 53.57 && p.heim.lon === 10.09; }, 15000), 'Wohnort per GPS gespeichert');
  assert.match(await seite.textContent('#wohnortSt'), /genau auf etwa 12 m/);
  assert.deepEqual(fehler.filter((f) => !/WebGL|webgl/.test(f)), []);
});

test('gmail-merken', async () => {
  // die Erlaubnis zum Senden gilt eine Stunde: nach dem Neuladen ohne neue Anmeldung, mit dem Gmail-Konto aus dem Profil als Vorauswahl
  const { seite, gmail, fehler } = await appStarten({ google: true });
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.reload();
  const probe = async () => {
    await zuAkte(seite, 'test-mail');
    await seite.click('[data-act="gmail-api"]');
    await seite.waitForSelector('#sm-probe:not([disabled])', { timeout: 5000 });
    await seite.click('#sm-probe');
    await seite.waitForFunction(() => /gesendet/.test(document.querySelector('#sm-st')?.textContent || ''), null, { timeout: 60000 });
  };
  await probe();
  assert.equal(await seite.evaluate(() => window.__anmeldungen), 1);
  const konto = JSON.parse(fs.readFileSync(path.join(WURZEL, 'tests/daten/profil/main.json'), 'utf8')).gmailKonto;
  if (konto) assert.equal(await seite.evaluate(() => window.__hinweis), konto, 'Konto vorausgewählt');
  await seite.reload();
  await probe();
  assert.equal(await seite.evaluate(() => window.__anmeldungen || 0), 0, 'nach dem Neuladen keine neue Anmeldung');
  assert.equal(gmail.length, 2);
  assert.deepEqual(fehler, []);
});

// Ohne Netz: vormerken, mit Netz geht sie raus – ohne Anmeldung nach einem Tipp, mit Anmeldung von selbst
async function vormerkenOhneNetz(seite, ctx) {
  await zuAkte(seite, 'test-mail');
  await ctx.setOffline(true);
  await seite.click('[data-act="gmail-api"]');
  await seite.waitForSelector('#sm-los:not([disabled])', { timeout: 5000 });
  assert.match(await seite.textContent('#sm-los'), /Vormerken/);
  assert.match(await seite.textContent('#sm-st'), /Gerade kein Netz/);
  await seite.click('#sm-los');
  await seite.waitForSelector('#postausgang', { timeout: 5000 });
  assert.match(await seite.textContent('#postausgang'), /1 Bewerbung wartet auf den Versand\. Sie geht raus, sobald du wieder Netz hast/);
  assert.match(await seite.textContent('#drBody'), /Vorgemerkt\./);
}

test('postausgang-tipp', async () => {
  const { seite, ctx, gh, gmail, fehler } = await appStarten({ google: true });
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.reload();
  await vormerkenOhneNetz(seite, ctx);
  assert.equal(gmail.length, 0, 'ohne Netz nichts gesendet');
  await ctx.setOffline(false);
  await seite.waitForSelector('#postausgang [data-act="postausgang-senden"]', { timeout: 10000 });
  await warte(2500);
  assert.equal(gmail.length, 0, 'ohne Anmeldung wartet sie auf einen Tipp');
  assert.match(await seite.textContent('#postausgang'), /Google braucht einmal deinen Tipp/);
  assert.equal(await seite.locator('#drBody [data-act="postausgang-senden"]').count(), 1, 'auch in der Akte');
  await seite.click('#drClose');
  await seite.click('#postausgang [data-act="postausgang-senden"]');
  assert.ok(await bis(() => json(gh, 'apps/test-mail.json').status === 'beworben', 60000), 'nach dem Tipp raus und eingetragen');
  assert.equal(gmail.length, 1);
  assert.equal(await seite.evaluate(() => window.__anmeldungen), 1);
  assert.ok(json(gh, 'apps/test-mail.json').verlauf.some((v) => v.typ === 'mail' && /per Gmail an bewerbung@example\.org/.test(v.text)));
  await seite.waitForFunction(() => !document.querySelector('#postausgang'), null, { timeout: 5000 });
  assert.equal(await seite.evaluate(() => localStorage.getItem('bewerbungszentrale.postausgang.v1')), null);
  assert.deepEqual(fehler, []);
});

test('postausgang-selbst', async () => {
  const { seite, ctx, gh, gmail, fehler } = await appStarten({ google: true });
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.evaluate(() => localStorage.setItem('bewerbungszentrale.gmail.v1', JSON.stringify({ token: 'ya29.test-token', bis: Date.now() + 3600e3 })));
  await seite.reload();
  await vormerkenOhneNetz(seite, ctx);
  await ctx.setOffline(false);
  assert.ok(await bis(() => json(gh, 'apps/test-mail.json').status === 'beworben', 60000), 'mit Netz von selbst raus');
  assert.equal(gmail.length, 1);
  assert.equal(await seite.evaluate(() => window.__anmeldungen || 0), 0, 'ohne neue Anmeldung');
  await seite.waitForFunction(() => /Vorgemerkte Bewerbung verschickt/.test(document.querySelector('#toasts')?.textContent || ''), null, { timeout: 10000 });
  assert.equal(await seite.locator('#postausgang').count(), 0, 'Hinweis weg');
  assert.equal(await seite.evaluate(() => localStorage.getItem('bewerbungszentrale.postausgang.v1')), null);
  assert.deepEqual(fehler, []);
});

test('postausgang-erledigt', async () => {
  // Ist sie inzwischen von einem anderen Gerät raus, geht sie hier nicht noch einmal raus
  const { seite, ctx, gh, gmail, fehler } = await appStarten({ google: true });
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.evaluate(() => localStorage.setItem('bewerbungszentrale.gmail.v1', JSON.stringify({ token: 'ya29.test-token', bis: Date.now() + 3600e3 })));
  await seite.reload();
  await vormerkenOhneNetz(seite, ctx);
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...json(gh, 'apps/test-mail.json'), status: 'beworben' }, null, 1) + '\n'));
  await ctx.setOffline(false);
  await seite.waitForFunction(() => !document.querySelector('#postausgang'), null, { timeout: 15000 });
  await warte(1500);
  assert.equal(gmail.length, 0, 'nicht doppelt beworben');
  assert.equal(await seite.evaluate(() => localStorage.getItem('bewerbungszentrale.postausgang.v1')), null);
  assert.deepEqual(fehler, []);
});

test('gmail-fehler', async () => {
  const { seite, gh, fehler } = await appStarten({ google: true, gmailFehler: 403 });
  await seite.goto(`http://app.test/Bewerbungszentrale/#google=${GOOGLE_ID}`);
  await seite.reload();
  await zuAkte(seite, 'test-mail');
  await seite.click('[data-act="gmail-api"]');
  await seite.waitForSelector('#sm-los:not([disabled])', { timeout: 5000 });
  await seite.click('#sm-los');
  await seite.waitForFunction(() => /0 von 1 gesendet/.test(document.querySelector('#sm-st')?.textContent || ''), null, { timeout: 60000 });
  assert.match(await seite.textContent('#sm-liste'), /Gmail-API eingeschaltet.*Google: Gmail API has not been used/s);
  assert.equal(json(gh, 'apps/test-mail.json').status, 'gemerkt');
  assert.deepEqual(fehler.filter((f) => !/403/.test(f)), []);
});

test('linkedin', async () => {
  const { seite, gh, fehler } = await appStarten();
  const a = json(gh, 'apps/test-portal.json');
  gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...a, netzwerk: { nachricht: 'Hallo [Vorname], ich arbeite im Controlling. Hätten Sie 15 Minuten? Viele Grüße, Max Muster' } }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await zuAkte(seite, 'test-portal');
  await seite.click('#netzwerk summary');
  const href = await seite.getAttribute('#li-suche', 'href');
  assert.match(href, /^https:\/\/www\.linkedin\.com\/search\/results\/people\/\?keywords=Hafen%20Muster/);
  await seite.waitForSelector('#li-text', { timeout: 10000 });
  assert.match(await seite.inputValue('#li-text'), /^Hallo \[Vorname\],/);
  assert.equal(await seite.locator('[data-act="li-ki"], [data-act="li-angeschrieben"]').count(), 0);
  // Schon beworben, noch keine Antwort: die Karte bleibt; nach einer Absage nicht mehr
  for (const [status, da] of [['beworben', 1], ['absage', 0]]) {
    gh.dateien.set('apps/test-portal.json', Buffer.from(JSON.stringify({ ...json(gh, 'apps/test-portal.json'), status }, null, 1) + '\n'));
    await seite.evaluate(() => window.bzPlattform.abgleichen());
    await seite.goto('http://app.test/Bewerbungszentrale/#akte/test-portal'); // wie aus der Widget-App, die Liste zeigt nicht jeden Status
    await seite.waitForSelector('.fakten', { timeout: 20000 });
    assert.equal(await seite.locator('#netzwerk').count(), da, status);
  }
  assert.deepEqual(fehler, []);
});


test('zeugnisse-getrennt', async () => {
  // HHLA (22.11.): das Portal fragt je Datei, ob Arbeits- oder Abschlusszeugnis. Beides einzeln als PDF, auch ohne Netz, wenn es einmal geladen war.
  const { seite, ctx, gh, fehler } = await appStarten();
  const p = json(gh, 'profil/main.json'), az = p.dateien.find((d) => d.typ === 'arbeitszeugnis');
  gh.dateien.set('profil/main.json', Buffer.from(JSON.stringify({ ...p, dateien: [...p.dateien, { ...az, name: 'Bachelorzeugnis_Max_Muster.pdf', typ: 'hochschule' }] }, null, 1) + '\n'));
  // http://app.test ist kein sicherer Kontext, also ohne Cache Storage: hier im Speicher nachgebildet (auf https gibt es ihn)
  await ctx.addInitScript(() => {
    if (window.caches) return;
    const alle = new Map();
    window.caches = { open: async (n) => { if (!alle.has(n)) alle.set(n, new Map()); const m = alle.get(n);
      return { match: async (r) => m.get(r.url || r)?.clone(), put: async (r, res) => { m.set(r.url || r, res.clone()); } }; } };
  });
  await seite.reload();
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await zuAkte(seite, 'test-mail');
  await seite.click('[data-tab="unterlagen"]');
  await seite.waitForSelector('#pdfKarte [data-teil="arbeit"]', { timeout: 10000 });
  assert.match(await seite.textContent('#pdfKarte'), /Zeugnisse.*Arbeitszeugnisse.*Abschlusszeugnisse/s);
  const { PDFDocument } = await import('pdf-lib');
  const seiten = async (d) => (await PDFDocument.load(fs.readFileSync(await d.path()))).getPageCount();
  const laden = (teil) => Promise.all([seite.waitForEvent('download', { timeout: 60000 }), seite.click(`#pdfKarte [data-teil="${teil}"]`)]).then(([d]) => d);
  const arbeit = await laden('arbeit'), abschluss = await laden('abschluss'), alle = await laden('anlagen');
  assert.equal(arbeit.suggestedFilename(), 'Arbeitszeugnisse_Max_Muster.pdf');
  assert.equal(abschluss.suggestedFilename(), 'Abschlusszeugnisse_Max_Muster.pdf');
  const [na, nb, nz] = [await seiten(arbeit), await seiten(abschluss), await seiten(alle)];
  assert.ok(na > 0 && nb > 0 && na + nb === nz, `Seiten: Arbeit ${na}, Abschluss ${nb}, alle ${nz}`);
  // ohne Netz: die Zeugnisse liegen schon im Vorrat
  await ctx.route('https://api.github.com/**', (r) => r.abort('internetdisconnected'));
  const offline = await laden('arbeit');
  assert.equal(await seiten(offline), na, 'ohne Netz dieselbe PDF');
  // Ohne Abschlusszeugnis im Profil keine getrennten Knöpfe (sonst wäre es dieselbe PDF wie „Zeugnisse“)
  const nur = await appStarten();
  await zuAkte(nur.seite, 'test-mail');
  await nur.seite.click('[data-tab="unterlagen"]');
  await nur.seite.waitForSelector('#pdfKarte', { timeout: 10000 });
  assert.equal(await nur.seite.locator('#pdfKarte [data-teil="arbeit"], #pdfKarte [data-teil="abschluss"]').count(), 0);
  assert.deepEqual([...fehler, ...nur.fehler].filter((f) => !/internetdisconnected|Failed to fetch|NetworkError/.test(f)), []);
});

test('gesendet', async () => {
  // Nach dem Versand: die verschickte PDF genau so abrufbar, dazu Anschreiben, Lebenslauf und Zeugnisse einzeln
  const { seite, gh, fehler } = await appStarten();
  const pdf = Buffer.from('%PDF-1.4\n% erfundene Testdatei\n%%EOF\n');
  gh.dateien.set('dateien/abcdef1234567890.pdf', pdf);
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...json(gh, 'apps/test-mail.json'), status: 'beworben',
    gesendet: { datum: '2026-11-18T09:14:40Z', weg: 'mail', an: 'bewerbung@beispiel.test', dateien: [{ id: 'abcdef1234567890', name: 'Bewerbung_Erfunden.pdf', url: '/_blob/abcdef1234567890', groesse: pdf.length }] } }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await zuAkte(seite, 'test-mail');
  await seite.click('[data-tab="unterlagen"]');
  await seite.waitForSelector('#gesendetKarte', { timeout: 10000 });
  assert.match(await seite.textContent('#gesendetKarte'), /Bewerbung_Erfunden\.pdf.*Genau die Datei, die am 18\.11\.2026 per Mail an bewerbung@beispiel\.test rausging/s);
  assert.match(await seite.textContent('#pdfKarte'), /Anschreiben.*Motivationsschreiben.*Lebenslauf.*Zeugnisse.*Anschreiben und Zeugnisse.*Ganze Mappe/s);
  const [d1] = await Promise.all([seite.waitForEvent('download', { timeout: 20000 }), seite.click('#gesendetKarte [data-act="gesendet-datei"]')]);
  assert.equal(d1.suggestedFilename(), 'Bewerbung_Erfunden.pdf');
  const [d2] = await Promise.all([seite.waitForEvent('download', { timeout: 60000 }), seite.click('#pdfKarte [data-teil="brief"]')]);
  assert.match(d2.suggestedFilename(), /^Anschreiben_.*\.pdf$/);
  const [d3] = await Promise.all([seite.waitForEvent('download', { timeout: 60000 }), seite.click('#pdfKarte [data-teil="motiv"]')]);
  assert.match(d3.suggestedFilename(), /^Motivationsschreiben_.*\.pdf$/);
  // Anschreiben und Zeugnisse in einer PDF, ohne Lebenslauf: so viele Seiten wie Anschreiben und Zeugnisse einzeln
  const { PDFDocument } = await import('pdf-lib');
  const seiten = async (d) => (await PDFDocument.load(fs.readFileSync(await d.path()))).getPageCount();
  const [d4] = await Promise.all([seite.waitForEvent('download', { timeout: 60000 }), seite.click('#pdfKarte [data-teil="ohnecv"]')]);
  assert.match(d4.suggestedFilename(), /^Anschreiben_Zeugnisse_Max_Muster.*\.pdf$/);
  const [d5] = await Promise.all([seite.waitForEvent('download', { timeout: 60000 }), seite.click('#pdfKarte [data-teil="anlagen"]')]);
  const [n2, n4, n5] = [await seiten(d2), await seiten(d4), await seiten(d5)];
  assert.ok(n5 > 0 && n4 === n2 + n5, `Seiten: Anschreiben ${n2}, Zeugnisse ${n5}, zusammen ${n4}`);
  assert.equal(await seite.locator('#pdfKarte [data-teil="foto"]').count(), 0, 'ohne Foto im Profil kein Foto-Knopf');
  // vor dem Versand: Unterlagen ohne Bereich „Gesendet“, Infos ohne Anschreiben
  await seite.click('#drClose');
  await zuAkte(seite, 'test-portal');
  await seite.waitForSelector('.fakten', { timeout: 10000 });
  assert.equal(await seite.locator('#ki-anschreiben').count(), 0, 'Anschreiben steht unter Unterlagen');
  await seite.click('[data-tab="unterlagen"]');
  await seite.waitForSelector('#pdfKarte', { timeout: 10000 });
  assert.equal(await seite.locator('#gesendetKarte').count(), 0);
  assert.equal(await seite.locator('#ki-anschreiben').count(), 1);
  assert.deepEqual(fehler, []);
});

test('foto', async () => {
  // Bewerbungsfoto aus dem Profil als Datei, z. B. fürs Feld „Passbild“ im Portal
  const { seite, gh, fehler } = await appStarten();
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
  gh.dateien.set('dateien/fedcba9876543210.jpg', jpg);
  const p = json(gh, 'profil/main.json');
  gh.dateien.set('profil/main.json', Buffer.from(JSON.stringify({ ...p, foto: { id: 'fedcba9876543210', url: '/_blob/fedcba9876543210' } }, null, 1) + '\n'));
  await seite.waitForSelector('#v-uebersicht', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForSelector('#dash, #v-liste', { timeout: 20000 });
  await zuAkte(seite, 'test-portal');
  await seite.click('[data-tab="unterlagen"]');
  await seite.waitForSelector('#pdfKarte [data-teil="foto"]', { timeout: 10000 });
  const [d] = await Promise.all([seite.waitForEvent('download', { timeout: 20000 }), seite.click('#pdfKarte [data-teil="foto"]')]);
  assert.match(d.suggestedFilename(), /^Bewerbungsfoto_.*\.jpg$/);
  assert.deepEqual(fehler, []);
});

test('lesemodus', async () => {
  const { seite, gh, fehler } = await appStarten({ nurLesen: true });
  await seite.waitForSelector('#lesemodus', { timeout: 20000 });
  assert.equal(await seite.locator('[data-act="sammel-mail"]').count(), 0, 'kein Sammelversand im Lesemodus');
  await zuAkte(seite, 'test-portal');
  await seite.evaluate(() => window.bzStatusSetzen('test-portal', 'beworben'));
  await warte(4000);
  assert.ok(!gh.log.some((x) => x.startsWith('PUT')), 'nichts geschrieben');
  assert.equal(json(gh, 'apps/test-portal.json').status, 'gemerkt');
  await seite.click('#drClose');
  await zuAkte(seite, 'test-mail');
  await seite.click('details.manuell summary');
  const [dl] = await Promise.all([seite.waitForEvent('download', { timeout: 60000 }), seite.click('details.manuell [data-act="mappe"]')]);
  assert.match(dl.suggestedFilename(), /\.pdf$/);
  assert.deepEqual(fehler, []);
});

test('bildschirmzeit', async () => {
  // Tobis Widget (Finanzdienste/Bildschirmzeit) zieht die Zeit der App von „Chrome“ ab. Supabase ist nachgebaut, die Kennungen sind erfunden.
  const K = 'Erfundene-Kennung_nur-zum-Testen'.padEnd(43, 'x'), K2 = 'Zweite_erfundene-Kennung'.padEnd(43, 'y');
  const { seite, ctx, fehler } = await appStarten();
  const anfragen = [];
  await ctx.route('https://vjyohppohmvhhxgwouti.supabase.co/**', (route) => {
    const r = route.request();
    anfragen.push({ name: r.url().split('/rpc/')[1], kopf: r.headers(), p: r.postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: 'true' });
  });
  const gespeichert = () => seite.evaluate(() => JSON.parse(localStorage.getItem('bildschirmzeit.bewerbungszentrale') || 'null'));
  const sichtbar = (v) => seite.evaluate((x) => !document.querySelector(`[data-view="${x}"]`).hidden, v);

  // Ohne Link: nichts gemessen, nichts geschickt, kein Wort davon
  await seite.goto('http://app.test/Bewerbungszentrale/#profil');
  await seite.waitForSelector('#v-profil h1', { timeout: 20000 });
  await seite.waitForFunction(() => typeof window.bzBildschirmzeit?.stand === 'function');
  await warte(300);
  assert.equal(anfragen.length, 0, 'ohne Link keine Anfrage');
  assert.equal(await seite.locator('#bz-bildschirmzeit').count(), 0, 'ohne Link kein Abschnitt');
  assert.equal(await gespeichert(), null);

  // Der Link aus der Widget-App: verbindet, verschwindet aus der Adresse, meldet „heute“ als bewerbungszentrale
  await seite.goto('http://app.test/Bewerbungszentrale/icon.svg'); // ein anderes Dokument: so lädt die App wirklich neu
  await seite.goto(`http://app.test/Bewerbungszentrale/#bildschirmzeit=${K}`);
  await seite.waitForFunction(() => /Bildschirmzeit verbunden/.test(document.querySelector('#toasts')?.textContent || ''), null, { timeout: 10000 });
  assert.ok(!/bildschirmzeit=/.test(await seite.evaluate(() => location.href)), 'der Link bleibt nicht in der Adresse');
  assert.ok(await sichtbar('uebersicht'), 'die App startet wie sonst');
  for (let i = 0; i < 100 && !anfragen.length; i++) await warte(50);
  const m = anfragen[0];
  assert.equal(m?.name, 'bildschirmzeit_melden');
  assert.equal(m.p.p_app, 'bewerbungszentrale');
  assert.equal(m.p.p_kennung, K);
  assert.equal(Object.keys(m.p.p_tage).length, 1);
  assert.ok(Object.values(m.p.p_tage)[0] <= 1, `heute fängt bei 0 an (${JSON.stringify(m.p.p_tage)})`);
  assert.equal(m.kopf.apikey, 'sb_publishable_wTUNShIKMFjCOmZzQuuN-A_vFHPkKUI');
  assert.equal(m.kopf.authorization, undefined, 'nur der öffentliche Schlüssel, kein Authorization');
  assert.equal((await gespeichert()).kennung, K);

  // Unter „Profil & Daten“: der Stand und „Trennen“
  await seite.goto('http://app.test/Bewerbungszentrale/#profil');
  await seite.waitForSelector('#bz-bildschirmzeit', { timeout: 10000 });
  assert.match(await seite.textContent('#bz-bildschirmzeit'), /Verbunden mit deinem Widget\. Heute .* offen/);

  // Ein neuer Link in der offenen App: verbindet neu, man bleibt in der Ansicht – auch in der Adresse
  await seite.goto('http://app.test/Bewerbungszentrale/#pipeline');
  await seite.waitForFunction(() => !document.querySelector('[data-view="pipeline"]').hidden);
  await seite.evaluate((k) => { location.hash = `#bildschirmzeit=${k}`; }, K2);
  await seite.waitForFunction((k) => JSON.parse(localStorage.getItem('bildschirmzeit.bewerbungszentrale') || '{}').kennung === k, K2, { timeout: 5000 });
  await warte(200);
  assert.equal(await seite.evaluate(() => location.hash), '#pipeline');
  assert.ok(await sichtbar('pipeline'), 'die Pipeline bleibt offen');

  // Trennen: nichts mehr messen und schicken, der Abschnitt verschwindet
  await seite.goto('http://app.test/Bewerbungszentrale/#profil');
  await seite.waitForSelector('#bz-bildschirmzeit', { timeout: 10000 });
  await seite.click('[data-act="bildschirmzeit-trennen"]');
  await seite.waitForSelector('#bz-bildschirmzeit', { state: 'detached', timeout: 5000 });
  assert.equal(await gespeichert(), null);
  const vorher = anfragen.length;
  await seite.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await warte(300);
  assert.equal(anfragen.length, vorher, 'getrennt: beim Wegschalten keine Meldung mehr');
  assert.deepEqual(fehler, [], fehler.join('\n'));
});

test('oeffentlich', async () => {
  // Im öffentlichen Repo stehen keine persönlichen Daten
  const verboten = [/Kruse/i, /Walddörfer/i, /alice-dsl/i, /krusetobias/i, /o2mail/i, /PxCY3xsfP6mMNvqdAa2MzF/];
  const pruefen = (rel) => {
    for (const n of fs.readdirSync(path.join(WURZEL, rel))) {
      if (['node_modules', '.git', 'karte', 'schrift'].includes(n)) continue;
      const r = path.join(rel, n); const voll = path.join(WURZEL, r);
      if (fs.statSync(voll).isDirectory()) { pruefen(r); continue; }
      if (!/\.(html|js|mjs|json|md|webmanifest|svg|txt)$/.test(n) || r === path.join('tests', 'lauf.mjs')) continue;
      const t = fs.readFileSync(voll, 'utf8');
      for (const v of verboten) assert.ok(!v.test(t), `${r} enthält ${v}`);
    }
  };
  pruefen('');
});

const auswahl = process.argv.slice(2);
let ok = 0, nein = 0;
for (const [name, f] of Object.entries(tests)) {
  if (auswahl.length && !auswahl.includes(name)) continue;
  try { await f(); ok++; console.log(`✓ ${name}`); } catch (e) { nein++; console.log(`✗ ${name}\n  ${e.stack?.split('\n').slice(0, 3).join('\n  ')}`); }
}
await schliessen();
console.log(`${ok} bestanden, ${nein} fehlgeschlagen`);
process.exit(nein ? 1 : 0);
