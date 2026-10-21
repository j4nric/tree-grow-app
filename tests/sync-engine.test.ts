// Konto-Abgleich ohne Netzwerk: reine Entscheidungen (policy.ts) und der SyncEngine mit
// einer Fake-Cloud und mehreren „Geräten“ (Uhr als Zahl, Spielstand als einfacher Text).
import { describe, expect, it } from 'vitest';
import { SyncEngine, type SyncBase, type SyncEvent, type SyncHost, type SyncStatus } from '../src/sync/engine';
import {
  ACTION_THROTTLE_MS,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  PERIODIC_MS,
  backoffMs,
  compareProgress,
  decideInitial,
  nextPushAt,
  reactToRemote,
  resolveConflict,
  type Progress,
  type RemoteMeta,
} from '../src/sync/policy';
import type { RemoteSave, SaveWrite, SyncBackend } from '../src/sync/types';

const P = (cycle: number, lifetimeGrowth: number, playSeconds: number): Progress => ({ cycle, lifetimeGrowth, playSeconds });

describe('policy', () => {
  it('backoffMs: 0, NaN, negativ, groß, Infinity', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(Number.NaN)).toBe(0);
    expect(backoffMs(-3)).toBe(0);
    expect(backoffMs(1)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(2)).toBe(2 * BACKOFF_BASE_MS);
    expect(backoffMs(1e9)).toBe(BACKOFF_MAX_MS);
    expect(backoffMs(Number.POSITIVE_INFINITY)).toBe(BACKOFF_MAX_MS);
  });

  it('nextPushAt: Aktion gedrosselt, sonst periodisch, nach Fehlern Backoff', () => {
    const base = { lastAttemptAt: 10_000, pendingAction: false, failures: 0, active: true };
    expect(nextPushAt(base)).toBe(10_000 + PERIODIC_MS);
    expect(nextPushAt({ ...base, pendingAction: true })).toBe(10_000 + ACTION_THROTTLE_MS);
    expect(nextPushAt({ ...base, active: false })).toBe(Infinity);
    expect(nextPushAt({ ...base, failures: 3 })).toBe(10_000 + 4 * BACKOFF_BASE_MS);
    expect(nextPushAt({ ...base, failures: 3, active: false })).toBe(Infinity);
    expect(nextPushAt({ ...base, failures: 3, active: false, pendingAction: true })).toBe(10_000 + 4 * BACKOFF_BASE_MS);
    expect(nextPushAt({ ...base, lastAttemptAt: -Infinity, pendingAction: true })).toBe(-Infinity);
    expect(nextPushAt({ ...base, lastAttemptAt: Number.NaN, pendingAction: true })).toBe(-Infinity);
  });

  it('compareProgress: Zyklus vor Wachstum vor Spielzeit; NaN und negativ zählen als 0', () => {
    expect(compareProgress(P(2, 0, 0), P(1, 1e300, 1e9))).toBe(1);
    expect(compareProgress(P(1, 5, 0), P(1, 4, 1e9))).toBe(1);
    expect(compareProgress(P(1, 5, 10), P(1, 5, 11))).toBe(-1);
    expect(compareProgress(P(1, 5, 10), P(1, 5, 10))).toBe(0);
    expect(compareProgress(P(Number.NaN, Number.NaN, Number.NaN), P(0, 0, 0))).toBe(0);
    expect(compareProgress(P(1, -5, 0), P(1, 0, 0))).toBe(0);
    expect(compareProgress(P(1, Infinity, 0), P(1, 1e308, 0))).toBe(1);
  });

  it('decideInitial: neu, bekannte Linie, erste Anmeldung', () => {
    const remote: RemoteMeta = { version: 7, actionVersion: 5, device: 'x' };
    expect(decideInitial({ remote: null, base: null, localProgress: P(1, 1, 1), remoteProgress: null })).toEqual({ kind: 'insert' });
    // Linie bekannt: keine fremde Aktion seit base → lokal ist die Fortsetzung.
    expect(decideInitial({ remote, base: 5, localProgress: null, remoteProgress: null })).toEqual({ kind: 'push', version: 7, firstLogin: false });
    expect(decideInitial({ remote, base: 4, localProgress: null, remoteProgress: null })).toEqual({ kind: 'take', firstLogin: false });
    // Erste Anmeldung: der weitere Stand gewinnt, Gleichstand → Cloud.
    expect(decideInitial({ remote, base: null, localProgress: P(2, 0, 0), remoteProgress: P(1, 9, 9) }).kind).toBe('push');
    expect(decideInitial({ remote, base: null, localProgress: P(1, 0, 0), remoteProgress: P(1, 0, 0) }).kind).toBe('take');
    expect(decideInitial({ remote, base: null, localProgress: null, remoteProgress: P(1, 0, 0) }).kind).toBe('take');
    // Unlesbarer Cloud-Stand → lokal darüber.
    expect(decideInitial({ remote, base: null, localProgress: P(1, 0, 0), remoteProgress: null }).kind).toBe('push');
    expect(decideInitial({ remote, base: Number.NaN, localProgress: P(1, 0, 0), remoteProgress: P(0, 0, 0) }).kind).toBe('push');
  });

  it('reactToRemote und resolveConflict', () => {
    expect(reactToRemote(5, { version: 5, actionVersion: 5, device: 'b' }, 'a')).toBe('ignore');
    expect(reactToRemote(5, { version: 4, actionVersion: 4, device: 'b' }, 'a')).toBe('ignore');
    expect(reactToRemote(5, { version: 6, actionVersion: 3, device: 'b' }, 'a')).toBe('advance');
    expect(reactToRemote(5, { version: 6, actionVersion: 6, device: 'b' }, 'a')).toBe('take');
    expect(reactToRemote(5, { version: 6, actionVersion: 6, device: 'a' }, 'a')).toBe('advance');
    expect(reactToRemote(5, { version: Number.NaN, actionVersion: 9, device: 'b' }, 'a')).toBe('ignore');
    expect(resolveConflict(5, { version: 8, actionVersion: 5, device: 'b' })).toBe('push');
    expect(resolveConflict(5, { version: 8, actionVersion: 6, device: 'b' })).toBe('take');
  });
});

// --- Fake-Cloud und Geräte ------------------------------------------------------------

class FakeCloud {
  row: RemoteSave | null = null;
  online = true;
  writes = 0;
  private listeners = new Set<(change: RemoteMeta | null) => void>();

  private check(): void {
    if (!this.online) throw new Error('offline');
  }

  private notify(): void {
    const { version, actionVersion, device } = this.row!;
    for (const listener of [...this.listeners]) listener({ version, actionVersion, device });
  }

  backend(): SyncBackend {
    return {
      fetch: async () => {
        this.check();
        return this.row ? { ...this.row } : null;
      },
      insert: async (row: SaveWrite) => {
        this.check();
        if (this.row) return 'conflict';
        this.row = { data: row.data, version: 1, actionVersion: 1, device: row.device };
        this.writes++;
        this.notify();
        return 'ok';
      },
      update: async (expected: number, row: SaveWrite) => {
        this.check();
        if (!this.row || this.row.version !== expected) return 'conflict';
        const version = expected + 1;
        expect(row.version).toBe(version);
        this.row = { data: row.data, version, actionVersion: row.actionVersion ?? this.row.actionVersion, device: row.device };
        this.writes++;
        this.notify();
        return 'ok';
      },
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };
  }
}

/** Ein Gerät: Spielstand als Text „Zyklus|Wachstum|Aktionen“. */
class Device {
  data: string;
  base: SyncBase | null = null;
  backups: string[] = [];
  events: SyncEvent[] = [];
  statuses: SyncStatus[] = [];
  applied = 0;
  active = true;
  readonly engine: SyncEngine;

  constructor(
    cloud: FakeCloud,
    readonly name: string,
    readonly clock: { now: number },
    data = '1|0|',
  ) {
    this.data = data;
    const host: SyncHost = {
      clock: () => clock.now,
      snapshot: () => this.data,
      localProgress: () => Device.progress(this.data),
      progressOf: (d) => Device.progress(d),
      apply: (d) => {
        if (!Device.progress(d)) return false;
        this.data = d;
        this.applied++;
        return true;
      },
      backup: () => this.backups.push(this.data),
      isActive: () => this.active,
      loadBase: () => this.base,
      saveBase: (b) => (this.base = { ...b }),
      onStatus: (s) => this.statuses.push(s),
      onEvent: (e) => this.events.push(e),
    };
    this.engine = new SyncEngine(cloud.backend(), host, name);
  }

  static progress(data: string): Progress | null {
    const [cycle, growth] = data.split('|');
    if (cycle === undefined || growth === undefined || cycle === '' || Number.isNaN(Number(cycle))) return null;
    return { cycle: Number(cycle), lifetimeGrowth: Number(growth), playSeconds: 0 };
  }

  act(name: string): void {
    this.data += `${name},`;
    this.engine.markAction();
  }
}

/** Wartet, bis alle angestoßenen Abgleiche (auch aus Benachrichtigungen) fertig sind. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup() {
  const cloud = new FakeCloud();
  const clock = { now: 1_000_000 };
  return { cloud, clock };
}

describe('SyncEngine', () => {
  it('erstes Gerät legt den Stand an; zweites (neu, weniger weit) übernimmt ihn mit Sicherung', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock, '1|50|x,');
    await a.engine.start();
    expect(cloud.row).toMatchObject({ data: '1|50|x,', version: 1, actionVersion: 1, device: 'A' });
    expect(a.base).toEqual({ version: 1, pending: false });
    expect(a.engine.status.phase).toBe('synced');

    const b = new Device(cloud, 'B', clock, '1|0|');
    await b.engine.start();
    expect(b.data).toBe('1|50|x,');
    expect(b.backups).toEqual(['1|0|']);
    expect(b.events).toEqual([{ kind: 'first-login', winner: 'cloud' }]);
    expect(a.applied).toBe(0);
  });

  it('erste Anmeldung mit weiterem lokalem Stand: lokal gewinnt, das andere Gerät übernimmt', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock, '1|50|');
    await a.engine.start();
    const b = new Device(cloud, 'B', clock, '2|0|weit,');
    await b.engine.start();
    await settle();
    expect(cloud.row).toMatchObject({ data: '2|0|weit,', version: 2, actionVersion: 2 });
    expect(b.events).toEqual([{ kind: 'first-login', winner: 'local' }]);
    expect(a.data).toBe('2|0|weit,');
    expect(a.events).toEqual([{ kind: 'taken', lostLocal: false }]);
  });

  it('Aktion auf A erscheint auf B (gedrosselt, ein Push für mehrere Aktionen)', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    const b = new Device(cloud, 'B', clock);
    await a.engine.start();
    await b.engine.start();
    await settle();
    const writes = cloud.writes;
    clock.now += 100;
    a.act('pflanze');
    await a.engine.poll(); // gedrosselt: der letzte Versuch war gerade erst
    clock.now += 300;
    a.act('karte');
    await a.engine.poll();
    expect(cloud.writes).toBe(writes);
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    await settle();
    expect(cloud.writes).toBe(writes + 1);
    expect(b.data).toBe('1|0|pflanze,karte,');
    expect(b.events.at(-1)).toEqual({ kind: 'taken', lostLocal: false });
    // Das eigene Echo übernimmt A nicht.
    expect(a.applied).toBe(0);
  });

  it('periodischer Push ohne Aktion: das andere Gerät zieht nur die Version nach', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    const b = new Device(cloud, 'B', clock);
    await a.engine.start();
    await b.engine.start();
    await settle();
    const appliedBefore = b.applied;
    clock.now += PERIODIC_MS;
    a.data = '1|5|';
    await a.engine.poll();
    await settle();
    expect(cloud.row?.version).toBe(2);
    expect(b.applied).toBe(appliedBefore);
    expect(b.engine.version).toBe(2);
    // Bs nächste Aktion geht ohne Konflikt durch.
    b.act('b1');
    clock.now += ACTION_THROTTLE_MS;
    await b.engine.poll();
    await settle();
    expect(cloud.row).toMatchObject({ version: 3, actionVersion: 3, device: 'B' });
    expect(a.data).toBe('1|0|b1,');
  });

  it('kein periodischer Push bei verborgenem Tab', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    a.active = false;
    clock.now += 10 * PERIODIC_MS;
    await a.engine.poll();
    expect(cloud.row?.version).toBe(1);
  });

  it('Konflikt mit fremder Aktion: Cloud gewinnt, eigene Aktion als Sicherung', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    const b = new Device(cloud, 'B', clock);
    await a.engine.start();
    await b.engine.start();
    await settle();
    a.act('a1');
    clock.now += ACTION_THROTTLE_MS;
    b.act('b1');
    // A pusht; B hört (synchron in der Fake-Cloud) davon und übernimmt sofort –
    // dabei geht Bs offene Aktion verloren, wird aber gesichert.
    await a.engine.poll();
    await settle();
    expect(b.data).toBe('1|0|a1,');
    expect(b.backups.at(-1)).toBe('1|0|b1,');
    expect(b.events.at(-1)).toEqual({ kind: 'taken', lostLocal: true });
  });

  it('Konflikt beim Push (Benachrichtigung verpasst): fremde Aktion → übernehmen', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    // Ein anderes Gerät schreibt direkt (ohne dass A eine Meldung bekommt).
    cloud.row = { data: '1|0|fremd,', version: 2, actionVersion: 2, device: 'X' };
    a.act('a1');
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    expect(a.data).toBe('1|0|fremd,');
    expect(a.backups).toEqual(['1|0|a1,']);
    expect(a.events).toEqual([{ kind: 'taken', lostLocal: true }]);
    expect(a.engine.version).toBe(2);
    expect(a.engine.status.phase).toBe('synced');
  });

  it('Konflikt nur mit fremder Zeit: lokal darüber schreiben, nichts geht verloren', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    cloud.row = { data: '1|9|', version: 4, actionVersion: 1, device: 'X' };
    a.act('a1');
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    expect(cloud.row).toMatchObject({ data: '1|0|a1,', version: 5, actionVersion: 5, device: 'A' });
    expect(a.applied).toBe(0);
    expect(a.backups).toEqual([]);
  });

  it('offline: Spiel läuft weiter, Backoff, später nachgeholt – ohne Datenverlust', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    cloud.online = false;
    a.act('offline1');
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    expect(a.engine.status.phase).toBe('offline');
    expect(a.data).toBe('1|0|offline1,');
    expect(a.base).toEqual({ version: 1, pending: true });
    // Während des Backoffs kein neuer Versuch.
    clock.now += BACKOFF_BASE_MS - 1;
    const writes = cloud.writes;
    cloud.online = true;
    await a.engine.poll();
    expect(cloud.writes).toBe(writes);
    clock.now += 1;
    await a.engine.poll();
    expect(cloud.row).toMatchObject({ data: '1|0|offline1,', version: 2, actionVersion: 2 });
    expect(a.engine.status.phase).toBe('synced');
    expect(a.base).toEqual({ version: 2, pending: false });
  });

  it('Start offline: erster Abgleich wird mit Backoff wiederholt', async () => {
    const { cloud, clock } = setup();
    cloud.online = false;
    const a = new Device(cloud, 'A', clock, '1|3|');
    await a.engine.start();
    expect(a.engine.status.phase).toBe('offline');
    cloud.online = true;
    await a.engine.poll();
    expect(cloud.row).toBeNull();
    clock.now += BACKOFF_BASE_MS;
    await a.engine.poll();
    expect(cloud.row?.data).toBe('1|3|');
  });

  it('Neustart mit bekannter Linie und offener Aktion: lokal wird gepusht (als Aktion)', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: '1|0|', version: 3, actionVersion: 2, device: 'X' };
    const a = new Device(cloud, 'A', clock, '1|0|offline,');
    a.base = { version: 3, pending: true };
    await a.engine.start();
    expect(cloud.row).toMatchObject({ data: '1|0|offline,', version: 4, actionVersion: 4 });
    expect(a.applied).toBe(0);
  });

  it('Neustart, während ein anderes Gerät eine Aktion gemacht hat: übernehmen', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: '1|0|fremd,', version: 5, actionVersion: 5, device: 'X' };
    const a = new Device(cloud, 'A', clock, '1|0|');
    a.base = { version: 3, pending: false };
    await a.engine.start();
    expect(a.data).toBe('1|0|fremd,');
    expect(a.events).toEqual([]);
    expect(a.backups).toEqual([]);
  });

  it('unlesbarer Cloud-Stand: lokal wird darüber geschrieben', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: 'kaputt', version: 2, actionVersion: 2, device: 'X' };
    const a = new Device(cloud, 'A', clock, '1|1|');
    a.base = { version: 1, pending: false };
    await a.engine.start();
    expect(a.data).toBe('1|1|');
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    expect(cloud.row).toMatchObject({ data: '1|1|', version: 3, actionVersion: 3 });
  });

  it('Datensatz in der Cloud verschwunden: neu anlegen', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    cloud.row = null;
    a.act('x');
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    expect(cloud.row).toMatchObject({ data: '1|0|x,', version: 1 });
    expect(a.engine.version).toBe(1);
  });

  it('flush pusht sofort; nach stop passiert nichts mehr', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    a.act('x');
    await a.engine.flush();
    expect(cloud.row?.data).toBe('1|0|x,');
    a.engine.stop();
    a.act('y');
    clock.now += 10 * PERIODIC_MS;
    await a.engine.poll();
    await a.engine.flush();
    expect(cloud.row?.data).toBe('1|0|x,');
  });
});
