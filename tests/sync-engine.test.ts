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
  isNewerSchema,
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
    const input = { device: 'me', localForeign: false };
    expect(decideInitial({ ...input, remote: null, base: null, localProgress: P(1, 1, 1), remoteProgress: null })).toEqual({ kind: 'insert' });
    // Linie bekannt: keine fremde Aktion seit base → lokal ist die Fortsetzung.
    expect(decideInitial({ ...input, remote, base: 5, localProgress: null, remoteProgress: P(0, 0, 0) })).toEqual({ kind: 'push', version: 7, firstLogin: false });
    expect(decideInitial({ ...input, remote, base: 4, localProgress: null, remoteProgress: P(0, 0, 0) })).toEqual({ kind: 'take', firstLogin: false });
    // Erste Anmeldung: der weitere Stand gewinnt, Gleichstand → Cloud.
    expect(decideInitial({ ...input, remote, base: null, localProgress: P(2, 0, 0), remoteProgress: P(1, 9, 9) }).kind).toBe('push');
    expect(decideInitial({ ...input, remote, base: null, localProgress: P(1, 0, 0), remoteProgress: P(1, 0, 0) }).kind).toBe('take');
    expect(decideInitial({ ...input, remote, base: null, localProgress: null, remoteProgress: P(1, 0, 0) }).kind).toBe('take');
    expect(decideInitial({ ...input, remote, base: Number.NaN, localProgress: P(1, 0, 0), remoteProgress: P(0, 0, 0) }).kind).toBe('push');
  });

  it('decideInitial: unlesbarer Cloud-Stand blockiert – nie darüber schreiben', () => {
    const remote: RemoteMeta = { version: 7, actionVersion: 5, device: 'x' };
    for (const base of [null, 5, 4]) {
      expect(decideInitial({ remote, base, localProgress: P(9, 9, 9), remoteProgress: null, device: 'me', localForeign: false })).toEqual({ kind: 'blocked' });
    }
  });

  it('decideInitial: lokaler Stand eines anderen Kontos → Cloud gewinnt, auch wenn lokal weiter', () => {
    const remote: RemoteMeta = { version: 7, actionVersion: 5, device: 'x' };
    expect(decideInitial({ remote, base: null, localProgress: P(9, 9, 9), remoteProgress: P(1, 0, 0), device: 'me', localForeign: true })).toEqual({
      kind: 'take',
      firstLogin: true,
    });
  });

  it('decideInitial: Cloud-Stand vom eigenen Gerät (Antwort verloren) → eigene Linie, pushen', () => {
    const remote: RemoteMeta = { version: 7, actionVersion: 7, device: 'me' };
    expect(decideInitial({ remote, base: 5, localProgress: P(1, 0, 0), remoteProgress: P(1, 0, 0), device: 'me', localForeign: false })).toEqual({
      kind: 'push',
      version: 7,
      firstLogin: false,
    });
    expect(decideInitial({ remote, base: null, localProgress: P(0, 0, 0), remoteProgress: P(5, 0, 0), device: 'me', localForeign: false }).kind).toBe('push');
    // Lokaler Stand gehört einem anderen Konto: auch mit „eigener“ Kennung nie pushen (A → B → A).
    expect(decideInitial({ remote, base: null, localProgress: P(9, 0, 0), remoteProgress: P(1, 0, 0), device: 'me', localForeign: true })).toEqual({
      kind: 'take',
      firstLogin: true,
    });
    // Leere Geräte-ID zählt nie als „eigen“.
    expect(decideInitial({ remote: { ...remote, device: '' }, base: 5, localProgress: null, remoteProgress: P(0, 0, 0), device: '', localForeign: false }).kind).toBe('take');
  });

  it('isNewerSchema: fehlt/NaN = 0, nur echt größer', () => {
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a' }, 9)).toBe(false);
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: 9 }, 9)).toBe(false);
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: 10 }, 9)).toBe(true);
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: Number.NaN }, 9)).toBe(false);
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: Infinity }, 9)).toBe(false);
  });

  it('reactToRemote und resolveConflict', () => {
    expect(reactToRemote(5, { version: 5, actionVersion: 5, device: 'b' }, 'a')).toBe('ignore');
    expect(reactToRemote(5, { version: 4, actionVersion: 4, device: 'b' }, 'a')).toBe('ignore');
    expect(reactToRemote(5, { version: 6, actionVersion: 3, device: 'b' }, 'a')).toBe('advance');
    expect(reactToRemote(5, { version: 6, actionVersion: 6, device: 'b' }, 'a')).toBe('take');
    expect(reactToRemote(5, { version: 6, actionVersion: 6, device: 'a' }, 'a')).toBe('advance');
    expect(reactToRemote(5, { version: Number.NaN, actionVersion: 9, device: 'b' }, 'a')).toBe('ignore');
    expect(resolveConflict(5, { version: 8, actionVersion: 5, device: 'b' }, 'a')).toBe('push');
    expect(resolveConflict(5, { version: 8, actionVersion: 6, device: 'b' }, 'a')).toBe('take');
    // Eigener Push, dessen Antwort verloren ging: unsere Linie, nicht übernehmen.
    expect(resolveConflict(5, { version: 6, actionVersion: 6, device: 'a' }, 'a')).toBe('push');
  });
});

// --- Fake-Cloud und Geräte ------------------------------------------------------------

class FakeCloud {
  row: RemoteSave | null = null;
  /** Nächstes Schreiben „gelingt“ auf dem Server, aber die Antwort geht verloren. */
  loseNextAck = false;
  online = true;
  writes = 0;
  private listeners = new Set<(change: RemoteMeta | null) => void>();

  private check(): void {
    if (!this.online) throw new Error('offline');
  }

  private notify(): void {
    // Antwort verloren: auch die Live-Meldung kommt nicht an (Verbindung weg).
    if (this.loseNextAck) return;
    const { version, actionVersion, device, schema } = this.row!;
    for (const listener of [...this.listeners]) listener({ version, actionVersion, device, schema });
  }

  private ack(): 'ok' {
    if (this.loseNextAck) {
      this.loseNextAck = false;
      throw new Error('Antwort verloren');
    }
    return 'ok';
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
        this.row = { data: row.data, version: 1, actionVersion: 1, device: row.device, schema: row.schema };
        this.writes++;
        this.notify();
        return this.ack();
      },
      update: async (expected: number, row: SaveWrite) => {
        this.check();
        if (this.row && (this.row.schema ?? 0) > row.schema) return 'outdated';
        if (!this.row || this.row.version !== expected) return 'conflict';
        const version = expected + 1;
        expect(row.version).toBe(version);
        this.row = { data: row.data, version, actionVersion: row.actionVersion ?? this.row.actionVersion, device: row.device, schema: row.schema };
        this.writes++;
        this.notify();
        return this.ack();
      },
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };
  }
}

/** Spielstand-Version der Test-Geräte; Codes mit „NEU|“ stammen aus einer neueren. */
const SAVE_VERSION = 9;

/**
 * Ein Gerät: Spielstand als Text „Zyklus|Wachstum|Aktionen“. Mit „NEU|…“ aus einer neueren
 * Spielversion, mit mehr als 60 Zeichen „zu groß“ (lässt sich nicht wieder importieren).
 */
class Device {
  data: string;
  base: SyncBase | null = null;
  backups: string[] = [];
  cloudBackups: string[] = [];
  /** Konto, mit dem der lokale Stand zuletzt abgeglichen wurde (fremd → Cloud gewinnt). */
  foreign = false;
  ages: (number | undefined)[] = [];
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
      saveVersion: SAVE_VERSION,
      snapshot: () => this.data,
      check: (d) => (d.startsWith('NEU|') ? 'newer' : Device.progress(d) && d.length <= 60 ? 'ok' : 'invalid'),
      localProgress: () => Device.progress(this.data),
      progressOf: (d) => Device.progress(d),
      apply: (d, ageMs) => {
        if (!Device.progress(d)) return false;
        this.data = d;
        this.applied++;
        this.ages.push(ageMs);
        return true;
      },
      backup: () => this.backups.push(this.data),
      backupCloud: (d) => this.cloudBackups.push(d),
      localIsForeign: () => this.foreign,
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
    // Sicherheitsnetz: vor dem Ersetzen beim Start wird der lokale Stand immer gesichert.
    expect(a.backups).toEqual(['1|0|']);
  });

  it('unlesbarer Cloud-Stand: nie darüber schreiben, angehalten, später erneut geprüft', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: 'kaputt', version: 2, actionVersion: 2, device: 'X' };
    const a = new Device(cloud, 'A', clock, '1|1|');
    a.base = { version: 1, pending: false };
    await a.engine.start();
    expect(a.data).toBe('1|1|');
    expect(a.engine.status.phase).toBe('cloud-unreadable');
    a.act('a1');
    // Viele Versuche (mit Backoff): kein einziges Schreiben – kein Hin und Her.
    for (let i = 0; i < 20; i++) {
      clock.now += PERIODIC_MS;
      await a.engine.poll();
      await a.engine.flush();
    }
    expect(cloud.writes).toBe(0);
    expect(cloud.row.data).toBe('kaputt');
    expect(a.data).toBe('1|1|a1,');
    expect(a.engine.status.phase).toBe('cloud-unreadable');
    // Ein anderes Gerät repariert den Stand (ohne neue Aktion): beim nächsten Versuch geht es weiter.
    cloud.row = { data: '1|1|', version: 3, actionVersion: 1, device: 'X' };
    clock.now += BACKOFF_MAX_MS;
    await a.engine.poll();
    await settle();
    clock.now += BACKOFF_MAX_MS;
    await a.engine.poll();
    await settle();
    expect(a.engine.status.phase).toBe('synced');
    expect(cloud.row).toMatchObject({ data: '1|1|a1,', device: 'A' });
  });

  it('Cloud-Stand einer neueren Spielversion (schema): nie übernehmen, nie überschreiben', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: '1|9|neu,', version: 4, actionVersion: 4, device: 'X', schema: SAVE_VERSION + 1 };
    const a = new Device(cloud, 'A', clock, '1|1|');
    a.base = { version: 4, pending: true };
    await a.engine.start();
    expect(a.engine.status.phase).toBe('outdated');
    expect(a.statuses.at(-1)?.phase).toBe('outdated');
    a.act('a1');
    clock.now += 100 * PERIODIC_MS;
    await a.engine.poll();
    await a.engine.flush();
    expect(cloud.writes).toBe(0);
    expect(a.applied).toBe(0);
    expect(a.data).toBe('1|1|a1,');
  });

  it('Code einer neueren Spielversion ohne schema-Angabe: ebenfalls angehalten', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: 'NEU|1|9|', version: 2, actionVersion: 2, device: 'X' };
    const a = new Device(cloud, 'A', clock, '5|1|');
    await a.engine.start();
    expect(a.engine.status.phase).toBe('outdated');
    expect(a.data).toBe('5|1|');
    expect(cloud.writes).toBe(0);
  });

  it('anderes Gerät mit neuerer Spielversion schreibt: Live-Meldung hält sofort an', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    // Gerät mit neuerem Spiel (direkt über die Fake-Cloud, schema + 1).
    await cloud.backend().update(1, { data: '1|5|neu,', version: 2, device: 'N', actionVersion: 2, schema: SAVE_VERSION + 1 });
    await settle();
    expect(a.engine.status.phase).toBe('outdated');
    expect(a.applied).toBe(0);
    a.act('a1');
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    expect(cloud.row).toMatchObject({ data: '1|5|neu,', device: 'N' });
  });

  it('Server lehnt ab (422 outdated): angehalten statt erneut zu senden', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    // Ohne Meldung an A: neuerer Stand derselben Version.
    cloud.row = { ...cloud.row!, schema: SAVE_VERSION + 1 };
    a.act('a1');
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    expect(a.engine.status.phase).toBe('outdated');
    expect(a.engine.hasUnsent).toBe(true);
  });

  it('eigener Stand zu groß (nicht wieder importierbar): wird nie gesendet', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    a.data = `1|0|${'x'.repeat(80)}`;
    a.engine.markAction();
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    expect(a.engine.status.phase).toBe('local-invalid');
    expect(cloud.row?.data).toBe('1|0|');
    expect(a.engine.hasUnsent).toBe(true);
    // Wieder klein genug: nach dem Backoff geht es weiter.
    a.data = '1|0|klein,';
    clock.now += BACKOFF_BASE_MS;
    await a.engine.poll();
    expect(a.engine.status.phase).toBe('synced');
    expect(cloud.row?.data).toBe('1|0|klein,');
  });

  it('erste Anmeldung: beide Stände werden vorher gesichert (Cloud gewinnt)', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: '3|0|cloud,', version: 5, actionVersion: 5, device: 'X' };
    const b = new Device(cloud, 'B', clock, '1|7|lokal,');
    await b.engine.start();
    expect(b.data).toBe('3|0|cloud,');
    expect(b.backups).toEqual(['1|7|lokal,']);
    expect(b.cloudBackups).toEqual(['3|0|cloud,']);
  });

  it('erste Anmeldung: beide Stände werden vorher gesichert (lokal gewinnt)', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: '1|0|cloud,', version: 5, actionVersion: 5, device: 'X' };
    const b = new Device(cloud, 'B', clock, '4|0|lokal,');
    await b.engine.start();
    expect(cloud.row.data).toBe('4|0|lokal,');
    expect(b.backups).toEqual(['4|0|lokal,']);
    expect(b.cloudBackups).toEqual(['1|0|cloud,']);
  });

  it('lokaler Stand gehört zu einem anderen Konto: Cloud gewinnt, auch wenn lokal weiter', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: '1|0|cloud,', version: 2, actionVersion: 2, device: 'X' };
    const b = new Device(cloud, 'B', clock, '9|99|anderes-konto,');
    b.foreign = true;
    await b.engine.start();
    expect(b.data).toBe('1|0|cloud,');
    expect(cloud.row.data).toBe('1|0|cloud,');
    expect(b.backups).toEqual(['9|99|anderes-konto,']);
    expect(b.events).toEqual([{ kind: 'first-login', winner: 'cloud' }]);
  });

  it('eigener Push, dessen Antwort verloren ging: Konflikt mit eigener Linie → nicht übernehmen', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock);
    await a.engine.start();
    a.act('a1');
    cloud.loseNextAck = true;
    clock.now += ACTION_THROTTLE_MS;
    await a.engine.poll();
    expect(a.engine.status.phase).toBe('offline');
    expect(cloud.row).toMatchObject({ data: '1|0|a1,', version: 2, device: 'A' });
    a.act('a2');
    clock.now += BACKOFF_BASE_MS;
    await a.engine.poll();
    expect(a.applied).toBe(0);
    expect(a.backups).toEqual([]);
    expect(a.data).toBe('1|0|a1,a2,');
    expect(cloud.row).toMatchObject({ data: '1|0|a1,a2,', version: 3, device: 'A' });
    expect(a.engine.status.phase).toBe('synced');
  });

  it('A → B → A im selben Tab mit derselben Geräte-Kennung: fremder lokaler Stand wird nie gepusht', async () => {
    const { clock } = setup();
    const cloudA = new FakeCloud();
    cloudA.row = { data: '1|5|a-alt,', version: 3, actionVersion: 3, device: 'TAB' };
    // Lokal liegt B's Spiel, der lokale Stand gehört B (foreign aus Sicht von A).
    const tab = new Device(cloudA, 'TAB', clock, '7|0|b-spiel,');
    tab.foreign = true;
    await tab.engine.start();
    expect(cloudA.row.data).toBe('1|5|a-alt,');
    expect(cloudA.writes).toBe(0);
    expect(tab.data).toBe('1|5|a-alt,');
    expect(tab.backups).toEqual(['7|0|b-spiel,']);
    expect(tab.cloudBackups).toEqual(['1|5|a-alt,']);
  });

  it('Alter nach Serverzeit wird beim Übernehmen weitergereicht', async () => {
    const { cloud, clock } = setup();
    cloud.row = { data: '2|0|', version: 1, actionVersion: 1, device: 'X', ageMs: 4321 };
    const a = new Device(cloud, 'A', clock, '1|0|');
    await a.engine.start();
    expect(a.ages).toEqual([4321]);
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

  it('stop während des ersten Abgleichs: danach keine Grundlage und kein Status mehr', async () => {
    const { cloud, clock } = setup();
    const a = new Device(cloud, 'A', clock, '1|3|');
    const real = cloud.backend();
    // Das Schreiben kommt erst nach dem Abmelden zurück.
    const backend: SyncBackend = {
      ...real,
      insert: async (row) => {
        a.engine.stop();
        return real.insert(row);
      },
    };
    const engine = new SyncEngine(backend, (a.engine as unknown as { host: SyncHost }).host, 'A');
    (a as unknown as { engine: SyncEngine }).engine = engine;
    const statuses = a.statuses.length;
    await engine.start();
    expect(a.base).toBeNull();
    expect(a.statuses.slice(statuses).every((st) => st.phase !== 'synced')).toBe(true);
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
