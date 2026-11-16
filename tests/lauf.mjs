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
