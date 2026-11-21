/* Startet die App im Browser mit den Attrappen (tests/attrappe.mjs). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { githubAttrappe, kiAttrappe, ladeOrdner } from './attrappe.mjs';

export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(WURZEL, 'node_modules');
const CDN = [
  [/maplibre-gl\/5\.21\.0\/maplibre-gl\.js$/, 'maplibre-gl/dist/maplibre-gl.js'],
  [/@protomaps\/basemaps@5\.7\.2\/dist\/basemaps\.js$/, '@protomaps/basemaps/dist/basemaps.js'],
  [/pdf-lib\/1\.17\.1\/pdf-lib\.min\.js$/, 'pdf-lib/dist/pdf-lib.min.js'],
  [/@pdf-lib\/fontkit@1\.1\.1\/dist\/fontkit\.umd\.min\.js$/, '@pdf-lib/fontkit/dist/fontkit.umd.min.js'],
];
const TYP = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain', '.css': 'text/css' };

let browser = null;
/** BZ_BROWSER=firefox: dieselben Tests in Firefox (die App läuft auch dort). */
export const FIREFOX = process.env.BZ_BROWSER === 'firefox';
export async function browserStarten() {
  if (browser) return browser;
  if (FIREFOX) { browser = await firefox.launch(); return browser; }
  try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  return browser;
}
export async function schliessen() { if (browser) await browser.close(); browser = null; }

/**
 * daten: Ordner mit dem Inhalt des Daten-Repos (Standard tests/daten).
 * speicher: localStorage vor dem Start (z. B. Zugang). ki: (prompt) => Antworttext.
 * google: Google-Anmeldung und Gmail-API nachbilden; gesendete Mails landen in gmail.
 */
export async function appStarten({ daten = path.join(WURZEL, 'tests/daten'), speicher, ki = async () => 'KI-Antwort', breite = 412, hoehe = 860, teilen = false, graphql = true, google = false, gmailFehler = 0, nurLesen = false, driveStart = [], driveAbbruch = 0, driveEcht = false } = {}) {
  const b = await browserStarten();
  const ctx = await b.newContext({ viewport: { width: breite, height: hoehe }, serviceWorkers: 'block', acceptDownloads: true, ...(FIREFOX ? {} : { permissions: ['clipboard-read', 'clipboard-write'] }) });
  const gh = githubAttrappe(ladeOrdner(daten), { graphql, nurLesen });
  const kia = kiAttrappe(ki);
  const fehler = [], gmail = [];
  const drive = driveAttrappe(driveStart, driveAbbruch);
  const vorher = speicher === undefined ? { 'bewerbungszentrale.zugang.v1': JSON.stringify({ token: gh.token }), 'bewerbungszentrale.ki.v1': JSON.stringify({ schluessel: 'sk-ant-test-00000000000000000000000000' }) } : speicher;
  await ctx.addInitScript(({ vorher, teilen, google }) => {
    if (!sessionStorage.getItem('bz-test-start')) { for (const [k, v] of Object.entries(vorher)) localStorage.setItem(k, v); sessionStorage.setItem('bz-test-start', '1'); }
    if (!navigator.clipboard) { let z = ''; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { z = String(t); }, readText: async () => z } }); } // http://app.test ist kein sicherer Kontext
    if (teilen) { navigator.canShare = () => true; navigator.share = async (d) => { window.__geteilt = { dateien: (d.files || []).map((f) => ({ name: f.name, groesse: f.size, typ: f.type })), text: d.text, title: d.title }; }; }
    if (google) {
      window.google = { accounts: { oauth2: { hasGrantedAllScopes: () => true,
        initTokenClient: (c) => ({ requestAccessToken: () => { window.__anmeldungen = (window.__anmeldungen || 0) + 1; window.__hinweis = c.hint; setTimeout(() => c.callback({ access_token: 'ya29.test-token', expires_in: 3599 }), 20); } }) } } };
    }
  }, { vorher, teilen, google });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'app.test') {
      let p = decodeURIComponent(u.pathname.replace(/^\/Bewerbungszentrale\//, '/')).replace(/^\/+/, '') || 'index.html';
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(WURZEL, p);
      if (!f.startsWith(WURZEL) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: TYP[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    if (u.hostname === 'api.github.com') return gh.handler(route);
    if (u.hostname === 'api.anthropic.com') return kia.handler(route);
    if (u.hostname === 'www.googleapis.com' && /^\/(upload\/)?drive\/v3\//.test(u.pathname)) return driveEcht ? route.continue() : drive.handler(route); // echt: Abgleich ohne offene App (werkzeug/drive-abgleich.mjs)
    if (u.hostname === 'gmail.googleapis.com') {
      const r = route.request(), roh = r.postData() || '';
      const mime = /json/.test(r.headers()['content-type'] || '') ? Buffer.from(JSON.parse(roh).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : roh;
      gmail.push({ url: u.href, methode: r.method(), kopf: r.headers(), mime, roh: /json/.test(r.headers()['content-type'] || '') ? roh : '' });
      if (gmailFehler) return route.fulfill({ status: gmailFehler, contentType: 'application/json', body: JSON.stringify({ error: { code: gmailFehler, message: 'Gmail API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED' } }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'msg-' + gmail.length, threadId: 'thread-' + gmail.length, labelIds: ['SENT'] }) });
    }
    for (const [re, datei] of CDN) if (re.test(u.href)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(NM, datei)) });
    if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill({ status: 404, body: '' });
  });
  const seite = await ctx.newPage();
  seite.on('pageerror', (e) => fehler.push('Seitenfehler: ' + e.message));
  // Netzaussetzer melden Chrome („Failed to load resource“) und Firefox („CORS request did not succeed“) verschieden
  seite.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|CORS request did not succeed/.test(m.text())) fehler.push('Konsole: ' + m.text().slice(0, 300)); });
  await seite.goto('http://app.test/Bewerbungszentrale/');
  return { seite, ctx, gh, ki: kia, fehler, gmail, drive };
}

/** Google Drive v3 im Speicher: nur das, was die App braucht (Liste mit q, Ordner, Multipart-Upload, Ersetzen, Ändern). */
function driveAttrappe(start = [], abbruch = 0) {
  const dateien = new Map(), log = [];
  let n = 0;
  for (const f of start) { const id = f.id || 'd' + ++n; dateien.set(id, { trashed: false, parents: [], appProperties: {}, inhalt: Buffer.alloc(0), ...f, id }); }
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const aus = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, appProperties: f.appProperties });
  async function handler(route) {
    if (abbruch > 0) { abbruch--; log.push('abgebrochen'); return route.abort('internetdisconnected'); } // schwaches Handy-Netz
    const r = route.request(), u = new URL(r.url()), m = r.method(), upload = u.pathname.startsWith('/upload/');
    if (!/^Bearer ya29\./.test(r.headers().authorization || '')) return json(route, 401, { error: { code: 401, message: 'Invalid Credentials' } });
    const id = (u.pathname.match(/\/files\/([^/]+)$/) || [])[1];
    log.push(`${m} ${upload ? 'upload ' : ''}${id ? 'files/' + id : 'files'}`);
    if (m === 'GET' && !id) {
      const q = u.searchParams.get('q') || '', p = (q.match(/'([^']+)' in parents/) || [])[1], w = (q.match(/key='([^']+)' and value='([^']+)'/) || []).slice(1);
      const files = [...dateien.values()].filter((f) => !f.trashed && (!p || f.parents.includes(p)) && (!w.length || f.appProperties[w[0]] === w[1])).map(aus);
      return json(route, 200, { files });
    }
    if (m === 'POST' && !upload) { const b = JSON.parse(r.postData() || '{}'), f = { id: 'd' + ++n, trashed: false, parents: [], appProperties: {}, inhalt: Buffer.alloc(0), ...b }; dateien.set(f.id, f); return json(route, 200, aus(f)); }
    if (m === 'POST' && upload) {
      const roh = r.postDataBuffer(), g = '--' + (r.headers()['content-type'].match(/boundary=(\S+)/) || [])[1];
      const teile = []; let i = roh.indexOf(g);
      while (i >= 0) { const j = roh.indexOf(g, i + g.length); if (j < 0) break; teile.push(roh.subarray(i + g.length + 2, j - 2)); i = j; }
      const kopfEnde = (b) => b.indexOf('\r\n\r\n') + 4;
      const meta = JSON.parse(teile[0].subarray(kopfEnde(teile[0])).toString('utf8')), inhalt = Buffer.from(teile[1].subarray(kopfEnde(teile[1])));
      const f = { id: 'd' + ++n, trashed: false, appProperties: {}, ...meta, mimeType: (teile[1].toString('latin1').match(/Content-Type: ([^\r]+)/) || [])[1], inhalt };
      dateien.set(f.id, f); return json(route, 200, { id: f.id });
    }
    if (m === 'PATCH' && id) {
      const f = dateien.get(id); if (!f) return json(route, 404, { error: { code: 404, message: 'File not found' } });
      if (upload) f.inhalt = r.postDataBuffer(); else { const b = JSON.parse(r.postData() || '{}'); if ('trashed' in b) f.trashed = b.trashed; if (b.appProperties) f.appProperties = { ...f.appProperties, ...b.appProperties }; if (b.name) f.name = b.name; }
      return json(route, 200, { id });
    }
    return json(route, 400, { error: { code: 400, message: 'nicht nachgebaut' } });
  }
  return { handler, dateien, log, kinder: (pid) => [...dateien.values()].filter((f) => !f.trashed && f.parents.includes(pid)) };
}

export const warte = (ms) => new Promise((r) => setTimeout(r, ms));
