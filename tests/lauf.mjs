/*
 * Alle Tests: node tests/lauf.mjs  (oder einzelne: node tests/lauf.mjs laden teilen)
 * Arbeiten nur mit den erfundenen Daten aus tests/daten/.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { appStarten, schliessen, warte, WURZEL } from './hilfe.mjs';

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
  await seite.click('[data-act="mark-beworben"]');
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
  await seite.click('[data-act="mark-beworben"]');
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
  await seite.waitForSelector('#aussortiert', { timeout: 20000 });
  await seite.click('#aussortiert summary');
  const k = seite.locator('#aussortiert [data-rid="test-firma2"]');
  assert.equal((await k.textContent()).trim(), 'Stattdessen nehmen');
  await k.click();
  for (let i = 0; i < 40 && !json(gh, 'apps/test-portal.json').verworfen; i++) await warte(250);
  const p = json(gh, 'apps/test-portal.json'), z = json(gh, 'apps/test-firma2.json');
  assert.equal(p.verworfen, true, 'die bisherige Stelle wartet jetzt');
  assert.equal(p.aussortiert.art, 'firma');
  assert.equal(z.verworfen, false);
  assert.equal(z.ausgewaehlt, true);
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
  assert.match(await h.textContent(), /steht noch 61\.000/, 'warnt, wenn der Brief eine andere Zahl nennt');
  await seite.fill('#d-gwunsch', '61000');
  for (let i = 0; i < 40 && !json(gh, 'apps/test-portal.json').gehaltPerson; i++) await warte(250);
  const d = json(gh, 'apps/test-portal.json');
  assert.equal(d.gehaltWunsch, 61000);
  assert.equal(d.gehaltPerson, true, 'eigene Forderung bleibt vor dem Morgenlauf geschützt');
  assert.match(await h.textContent(), /Deine eigene Forderung/);
  assert.doesNotMatch(await h.textContent(), /steht noch/);
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
  await seite.fill('#d-btage', '5');
  for (let i = 0; i < 40 && json(gh, 'apps/test-portal.json').buerotage !== 5; i++) await warte(250);
  assert.equal(json(gh, 'apps/test-portal.json').buerotage, 5, 'eigene Bürotage werden gespeichert');
  assert.match(await seite.textContent('#fahrtStunden'), /Deine Angabe\. Rund 6,5 Stunden pro Woche.*8 Punkte/);
  await seite.fill('#d-btage', '0');
  await seite.waitForFunction(() => /Kein Pendeln/.test(document.querySelector('#fahrtStunden')?.textContent || ''), null, { timeout: 5000 });
  await seite.fill('#d-btage', '5');
  for (let i = 0; i < 40 && json(gh, 'apps/test-portal.json').buerotage !== 5; i++) await warte(250);
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
  assert.match(await seite.textContent('#fahrtStunden'), /geschätzt, trag die Bürotage ein/);
  await seite.fill('#d-btage', '2');
  await seite.waitForFunction(() => !/geschätzt/.test(document.querySelector('#fahrtStunden')?.textContent || ''), null, { timeout: 5000 });
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
  await seite.click('details.manuell summary');
  await seite.click('details.manuell [data-act="mark-beworben"]');
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
  assert.match(await seite.textContent('#wa-anhang'), /Bewerbung_Max_Muster_Hafen_Muster_AG\.pdf/);
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
  await seite.click('[data-act="ki-tab"]').catch(() => seite.click('[data-tab="ki"]'));
  await seite.waitForSelector('[data-ki="anschreiben"]:not([disabled])', { timeout: 10000 });
  await seite.click('[data-ki="anschreiben"]');
  await seite.waitForFunction(() => /Erfundener Testbrief/.test(document.querySelector('#ki-anschreiben')?.value || ''), null, { timeout: 15000 });
  const a = ki.anfragen[0];
  assert.equal(a.body.model, 'claude-opus-5-5');
  assert.equal(a.body.stream, true);
  assert.equal(a.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.deepEqual(fehler, []);
});

test('ohne-ki', async () => {
  const { seite, gh } = await appStarten({ speicher: { 'bewerbungszentrale.zugang.v1': JSON.stringify({ token: 'github_pat_test_0000000000000000000000' }) } });
  await zuAkte(seite, 'test-leer');
  await seite.click('[data-act="ki-tab"]').catch(() => seite.click('[data-tab="ki"]'));
  await seite.waitForSelector('a[href="#einrichten"]', { timeout: 10000 });
  assert.ok(gh.token);
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
  assert.equal(await seite.getAttribute('#pruefung', 'class'), 'pruef frei', 'App erkennt dieselbe Fassung wie der Morgenlauf');
  assert.match(await seite.textContent('#pruefung'), /Note 94.*frühesten Eintritt/s);
  await seite.click('#drClose');
  await zuAkte(seite, 'test-portal');
  assert.match(await seite.getAttribute('#pruefung', 'class'), /maengel/);
  assert.match(await seite.textContent('#pruefung'), /zehn Jahre Erfahrung/);
  await seite.click('[data-act="pr-vorversion"]');
  await seite.waitForSelector('#pruefung.geaendert', { timeout: 5000 });
  assert.ok(await bis(() => /VORVERSION/.test(json(gh, 'apps/test-portal.json').anschreiben || '')), 'Vorversion gespeichert');
  assert.doesNotMatch(json(gh, 'apps/test-portal.json').vorversion.anschreiben, /VORVERSION/, 'die bisherige Fassung ist jetzt die Vorversion');
  await seite.click('#pruefung [data-act="pr-frei"]');
  await seite.waitForSelector('#pruefung.frei', { timeout: 5000 });
  assert.ok(await bis(() => json(gh, 'apps/test-portal.json').pruefung?.manuell === true));
  assert.deepEqual(fehler, []);
});

test('gegenlesen-neu', async () => {
  const { seite, gh, fehler } = await appStarten();
  await zuAkte(seite, 'test-portal');
  await seite.click('#pruefung [data-act="pr-neu"]');
  assert.ok(await bis(() => json(gh, 'apps/test-portal.json').ueberarbeiten?.manuell === true));
  assert.match(json(gh, 'apps/test-portal.json').ueberarbeiten.maengel[0], /zehn Jahre Erfahrung.*belegten zwei Jahre/);
  assert.match(await seite.textContent('#pruefung'), /nächste Morgenlauf schreibt/);
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
  await seite.click('[data-tab="ki"]');
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
  assert.equal(pdfs.length, 4, 'Anschreiben, Lebenslauf, Zeugnisse, Mappe: ' + pdfs.join(', '));
  assert.ok(['Anschreiben_', 'Lebenslauf_', 'Zeugnisse_', 'Bewerbung_'].every((v) => pdfs.some((n) => n.startsWith(v))), 'alles in jedem Ordner');
  for (const n of pdfs) assert.ok(inhalt[n].startsWith('%PDF'), n + ' ist ein PDF');
  const info = inhalt['Portal-Infos.txt'];
  assert.match(info, /Link zur Anzeige: https:\/\/example\.org\/stelle\/1\r\n/);
  assert.match(info, /Kennziffer: K-17/);
  assert.match(info, /Gehaltsvorstellung: /);
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
  assert.equal(drin.length, 5, namen.join(', '));
  assert.ok(['Anschreiben_', 'Lebenslauf_', 'Zeugnisse_', 'Bewerbung_'].every((v) => namen.some((n) => n.startsWith(v) && n.endsWith('.pdf'))));
  for (const f of drin.filter((f) => f.name.endsWith('.pdf'))) { assert.equal(f.inhalt.subarray(0, 4).toString(), '%PDF', f.name); assert.equal(f.mimeType, 'application/pdf'); }
  assert.match(drin.find((f) => f.name === 'Portal-Infos.txt').inhalt.toString('utf8'), /Gehaltsvorstellung: /);
  assert.equal(drive.log.filter((x) => x === 'abgebrochen').length, 2, 'zwei Netzaussetzer, trotzdem durchgelaufen');
  assert.equal(drive.dateien.get('alt1').trashed, true, 'erledigter Ordner in den Papierkorb');
  assert.equal(drive.dateien.get('eig1').trashed, false, 'fremder Ordner bleibt');
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
  await seite.fill('#dashQ', 'Hafen Muster');
  await seite.waitForFunction(() => !document.querySelector('#dash [data-open="test-mail"]') && document.querySelector('#dash [data-open="test-portal"]'), null, { timeout: 5000 });
  assert.equal(await seite.isVisible('#dash [data-open="test-portal"]'), true, 'Suche klappt die Bereiche mit Treffern auf');
  assert.doesNotMatch(await seite.textContent('#v-uebersicht'), /Jetzt dran|Brauchen deinen Blick/);
  gh.dateien.set('apps/test-mail.json', Buffer.from(JSON.stringify({ ...json(gh, 'apps/test-mail.json'), aufgaben: [{ id: 'rr1', text: 'Testfirma zurückrufen (Fr bis 14 Uhr)', faellig: '2026-11-20', erledigt: false }] }, null, 1) + '\n'));
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.fill('#dashQ', '');
  await seite.waitForSelector('#dash [data-bereich="antwort"] [data-open="test-mail"]', { timeout: 10000 });
  assert.match(await seite.textContent('#dash [data-bereich="antwort"]'), /Warten auf deine Antwort\s*1.*zurückrufen/s);
  assert.equal(await seite.locator('#mailFeld').count(), 0, 'keine Mail-Bewerbung bereit');
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
  const { seite, gh, ki, fehler } = await appStarten({ ki: async () => 'Hallo [Vorname], ich arbeite im Controlling und interessiere mich für Ihr Team. Hätten Sie 15 Minuten für einen kurzen Austausch? Viele Grüße, Max Muster' });
  await zuAkte(seite, 'test-portal');
  await seite.click('#netzwerk summary');
  const href = await seite.getAttribute('#li-suche', 'href');
  assert.match(href, /^https:\/\/www\.linkedin\.com\/search\/results\/people\/\?keywords=Hafen%20Muster/);
  await seite.click('[data-act="li-ki"]');
  await seite.waitForSelector('#li-text', { timeout: 15000 });
  assert.match(await seite.inputValue('#li-text'), /^Hallo \[Vorname\],/);
  assert.match(ki.anfragen.at(-1).body.messages.at(-1).content.toString(), /höchstens 300 Zeichen/i);
  await seite.click('[data-act="li-angeschrieben"]');
  assert.ok(await bis(() => (json(gh, 'apps/test-portal.json').verlauf || []).some((v) => /LinkedIn/.test(v.text))));
  assert.ok(json(gh, 'apps/test-portal.json').netzwerk?.nachricht);
  assert.deepEqual(fehler, []);
});

test('lesemodus', async () => {
  const { seite, gh, fehler } = await appStarten({ nurLesen: true });
  await seite.waitForSelector('#lesemodus', { timeout: 20000 });
  assert.equal(await seite.locator('[data-act="sammel-mail"]').count(), 0, 'kein Sammelversand im Lesemodus');
  await zuAkte(seite, 'test-portal');
  await seite.click('[data-act="mark-beworben"]');
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
