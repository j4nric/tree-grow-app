/**
 * Verdrahtung des Kontos (wie main.ts, nur für den Abgleich): Abschnitt „Konto“ in den
 * Einstellungen, Anmeldung beim Sync-Server, je angemeldetem Konto ein SyncEngine.
 * Wird von main.ts nur geladen (dynamic import), wenn VITE_SYNC_URL gesetzt ist.
 */
import { createAccountPanel } from '../ui/account-panel';
import { isSyncProblem, syncEventText, syncStatusText } from '../ui/account-view';
import { SAVE_VERSION } from '../core/state';
import { createHttpService } from './http-service';
import { SyncEngine, type CodeCheck, type SyncHost, type SyncStatus } from './engine';
import type { Progress } from './policy';
import { CLOUD_BACKUP_KEY, deviceId, readBase, readOwner, writeBackup, writeBase } from './storage';
import { AccountError, type AccountService, type AccountUser } from './types';

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

  const panel = createAccountPanel({
    onSignIn: async (name, password) => {
      if (!service) throw new AccountError('network');
      setUser(await service.signIn(name, password));
    },
    onRegister: async (name, password) => {
      if (!service) throw new AccountError('network');
      setUser(await service.register(name, password));
    },
    onSignOut: async (force) => {
      if (!service) return 'done';
      // Letzten Stand noch sichern, dann abmelden; das Spiel bleibt lokal erhalten.
      await engine?.flush();
      // Ließ sich nicht alles senden (offline …): erst nachfragen.
      if (!force && engine?.hasUnsent) return 'unsent';
      await service.signOut();
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
      backupCloud: (data) => writeBackup(storage, data, CLOUD_BACKUP_KEY),
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

  function setUser(next: AccountUser | null): void {
    if (!service) return;
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
  service
    .currentUser()
    .then(setUser)
    .catch(() => {
      if (!user) panel.showUnavailable();
    });

  setInterval(() => {
    void engine?.poll();
    renderSync();
  }, POLL_MS);

  return {
    markAction: () => engine?.markAction(),
    flush: () => void engine?.flush(),
  };
}
