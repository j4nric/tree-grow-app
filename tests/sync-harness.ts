// Prüfstand für den Konto-Abgleich (Fake-Server, gemeinsamer Fake-localStorage, echter Kern):
// World, Tab, Abfolgen und ihre Prüfungen (a)–(d). Beschreibung der Prüfungen und die Tests
// selbst: tests/sync-sequences.test.ts. Unverändert dorther ausgelagert, damit die vollständige
// Aufzählung „Länge 4“ auf mehrere Testdateien verteilt werden kann (tests/sync-same4-*.test.ts):
// Vitest führt Dateien parallel aus, Tests innerhalb einer Datei nacheinander.
import { createAccountCore, type AccountCore, type GameBridge } from '../src/sync/controller';
import type { RemoteMeta } from '../src/sync/policy';
import { MAX_BACKUPS, addBackup, readBackups, type BackupEntry } from '../src/sync/storage';
import { AccountError, type AccountService, type AccountUser, type RemoteSave, type SyncBackend, type WriteResult } from '../src/sync/types';
import { MemoryStorage } from './memory-storage';

const SESSION = 'vszw-session';
export const SAVE = 'tree-grow-save';

/** Spielstand: zu welchem Konto er gehört (null = rein lokal) und welche Aktionen er enthält. */
export interface Game {
  account: string | null;
  actions: string[];
}
export const encode = (g: Game): string => `G:${JSON.stringify(g)}`;
export function decode(code: string | null | undefined): Game | null {
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

export class World {
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
  /** Jede Aktion, die je gemacht wurde (Tabs und andere Geräte) – für Prüfung (c). */
  readonly made = new Set<string>();
  fault: Fault | null = null;
  /** Dauerhaft offline (bis zurückgesetzt): jeder Aufruf scheitert vor dem Server. */
  offline = false;
  dropEvents = false;
  clock = 1_000_000;
  private seq = 0;

  constructor(readonly storage: MemoryStorage) {}

  next(prefix: string): string {
    return `${prefix}${++this.seq}`;
  }

  /** Netzfehler für den nächsten passenden Aufruf: vor dem Schreiben → wirft. */
  failBefore(write: boolean): void {
    if (this.offline) throw new Error('offline');
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
    const action = this.next(`${account}-fremd`);
    this.made.add(action);
    this.write(
      account,
      {
        data: encode({ account, actions: [...game.actions, action] }),
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

  /**
   * Prüfung (c): Keine Aktion, die je gemacht wurde, verschwindet – sie lebt noch (Cloud,
   * Speicher eines offenen Tabs, gespeicherter Stand) oder liegt im Sicherungs-Ring.
   */
  checkMade(): void {
    const live = this.live();
    const ring = new Set(readBackups(this.storage).flatMap((e) => decode(e.code)?.actions ?? []));
    const missing = [...this.made].filter((a) => !live.has(a) && !ring.has(a) && !this.ephemeral.has(a) && !this.sacrificed.has(a));
    if (missing.length > 0) this.violations.push(`(c) Aktion verloren (weder Cloud noch Tab noch Ring): ${missing.join(',')}`);
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
export class Tab {
  game: Game;
  frozen = false;
  /** Zuletzt in der Oberfläche angebotene Sicherungen. */
  shown: BackupEntry[] = [];
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
      view: { showSignedIn() {}, showSignedOut() {}, showUnavailable() {}, showStale() {}, setStatus() {}, setBackups: (b) => (this.shown = b) },
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
    // Ließ sich der Stand eines anderen Tabs nicht sichern (Ring voll mit Wichtigerem), wird
    // trotzdem gespeichert – seine Aktionen sind dann bewusst geopfert.
    if (!this.core.beforePersist()) {
      for (const a of decode(this.world.storage.getItem(SAVE))?.actions ?? []) if (!this.game.actions.includes(a)) this.world.sacrificed.add(a);
    }
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
    this.world.made.add(action);
    if (this.frozen) this.world.ephemeral.add(action);
    // Gespielt als das angemeldete Konto; abgemeldet bleibt das Spiel, wem es gehörte.
    this.game = { account: user ?? this.game.account, actions: [...this.game.actions, action] };
    // Wie main.ts act(): erst vormerken, dann speichern.
    this.core.markAction();
    this.persist();
  }
}

export async function settle(world: World): Promise<void> {
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
export const STEPS: Step[] = [...TAB_OPS.flatMap((op) => [0, 1].map((tab) => ({ op, tab }) as Step)), ...GLOBAL_OPS.map((op) => ({ op }) as Step)];

export const label = (s: Step): string => ('tab' in s ? `${s.op}@${s.tab}` : s.op);

export async function reload(world: World, index: number, mode: 'normal' | 'mid' | 'crash' = 'normal'): Promise<void> {
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
    world.made.add(action);
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

export async function run(steps: Step[], cloudA: boolean, cloudB: boolean, limit = Infinity): Promise<string[]> {
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
export function rng(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}

// ---------------------------------------------------------------------------------------
// Zwei Tabs mit DEMSELBEN Konto: ein gemeinsamer Spielstand und eine gemeinsame Grundlage im
// localStorage, aber jeder Tab hat Spiel und Abgleich im eigenen Speicher. Hier gibt es keinen
// Autosave je Takt – Spielen, Speichern, Senden, Schließen und Öffnen sind einzelne Schritte,
// damit sich alles beliebig verschränken lässt. Geprüft wird zusätzlich (c): Keine je gemachte
// Aktion verschwindet, ohne in einer Cloud, einem offenen Tab, dem gespeicherten Stand oder im
// Ring zu liegen.
// ---------------------------------------------------------------------------------------

type SameTabOp = 'play' | 'save' | 'push' | 'close' | 'open' | 'reload' | 'crash';
type SameGlobalOp = 'cloudA' | 'offline' | 'online' | 'failAfter' | 'dropEvents' | 'deliver' | 'fillRing';
export type SameStep = { op: SameTabOp; tab: number } | { op: SameGlobalOp };
const SAME_TAB_OPS: SameTabOp[] = ['play', 'save', 'push', 'close', 'open', 'reload', 'crash'];
const SAME_GLOBAL_OPS: SameGlobalOp[] = ['cloudA', 'offline', 'online', 'failAfter', 'dropEvents', 'deliver', 'fillRing'];
export const SAME_STEPS: SameStep[] = [
  ...SAME_TAB_OPS.flatMap((op) => [0, 1].map((tab) => ({ op, tab }) as SameStep)),
  ...SAME_GLOBAL_OPS.map((op) => ({ op }) as SameStep),
];
export const sameLabel = (s: SameStep): string => ('tab' in s ? `${s.op}@${s.tab}` : s.op);

export async function runSameAccount(steps: SameStep[], trace?: (step: string, world: World) => void): Promise<string[]> {
  const storage = new MemoryStorage();
  const world = new World(storage);
  storage.setItem(SAVE, encode({ account: null, actions: ['lokal0'] }));
  world.made.add('lokal0');
  world.otherDevice('A');
  const slots: (Tab | null)[] = [null, null];
  const sync = (): void => {
    world.tabs.length = 0;
    for (const t of slots) if (t) world.tabs.push(t);
  };
  const open = async (index: number): Promise<void> => {
    const tab = new Tab(world);
    slots[index] = tab;
    sync();
    await tab.core.start();
  };
  await open(0);
  await slots[0]!.core.signIn('A', 'pw');
  await settle(world);
  await open(1);
  await settle(world);
  // Ohne Zwischenschritte zu Ende spielen lassen (Mikrotasks), Live-Meldungen nur auf Wunsch.
  const flushTasks = async (): Promise<void> => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  };
  for (const step of steps) {
    const ringBefore = readBackups(storage);
    if ('tab' in step) {
      const tab = slots[step.tab];
      if (step.op === 'open') {
        if (!tab) await open(step.tab);
      } else if (tab) {
        switch (step.op) {
          case 'play':
            tab.play();
            break;
          case 'save':
            tab.persist();
            break;
          case 'push':
            world.clock += 2000;
            await tab.core.poll();
            break;
          case 'close':
            // beforeunload: speichern und noch einmal senden (Antwort kommt evtl. nie an).
            tab.persist();
            void tab.core.flush();
            tab.core.dispose();
            slots[step.tab] = null;
            sync();
            break;
          case 'reload':
          case 'crash': {
            const index = world.tabs.indexOf(tab);
            await reload(world, index, step.op === 'crash' ? 'crash' : 'normal');
            slots[step.tab] = world.tabs[index]!;
            break;
          }
        }
      }
    } else {
      switch (step.op) {
        case 'cloudA':
          world.otherDevice('A');
          break;
        case 'offline':
          world.offline = true;
          break;
        case 'online':
          world.offline = false;
          break;
        case 'failAfter':
          world.fault = 'after';
          break;
        case 'dropEvents':
          world.dropEvents = !world.dropEvents;
          break;
        case 'deliver':
          world.deliver();
          break;
        case 'fillRing':
          // Alte, wichtige Sicherungen (überholte Aktionen anderer Geräte) füllen den Ring.
          for (let i = 0; i < 8; i++) {
            addBackup(storage, { code: encode({ account: 'A', actions: [world.next('alt')] }), owner: 'A', at: i, reason: 'lost-action', progress: null });
          }
          break;
      }
    }
    await flushTasks();
    // Andere Tabs bemerken Sitzungsänderungen (storage-Ereignis).
    for (const t of world.tabs) t.core.checkSession();
    trace?.(sameLabel(step), world);
    checkEvictions(world, ringBefore, readBackups(storage));
    world.checkBackups();
    world.checkMade();
    if (world.violations.length > 0) break;
  }
  for (const t of world.tabs) t.core.dispose();
  return world.violations;
}

/**
 * Was zwischen zwei Prüfungen aus dem Ring verschwand: (d) Eine wichtige Sicherung (Priorität 2,
 * z. B. überholte Aktion) darf nie weichen, solange unwichtigere ('other-tab', Sicherheitsnetz)
 * im Ring liegen. Verdrängte Sicherungen (Ring voll, ältere weichen – so gewollt) zählen für (c)
 * als geopfert; entfernte 'other-tab'-Sicherungen bei nicht vollem Ring sind aufgeräumt und
 * bleiben in (c) geprüft (ihre Aktionen müssen dann in der Cloud bzw. einem Tab sein).
 */
function checkEvictions(world: World, before: BackupEntry[], after: BackupEntry[]): void {
  const kept = new Set(after.map((e) => e.id));
  const removed = before.filter((e) => !kept.has(e.id));
  // Bewusst ohne backupPriority: Die Erwartung steht hier fest, nicht in der geprüften Regel.
  const unimportant = new Set<BackupEntry['reason']>(['other-tab', 'before-take', 'legacy']);
  const weaker = after.some((e) => unimportant.has(e.reason));
  for (const e of removed) {
    if (!unimportant.has(e.reason) && weaker) world.violations.push(`(d) wichtige Sicherung verdrängt, obwohl unwichtigere da sind: ${e.code}`);
    if (e.reason !== 'other-tab' || after.length >= MAX_BACKUPS) {
      for (const a of decode(e.code)?.actions ?? []) world.sacrificed.add(a);
    }
  }
}

/** Auf so viele Dateien ist „Länge 4 vollständig“ verteilt: tests/sync-same4-1.test.ts bis -3. */
export const SAME4_PARTS = 3;

/**
 * Teil `part` (0-basiert) der vollständigen Aufzählung aller Abfolgen der Länge 4 aus
 * SAME_STEPS: alle Abfolgen, deren erster Schritt den Index i mit i % SAME4_PARTS === part hat.
 * Alle Teile zusammen ergeben jede Abfolge genau einmal (geprüft in sync-sequences.test.ts).
 */
export function* sameLength4(part: number): Generator<SameStep[]> {
  for (const [i, a] of SAME_STEPS.entries()) {
    if (i % SAME4_PARTS !== part) continue;
    for (const b of SAME_STEPS) for (const c of SAME_STEPS) for (const d of SAME_STEPS) yield [a, b, c, d];
  }
}

/** Läuft einen Teil von „Länge 4 vollständig“ und liefert die ersten (höchstens 5) Verstöße. */
export async function runSameLength4(part: number): Promise<string[]> {
  const failures: string[] = [];
  for (const steps of sameLength4(part)) {
    const violations = await runSameAccount(steps);
    if (violations.length > 0 && failures.length < 5) failures.push(`${steps.map(sameLabel).join(' → ')}: ${violations.join('; ')}`);
  }
  return failures;
}