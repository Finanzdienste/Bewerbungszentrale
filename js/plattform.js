/*
 * Plattform der Bewerbungszentrale als eigene App (PWA).
 *
 * Die App selbst (index.html) wurde als Claude-Artifact gebaut und spricht
 * mit window.claude.use(name). Diese Datei stellt dieselben Fähigkeiten
 * bereit, nur ohne Claude:
 *
 *   db         Dokumente als JSON-Dateien im privaten Repo
 *              Finanzdienste/Bewerbungszentrale-Daten (apps/<id>.json,
 *              profil/main.json, radar/…, system/lauf.json). Laden über den
 *              Git-Baum und GraphQL, Zwischenspeicher in IndexedDB, Schreiben
 *              über die Contents-API, ein Abgleich jede Minute.
 *   assets     Dateien (Zeugnisse, Foto) unter dateien/<id>.<endung> im
 *              selben Repo. Die App kennt sie als /_blob/<id>; fetch() auf
 *              solche Adressen wird hier umgeleitet.
 *   sample     KI über den eigenen Schlüssel (Anthropic sk-ant-… oder Google
 *              AQ./AIza…), direkt vom Handy.
 *   downloads  Datei speichern über einen Download-Link.
 *   user       Wer die App öffnet, ist der Besitzer.
 *   mcp        gibt es nicht (Gmail-Versand direkt aus der App entfällt).
 *
 * Zugang: ein Fine-grained Token von GitHub, das nur das Daten-Repo lesen
 * und schreiben darf, nur im localStorage dieses Handys. Kommt per Link
 * …/#zugang=<Token>&ki=<Schlüssel> oder über das Einrichten-Fenster.
 * Tokens und Schlüssel stehen nie im Code, im Repo oder in Logs.
 */
(() => {
  'use strict';
  const DATEN = { owner: 'Finanzdienste', repo: 'Bewerbungszentrale-Daten', zweig: 'main' };
  const API = 'https://api.github.com';
  const ZUGANG = 'bewerbungszentrale.zugang.v1';
  const KI = 'bewerbungszentrale.ki.v1';
  const BOX_ZUGANG = 'boxenstopp.zugang.v1'; // gleiche Adresse finanzdienste.github.io: der Boxenstopp-Token, falls er das Daten-Repo darf
  const BOX_KI = 'boxenstopp.ki.v1';
  const SAMMLUNGEN = ['apps', 'profil', 'radarpaket', 'radar', 'radarwahl', 'firmenwahl', 'system'];
  const ABGLEICH_MS = 60_000;
  const SCHREIB_PAUSE_MS = 2500;
  const KI_MODELL = { anthropic: 'claude-opus-5-5', gemini: 'gemini-3.8-flash' };
  const KI_MUSTER = /^(?:sk-ant-[A-Za-z0-9_-]{20,250}|AQ\.[A-Za-z0-9_.-]{20,200}|AIza[A-Za-z0-9_-]{30,80})$/;
  const TOKEN_MUSTER = /^[A-Za-z0-9_]{20,255}$/;

  const lies = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const schreib = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const fehler = (code, text) => Object.assign(new Error(text || code), { code });

  /* ------------------------------------------------ Zugang und Schlüssel */
  function linkAusAdresse() {
    const h = location.hash || '';
    if (!/[#&](?:zugang|ki)=/.test(h)) return;
    const wert = (k) => { const m = new RegExp(`[#&]${k}=([^&\\s]+)`).exec(h); if (!m) return ''; try { return decodeURIComponent(m[1]).trim(); } catch { return ''; } };
    const t = wert('zugang'), k = wert('ki');
    if (TOKEN_MUSTER.test(t)) schreib(ZUGANG, { token: t, stand: new Date().toISOString() });
    if (KI_MUSTER.test(k)) schreib(KI, { schluessel: k, stand: new Date().toISOString() });
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* egal */ }
  }
  linkAusAdresse();
  const eigenerToken = () => { const z = lies(ZUGANG); return z && TOKEN_MUSTER.test(z.token || '') ? z.token : ''; };
  const boxToken = () => { const z = lies(BOX_ZUGANG); return z && TOKEN_MUSTER.test(z.token || '') ? z.token : ''; };
  function kiSchluessel() {
    const k = lies(KI);
    if (k && KI_MUSTER.test(k.schluessel || '')) return k.schluessel;
    const b = lies(BOX_KI); // nur einen selbst eingetragenen Boxenstopp-Schlüssel, keinen geteilten
    if (b && KI_MUSTER.test(b.schluessel || '') && b.geteilt !== true) return b.schluessel;
    return '';
  }
  const anbieterVon = (s) => (s.startsWith('sk-ant-') ? 'anthropic' : s ? 'gemini' : '');

  let token = '';
  async function gh(pfad, opt = {}) {
    let res;
    try {
      res = await fetch(pfad.startsWith('http') ? pfad : API + pfad, {
        ...opt,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}`, ...(opt.headers || {}) },
        cache: 'no-store',
      });
    } catch (e) { throw fehler('unavailable', e?.message); }
    return res;
  }
  async function tokenPruefen(t) {
    const alt = token; token = t;
    try {
      const r = await gh(`/repos/${DATEN.owner}/${DATEN.repo}`);
      if (!r.ok) return r.status === 401 ? 'ungueltig' : 'kein-zugriff';
      const j = await r.json();
      return j?.permissions && j.permissions.push === false ? 'nur-lesen' : 'ok';
    } catch { return 'netz'; } finally { token = alt; }
  }

  /* ------------------------------------------------ Einrichten-Fenster */
  let fertigMelden = null, gestartet = false;
  const bereit = new Promise((res) => { fertigMelden = (x) => { gestartet = true; res(x); }; });
  function einrichtenZeigen(grund) {
    const alt = document.getElementById('bz-einrichten'); if (alt) alt.remove();
    const d = document.createElement('div');
    d.id = 'bz-einrichten';
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'bz-e-titel');
    d.innerHTML = `<style>
      #bz-einrichten{position:fixed;inset:0;z-index:9999;background:var(--bg,#f5f3ee);color:var(--ink,#1c1b19);overflow:auto;font:16px/1.5 system-ui,sans-serif}
      #bz-einrichten .k{max-width:520px;margin:0 auto;padding:28px 16px 40px}
      #bz-einrichten h1{font-size:24px;margin:0 0 6px}
      #bz-einrichten p{margin:8px 0}
      #bz-einrichten label{display:block;font-weight:600;margin:18px 0 6px}
      #bz-einrichten input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #9a968c;border-radius:10px;background:#fff;color:#1c1b19}
      #bz-einrichten button{margin-top:20px;font:inherit;font-weight:600;padding:12px 18px;border:0;border-radius:10px;background:#1d4b5c;color:#fff;width:100%}
      #bz-einrichten .hinweis{font-size:14px;color:#5d5a52}
      #bz-einrichten .fehler{color:#a3262a;font-weight:600}
      #bz-einrichten ol{padding-left:20px;font-size:14px;color:#5d5a52}
      @media (prefers-color-scheme: dark){#bz-einrichten{background:#151514;color:#ecebe6}#bz-einrichten input{background:#22211f;color:#ecebe6;border-color:#55524b}#bz-einrichten .hinweis,#bz-einrichten ol{color:#b3afa5}#bz-einrichten button{background:#3f8aa3}}
    </style><div class="k">
      <h1 id="bz-e-titel">Bewerbungszentrale einrichten</h1>
      <p>Deine Bewerbungen liegen im privaten Repo <b>${DATEN.owner}/${DATEN.repo}</b>. Die App braucht einmal einen Schlüssel dafür. Er bleibt nur auf diesem Handy.</p>
      <p class="fehler" id="bz-e-fehler">${grund || ''}</p>
      <label for="bz-e-token">GitHub-Schlüssel (Fine-grained Token)</label>
      <input id="bz-e-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
      <ol>
        <li>github.com → Settings → Developer settings → Fine-grained tokens. Entweder deinen Boxenstopp-Schlüssel bearbeiten und unter „Repository access“ <b>Bewerbungszentrale-Daten</b> dazunehmen, oder einen neuen anlegen.</li>
        <li>Resource owner: Finanzdienste, nur das Repo Bewerbungszentrale-Daten, Permissions → Contents: <b>Read and write</b>.</li>
        <li>Den Schlüssel hier einfügen.</li>
      </ol>
      <label for="bz-e-ki">KI-Schlüssel (freiwillig)</label>
      <input id="bz-e-ki" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-… oder AQ.…">
      <p class="hinweis">Für die KI-Knöpfe in der App (Anschreiben neu, Lebenslauf anpassen, Übungsgespräch). Ein selbst eingetragener Schlüssel aus Boxenstopp wird automatisch genommen.</p>
      <button type="button" id="bz-e-los">Verbinden</button>
    </div>`;
    document.body.appendChild(d);
    const tIn = d.querySelector('#bz-e-token'), kIn = d.querySelector('#bz-e-ki'), f = d.querySelector('#bz-e-fehler');
    if (kiSchluessel()) kIn.placeholder = 'schon vorhanden';
    setTimeout(() => tIn.focus(), 30);
    d.querySelector('#bz-e-los').onclick = async () => {
      const t = tIn.value.trim().replace(/^.*[#&]zugang=([^&\s]+).*$/, '$1'), k = kIn.value.trim();
      if (k && !KI_MUSTER.test(k)) { f.textContent = 'Der KI-Schlüssel sieht nicht richtig aus.'; return; }
      if (!TOKEN_MUSTER.test(t)) { f.textContent = 'Der GitHub-Schlüssel sieht nicht richtig aus.'; return; }
      f.textContent = 'Prüfe …';
      const r = await tokenPruefen(t);
      if (r !== 'ok') { f.textContent = { ungueltig: 'GitHub kennt diesen Schlüssel nicht.', 'kein-zugriff': 'Der Schlüssel darf das Repo Bewerbungszentrale-Daten nicht lesen.', 'nur-lesen': 'Der Schlüssel darf nur lesen. Unter Permissions → Contents „Read and write“ wählen.', netz: 'Keine Verbindung zu GitHub.' }[r]; return; }
      schreib(ZUGANG, { token: t, stand: new Date().toISOString() });
      if (k) schreib(KI, { schluessel: k, stand: new Date().toISOString() });
      if (gestartet) { location.reload(); return; } // Schlüssel geändert: neu starten, damit KI und Daten ihn nehmen
      token = t; d.remove(); fertigMelden(true);
    };
  }
  async function zugangHerstellen() {
    for (const [t, eigen] of [[eigenerToken(), true], [boxToken(), false]]) {
      if (!t) continue;
      const r = await tokenPruefen(t);
      if (r === 'ok') { token = t; if (!eigen) schreib(ZUGANG, { token: t, stand: new Date().toISOString(), ausBoxenstopp: true }); fertigMelden(true); return; }
      if (r === 'netz' && eigen) { token = t; fertigMelden(true); return; } // offline: mit dem Zwischenspeicher arbeiten
    }
    const start = () => einrichtenZeigen(eigenerToken() ? 'Der gespeicherte Schlüssel funktioniert nicht mehr.' : '');
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }
  window.addEventListener('hashchange', () => { if (location.hash === '#einrichten') { history.replaceState(null, '', location.pathname); einrichtenZeigen(''); } });

  /* ------------------------------------------------ Zwischenspeicher (IndexedDB) */
  const idb = (() => {
    let p = null;
    const oeffnen = () => p ||= new Promise((res, rej) => {
      const r = indexedDB.open('bewerbungszentrale', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('dok'); r.result.createObjectStore('meta'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const tx = async (store, modus, f) => { const db = await oeffnen(); return new Promise((res, rej) => { const t = db.transaction(store, modus); const s = t.objectStore(store); const out = f(s); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };
    return {
      alle: async () => { try { const db = await oeffnen(); return await new Promise((res) => { const out = {}; const c = db.transaction('dok').objectStore('dok').openCursor(); c.onsuccess = () => { const k = c.result; if (k) { out[k.key] = k.value; k.continue(); } else res(out); }; c.onerror = () => res({}); }); } catch { return {}; } },
      setzen: (k, v) => tx('dok', 'readwrite', (s) => s.put(v, k)).catch(() => {}),
      loeschen: (k) => tx('dok', 'readwrite', (s) => s.delete(k)).catch(() => {}),
      meta: (k) => tx('meta', 'readonly', (s) => s.get(k)).catch(() => null),
      metaSetzen: (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k)).catch(() => {}),
    };
  })();

  /* ------------------------------------------------ Daten: Stand und Benachrichtigung */
  const stand = new Map();   // pfad -> {sha, data}
  const lokal = new Map();   // pfad -> data | null (gelöscht), noch nicht bestätigt
  const baum = new Map();    // pfad -> sha (alle Dateien, auch dateien/)
  const hoerer = new Set();  // {art:'sammlung'|'dok', name, n}
  let netzGeladen = false;
  const pfadVon = (sammlung, id) => `${sammlung}/${id}.json`;
  const sammlungVon = (pfad) => pfad.split('/')[0];
  const idVon = (pfad) => pfad.slice(pfad.indexOf('/') + 1).replace(/\.json$/, '');
  const istDok = (pfad) => /^[a-z]+\/[^/]+\.json$/.test(pfad) && SAMMLUNGEN.includes(sammlungVon(pfad));
  const wert = (pfad) => (lokal.has(pfad) ? lokal.get(pfad) : stand.get(pfad)?.data);
  const kopie = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  function sammlungSnap(name) {
    const pfade = new Set([...stand.keys(), ...lokal.keys()].filter((p) => sammlungVon(p) === name));
    const docs = [];
    for (const p of [...pfade].sort()) {
      const d = wert(p); if (d == null) continue;
      docs.push({ id: idVon(p), exists: true, data: () => kopie(d), metadata: { fromCache: !netzGeladen, hasPendingWrites: lokal.has(p) } });
    }
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: !netzGeladen, hasPendingWrites: docs.some((x) => x.metadata.hasPendingWrites) }, docChanges: () => [], forEach: (f) => docs.forEach(f) };
  }
  function dokSnap(pfad) {
    const d = wert(pfad);
    return { id: idVon(pfad), exists: d != null, data: () => (d == null ? undefined : kopie(d)), metadata: { fromCache: !netzGeladen, hasPendingWrites: lokal.has(pfad) } };
  }
  let meldenGeplant = false;
  function melden(nurSammlungen = null) {
    if (meldenGeplant) return; meldenGeplant = true;
    queueMicrotask(() => {
      meldenGeplant = false;
      for (const h of hoerer) {
        if (nurSammlungen && !nurSammlungen.has(h.art === 'dok' ? sammlungVon(h.name) : h.name)) continue;
        try { h.n(h.art === 'dok' ? dokSnap(h.name) : sammlungSnap(h.name)); } catch (e) { console.error(e); }
      }
    });
  }

  /* ------------------------------------------------ Laden */
  const b64ZuText = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  async function inhalteHolen(shas) {
    const out = new Map();
    for (let i = 0; i < shas.length; i += 40) {
      const teil = shas.slice(i, i + 40);
      const q = `query{repository(owner:"${DATEN.owner}",name:"${DATEN.repo}"){${teil.map((s, j) => `f${j}:object(oid:"${s}"){...on Blob{text isTruncated isBinary}}`).join(' ')}}}`;
      const r = await gh('/graphql', { method: 'POST', body: JSON.stringify({ query: q }) });
      if (!r.ok) throw fehler(r.status === 401 ? 'revoked' : 'unavailable', `GraphQL ${r.status}`);
      const j = await r.json();
      const repo = j?.data?.repository || {};
      for (let k = 0; k < teil.length; k++) {
        const o = repo[`f${k}`];
        if (o && !o.isTruncated && !o.isBinary && typeof o.text === 'string') { out.set(teil[k], o.text); continue; }
        const rb = await gh(`/repos/${DATEN.owner}/${DATEN.repo}/git/blobs/${teil[k]}`); // groß: einzeln holen
        if (rb.ok) { const b = await rb.json(); out.set(teil[k], b.encoding === 'base64' ? b64ZuText(b.content) : b.content); }
      }
    }
    return out;
  }
  let etag = '';
  let abgleichLaeuft = null;
  function abgleichen() {
    return abgleichLaeuft ||= (async () => {
      try {
        const r = await gh(`/repos/${DATEN.owner}/${DATEN.repo}/git/trees/${DATEN.zweig}?recursive=1`, etag ? { headers: { 'If-None-Match': etag } } : {});
        if (r.status === 304) { if (!netzGeladen) { netzGeladen = true; melden(); } return; }
        if (r.status === 401) throw fehler('revoked');
        if (r.status === 404 || r.status === 409) { baum.clear(); netzGeladen = true; melden(); return; } // leeres Repo
        if (!r.ok) throw fehler('unavailable', `Baum ${r.status}`);
        const j = await r.json();
        etag = r.headers.get('ETag') || '';
        baum.clear();
        for (const e of j.tree || []) if (e.type === 'blob') baum.set(e.path, e.sha);
        const neu = [...baum].filter(([p, sha]) => istDok(p) && stand.get(p)?.sha !== sha);
        const weg = [...stand.keys()].filter((p) => !baum.has(p));
        const geaendert = new Set();
        if (neu.length) {
          const texte = await inhalteHolen([...new Set(neu.map(([, s]) => s))]);
          for (const [p, sha] of neu) {
            const t = texte.get(sha); if (t == null) continue;
            let data; try { data = JSON.parse(t); } catch { continue; }
            stand.set(p, { sha, data }); idb.setzen(p, { sha, data }); geaendert.add(sammlungVon(p));
          }
        }
        for (const p of weg) { stand.delete(p); idb.loeschen(p); geaendert.add(sammlungVon(p)); }
        const erstes = !netzGeladen; netzGeladen = true;
        if (erstes) melden(); else if (geaendert.size) melden(geaendert);
      } finally { abgleichLaeuft = null; }
    })();
  }
  async function start() {
    const cache = await idb.alle();
    for (const [p, v] of Object.entries(cache)) if (v && v.sha && istDok(p)) stand.set(p, v);
    if (stand.size) melden();
    await bereit;
    try { await abgleichen(); } catch (e) { console.warn('Abgleich', e?.message); if (!stand.size) for (const h of hoerer) h.f?.(e); }
    setInterval(() => { if (document.visibilityState === 'visible') abgleichen().catch(() => {}); }, ABGLEICH_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') abgleichen().catch(() => {}); });
  }

  /* ------------------------------------------------ Schreiben */
  const textZuB64 = (t) => { const b = new TextEncoder().encode(t); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const bytesZuB64 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  let kette = Promise.resolve(); // alle Commits nacheinander, sonst lehnt GitHub parallele ab
  const nacheinander = (f) => { const p = kette.then(f, f); kette = p.catch(() => {}); return p; };
  const shaVon = (pfad) => stand.get(pfad)?.sha || baum.get(pfad) || '';
  async function aktuelleSha(pfad) {
    const r = await gh(`/repos/${DATEN.owner}/${DATEN.repo}/contents/${encodeURI(pfad)}?ref=${DATEN.zweig}`);
    if (r.status === 404) return '';
    if (!r.ok) throw fehler('unavailable', `sha ${r.status}`);
    return (await r.json()).sha || '';
  }
  async function dateiSchreiben(pfad, b64, nachricht) {
    for (let versuch = 0; versuch < 3; versuch++) {
      const sha = shaVon(pfad);
      const r = await gh(`/repos/${DATEN.owner}/${DATEN.repo}/contents/${encodeURI(pfad)}`, { method: 'PUT', body: JSON.stringify({ message: nachricht, content: b64, branch: DATEN.zweig, ...(sha ? { sha } : {}) }) });
      if (r.ok) { const j = await r.json(); baum.set(pfad, j.content?.sha || ''); return j.content?.sha || ''; }
      if (r.status === 401) throw fehler('revoked');
      if (r.status === 403 || r.status === 404) throw fehler('invalid_argument', `schreiben ${r.status}`);
      if (r.status === 409 || r.status === 422) { const s = await aktuelleSha(pfad); if (s) baum.set(pfad, s); else baum.delete(pfad); if (stand.has(pfad)) stand.get(pfad).sha = s; continue; } // jemand war schneller: der neueste Stand gewinnt
      if (r.status >= 500 || r.status === 429) { await new Promise((ok) => setTimeout(ok, 1000 * (versuch + 1))); continue; }
      throw fehler('unavailable', `schreiben ${r.status}`);
    }
    throw fehler('unavailable', 'schreiben: zu viele Versuche');
  }
  async function dateiLoeschen(pfad, nachricht) {
    for (let versuch = 0; versuch < 3; versuch++) {
      const sha = shaVon(pfad) || await aktuelleSha(pfad);
      if (!sha) return;
      const r = await gh(`/repos/${DATEN.owner}/${DATEN.repo}/contents/${encodeURI(pfad)}`, { method: 'DELETE', body: JSON.stringify({ message: nachricht, sha, branch: DATEN.zweig }) });
      if (r.ok || r.status === 404) { baum.delete(pfad); return; }
      if (r.status === 409 || r.status === 422) { const s = await aktuelleSha(pfad); if (!s) { baum.delete(pfad); return; } baum.set(pfad, s); if (stand.has(pfad)) stand.get(pfad).sha = s; continue; }
      if (r.status === 401) throw fehler('revoked');
      throw fehler('unavailable', `löschen ${r.status}`);
    }
  }
  const warteschlange = new Map(); // pfad -> {timer, wartende:[{ok,nein}]}
  function vormerken(pfad) {
    let w = warteschlange.get(pfad);
    if (!w) { w = { timer: 0, wartende: [] }; warteschlange.set(pfad, w); }
    clearTimeout(w.timer);
    const p = new Promise((ok, nein) => w.wartende.push({ ok, nein }));
    w.timer = setTimeout(() => {
      warteschlange.delete(pfad);
      const daten = lokal.has(pfad) ? lokal.get(pfad) : undefined;
      if (daten === undefined) { w.wartende.forEach((x) => x.ok()); return; }
      const nachricht = `App: ${pfad.replace(/\.json$/, '')} ${daten === null ? 'gelöscht' : 'gespeichert'}`;
      nacheinander(async () => {
        if (daten === null) { await dateiLoeschen(pfad, nachricht); stand.delete(pfad); idb.loeschen(pfad); }
        else { const sha = await dateiSchreiben(pfad, textZuB64(JSON.stringify(daten, null, 1) + '\n'), nachricht); stand.set(pfad, { sha, data: daten }); idb.setzen(pfad, { sha, data: daten }); }
        if (lokal.get(pfad) === daten) lokal.delete(pfad); // inzwischen nicht wieder geändert
      }).then(() => w.wartende.forEach((x) => x.ok()), (e) => w.wartende.forEach((x) => x.nein(e)));
    }, SCHREIB_PAUSE_MS);
    return p;
  }
  function dokRef(pfad) {
    return {
      id: idVon(pfad),
      async set(data) { await bereit; lokal.set(pfad, kopie(data)); melden(new Set([sammlungVon(pfad)])); return vormerken(pfad); },
      async delete() { await bereit; lokal.set(pfad, null); melden(new Set([sammlungVon(pfad)])); return vormerken(pfad); },
      async get() { await bereit; return dokSnap(pfad); },
      onSnapshot(n, f) { const h = { art: 'dok', name: pfad, n, f }; hoerer.add(h); if (stand.size || netzGeladen) queueMicrotask(() => n(dokSnap(pfad))); return () => hoerer.delete(h); },
    };
  }
  const db = {
    collection(name) {
      return {
        doc: (id) => dokRef(pfadVon(name, id)),
        onSnapshot(n, f) { const h = { art: 'sammlung', name, n, f }; hoerer.add(h); if (stand.size || netzGeladen) queueMicrotask(() => n(sammlungSnap(name))); return () => hoerer.delete(h); },
        async get() { await bereit; return sammlungSnap(name); },
      };
    },
    doc(pfad) { const [s, id] = pfad.split('/'); return dokRef(pfadVon(s, id)); },
  };
  // Nicht gespeicherte Änderungen beim Schließen noch losschicken
  window.addEventListener('pagehide', () => { for (const [pfad, w] of [...warteschlange]) { clearTimeout(w.timer); vormerkenSofort(pfad, w); } });
  function vormerkenSofort(pfad, w) {
    warteschlange.delete(pfad);
    const daten = lokal.get(pfad); if (daten === undefined) return;
    const sha = shaVon(pfad);
    const body = daten === null ? { message: `App: ${pfad} gelöscht`, sha, branch: DATEN.zweig } : { message: `App: ${pfad.replace(/\.json$/, '')} gespeichert`, content: textZuB64(JSON.stringify(daten, null, 1) + '\n'), branch: DATEN.zweig, ...(sha ? { sha } : {}) };
    try { fetch(`${API}/repos/${DATEN.owner}/${DATEN.repo}/contents/${encodeURI(pfad)}`, { method: daten === null ? 'DELETE' : 'PUT', keepalive: body.content?.length < 60000, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); } catch { /* beim nächsten Mal */ }
    w.wartende.forEach((x) => x.ok());
  }

  /* ------------------------------------------------ Dateien (/_blob/<id>) */
  const endung = (name) => (/\.([A-Za-z0-9]{1,5})$/.exec(name || '') || [, 'bin'])[1].toLowerCase();
  const blobPfad = (id) => [...baum.keys()].find((p) => p.startsWith(`dateien/${id}.`)) || '';
  const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain' };
  async function blobHolen(id) {
    await bereit;
    if (!baum.size) await abgleichen().catch(() => {});
    const pfad = blobPfad(id); if (!pfad) return new Response('', { status: 404 });
    const sha = baum.get(pfad);
    let cache = null; try { cache = await caches.open('bz-dateien-v1'); } catch { /* kein Cache */ }
    const schluessel = new Request(`https://bz.invalid/${sha}`);
    const alt = cache && await cache.match(schluessel);
    if (alt) return alt;
    const r = await gh(`/repos/${DATEN.owner}/${DATEN.repo}/contents/${encodeURI(pfad)}?ref=${DATEN.zweig}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!r.ok) return new Response('', { status: r.status });
    const bytes = await r.arrayBuffer();
    const res = new Response(bytes, { status: 200, headers: { 'Content-Type': MIME[endung(pfad)] || 'application/octet-stream' } });
    if (cache) cache.put(schluessel, res.clone()).catch(() => {});
    return res;
  }
  const echtesFetch = window.fetch.bind(window);
  window.fetch = (eingabe, opt) => {
    const u = typeof eingabe === 'string' ? eingabe : eingabe?.url || '';
    const m = /\/_blob\/([A-Za-z0-9_-]{6,80})(?:[?#].*)?$/.exec(u);
    if (m && (u.startsWith('/') || u.startsWith(location.origin))) return blobHolen(m[1]);
    return echtesFetch(eingabe, opt);
  };
  const assets = {
    async upload(datei) {
      await bereit;
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      const pfad = `dateien/${id}.${endung(datei.name)}`;
      const bytes = new Uint8Array(await datei.arrayBuffer());
      await nacheinander(() => dateiSchreiben(pfad, bytesZuB64(bytes), `App: Datei ${datei.name} dazu`));
      return { id, url: `/_blob/${id}`, sizeBytes: bytes.length, name: datei.name };
    },
    async delete(id) { await bereit; const p = blobPfad(id); if (p) await nacheinander(() => dateiLoeschen(p, 'App: Datei entfernt')); },
  };

  /* ------------------------------------------------ Downloads */
  const downloads = {
    async save({ filename, data, mimeType }) {
      const bytes = data instanceof Uint8Array ? data : typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      const typ = mimeType || (/\.pdf$/i.test(filename) ? 'application/pdf' : /\.csv$/i.test(filename) ? 'text/csv' : /\.txt$/i.test(filename) ? 'text/plain' : 'application/octet-stream');
      const url = URL.createObjectURL(new Blob([bytes], { type: typ }));
      const a = document.createElement('a'); a.href = url; a.download = filename || 'datei'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };

  /* ------------------------------------------------ KI */
  const NUR_JSON = 'Antworte ausschließlich mit gültigem JSON, ohne Markdown-Codeblock und ohne Text davor oder danach.';
  function jsonAus(text) {
    let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch { /* weiter suchen */ }
    const a = Math.min(...['{', '['].map((z) => t.indexOf(z)).filter((i) => i >= 0));
    const e = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (Number.isFinite(a) && e > a) { try { return JSON.parse(t.slice(a, e + 1)); } catch { /* unten */ } }
    throw fehler('bad_response', 'Die KI hat kein gültiges JSON geliefert.');
  }
  async function kiStrom(prompt, { signal, onText, alsJson = false } = {}) {
    const schluessel = kiSchluessel();
    if (!schluessel) throw fehler('not_granted', 'Kein KI-Schlüssel eingerichtet.');
    const anbieter = anbieterVon(schluessel);
    const gemini = anbieter === 'gemini';
    const inhalt = alsJson ? `${prompt}\n\n${NUR_JSON}` : prompt;
    const url = gemini ? 'https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse' : 'https://api.anthropic.com/v1/messages';
    const koepfe = gemini
      ? { 'content-type': 'application/json', 'x-goog-api-key': schluessel }
      : { 'content-type': 'application/json', 'x-api-key': schluessel, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    const rumpf = gemini
      ? { model: KI_MODELL.gemini, input: [{ type: 'text', text: inhalt }], ...(alsJson ? { response_format: { type: 'text', mime_type: 'application/json' } } : {}), generation_config: { max_output_tokens: 16000 }, store: false, stream: true }
      : { model: KI_MODELL.anthropic, max_tokens: 32000, output_config: { effort: 'medium' }, fallbacks: 'default', stream: true, messages: [{ role: 'user', content: inhalt }] };
    let res;
    try { res = await echtesFetch(url, { method: 'POST', headers: koepfe, body: JSON.stringify(rumpf), signal }); }
    catch (e) { throw fehler(e?.name === 'AbortError' ? 'aborted' : 'unavailable', e?.message); }
    if (!res.ok) {
      let info = null; try { info = await res.json(); } catch { /* kein JSON */ }
      if (Array.isArray(info)) info = info[0];
      const code = res.status === 401 || res.status === 403 ? 'not_granted' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'unavailable' : 'bad_request';
      throw fehler(code, info?.error?.message || `HTTP ${res.status}`);
    }
    const leser = res.body.getReader(); const dek = new TextDecoder();
    let puffer = '', text = '', stopp = '';
    const block = (b) => {
      const daten = b.split('\n').filter((z) => z.startsWith('data:')).map((z) => z.slice(5).trimStart()).join('\n');
      if (!daten) return;
      let ev; try { ev = JSON.parse(daten); } catch { return; }
      if (gemini) {
        if (ev.event_type === 'error' || ev.error) throw fehler('unavailable', ev.error?.message);
        if (ev.event_type === 'step.delta' && ev.delta?.type === 'text' && typeof ev.delta.text === 'string') { text += ev.delta.text; onText?.({ text }); return; }
        const ia = ev.interaction || ev;
        if (!text && Array.isArray(ia.steps)) for (const st of ia.steps) if (st.type === 'model_output') for (const c of st.content || []) if (c.type === 'text') text += c.text || '';
        if (ia.status === 'incomplete') stopp = 'max_tokens';
        return;
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { text += ev.delta.text || ''; onText?.({ text }); }
      else if (ev.type === 'message_delta') stopp = ev.delta?.stop_reason || stopp;
      else if (ev.type === 'error') throw fehler(/overloaded/i.test(ev.error?.type || '') ? 'unavailable' : 'bad_response', ev.error?.message);
    };
    for (;;) {
      let s; try { s = await leser.read(); } catch (e) { throw fehler(e?.name === 'AbortError' ? 'aborted' : 'unavailable', e?.message); }
      if (s.done) break;
      puffer += dek.decode(s.value, { stream: true }).replace(/\r\n/g, '\n');
      for (let i = puffer.indexOf('\n\n'); i >= 0; i = puffer.indexOf('\n\n')) { block(puffer.slice(0, i)); puffer = puffer.slice(i + 2); }
    }
    if (puffer.trim()) block(puffer);
    if (stopp === 'refusal') throw fehler('refused', 'Die KI hat diese Anfrage abgelehnt.');
    if (!text && stopp === 'max_tokens') throw fehler('bad_response', 'Die Antwort wurde zu lang.');
    return text;
  }
  function kiBauen() {
    const ki = async (prompt, opt = {}) => ({ text: await kiStrom(prompt, opt) });
    ki.json = async (prompt, opt = {}) => jsonAus(await kiStrom(prompt, { ...opt, alsJson: true, onText: undefined }));
    return ki;
  }

  /* ------------------------------------------------ window.claude */
  const faehig = {
    db: async () => { await bereit; return db; },
    sample: async () => (kiSchluessel() ? kiBauen() : null),
    downloads: async () => downloads,
    assets: async () => { await bereit; return assets; },
    user: async () => ({ isOwner: async () => true }),
    mcp: async () => { throw fehler('not_granted', 'In der App gibt es keinen direkten Gmail-Versand.'); },
  };
  window.claude = { use: (name) => (faehig[name] ? faehig[name]() : Promise.reject(fehler('not_granted', name))) };
  window.bzPlattform = { abgleichen: () => abgleichen(), einrichten: () => einrichtenZeigen(''), offen: () => lokal.size + warteschlange.size, kiDa: () => !!kiSchluessel() };

  zugangHerstellen();
  start();
})();
