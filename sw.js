/*
 * Service Worker der Bewerbungszentrale: App-Hülle offline, Karte und
 * Schriften aus dem Zwischenspeicher. Nie gespeichert: GitHub-API (Daten),
 * KI-Anfragen, Supabase (Bildschirmzeit). Bei jeder Änderung an index.html
 * oder js/ VERSION hochzählen.
 */
const VERSION = 'v58';
const HUELLE = `bz-huelle-${VERSION}`;
const DAUER = 'bz-dauer-v1'; // Karte, Schriften, Bibliotheken von CDNs (versioniert, ändern sich nicht)
const SHELL = ['./', 'index.html', 'js/plattform.js', 'js/bildschirmzeit.js', 'js/bildschirmzeit-start.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'datenschutz.html'];
const CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(HUELLE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('bz-huelle-') && k !== HUELLE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const eigen = u.origin === self.location.origin;
  if (eigen && (r.mode === 'navigate' || SHELL.some((s) => u.pathname.endsWith('/' + s.replace('./', ''))))) {
    // Erst das Netz (damit Änderungen sofort da sind), ohne Netz die Hülle
    e.respondWith(fetch(r).then((res) => { if (res.ok) { const k = res.clone(); caches.open(HUELLE).then((c) => c.put(r, k)); } return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then((x) => x || caches.match('index.html'))));
    return;
  }
  if ((eigen && /\/(karte|schrift)\//.test(u.pathname)) || CDN.includes(u.hostname)) {
    e.respondWith(caches.open(DAUER).then((c) => c.match(r).then((x) => x || fetch(r).then((res) => { if (res.ok || res.type === 'opaque') c.put(r, res.clone()); return res; }))));
  }
});
