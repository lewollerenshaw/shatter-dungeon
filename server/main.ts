/**
 * Leaderboard server for local development and small deployments.
 *
 *   npm run server            http://localhost:8787, scores in server/data/scores.json
 *
 *   PORT          port to listen on (default 8787)
 *   DATA_FILE     where scores are kept
 *   ALLOW_ORIGIN  value for Access-Control-Allow-Origin (default *; the API uses no cookies)
 *   TRUST_PROXY   set to 1 behind a reverse proxy, to rate-limit by X-Forwarded-For
 */
import { createServer, type IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApi } from './api';
import { FileStore } from './store';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_FILE = process.env.DATA_FILE ?? fileURLToPath(new URL('./data/scores.json', import.meta.url));
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? '*';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
/** A full-length run log is a few tens of kilobytes. */
const MAX_BODY = 512 * 1024;

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

const store = await FileStore.open(DATA_FILE);
const api = createApi({ store, now: () => Date.now() });

const server = createServer(async (req, res) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    let body: unknown = null;
    if (req.method === 'POST') {
      const text = await readBody(req);
      if (text === null) return send(413, { ok: false, error: 'too_large', message: 'Request too large.' });
      try {
        body = JSON.parse(text);
      } catch {
        return send(400, { ok: false, error: 'bad_request', message: 'Body is not JSON.' });
      }
    }
    const forwarded = TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    const out = await api({
      method: req.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
      ip: forwarded || req.socket.remoteAddress || 'unknown',
    });
    send(out.status, out.body);
  } catch (err) {
    console.error(err);
    send(500, { ok: false, error: 'server', message: 'Something went wrong.' });
  }
});

server.listen(PORT, () => console.log(`Shatter Dungeon leaderboard on http://localhost:${PORT}  (scores: ${DATA_FILE})`));
