/**
 * Kern des Kontos je Tab – ohne DOM und ohne eigene Uhr (alles über `deps`), damit sich auch
 * ganze Abläufe (anmelden, abmelden, Konto wechseln, zweiter Tab, neu laden) in Vitest
 * durchspielen lassen (tests/sync-sequences.test.ts). account.ts verdrahtet ihn mit der
 * Oberfläche, dem HTTP-Dienst und den Ereignissen des Browsers.
 *
 * Grundsatz: Kein Pfad ersetzt einen lokalen oder Cloud-Stand, ohne ihn vorher zu sichern,
 * und ein Spiel, das zuletzt mit Konto X lief, landet nie in einem anderen Konto mit Stand.
 */
import { SAVE_VERSION } from '../core/state';
import { SyncEngine, type CodeCheck, type SyncHost, type SyncStatus } from './engine';
import type { Progress } from './policy';
import { SAVE_KEY } from '../core/save';
import {
  addBackup,
  backupOtherTab,
  checksum,
  dropWriterBackups,
  dropOneBackup,
  migrateLegacyBackups,
  migrateLegacyMeta,
  readBackups,
  readMeta,
  writeMeta,
  type BackupEntry,
  type LocalMeta,
} from './storage';
import { AccountError, type AccountService, type AccountUser } from './types';

/** Was der Abgleich vom Spiel braucht (main.ts). */
export interface GameBridge {
  /** Aktueller Stand als Text-Code. */
  snapshot(): string;
  localProgress(): Progress;
  /** Fortschritt eines Text-Codes; null = unlesbar. */
  progressOf(code: string): Progress | null;
  /** Ließe sich der Code importieren (oder stammt er aus einer neueren Spielversion)? */
  check(code: string): CodeCheck;
  /**
   * Text-Code übernehmen (laden, nachrechnen, anzeigen); `ageMs` = Alter nach Serverzeit
   * (fehlt = unbekannt). false = unlesbar.
   */
  adopt(code: string, ageMs?: number): boolean;
  /** Kurzer Hinweis. */
  notify(text: string): void;
  /** Gesicherten Text-Code laden (wie „Importieren“); Rückgabe: Fehlertext oder null. */
  restore(code: string): string | null;
  /**
   * Dieser Tab darf den gemeinsamen lokalen Spielstand nicht mehr schreiben (ein anderer Tab
   * spielt jetzt mit einem anderen Konto): alle Speicherungen sperren, bis neu geladen wird.
   */
  freeze(): void;
  /** Spielstand jetzt speichern (main.ts: persist → ruft danach AccountCore.persisted()). */
  save(): void;
}

/** Was der Kern an der Oberfläche anzeigt (account-panel.ts). */
export interface AccountView {
  showSignedIn(name: string): void;
  showSignedOut(): void;
  showUnavailable(): void;
  showStale(name: string): void;
  setStatus(status: SyncStatus | null): void;
  /** Angebotene Sicherungen, neueste zuerst. */
  setBackups(available: BackupEntry[]): void;
}

export interface CoreDeps {
  storage: Storage;
  service: AccountService;
  game: GameBridge;
  view: AccountView;
  clock(): number;
  /** Periodische Pushes erlaubt (sichtbarer Tab)? */
  isActive(): boolean;
  /** Neue, zufällige Geräte-Kennung – je Abgleich (Konto) eine eigene. */
  newDeviceId(): string;
  /** Hinweis „anderes Gerät“ als Text (account-view.ts). */
  eventText: (event: Parameters<SyncHost['onEvent']>[0]) => string;
}

export const RESTORE_MISSING = 'Diese Sicherung gibt es nicht (mehr).';
export const FROZEN_TEXT = 'Ein anderer Tab spielt mit einem anderen Konto – dieser Tab speichert nicht mehr. Bitte neu laden.';

/**
 * Was ein Tab tun muss, wenn sich die gemeinsame Sitzung (localStorage, alle Tabs) geändert
 * hat: 'none' – gleiches Konto; 'signed-out' – anderswo abgemeldet; 'signed-in' – anderswo
 * mit genau dem Konto angemeldet, zu dem der lokale Stand gehört (`owner`) – dann darf dieser
 * Tab mitmachen; 'stale' – anderswo mit einem anderen Konto angemeldet. Dann darf dieser Tab
 * nichts mehr senden oder speichern: Sein Spiel gehört nicht zu diesem Konto.
 */
export function sessionChange(
  current: string | null,
  stored: string | null,
  owner: string | null = null,
): 'none' | 'signed-out' | 'signed-in' | 'stale' {
  if (stored === current) return 'none';
  if (stored === null) return 'signed-out';
  if (current === null && owner !== null && stored === owner) return 'signed-in';
  return 'stale';
}

export interface AccountCore {
  /** Beim Start: gespeicherte Sitzung prüfen. */
  start(): Promise<void>;
  signIn(name: string, password: string): Promise<void>;
  register(name: string, password: string): Promise<void>;
  signOut(force: boolean): Promise<'done' | 'unsent'>;
  /** Angebotene Sicherungen (angemeldet nur die eigenen und rein lokalen), neueste zuerst. */
  backups(): BackupEntry[];
  restore(id: string): string | null;
  /**
   * Gleich wird der Spielstand gespeichert: Liegt dort der Stand eines anderen Tabs mit noch
   * nicht gesendeter Aktion, wird er vorher gesichert (backupOtherTab).
   */
  beforePersist(): void;
  /** Der Spielstand `raw` wurde eben gespeichert: Abgleich-Angaben dazu schreiben (gleicher Takt). */
  persisted(raw: string): void;
  /** Speicher voll: eine Sicherung weichen lassen, damit der Spielstand passt. false = keine mehr. */
  makeRoom(): boolean;
  /** Aktuellen Stand sichern, bevor „Spielstand löschen“ oder „Importieren“ ihn ersetzt. */
  backupCurrent(): boolean;
  /** Gemeinsame Sitzung geändert (storage-Ereignis) – auch regelmäßig aufrufen. */
  checkSession(): void;
  /** Regelmäßig (jede Sekunde): fällige Pushes, Sitzung prüfen. */
  poll(): Promise<void>;
  markAction(): void;
  flush(): Promise<void>;
  /** Tab wird geschlossen/neu geladen (Tests). */
  dispose(): void;
  readonly user: AccountUser | null;
  readonly stale: boolean;
  readonly engine: SyncEngine | null;
}

export const RESTORE_BACKUP_FAILED = 'Der aktuelle Stand ließ sich nicht sichern (Speicher voll) – nichts geändert.';

export function createAccountCore(deps: CoreDeps): AccountCore {
  const { storage, service, game, view } = deps;
  // Frühere Schlüssel einmal übernehmen (vor dem ersten Lesen).
  migrateLegacyMeta(storage);
  migrateLegacyBackups(storage, deps.clock());
  let user: AccountUser | null = null;
  let engine: SyncEngine | null = null;
  let stale = false;
  /** Erst nach der ersten Prüfung der Sitzung beim Start (currentUser) vergleichen. */
  let known = false;
  /**
   * Wem das Spiel IM SPEICHER DIESES TABS gehört und worauf es beruht. Andere Tabs können die
   * gespeicherten Angaben ändern, ohne dass sich dieser Tab ändert – für Entscheidungen zählt
   * deshalb das eigene Spiel. Geschrieben wird es nur zusammen mit dem Spielstand
   * (persisted), damit beides im localStorage immer zusammenpasst.
   */
  let memory: LocalMeta = readMeta(storage);
  /** Prüfsumme des Spielstands, den dieser Tab zuletzt gespeichert hat (beim Laden: der gespeicherte). */
  let savedHash: string | null = (() => {
    try {
      const raw = storage.getItem(SAVE_KEY);
      return raw === null ? null : checksum(raw);
    } catch {
      return null;
    }
  })();

  /**
   * Kennung dieses Tabs (je Laden der Seite neu) in den Abgleich-Angaben: Ein anderer Tab, der
   * über einen Stand mit offener Aktion speichern will, sichert ihn vorher unter dieser Kennung.
   */
  const tabId = deps.newDeviceId();

  /**
   * Abgleich-Angaben schreiben – nie aus einem angehaltenen Tab. Mit der Prüfsumme des zuletzt
   * hier gespeicherten Spielstands: Hat inzwischen ein anderer Tab gespeichert oder scheiterte
   * das Speichern, passt sie nicht, und die Grundlage gilt beim Lesen nicht.
   */
  function writeMemory(): void {
    if (stale) return;
    // Ohne neuen Spielstand (Aktion vormerken, Abmelden): Die Angaben liegen sonst über dem
    // Spielstand eines anderen Tabs, den beforePersist dann nicht mehr als fremd erkennt.
    guardOtherTab();
    writeMeta(storage, memory, savedHash, tabId);
  }

  /**
   * Liegt im gemeinsamen Speicher der Stand eines anderen Tabs mit möglicherweise noch nicht
   * gesendeter Aktion, ihn sichern, bevor dieser Tab darüber schreibt. Scheitert die Sicherung
   * (Speicher voll), wird trotzdem gespeichert: Der laufende Wald geht vor (wie beim
   * Platzmachen für den Spielstand).
   */
  function guardOtherTab(): void {
    if (!stale) backupOtherTab(storage, savedHash, deps.clock(), (code) => game.progressOf(code));
  }

  function hostFor(account: AccountUser, fresh: boolean): SyncHost {
    /** Ohne bekannte Grundlage beginnen (Spiel im Speicher kann vom gespeicherten abweichen). */
    let ignoreBase = fresh;
    return {
      clock: deps.clock,
      saveVersion: SAVE_VERSION,
      snapshot: () => game.snapshot(),
      check: (code) => game.check(code),
      localProgress: () => game.localProgress(),
      progressOf: (code) => game.progressOf(code),
      apply: (code, ageMs) => {
        // Schon vor dem Laden festhalten: Das Spiel gehört gleich diesem Konto, die Grundlage
        // ist erst nach dem Abgleich bekannt (Absturz dazwischen → wie eine erste Anmeldung).
        const previous = memory;
        memory = { owner: account.name, base: null };
        const ok = game.adopt(code, ageMs);
        if (!ok) memory = previous;
        return ok;
      },
      // Lokaler Stand gehört dem Konto, zu dem das Spiel dieses Tabs gehört.
      backup: (reason) =>
        addBackup(storage, { code: game.snapshot(), owner: memory.owner, at: deps.clock(), reason, progress: game.localProgress() }) !== null,
      backupCloud: (data) =>
        addBackup(storage, { code: data, owner: account.name, at: deps.clock(), reason: 'first-login-cloud', progress: game.progressOf(data) }) !==
        null,
      localIsForeign: () => memory.owner !== null && memory.owner !== account.name,
      isActive: deps.isActive,
      loadBase: () => (ignoreBase || memory.owner !== account.name ? null : memory.base),
      saveBase: (base) => {
        ignoreBase = false;
        memory = { owner: account.name, base };
        // Nichts mehr offen (gesendet bzw. übernommen, Verlorenes liegt dann als 'lost-action'
        // im Ring): Sicherungen, die andere Tabs von diesem Tab angelegt haben, sind überholt.
        if (!base.pending) dropWriterBackups(storage, tabId);
        // Spielstand und Angaben zusammen speichern (persisted schreibt die Angaben).
        game.save();
      },
      onStatus: (status) => view.setStatus(status),
      onEvent: (event) => game.notify(deps.eventText(event)),
    };
  }

  function stopEngine(): void {
    engine?.stop();
    engine = null;
    view.setStatus(null);
  }

  function setUser(next: AccountUser | null, fresh = false): void {
    if (stale) return;
    known = true;
    if ((next?.name ?? null) !== (user?.name ?? null)) {
      stopEngine();
      user = next;
      if (next) {
        // Je Abgleich eine neue Geräte-Kennung: Ein Cloud-Stand mit „unserer“ Kennung stammt
        // so sicher von genau diesem Abgleich (diesem Konto) – nie von einem früheren Konto.
        engine = new SyncEngine(service.backend(next), hostFor(next, fresh), deps.newDeviceId());
        void engine.start();
      }
    }
    if (next) view.showSignedIn(next.name);
    else view.showSignedOut();
    view.setBackups(backups());
  }

  function freeze(name: string): void {
    stale = true;
    // Ab jetzt nichts mehr in den gemeinsamen Spielstand schreiben – auch nicht beim
    // Neuladen (beforeunload) oder per Wiederherstellen.
    game.freeze();
    stopEngine();
    user = null;
    view.showStale(name);
    game.notify(FROZEN_TEXT);
  }

  function checkSession(): void {
    if (stale || !known) return;
    const stored = service.sessionUser();
    const change = sessionChange(user?.name ?? null, stored, memory.owner);
    if (change === 'signed-out') setUser(null);
    // Anderswo mit dem Konto angemeldet, zu dem auch das Spiel dieses Tabs gehört: mitmachen –
    // aber ohne die (vom anderen Tab geschriebene) Grundlage, also wie bei der ersten
    // Anmeldung mit Sicherungen beider Stände.
    else if (change === 'signed-in') setUser({ name: stored! }, true);
    else if (change === 'stale') freeze(stored ?? '');
  }

  /** Welche Sicherungen angeboten werden: angemeldet nur die eigenen bzw. rein lokalen. */
  function backups(): BackupEntry[] {
    if (stale) return [];
    return readBackups(storage)
      .filter((e) => !user || e.owner === null || e.owner === user.name)
      .reverse();
  }

  function restore(id: string): string | null {
    if (stale) return RESTORE_MISSING;
    const entry = backups().find((e) => e.id === id);
    if (!entry) return RESTORE_MISSING;
    // Vorher den aktuellen Stand sichern – auch das Wiederherstellen lässt sich so zurücknehmen.
    // Klappt das nicht (Speicher voll), wird nichts ersetzt.
    const saved = addBackup(storage, {
      code: game.snapshot(),
      owner: memory.owner,
      progress: game.localProgress(),
      at: deps.clock(),
      reason: 'before-restore',
    });
    if (saved === null) return RESTORE_BACKUP_FAILED;
    const previous = memory;
    // Abgemeldet: Der Stand gehört danach dem Konto der Sicherung – ohne Grundlage, also beim
    // nächsten Anmelden wie eine erste Anmeldung (mit Sicherungen beider Stände).
    if (!engine) memory = { owner: entry.owner, base: null };
    const error = game.restore(entry.code);
    if (error) {
      memory = previous;
      return error;
    }
    // Angemeldet: wie eine Spieleraktion – die anderen Geräte übernehmen den Stand.
    engine?.markAction();
    view.setBackups(backups());
    return null;
  }

  return {
    async start() {
      try {
        setUser(await service.currentUser());
      } catch {
        // Ohne Antwort nichts entscheiden (sonst hielte sich der Tab fälschlich für veraltet).
        if (!user) view.showUnavailable();
      }
    },
    async signIn(name, password) {
      if (stale) throw new AccountError('unauthorized');
      setUser(await service.signIn(name, password));
    },
    async register(name, password) {
      if (stale) throw new AccountError('unauthorized');
      setUser(await service.register(name, password));
    },
    async signOut(force) {
      // Letzten Stand noch sichern, dann abmelden; das Spiel bleibt lokal erhalten.
      await engine?.flush();
      // Ließ sich nicht alles senden (offline …): erst nachfragen.
      if (!force && engine?.hasUnsent) return 'unsent';
      // Offene Aktion bleibt für dieses Konto vermerkt (wie beim Spielen ohne Anmeldung).
      if (engine?.hasUnsent && memory.base && memory.owner === user?.name) {
        memory = { owner: memory.owner, base: { version: memory.base.version, pending: true } };
        writeMemory();
      }
      await service.signOut(user ?? undefined);
      setUser(null);
      return 'done';
    },
    backups,
    restore,
    checkSession,
    async poll() {
      // Auch ohne storage-Ereignis (z. B. verpasst): nie mit einer fremden Sitzung weiterlaufen.
      checkSession();
      await engine?.poll();
      view.setBackups(backups());
    },
    markAction() {
      if (stale) return;
      // Angemeldet und abgeglichen: Der Abgleich merkt die Aktion vor (saveBase).
      engine?.markAction();
      // Abgemeldet oder noch nicht abgeglichen (z. B. offline neu geladen): die Änderung für das
      // Konto des Stands vormerken – beim nächsten Abgleich wird sie gesendet bzw. vor dem
      // Übernehmen gesichert, und andere Tabs sichern den Stand, bevor sie darüber speichern.
      if (memory.base && !memory.base.pending) {
        memory = { owner: memory.owner, base: { version: memory.base.version, pending: true } };
        writeMemory();
      }
    },
    beforePersist: guardOtherTab,
    persisted(raw) {
      savedHash = checksum(raw);
      if (!stale) writeMeta(storage, memory, savedHash, tabId);
    },
    makeRoom: () => dropOneBackup(storage),
    backupCurrent() {
      if (stale) return false;
      return (
        addBackup(storage, { code: game.snapshot(), owner: memory.owner, at: deps.clock(), reason: 'before-replace', progress: game.localProgress() }) !==
        null
      );
    },
    flush: () => engine?.flush() ?? Promise.resolve(),
    dispose() {
      engine?.stop();
      engine = null;
    },
    get user() {
      return user;
    },
    get stale() {
      return stale;
    },
    get engine() {
      return engine;
    },
  };
}
