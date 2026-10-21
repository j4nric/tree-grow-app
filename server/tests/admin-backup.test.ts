// Sync-Server: Sicherung über das Netz (GET /api/admin/backup) für die Kopie außerhalb des
// Servers – aus ohne Token, 401 bei falschem Token, 200 mit gültiger SQLite-Datei, Rate-Limit.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App, type AppOptions } from '../src/app';
import { ADMIN_TOKEN_MIN, parseAdminToken, tokensEqual } from '../src/auth';
import { backupToHandle } from '../src/backup';
import { openDb, type Db } from '../src/db';
import { RateLimiter } from '../src/rate-limit';

// Große Sicherungen (40 MB Ballast) brauchen unter Last mehrere Sekunden.
vi.setConfig({ testTimeout: 30_000 });

const TOKEN = 'a'.repeat(20) + 'B7-_x'.repeat(10);

let server: Server | null = null;
let app: App | null = null;
let db: Db | null = null;
let dir = '';
let base = '';
let clock = 1_700_000_000_000;
let logs: string[] = [];

async function start(extra: Partial<AppOptions> = {}): Promise<void> {
  clock = Date.UTC(2026, 9, 21, 12);
  logs = [];
  dir = mkdtempSync(join(tmpdir(), 'vszw-admin-'));
  db = openDb(join(dir, 'saves.db'));
  db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES ('eiche', 'x', 1)").run();
  db.prepare("INSERT INTO saves (user_id, data, version, updated_at) VALUES (1, 'stand', 3, 2)").run();
  app = createApp({
    db,
    allowedOrigins: [],
    now: () => clock,
    adminBackup: { token: TOKEN, dir },
    log: (line) => logs.push(line),
    ...extra,
  });
  server = createServer(app.handle);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  app?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server!.close(resolve));
  }
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  server = null;
  app = null;
  db = null;
  dir = '';
});

/** ~40 MB Daten, damit das Senden nicht in die Puffer des Sockets passt. */
function ballast(target: Db): void {
  target.exec(
    'CREATE TABLE ballast (x BLOB); WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 40) INSERT INTO ballast SELECT zeroblob(1000000) FROM n;',
  );
}

async function waitFor(check: () => Promise<boolean> | boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Zeit abgelaufen');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Status eines Abrufs; der Körper wird ganz gelesen (sonst hält der Server die Sperre). */
async function statusOf(token?: string): Promise<number> {
  const res = await fetchBackup(token);
  await res.arrayBuffer().catch(() => {});
  // Der Server gibt die Sperre erst nach dem letzten Byte frei – kurz darauf warten.
  await waitFor(() => !app!.stats().adminBackupRunning);
  return res.status;
}

function fetchBackup(token?: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/admin/backup`, {
    headers: { ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

describe('GET /api/admin/backup', () => {
  it('ohne Token in der Konfiguration: 404, auch mit beliebigem Token', async () => {
    await start({ adminBackup: null });
    expect((await fetchBackup()).status).toBe(404);
    expect((await statusOf(TOKEN))).toBe(404);
    expect(logs).toEqual([]);
  });

  it('falsches oder fehlendes Token: 401, Protokoll ohne Token', async () => {
    await start({ limits: { adminBackup: { limit: 100, windowMs: 60_000 } } });
    for (const token of [undefined, '', 'falsch', TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase()]) {
      const res = await fetchBackup(token);
      expect(res.status, String(token)).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    expect((await fetchBackup(undefined, { Authorization: TOKEN })).status).toBe(401);
    expect((await fetchBackup(undefined, { Authorization: `Basic ${TOKEN}` })).status).toBe(401);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.includes('401') && !l.includes(TOKEN.slice(0, 10)))).toBe(true);
  });

  it('richtiges Token: 200 mit vollständiger, lesbarer SQLite-Datei; keine Zwischendatei bleibt', async () => {
    await start();
    // Rest eines abgebrochenen Laufs wird weggeräumt.
    writeFileSync(join(dir, '.admin-backup-deadbeef.db'), 'alt');
    const res = await fetchBackup(TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.sqlite3');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="saves-2026-10-21.db"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(Number(res.headers.get('content-length'))).toBe(bytes.length);
    expect(bytes.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\0');

    const file = join(dir, 'abgeholt.db');
    writeFileSync(file, bytes);
    const copy = new DatabaseSync(file, { readOnly: true });
    try {
      expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(copy.prepare('SELECT username FROM users').all()).toEqual([{ username: 'eiche' }]);
      expect(copy.prepare('SELECT data, version FROM saves').get()).toEqual({ data: 'stand', version: 3 });
    } finally {
      copy.close();
    }
    expect(readdirSync(dir).filter((f) => f.startsWith('.admin-backup-'))).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^Admin-Sicherung abgerufen \(\d+ Bytes\) von 127\.0\.0\.1$/);
  });

  it('Rate-Limit je IP zählt jeden Versuch (auch falsche Token); nach dem Fenster wieder frei', async () => {
    await start({ limits: { adminBackup: { limit: 2, windowMs: 60_000 } } });
    expect((await fetchBackup('falsch')).status).toBe(401);
    expect((await statusOf(TOKEN))).toBe(200);
    const blocked = await fetchBackup(TOKEN);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Weitere Versuche im selben Fenster: abgelehnt, aber nur ein Protokolleintrag.
    for (let i = 0; i < 5; i++) expect((await fetchBackup('falsch')).status).toBe(429);
    expect(logs.filter((l) => l.includes('429'))).toHaveLength(1);
    clock += 60_000;
    expect((await statusOf(TOKEN))).toBe(200);
    // Neues Fenster, neue Sperre → wieder genau ein Eintrag mehr.
    await statusOf(TOKEN);
    await statusOf(TOKEN);
    await statusOf(TOKEN);
    expect(logs.filter((l) => l.includes('429'))).toHaveLength(2);
  });

  it('Anfrage mit Origin-Kopf (Browser): 403, auch von der erlaubten Herkunft', async () => {
    await start({ allowedOrigins: ['https://j4nric.github.io'] });
    const res = await fetchBackup(TOKEN, { Origin: 'https://j4nric.github.io' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin' });
    expect((await statusOf(TOKEN))).toBe(200);
  });

  it('nie zwei Abrufe gleichzeitig: 429 busy, bis der erste fertig oder abgebrochen ist', async () => {
    await start({ limits: { adminBackup: { limit: 100, windowMs: 60_000 } } });
    ballast(db!);
    const first = await fetchBackup(TOKEN);
    expect(first.status).toBe(200);
    // Der erste Körper wird (noch) nicht gelesen – der Server hängt im Senden.
    const busy = await fetchBackup(TOKEN);
    expect(busy.status).toBe(429);
    expect(await busy.json()).toEqual({ error: 'busy' });
    await first.body?.cancel();
    await waitFor(async () => (await statusOf(TOKEN)) === 200);
  });

  it('Höchstdauer: ein Client, der nicht liest, wird getrennt und die Sperre frei', async () => {
    await start({ limits: { adminBackup: { limit: 100, windowMs: 60_000 } }, adminBackupTimeoutMs: 1000 });
    ballast(db!);
    // Je nach Rechner endet die Zeit schon beim Erstellen (fetch scheitert) oder beim Senden.
    let slow: Response | null = null;
    try {
      slow = await fetchBackup(TOKEN);
    } catch {
      // vor den Kopfzeilen getrennt
    }
    await waitFor(() => logs.some((l) => l.startsWith('Admin-Sicherung abgebrochen')));
    if (slow) {
      expect(slow.status).toBe(200);
      // Der Rest fehlt: der Client hält die halbe Datei nie für ganz.
      await expect(slow.arrayBuffer()).rejects.toThrow();
    }
    // Sperre frei: eine kleine Sicherung geht wieder durch.
    db!.exec('DROP TABLE ballast; VACUUM;');
    await waitFor(async () => (await statusOf(TOKEN)) === 200);
  });

  it('Datenträger fast voll: 507 statt einer weiteren Datei', async () => {
    await start({ storageOk: () => false });
    expect((await statusOf(TOKEN))).toBe(507);
  });

  it('nur GET', async () => {
    await start();
    const res = await fetch(`${base}/api/admin/backup`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(404);
  });
});

describe('RateLimiter.takeDetailed', () => {
  it('first nur beim ersten abgelehnten Versuch je Fenster (auch bei Grenze 0)', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.takeDetailed('a', 0)).toEqual({ wait: 0, first: false });
    expect(limiter.takeDetailed('a', 1)).toEqual({ wait: 0, first: false });
    expect(limiter.takeDetailed('a', 2)).toEqual({ wait: 998, first: true });
    expect(limiter.takeDetailed('a', 3)).toEqual({ wait: 997, first: false });
    expect(limiter.takeDetailed('a', 1000)).toEqual({ wait: 0, first: false });
    const zero = new RateLimiter(0, 1000);
    expect(zero.takeDetailed('a', 0).first).toBe(false);
    expect(zero.takeDetailed('a', 0)).toEqual({ wait: 1000, first: true });
    expect(zero.takeDetailed('a', 0).first).toBe(false);
  });
});

describe('Admin-Token', () => {
  it('parseAdminToken: mindestens 32 druckbare Zeichen, sonst aus', () => {
    expect(ADMIN_TOKEN_MIN).toBe(32);
    expect(parseAdminToken(undefined)).toBeNull();
    expect(parseAdminToken('')).toBeNull();
    expect(parseAdminToken('x'.repeat(31))).toBeNull();
    expect(parseAdminToken('x'.repeat(32))).toBe('x'.repeat(32));
    expect(parseAdminToken(`  ${'x'.repeat(40)}\n`)).toBe('x'.repeat(40));
    expect(parseAdminToken(`${'x'.repeat(20)} ${'x'.repeat(20)}`)).toBeNull();
    expect(parseAdminToken(`${'x'.repeat(32)}ä`)).toBeNull();
    expect(parseAdminToken('x'.repeat(1001))).toBeNull();
  });

  it('tokensEqual: gleich nur bei exakt gleichem Inhalt, auch bei verschiedener Länge ohne Fehler', () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
    expect(tokensEqual('', TOKEN)).toBe(false);
    expect(tokensEqual(`${TOKEN}${TOKEN}`, TOKEN)).toBe(false);
  });

  it('backupToHandle: auch eine Datenbank im Speicher lässt sich sichern', async () => {
    const memory = openDb(':memory:');
    const tmp = mkdtempSync(join(tmpdir(), 'vszw-admin-'));
    try {
      const handle = await backupToHandle(memory, tmp);
      try {
        expect((await handle.stat()).size).toBeGreaterThan(0);
      } finally {
        await handle.close();
      }
      expect(readdirSync(tmp)).toEqual([]);
    } finally {
      memory.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
