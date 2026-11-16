/*
 * Attrappen für die Tests: GitHub (Daten-Repo) und die KI, als
 * Playwright-Routen. Das Daten-Repo liegt im Speicher (pfad -> Buffer) und
 * startet mit dem Inhalt eines Ordners. Nie echte Daten in diesem Repo:
 * die Tests nehmen tests/daten/ (erfunden).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const blobSha = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

export function ladeOrdner(ordner) {
  const dateien = new Map();
  const gehe = (rel) => {
    for (const n of fs.readdirSync(path.join(ordner, rel))) {
      if (n.startsWith('.')) continue;
      const r = rel ? `${rel}/${n}` : n;
      const voll = path.join(ordner, r);
      if (fs.statSync(voll).isDirectory()) gehe(r); else dateien.set(r, fs.readFileSync(voll));
    }
  };
  gehe('');
  return dateien;
}

export function githubAttrappe(dateien, { owner = 'Finanzdienste', repo = 'Bewerbungszentrale-Daten', token = 'github_pat_test_0000000000000000000000', graphql = true, nurLesen = false } = {}) {
  const log = [];
  const shas = () => new Map([...dateien].map(([p, b]) => [p, blobSha(b)]));
  const nachSha = (sha) => { for (const [p, b] of dateien) if (blobSha(b) === sha) return b; return null; };
  const basis = `/repos/${owner}/${repo}`;
  const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) });
  async function handler(route) {
    const req = route.request();
    const u = new URL(req.url());
    const methode = req.method();
    if (methode === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,POST,DELETE' } });
    if ((req.headers().authorization || '') !== `Bearer ${token}`) return json(route, 401, { message: 'Bad credentials' });
    log.push(`${methode} ${u.pathname}`);
    if (u.pathname === basis && methode === 'GET') return json(route, 200, { full_name: `${owner}/${repo}`, private: true, permissions: { pull: true, push: !nurLesen } });
    if (u.pathname === `${basis}/git/trees/main`) {
      const s = shas();
      const etag = `"${crypto.createHash('sha1').update([...s].sort().join()).digest('hex')}"`;
      if (req.headers()['if-none-match'] === etag) return route.fulfill({ status: 304, headers: { 'access-control-allow-origin': '*', etag } });
      return json(route, 200, { sha: 'baum', tree: [...s].map(([p, sha]) => ({ path: p, type: 'blob', sha })), truncated: false }, { etag, 'access-control-expose-headers': 'ETag' });
    }
    if (u.pathname === '/graphql' && methode === 'POST') {
      if (!graphql) return json(route, 403, { message: 'Resource not accessible by personal access token' });
      const q = JSON.parse(req.postData()).query;
      const repoDaten = {};
      for (const m of q.matchAll(/(f\d+):object\(oid:"([0-9a-f]{40})"\)/g)) {
        const b = nachSha(m[2]);
        repoDaten[m[1]] = b ? (b.length > 100_000 ? { text: null, isTruncated: true, isBinary: false } : { text: b.toString('utf8'), isTruncated: false, isBinary: false }) : null;
      }
      return json(route, 200, { data: { repository: repoDaten } });
    }
    const blob = new RegExp(`^${basis}/git/blobs/([0-9a-f]{40})$`).exec(u.pathname);
    if (blob) { const b = nachSha(blob[1]); return b ? json(route, 200, { sha: blob[1], encoding: 'base64', content: b.toString('base64') }) : json(route, 404, {}); }
    const inhalt = new RegExp(`^${basis}/contents/(.+)$`).exec(u.pathname);
    if (inhalt) {
      const p = decodeURIComponent(inhalt[1]);
      const da = dateien.get(p);
      if (methode === 'GET') {
        if (!da) return json(route, 404, { message: 'Not Found' });
        if (/raw/.test(req.headers().accept || '')) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: da });
        return json(route, 200, { path: p, sha: blobSha(da) });
      }
      const body = JSON.parse(req.postData() || '{}');
      if (nurLesen && (methode === 'PUT' || methode === 'DELETE')) return json(route, 403, { message: 'Resource not accessible by personal access token' });
      if (methode === 'PUT') {
        if (da && body.sha !== blobSha(da)) return json(route, 409, { message: `${p} does not match ${body.sha}` });
        if (!da && body.sha) return json(route, 409, { message: 'does not exist' });
        const neu = Buffer.from(body.content, 'base64');
        dateien.set(p, neu);
        log.push(`  ${body.message}`);
        return json(route, da ? 200 : 201, { content: { path: p, sha: blobSha(neu) } });
      }
      if (methode === 'DELETE') {
        if (!da) return json(route, 404, {});
        if (body.sha !== blobSha(da)) return json(route, 409, { message: 'sha' });
        dateien.delete(p);
        return json(route, 200, { content: null });
      }
    }
    return json(route, 404, { message: 'Attrappe kennt das nicht' });
  }
  return { handler, log, dateien, token };
}

/** KI-Attrappe: antwortet als Strom (Anthropic-SSE) mit dem, was antwort(prompt) liefert. */
export function kiAttrappe(antwort) {
  const anfragen = [];
  async function handler(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    const body = JSON.parse(req.postData());
    anfragen.push({ headers: req.headers(), body });
    const text = await antwort(body.messages[0].content);
    const teile = text.match(/[\s\S]{1,40}/g) || [''];
    const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`;
    const strom = ev('message_start', { message: { id: 'msg_test', usage: { input_tokens: 10 } } }) + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      + teile.map((t) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } })).join('')
      + ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + ev('message_stop', {});
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream' }, body: strom });
  }
  return { handler, anfragen };
}
