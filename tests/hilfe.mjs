/* Startet die App im Browser mit den Attrappen (tests/attrappe.mjs). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
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
export async function browserStarten() {
  if (browser) return browser;
  try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  return browser;
}
export async function schliessen() { if (browser) await browser.close(); browser = null; }

/**
 * daten: Ordner mit dem Inhalt des Daten-Repos (Standard tests/daten).
 * speicher: localStorage vor dem Start (z. B. Zugang). ki: (prompt) => Antworttext.
 * google: Google-Anmeldung und Gmail-API nachbilden; gesendete Mails landen in gmail.
 */
export async function appStarten({ daten = path.join(WURZEL, 'tests/daten'), speicher, ki = async () => 'KI-Antwort', breite = 412, hoehe = 860, teilen = false, graphql = true, google = false, gmailFehler = 0, nurLesen = false } = {}) {
  const b = await browserStarten();
  const ctx = await b.newContext({ viewport: { width: breite, height: hoehe }, serviceWorkers: 'block', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const gh = githubAttrappe(ladeOrdner(daten), { graphql, nurLesen });
  const kia = kiAttrappe(ki);
  const fehler = [], gmail = [];
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
  seite.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) fehler.push('Konsole: ' + m.text().slice(0, 300)); });
  await seite.goto('http://app.test/Bewerbungszentrale/');
  return { seite, ctx, gh, ki: kia, fehler, gmail };
}

export const warte = (ms) => new Promise((r) => setTimeout(r, ms));
