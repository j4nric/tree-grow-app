// Sync-Server: Sicherung über das Netz (GET /api/admin/backup) für die Kopie außerhalb des
// Servers – aus ohne Token, 401 bei falschem Token, 200 mit gültiger SQLite-Datei, Rate-Limit.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App, type AppOptions } from '../src/app';
import { ADMIN_TOKEN_MIN, parseAdminToken, tokensEqual } from '../src/auth';
import { backupToHandle } from '../src/backup';
import { openDb, type Db } from '../src/db';

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

function fetchBackup(token?: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/admin/backup`, {
    headers: { ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

describe('GET /api/admin/backup', () => {
  it('ohne Token in der Konfiguration: 404, auch mit beliebigem Token', async () => {
    await start({ adminBackup: null });
    expect((await fetchBackup()).status).toBe(404);
    expect((await fetchBackup(TOKEN)).status).toBe(404);
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
    expect((await fetchBackup(TOKEN)).status).toBe(200);
    const blocked = await fetchBackup(TOKEN);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(logs.at(-1)).toContain('429');
    clock += 60_000;
    expect((await fetchBackup(TOKEN)).status).toBe(200);
  });

  it('Datenträger fast voll: 507 statt einer weiteren Datei', async () => {
    await start({ storageOk: () => false });
    expect((await fetchBackup(TOKEN)).status).toBe(507);
  });

  it('nur GET', async () => {
    await start();
    const res = await fetch(`${base}/api/admin/backup`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(404);
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
