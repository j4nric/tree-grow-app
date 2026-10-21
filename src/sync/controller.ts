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
import {
  BACKUP_KEY,
  CLOUD_BACKUP_KEY,
  RESTORE_UNDO_KEY,
  markPending,
  readBackup,
  readBase,
  readOwner,
  writeBackup,
  writeBase,
  writeOwner,
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
}

export type BackupKind = 'local' | 'cloud' | 'undo';

/** Angebotene Sicherung: false = keine (oder nicht für dieses Konto); sonst ihr Konto (null = rein lokal). */
export type BackupOffer = false | { owner: string | null };

export type BackupAvailability = Record<BackupKind, BackupOffer>;

/** Was der Kern an der Oberfläche anzeigt (account-panel.ts). */
export interface AccountView {
  showSignedIn(name: string): void;
  showSignedOut(): void;
  showUnavailable(): void;
  showStale(name: string): void;
  setStatus(status: SyncStatus | null): void;
  setBackups(available: BackupAvailability): void;
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

const RESTORE_KEYS: Record<BackupKind, string> = { local: BACKUP_KEY, cloud: CLOUD_BACKUP_KEY, undo: RESTORE_UNDO_KEY };

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
  backups(): BackupAvailability;
  restore(kind: BackupKind): string | null;
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

export function createAccountCore(deps: CoreDeps): AccountCore {
  const { storage, service, game, view } = deps;
  let user: AccountUser | null = null;
  let engine: SyncEngine | null = null;
  let stale = false;
  /** Erst nach der ersten Prüfung der Sitzung beim Start (currentUser) vergleichen. */
  let known = false;
  /**
   * Zu welchem Konto das Spiel IM SPEICHER DIESES TABS gehört. Der gemeinsame Besitzer im
   * localStorage kann sich durch andere Tabs ändern, ohne dass sich dieser Tab ändert – für
   * Entscheidungen zählt deshalb, wem das eigene Spiel gehört (beim Laden der Seite der
   * gespeicherte Besitzer, danach: erfolgreicher Abgleich, Wiederherstellen).
   */
  let memoryOwner = readOwner(storage);

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
      apply: (code, ageMs) => game.adopt(code, ageMs),
      // Lokaler Stand gehört dem Konto, mit dem er zuletzt abgeglichen wurde.
      backup: () => writeBackup(storage, game.snapshot(), BACKUP_KEY, memoryOwner),
      backupCloud: (data) => writeBackup(storage, data, CLOUD_BACKUP_KEY, account.name),
      localIsForeign: () => memoryOwner !== null && memoryOwner !== account.name,
      isActive: deps.isActive,
      loadBase: () => (ignoreBase || memoryOwner !== account.name ? null : readBase(storage, account.name)),
      saveBase: (base) => {
        ignoreBase = false;
        memoryOwner = account.name;
        writeBase(storage, account.name, base);
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
    const change = sessionChange(user?.name ?? null, stored, memoryOwner);
    if (change === 'signed-out') setUser(null);
    // Anderswo mit dem Konto angemeldet, zu dem auch das Spiel dieses Tabs gehört: mitmachen –
    // aber ohne die (vom anderen Tab geschriebene) Grundlage, also wie bei der ersten
    // Anmeldung mit Sicherungen beider Stände.
    else if (change === 'signed-in') setUser({ name: stored! }, true);
    else if (change === 'stale') freeze(stored ?? '');
  }

  /** Welche Sicherungen angeboten werden: angemeldet nur die eigenen bzw. rein lokalen. */
  function backups(): BackupAvailability {
    const offer = (kind: BackupKind): BackupOffer => {
      if (stale) return false;
      const backup = readBackup(storage, RESTORE_KEYS[kind]);
      if (!backup) return false;
      if (user && backup.owner !== null && backup.owner !== user.name) return false;
      return { owner: backup.owner };
    };
    return { local: offer('local'), cloud: offer('cloud'), undo: offer('undo') };
  }

  function restore(kind: BackupKind): string | null {
    const offer = backups()[kind];
    if (!offer) return RESTORE_MISSING;
    const backup = readBackup(storage, RESTORE_KEYS[kind]);
    if (!backup) return RESTORE_MISSING;
    // Vorher den aktuellen Stand sichern – auch das Wiederherstellen lässt sich so zurücknehmen.
    const current = game.snapshot();
    const currentOwner = memoryOwner;
    const error = game.restore(backup.code);
    if (error) return error;
    writeBackup(storage, current, RESTORE_UNDO_KEY, currentOwner);
    if (engine && user) {
      // Angemeldet: wie eine Spieleraktion – die anderen Geräte übernehmen den Stand.
      engine.markAction();
    } else {
      // Abgemeldet: Der lokale Stand gehört jetzt dem Konto der Sicherung (bzw. keinem).
      memoryOwner = backup.owner;
      writeOwner(storage, backup.owner);
      markPending(storage);
    }
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
      // Offene Aktion bleibt für dieses Konto vermerkt (Grundlage pending).
      if (engine?.hasUnsent) markPending(storage);
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
      // Ohne Abgleich (abgemeldet): die Änderung für das Konto des lokalen Stands vormerken.
      if (engine) engine.markAction();
      else if (memoryOwner !== null && memoryOwner === readOwner(storage)) markPending(storage);
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
