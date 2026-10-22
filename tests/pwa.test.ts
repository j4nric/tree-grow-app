import { describe, expect, it } from 'vitest';
import {
  CACHE_PREFIX,
  cacheName,
  contentVersion,
  killServiceWorkerSource,
  precacheList,
  routeRequest,
  serviceWorkerSource,
  staleCaches,
  type RouteInput,
} from '../src/pwa/service-worker';
import {
  controllerChangeAction,
  shouldRegisterServiceWorker,
  watchForUpdate,
  withTimeout,
  type RegistrationLike,
  type WorkerLike,
} from '../src/ui/pwa';

const SCOPE = 'https://j4nric.github.io/tree-grow-app/';
const get = (url: string, extra: Partial<RouteInput> = {}): RouteInput => ({ url, method: 'GET', mode: 'cors', accept: '*/*', ...extra });
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('Cache-Namen und Dateiliste', () => {
  it('Cache-Name trägt Präfix und Version; staleCaches findet nur alte eigene Caches', () => {
    expect(cacheName('abc')).toBe(`${CACHE_PREFIX}abc`);
    const keys = [cacheName('alt'), cacheName('neu'), 'fremder-cache', `${CACHE_PREFIX}älter`];
    expect(staleCaches(keys, cacheName('neu'))).toEqual([cacheName('alt'), `${CACHE_PREFIX}älter`]);
  });

  it('precacheList: index.html wird „./“, ohne sw.js, 404.html, Maps und Systemdateien, sortiert', () => {
    expect(
      precacheList([
        'sw.js',
        'index.html',
        '404.html',
        'assets/index-abc.js',
        'assets/index-abc.js.map',
        'assets/account-x.js',
        './manifest.webmanifest',
        'icons\\icon-192.png',
        '.DS_Store',
        'icons/.hidden',
      ]),
    ).toEqual(['./', 'assets/account-x.js', 'assets/index-abc.js', 'icons/icon-192.png', 'manifest.webmanifest']);
  });

  it('contentVersion: stabil, unabhängig von der Reihenfolge, ändert sich mit jedem Byte und Pfad', () => {
    const a = { path: 'index.html', data: bytes('<html>') };
    const b = { path: 'assets/x.js', data: bytes('1') };
    const v = contentVersion([a, b]);
    expect(v).toMatch(/^[0-9a-f]{8}$/);
    expect(contentVersion([b, a])).toBe(v);
    expect(contentVersion([a, { ...b, data: bytes('2') }])).not.toBe(v);
    expect(contentVersion([a, { ...b, path: 'assets/y.js' }])).not.toBe(v);
  });
});

describe('routeRequest', () => {
  it('Seite: Navigation, „./“ und index.html – network-first', () => {
    expect(routeRequest(get(SCOPE, { mode: 'navigate' }), SCOPE)).toBe('page');
    expect(routeRequest(get(`${SCOPE}?x=1`, { mode: 'navigate' }), SCOPE)).toBe('page');
    expect(routeRequest(get(`${SCOPE}index.html`), SCOPE)).toBe('page');
    expect(routeRequest(get(`${SCOPE}spiel/wald`, { mode: 'navigate' }), SCOPE)).toBe('page');
    // Navigation auf eine Datei: nie die App-Seite als Ersatz
    expect(routeRequest(get(`${SCOPE}icons/icon-512.png`, { mode: 'navigate' }), SCOPE)).toBe('static');
    expect(routeRequest(get(`${SCOPE}ui/demo.html`, { mode: 'navigate' }), SCOPE)).toBe('static');
    expect(routeRequest(get(`${SCOPE}assets/index-abc.js`, { mode: 'navigate' }), SCOPE)).toBe('asset');
  });

  it('gehashte Assets cache-first, Manifest und Icons aus dem Cache', () => {
    expect(routeRequest(get(`${SCOPE}assets/index-abc.js`), SCOPE)).toBe('asset');
    expect(routeRequest(get(`${SCOPE}manifest.webmanifest`), SCOPE)).toBe('static');
    expect(routeRequest(get(`${SCOPE}icons/icon-192.png`), SCOPE)).toBe('static');
  });

  it('lässt Sync-Server, andere Origins, SSE, /api/, sw.js und alles außer GET durch', () => {
    expect(routeRequest(get('https://sync.example.org/api/save'), SCOPE)).toBe('bypass');
    expect(routeRequest(get('https://sync.example.org/'), SCOPE)).toBe('bypass');
    // Gleicher Host, anderer Port (e2e: Sync-Server auf Spiel-Port + 1)
    expect(routeRequest(get('http://localhost:4175/api/health'), 'http://localhost:4174/')).toBe('bypass');
    expect(routeRequest(get(`${SCOPE}api/events?ticket=1`, { accept: 'text/event-stream' }), SCOPE)).toBe('bypass');
    expect(routeRequest(get(`${SCOPE}stream`, { accept: 'text/event-stream' }), SCOPE)).toBe('bypass');
    expect(routeRequest(get(`${SCOPE}api/save`), SCOPE)).toBe('bypass');
    expect(routeRequest(get('https://j4nric.github.io/api/save'), SCOPE)).toBe('bypass');
    expect(routeRequest(get(`${SCOPE}assets/x.js`, { method: 'POST' }), SCOPE)).toBe('bypass');
    expect(routeRequest(get(`${SCOPE}sw.js`), SCOPE)).toBe('bypass');
    // Andere App derselben Origin außerhalb des Scopes
    expect(routeRequest(get('https://j4nric.github.io/other-app/index.html', { mode: 'navigate' }), SCOPE)).toBe('bypass');
    expect(routeRequest(get('kaputt'), SCOPE)).toBe('bypass');
  });
});

/* ------------------------------------------------------------------------------------
 * Der erzeugte sw.js-Quelltext in einer kleinen Attrappe von `self`: prüft, dass das per
 * toString() eingesetzte Programm wirklich läuft (Install, Activate, Fetch-Strategien).
 * ------------------------------------------------------------------------------------ */

class FakeResponse {
  readonly type = 'basic';
  constructor(
    readonly body: string,
    readonly ok = true,
  ) {}
  clone(): FakeResponse {
    return new FakeResponse(this.body, this.ok);
  }
}

class FakeRequest {
  readonly method = 'GET';
  readonly headers: { get(name: string): string | null };
  constructor(
    readonly url: string,
    readonly init: { cache?: string; mode?: string; accept?: string } = {},
  ) {
    this.headers = { get: (name) => (name === 'accept' ? (init.accept ?? '*/*') : null) };
  }
  get mode(): string {
    return this.init.mode ?? 'cors';
  }
}

type Listener = (event: unknown) => void;

function fakeWorker(files: string[], network: Map<string, string>) {
  const listeners = new Map<string, Listener[]>();
  const stores = new Map<string, Map<string, FakeResponse>>();
  const key = (req: unknown): string => (typeof req === 'string' ? req : (req as FakeRequest).url);
  let online = true;
  const fetched: string[] = [];
  const self = {
    registration: { scope: SCOPE },
    Request: FakeRequest,
    skipWaitingCalled: false,
    claimed: false,
    addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    skipWaiting() {
      self.skipWaitingCalled = true;
    },
    clients: {
      claim: async () => {
        self.claimed = true;
      },
    },
    fetch: async (req: FakeRequest | string): Promise<FakeResponse> => {
      const url = key(req);
      fetched.push(url);
      if (!online) throw new TypeError('offline');
      const body = network.get(url);
      if (body === 'HÄNGT') return new Promise<FakeResponse>(() => undefined); // Funkloch: keine Antwort
      return body === undefined ? new FakeResponse('404', false) : new FakeResponse(body);
    },
    caches: {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name)!;
        return {
          addAll: async (reqs: FakeRequest[]) => {
            for (const req of reqs) store.set(req.url, await self.fetch(req));
          },
          // Wie Server mit „Vary: Origin“: Request-Objekte finden nur mit ignoreVary etwas.
          match: async (req: unknown, options?: { ignoreVary?: boolean }) =>
            typeof req !== 'string' && !options?.ignoreVary ? undefined : store.get(key(req)),
          put: async (req: unknown, res: FakeResponse) => void store.set(key(req), res),
        };
      },
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
  };
  const source = serviceWorkerSource({ version: 'v1', files, networkTimeoutMs: 50 });
  new Function('self', source)(self);

  const dispatch = async (type: string, data: Record<string, unknown> = {}): Promise<unknown> => {
    let waited: Promise<unknown> | undefined;
    let responded: Promise<unknown> | undefined;
    const event = {
      ...data,
      waitUntil: (p: Promise<unknown>) => (waited = p),
      respondWith: (p: Promise<unknown>) => (responded = p),
    };
    for (const fn of listeners.get(type) ?? []) fn(event);
    await waited;
    return responded;
  };
  return {
    self,
    stores,
    fetched,
    dispatch,
    setOnline: (value: boolean) => (online = value),
    fetchEvent: (url: string, init: { mode?: string; accept?: string } = {}) =>
      dispatch('fetch', { request: new FakeRequest(url, init) }) as Promise<Promise<FakeResponse> | undefined>,
  };
}

describe('erzeugter Service Worker', () => {
  const files = ['./', 'assets/index-abc.js', 'manifest.webmanifest'];
  const network = (): Map<string, string> =>
    new Map([
      [SCOPE, '<html>v1'],
      [`${SCOPE}assets/index-abc.js`, 'code'],
      [`${SCOPE}manifest.webmanifest`, '{}'],
      ['https://sync.example.org/api/save', 'stand'],
    ]);

  it('Install legt alle Dateien im versionierten Cache ab; Activate löscht alte Caches', async () => {
    const sw = fakeWorker(files, network());
    await sw.self.caches.open(cacheName('alt'));
    await sw.self.caches.open('fremd');
    await sw.dispatch('install');
    expect([...sw.stores.get(cacheName('v1'))!.keys()].sort()).toEqual([SCOPE, `${SCOPE}assets/index-abc.js`, `${SCOPE}manifest.webmanifest`]);
    await sw.dispatch('activate');
    expect([...sw.stores.keys()].sort()).toEqual(['fremd', cacheName('v1')]);
    expect(sw.self.claimed).toBe(true);
    expect(sw.self.skipWaitingCalled).toBe(false);
    await sw.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(sw.self.skipWaitingCalled).toBe(true);
  });

  it('offline: Seite und Assets aus dem Cache; Sync-Server und SSE werden nie beantwortet', async () => {
    const sw = fakeWorker(files, network());
    await sw.dispatch('install');
    sw.setOnline(false);
    expect((await (await sw.fetchEvent(SCOPE, { mode: 'navigate' }))!).body).toBe('<html>v1');
    expect((await (await sw.fetchEvent(`${SCOPE}?utm=1`, { mode: 'navigate' }))!).body).toBe('<html>v1');
    expect((await (await sw.fetchEvent(`${SCOPE}assets/index-abc.js`))!).body).toBe('code');
    expect(await sw.fetchEvent('https://sync.example.org/api/save')).toBeUndefined();
    expect(await sw.fetchEvent(`${SCOPE}api/events`, { accept: 'text/event-stream' })).toBeUndefined();
    for (const store of sw.stores.values()) for (const url of store.keys()) expect(url.startsWith(SCOPE)).toBe(true);
  });

  it('online: Seite frisch aus dem Netz, die gecachte index.html bleibt die dieser Version', async () => {
    const net = network();
    const sw = fakeWorker(files, net);
    await sw.dispatch('install');
    // Neuer Build liegt schon auf dem Server, dieser Worker ist noch aktiv
    net.set(SCOPE, '<html>v2');
    sw.fetched.length = 0;
    expect((await (await sw.fetchEvent(SCOPE, { mode: 'navigate' }))!).body).toBe('<html>v2');
    expect((await (await sw.fetchEvent(`${SCOPE}assets/index-abc.js`))!).body).toBe('code');
    expect(sw.fetched).toEqual([SCOPE]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Kein weißer Bildschirm offline: v2 verwiese auf Assets, die dieser Cache nicht hat.
    expect(sw.stores.get(cacheName('v1'))!.get(SCOPE)!.body).toBe('<html>v1');
    sw.setOnline(false);
    expect((await (await sw.fetchEvent(SCOPE, { mode: 'navigate' }))!).body).toBe('<html>v1');
  });

  it('Netz antwortet nicht: nach dem Zeitlimit kommt die Seite aus dem Cache', async () => {
    const net = network();
    const sw = fakeWorker(files, net);
    await sw.dispatch('install');
    net.set(SCOPE, 'HÄNGT');
    const started = Date.now();
    const response = await (await sw.fetchEvent(SCOPE, { mode: 'navigate' }))!;
    expect(response.body).toBe('<html>v1');
    expect(Date.now() - started).toBeGreaterThanOrEqual(40); // networkTimeoutMs = 50
  });

  it('offline ohne Cache (vor dem ersten Installieren): Netzfehler statt falscher Antwort', async () => {
    const sw = fakeWorker(files, network());
    sw.setOnline(false);
    await expect(sw.fetchEvent(SCOPE, { mode: 'navigate' }).then((p) => p)).rejects.toThrow('offline');
    await expect(sw.fetchEvent(`${SCOPE}assets/index-abc.js`).then((p) => p)).rejects.toThrow('offline');
    await expect(sw.fetchEvent(`${SCOPE}manifest.webmanifest`).then((p) => p)).rejects.toThrow('offline');
  });

  it('unbekannter Pfad online: Fehlerseite des Servers durchreichen, nie cachen; Startseite bleibt', async () => {
    const sw = fakeWorker(precacheList(['index.html', '404.html', 'assets/index-abc.js', 'manifest.webmanifest']), network());
    await sw.dispatch('install');
    const cache = sw.stores.get(cacheName('v1'))!;
    const before = [...cache.keys()].sort();
    expect(before).not.toContain(`${SCOPE}404.html`);
    // GitHub Pages antwortet mit 404.html (Status 404) – der Worker gibt das unverändert weiter.
    const missing = await (await sw.fetchEvent(`${SCOPE}zugewachsen/pfad`, { mode: 'navigate' }))!;
    expect(missing.ok).toBe(false);
    expect(missing.body).toBe('404');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...cache.keys()].sort()).toEqual(before);
    expect(cache.get(SCOPE)!.body).toBe('<html>v1');
    // Startseite weiter online wie offline
    expect((await (await sw.fetchEvent(SCOPE, { mode: 'navigate' }))!).body).toBe('<html>v1');
    sw.setOnline(false);
    expect((await (await sw.fetchEvent(SCOPE, { mode: 'navigate' }))!).body).toBe('<html>v1');
  });

  it('Navigation auf Dateien mit Endung bekommt nie index.html', async () => {
    const sw = fakeWorker(files, network());
    await sw.dispatch('install');
    sw.setOnline(false);
    await expect(sw.fetchEvent(`${SCOPE}icons/fehlt.png`, { mode: 'navigate' }).then((p) => p)).rejects.toThrow('offline');
  });
});

describe('Not-Aus-Service-Worker (VSZW_SW_KILL=1)', () => {
  it('übernimmt sofort, löscht nur die eigenen Caches, meldet sich ab und lädt Fenster neu', async () => {
    const listeners = new Map<string, Listener>();
    const caches = new Set([cacheName('a'), cacheName('b'), 'fremd']);
    const log: string[] = [];
    const self = {
      addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
      skipWaiting: () => log.push('skipWaiting'),
      caches: {
        keys: async () => [...caches],
        delete: async (key: string) => caches.delete(key),
      },
      registration: { unregister: async () => log.push('unregister') },
      clients: {
        matchAll: async () => [
          { url: `${SCOPE}`, navigate: async (url: string) => void log.push(`navigate ${url}`) },
          { url: `${SCOPE}?x=1`, navigate: async () => Promise.reject(new Error('nicht gesteuert')) },
        ],
      },
    };
    const source = killServiceWorkerSource();
    expect(source).not.toContain('fetch');
    new Function('self', source)(self);
    listeners.get('install')!({});
    let waited: Promise<unknown> | undefined;
    listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect([...caches]).toEqual(['fremd']);
    expect(log).toEqual(['skipWaiting', 'unregister', `navigate ${SCOPE}`]);
  });
});

describe('Anmeldung und Update-Hinweis', () => {
  const env = { supported: true, prod: true, webdriver: false, optIn: undefined };

  it('nur im Build, nicht in automatisierten Browsern – außer der Test schaltet ihn ein', () => {
    expect(shouldRegisterServiceWorker(env)).toBe(true);
    expect(shouldRegisterServiceWorker({ ...env, prod: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...env, prod: false, optIn: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...env, supported: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...env, webdriver: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...env, webdriver: true, optIn: 'ja' })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...env, webdriver: true, optIn: true })).toBe(true);
  });

  class Worker implements WorkerLike {
    state = 'installing';
    private listeners: (() => void)[] = [];
    postMessage(): void {}
    addEventListener(_type: 'statechange', fn: () => void): void {
      this.listeners.push(fn);
    }
    set(state: string): void {
      this.state = state;
      for (const fn of this.listeners) fn();
    }
  }

  function registration(waiting: WorkerLike | null = null) {
    const listeners: (() => void)[] = [];
    const reg = {
      waiting,
      installing: null as WorkerLike | null,
      addEventListener: (_type: 'updatefound', fn: () => void) => void listeners.push(fn),
    };
    return {
      reg: reg as RegistrationLike,
      found: (worker: Worker) => {
        reg.installing = worker;
        for (const fn of listeners) fn();
      },
    };
  }

  it('withTimeout: wartet auf das Senden, höchstens bis zum Zeitlimit, auch bei Fehlern', async () => {
    let order: string[] = [];
    await withTimeout(new Promise((resolve) => setTimeout(() => resolve(order.push('gesendet')), 5)), 1000);
    order.push('weiter');
    expect(order).toEqual(['gesendet', 'weiter']);
    order = [];
    const started = Date.now();
    await withTimeout(new Promise(() => undefined), 30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    await withTimeout(Promise.reject(new Error('offline')), 1000);
  });

  it('controllerchange: neu laden nach eigenem Klick, Hinweis in anderen Tabs, nichts beim ersten Mal', () => {
    expect(controllerChangeAction({ hadController: true, reloadRequested: true })).toBe('reload');
    expect(controllerChangeAction({ hadController: true, reloadRequested: false })).toBe('notify');
    expect(controllerChangeAction({ hadController: false, reloadRequested: false })).toBe('none');
  });

  it('meldet einen schon wartenden Worker sofort, aber nur mit bestehender Steuerung', () => {
    const waiting = new Worker();
    waiting.state = 'installed';
    const seen: WorkerLike[] = [];
    watchForUpdate(registration(waiting).reg, () => true, (w) => seen.push(w));
    expect(seen).toEqual([waiting]);
    const none: WorkerLike[] = [];
    watchForUpdate(registration(waiting).reg, () => false, (w) => none.push(w));
    expect(none).toEqual([]);
  });

  it('meldet einen neu installierten Worker genau einmal; beim ersten Besuch gar nicht', () => {
    let controlled = false;
    const seen: WorkerLike[] = [];
    const { reg, found } = registration();
    watchForUpdate(reg, () => controlled, (w) => seen.push(w));
    const first = new Worker();
    found(first);
    first.set('installed'); // erster Besuch: keine Steuerung → kein Hinweis
    first.set('activated');
    controlled = true;
    const next = new Worker();
    found(next);
    next.set('installed');
    next.set('installed');
    next.set('activated');
    expect(seen).toEqual([next]);
  });
});
