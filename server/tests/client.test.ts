// Der HTTP-Dienst des Spiels (src/sync/http-service.ts) gegen den echten Sync-Server
// (lokal auf Port 0, SQLite im Speicher – kein externes Netz).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_KEY, createHttpService } from '../../src/sync/http-service';
import { AccountError } from '../../src/sync/types';
import { MemoryStorage } from '../../tests/memory-storage';
import { createApp, type App } from '../src/app';
import { openDb } from '../src/db';

describe('HTTP-Dienst gegen den Sync-Server', () => {
  let server: Server;
  let app: App;
  let url: string;
  let clock = 0;
  let full = false;

  beforeEach(async () => {
    clock = 1_700_000_000_000;
    app = createApp({ db: openDb(':memory:'), allowedOrigins: [], now: () => clock, storageOk: () => !full, limits: { maxAccounts: 3 } });
    server = createServer(app.handle);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterEach(async () => {
    app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('Registrieren, Stand anlegen, Konflikt, zweites Gerät, Abmelden', async () => {
    const storageA = new MemoryStorage();
    const a = createHttpService(url, { fetch, storage: storageA });
    expect(await a.currentUser()).toBeNull();
    expect(await a.register('Eiche', 'geheim123')).toEqual({ name: 'eiche' });
    expect(JSON.parse(storageA.getItem(SESSION_KEY)!).username).toBe('eiche');
    expect(await a.currentUser()).toEqual({ name: 'eiche' });
    const backendA = a.backend({ name: 'eiche' });
    expect(await backendA.fetch()).toBeNull();
    expect(await backendA.insert({ data: 'S1', version: 1, device: 'A', actionVersion: 1, schema: 9 })).toBe('ok');
    expect(await backendA.insert({ data: 'S1', version: 1, device: 'A', actionVersion: 1, schema: 9 })).toBe('conflict');
    expect(await backendA.update(1, { data: 'S2', version: 2, device: 'A', schema: 9 })).toBe('ok');
    expect(await backendA.fetch()).toEqual({ data: 'S2', version: 2, actionVersion: 1, device: 'A', schema: 9, ageMs: 0 });

    const b = createHttpService(url, { fetch, storage: new MemoryStorage() });
    await expect(b.register('eiche', 'anderes123')).rejects.toMatchObject({ code: 'taken' });
    await expect(b.signIn('eiche', 'falsch123')).rejects.toMatchObject({ code: 'credentials' });
    await expect(b.signIn('eiche', 'geheim123')).resolves.toEqual({ name: 'eiche' });
    const backendB = b.backend({ name: 'eiche' });
    expect(await backendB.update(1, { data: 'alt', version: 2, device: 'B', actionVersion: 2, schema: 9 })).toBe('conflict');
    expect(await backendB.update(2, { data: 'S3', version: 3, device: 'B', actionVersion: 3, schema: 9 })).toBe('ok');
    expect(await backendA.fetch()).toMatchObject({ data: 'S3', version: 3, actionVersion: 3, device: 'B' });
    // Älteres Spiel (schema 8) darf den Stand von schema 9 nicht überschreiben.
    expect(await backendB.update(3, { data: 'alt', version: 4, device: 'B', actionVersion: 4, schema: 8 })).toBe('outdated');

    // Abmelden auf A: Sitzung weg, B bleibt angemeldet.
    await a.signOut();
    expect(storageA.getItem(SESSION_KEY)).toBeNull();
    expect(await a.currentUser()).toBeNull();
    expect(await b.currentUser()).toEqual({ name: 'eiche' });
  });

  it('Alter nach Serverzeit, voller Server, keine neuen Konten', async () => {
    full = false;
    const service = createHttpService(url, { fetch, storage: new MemoryStorage() });
    await service.register('eiche', 'geheim123');
    const backend = service.backend({ name: 'eiche' });
    expect(await backend.insert({ data: 'S1', version: 1, device: 'A', actionVersion: 1, schema: 9 })).toBe('ok');
    clock += 7000;
    expect((await backend.fetch())?.ageMs).toBe(7000);
    full = true;
    await expect(backend.update(1, { data: 'S2', version: 2, device: 'A', schema: 9 })).rejects.toMatchObject({ code: 'storage-full' });
    await expect(createHttpService(url, { fetch, storage: new MemoryStorage() }).register('buche', 'geheim123')).rejects.toMatchObject({
      code: 'storage-full',
    });
    full = false;
    await service.register('buche', 'geheim123');
    await service.register('linde', 'geheim123');
    await expect(service.register('ahorn', 'geheim123')).rejects.toMatchObject({ code: 'registration-closed' });
  });

  it('abgelaufene Sitzung: vergessen und gemeldet; offline bleibt man angemeldet', async () => {
    const storage = new MemoryStorage();
    const service = createHttpService(url, { fetch, storage });
    await service.register('buche', 'geheim123');
    const seen: unknown[] = [];
    service.onUserChange((user) => seen.push(user));
    // Server nicht erreichbar → angemeldet bleiben (der Abgleich holt nach).
    const offline = createHttpService('http://127.0.0.1:1', { fetch, storage });
    expect(await offline.currentUser()).toEqual({ name: 'buche' });
    await expect(offline.backend({ name: 'buche' }).fetch()).rejects.toBeInstanceOf(AccountError);
    // Ungültiges Token → 401 → abgemeldet.
    storage.setItem(SESSION_KEY, JSON.stringify({ token: 'x'.repeat(43), username: 'buche' }));
    await expect(service.backend({ name: 'buche' }).fetch()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(seen).toEqual([null]);
    expect(await service.currentUser()).toBeNull();
  });
});
