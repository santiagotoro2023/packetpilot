// HTTP for the app server (blueprint @@BLUEPRINT_VERSION@@): routes for the API, the web app
// from the web folder, /healthz and /site.json, with the same headers in every deployment.
//
//   app.get('/api/items', async ctx => rows)            → 200 with JSON
//   app.post('/api/items', async ctx => ({ status: 201, body: row }))
//   app.del('/api/items/:id', async ctx => null)         → 204
//   throw httpError(404, 'not_found', 'There is no such item')
// ctx: { params, query, body, req, res, ip }. Errors are sent as { "error": { "code", "message" } }.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { log } from './log.mjs';

export const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'";
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': CSP
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp'
};

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const httpError = (status, code, message) => new HttpError(status, code, message);

function send(res, status, body, type = 'application/json', extra = {}) {
  const data = body === null || body === undefined ? '' : type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { ...SECURITY_HEADERS, ...(data === '' && status === 204 ? {} : { 'Content-Type': type }), ...extra });
  res.end(res.req.method === 'HEAD' ? undefined : data);
}

async function readJson(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return undefined;
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > config.bodyLimit) throw httpError(413, 'too_large', 'The request is too large.');
    chunks.push(c);
  }
  if (!size) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, 'bad_json', 'The request is not valid JSON.'); }
}

export function createApp({ health }) {
  const routes = [];
  const add = method => (pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), del: add('DELETE') };

  app.handle = async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url, 'http://x');
    res.on('finish', () => log.debug('request', { method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - t0 }));
    try {
      if (url.pathname === '/healthz') {
        const ok = await health().catch(() => false);
        return send(res, ok ? 200 : 503, ok ? 'ok\n' : 'database unavailable\n', 'text/plain');
      }
      if (url.pathname === '/site.json') {
        return send(res, 200, config.canonical ? { version: config.version, canonical: config.canonical } : { version: config.version }, 'application/json', { 'Cache-Control': 'no-store' });
      }
      if (url.pathname.startsWith('/api/')) {
        // Changes only from this app itself: JSON bodies (no plain form posts from other sites)
        // and, where the browser sends one, an Origin of this host
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) throw httpError(403, 'foreign_origin', 'Requests from other sites are not allowed.');
          const type = req.headers['content-type'] || '';
          if (req.headers['content-length'] !== '0' && type && !type.startsWith('application/json')) throw httpError(415, 'json_only', 'Send JSON (Content-Type: application/json).');
        }
        const route = routes.find(r => r.method === req.method && r.re.test(url.pathname));
        if (!route) {
          const other = routes.some(r => r.re.test(url.pathname));
          throw other ? httpError(405, 'method_not_allowed', 'This method is not allowed here.') : httpError(404, 'not_found', 'There is nothing here.');
        }
        const m = url.pathname.match(route.re);
        const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = await readJson(req);
        const out = await route.handler({ params, query: Object.fromEntries(url.searchParams), body, req, res, ip: req.socket.remoteAddress });
        if (res.writableEnded) return;
        if (out && typeof out === 'object' && 'status' in out && 'body' in out) return send(res, out.status, out.body);
        return out === null || out === undefined ? send(res, 204, null) : send(res, 200, out);
      }
      return serveFile(req, res, url.pathname);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } });
      log.error('request failed', { method: req.method, path: url.pathname, error: e.stack || e.message });
      return send(res, 500, { error: { code: 'internal', message: 'Something went wrong on the server. It was logged.' } });
    }
  };
  return app;
}

// The web app: files from the web folder, everything unknown gets index.html (like nginx try_files)
function serveFile(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) throw httpError(405, 'method_not_allowed', 'This method is not allowed here.');
  let file = path.join(config.webDir, decodeURIComponent(pathname));
  if (!file.startsWith(config.webDir)) throw httpError(403, 'forbidden', 'Forbidden.');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(config.webDir, 'index.html');
  const ext = path.extname(file);
  // The files have no hash in their names: browsers check for a new version every time
  const cache = /\.(js|css|json|html)$/.test(ext) ? { 'Cache-Control': 'no-cache' } : { 'Cache-Control': 'public, max-age=86400' };
  send(res, 200, fs.readFileSync(file), TYPES[ext] || 'application/octet-stream', cache);
}
