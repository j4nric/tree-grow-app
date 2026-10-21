// Konto-Abgleich systematisch: alle Abfolgen aus {Anmelden A/B, Abmelden, lokal spielen,
// neu laden} je Tab, {anderes Gerät schreibt in A/B, zweiter Tab} – über einen Fake-Server,
// einen gemeinsamen Fake-localStorage und den echten Kern (controller.ts + engine.ts).
//
// Geprüft wird nach jedem Schritt:
// (a) Ein Spiel, das zuletzt als Konto X gespielt wurde, landet nie in der Cloud eines
//     anderen Kontos Y mit vorhandenem Stand (nur in eine leere Cloud darf es – danach ist
//     es Y's Linie, seine Fortsetzungen sind erlaubt).
// (b) Jeder ersetzte Stand (lokal oder in der Cloud), dessen Aktionen im neuen Stand fehlen,
//     liegt danach als Sicherung vor.
import { describe, expect, it } from 'vitest';
import { createAccountCore, type AccountCore, type GameBridge } from '../src/sync/controller';
import type { RemoteMeta } from '../src/sync/policy';
import { FROZEN_TEXT } from '../src/sync/controller';
import { BACKUP_KEY, CLOUD_BACKUP_KEY, RESTORE_UNDO_KEY, readBackup, readBase, readOwner, writeBackup } from '../src/sync/storage';
import { AccountError, type AccountService, type AccountUser, type RemoteSave, type SyncBackend } from '../src/sync/types';
import { MemoryStorage } from './memory-storage';

const SESSION = 'vszw-session';
const SAVE = 'tree-grow-save';

/** Spielstand: zu welchem Konto er gehört (null = rein lokal) und welche Aktionen er enthält. */
interface Game {
  account: string | null;
  actions: string[];
}
const encode = (g: Game): string => `G:${JSON.stringify(g)}`;
function decode(code: string): Game | null {
  if (!code.startsWith('G:')) return null;
  try {
    return JSON.parse(code.slice(2)) as Game;
  } catch {
    return null;
  }
}
/** Gehen beim Ersetzen von `old` durch `next` Aktionen verloren? */
const loses = (old: Game, next: Game): boolean => old.actions.some((a) => !next.actions.includes(a));

class World {
  readonly violations: string[] = [];
  readonly clouds = new Map<string, RemoteSave | null>();
  readonly sessions = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(c: RemoteMeta | null) => void>>();
  clock = 1_000_000;
  private seq = 0;
  next(prefix: string): string {
    return `${prefix}${++this.seq}`;
  }

  /** Schreiben auf dem Server – mit den Prüfungen (a) und (b) für die Cloud. */
  write(account: string, row: RemoteSave, writer: MemoryStorage | null, insert: boolean): 'ok' | 'conflict' {
    const old = this.clouds.get(account) ?? null;
    if (insert ? old !== null : !old || old.version !== row.version - 1) return 'conflict';
    const incoming = decode(row.data)!;
    if (old) {
      const before = decode(old.data)!;
      // Fremd = gehört einem anderen Konto und setzt den Stand in Y nicht fort (nach dem
      // Anlegen in einer leeren Cloud ist das eingefügte Spiel Y's Linie).
      if (incoming.account !== null && incoming.account !== account && loses(before, incoming)) {
        this.violations.push(`(a) Spiel von ${incoming.account} in Cloud ${account}: ${row.data}`);
      }
      if (writer && loses(before, incoming)) {
        const saved = [CLOUD_BACKUP_KEY, BACKUP_KEY].map((k) => writer.getItem(k));
        if (!saved.includes(old.data)) this.violations.push(`(b) Cloud ${account} ersetzt ohne Sicherung: ${old.data} → ${row.data}`);
      }
    }
    // Was in der Cloud von Y liegt, gehört ab jetzt Y.
    const stored = { ...row, data: encode({ ...incoming, account }) };
    this.clouds.set(account, stored);
    for (const l of [...(this.listeners.get(account) ?? [])]) l({ version: stored.version, actionVersion: stored.actionVersion, device: stored.device });
    return 'ok';
  }

  /** Ein anderes Gerät macht in `account` eine Aktion. */
  otherDevice(account: string): void {
    const old = this.clouds.get(account) ?? null;
    const game: Game = old ? decode(old.data)! : { account, actions: [] };
    const row: RemoteSave = {
      data: encode({ account, actions: [...game.actions, this.next(`${account}-fremd`)] }),
      version: (old?.version ?? 0) + 1,
      actionVersion: (old?.version ?? 0) + 1,
      device: 'anderes-geraet',
    };
    this.write(account, row, null, !old);
  }

  subscribe(account: string, l: (c: RemoteMeta | null) => void): () => void {
    if (!this.listeners.has(account)) this.listeners.set(account, new Set());
    this.listeners.get(account)!.add(l);
    return () => this.listeners.get(account)!.delete(l);
  }
}

/** AccountService wie http-service.ts: Sitzung im gemeinsamen Storage, Backend an sein Konto gebunden. */
function fakeService(world: World, storage: MemoryStorage): AccountService {
  const session = (): { token: string; username: string } | null => {
    const raw = storage.getItem(SESSION);
    return raw ? (JSON.parse(raw) as { token: string; username: string }) : null;
  };
  const authed = (user: string): void => {
    const s = session();
    if (!s || s.username !== user || world.sessions.get(s.token) !== user) throw new AccountError('unauthorized');
  };
  const signIn = async (name: string): Promise<AccountUser> => {
    const token = world.next('t');
    world.sessions.set(token, name);
    storage.setItem(SESSION, JSON.stringify({ token, username: name }));
    return { name };
  };
  return {
    async currentUser() {
      const s = session();
      return s && world.sessions.get(s.token) === s.username ? { name: s.username } : null;
    },
    onUserChange() {},
    signIn,
    register: signIn,
    async signOut(user) {
      const s = session();
      if (!s || (user && s.username !== user.name)) return;
      world.sessions.delete(s.token);
      if (session()?.token === s.token) storage.removeItem(SESSION);
    },
    sessionUser: () => session()?.username ?? null,
    backend(user): SyncBackend {
      const name = user.name;
      return {
        async fetch() {
          authed(name);
          const row = world.clouds.get(name) ?? null;
          return row ? { ...row } : null;
        },
        async insert(row) {
          authed(name);
          return world.write(name, { data: row.data, version: 1, actionVersion: 1, device: row.device }, storage, true);
        },
        async update(expected, row) {
          authed(name);
          const old = world.clouds.get(name);
          return world.write(
            name,
            { data: row.data, version: expected + 1, actionVersion: row.actionVersion ?? old?.actionVersion ?? 0, device: row.device },
            storage,
            false,
          );
        },
        subscribe: (l) => world.subscribe(name, l),
      };
    },
  };
}

/** Ein Tab: Spiel im Speicher (wie main.ts), Kern des Kontos. */
class Tab {
  game: Game;
  frozen = false;
  readonly notes: string[] = [];
  readonly core: AccountCore;

  constructor(
    readonly world: World,
    readonly storage: MemoryStorage,
  ) {
    this.game = decode(storage.getItem(SAVE) ?? '') ?? { account: null, actions: [] };
    const bridge: GameBridge = {
      snapshot: () => encode(this.game),
      localProgress: () => ({ cycle: 1, lifetimeGrowth: this.game.actions.length, playSeconds: 0 }),
      progressOf: (code) => {
        const g = decode(code);
        return g ? { cycle: 1, lifetimeGrowth: g.actions.length, playSeconds: 0 } : null;
      },
      check: (code) => (decode(code) ? 'ok' : 'invalid'),
      adopt: (code) => this.replace(code, [BACKUP_KEY]),
      notify: (text) => this.notes.push(text),
      restore: (code) => (this.replace(code, []) ? null : 'kaputt'),
      freeze: () => {
        this.frozen = true;
      },
    };
    this.core = createAccountCore({
      storage,
      service: fakeService(world, storage),
      game: bridge,
      clock: () => world.clock,
      isActive: () => true,
      newDeviceId: () => world.next('geraet'),
      eventText: () => '',
      view: { showSignedIn() {}, showSignedOut() {}, showUnavailable() {}, showStale() {}, setStatus() {}, setBackups() {} },
    });
  }

  /** Lokalen Stand ersetzen – mit Prüfung (b): Verlorenes muss vorher gesichert sein. */
  private replace(code: string, backupKeys: string[]): boolean {
    const next = decode(code);
    if (!next) return false;
    if (backupKeys.length > 0 && loses(this.game, next)) {
      const old = encode(this.game);
      if (!backupKeys.some((k) => this.storage.getItem(k) === old)) {
        this.world.violations.push(`(b) lokal ersetzt ohne Sicherung: ${old} → ${code}`);
      }
    }
    this.game = next;
    this.persist();
    return true;
  }

  persist(): void {
    if (!this.frozen) this.storage.setItem(SAVE, encode(this.game));
  }

  play(): void {
    const user = this.core.user?.name ?? null;
    // Gespielt als das angemeldete Konto; abgemeldet bleibt das Spiel, wem es gehörte.
    this.game = { account: user ?? this.game.account, actions: [...this.game.actions, this.world.next('aktion')] };
    this.persist();
    this.core.markAction();
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

type Op = 'loginA' | 'loginB' | 'logout' | 'play' | 'reload';
type Step = { op: Op; tab: number } | { op: 'cloudA' | 'cloudB' | 'newTab' };

const TAB_OPS: Op[] = ['loginA', 'loginB', 'logout', 'play', 'reload'];
const STEPS: Step[] = [
  ...TAB_OPS.flatMap((op) => [0, 1].map((tab) => ({ op, tab }) as Step)),
  { op: 'cloudA' },
  { op: 'cloudB' },
  { op: 'newTab' },
];

const label = (s: Step): string => ('tab' in s ? `${s.op}@${s.tab}` : s.op);

async function run(steps: Step[], cloudA: boolean, cloudB: boolean): Promise<string[]> {
  const world = new World();
  const storage = new MemoryStorage();
  // Rein lokaler Stand mit Fortschritt, noch nie abgeglichen.
  storage.setItem(SAVE, encode({ account: null, actions: ['lokal0'] }));
  if (cloudA) world.otherDevice('A');
  if (cloudB) world.otherDevice('B');
  const tabs: Tab[] = [new Tab(world, storage)];
  await tabs[0]!.core.start();
  await settle();
  for (const step of steps) {
    if ('tab' in step) {
      const tab = tabs[step.tab];
      if (!tab) continue;
      const signedOut = !tab.core.user && !tab.core.stale;
      switch (step.op) {
        case 'loginA':
        case 'loginB':
          // Das Formular gibt es nur abgemeldet (und nicht im angehaltenen Tab).
          if (signedOut) await tab.core.signIn(step.op === 'loginA' ? 'A' : 'B', 'pw').catch(() => {});
          break;
        case 'logout':
          if (tab.core.user) await tab.core.signOut(true);
          break;
        case 'play':
          tab.play();
          break;
        case 'reload': {
          tab.persist(); // beforeunload (gesperrt: nichts)
          tab.core.dispose();
          const fresh = new Tab(world, storage);
          tabs[step.tab] = fresh;
          await fresh.core.start();
          break;
        }
      }
    } else if (step.op === 'newTab') {
      if (tabs.length < 2) {
        const tab = new Tab(world, storage);
        tabs.push(tab);
        await tab.core.start();
      }
    } else {
      world.otherDevice(step.op === 'cloudA' ? 'A' : 'B');
    }
    await settle();
    // storage-Ereignisse in den anderen Tabs, dann ein Takt mit fälligen Pushes.
    for (const t of tabs) t.core.checkSession();
    await settle();
    world.clock += 20_000;
    for (const t of tabs) await t.core.poll();
    await settle();
  }
  for (const t of tabs) t.core.dispose();
  return world.violations;
}

/** Kleiner deterministischer Zufall (xorshift). */
function rng(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}

describe('Konto-Abgleich: alle Abfolgen', () => {
  it('Länge 3 vollständig, alle Startlagen der Clouds', async () => {
    for (const [cloudA, cloudB] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      for (const a of STEPS)
        for (const b of STEPS)
          for (const c of STEPS) {
            const steps = [a, b, c];
            const violations = await run(steps, cloudA, cloudB);
            expect(violations, `${steps.map(label).join(' → ')} (A ${cloudA}, B ${cloudB})`).toEqual([]);
          }
    }
  }, 120_000);

  it('Länge 4 vollständig (beide Clouds mit Stand)', async () => {
    for (const a of STEPS)
      for (const b of STEPS)
        for (const c of STEPS)
          for (const d of STEPS) {
            const steps = [a, b, c, d];
            const violations = await run(steps, true, true);
            if (violations.length > 0) expect(violations, steps.map(label).join(' → ')).toEqual([]);
          }
  }, 300_000);

  it('2000 zufällige Abfolgen der Länge 7', async () => {
    const random = rng(20261021);
    for (let i = 0; i < 2000; i++) {
      const steps = Array.from({ length: 7 }, () => STEPS[Math.floor(random() * STEPS.length)]!);
      const cloudA = random() < 0.7;
      const cloudB = random() < 0.7;
      const violations = await run(steps, cloudA, cloudB);
      if (violations.length > 0) expect(violations, `${steps.map(label).join(' → ')} (A ${cloudA}, B ${cloudB})`).toEqual([]);
    }
  }, 300_000);

  it('die Prüfungen schlagen an (Gegenprobe ohne Schutz)', async () => {
    // Ohne Besitzer-Prüfung: A's Spiel direkt in B's Cloud schreiben → Verstoß (a) und (b).
    const world = new World();
    world.otherDevice('B');
    const old = world.clouds.get('B')!;
    world.write('B', { data: encode({ account: 'A', actions: ['x'] }), version: old.version + 1, actionVersion: 9, device: 'd' }, new MemoryStorage(), false);
    expect(world.violations.some((v) => v.startsWith('(a)'))).toBe(true);
    expect(world.violations.some((v) => v.startsWith('(b)'))).toBe(true);
    expect(RESTORE_UNDO_KEY).toBeTruthy();
  });
});

describe('Kern des Kontos: Einzelfälle', () => {
  async function setup() {
    const world = new World();
    const storage = new MemoryStorage();
    storage.setItem(SAVE, encode({ account: null, actions: ['lokal0'] }));
    world.otherDevice('A');
    world.otherDevice('B');
    const tab = new Tab(world, storage);
    await tab.core.start();
    return { world, storage, tab };
  }

  it('abgemeldet gespielt: Grundlage des Besitzers wird „offen“, beim Wiederanmelden gesichert bzw. gesendet', async () => {
    const { world, storage, tab } = await setup();
    await tab.core.signIn('A', 'pw');
    await settle();
    await tab.core.signOut(true);
    expect(readBase(storage, 'A')?.pending).toBe(false);
    tab.play();
    expect(readBase(storage, 'A')?.pending).toBe(true);
    // Inzwischen macht ein anderes Gerät in A weiter → beim Anmelden wird übernommen, aber gesichert.
    world.otherDevice('A');
    const before = encode(tab.game);
    await tab.core.signIn('A', 'pw');
    await settle();
    expect(readBackup(storage, BACKUP_KEY)).toEqual({ code: before, owner: 'A' });
    expect(world.violations).toEqual([]);
  });

  it('veralteter Tab: Hinweis und keine Sicherungen mehr angeboten', async () => {
    const { world, storage, tab } = await setup();
    const other = new Tab(world, storage);
    await other.core.start();
    await other.core.signIn('B', 'pw');
    await settle();
    tab.core.checkSession();
    expect(tab.core.stale).toBe(true);
    expect(tab.frozen).toBe(true);
    expect(tab.notes).toContain(FROZEN_TEXT);
    expect(tab.core.backups()).toEqual({ local: false, cloud: false, undo: false });
  });

  it('Sicherungen nur dem passenden Konto anbieten; abgemeldet mit Konto-Angabe', async () => {
    const { storage, tab } = await setup();
    writeBackup(storage, encode({ account: 'B', actions: ['b'] }), BACKUP_KEY, 'B');
    writeBackup(storage, encode({ account: 'A', actions: ['a'] }), CLOUD_BACKUP_KEY, 'A');
    writeBackup(storage, encode({ account: null, actions: ['l'] }), RESTORE_UNDO_KEY, null);
    expect(tab.core.backups()).toEqual({ local: { owner: 'B' }, cloud: { owner: 'A' }, undo: { owner: null } });
    await tab.core.signIn('A', 'pw');
    await settle();
    // Die Anmeldung hat neue Sicherungen geschrieben; danach wieder eine von B hinlegen.
    writeBackup(storage, encode({ account: 'B', actions: ['b'] }), BACKUP_KEY, 'B');
    expect(tab.core.backups().local).toBe(false);
    expect(tab.core.backups().cloud).toEqual({ owner: 'A' });
    expect(tab.core.restore('local')).toBeTruthy(); // nicht angeboten → abgelehnt
  });

  it('abgemeldet wiederhergestellt: Besitzer wird der der Sicherung, Stand davor als Rückweg', async () => {
    const { storage, tab } = await setup();
    const current = encode(tab.game);
    writeBackup(storage, encode({ account: 'B', actions: ['b1', 'b2'] }), BACKUP_KEY, 'B');
    expect(tab.core.restore('local')).toBeNull();
    expect(tab.game.actions).toEqual(['b1', 'b2']);
    expect(readOwner(storage)).toBe('B');
    expect(readBackup(storage, RESTORE_UNDO_KEY)).toEqual({ code: current, owner: null });
  });
});
