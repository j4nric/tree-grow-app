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
 *   GET  /api/save                                           → 200 {data, version, actionVersion, updatedAt, deviceId, schema, serverTime} | 204
 *   PUT  /api/save          {data, baseVersion, deviceId, action?, schema} → 200 {version, actionVersion, updatedAt}
 *                           | 409 {current} | 413 | 422 {error: 'outdated-client', schema} | 507
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
import { clientIp } from './net';
import { RateLimiter } from './rate-limit';

/**
 * Größter Spielstand (Text-Code) in Bytes – genau so lang, wie das Spiel ihn noch
 * importieren kann (MAX_EXPORT_CODE_LENGTH in src/core/save.ts; Codes sind reines ASCII).
 */
export const MAX_DATA_BYTES = 200_000;
/** Größter JSON-Körper einer Anfrage: der Code plus Hülle mit Luft (256 KB). */
export const MAX_BODY_BYTES = 256 * 1024;
export const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Gültigkeit eines SSE-Tickets (einmalig verwendbar). */
export const TICKET_MS = 60_000;
const MAX_DEVICE_ID = 100;
/** Höchste Spielstand-Version, die der Server annimmt (Schutz vor Unsinn, nicht vor neuen Spielen). */
const MAX_SCHEMA = 1_000_000;

/** Grenzen gegen Missbrauch – alle über AppOptions.limits einstellbar (Tests). */
export interface Limits {
  /** Offene Event-Streams je Konto (Tabs/Geräte). */
  streamsPerUser: number;
  /** Offene Event-Streams je IP-Adresse. */
  streamsPerIp: number;
  /** Offene Event-Streams insgesamt. */
  streamsTotal: number;
  /** Offene Tickets je Sitzung (ältere verfallen beim nächsten). */
  ticketsPerSession: number;
  /** Offene Tickets insgesamt. */
  ticketsTotal: number;
  /** Höchstzahl an Konten (env MAX_ACCOUNTS). */
  maxAccounts: number;
  /** Registrierungen insgesamt je Zeitfenster. */
  registrations: { limit: number; windowMs: number };
  /** Fehlgeschlagene Anmeldungen je Benutzername und Zeitfenster. */
  loginFailures: { limit: number; windowMs: number };
}

export const DEFAULT_LIMITS: Limits = {
  streamsPerUser: 8,
  streamsPerIp: 16,
  streamsTotal: 2000,
  ticketsPerSession: 4,
  ticketsTotal: 10_000,
  maxAccounts: 1000,
  registrations: { limit: 30, windowMs: 60 * 60_000 },
  loginFailures: { limit: 10, windowMs: 15 * 60_000 },
};

export interface AppOptions {
  db: Db;
  /** Erlaubte Herkünfte für CORS (exakt, z. B. `https://j4nric.github.io`). */
  allowedOrigins: readonly string[];
  /**
   * Hinter einem Reverse-Proxy: Client-IP aus dem letzten Eintrag von X-Forwarded-For –
   * nur wenn die Verbindung von einer privaten Adresse (dem Proxy) kommt.
   */
  trustProxy?: boolean;
  now?: () => number;
  maxDataBytes?: number;
  /** Anmelde-/Registrierungsversuche je IP und Zeitfenster. */
  authLimit?: { limit: number; windowMs: number };
  limits?: Partial<Limits>;
  /** false = Datenträger fast voll → Registrieren und Schreiben mit 507 ablehnen. */
  storageOk?: () => boolean;
  heartbeatMs?: number;
  /** Wie oft abgelaufene Tickets entfernt werden (Standard TICKET_MS). */
  sweepMs?: number;
}

export interface App {
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** Offene Event-Streams schließen, Timer stoppen. */
  close(): void;
  /** Zähler für Tests und Logs. */
  stats(): { tickets: number; streams: number };
}

interface SaveRow {
  data: string;
  version: number;
  action_version: number;
  device_id: string;
  updated_at: number;
  schema_version: number;
}

interface Session {
  userId: number;
  username: string;
  tokenHash: string;
}

interface Stream {
  res: ServerResponse;
  tokenHash: string;
  ip: string;
}

interface Ticket {
  userId: number;
  tokenHash: string;
  expires: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
    /** Sekunden für den Kopf Retry-After (429). */
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

function rateLimited(waitMs: number, code = 'rate-limited'): HttpError {
  return new HttpError(429, code, {}, Math.max(1, Math.ceil(waitMs / 1000)));
}

/** Pfad und Query aus der rohen Anfrage-Zeile – ohne `new URL` (das wirft z. B. bei `//a:99999/`). */
export function parseTarget(raw: string | undefined): { path: string; query: URLSearchParams } {
  const target = raw ?? '/';
  const index = target.indexOf('?');
  const path = index < 0 ? target : target.slice(0, index);
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(index < 0 ? '' : target.slice(index + 1));
  } catch {
    query = new URLSearchParams();
  }
  return { path, query };
}

export function createApp(options: AppOptions): App {
  const { db } = options;
  const now = options.now ?? Date.now;
  const maxData = options.maxDataBytes ?? MAX_DATA_BYTES;
  const maxBody = Math.max(MAX_BODY_BYTES, maxData + 4096);
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const storageOk = options.storageOk ?? (() => true);
  const origins = new Set(options.allowedOrigins);
  const limiter = new RateLimiter(options.authLimit?.limit ?? 20, options.authLimit?.windowMs ?? 15 * 60_000);
  const registrations = new RateLimiter(limits.registrations.limit, limits.registrations.windowMs);
  const loginFailures = new RateLimiter(limits.loginFailures.limit, limits.loginFailures.windowMs);

  // Tickets: je Sitzung höchstens ticketsPerSession (älteste fallen weg), insgesamt
  // höchstens ticketsTotal. Abgelaufene räumt ein Timer weg; beim Einlösen zählt die Uhr.
  const tickets = new Map<string, Ticket>();
  const ticketsBySession = new Map<string, string[]>();
  const streams = new Map<number, Set<Stream>>();
  const streamsByIp = new Map<string, number>();
  let streamCount = 0;

  const heartbeat = setInterval(() => {
    for (const set of streams.values()) for (const s of set) s.res.write(': ping\n\n');
  }, options.heartbeatMs ?? 25_000);
  heartbeat.unref?.();
  const sweeper = setInterval(sweepTickets, options.sweepMs ?? TICKET_MS);
  sweeper.unref?.();

  const q = {
    userByName: db.prepare('SELECT id, password_hash FROM users WHERE username = ?'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    insertUser: db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare(
      'SELECT s.user_id AS userId, s.expires_at AS expiresAt, u.username AS username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    ),
    touchSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    pruneSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    save: db.prepare('SELECT data, version, action_version, device_id, updated_at, schema_version FROM saves WHERE user_id = ?'),
    insertSave: db.prepare(
      'INSERT INTO saves (user_id, data, version, action_version, device_id, updated_at, schema_version) VALUES (?, ?, 1, 1, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING',
    ),
    updateSave: db.prepare(
      'UPDATE saves SET data = ?, version = version + 1, action_version = CASE WHEN ? THEN version + 1 ELSE action_version END, device_id = ?, updated_at = ?, schema_version = ? WHERE user_id = ? AND version = ?',
    ),
  };

  function ip(req: IncomingMessage): string {
    return clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], options.trustProxy === true);
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

  function limit(req: IncomingMessage): void {
    const wait = limiter.take(ip(req), now());
    if (wait > 0) throw rateLimited(wait);
  }

  function requireStorage(): void {
    if (!storageOk()) throw new HttpError(507, 'storage-full');
  }

  function credentials(body: Record<string, unknown>): { username: string; password: string } {
    const username = normalizeUsername(body.username);
    if (!username) throw new HttpError(400, 'invalid-username');
    if (!isValidPassword(body.password)) throw new HttpError(400, 'invalid-password');
    return { username, password: body.password };
  }

  /** Datensatz für den Client; `serverTime` erlaubt ihm, das Alter ohne die eigene Uhr zu berechnen. */
  function toSave(row: SaveRow) {
    return {
      data: row.data,
      version: row.version,
      actionVersion: row.action_version,
      updatedAt: row.updated_at,
      deviceId: row.device_id,
      schema: row.schema_version,
      serverTime: now(),
    };
  }

  function broadcast(userId: number, row: SaveRow): void {
    const set = streams.get(userId);
    if (!set) return;
    const payload = JSON.stringify({
      version: row.version,
      actionVersion: row.action_version,
      deviceId: row.device_id,
      schema: row.schema_version,
    });
    for (const s of set) s.res.write(`event: save\ndata: ${payload}\n\n`);
  }

  function closeStreams(userId: number, tokenHash: string): void {
    const set = streams.get(userId);
    if (!set) return;
    for (const s of [...set]) if (s.tokenHash === tokenHash) s.res.end();
  }

  // --- Tickets -------------------------------------------------------------------------

  function dropTicket(ticket: string): Ticket | undefined {
    const entry = tickets.get(ticket);
    if (!entry) return undefined;
    tickets.delete(ticket);
    const list = ticketsBySession.get(entry.tokenHash);
    if (list) {
      const rest = list.filter((t) => t !== ticket);
      if (rest.length > 0) ticketsBySession.set(entry.tokenHash, rest);
      else ticketsBySession.delete(entry.tokenHash);
    }
    return entry;
  }

  function sweepTickets(): void {
    const t = now();
    for (const [ticket, entry] of tickets) if (entry.expires <= t) dropTicket(ticket);
  }

  function issueTicket(session: Session): string {
    const list = ticketsBySession.get(session.tokenHash) ?? [];
    // Pro Sitzung nur wenige offene Tickets: das älteste weicht dem neuen.
    while (list.length >= limits.ticketsPerSession) {
      const oldest = list.shift()!;
      tickets.delete(oldest);
    }
    if (tickets.size >= limits.ticketsTotal) throw rateLimited(TICKET_MS, 'busy');
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { userId: session.userId, tokenHash: session.tokenHash, expires: now() + TICKET_MS });
    list.push(ticket);
    ticketsBySession.set(session.tokenHash, list);
    return ticket;
  }

  function dropSessionTickets(tokenHash: string): void {
    for (const ticket of ticketsBySession.get(tokenHash) ?? []) tickets.delete(ticket);
    ticketsBySession.delete(tokenHash);
  }

  // --- Routen --------------------------------------------------------------------------

  async function route(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams): Promise<void> {
    const key = `${req.method} ${path}`;
    switch (key) {
      case 'GET /api/health':
        return send(res, 200, { ok: true });

      case 'POST /api/register': {
        limit(req);
        requireStorage();
        const { username, password } = credentials(await readJson(req));
        if (q.userByName.get(username)) throw new HttpError(409, 'taken');
        const count = Number((q.countUsers.get() as { n: number }).n);
        if (count >= limits.maxAccounts) throw new HttpError(403, 'registration-closed');
        // Gesamtgrenze für neue Konten (gegen massenhaftes Anlegen über viele IPs).
        const wait = registrations.take('all', now());
        if (wait > 0) throw rateLimited(wait);
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
        limit(req);
        const body = await readJson(req);
        const username = normalizeUsername(body.username);
        const password = typeof body.password === 'string' && body.password.length <= 1000 ? body.password : '';
        // Gegen verteiltes Raten eines Passworts: Fehlversuche je Benutzername zählen.
        if (username) {
          const wait = loginFailures.blockedFor(username, now());
          if (wait > 0) throw rateLimited(wait);
        }
        const user = username ? (q.userByName.get(username) as { id: number; password_hash: string } | undefined) : undefined;
        // Auch ohne Konto rechnen, damit die Antwortzeit nichts verrät.
        const ok = await verifyPassword(password, user?.password_hash ?? (await dummyPasswordHash()));
        if (!user || !ok) {
          if (username) loginFailures.take(username, now());
          throw new HttpError(401, 'credentials');
        }
        loginFailures.reset(username!);
        q.pruneSessions.run(now());
        return send(res, 200, { token: createSession(user.id), username });
      }

      case 'POST /api/logout': {
        const session = authenticate(req);
        q.deleteSession.run(session.tokenHash);
        dropSessionTickets(session.tokenHash);
        closeStreams(session.userId, session.tokenHash);
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
        // Spielstand-Version des Spiels (SAVE_VERSION); fehlt sie, gilt 0.
        const schema = body.schema ?? 0;
        if (typeof schema !== 'number' || !Number.isSafeInteger(schema) || schema < 0 || schema > MAX_SCHEMA) {
          throw new HttpError(400, 'invalid-schema');
        }
        requireStorage();
        const t = now();
        // node:sqlite arbeitet synchron: Prüfen und Schreiben laufen ohne Unterbrechung.
        const stored = q.save.get(session.userId) as SaveRow | undefined;
        // Ein älteres Spiel darf einen Stand einer neueren Spielversion nie überschreiben.
        if (stored && schema < stored.schema_version) {
          throw new HttpError(422, 'outdated-client', { schema: stored.schema_version });
        }
        const changes =
          baseVersion === 0
            ? Number(q.insertSave.run(session.userId, data, deviceId, t, schema).changes)
            : Number(q.updateSave.run(data, body.action === true ? 1 : 0, deviceId, t, schema, session.userId, baseVersion).changes);
        const row = q.save.get(session.userId) as SaveRow | undefined;
        if (changes === 0 || !row) throw new HttpError(409, 'conflict', { current: row ? toSave(row) : null });
        broadcast(session.userId, row);
        return send(res, 200, { version: row.version, actionVersion: row.action_version, updatedAt: row.updated_at });
      }

      case 'POST /api/events/ticket': {
        const session = authenticate(req);
        return send(res, 200, { ticket: issueTicket(session), expiresIn: TICKET_MS / 1000 });
      }

      case 'GET /api/events': {
        const ticket = query.get('ticket') ?? '';
        const entry = dropTicket(ticket);
        if (!entry || entry.expires <= now()) throw new HttpError(401, 'unauthorized');
        const address = ip(req);
        const set = streams.get(entry.userId) ?? new Set<Stream>();
        if (
          set.size >= limits.streamsPerUser ||
          (streamsByIp.get(address) ?? 0) >= limits.streamsPerIp ||
          streamCount >= limits.streamsTotal
        ) {
          throw rateLimited(30_000, 'too-many-streams');
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
        });
        const stream: Stream = { res, tokenHash: entry.tokenHash, ip: address };
        streams.set(entry.userId, set);
        set.add(stream);
        streamsByIp.set(address, (streamsByIp.get(address) ?? 0) + 1);
        streamCount++;
        let open = true;
        const release = () => {
          if (!open) return;
          open = false;
          set.delete(stream);
          if (set.size === 0 && streams.get(entry.userId) === set) streams.delete(entry.userId);
          const n = (streamsByIp.get(address) ?? 1) - 1;
          if (n > 0) streamsByIp.set(address, n);
          else streamsByIp.delete(address);
          streamCount--;
        };
        res.on('close', release);
        req.on('close', release);
        res.write('event: ready\ndata: {}\n\n');
        return;
      }

      default:
        throw new HttpError(404, 'not-found');
    }
  }

  /** Fehler in eine Antwort übersetzen – wirft nie. */
  function fail(req: IncomingMessage, res: ServerResponse, error: unknown): void {
    try {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpError) {
        if (error.retryAfter !== undefined) res.setHeader('Retry-After', String(error.retryAfter));
        send(res, error.status, { error: error.code, ...error.extra });
        if (error.status === 413) req.resume();
        return;
      }
      console.error(error);
      send(res, 500, { error: 'server' });
    } catch (inner) {
      console.error(inner);
      res.destroy();
    }
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    // Abgebrochene Verbindungen melden Fehler auf den Streams – nie den Prozess beenden.
    req.on('error', () => {});
    res.on('error', () => {});
    try {
      const { path, query } = parseTarget(req.url);
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
      route(req, res, path, query).catch((error: unknown) => fail(req, res, error));
    } catch (error) {
      fail(req, res, error);
    }
  }

  return {
    handle,
    close() {
      clearInterval(heartbeat);
      clearInterval(sweeper);
      for (const set of streams.values()) for (const s of [...set]) s.res.end();
      streams.clear();
      tickets.clear();
      ticketsBySession.clear();
    },
    stats: () => ({ tickets: tickets.size, streams: streamCount }),
  };
}
