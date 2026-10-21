// Sync-Server: Konten, Token, Spielstand mit Versionskonflikt, Größenlimit, CORS, SSE.
// Läuft mit dem Vitest des Spiels (npm run check), SQLite im Speicher, Server auf Port 0.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, MAX_DATA_BYTES, createApp, type App, type AppOptions } from '../src/app';
import { MAX_EXPORT_CODE_LENGTH } from '../../src/core/save';
import { hashPassword, normalizeUsername, verifyPassword } from '../src/auth';
import { openDb } from '../src/db';
import { RateLimiter } from '../src/rate-limit';
import { backupName, backupsToDelete, runBackup } from '../src/backup';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// scrypt (N = 2^15) braucht unter Last mehrere Sekunden je Anmeldung.
vi.setConfig({ testTimeout: 30_000 });

const ORIGIN = 'https://j4nric.github.io';

let server: Server;
let app: App;
let base: string;
let clock: number;

async function start(extra: Partial<AppOptions> = {}): Promise<void> {
  clock = 1_700_000_000_000;
  app = createApp({ db: openDb(':memory:'), allowedOrigins: [ORIGIN], now: () => clock, ...extra });
  server = createServer(app.handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => start());
afterEach(async () => {
  app.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function register(username = 'Eiche', password = 'geheim123'): Promise<string> {
  const res = await call('POST', '/api/register', { username, password });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

describe('Konten und Token', () => {
  it('Registrierung, Anmeldung, /me und Abmelden', async () => {
    const token = await register();
    expect(await (await call('GET', '/api/me', undefined, token)).json()).toEqual({ username: 'eiche' });
    // Groß-/Kleinschreibung egal, Name schon vergeben.
    expect((await call('POST', '/api/register', { username: 'EICHE', password: 'anderes123' })).status).toBe(409);
    const login = await call('POST', '/api/login', { username: ' eiche ', password: 'geheim123' });
    expect(login.status).toBe(200);
    const second = ((await login.json()) as { token: string }).token;
    expect(second).not.toBe(token);
    expect((await call('POST', '/api/logout', undefined, token)).status).toBe(204);
    expect((await call('GET', '/api/me', undefined, token)).status).toBe(401);
    // Die zweite Sitzung (anderes Gerät) bleibt angemeldet.
    expect((await call('GET', '/api/me', undefined, second)).status).toBe(200);
  });

  it('falsches Passwort und unbekannter Name → 401 (gleiche Antwort)', async () => {
    await register();
    const wrong = await call('POST', '/api/login', { username: 'eiche', password: 'falsch1234' });
    const unknown = await call('POST', '/api/login', { username: 'buche', password: 'falsch1234' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('Regeln für Namen und Passwort', async () => {
    expect((await call('POST', '/api/register', { username: 'ab', password: 'geheim123' })).status).toBe(400);
    expect((await call('POST', '/api/register', { username: 'mit leer', password: 'geheim123' })).status).toBe(400);
    expect((await call('POST', '/api/register', { username: 'eiche', password: 'kurz' })).status).toBe(400);
    expect((await call('POST', '/api/register', { username: 'eiche', password: 123456789 })).status).toBe(400);
    expect((await call('POST', '/api/register', 'kein json')).status).toBe(400);
    expect(normalizeUsername('Wald_Läufer')).toBeNull();
    expect(normalizeUsername('.punkt')).toBeNull();
    expect(normalizeUsername('a'.repeat(33))).toBeNull();
    expect(normalizeUsername('Ab-1.c_d')).toBe('ab-1.c_d');
    expect(normalizeUsername(null)).toBeNull();
  });

  it('kaputte oder fremde Token → 401', async () => {
    expect((await call('GET', '/api/save')).status).toBe(401);
    expect((await call('GET', '/api/save', undefined, 'x'.repeat(43))).status).toBe(401);
    expect((await call('GET', '/api/save', undefined, undefined, { Authorization: 'Basic abc' })).status).toBe(401);
  });

  it('Sitzung läuft nach 90 Tagen ohne Nutzung ab, Nutzung verlängert', async () => {
    const token = await register();
    clock += 80 * 86_400_000;
    expect((await call('GET', '/api/me', undefined, token)).status).toBe(200);
    clock += 80 * 86_400_000;
    expect((await call('GET', '/api/me', undefined, token)).status).toBe(200);
    clock += 91 * 86_400_000;
    expect((await call('GET', '/api/me', undefined, token)).status).toBe(401);
  });

  it('Passwort-Hash: Salt, Prüfung, kaputte Hashes', async () => {
    const a = await hashPassword('geheim123');
    const b = await hashPassword('geheim123');
    expect(a).not.toBe(b);
    expect(await verifyPassword('geheim123', a)).toBe(true);
    expect(await verifyPassword('geheim124', a)).toBe(false);
    expect(await verifyPassword('geheim123', 'unsinn')).toBe(false);
    expect(await verifyPassword('geheim123', 'scrypt$NaN$8$1$abc$def')).toBe(false);
  });
});

describe('Rate-Limit', () => {
  it('sperrt nach zu vielen Versuchen je IP, mit Retry-After', async () => {
    app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await start({ authLimit: { limit: 3, windowMs: 60_000 } });
    for (let i = 0; i < 3; i++) expect((await call('POST', '/api/login', { username: 'x1x', password: 'falsch1234' })).status).toBe(401);
    const blocked = await call('POST', '/api/login', { username: 'x1x', password: 'falsch1234' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    clock += 60_000;
    expect((await call('POST', '/api/login', { username: 'x1x', password: 'falsch1234' })).status).toBe(401);
  });

  it('RateLimiter: Grenzfälle', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.take('a', 0)).toBe(0);
    expect(limiter.take('a', 10)).toBe(990);
    expect(limiter.take('b', 10)).toBe(0);
    expect(limiter.take('a', 1000)).toBe(0);
  });
});

describe('Spielstand', () => {
  it('anlegen, lesen, Version erhöhen, Konflikt 409 mit aktuellem Stand', async () => {
    const token = await register();
    expect((await call('GET', '/api/save', undefined, token)).status).toBe(204);
    const created = await call('PUT', '/api/save', { data: 'VSZW1:a.1', baseVersion: 0, deviceId: 'A' }, token);
    expect(await created.json()).toEqual({ version: 1, actionVersion: 1, updatedAt: clock });
    // Zweites Anlegen: Konflikt.
    const again = await call('PUT', '/api/save', { data: 'VSZW1:b.2', baseVersion: 0, deviceId: 'B' }, token);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { current: { version: number } }).current.version).toBe(1);
    // Ohne Aktion bleibt actionVersion stehen.
    const auto = await call('PUT', '/api/save', { data: 'VSZW1:c.3', baseVersion: 1, deviceId: 'A' }, token);
    expect(await auto.json()).toMatchObject({ version: 2, actionVersion: 1 });
    const action = await call('PUT', '/api/save', { data: 'VSZW1:d.4', baseVersion: 2, deviceId: 'B', action: true }, token);
    expect(await action.json()).toMatchObject({ version: 3, actionVersion: 3 });
    const stale = await call('PUT', '/api/save', { data: 'VSZW1:e.5', baseVersion: 2, deviceId: 'A' }, token);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: 'conflict',
      current: { data: 'VSZW1:d.4', version: 3, actionVersion: 3, updatedAt: clock, deviceId: 'B', schema: 0, serverTime: clock },
    });
    expect(await (await call('GET', '/api/save', undefined, token)).json()).toMatchObject({ data: 'VSZW1:d.4', version: 3, deviceId: 'B' });
  });

  it('Version ohne Datensatz → 409 mit current null', async () => {
    const token = await register();
    const res = await call('PUT', '/api/save', { data: 'x', baseVersion: 5, deviceId: 'A' }, token);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', current: null });
  });

  it('jedes Konto sieht nur seinen Stand', async () => {
    const a = await register('eiche');
    const b = await register('buche');
    await call('PUT', '/api/save', { data: 'A', baseVersion: 0, deviceId: 'A' }, a);
    expect((await call('GET', '/api/save', undefined, b)).status).toBe(204);
  });

  it('Größenlimit und ungültige Felder', async () => {
    const token = await register();
    // Genau so groß wie ein Code, den das Spiel noch importieren kann (MAX_EXPORT_CODE_LENGTH).
    expect(MAX_DATA_BYTES).toBe(MAX_EXPORT_CODE_LENGTH);
    expect(MAX_BODY_BYTES).toBeGreaterThan(MAX_DATA_BYTES + 1000);
    const big = 'x'.repeat(MAX_DATA_BYTES + 1);
    expect((await call('PUT', '/api/save', { data: big, baseVersion: 0, deviceId: 'A' }, token)).status).toBe(413);
    expect((await call('PUT', '/api/save', { data: 'x'.repeat(MAX_DATA_BYTES), baseVersion: 0, deviceId: 'A' }, token)).status).toBe(200);
    expect((await call('PUT', '/api/save', { data: 'x'.repeat(2_000_000), baseVersion: 1, deviceId: 'A' }, token)).status).toBe(413);
    for (const baseVersion of [-1, 1.5, Number.NaN, '1', null]) {
      expect((await call('PUT', '/api/save', { data: 'x', baseVersion, deviceId: 'A' }, token)).status).toBe(400);
    }
    expect((await call('PUT', '/api/save', { data: '', baseVersion: 1, deviceId: 'A' }, token)).status).toBe(400);
    expect((await call('PUT', '/api/save', { data: 'x', baseVersion: 1, deviceId: 'A'.repeat(101) }, token)).status).toBe(400);
  });
});

describe('CORS', () => {
  it('nur die erlaubte Herkunft', async () => {
    const pre = await call('OPTIONS', '/api/save', undefined, undefined, { Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(pre.headers.get('access-control-allow-headers')).toContain('Authorization');
    const ok = await call('GET', '/api/health', undefined, undefined, { Origin: ORIGIN });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const evil = await call('POST', '/api/login', { username: 'eiche', password: 'geheim123' }, undefined, { Origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    // Ohne Origin (z. B. curl, Healthcheck) erlaubt, aber ohne CORS-Kopf.
    const plain = await call('GET', '/api/health');
    expect(plain.status).toBe(200);
    expect(plain.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('Server-Sent Events', () => {
  /** Liest Ereignisse aus dem Stream, bis `until` zutrifft. */
  async function readEvents(res: Response, until: (events: { event: string; data: string }[]) => boolean) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const events: { event: string; data: string }[] = [];
    let buffer = '';
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event) events.push({ event, data: data ?? '' });
      }
    }
    await reader.cancel();
    return events;
  }

  it('Ticket ist einmalig und kurzlebig; Push meldet Version und Gerät', async () => {
    const token = await register();
    expect((await call('GET', '/api/events?ticket=unsinn')).status).toBe(401);
    const { ticket } = (await (await call('POST', '/api/events/ticket', undefined, token)).json()) as { ticket: string };
    const stream = await call('GET', `/api/events?ticket=${ticket}`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    // Dasselbe Ticket ein zweites Mal: abgelehnt.
    expect((await call('GET', `/api/events?ticket=${ticket}`)).status).toBe(401);
    const reading = readEvents(stream, (events) => events.some((e) => e.event === 'save'));
    await call('PUT', '/api/save', { data: 'X', baseVersion: 0, deviceId: 'geraet-a' }, token);
    const events = await reading;
    expect(events[0]!.event).toBe('ready');
    expect(JSON.parse(events.find((e) => e.event === 'save')!.data)).toEqual({ version: 1, actionVersion: 1, deviceId: 'geraet-a', schema: 0 });

    const old = (await (await call('POST', '/api/events/ticket', undefined, token)).json()) as { ticket: string };
    clock += 61_000;
    expect((await call('GET', `/api/events?ticket=${old.ticket}`)).status).toBe(401);
  });

  it('Abmelden beendet den Stream der Sitzung', async () => {
    const token = await register();
    const { ticket } = (await (await call('POST', '/api/events/ticket', undefined, token)).json()) as { ticket: string };
    const stream = await call('GET', `/api/events?ticket=${ticket}`);
    const reading = readEvents(stream, () => false);
    await call('POST', '/api/logout', undefined, token);
    const events = await reading;
    expect(events.map((e) => e.event)).toEqual(['ready']);
  });
});

describe('Sicherung', () => {
  it('Dateiname je Tag und Aufräumen der ältesten', () => {
    expect(backupName(Date.UTC(2026, 9, 21, 23, 59))).toBe('saves-2026-10-21.db');
    const files = ['saves-2026-10-01.db', 'saves-2026-10-03.db', 'saves-2026-10-02.db', 'anderes.txt', 'saves.db'];
    expect(backupsToDelete(files, 2)).toEqual(['saves-2026-10-01.db']);
    expect(backupsToDelete(files, 10)).toEqual([]);
    // 0, NaN, negativ: mindestens die neueste bleibt.
    expect(backupsToDelete(files, 0)).toEqual(['saves-2026-10-01.db', 'saves-2026-10-02.db']);
    expect(backupsToDelete(files, Number.NaN)).toEqual(['saves-2026-10-01.db', 'saves-2026-10-02.db']);
    expect(backupsToDelete(files, -3)).toEqual(['saves-2026-10-01.db', 'saves-2026-10-02.db']);
  });

  it('runBackup schreibt eine lesbare Kopie und behält nur die neuesten', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vszw-backup-'));
    try {
      const db = openDb(join(dir, 'saves.db'));
      db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES ('eiche', 'x', 0)").run();
      for (let day = 1; day <= 4; day++) await runBackup(db, join(dir, 'backups'), 2, Date.UTC(2026, 9, day));
      expect(readdirSync(join(dir, 'backups')).sort()).toEqual(['saves-2026-10-03.db', 'saves-2026-10-04.db']);
      const copy = openDb(join(dir, 'backups', 'saves-2026-10-04.db'));
      expect(copy.prepare('SELECT username FROM users').get()).toMatchObject({ username: 'eiche' });
      copy.close();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
