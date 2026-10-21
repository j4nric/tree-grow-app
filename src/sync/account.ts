/**
 * Verdrahtung des Kontos (wie main.ts, nur für den Abgleich): Abschnitt „Konto“ in den
 * Einstellungen, Anmeldung beim Sync-Server, je angemeldetem Konto ein SyncEngine.
 * Wird von main.ts nur geladen (dynamic import), wenn VITE_SYNC_URL gesetzt ist.
 */
import { createAccountPanel, type BackupAvailability } from '../ui/account-panel';
import { isSyncProblem, syncEventText, syncStatusText } from '../ui/account-view';
import { SAVE_VERSION } from '../core/state';
import { createHttpService } from './http-service';
import { SyncEngine, type CodeCheck, type SyncHost, type SyncStatus } from './engine';
import type { Progress } from './policy';
import { SESSION_KEY } from './http-service';
import {
  BACKUP_KEY,
  CLOUD_BACKUP_KEY,
  RESTORE_UNDO_KEY,
  deviceId,
  readBase,
  readCloudBackupOwner,
  readOwner,
  writeBackup,
  writeBase,
  writeCloudBackup,
} from './storage';
import { AccountError, type AccountService, type AccountUser } from './types';

const RESTORE_KEYS = { local: BACKUP_KEY, cloud: CLOUD_BACKUP_KEY, undo: RESTORE_UNDO_KEY } as const;

const RESTORE_MISSING = 'Diese Sicherung gibt es nicht (mehr).';

/** So oft prüft der Abgleich, ob ein Push fällig ist (und die Statuszeile läuft weiter). */
const POLL_MS = 1000;

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

/**
 * Was ein Tab tun muss, wenn sich die gemeinsame Sitzung (localStorage, alle Tabs) geändert
 * hat: 'none' – gleiches Konto; 'signed-out' – anderswo abgemeldet; 'stale' – anderswo mit
 * einem (anderen) Konto angemeldet. Dann darf dieser Tab nichts mehr senden: Sein Spiel im
 * Speicher gehört nicht zu diesem Konto → Abgleich anhalten, zum Neuladen auffordern.
 */
export function sessionChange(current: string | null, stored: string | null): 'none' | 'signed-out' | 'stale' {
  if (stored === current) return 'none';
  return stored === null ? 'signed-out' : 'stale';
}

export interface AccountOptions {
  /** Adresse des Sync-Servers (VITE_SYNC_URL). */
  url: string;
  game: GameBridge;
  /** Hängt den Abschnitt „Konto“ in die Einstellungen. */
  mount(section: HTMLElement): void;
}

export interface AccountController {
  /** Nach jeder erfolgreichen Spieleraktion aufrufen. */
  markAction(): void;
  /** Sofort pushen (Seite wird verborgen oder verlassen). */
  flush(): void;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `d${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 32).padEnd(8, '0');
}

export function startAccount(options: AccountOptions): AccountController {
  const { game } = options;
  const storage = window.localStorage;
  // Je Tab eigene Kennung: zwei Tabs desselben Browsers sind für den Abgleich zwei Geräte.
  const device = `${deviceId(storage, randomId)}-${randomId().slice(0, 8)}`;
  let service: AccountService | null = null;
  let user: AccountUser | null = null;
  let engine: SyncEngine | null = null;
  let status: SyncStatus | null = null;
  /** Ein anderer Tab spielt mit einem anderen Konto: dieser Tab ist angehalten (bis neu geladen). */
  let stale = false;
  /** Erst nach der ersten Prüfung der Sitzung beim Start (currentUser) vergleichen. */
  let known = false;

  const panel = createAccountPanel({
    onSignIn: async (name, password) => {
      if (!service) throw new AccountError('network');
      setUser(await service.signIn(name, password));
    },
    onRegister: async (name, password) => {
      if (!service) throw new AccountError('network');
      setUser(await service.register(name, password));
    },
    backups: availableBackups,
    onRestore: (kind) => {
      if (stale) return RESTORE_MISSING;
      if (!availableBackups()[kind]) return RESTORE_MISSING;
      let code: string | null = null;
      try {
        code = storage.getItem(RESTORE_KEYS[kind]);
      } catch {
        code = null;
      }
      if (!code) return RESTORE_MISSING;
      // Vorher den aktuellen Stand sichern – auch das Wiederherstellen lässt sich so zurücknehmen.
      const current = game.snapshot();
      const error = game.restore(code);
      if (error) return error;
      writeBackup(storage, current, RESTORE_UNDO_KEY);
      // Bewusst geladen: wie eine Spieleraktion – die anderen Geräte übernehmen den Stand.
      engine?.markAction();
      return null;
    },
    onSignOut: async (force) => {
      if (!service) return 'done';
      // Letzten Stand noch sichern, dann abmelden; das Spiel bleibt lokal erhalten.
      await engine?.flush();
      // Ließ sich nicht alles senden (offline …): erst nachfragen.
      if (!force && engine?.hasUnsent) return 'unsent';
      await service.signOut(user ?? undefined);
      setUser(null);
      return 'done';
    },
  });
  options.mount(panel.element);

  function renderSync(): void {
    if (status && user) panel.setSync(syncStatusText(status, Date.now()), isSyncProblem(status) ? 'bad' : 'neutral');
  }

  function hostFor(account: AccountUser): SyncHost {
    return {
      clock: () => Date.now(),
      saveVersion: SAVE_VERSION,
      snapshot: game.snapshot,
      check: game.check,
      localProgress: game.localProgress,
      progressOf: game.progressOf,
      apply: game.adopt,
      backup: () => writeBackup(storage, game.snapshot()),
      backupCloud: (data) => writeCloudBackup(storage, data, account.name),
      localIsForeign: () => {
        const owner = readOwner(storage);
        return owner !== null && owner !== account.name;
      },
      isActive: () => document.visibilityState === 'visible',
      loadBase: () => readBase(storage, account.name),
      saveBase: (base) => writeBase(storage, account.name, base),
      onStatus: (next) => {
        status = next;
        renderSync();
      },
      onEvent: (event) => game.notify(syncEventText(event)),
    };
  }

  /** Welche Sicherungen angeboten werden: die Cloud-Sicherung nur dem Konto, aus dem sie stammt. */
  function availableBackups(): BackupAvailability {
    if (stale) return { local: false, cloud: false, undo: false };
    return {
      local: hasItem(BACKUP_KEY),
      cloud: hasItem(CLOUD_BACKUP_KEY) && user !== null && readCloudBackupOwner(storage) === user.name,
      undo: hasItem(RESTORE_UNDO_KEY),
    };
  }

  function hasItem(key: string): boolean {
    try {
      return !!storage.getItem(key);
    } catch {
      return false;
    }
  }

  /** Sitzung von einem anderen Tab geändert? Dann anhalten bzw. abmelden. */
  function checkSession(): void {
    if (!service || stale || !known) return;
    const change = sessionChange(user?.name ?? null, service.sessionUser());
    if (change === 'signed-out') setUser(null);
    else if (change === 'stale') {
      stale = true;
      // Ab jetzt nichts mehr in den gemeinsamen Spielstand schreiben – auch nicht beim
      // Neuladen (beforeunload) oder per Wiederherstellen.
      game.freeze();
      engine?.stop();
      engine = null;
      status = null;
      user = null;
      panel.showStale(service.sessionUser() ?? '');
    }
  }

  function setUser(next: AccountUser | null): void {
    if (!service || stale) return;
    known = true;
    if ((next?.name ?? null) !== (user?.name ?? null)) {
      engine?.stop();
      engine = null;
      status = null;
      user = next;
      if (next) {
        engine = new SyncEngine(service.backend(next), hostFor(next), device);
        void engine.start();
      }
    }
    if (next) panel.showSignedIn(next.name);
    else panel.showSignedOut();
    renderSync();
  }

  service = createHttpService(options.url, {
    fetch: window.fetch.bind(window),
    storage,
    EventSource: typeof window.EventSource === 'function' ? window.EventSource : undefined,
  });
  service.onUserChange(setUser);
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_KEY || event.key === null) checkSession();
  });
  service
    .currentUser()
    .then(setUser)
    .catch(() => {
      known = true;
      if (!user) panel.showUnavailable();
    });

  setInterval(() => {
    // Auch ohne storage-Ereignis (z. B. verpasst): nie mit einer fremden Sitzung weiterlaufen.
    checkSession();
    void engine?.poll();
    renderSync();
    panel.setBackups(availableBackups());
  }, POLL_MS);

  return {
    markAction: () => engine?.markAction(),
    flush: () => void engine?.flush(),
  };
}
