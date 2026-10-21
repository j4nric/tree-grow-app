/**
 * Installierbare App: Service Worker anmelden (nur im Produktions-Build) und einen
 * Hinweis zeigen, sobald eine neue Version bereitliegt („Neue Version verfügbar – neu
 * laden“). Der Service Worker selbst entsteht beim Bauen aus src/pwa/service-worker.ts.
 *
 * Nicht in Entwicklung und nicht in automatisierten Browsern (e2e), außer ein Test setzt
 * vor dem Laden `window.__VSZW_SW__ = true` – sonst blieben alte Builds im Cache hängen.
 */

/** Text des Hinweises vor dem Knopf „neu laden“ (geschütztes Leerzeichen: Strich bricht nie allein um). */
export const UPDATE_TEXT = 'Neue Version verfügbar\u00a0–';
export const UPDATE_BUTTON = 'neu laden';
/** Wenn der neue Service Worker nicht übernimmt (z. B. Fehler): trotzdem neu laden. */
const RELOAD_FALLBACK_MS = 3000;

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

/** Kleiner Hinweis oben in der Mitte (einmal aufgebaut, danach nur ein-/ausgeblendet). */
function createUpdateHint(onReload: () => void): { show(): void } {
  const root = document.createElement('div');
  root.className = 'update-hint';
  root.setAttribute('role', 'status');
  root.dataset.ref = 'update-hint';
  root.hidden = true;
  const text = document.createElement('span');
  text.className = 'update-hint-text';
  text.textContent = UPDATE_TEXT;
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
    show: () => {
      reload.disabled = false;
      root.hidden = false;
    },
  };
}

export interface ServiceWorkerOptions {
  /** Vor dem Neuladen: Spielstand sichern (persist() und Konto-Abgleich). */
  beforeReload(): void;
}

/** Meldet den Service Worker an (falls erlaubt) und verdrahtet den Update-Hinweis. */
export function setupServiceWorker(options: ServiceWorkerOptions): void {
  const env: PwaEnv = {
    supported: 'serviceWorker' in navigator,
    prod: import.meta.env.PROD,
    webdriver: navigator.webdriver === true,
    optIn: (window as unknown as { __VSZW_SW__?: unknown }).__VSZW_SW__,
  };
  if (!shouldRegisterServiceWorker(env)) return;
  const container = navigator.serviceWorker;
  let waiting: WorkerLike | null = null;
  let reloading = false;

  const reloadNow = (): void => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  const hint = createUpdateHint(() => {
    options.beforeReload();
    if (!waiting) return reloadNow();
    // Neuer Worker übernimmt → controllerchange → neu laden (mit Sicherheitsnetz).
    waiting.postMessage({ type: 'SKIP_WAITING' });
    container.addEventListener('controllerchange', reloadNow);
    setTimeout(reloadNow, RELOAD_FALLBACK_MS);
  });

  const register = (): void => {
    container
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        watchForUpdate(reg, () => container.controller !== null, (worker) => {
          waiting = worker;
          hint.show();
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
