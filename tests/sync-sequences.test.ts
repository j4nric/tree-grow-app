// Konto-Abgleich systematisch: Abfolgen aus
//   je Tab: Anmelden A/B, Abmelden, lokal spielen, neu laden, neu laden mitten im Senden,
//           Sicherung wiederherstellen
//   global: anderes Gerät schreibt in A/B, zweiter Tab, Netzfehler (vor/nach dem Schreiben,
//           Sitzung weg = 401, 422 neuere Spielversion, 507 Server voll), Live-Meldungen gehen
//           verloren
// – über einen Fake-Server, einen gemeinsamen Fake-localStorage und den echten Kern
// (controller.ts + engine.ts). Jeder Takt speichert jeden Tab (Autosave).
//
// Geprüft wird:
// (a) Ein Spiel, das zuletzt als Konto X gespielt wurde, landet nie in der Cloud eines
//     anderen Kontos Y mit vorhandenem Stand (nur in eine leere Cloud darf es – danach ist
//     es Y's Linie, seine Fortsetzungen sind erlaubt).
// (b) Jeder Stand, den der Abgleich (oder „Wiederherstellen“) ersetzt hat und dessen Aktionen
//     danach weder in einer Cloud noch lokal (Speicher eines Tabs, gespeicherter Stand)
//     vorkommen, liegt nach JEDEM Schritt als Sicherung im Ring – auch am Ende noch.
import { describe, expect, it } from 'vitest';
import { FROZEN_TEXT, createAccountCore, type AccountCore, type GameBridge } from '../src/sync/controller';
import type { RemoteMeta } from '../src/sync/policy';
import { BACKUP_KEY, addBackup, readBackups, readBase, readMeta, readOwner } from '../src/sync/storage';
import { AccountError, type AccountService, type AccountUser, type RemoteSave, type SyncBackend, type WriteResult } from '../src/sync/types';
import { MemoryStorage } from './memory-storage';

const SESSION = 'vszw-session';
const SAVE = 'tree-grow-save';

/** Spielstand: zu welchem Konto er gehört (null = rein lokal) und welche Aktionen er enthält. */
interface Game {
  account: string | null;
  actions: string[];
}
const encode = (g: Game): string => `G:${JSON.stringify(g)}`;
function decode(code: string | null | undefined): Game | null {
  if (!code?.startsWith('G:')) return null;
  try {
    return JSON.parse(code.slice(2)) as Game;
  } catch {
    return null;
  }
}
/** Gehen beim Ersetzen von `old` durch `next` Aktionen verloren? */
const loses = (old: Game, next: Game): boolean => old.actions.some((a) => !next.actions.includes(a));

type Fault = 'before' | 'after' | '422' | '507';

class World {
  readonly violations: string[] = [];
  readonly clouds = new Map<string, RemoteSave | null>();
  readonly sessions = new Map<string, string>();
  readonly tabs: Tab[] = [];
  /** Stände, die ersetzt wurden und dabei Aktionen verloren hätten. */
  readonly replaced: { what: string; game: Game }[] = [];
  /** Aktionen eines angehaltenen Tabs – bewusst nicht gespeichert (der Tab sagt das an). */
  readonly ephemeral = new Set<string>();
  /** Aktionen aus Sicherungen, die bei vollem Speicher dem Spielstand weichen mussten. */
  readonly sacrificed = new Set<string>();
  private readonly listeners = new Map<string, Set<(c: RemoteMeta | null) => void>>();
  private queue: (() => void)[] = [];
  fault: Fault | null = null;
  dropEvents = false;
  clock = 1_000_000;
  private seq = 0;

  constructor(readonly storage: MemoryStorage) {}

  next(prefix: string): string {
    return `${prefix}${++this.seq}`;
  }

  /** Netzfehler für den nächsten passenden Aufruf: vor dem Schreiben → wirft. */
  failBefore(write: boolean): void {
    const fault = this.fault;
    if (fault === 'before' || (write && fault === '507')) {
      this.fault = null;
      throw fault === '507' ? new AccountError('storage-full') : new Error('Netz weg');
    }
  }

  /** Schreiben auf dem Server – mit Prüfung (a) und Merken verlorener Cloud-Stände. */
  write(account: string, row: RemoteSave, insert: boolean): WriteResult {
    if (this.fault === '422') {
      this.fault = null;
      return 'outdated';
    }
    const old = this.clouds.get(account) ?? null;
    if (insert ? old !== null : !old || old.version !== row.version - 1) return 'conflict';
    const incoming = decode(row.data)!;
    if (old) {
      const before = decode(old.data)!;
      // Fremd = gehört einem anderen Konto und setzt den Stand in Y nicht fort.
      if (incoming.account !== null && incoming.account !== account && loses(before, incoming)) {
        this.violations.push(`(a) Spiel von ${incoming.account} in Cloud ${account}: ${row.data}`);
      }
      if (loses(before, incoming)) this.replaced.push({ what: `Cloud ${account}`, game: before });
    }
    // Was in der Cloud von Y liegt, gehört ab jetzt Y.
    const stored = { ...row, data: encode({ ...incoming, account }) };
    this.clouds.set(account, stored);
    for (const l of [...(this.listeners.get(account) ?? [])]) {
      // Live-Meldungen kommen später (asynchron) – oder gar nicht.
      if (!this.dropEvents) this.queue.push(() => l({ version: stored.version, actionVersion: stored.actionVersion, device: stored.device }));
    }
    if (this.fault === 'after') {
      this.fault = null;
      throw new Error('Antwort verloren');
    }
    return 'ok';
  }

  deliver(): boolean {
    const events = this.queue;
    this.queue = [];
    for (const e of events) e();
    return events.length > 0;
  }

  /** Ein anderes Gerät macht in `account` eine Aktion. */
  otherDevice(account: string): void {
    const old = this.clouds.get(account) ?? null;
    const game: Game = old ? decode(old.data)! : { account, actions: [] };
    const fault = this.fault;
    this.fault = null;
    this.write(
      account,
      {
        data: encode({ account, actions: [...game.actions, this.next(`${account}-fremd`)] }),
        version: (old?.version ?? 0) + 1,
        actionVersion: (old?.version ?? 0) + 1,
        device: 'anderes-geraet',
      },
      !old,
    );
    this.fault = fault;
  }

  subscribe(account: string, l: (c: RemoteMeta | null) => void): () => void {
    if (!this.listeners.has(account)) this.listeners.set(account, new Set());
    this.listeners.get(account)!.add(l);
    return () => this.listeners.get(account)!.delete(l);
  }

  /** Alle Aktionen, die noch irgendwo leben (Clouds, Tabs, gespeicherter Stand). */
  live(): Set<string> {
    const games = [
      ...[...this.clouds.values()].map((r) => decode(r?.data)),
      ...this.tabs.map((t) => t.game),
      decode(this.storage.getItem(SAVE)),
    ];
    return new Set(games.flatMap((g) => g?.actions ?? []));
  }

  /** Prüfung (b): Verlorenes liegt im Sicherungs-Ring. */
  checkBackups(): void {
    const live = this.live();
    const ring = readBackups(this.storage).map((e) => decode(e.code)?.actions ?? []);
    for (const { what, game } of this.replaced) {
      const missing = game.actions.filter((a) => !live.has(a) && !this.ephemeral.has(a) && !this.sacrificed.has(a));
      if (missing.length === 0) continue;
      if (!ring.some((actions) => missing.every((a) => actions.includes(a)))) {
        this.violations.push(`(b) ${what} ersetzt, ohne Sicherung verloren: ${missing.join(',')}`);
      }
    }
  }
}

/** AccountService wie http-service.ts: Sitzung im gemeinsamen Storage, Backend an sein Konto gebunden. */
function fakeService(world: World, storage: MemoryStorage): AccountService {
  const listeners: ((u: AccountUser | null) => void)[] = [];
  const session = (): { token: string; username: string } | null => {
    const raw = storage.getItem(SESSION);
    return raw ? (JSON.parse(raw) as { token: string; username: string }) : null;
  };
  const authed = (user: string): void => {
    const s = session();
    if (!s || s.username !== user) throw new AccountError('unauthorized');
    if (world.sessions.get(s.token) !== user) {
      // 401: Sitzung vergessen (nur, wenn noch genau diese gespeichert ist) und melden.
      if (session()?.token === s.token) {
        storage.removeItem(SESSION);
        for (const l of listeners) l(null);
      }
      throw new AccountError('unauthorized');
    }
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
    onUserChange: (l) => listeners.push(l),
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
          world.failBefore(false);
          const row = world.clouds.get(name) ?? null;
          return row ? { ...row } : null;
        },
        async insert(row) {
          authed(name);
          world.failBefore(true);
          return world.write(name, { data: row.data, version: 1, actionVersion: 1, device: row.device }, true);
        },
        async update(expected, row) {
          authed(name);
          world.failBefore(true);
          const old = world.clouds.get(name);
          return world.write(
            name,
            { data: row.data, version: expected + 1, actionVersion: row.actionVersion ?? old?.actionVersion ?? 0, device: row.device },
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

  constructor(readonly world: World) {
    this.game = decode(world.storage.getItem(SAVE)) ?? { account: null, actions: [] };
    const service = fakeService(world, world.storage);
    const bridge: GameBridge = {
      snapshot: () => encode(this.game),
      localProgress: () => ({ cycle: 1, lifetimeGrowth: this.game.actions.length, playSeconds: 0 }),
      progressOf: (code) => {
        const g = decode(code);
        return g ? { cycle: 1, lifetimeGrowth: g.actions.length, playSeconds: 0 } : null;
      },
      check: (code) => (decode(code) ? 'ok' : 'invalid'),
      adopt: (code) => this.replace(code, 'lokal (übernommen)'),
      notify: (text) => this.notes.push(text),
      restore: (code) => (this.replace(code, 'lokal (wiederhergestellt)') ? null : 'kaputt'),
      freeze: () => {
        this.frozen = true;
      },
      save: () => this.persist(),
    };
    this.core = createAccountCore({
      storage: world.storage,
      service,
      game: bridge,
      clock: () => world.clock,
      isActive: () => true,
      newDeviceId: () => world.next('geraet'),
      eventText: () => '',
      view: { showSignedIn() {}, showSignedOut() {}, showUnavailable() {}, showStale() {}, setStatus() {}, setBackups() {} },
    });
    service.onUserChange(() => this.core.checkSession());
  }

  private replace(code: string, what: string): boolean {
    const next = decode(code);
    if (!next) return false;
    if (loses(this.game, next)) this.world.replaced.push({ what, game: this.game });
    this.game = next;
    this.persist();
    return true;
  }

  /**
   * Wie main.ts persist(): Spielstand speichern (bei vollem Speicher weichen Sicherungen), die
   * Abgleich-Angaben nur bei Erfolg. `crash`: Absturz zwischen Spielstand und Angaben.
   */
  persist(crash = false): void {
    if (this.frozen) return;
    const raw = encode(this.game);
    const write = (): boolean => {
      try {
        this.world.storage.setItem(SAVE, raw);
        return true;
      } catch {
        return false;
      }
    };
    let ok = write();
    while (!ok) {
      // Der Spielstand geht vor: Sicherungen, die dafür weichen, sind bewusst geopfert.
      const before = readBackups(this.world.storage);
      if (!this.core.makeRoom()) break;
      const after = new Set(readBackups(this.world.storage).map((e) => e.id));
      for (const e of before) if (!after.has(e.id)) for (const a of decode(e.code)?.actions ?? []) this.world.sacrificed.add(a);
      ok = write();
    }
    if (ok && !crash) this.core.persisted(raw);
  }

  play(): void {
    const user = this.core.user?.name ?? null;
    const action = this.world.next('aktion');
    if (this.frozen) this.world.ephemeral.add(action);
    // Gespielt als das angemeldete Konto; abgemeldet bleibt das Spiel, wem es gehörte.
    this.game = { account: user ?? this.game.account, actions: [...this.game.actions, action] };
    // Wie main.ts act(): erst vormerken, dann speichern.
    this.core.markAction();
    this.persist();
  }
}

async function settle(world: World): Promise<void> {
  for (let i = 0; i < 40; i++) {
    world.deliver();
    await Promise.resolve();
  }
}

type TabOp = 'loginA' | 'loginB' | 'logout' | 'play' | 'reload' | 'reloadMid' | 'crash' | 'restore';
type GlobalOp =
  | 'cloudA'
  | 'cloudB'
  | 'newTab'
  | 'failBefore'
  | 'failAfter'
  | 'sessionLost'
  | 'outdated'
  | 'full'
  | 'dropEvents'
  | 'saveFails'
  | 'ringFails';
type Step = { op: TabOp; tab: number } | { op: GlobalOp };

const TAB_OPS: TabOp[] = ['loginA', 'loginB', 'logout', 'play', 'reload', 'reloadMid', 'crash', 'restore'];
const GLOBAL_OPS: GlobalOp[] = [
  'cloudA',
  'cloudB',
  'newTab',
  'failBefore',
  'failAfter',
  'sessionLost',
  'outdated',
  'full',
  'dropEvents',
  'saveFails',
  'ringFails',
];
const STEPS: Step[] = [...TAB_OPS.flatMap((op) => [0, 1].map((tab) => ({ op, tab }) as Step)), ...GLOBAL_OPS.map((op) => ({ op }) as Step)];

const label = (s: Step): string => ('tab' in s ? `${s.op}@${s.tab}` : s.op);

async function reload(world: World, index: number, mode: 'normal' | 'mid' | 'crash' = 'normal'): Promise<void> {
  const old = world.tabs[index]!;
  if (mode === 'mid') {
    // Mitten im Senden: Aktion, Push angestoßen – und vor der Antwort neu geladen.
    old.play();
    world.clock += 2000;
    void old.core.poll();
  }
  if (mode === 'crash') {
    // Aktion, Spielstand geschrieben – Absturz vor den Abgleich-Angaben, kein beforeunload.
    const action = world.next('aktion');
    old.game = { account: old.core.user?.name ?? old.game.account, actions: [...old.game.actions, action] };
    if (old.frozen) world.ephemeral.add(action);
    old.persist(true);
  } else {
    old.persist(); // beforeunload (angehalten: nichts)
  }
  old.core.dispose();
  const fresh = new Tab(world);
  world.tabs[index] = fresh;
  await fresh.core.start();
}

async function run(steps: Step[], cloudA: boolean, cloudB: boolean, limit = Infinity): Promise<string[]> {
  const storage = new MemoryStorage();
  storage.limit = limit;
  const world = new World(storage);
  // Rein lokaler Stand mit Fortschritt, noch nie abgeglichen.
  storage.setItem(SAVE, encode({ account: null, actions: ['lokal0'] }));
  if (cloudA) world.otherDevice('A');
  if (cloudB) world.otherDevice('B');
  world.tabs.push(new Tab(world));
  await world.tabs[0]!.core.start();
  await settle(world);
  for (const step of steps) {
    world.dropEvents = false;
    if ('tab' in step) {
      const tab = world.tabs[step.tab];
      if (!tab) continue;
      const signedOut = !tab.core.user && !tab.core.stale;
      switch (step.op) {
        case 'loginA':
        case 'loginB':
          // Das Formular gibt es nur abgemeldet (und nicht im angehaltenen Tab).
          if (signedOut) await tab.core.signIn(step.op === 'loginA' ? 'A' : 'B', 'pw').catch(() => {});
          break;
        case 'logout':
          if (tab.core.user) await tab.core.signOut(true).catch(() => {});
          break;
        case 'play':
          tab.play();
          break;
        case 'reload':
        case 'reloadMid':
        case 'crash':
          await reload(world, step.tab, step.op === 'reloadMid' ? 'mid' : step.op === 'crash' ? 'crash' : 'normal');
          break;
        case 'restore': {
          const newest = tab.core.backups()[0];
          if (newest) tab.core.restore(newest.id);
          break;
        }
      }
    } else {
      switch (step.op) {
        case 'newTab':
          if (world.tabs.length < 2) {
            const tab = new Tab(world);
            world.tabs.push(tab);
            await tab.core.start();
          }
          break;
        case 'cloudA':
        case 'cloudB':
          world.otherDevice(step.op === 'cloudA' ? 'A' : 'B');
          break;
        case 'failBefore':
          world.fault = 'before';
          break;
        case 'failAfter':
          world.fault = 'after';
          break;
        case 'outdated':
          world.fault = '422';
          break;
        case 'full':
          world.fault = '507';
          break;
        case 'sessionLost':
          world.sessions.clear();
          break;
        case 'dropEvents':
          world.dropEvents = true;
          break;
        case 'saveFails':
          // Spielstand-Schreiben scheitert einmal (Quota) – nach dem Platzmachen klappt es.
          world.storage.failNext.set(SAVE, 1);
          break;
        case 'ringFails':
          world.storage.failNext.set('vszw-backups', 1);
          break;
      }
    }
    await settle(world);
    // storage-Ereignisse in den anderen Tabs, Autosave, dann ein Takt mit fälligen Pushes.
    for (const t of world.tabs) t.core.checkSession();
    for (const t of world.tabs) t.persist();
    await settle(world);
    world.clock += 20_000;
    for (const t of world.tabs) await t.core.poll();
    await settle(world);
    world.checkBackups();
    if (world.violations.length > 0) break;
  }
  for (const t of world.tabs) t.core.dispose();
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
            if (violations.length > 0) expect(violations, `${steps.map(label).join(' → ')} (A ${cloudA}, B ${cloudB})`).toEqual([]);
          }
    }
  }, 600_000);

  it('4000 zufällige Abfolgen der Länge 8', async () => {
    const random = rng(20261021);
    for (let i = 0; i < 4000; i++) {
      const steps = Array.from({ length: 8 }, () => STEPS[Math.floor(random() * STEPS.length)]!);
      const cloudA = random() < 0.7;
      const cloudB = random() < 0.7;
      const violations = await run(steps, cloudA, cloudB);
      if (violations.length > 0) expect(violations, `${steps.map(label).join(' → ')} (A ${cloudA}, B ${cloudB})`).toEqual([]);
    }
  }, 600_000);

  it('1500 zufällige Abfolgen der Länge 8 mit knappem Speicher (Quota)', async () => {
    const random = rng(4711);
    for (let i = 0; i < 1500; i++) {
      const steps = Array.from({ length: 8 }, () => STEPS[Math.floor(random() * STEPS.length)]!);
      const limit = 900 + Math.floor(random() * 1200);
      const violations = await run(steps, true, random() < 0.7, limit);
      if (violations.length > 0) expect(violations, `${steps.map(label).join(' → ')} (Limit ${limit})`).toEqual([]);
    }
  }, 600_000);

  it('die Prüfungen schlagen an (Gegenprobe ohne Schutz)', async () => {
    // A's Spiel direkt in B's Cloud schreiben → Verstoß (a); ohne Sicherung → Verstoß (b).
    const world = new World(new MemoryStorage());
    world.otherDevice('B');
    const old = world.clouds.get('B')!;
    world.write('B', { data: encode({ account: 'A', actions: ['x'] }), version: old.version + 1, actionVersion: 9, device: 'd' }, false);
    world.checkBackups();
    expect(world.violations.some((v) => v.startsWith('(a)'))).toBe(true);
    expect(world.violations.some((v) => v.startsWith('(b)'))).toBe(true);
    // Liegt der alte Stand im Ring, ist (b) erfüllt.
    const ok = new World(new MemoryStorage());
    ok.otherDevice('B');
    const before = ok.clouds.get('B')!;
    addBackup(ok.storage, { code: before.data, owner: 'B', at: 0, reason: 'first-login-cloud', progress: null });
    ok.write('B', { data: encode({ account: 'B', actions: ['y'] }), version: before.version + 1, actionVersion: 9, device: 'd' }, false);
    ok.checkBackups();
    expect(ok.violations).toEqual([]);
  });
});

describe('Kern des Kontos: Einzelfälle', () => {
  async function setup() {
    const storage = new MemoryStorage();
    const world = new World(storage);
    storage.setItem(SAVE, encode({ account: null, actions: ['lokal0'] }));
    world.otherDevice('A');
    world.otherDevice('B');
    const tab = new Tab(world);
    world.tabs.push(tab);
    await tab.core.start();
    return { world, storage, tab };
  }

  it('abgemeldet gespielt: Grundlage des Besitzers wird „offen“, beim Wiederanmelden gesichert', async () => {
    const { world, storage, tab } = await setup();
    await tab.core.signIn('A', 'pw');
    await settle(world);
    await tab.core.signOut(true);
    expect(readBase(storage, 'A')?.pending).toBe(false);
    tab.play();
    expect(readBase(storage, 'A')?.pending).toBe(true);
    // Inzwischen macht ein anderes Gerät in A weiter → beim Anmelden wird übernommen, aber gesichert.
    world.otherDevice('A');
    const before = encode(tab.game);
    await tab.core.signIn('A', 'pw');
    await settle(world);
    expect(readBackups(storage).find((e) => e.code === before)).toMatchObject({ owner: 'A', reason: 'lost-action' });
    expect(world.violations).toEqual([]);
  });

  it('veralteter Tab: Hinweis und keine Sicherungen mehr angeboten', async () => {
    const { world, storage, tab } = await setup();
    const other = new Tab(world);
    await other.core.start();
    await other.core.signIn('B', 'pw');
    await settle(world);
    tab.core.checkSession();
    expect(tab.core.stale).toBe(true);
    expect(tab.frozen).toBe(true);
    expect(tab.notes).toContain(FROZEN_TEXT);
    expect(tab.core.backups()).toEqual([]);
    expect(readBackups(storage).length).toBeGreaterThan(0);
  });

  it('Sicherungen: angemeldet nur eigene und rein lokale, abgemeldet alle; neueste zuerst', async () => {
    const { world, storage, tab } = await setup();
    addBackup(storage, { code: encode({ account: 'B', actions: ['b'] }), owner: 'B', at: 1, reason: 'lost-action', progress: null });
    addBackup(storage, { code: encode({ account: null, actions: ['l'] }), owner: null, at: 2, reason: 'before-restore', progress: null });
    expect(tab.core.backups().map((e) => e.owner)).toEqual([null, 'B']);
    await tab.core.signIn('A', 'pw');
    await settle(world);
    const owners = tab.core.backups().map((e) => e.owner);
    expect(owners).not.toContain('B');
    expect(owners).toContain(null);
    const foreign = readBackups(storage).find((e) => e.owner === 'B')!;
    expect(tab.core.restore(foreign.id)).toBeTruthy(); // nicht angeboten → abgelehnt
  });

  it('abgemeldet wiederhergestellt: gehört der Sicherung (ohne Grundlage), Stand davor im Ring', async () => {
    const { storage, tab } = await setup();
    const current = encode(tab.game);
    const id = addBackup(storage, { code: encode({ account: 'B', actions: ['b1', 'b2'] }), owner: 'B', at: 1, reason: 'lost-action', progress: null })!;
    expect(tab.core.restore(id)).toBeNull();
    expect(tab.game.actions).toEqual(['b1', 'b2']);
    expect(readMeta(storage)).toEqual({ owner: 'B', base: null });
    expect(readBackups(storage).find((e) => e.code === current)).toMatchObject({ reason: 'before-restore', owner: null });
  });

  it('zwei abgemeldete Tabs: Wiederherstellen in einem ändert nicht, wem das Spiel des anderen gehört', async () => {
    // Ablauf aus dem Review: B, ab, A, ab; Tab 1 (A's Spiel); Tab 0 lädt B's Sicherung; Tab 1
    // speichert, lädt neu und meldet sich mit B an → B's Cloud darf nie A's Spiel bekommen.
    const { world, storage, tab } = await setup();
    world.tabs.length = 0;
    world.tabs.push(tab);
    for (const name of ['B', 'A']) {
      await tab.core.signIn(name, 'pw');
      await settle(world);
      await tab.core.signOut(true);
    }
    const second = new Tab(world);
    world.tabs.push(second);
    await second.core.start();
    expect(readOwner(storage)).toBe('A');
    const backupB = tab.core.backups().find((e) => e.owner === 'B');
    expect(backupB).toBeTruthy();
    expect(tab.core.restore(backupB!.id)).toBeNull();
    second.persist();
    expect(readOwner(storage)).toBe('A');
    await reload(world, 1);
    const reloaded = world.tabs[1]!;
    await reloaded.core.signIn('B', 'pw');
    await settle(world);
    world.checkBackups();
    expect(world.violations).toEqual([]);
    expect(decode(world.clouds.get('B')!.data)!.actions).not.toContain('A-fremd1');
  });

  it('erste Anmeldung bleibt gesichert, auch wenn danach öfter übernommen wird (Ring statt Einzel-Slot)', async () => {
    const { world, storage, tab } = await setup();
    const local0 = encode(tab.game);
    await tab.core.signIn('A', 'pw');
    await settle(world);
    for (let i = 0; i < 15; i++) {
      world.otherDevice('A');
      await reload(world, 0);
      await settle(world);
    }
    expect(readBackups(storage).some((e) => e.code === local0 && e.reason === 'first-login-local')).toBe(true);
    expect(storage.getItem(BACKUP_KEY)).toBeNull();
  });
});
