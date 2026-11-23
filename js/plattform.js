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
 *   mcp        gibt es nicht. Senden per Gmail geht stattdessen über
 *              bzPlattform.drive: Google Drive nur für Dateien, die die App selbst
 *              anlegt (drive.file): Bewerbungsmappen fürs Handy.
 *              bzPlattform.gmail: Anmeldung mit Google (nur Erlaubnis zum
 *              Senden, gmail.send), dann die Gmail-API. Gesendet wird nur
 *              auf Knopfdruck der Person. Die Client-ID der eigenen
 *              Google-Cloud-App kommt per Link …/#google=<Client-ID>.
 *
 * Zugang: ein Fine-grained Token von GitHub, das nur das Daten-Repo lesen
 * und schreiben darf, nur im localStorage dieses Handys. Darf ein Token nur
 * lesen (z. B. für Familie zum Gegenlesen), läuft die App im Lesemodus:
 * alles ansehen und als PDF laden, aber nichts wird gespeichert. Kommt per Link
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
  const GOOGLE = 'bewerbungszentrale.google.v1';
  const GOOGLE_MUSTER = /^[0-9]{6,20}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com$/;
  // Client-ID aus dem, was eingefügt wurde: verträgt Leerzeichen, Zeilenumbrüche, unsichtbare Zeichen, Großbuchstaben und Text drumherum
  const googleId = (t) => (String(t || '').replace(/[\s\u00ad\u200b-\u200f\u2060\ufeff]+/g, '').toLowerCase().match(/[0-9]{6,20}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com/) || [''])[0];

  const lies = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const schreib = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const fehler = (code, text) => Object.assign(new Error(text || code), { code });

  /* ------------------------------------------------ Zugang und Schlüssel */
  function linkAusAdresse() {
    const h = location.hash || '';
    if (!/[#&](?:zugang|ki|google)=/.test(h)) return;
    const wert = (k) => { const m = new RegExp(`[#&]${k}=([^&\\s]+)`).exec(h); if (!m) return ''; try { return decodeURIComponent(m[1]).trim(); } catch { return ''; } };
    const t = wert('zugang'), k = wert('ki');
    if (TOKEN_MUSTER.test(t)) schreib(ZUGANG, { token: t, stand: new Date().toISOString() });
    if (KI_MUSTER.test(k)) schreib(KI, { schluessel: k, stand: new Date().toISOString() });
    if (googleId(wert('google'))) schreib(GOOGLE, { clientId: googleId(wert('google')), stand: new Date().toISOString() });
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
  /** Link, der Zugang, KI-Schlüssel und Google-Client-ID an einen anderen Browser auf diesem Handy übergibt.
   *  Alles steht nur im Anker (#…), der geht an keinen Server; die App liest ihn beim Start und löscht ihn aus der Adresse. */
  function uebergabeLink() {
    const t = eigenerToken() || boxToken(); if (!t) return '';
    const k = kiSchluessel(), g = (lies(GOOGLE) || {}).clientId || '';
    const teile = [`zugang=${encodeURIComponent(t)}`, k ? `ki=${encodeURIComponent(k)}` : '', GOOGLE_MUSTER.test(g) ? `google=${encodeURIComponent(g)}` : ''].filter(Boolean);
    return `${location.origin}${location.pathname}#${teile.join('&')}`;
  }
  const anbieterVon = (s) => (s.startsWith('sk-ant-') ? 'anthropic' : s ? 'gemini' : '');

  let token = '', nurLesen = false;
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
      <input id="bz-e-token" type="password" autocomplete="new-password" spellcheck="false" placeholder="github_pat_…">
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
      const roh = tIn.value.trim(), aus = (n) => { const m = new RegExp(`[#&]${n}=([^&\\s]+)`).exec(roh); try { return m ? decodeURIComponent(m[1]).trim() : ''; } catch { return ''; } };
      const t = aus('zugang') || roh, k = kIn.value.trim() || (KI_MUSTER.test(aus('ki')) ? aus('ki') : ''); // ganzer Übergabe-Link eingefügt: alles daraus übernehmen
      if (googleId(aus('google'))) schreib(GOOGLE, { clientId: googleId(aus('google')), stand: new Date().toISOString() });
      if (k && !KI_MUSTER.test(k)) { f.textContent = 'Der KI-Schlüssel sieht nicht richtig aus.'; return; }
      if (!TOKEN_MUSTER.test(t)) { f.textContent = 'Der GitHub-Schlüssel sieht nicht richtig aus.'; return; }
      f.textContent = 'Prüfe …';
      const r = await tokenPruefen(t);
      if (r !== 'ok' && r !== 'nur-lesen') { f.textContent = { ungueltig: 'GitHub kennt diesen Schlüssel nicht.', 'kein-zugriff': 'Der Schlüssel darf das Repo Bewerbungszentrale-Daten nicht lesen.', netz: 'Keine Verbindung zu GitHub.' }[r]; return; }
      schreib(ZUGANG, { token: t, stand: new Date().toISOString(), lesen: r === 'nur-lesen' });
      nurLesen = r === 'nur-lesen';
      if (k) schreib(KI, { schluessel: k, stand: new Date().toISOString() });
      if (gestartet) { location.reload(); return; } // Schlüssel geändert: neu starten, damit KI und Daten ihn nehmen
      token = t; d.remove(); fertigMelden(true);
    };
  }
  async function zugangHerstellen() {
    for (const [t, eigen] of [[eigenerToken(), true], [boxToken(), false]]) {
      if (!t) continue;
      const r = await tokenPruefen(t);
      if (r === 'ok') { token = t; if (!eigen) schreib(ZUGANG, { token: t, stand: new Date().toISOString(), ausBoxenstopp: true }); else if (lies(ZUGANG)?.lesen) schreib(ZUGANG, { ...lies(ZUGANG), lesen: false }); fertigMelden(true); return; }
      if (r === 'nur-lesen' && eigen) { token = t; nurLesen = true; schreib(ZUGANG, { ...lies(ZUGANG), lesen: true }); fertigMelden(true); return; } // Lesemodus
      if (r === 'netz' && eigen) { token = t; nurLesen = !!lies(ZUGANG)?.lesen; fertigMelden(true); return; } // offline: mit dem Zwischenspeicher arbeiten
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
      // Noch nicht bestätigte Schreibvorgänge: überleben das Schließen der App und werden beim nächsten Start nachgeholt
      offenSetzen: (pfad, v) => tx('meta', 'readwrite', (s) => s.put(v, 'offen:' + pfad)).catch(() => {}),
      offenLoeschen: (pfad) => tx('meta', 'readwrite', (s) => s.delete('offen:' + pfad)).catch(() => {}),
      offenAlle: async () => { try { const db = await oeffnen(); return await new Promise((res) => { const out = {}; const c = db.transaction('meta').objectStore('meta').openCursor(); c.onsuccess = () => { const k = c.result; if (k) { if (String(k.key).startsWith('offen:')) out[String(k.key).slice(6)] = k.value; k.continue(); } else res(out); }; c.onerror = () => res({}); }); } catch { return {}; } },
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
  let ohneGraphql = false;
  async function blobEinzeln(sha) {
    const rb = await gh(`/repos/${DATEN.owner}/${DATEN.repo}/git/blobs/${sha}`);
    if (rb.status === 401) throw fehler('revoked');
    if (!rb.ok) throw fehler('unavailable', `Blob ${rb.status}`);
    const b = await rb.json();
    return b.encoding === 'base64' ? b64ZuText(b.content) : b.content;
  }
  async function einzelnHolen(shas, out) {
    for (let i = 0; i < shas.length; i += 16) {
      const teil = shas.slice(i, i + 16);
      const texte = await Promise.all(teil.map(blobEinzeln));
      teil.forEach((s, k) => out.set(s, texte[k]));
    }
  }
  async function paketHolen(teil, out) {
    if (ohneGraphql) return einzelnHolen(teil, out);
    const q = `query{repository(owner:"${DATEN.owner}",name:"${DATEN.repo}"){${teil.map((s, j) => `f${j}:object(oid:"${s}"){...on Blob{text isTruncated isBinary}}`).join(' ')}}}`;
    const r = await gh('/graphql', { method: 'POST', body: JSON.stringify({ query: q }) });
    if (r.status === 401) throw fehler('revoked');
    const j = r.ok ? await r.json().catch(() => null) : null;
    if (!j?.data?.repository) { ohneGraphql = true; return einzelnHolen(teil, out); } // GraphQL geht nicht: über REST, je Datei
    const repo = j.data.repository;
    const gross = [];
    for (let k = 0; k < teil.length; k++) {
      const o = repo[`f${k}`];
      if (o && !o.isTruncated && !o.isBinary && typeof o.text === 'string') out.set(teil[k], o.text);
      else gross.push(teil[k]); // groß: einzeln holen
    }
    if (gross.length) await einzelnHolen(gross, out);
  }
  /* Holt die Inhalte in Paketen zu 40, bis zu 4 Pakete gleichzeitig. fertig(map) bekommt jedes Paket, sobald es da ist:
     so erscheinen die Bewerbungen beim ersten Start, bevor der Radar geladen ist. */
  async function inhalteHolen(shas, fertig) {
    const pakete = [];
    for (let i = 0; i < shas.length; i += 40) pakete.push(shas.slice(i, i + 40));
    let naechstes = 0;
    const arbeiter = async () => {
      while (naechstes < pakete.length) {
        const teil = pakete[naechstes++]; const out = new Map();
        await paketHolen(teil, out);
        fertig(out);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, pakete.length) }, arbeiter));
  }
  const VORRANG = ['profil', 'system', 'apps', 'kandidaten', 'radarwahl', 'firmenwahl']; // was die Startseite braucht, zuerst
  const rang = (p) => { const i = VORRANG.indexOf(sammlungVon(p)); return i < 0 ? VORRANG.length : i; };
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
        const neu = [...baum].filter(([p, sha]) => istDok(p) && stand.get(p)?.sha !== sha).sort((x, y) => rang(x[0]) - rang(y[0]));
        const weg = [...stand.keys()].filter((p) => !baum.has(p));
        const geaendert = new Set();
        if (neu.length) {
          const pfade = new Map(); // sha -> Pfade (gleicher Inhalt kann mehrfach vorkommen)
          for (const [p, sha] of neu) pfade.set(sha, [...(pfade.get(sha) || []), p]);
          const vorher = !netzGeladen && stand.size === 0; // allererster Start auf diesem Gerät: Teilstände gleich zeigen
          await inhalteHolen([...pfade.keys()], (texte) => {
            const jetzt = new Set();
            for (const [sha, t] of texte) {
              if (t == null) continue;
              let data; try { data = JSON.parse(t); } catch { continue; }
              for (const p of pfade.get(sha) || []) { stand.set(p, { sha, data }); idb.setzen(p, { sha, data }); geaendert.add(sammlungVon(p)); jetzt.add(sammlungVon(p)); }
            }
            if (vorher && jetzt.size) melden(jetzt);
          });
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
    try { await abgleichen(); await nachholen(); } catch (e) { console.warn('Abgleich', e?.message); if (!stand.size) for (const h of hoerer) h.f?.(e); }
    // Nach jedem Abgleich, der durchkam, auch das nachschicken, was vorher ohne Netz hängen blieb
    const abgleichUndNachschicken = () => abgleichen().then(nachschicken).catch(() => {});
    setInterval(() => { if (document.visibilityState === 'visible') abgleichUndNachschicken(); }, ABGLEICH_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') abgleichUndNachschicken(); });
    window.addEventListener('online', abgleichUndNachschicken);
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
  const warteschlange = new Map(); // pfad -> {timer, los, wartende:[{ok,nein}]}
  const basisVon = new Map();      // pfad -> {basis, sha}: der bestätigte Stand, auf dem die offene Änderung aufbaut
  function vormerken(pfad, pause = SCHREIB_PAUSE_MS) {
    let w = warteschlange.get(pfad);
    if (!w) { w = { timer: 0, wartende: [] }; warteschlange.set(pfad, w); }
    clearTimeout(w.timer);
    if (!basisVon.has(pfad)) basisVon.set(pfad, { basis: kopie(stand.get(pfad)?.data ?? null), sha: shaVon(pfad) });
    idb.offenSetzen(pfad, { daten: lokal.get(pfad) ?? null, ...basisVon.get(pfad), zeit: Date.now() });
    const p = new Promise((ok, nein) => w.wartende.push({ ok, nein }));
    w.los = () => {
      clearTimeout(w.timer);
      if (warteschlange.get(pfad) !== w) return;
      warteschlange.delete(pfad);
      const daten = lokal.has(pfad) ? lokal.get(pfad) : undefined;
      if (daten === undefined) { w.wartende.forEach((x) => x.ok()); return; }
      const nachricht = `App: ${pfad.replace(/\.json$/, '')} ${daten === null ? 'gelöscht' : 'gespeichert'}`;
      unterwegs.set(pfad, (unterwegs.get(pfad) || 0) + 1);
      const fertig = () => { const n = (unterwegs.get(pfad) || 1) - 1; if (n > 0) unterwegs.set(pfad, n); else unterwegs.delete(pfad); };
      nacheinander(async () => {
        if (daten === null) { await dateiLoeschen(pfad, nachricht); stand.delete(pfad); idb.loeschen(pfad); }
        else { const sha = await dateiSchreiben(pfad, textZuB64(JSON.stringify(daten, null, 1) + '\n'), nachricht); stand.set(pfad, { sha, data: daten }); idb.setzen(pfad, { sha, data: daten }); }
        if (lokal.get(pfad) === daten) { lokal.delete(pfad); basisVon.delete(pfad); idb.offenLoeschen(pfad); } // inzwischen nicht wieder geändert
        else basisVon.set(pfad, { basis: kopie(daten), sha: stand.get(pfad)?.sha || '' });
      }).then(() => { fertig(); w.wartende.forEach((x) => x.ok()); }, (e) => { fertig(); w.wartende.forEach((x) => x.nein(e)); });
    };
    w.timer = setTimeout(w.los, pause);
    return p;
  }
  const unterwegs = new Map(); // pfad -> Zahl der Schreibvorgänge, die gerade laufen
  /**
   * Was im Betrieb nicht ankam (kein Netz), noch einmal schicken – sobald das
   * Netz zurück ist und nach jedem Abgleich. Bisher ging das erst beim nächsten
   * Start (nachholen). Hat sich die Datei inzwischen woanders geändert (etwa
   * durch den Morgenlauf), erst zusammenführen wie beim Nachholen; eine
   * Löschung auf einen inzwischen geänderten Stand fällt weg.
   */
  function nachschicken() {
    if (nurLesen) return;
    for (const [pfad, daten] of [...lokal]) {
      if (!istDok(pfad) || warteschlange.has(pfad) || unterwegs.has(pfad)) continue;
      const b = basisVon.get(pfad), jetzt = stand.get(pfad);
      if (b && jetzt && b.sha !== jetzt.sha) {
        if (daten === null) { lokal.delete(pfad); basisVon.delete(pfad); idb.offenLoeschen(pfad); melden(new Set([sammlungVon(pfad)])); continue; }
        lokal.set(pfad, zusammenfuehren(b.basis, daten, jetzt.data));
        basisVon.set(pfad, { basis: kopie(jetzt.data), sha: jetzt.sha });
        melden(new Set([sammlungVon(pfad)]));
      }
      vormerken(pfad, 0).catch(() => {});
    }
  }
  /** Alles, was noch wartet, sofort schreiben (z. B. direkt nach dem Versand einer Bewerbung). */
  function sofortSchreiben() {
    const ps = [];
    for (const w of [...warteschlange.values()]) { ps.push(new Promise((ok) => w.wartende.push({ ok, nein: ok }))); w.los(); }
    return Promise.all(ps).then(() => kette);
  }
  const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** Drei-Wege-Abgleich auf Feldebene: was ich gegenüber basis geändert habe, kommt auf den neueren Stand fremd.
   *  Listen mit ids (Verlauf, Termine, Aufgaben) werden vereint, damit nichts von der anderen Seite verloren geht. */
  function zusammenfuehren(basis, mein, fremd) {
    if (!mein || !fremd || typeof fremd !== 'object' || !basis || typeof basis !== 'object') return mein;
    const out = kopie(fremd);
    for (const k of new Set([...Object.keys(basis), ...Object.keys(mein)])) {
      if (gleich(mein[k], basis[k])) continue;
      if (!(k in mein)) { delete out[k]; continue; }
      const a = mein[k], f = fremd[k], b = basis[k];
      const mitIds = (l) => Array.isArray(l) && l.every((x) => x && typeof x === 'object' && x.id);
      if (mitIds(a) && mitIds(f)) {
        const weg = new Set((mitIds(b) ? b : []).filter((x) => !a.some((y) => y.id === x.id)).map((x) => x.id)); // von mir entfernt
        const m = new Map(f.map((x) => [x.id, x]));
        for (const x of a) m.set(x.id, x);
        out[k] = [...m.values()].filter((x) => !weg.has(x.id));
      } else out[k] = kopie(a);
    }
    return out;
  }
  /** Beim Start: was beim letzten Mal nicht mehr geschrieben wurde (App geschlossen, kein Netz), jetzt nachholen. */
  async function nachholen() {
    if (nurLesen) return;
    const offen = await idb.offenAlle();
    let n = 0;
    for (const [pfad, o] of Object.entries(offen)) {
      if (!istDok(pfad) || lokal.has(pfad) || warteschlange.has(pfad)) continue;
      const jetzt = stand.get(pfad);
      let daten = o?.daten ?? null;
      if (daten === null) { if (!jetzt || (o.sha && jetzt.sha !== o.sha)) { idb.offenLoeschen(pfad); continue; } } // gelöscht oder inzwischen geändert: nicht blind löschen
      else if (jetzt && o.sha !== jetzt.sha) daten = zusammenfuehren(o.basis, daten, jetzt.data);
      if (daten !== null && jetzt && gleich(daten, jetzt.data)) { idb.offenLoeschen(pfad); continue; } // ist schon angekommen
      idb.offenLoeschen(pfad);
      lokal.set(pfad, daten); vormerken(pfad, 0).catch(() => {}); n++;
    }
    if (n) { melden(); console.info(`Nachgeholt: ${n} Änderung(en) vom letzten Mal`); }
  }
  function dokRef(pfad) {
    return {
      id: idVon(pfad),
      async set(data, opt) { await bereit; lokal.set(pfad, kopie(data)); melden(new Set([sammlungVon(pfad)])); return nurLesen ? undefined : vormerken(pfad, opt?.sofort ? 0 : SCHREIB_PAUSE_MS); },
      async delete() { await bereit; lokal.set(pfad, null); melden(new Set([sammlungVon(pfad)])); return nurLesen ? undefined : vormerken(pfad); },
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
      if (nurLesen) throw fehler('not_granted', 'Nur Lesezugriff');
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

  /* ------------------------------------------------ Gmail: senden über die Gmail-API, nur auf Knopfdruck */
  const gmail = (() => {
    const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
    const MERKEN = 'bewerbungszentrale.gmail.v1'; // Zugriff darf nur senden und läuft nach einer Stunde ab: so lange überlebt er Neuladen und Neustart
    let zugriff = (() => { const z = lies(MERKEN); return z && typeof z.token === 'string' && z.bis > Date.now() + 60_000 ? z : null; })(), laden = null;
    const vergessen = () => { zugriff = null; try { localStorage.removeItem(MERKEN); } catch {} };
    const clientId = () => { const g = lies(GOOGLE); return g && GOOGLE_MUSTER.test(g.clientId || '') ? g.clientId : ''; };
    const skript = () => laden ||= new Promise((res, rej) => {
      if (window.google?.accounts?.oauth2) return res();
      const el = document.createElement('script'); el.src = 'https://accounts.google.com/gsi/client'; el.async = true;
      el.onload = () => res(); el.onerror = () => { laden = null; rej(fehler('unavailable', 'Die Google-Anmeldung konnte nicht geladen werden.')); };
      document.head.appendChild(el);
    });
    const angemeldet = () => !!zugriff && zugriff.bis > Date.now() + 60_000;
    function anmelden(konto = '') { // direkt im Klick aufrufen, sonst blockiert der Browser das Anmeldefenster; konto: Gmail-Adresse als Vorauswahl
      if (angemeldet()) return Promise.resolve();
      const o = window.google?.accounts?.oauth2;
      if (!o || !clientId()) return Promise.reject(fehler('unavailable', 'Die Google-Anmeldung ist nicht bereit.'));
      return new Promise((res, rej) => {
        o.initTokenClient({
          client_id: clientId(), scope: SCOPE, prompt: '', ...(/@/.test(konto) ? { hint: konto } : {}), // prompt '': nur beim ersten Mal fragen, danach schließt sich das Fenster von selbst
          callback: (r) => {
            if (r?.access_token && (!o.hasGrantedAllScopes || o.hasGrantedAllScopes(r, SCOPE))) { zugriff = { token: r.access_token, bis: Date.now() + (Number(r.expires_in) || 3600) * 1000 }; schreib(MERKEN, zugriff); res(); }
            else rej(fehler('consent_required', 'Ohne die Erlaubnis zum Senden geht es nicht.'));
          },
          error_callback: (e) => rej(fehler(e?.type === 'popup_closed' ? 'abgebrochen' : 'consent_required', e?.message || 'Anmeldung abgebrochen')),
        }).requestAccessToken();
      });
    }
    const utf8 = (t) => new TextEncoder().encode(t);
    const b64 = (by) => { let t = ''; for (let i = 0; i < by.length; i += 0x8000) t += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000)); return btoa(t); };
    const zeilen = (t) => (t.match(/.{1,76}/g) || ['']).join('\r\n');
    const kopf = (t) => /^[\x20-\x7e]*$/.test(t) ? t : (t.match(/[\s\S]{1,12}/gu) || ['']).map((x) => `=?UTF-8?B?${b64(utf8(x))}?=`).join('\r\n ');
    async function senden({ an, betreff, text, anhang, threadId }) { // ohne anhang: einfache Textmail, threadId: als Antwort im selben Gmail-Verlauf
      an = String(an || '').trim();
      if (!/^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]+$/.test(an)) throw fehler('bad_request', 'Die Empfängeradresse sieht nicht richtig aus.');
      if (!angemeldet()) throw fehler('needs_reauth', 'Bitte neu bei Google anmelden.');
      const grenze = 'bz-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const koerper = zeilen(b64(utf8(String(text || '').replace(/\r?\n/g, '\r\n'))));
      const name = String(anhang?.name || 'Bewerbung.pdf'), ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
      const mime = !anhang ? [`To: ${an}`, `Subject: ${kopf(String(betreff || '').replace(/[\r\n]+/g, ' '))}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64', '', koerper, ''].join('\r\n') : [`To: ${an}`, `Subject: ${kopf(String(betreff || '').replace(/[\r\n]+/g, ' '))}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${grenze}"`, '',
        `--${grenze}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', zeilen(b64(utf8(String(text || '').replace(/\r?\n/g, '\r\n')))),
        `--${grenze}`, `Content-Type: ${anhang.typ || 'application/pdf'}; name="${ascii}"`, `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Content-Transfer-Encoding: base64', '', zeilen(b64(anhang.bytes)), `--${grenze}--`, ''].join('\r\n');
      // Normale Adresse mit JSON: deren Fehlerantworten kann der Browser lesen (die Upload-Adresse schickt bei Fehlern
      // keine CORS-Kopfzeilen, dann bleibt nur „Failed to fetch“). Upload nur für sehr große Mails.
      const gross = mime.length > 3_500_000;
      let r;
      try {
        r = await fetch(gross ? 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media' : 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST', headers: { Authorization: `Bearer ${zugriff.token}`, 'Content-Type': gross ? 'message/rfc822' : 'application/json' },
          body: gross ? mime : JSON.stringify({ raw: b64(utf8(mime)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), ...(threadId ? { threadId } : {}) }),
        });
      } catch (e) { throw fehler('unklar', e?.message); } // kann trotzdem angekommen sein
      if (r.ok) return r.json().catch(() => ({}));
      const j = await r.json().catch(() => null), m = j?.error?.message || `HTTP ${r.status}`;
      if (r.status === 401) { vergessen(); throw fehler('needs_reauth', m); }
      throw fehler({ 400: 'bad_request', 403: 'forbidden', 429: 'rate_limited' }[r.status] || 'unklar', m);
    }
    return {
      eingerichtet: () => !!clientId(),
      einrichten: (id) => { id = googleId(id); return !!id && schreib(GOOGLE, { clientId: id, stand: new Date().toISOString() }); },
      vorbereiten: async () => { if (!clientId()) return false; await skript(); return true; },
      angemeldet, anmelden, senden,
    };
  })();

  /* ------------------------------------------------ Google Drive: Bewerbungsmappen fürs Handy, nur Dateien, die die App selbst anlegt (drive.file) */
  const drive = (() => {
    const SCOPE = 'https://www.googleapis.com/auth/drive.file';
    const MERKEN = 'bewerbungszentrale.drive.v1', AN = 'bewerbungszentrale.drive.an'; // Zugriff läuft nach einer Stunde ab, AN merkt sich nur, dass die Person Drive verbunden hat
    let zugriff = (() => { const z = lies(MERKEN); return z && typeof z.token === 'string' && z.bis > Date.now() + 60_000 ? z : null; })();
    const vergessen = () => { zugriff = null; try { localStorage.removeItem(MERKEN); } catch {} };
    const clientId = () => { const g = lies(GOOGLE); return g && GOOGLE_MUSTER.test(g.clientId || '') ? g.clientId : ''; };
    const angemeldet = () => !!zugriff && zugriff.bis > Date.now() + 60_000;
    function anmelden(konto = '') { // im Klick aufrufen; nach dem ersten Mal schließt sich das Google-Fenster von selbst
      if (angemeldet()) return Promise.resolve();
      const o = window.google?.accounts?.oauth2;
      if (!o || !clientId()) return Promise.reject(fehler('unavailable', 'Die Google-Anmeldung ist nicht bereit.'));
      return new Promise((res, rej) => {
        o.initTokenClient({
          client_id: clientId(), scope: SCOPE, prompt: '', ...(/@/.test(konto) ? { hint: konto } : {}),
          callback: (r) => {
            if (r?.access_token && (!o.hasGrantedAllScopes || o.hasGrantedAllScopes(r, SCOPE))) { zugriff = { token: r.access_token, bis: Date.now() + (Number(r.expires_in) || 3600) * 1000 }; schreib(MERKEN, zugriff); schreib(AN, { an: true }); res(); }
            else rej(fehler('consent_required', 'Ohne die Erlaubnis für Google Drive geht es nicht.'));
          },
          error_callback: (e) => rej(fehler(e?.type === 'popup_closed' ? 'abgebrochen' : 'consent_required', e?.message || 'Anmeldung abgebrochen')),
        }).requestAccessToken();
      });
    }
    async function api(pfad, { method = 'GET', query = {}, json, body, typ, upload = false } = {}) {
      if (!angemeldet()) throw fehler('needs_reauth', 'Bitte neu bei Google anmelden.');
      const u = new URL((upload ? 'https://www.googleapis.com/upload/drive/v3/' : 'https://www.googleapis.com/drive/v3/') + pfad);
      for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
      let r;
      for (let versuch = 0; ; versuch++) { // schwaches Netz (Handy): bis zu dreimal mit Pause, auch bei 429 und 5xx
        try { r = await fetch(u, { method, headers: { Authorization: `Bearer ${zugriff.token}`, ...(json ? { 'Content-Type': 'application/json; charset=UTF-8' } : typ ? { 'Content-Type': typ } : {}) }, body: json ? JSON.stringify(json) : body }); }
        catch (e) { if (versuch < 2) { await new Promise((res) => setTimeout(res, 2000 * (versuch + 1))); continue; } throw fehler('netz', 'Keine Verbindung zu Google Drive'); }
        if ((r.status === 429 || r.status >= 500) && versuch < 2) { await new Promise((res) => setTimeout(res, 3000 * (versuch + 1))); continue; }
        break;
      }
      if (r.ok) return r.status === 204 ? {} : r.json().catch(() => ({}));
      const j = await r.json().catch(() => null), m = j?.error?.message || `HTTP ${r.status}`;
      if (r.status === 401) { vergessen(); throw fehler('needs_reauth', m); }
      throw fehler({ 400: 'bad_request', 403: 'forbidden', 404: 'not_found', 429: 'rate_limited' }[r.status] || 'unklar', m);
    }
    async function liste(q) {
      const aus = []; let seite = '';
      do {
        const j = await api('files', { query: { q, fields: 'nextPageToken,files(id,name,mimeType,appProperties)', pageSize: '1000', spaces: 'drive', ...(seite ? { pageToken: seite } : {}) } });
        aus.push(...(j.files || [])); seite = j.nextPageToken || '';
      } while (seite);
      return aus;
    }
    const ordner = (name, parent, appProperties = {}) => api('files', { method: 'POST', query: { fields: 'id,name,appProperties' }, json: { name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}), appProperties } });
    function hochladen({ name, parent, bytes, typ = 'application/octet-stream' }) {
      const g = 'bz' + Math.random().toString(36).slice(2), enc = new TextEncoder();
      const vorn = enc.encode(`--${g}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${g}\r\nContent-Type: ${typ}\r\n\r\n`);
      return api('files', { method: 'POST', upload: true, query: { uploadType: 'multipart', fields: 'id' }, typ: `multipart/related; boundary=${g}`, body: new Blob([vorn, bytes, enc.encode(`\r\n--${g}--\r\n`)]) });
    }
    const ersetzen = (id, bytes, typ = 'application/octet-stream') => api('files/' + encodeURIComponent(id), { method: 'PATCH', upload: true, query: { uploadType: 'media', fields: 'id' }, typ, body: new Blob([bytes]) });
    const aendern = (id, json) => api('files/' + encodeURIComponent(id), { method: 'PATCH', query: { fields: 'id' }, json });
    return {
      eingerichtet: () => !!clientId(), verbunden: () => !!lies(AN)?.an, vorbereiten: () => gmail.vorbereiten(),
      angemeldet, anmelden, liste, ordner, hochladen, ersetzen, aendern,
      trennen: () => { vergessen(); try { localStorage.removeItem(AN); } catch {} },
    };
  })();

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
  /** Für die Widget-App (index.html kiAnWidgetFragen): 'claude', 'anderer' oder ''; im Nur-Lesen-Link nie. */
  const kiFuerWidget = () => { const k = nurLesen ? '' : kiSchluessel(); return !k ? '' : anbieterVon(k) === 'anthropic' ? 'claude' : 'anderer'; };
  /** Öffnet bildschirmzeit://ki#<Schlüssel>: geht nur von App zu App auf dem Handy, an keinen Server. */
  function kiAnWidget() {
    if (kiFuerWidget() !== 'claude') return false;
    const ziel = `bildschirmzeit://ki#${encodeURIComponent(kiSchluessel())}`;
    if (typeof window.bzOeffnen === 'function') window.bzOeffnen(ziel); else location.href = ziel;
    return true;
  }
  /** Einen Claude-Schlüssel hier merken (Dialog für die Widget-App, wenn noch keiner da ist); nur sk-ant-…, nie im Nur-Lesen-Link. */
  const kiSetzen = (k) => { k = String(k || '').trim(); return !nurLesen && k.startsWith('sk-ant-') && KI_MUSTER.test(k) && schreib(KI, { schluessel: k, stand: new Date().toISOString() }); };
  window.bzPlattform = { kiFuerWidget, kiAnWidget, kiSetzen, uebergabeLink, abgleichen: () => abgleichen(), einrichten: () => einrichtenZeigen(''), offen: () => warteschlange.size + (nurLesen ? 0 : lokal.size), speichern: () => sofortSchreiben(), kiDa: () => !!kiSchluessel(), nurLesen: () => nurLesen, gmail, drive };

  zugangHerstellen();
  start();
})();
