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
const zuAkte = async (seite, id) => { await seite.goto('http://app.test/Bewerbungszentrale/#liste'); await seite.waitForSelector(`[data-open="${id}"]`, { timeout: 20000 }); await seite.click(`[data-open="${id}"]`); await warte(500); };
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
  await seite.waitForSelector('[data-open="test-portal"]', { timeout: 20000 });
  const gespeichert = await seite.evaluate(() => JSON.parse(localStorage.getItem('bewerbungszentrale.zugang.v1')).token);
  assert.equal(gespeichert, gh.token);
  assert.deepEqual(fehler, []);
});

test('zugang-link', async () => {
  const { seite, gh } = await appStarten({ speicher: {} });
  await seite.goto(`http://app.test/Bewerbungszentrale/#zugang=${gh.token}`);
  await seite.reload();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('[data-open="test-portal"]', { timeout: 20000 });
  assert.equal(await seite.locator('#bz-einrichten').count(), 0);
  assert.ok(!/zugang=/.test(await seite.evaluate(() => location.href)), 'Schlüssel bleibt nicht in der Adresse');
});

test('laden', async () => {
  const { seite, fehler } = await appStarten();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('[data-open="test-mail"]', { timeout: 20000 });
  assert.equal(await seite.locator('.rang-item[data-open]').count(), 3);
  assert.deepEqual(fehler, []);
});

test('ohne-graphql', async () => {
  const { seite, gh, fehler } = await appStarten({ graphql: false });
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('[data-open="test-mail"]', { timeout: 20000 });
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
  await seite.waitForSelector('#bereitPanel', { timeout: 20000 });
  await seite.evaluate(() => window.bzPlattform.abgleichen());
  await seite.waitForFunction(() => !document.querySelector('#bereitPanel [data-open="test-mail"]'), null, { timeout: 10000 });
  assert.equal(await seite.locator('#bereitPanel [data-act="sammel-mail"]').count(), 0, 'nichts senden, wo schon eine Bewerbung läuft');
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
  await seite.waitForSelector('[data-open="test-portal"]', { timeout: 20000 });
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
  await seite.waitForSelector('[data-open="test-portal"]', { timeout: 20000 });
  await warte(500);
  await ctx.route('https://api.github.com/**', (r) => r.abort('internetdisconnected'));
  await seite.reload();
  await seite.goto('http://app.test/Bewerbungszentrale/#liste');
  await seite.waitForSelector('[data-open="test-portal"]', { timeout: 10000 });
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
  await seite.waitForSelector('#bereitPanel', { timeout: 20000 });
  const panel = await seite.textContent('#bereitPanel');
  assert.match(panel, /1 gegengelesen und freigegeben/);
  assert.match(panel, /Brauchen deinen Blick \(1\)/);
  assert.equal(await seite.locator('#bereitPanel ul.todo').first().locator('[data-open="test-mail"]').count(), 1, 'freigegebene Mail-Bewerbung steht oben');
  assert.equal(await seite.locator('#bereitPanel [data-act="sammel-mail"]').count(), 1);
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
  await seite.waitForSelector('#bereitPanel [data-act="sammel-mail"]', { timeout: 20000 });
  await seite.click('#bereitPanel [data-act="sammel-mail"]');
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
