/**
 * Installierbare App: Service Worker anmelden (nur im Produktions-Build) und Hinweise zeigen,
 * sobald eine neue Version bereitliegt („Neue Version verfügbar – neu laden“) oder ein
 * anderer Tab sie aktiviert hat („Neue Version aktiv – bitte neu laden“). Der Service Worker
 * selbst entsteht beim Bauen aus src/pwa/service-worker.ts.
 *
 * Nicht in Entwicklung und nicht in automatisierten Browsern (e2e), außer ein Test setzt
 * vor dem Laden `window.__VSZW_SW__ = true` – sonst blieben alte Builds im Cache hängen.
 * Mit VSZW_SW_KILL=1 gebaut (Not-Aus, README): keinen anmelden, vorhandene abmelden.
 */

/** Text des Hinweises vor dem Knopf „neu laden“ (geschütztes Leerzeichen: Strich bricht nie allein um). */
export const UPDATE_TEXT = 'Neue Version verfügbar –';
export const UPDATE_BUTTON = 'neu laden';
/** In anderen Tabs, wenn ein Tab die neue Version aktiviert hat (danach der Knopf „neu laden“). */
export const ACTIVE_TEXT = 'Neue Version aktiv – bitte';
/** Wenn der neue Service Worker nicht übernimmt (z. B. Fehler): trotzdem neu laden. */
const RELOAD_FALLBACK_MS = 3000;
/** Höchstens so lange auf das Senden an den Sync-Server warten, bevor neu geladen wird. */
export const FLUSH_WAIT_MS = 1000;

export interface PwaEnv {
  /** `'serviceWorker' in navigator` (fehlt z. B. ohne HTTPS). */
  supported: boolean;
  /** import.meta.env.PROD */
  prod: boolean;
  /** navigator.webdriver – Playwright & Co. */
  webdriver: boolean;
  /** window.__VSZW_SW__ (Test schaltet den Service Worker bewusst ein). */
  optIn: unknown;
}

/** Service Worker anmelden? Nur im Build (dev hat kein sw.js), in Tests nur auf Wunsch. */
export function shouldRegisterServiceWorker(env: PwaEnv): boolean {
  return env.supported && env.prod && (env.optIn === true || !env.webdriver);
}

/** Wartet auf `promise`, aber höchstens `ms` – erfüllt sich immer (auch bei Fehlern). */
export function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(resolve, ms);
    promise.then(done, done);
  });
}

/**
 * Ein anderer Service Worker steuert jetzt diese Seite:
 * - 'reload': dieser Tab hat „neu laden“ gewählt,
 * - 'notify': ein anderer Tab hat die neue Version aktiviert – hier läuft noch der alte
 *   Code (dessen Dateien nicht mehr im Cache liegen) → Hinweis „bitte neu laden“,
 * - 'none': allererste Übernahme (vorher ohne Service Worker) – nichts zu tun.
 */
export function controllerChangeAction(state: { hadController: boolean; reloadRequested: boolean }): 'reload' | 'notify' | 'none' {
  if (state.reloadRequested) return 'reload';
  return state.hadController ? 'notify' : 'none';
}

/** Die benötigten Teile eines ServiceWorker (testbar mit Attrappen). */
export interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

/** Die benötigten Teile einer ServiceWorkerRegistration. */
export interface RegistrationLike {
  readonly waiting: WorkerLike | null;
  readonly installing: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

/**
 * Meldet jeden neuen, wartenden Service Worker genau einmal – aber nur, wenn die Seite schon
 * von einem (älteren) gesteuert wird. Beim allerersten Besuch gibt es nichts zu aktualisieren.
 */
export function watchForUpdate(reg: RegistrationLike, hasController: () => boolean, onWaiting: (worker: WorkerLike) => void): void {
  const seen = new Set<WorkerLike>();
  const report = (worker: WorkerLike | null): void => {
    if (!worker || seen.has(worker) || worker.state !== 'installed' || !hasController()) return;
    seen.add(worker);
    onWaiting(worker);
  };
  report(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => report(worker));
  });
}

/** Kleiner Hinweis oben in der Mitte (einmal aufgebaut, danach nur Text und Sichtbarkeit). */
function createUpdateHint(onReload: () => void): { show(text: string): void } {
  const root = document.createElement('div');
  root.className = 'update-hint';
  root.setAttribute('role', 'status');
  root.dataset.ref = 'update-hint';
  root.hidden = true;
  const text = document.createElement('span');
  text.className = 'update-hint-text';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'update-hint-reload';
  reload.textContent = UPDATE_BUTTON;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'update-hint-close';
  close.setAttribute('aria-label', 'Später');
  close.title = 'Später';
  close.textContent = '×';
  root.append(text, reload, close);
  document.body.append(root);
  reload.addEventListener('click', () => {
    reload.disabled = true;
    onReload();
  });
  close.addEventListener('click', () => (root.hidden = true));
  return {
    show: (value) => {
      text.textContent = value;
      reload.disabled = false;
      root.hidden = false;
    },
  };
}

export interface ServiceWorkerOptions {
  /** Vor dem Neuladen: Spielstand sichern (persist()) und an das Konto senden (Promise). */
  beforeReload(): Promise<unknown> | void;
}

/** Bittet den Browser, Spielstand und Cache nicht bei Platzmangel zu räumen (Fehler egal). */
function requestPersistentStorage(): void {
  const storage = navigator.storage as StorageManager | undefined;
  if (!storage || typeof storage.persist !== 'function') return;
  storage
    .persisted()
    .then((done) => done || storage.persist())
    .catch(() => undefined);
}

/** Not-Aus: vorhandene Service Worker abmelden und ihre Caches löschen. */
function unregisterAll(container: ServiceWorkerContainer): void {
  container
    .getRegistrations()
    .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
    .catch(() => undefined);
  if (typeof caches === 'undefined') return;
  caches
    .keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('vszw-shell-')).map((key) => caches.delete(key))))
    .catch(() => undefined);
}

/** Meldet den Service Worker an (falls erlaubt) und verdrahtet die Update-Hinweise. */
export function setupServiceWorker(options: ServiceWorkerOptions): void {
  const env: PwaEnv = {
    supported: 'serviceWorker' in navigator,
    prod: import.meta.env.PROD,
    webdriver: navigator.webdriver === true,
    optIn: (window as unknown as { __VSZW_SW__?: unknown }).__VSZW_SW__,
  };
  if (!shouldRegisterServiceWorker(env)) return;
  requestPersistentStorage();
  const container = navigator.serviceWorker;
  if (typeof __VSZW_SW_KILL__ !== 'undefined' && __VSZW_SW_KILL__) return unregisterAll(container);

  let waiting: WorkerLike | null = null;
  let hadController = container.controller !== null;
  let reloadRequested = false;
  let reloading = false;

  const reloadNow = (): void => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  /** Erst sichern (auf das Konto höchstens FLUSH_WAIT_MS warten), dann `next`. */
  const saveThen = (next: () => void): void => {
    let pending: Promise<unknown> | void = undefined;
    try {
      pending = options.beforeReload();
    } catch {
      // Speichern gescheitert: trotzdem weiter (beforeunload versucht es noch einmal).
    }
    void withTimeout(Promise.resolve(pending), FLUSH_WAIT_MS).then(next);
  };
  const hint = createUpdateHint(() =>
    saveThen(() => {
      // Kein wartender Worker (Hinweis aus einem anderen Tab): einfach neu laden.
      if (!waiting || waiting.state !== 'installed') return reloadNow();
      // Neuer Worker übernimmt → controllerchange → neu laden (mit Sicherheitsnetz).
      reloadRequested = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(reloadNow, RELOAD_FALLBACK_MS);
    }),
  );

  container.addEventListener('controllerchange', () => {
    const action = controllerChangeAction({ hadController, reloadRequested });
    hadController = true;
    if (action === 'reload') reloadNow();
    else if (action === 'notify') {
      waiting = null;
      hint.show(ACTIVE_TEXT);
    }
  });

  const register = (): void => {
    container
      // updateViaCache 'none': sw.js nie aus dem HTTP-Cache prüfen (GitHub Pages: max-age 600).
      .register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then((reg) => {
        watchForUpdate(reg, () => container.controller !== null, (worker) => {
          waiting = worker;
          hint.show(UPDATE_TEXT);
        });
        // Lange offene App (installiert): beim Zurückkehren nach Updates sehen.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => undefined);
        });
      })
      .catch(() => {
        // Ohne Service Worker läuft das Spiel wie bisher (nur nicht offline).
      });
  };
  // Erst nach dem Laden: Das Vorab-Cachen soll den Spielstart nicht bremsen.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
