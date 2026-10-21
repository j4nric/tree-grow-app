// Sync-Server: Härtung aus dem Sicherheits-Review – kaputte Anfrage-Zeilen, Grenzen für
// Event-Streams und Tickets, Registrierungs-Grenzen, voller Datenträger, Spielstand-Version,
// X-Forwarded-For, Fehlversuche je Name, scrypt-Parameter, Zeitgrenzen, Verwaltung.
import { scryptSync } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAdmin } from '../src/admin';
import { createApp, parseTarget, type App, type AppOptions } from '../src/app';
import { SCRYPT, hashPassword, verifyPassword } from '../src/auth';
import { openDb } from '../src/db';
import { DiskGuard } from '../src/disk';
import { createSyncServer, type ServerTimeouts } from '../src/http';
import { clientIp, isPrivateIp, normalizeIp, rateKey } from '../src/net';
import { RateLimiter } from '../src/rate-limit';

// scrypt (N = 2^15) braucht unter Last mehrere Sekunden je Anmeldung.
vi.setConfig({ testTimeout: 30_000 });

let server: Server | null = null;
let app: App | null = null;
let base = '';
let clock = 1_700_000_000_000;

async function start(extra: Partial<AppOptions> = {}, timeouts?: ServerTimeouts): Promise<void> {
  clock = 1_700_000_000_000;
  app = createApp({ db: openDb(':memory:'), allowedOrigins: [], now: () => clock, ...extra });
  server = timeouts ? createSyncServer(app, timeouts) : createServer(app.handle);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  app?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server!.close(resolve));
  }
  server = null;
  app = null;
});

function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function register(username = 'eiche', password = 'geheim123'): Promise<string> {
  const res = await call('POST', '/api/register', { username, password });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

async function ticket(token: string): Promise<string> {
  const res = await call('POST', '/api/events/ticket', undefined, token);
  expect(res.status).toBe(200);
  return ((await res.json()) as { ticket: string }).ticket;
}

/** Schickt rohe Bytes und liefert die Statuszeile der Antwort. */
function raw(request: string): Promise<string> {
  const { port } = server!.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(request));
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
      if (data.includes('\r\n')) {
        socket.destroy();
        resolve(data.slice(0, data.indexOf('\r\n')));
      }
    });
    socket.on('error', reject);
    socket.on('close', () => resolve(data.split('\r\n')[0] ?? ''));
  });
}

describe('Kaputte Anfragen beenden den Prozess nie', () => {
  it('GET //a:99999/ (new URL würde werfen) → Antwort, Server läuft weiter', async () => {
    await start();
    expect(() => new URL('//a:99999/', 'http://localhost')).toThrow();
    const status = await raw('GET //a:99999/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    expect(status).toMatch(/^HTTP\/1\.1 (400|404) /);
    expect((await call('GET', '/api/health')).status).toBe(200);
  });

  it('weitere seltsame Ziele: absolute URL, Prozentzeichen, nur Query', async () => {
    await start();
    for (const target of ['http://evil:99999/api/health', '/api/events?ticket=%zz%', '?x=1', '//', '/%']) {
      const status = await raw(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      expect(status, target).toMatch(/^HTTP\/1\.1 [2-4]\d\d /);
    }
    expect((await call('GET', '/api/health')).status).toBe(200);
  });

  it('parseTarget: Pfad und Query ohne URL-Parser', () => {
    expect(parseTarget('//a:99999/').path).toBe('//a:99999/');
    expect(parseTarget('/api/events?ticket=abc').query.get('ticket')).toBe('abc');
    expect(parseTarget(undefined).path).toBe('/');
    expect(parseTarget('/x?%zz=%').path).toBe('/x');
  });

  it('Fehler in einem Handler → 500, der Server antwortet weiter', async () => {
    await start({
      storageOk: () => {
        throw new Error('kaputt');
      },
    });
    const original = console.error;
    console.error = () => {};
    try {
      expect((await call('POST', '/api/register', { username: 'eiche', password: 'geheim123' })).status).toBe(500);
    } finally {
      console.error = original;
    }
    expect((await call('GET', '/api/health')).status).toBe(200);
  });
});

describe('Tickets und Event-Streams sind begrenzt', () => {
  it('höchstens 4 offene Tickets je Sitzung: das älteste verfällt', async () => {
    await start();
    const token = await register();
    const issued = [];
    for (let i = 0; i < 5; i++) issued.push(await ticket(token));
    expect(app!.stats().tickets).toBe(4);
    expect((await call('GET', `/api/events?ticket=${issued[0]}`)).status).toBe(401);
    const ok = await call('GET', `/api/events?ticket=${issued[4]}`);
    expect(ok.status).toBe(200);
    await ok.body?.cancel();
  });

  it('Abmelden löscht die Tickets der Sitzung', async () => {
    await start();
    const token = await register();
    const t = await ticket(token);
    await ticket(token);
    expect(app!.stats().tickets).toBe(2);
    await call('POST', '/api/logout', undefined, token);
    expect(app!.stats().tickets).toBe(0);
    expect((await call('GET', `/api/events?ticket=${t}`)).status).toBe(401);
  });

  it('abgelaufene Tickets räumt ein Timer weg (ohne Scan je Anfrage)', async () => {
    await start({ sweepMs: 10 });
    const token = await register();
    await ticket(token);
    await ticket(token);
    clock += 61_000;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app!.stats().tickets).toBe(0);
  });

  it('Gesamtzahl der Tickets begrenzt → 429 mit Retry-After', async () => {
    await start({ limits: { ticketsTotal: 2 } });
    const a = await register('eiche');
    const b = await register('buche');
    await ticket(a);
    await ticket(a);
    const res = await call('POST', '/api/events/ticket', undefined, b);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('Streams je Konto begrenzt; ein geschlossener Stream gibt den Platz frei', async () => {
    await start({ limits: { streamsPerUser: 2 } });
    const token = await register();
    const s1 = await call('GET', `/api/events?ticket=${await ticket(token)}`);
    const s2 = await call('GET', `/api/events?ticket=${await ticket(token)}`);
    expect([s1.status, s2.status]).toEqual([200, 200]);
    const third = await call('GET', `/api/events?ticket=${await ticket(token)}`);
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: 'too-many-streams' });
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    await s1.body!.cancel();
    await expect.poll(() => app!.stats().streams).toBe(1);
    const again = await call('GET', `/api/events?ticket=${await ticket(token)}`);
    expect(again.status).toBe(200);
    await again.body?.cancel();
    await s2.body?.cancel();
  });

  it('Streams je IP begrenzt (über Konten hinweg)', async () => {
    await start({ limits: { streamsPerIp: 2 } });
    const a = await register('eiche');
    const b = await register('buche');
    const s1 = await call('GET', `/api/events?ticket=${await ticket(a)}`);
    const s2 = await call('GET', `/api/events?ticket=${await ticket(b)}`);
    expect((await call('GET', `/api/events?ticket=${await ticket(b)}`)).status).toBe(429);
    await s1.body?.cancel();
    await s2.body?.cancel();
  });
});

describe('Registrierung: Gesamtgrenzen und voller Datenträger', () => {
  it('höchstens maxAccounts Konten → 403 registration-closed', async () => {
    await start({ limits: { maxAccounts: 2 } });
    await register('eiche');
    await register('buche');
    const res = await call('POST', '/api/register', { username: 'linde', password: 'geheim123' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'registration-closed' });
    // Anmelden geht weiter.
    expect((await call('POST', '/api/login', { username: 'eiche', password: 'geheim123' })).status).toBe(200);
  });

  it('Registrierungen insgesamt je Stunde begrenzt (auch über viele IPs)', async () => {
    await start({ limits: { registrations: { limit: 2, windowMs: 3_600_000 } } });
    await register('eiche');
    await register('buche');
    const res = await call('POST', '/api/register', { username: 'linde', password: 'geheim123' });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    clock += 3_600_000;
    await register('linde');
  });

  it('eine IP allein kann das Gesamtkontingent nicht aufbrauchen', async () => {
    await start({ trustProxy: true, limits: { registrationsPerIp: { limit: 2, windowMs: 3_600_000 } } });
    const reg = (username: string, xff: string) =>
      call('POST', '/api/register', { username, password: 'geheim123' }, undefined, { 'X-Forwarded-For': xff });
    expect((await reg('eiche', '6.6.6.6')).status).toBe(201);
    expect((await reg('buche', '6.6.6.6')).status).toBe(201);
    const third = await reg('linde', '6.6.6.6');
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await reg('linde', '1.2.3.4')).status).toBe(201);
  });

  it('Sitzungen je Konto begrenzt (älteste fallen weg); Anmelden bei vollem Datenträger → 507', async () => {
    let full = false;
    await start({ authLimit: { limit: 1000, windowMs: 60_000 }, limits: { sessionsPerUser: 3 }, storageOk: () => !full });
    const first = await register('eiche');
    const tokens: string[] = [];
    for (let i = 0; i < 3; i++) {
      clock += 1000;
      const res = await call('POST', '/api/login', { username: 'eiche', password: 'geheim123' });
      tokens.push(((await res.json()) as { token: string }).token);
    }
    expect((await call('GET', '/api/me', undefined, first)).status).toBe(401);
    for (const t of tokens) expect((await call('GET', '/api/me', undefined, t)).status).toBe(200);
    full = true;
    const res = await call('POST', '/api/login', { username: 'eiche', password: 'geheim123' });
    expect(res.status).toBe(507);
    expect((await call('GET', '/api/me', undefined, tokens[0])).status).toBe(200);
  });

  it('wenig freier Platz → 507 für Registrieren und Schreiben, Lesen geht', async () => {
    let full = false;
    await start({ storageOk: () => !full });
    const token = await register();
    expect((await call('PUT', '/api/save', { data: 'A', baseVersion: 0, deviceId: 'A' }, token)).status).toBe(200);
    full = true;
    expect((await call('POST', '/api/register', { username: 'buche', password: 'geheim123' })).status).toBe(507);
    const put = await call('PUT', '/api/save', { data: 'B', baseVersion: 1, deviceId: 'A' }, token);
    expect(put.status).toBe(507);
    expect(await put.json()).toEqual({ error: 'storage-full' });
    expect((await call('GET', '/api/save', undefined, token)).status).toBe(200);
  });

  it('DiskGuard: zwischengespeichert, unbekannt zählt als genug, Fehler und NaN', async () => {
    let t = 0;
    let free = 100;
    let calls = 0;
    const guard = new DiskGuard(
      async () => {
        calls++;
        return free;
      },
      200,
      1000,
      () => t,
    );
    expect(guard.ok()).toBe(true); // noch nicht gemessen
    await guard.refresh();
    expect(guard.ok()).toBe(false);
    free = 500;
    expect(guard.ok()).toBe(false); // noch zwischengespeichert
    const before = calls;
    t += 1000;
    expect(guard.ok()).toBe(false); // stößt die Messung an, antwortet aber sofort
    await guard.refresh();
    expect(guard.ok()).toBe(true);
    expect(calls).toBeGreaterThan(before);
    const broken = new DiskGuard(async () => {
      throw new Error('statfs');
    }, 200);
    await broken.refresh();
    expect(broken.ok()).toBe(true);
    const nan = new DiskGuard(async () => Number.NaN, 200);
    await nan.refresh();
    expect(nan.ok()).toBe(true);
    const zero = new DiskGuard(async () => 0, 200);
    await zero.refresh();
    expect(zero.ok()).toBe(false);
  });
});

describe('Spielstand-Version (schema)', () => {
  it('älteres Spiel darf einen neueren Stand nicht überschreiben → 422', async () => {
    await start();
    const token = await register();
    expect((await call('PUT', '/api/save', { data: 'A', baseVersion: 0, deviceId: 'A', schema: 10 }, token)).status).toBe(200);
    const old = await call('PUT', '/api/save', { data: 'B', baseVersion: 1, deviceId: 'B', schema: 9, action: true }, token);
    expect(old.status).toBe(422);
    expect(await old.json()).toEqual({ error: 'outdated-client', schema: 10 });
    // Ohne Angabe gilt 0 – ebenfalls zu alt.
    expect((await call('PUT', '/api/save', { data: 'B', baseVersion: 1, deviceId: 'B' }, token)).status).toBe(422);
    expect((await call('PUT', '/api/save', { data: 'C', baseVersion: 1, deviceId: 'A', schema: 10 }, token)).status).toBe(200);
    expect((await call('PUT', '/api/save', { data: 'D', baseVersion: 2, deviceId: 'A', schema: 11 }, token)).status).toBe(200);
    expect(await (await call('GET', '/api/save', undefined, token)).json()).toMatchObject({ data: 'D', schema: 11, serverTime: clock });
    for (const schema of [-1, 1.5, '9', 1e9, true]) {
      expect((await call('PUT', '/api/save', { data: 'E', baseVersion: 3, deviceId: 'A', schema }, token)).status).toBe(400);
    }
  });

  it('alte Datenbank ohne Spalte schema_version wird ergänzt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vszw-db-'));
    try {
      const path = join(dir, 'saves.db');
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE saves (user_id INTEGER PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, action_version INTEGER NOT NULL DEFAULT 0, device_id TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
        INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'eiche', 'x', 0);
        INSERT INTO saves (user_id, data, version, updated_at) VALUES (1, 'alt', 3, 0);`);
      old.close();
      const db = openDb(path);
      expect(db.prepare('SELECT data, version, schema_version FROM saves').get()).toMatchObject({ data: 'alt', version: 3, schema_version: 0 });
      db.close();
      // Zweites Öffnen: nichts doppelt.
      openDb(path).close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Client-IP und Anmelde-Grenzen', () => {
  it('isPrivateIp / normalizeIp', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '::1', '::ffff:172.18.0.5', 'fd00::1', 'fe80::1', '100.64.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '62.83.23.90', '2001:db8::1', '::ffff:8.8.8.8', '', 'unsinn', '999.1.1.1']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
    expect(normalizeIp('::FFFF:10.0.0.1')).toBe('10.0.0.1');
  });

  it('clientIp: nur vom Proxy (private Adresse) und dann der letzte Eintrag', () => {
    expect(clientIp('172.18.0.2', 'gefälscht, 1.2.3.4', true)).toBe('1.2.3.4');
    expect(clientIp('172.18.0.2', ['9.9.9.9', '5.6.7.8'], true)).toBe('5.6.7.8');
    // Direkt aus dem Internet: Kopf wird ignoriert.
    expect(clientIp('8.8.8.8', '1.2.3.4', true)).toBe('8.8.8.8');
    // Ohne trustProxy: nie.
    expect(clientIp('127.0.0.1', '1.2.3.4', false)).toBe('127.0.0.1');
    // Unsinn im letzten Eintrag → Verbindungsadresse.
    expect(clientIp('127.0.0.1', '1.2.3.4, <script>', true)).toBe('127.0.0.1');
    expect(clientIp('127.0.0.1', '', true)).toBe('127.0.0.1');
    expect(clientIp(undefined, '1.2.3.4', true)).toBe('unknown');
  });

  it('Rate-Limit zählt hinter dem Proxy je letzter X-Forwarded-For-Adresse', async () => {
    await start({ trustProxy: true, authLimit: { limit: 1, windowMs: 60_000 } });
    const login = (xff: string) => call('POST', '/api/login', { username: 'x1x', password: 'falsch1234' }, undefined, { 'X-Forwarded-For': xff });
    expect((await login('1.1.1.1')).status).toBe(401);
    expect((await login('1.1.1.1')).status).toBe(429);
    // Erfundener erster Eintrag hilft nicht; anderer letzter Eintrag ist ein anderer Client.
    expect((await login('5.5.5.5, 1.1.1.1')).status).toBe(429);
    expect((await login('1.1.1.1, 2.2.2.2')).status).toBe(401);
  });

  it('Fehlversuche je Benutzername: Sperre mit Retry-After, Erfolg setzt zurück', async () => {
    await start({ authLimit: { limit: 1000, windowMs: 60_000 }, limits: { loginFailures: { limit: 2, windowMs: 60_000 } } });
    await register('eiche');
    const login = (password: string) => call('POST', '/api/login', { username: 'eiche', password });
    expect((await login('falsch1234')).status).toBe(401);
    expect((await login('geheim123')).status).toBe(200); // setzt zurück
    expect((await login('falsch1234')).status).toBe(401);
    expect((await login('falsch1234')).status).toBe(401);
    const blocked = await login('geheim123');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    clock += 60_000;
    expect((await login('geheim123')).status).toBe(200);
  });

  it('fremde IP sperrt ein Konto nicht aus: streng je Name+IP, über alle IPs erst ab hoher Schwelle', async () => {
    await start({
      trustProxy: true,
      authLimit: { limit: 1000, windowMs: 60_000 },
      limits: { loginFailures: { limit: 2, windowMs: 60_000 }, loginFailuresPerUser: { limit: 5, windowMs: 60_000 } },
    });
    await register('eiche');
    const login = (password: string, xff: string) =>
      call('POST', '/api/login', { username: 'eiche', password }, undefined, { 'X-Forwarded-For': xff });
    // Angreifer 6.6.6.6 rät zweimal falsch → nur er ist gesperrt.
    expect((await login('falsch1234', '6.6.6.6')).status).toBe(401);
    expect((await login('falsch1234', '6.6.6.6')).status).toBe(401);
    expect((await login('geheim123', '6.6.6.6')).status).toBe(429);
    expect((await login('geheim123', '1.2.3.4')).status).toBe(200);
    // Verteilt über viele IPs: ab der hohen Schwelle gilt die Sperre je Name für alle.
    for (const xff of ['7.0.0.1', '7.0.0.2', '7.0.0.3']) expect((await login('falsch1234', xff)).status).toBe(401);
    const blocked = await login('geheim123', '1.2.3.4');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('rateKey: IPv4 unverändert, IPv6 je /64 gebündelt', () => {
    expect(rateKey('1.2.3.4')).toBe('1.2.3.4');
    expect(rateKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(rateKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(rateKey('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(rateKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(rateKey('::1')).toBe('0:0:0:0::/64');
    expect(rateKey('64:ff9b::1.2.3.4')).toBe('64:ff9b:0:0::/64');
    // Unsinn bleibt, wie er ist (nie ein Absturz).
    for (const bad of ['1::2::3', 'zz::1', 'unknown', '']) expect(typeof rateKey(bad)).toBe('string');
  });

  it('Rate-Limit zählt IPv6-Adressen desselben /64 gemeinsam', async () => {
    await start({ trustProxy: true, authLimit: { limit: 1, windowMs: 60_000 } });
    const login = (xff: string) => call('POST', '/api/login', { username: 'x1x', password: 'falsch1234' }, undefined, { 'X-Forwarded-For': xff });
    expect((await login('2001:db8:1:2::1')).status).toBe(401);
    expect((await login('2001:db8:1:2::ffff')).status).toBe(429);
    expect((await login('2001:db8:1:3::1')).status).toBe(401);
  });

  it('RateLimiter: blockedFor, reset und begrenzte Map', () => {
    const limiter = new RateLimiter(2, 1000, 3);
    expect(limiter.blockedFor('a', 0)).toBe(0);
    limiter.take('a', 0);
    expect(limiter.blockedFor('a', 0)).toBe(0);
    limiter.take('a', 100);
    expect(limiter.blockedFor('a', 100)).toBe(900);
    limiter.reset('a');
    expect(limiter.blockedFor('a', 100)).toBe(0);
    // Mehr Schlüssel als erlaubt: die ältesten fallen weg.
    for (const key of ['k1', 'k2', 'k3', 'k4', 'k5']) limiter.take(key, 200);
    limiter.take('k5', 200);
    limiter.take('k5', 200);
    expect(limiter.blockedFor('k5', 200)).toBeGreaterThan(0);
    expect(limiter.take('k1', 200)).toBe(0); // war verdrängt → neu
  });
});

describe('Passwort-Hash', () => {
  it('neue Hashes mit N = 2^15; alte Hashes (N = 2^14) bleiben gültig', async () => {
    expect(SCRYPT.N).toBe(2 ** 15);
    expect(await hashPassword('geheim123')).toMatch(/^scrypt\$32768\$8\$1\$/);
    const salt = Buffer.from('0123456789abcdef');
    const oldKey = scryptSync('geheim123', salt, 64, { N: 16384, r: 8, p: 1 });
    const old = `scrypt$16384$8$1$${salt.toString('base64')}$${oldKey.toString('base64')}`;
    expect(await verifyPassword('geheim123', old)).toBe(true);
    expect(await verifyPassword('geheim124', old)).toBe(false);
  });

  it('viele gleichzeitige Prüfungen kommen alle an (Warteschlange)', async () => {
    const hash = await hashPassword('geheim123');
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => verifyPassword(i % 2 ? 'geheim123' : 'falsch', hash)));
    expect(results).toEqual([false, true, false, true, false, true]);
  });
});

describe('Zeitgrenzen des HTTP-Servers', () => {
  it('requestTimeout trennt langsame Anfragen, Event-Streams bleiben offen', async () => {
    await start({}, { requestTimeout: 300, headersTimeout: 200, connectionsCheckingInterval: 50 });
    const token = await register();
    const stream = await call('GET', `/api/events?ticket=${await ticket(token)}`);
    expect(stream.status).toBe(200);
    // Eine Anfrage, deren Kopf nie fertig wird, wird nach der Zeitgrenze beendet.
    const slow = raw('GET /api/health HTTP/1.1\r\nHost: x\r\n');
    expect(await slow).toMatch(/^(HTTP\/1\.1 408 .*|)$/);
    // Der Stream lebt nach deutlich mehr als requestTimeout weiter und bekommt Ereignisse.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    await call('PUT', '/api/save', { data: 'X', baseVersion: 0, deviceId: 'A' }, token);
    while (!text.includes('event: save')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain('event: ready');
    expect(text).toContain('event: save');
    await reader.cancel();
  });
});

describe('Verwaltung (admin.ts, statt sqlite3 im Image)', () => {
  it('users, delete-user, backup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vszw-admin-'));
    try {
      const db = openDb(join(dir, 'saves.db'));
      db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES ('eiche', 'x', 0)").run();
      const lines: string[] = [];
      const env = { backupDir: join(dir, 'backups'), backupKeep: 7, now: Date.UTC(2026, 9, 21) };
      expect(await runAdmin(db, ['users'], (l) => lines.push(l), env)).toBe(0);
      expect(lines.at(-1)).toBe('1 Konten');
      expect(await runAdmin(db, ['backup'], (l) => lines.push(l), env)).toBe(0);
      expect(readdirSync(env.backupDir)).toEqual(['saves-2026-10-21.db']);
      expect(await runAdmin(db, ['delete-user', 'EICHE'], (l) => lines.push(l), env)).toBe(0);
      expect(await runAdmin(db, ['delete-user', 'eiche'], (l) => lines.push(l), env)).toBe(1);
      expect(await runAdmin(db, ['delete-user'], (l) => lines.push(l), env)).toBe(2);
      expect(await runAdmin(db, ['unsinn'], (l) => lines.push(l), env)).toBe(2);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
