/**
 * Verdrahtung des Kontos (wie main.ts, nur für den Abgleich): Abschnitt „Konto“ in den
 * Einstellungen, Anmeldung beim Sync-Server, je angemeldetem Konto ein SyncEngine.
 * Wird von main.ts nur geladen (dynamic import), wenn VITE_SYNC_URL gesetzt ist.
 */
import { createAccountPanel } from '../ui/account-panel';
import { isSyncProblem, syncEventText, syncStatusText } from '../ui/account-view';
import { createAccountCore, sessionChange, type AccountCore, type GameBridge } from './controller';
import type { SyncStatus } from './engine';
import { SESSION_KEY, createHttpService } from './http-service';
import { deviceId } from './storage';

/** So oft prüft der Abgleich, ob ein Push fällig ist (und die Statuszeile läuft weiter). */
const POLL_MS = 1000;

export type { GameBridge };
export { sessionChange };

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
  /** Gleich wird der Spielstand gespeichert (main.ts persist). */
  beforePersist(): void;
  /** Der Spielstand `raw` wurde eben gespeichert (main.ts persist). */
  persisted(raw: string): void;
  /** Speicher voll: eine Sicherung weichen lassen. false = keine mehr. */
  makeRoom(): boolean;
  /** Aktuellen Stand sichern (vor „Spielstand löschen“ bzw. „Importieren“). */
  backupCurrent(): void;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `d${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 32).padEnd(8, '0');
}

export function startAccount(options: AccountOptions): AccountController {
  const { game } = options;
  const storage = window.localStorage;
  // Gerät + je Abgleich neuer Zusatz: zwei Tabs (und zwei Konten nacheinander in einem Tab)
  // sind für den Abgleich verschiedene Geräte.
  const deviceBase = deviceId(storage, randomId);
  let status: SyncStatus | null = null;
  let core: AccountCore | null = null;

  const panel = createAccountPanel({
    onSignIn: (name, password) => core!.signIn(name, password),
    onRegister: (name, password) => core!.register(name, password),
    backups: () => core?.backups() ?? [],
    onRestore: (id) => core?.restore(id) ?? null,
    onSignOut: (force) => core!.signOut(force),
  });
  options.mount(panel.element);

  function renderSync(): void {
    if (status && core?.user) panel.setSync(syncStatusText(status, Date.now()), isSyncProblem(status) ? 'bad' : 'neutral');
  }

  const service = createHttpService(options.url, {
    fetch: window.fetch.bind(window),
    storage,
    EventSource: typeof window.EventSource === 'function' ? window.EventSource : undefined,
  });
  core = createAccountCore({
    storage,
    service,
    game,
    clock: () => Date.now(),
    isActive: () => document.visibilityState === 'visible',
    newDeviceId: () => `${deviceBase}-${randomId().slice(0, 8)}`,
    eventText: syncEventText,
    view: {
      showSignedIn: (name) => panel.showSignedIn(name),
      showSignedOut: () => panel.showSignedOut(),
      showUnavailable: () => panel.showUnavailable(),
      showStale: (name) => panel.showStale(name),
      setBackups: (available) => panel.setBackups(available),
      setStatus: (next) => {
        status = next;
        renderSync();
      },
    },
  });
  // Sitzung abgelaufen (401) → wie abgemeldet.
  service.onUserChange(() => core?.checkSession());
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_KEY || event.key === null) core?.checkSession();
  });
  void core.start();

  setInterval(() => {
    void core?.poll();
    renderSync();
  }, POLL_MS);

  return {
    markAction: () => core?.markAction(),
    flush: () => void core?.flush(),
    beforePersist: () => void core?.beforePersist(),
    persisted: (raw) => core?.persisted(raw),
    makeRoom: () => core?.makeRoom() ?? false,
    backupCurrent: () => void core?.backupCurrent(),
  };
}
