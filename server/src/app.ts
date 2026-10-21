/**
 * Sync-Server für „Vom Samen zum Wald“: Konten (Benutzername + Passwort), ein Spielstand je
 * Konto mit optimistischer Versionierung und Live-Benachrichtigung per Server-Sent Events.
 * Reines `node:http` – createApp liefert den Request-Handler (testbar ohne Port).
 *
 * API (JSON, Token als `Authorization: Bearer …`, keine Cookies):
 *   POST /api/register      {username, password}            → 201 {token, username}
 *   POST /api/login         {username, password}            → 200 {token, username}
 *   POST /api/logout                                         → 204
 *   GET  /api/me                                             → 200 {username}
 *   GET  /api/save                                           → 200 {data, version, actionVersion, updatedAt, deviceId} | 204
 *   PUT  /api/save          {data, baseVersion, deviceId, action?} → 200 {version, actionVersion, updatedAt} | 409 {current}
 *   POST /api/events/ticket                                  → 200 {ticket, expiresIn}
 *   GET  /api/events?ticket=…  (text/event-stream: `ready`, `save`)
 *   GET  /api/health                                         → 200 {ok: true}
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  dummyPasswordHash,
  hashPassword,
  hashToken,
  isValidPassword,
  newToken,
  normalizeUsername,
  verifyPassword,
} from './auth';
import type { Db } from './db';
import { RateLimiter } from './rate-limit';

export const MAX_DATA_BYTES = 256 * 1024;
export const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Gültigkeit eines SSE-Tickets (einmalig verwendbar). */
export const TICKET_MS = 60_000;
const MAX_DEVICE_ID = 100;

export interface AppOptions {
  db: Db;
  /** Erlaubte Herkünfte für CORS (exakt, z. B. `https://j4nric.github.io`). */
  allowedOrigins: readonly string[];
  /** Hinter einem Reverse-Proxy (Caddy): Client-IP aus X-Forwarded-For. */
  trustProxy?: boolean;
  now?: () => number;
  maxDataBytes?: number;
  /** Anmelde-/Registrierungsversuche je IP und Zeitfenster. */
  authLimit?: { limit: number; windowMs: number };
  heartbeatMs?: number;
}

export interface App {
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** Offene Event-Streams schließen, Timer stoppen. */
  close(): void;
}

interface SaveRow {
  data: string;
  version: number;
  action_version: number;
  device_id: string;
  updated_at: number;
}

interface Session {
  userId: number;
  username: string;
  tokenHash: string;
}

interface Stream {
  res: ServerResponse;
  tokenHash: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function createApp(options: AppOptions): App {
  const { db } = options;
  const now = options.now ?? Date.now;
  const maxData = options.maxDataBytes ?? MAX_DATA_BYTES;
  const maxBody = maxData + 4096;
  const origins = new Set(options.allowedOrigins);
  const limiter = new RateLimiter(options.authLimit?.limit ?? 20, options.authLimit?.windowMs ?? 15 * 60_000);
  const tickets = new Map<string, { userId: number; tokenHash: string; expires: number }>();
  const streams = new Map<number, Set<Stream>>();
  const heartbeat = setInterval(() => {
    for (const set of streams.values()) for (const s of set) s.res.write(': ping\n\n');
  }, options.heartbeatMs ?? 25_000);
  heartbeat.unref?.();

  const q = {
    userByName: db.prepare('SELECT id, password_hash FROM users WHERE username = ?'),
    insertUser: db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare(
      'SELECT s.user_id AS userId, s.expires_at AS expiresAt, u.username AS username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    ),
    touchSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    pruneSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    save: db.prepare('SELECT data, version, action_version, device_id, updated_at FROM saves WHERE user_id = ?'),
    insertSave: db.prepare(
      'INSERT INTO saves (user_id, data, version, action_version, device_id, updated_at) VALUES (?, ?, 1, 1, ?, ?) ON CONFLICT(user_id) DO NOTHING',
    ),
    updateSave: db.prepare(
      'UPDATE saves SET data = ?, version = version + 1, action_version = CASE WHEN ? THEN version + 1 ELSE action_version END, device_id = ?, updated_at = ? WHERE user_id = ? AND version = ?',
    ),
  };

  function ip(req: IncomingMessage): string {
    if (options.trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  function send(res: ServerResponse, status: number, body?: unknown): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (body === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBody) throw new HttpError(413, 'too-large');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > maxBody) throw new HttpError(413, 'too-large');
      chunks.push(chunk as Buffer);
    }
    try {
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // unten
    }
    throw new HttpError(400, 'bad-json');
  }

  function authenticate(req: IncomingMessage): Session {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header);
    if (!match) throw new HttpError(401, 'unauthorized');
    const tokenHash = hashToken(match[1]!);
    const t = now();
    const row = q.session.get(tokenHash, t) as { userId: number; expiresAt: number; username: string } | undefined;
    if (!row) throw new HttpError(401, 'unauthorized');
    // Gleitende Laufzeit: höchstens einmal am Tag verlängern.
    if (row.expiresAt - t < (SESSION_DAYS - 1) * DAY_MS) q.touchSession.run(t + SESSION_DAYS * DAY_MS, tokenHash);
    return { userId: row.userId, username: row.username, tokenHash };
  }

  function createSession(userId: number): string {
    const token = newToken();
    const t = now();
    q.insertSession.run(hashToken(token), userId, t, t + SESSION_DAYS * DAY_MS);
    return token;
  }

  function limit(req: IncomingMessage, res: ServerResponse): void {
    const wait = limiter.take(ip(req), now());
    if (wait > 0) {
      res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
      throw new HttpError(429, 'rate-limited');
    }
  }

  function credentials(body: Record<string, unknown>): { username: string; password: string } {
    const username = normalizeUsername(body.username);
    if (!username) throw new HttpError(400, 'invalid-username');
    if (!isValidPassword(body.password)) throw new HttpError(400, 'invalid-password');
    return { username, password: body.password };
  }

  function toSave(row: SaveRow) {
    return { data: row.data, version: row.version, actionVersion: row.action_version, updatedAt: row.updated_at, deviceId: row.device_id };
  }

  function broadcast(userId: number, row: SaveRow): void {
    const set = streams.get(userId);
    if (!set) return;
    const payload = JSON.stringify({ version: row.version, actionVersion: row.action_version, deviceId: row.device_id });
    for (const s of set) s.res.write(`event: save\ndata: ${payload}\n\n`);
  }

  function closeStreams(tokenHash: string): void {
    for (const set of streams.values()) {
      for (const s of set) {
        if (s.tokenHash === tokenHash) {
          set.delete(s);
          s.res.end();
        }
      }
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const key = `${req.method} ${url.pathname}`;
    switch (key) {
      case 'GET /api/health':
        return send(res, 200, { ok: true });

      case 'POST /api/register': {
        limit(req, res);
        const { username, password } = credentials(await readJson(req));
        if (q.userByName.get(username)) throw new HttpError(409, 'taken');
        const hash = await hashPassword(password);
        let userId: number;
        try {
          userId = Number(q.insertUser.run(username, hash, now()).lastInsertRowid);
        } catch {
          // Gleichzeitige Registrierung desselben Namens.
          throw new HttpError(409, 'taken');
        }
        return send(res, 201, { token: createSession(userId), username });
      }

      case 'POST /api/login': {
        limit(req, res);
        const body = await readJson(req);
        const username = normalizeUsername(body.username);
        const password = typeof body.password === 'string' && body.password.length <= 1000 ? body.password : '';
        const user = username ? (q.userByName.get(username) as { id: number; password_hash: string } | undefined) : undefined;
        // Auch ohne Konto rechnen, damit die Antwortzeit nichts verrät.
        const ok = await verifyPassword(password, user?.password_hash ?? (await dummyPasswordHash()));
        if (!user || !ok) throw new HttpError(401, 'credentials');
        q.pruneSessions.run(now());
        return send(res, 200, { token: createSession(user.id), username });
      }

      case 'POST /api/logout': {
        const session = authenticate(req);
        q.deleteSession.run(session.tokenHash);
        closeStreams(session.tokenHash);
        return send(res, 204);
      }

      case 'GET /api/me': {
        const session = authenticate(req);
        return send(res, 200, { username: session.username });
      }

      case 'GET /api/save': {
        const session = authenticate(req);
        const row = q.save.get(session.userId) as SaveRow | undefined;
        return row ? send(res, 200, toSave(row)) : send(res, 204);
      }

      case 'PUT /api/save': {
        const session = authenticate(req);
        const body = await readJson(req);
        const { data, baseVersion, deviceId } = body;
        if (typeof data !== 'string' || data.length === 0) throw new HttpError(400, 'invalid-data');
        if (Buffer.byteLength(data, 'utf8') > maxData) throw new HttpError(413, 'too-large');
        if (typeof baseVersion !== 'number' || !Number.isSafeInteger(baseVersion) || baseVersion < 0) {
          throw new HttpError(400, 'invalid-version');
        }
        if (typeof deviceId !== 'string' || deviceId.length > MAX_DEVICE_ID) throw new HttpError(400, 'invalid-device');
        const t = now();
        // node:sqlite arbeitet synchron: Prüfen und Schreiben laufen ohne Unterbrechung.
        const changes =
          baseVersion === 0
            ? Number(q.insertSave.run(session.userId, data, deviceId, t).changes)
            : Number(q.updateSave.run(data, body.action === true ? 1 : 0, deviceId, t, session.userId, baseVersion).changes);
        const row = q.save.get(session.userId) as SaveRow | undefined;
        if (changes === 0 || !row) throw new HttpError(409, 'conflict', { current: row ? toSave(row) : null });
        broadcast(session.userId, row);
        return send(res, 200, { version: row.version, actionVersion: row.action_version, updatedAt: row.updated_at });
      }

      case 'POST /api/events/ticket': {
        const session = authenticate(req);
        const t = now();
        for (const [k, v] of tickets) if (v.expires <= t) tickets.delete(k);
        const ticket = randomBytes(24).toString('base64url');
        tickets.set(ticket, { userId: session.userId, tokenHash: session.tokenHash, expires: t + TICKET_MS });
        return send(res, 200, { ticket, expiresIn: TICKET_MS / 1000 });
      }

      case 'GET /api/events': {
        const ticket = url.searchParams.get('ticket') ?? '';
        const entry = tickets.get(ticket);
        tickets.delete(ticket);
        if (!entry || entry.expires <= now()) throw new HttpError(401, 'unauthorized');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
        });
        const stream: Stream = { res, tokenHash: entry.tokenHash };
        let set = streams.get(entry.userId);
        if (!set) streams.set(entry.userId, (set = new Set()));
        set.add(stream);
        res.write('event: ready\ndata: {}\n\n');
        req.on('close', () => {
          set.delete(stream);
          if (set.size === 0) streams.delete(entry.userId);
        });
        return;
      }

      default:
        throw new HttpError(404, 'not-found');
    }
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = req.headers.origin;
    // Fremde Herkunft: gar nicht erst bearbeiten (ohne Origin, z. B. curl, ist erlaubt).
    if (origin && !origins.has(origin)) {
      send(res, 403, { error: 'origin' });
      return;
    }
    cors(req, res);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      send(res, 204);
      return;
    }
    route(req, res, url).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpError) {
        send(res, error.status, { error: error.code, ...error.extra });
        if (error.status === 413) req.resume();
        return;
      }
      console.error(error);
      send(res, 500, { error: 'server' });
    });
  }

  return {
    handle,
    close() {
      clearInterval(heartbeat);
      for (const set of streams.values()) for (const s of set) s.res.end();
      streams.clear();
    },
  };
}
