/**
 * Service Worker der installierbaren App (PWA) – von Hand geschrieben, ohne Abhängigkeit.
 *
 * Beim Bauen (Plugin in vite.config.ts) entsteht daraus dist/sw.js: `serviceWorkerSource()`
 * setzt die Liste aller gebauten Dateien und eine Inhalts-Version in den Quelltext von
 * `swMain` ein. Alles hier ist rein (kein DOM, kein Node) und in tests/pwa.test.ts geprüft;
 * `swMain` und `routeRequest` laufen später per `toString()` im Service Worker und dürfen
 * deshalb nichts aus ihrer Umgebung verwenden (keine Importe, keine Modul-Konstanten).
 *
 * Strategien:
 * - index.html / Seitenaufrufe (Pfade ohne Dateiendung): zuerst Netz (Zeitlimit), sonst die
 *   vorab gecachte index.html dieser Version (nie zur Laufzeit überschrieben).
 * - gehashte Dateien unter assets/: zuerst Cache (ändern sich nie).
 * - übrige eigene Dateien (Manifest, Icons): Cache, sonst Netz.
 * - NIE angefasst: andere Origins (Sync-Server), Event-Streams (SSE), /api/, alles außer GET.
 *
 * Not-Aus: Mit VSZW_SW_KILL=1 gebaut, wird statt dessen `swKill` ausgeliefert – er löscht
 * die Caches, meldet sich ab und lädt offene Tabs neu (README „Not-Aus“).
 */

/** Präfix aller Caches dieses Spiels; fremde Caches derselben Origin bleiben unberührt. */
export const CACHE_PREFIX = 'vszw-shell-';

/** Name des Caches einer Version. */
export function cacheName(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/** Caches älterer Versionen (zum Löschen beim Aktivieren). */
export function staleCaches(keys: readonly string[], current: string): string[] {
  return keys.filter((key) => key.startsWith('vszw-shell-') && key !== current);
}

/**
 * Zu cachende Dateien relativ zum Scope (Ordner der App): alles aus dist/ außer dem
 * Service Worker selbst, Source-Maps und Systemdateien; index.html als „./“ (so ruft der
 * Browser die App auf, unter /tree-grow-app/ ebenso wie lokal). Sortiert und eindeutig.
 */
export function precacheList(files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of files) {
    const file = raw.replace(/\\/g, '/').replace(/^\.?\//, '');
    const name = file.split('/').pop() ?? '';
    if (file === 'sw.js' || file.endsWith('.map') || name.startsWith('.')) continue;
    out.add(file === 'index.html' ? './' : file);
  }
  return [...out].sort();
}

/** FNV-1a (32 Bit) über Pfade und Inhalte aller Dateien → kurze, stabile Version. */
export function contentVersion(entries: readonly { path: string; data: Uint8Array }[]): string {
  let hash = 0x811c9dc5;
  const mix = (byte: number): void => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { path, data } of sorted) {
    for (let i = 0; i < path.length; i++) mix(path.charCodeAt(i) & 0xff);
    mix(0);
    for (const byte of data) mix(byte);
    mix(0);
  }
  return hash.toString(16).padStart(8, '0');
}

/** Was der Service Worker mit einer Anfrage macht. */
export type Route = 'bypass' | 'page' | 'asset' | 'static';

/** Die für die Entscheidung nötigen Teile einer Anfrage (testbar ohne Request-Objekt). */
export interface RouteInput {
  url: string;
  method: string;
  /** Request.mode – „navigate“ bei Seitenaufrufen. */
  mode: string;
  /** Accept-Header (SSE: text/event-stream). */
  accept: string;
}

/**
 * Entscheidet über eine Anfrage. `scope` ist die Scope-URL des Service Workers
 * (z. B. https://j4nric.github.io/tree-grow-app/). Läuft im Service Worker (toString).
 */
export function routeRequest(req: RouteInput, scope: string): Route {
  if (req.method !== 'GET') return 'bypass';
  if (req.accept.indexOf('text/event-stream') !== -1) return 'bypass';
  let url: URL;
  let base: URL;
  try {
    url = new URL(req.url);
    base = new URL(scope);
  } catch {
    return 'bypass';
  }
  // Sync-Server und alles Fremde: nie abfangen, nie cachen.
  if (url.origin !== base.origin) return 'bypass';
  if (url.pathname.indexOf(base.pathname) !== 0) return 'bypass';
  const rel = url.pathname.slice(base.pathname.length);
  // Sync-Server hinter derselben Adresse (Reverse-Proxy): ebenfalls nie.
  if (rel.indexOf('api/') === 0 || url.pathname.indexOf('/api/') !== -1) return 'bypass';
  if (rel === 'sw.js') return 'bypass';
  if (rel === '' || rel === 'index.html') return 'page';
  // Navigation auf einen Pfad ohne Dateiendung (z. B. ./?x=1 oder ./spiel): App-Seite.
  // Mit Endung (icons/icon-192.png, ui/demo.html …) nie durch index.html ersetzen.
  const last = rel.split('/').pop() || '';
  if (req.mode === 'navigate' && last.indexOf('.') === -1) return 'page';
  if (rel.indexOf('assets/') === 0) return 'asset';
  return 'static';
}

/** Einstellungen, die beim Bauen in den Service Worker geschrieben werden. */
export interface SwConfig {
  version: string;
  /** Dateien relativ zum Scope (aus precacheList). */
  files: string[];
  /** Wartezeit für Seitenaufrufe, danach gilt das Netz als weg (ms). */
  networkTimeoutMs: number;
}

/**
 * Laufzeit des Service Workers (`sw` ist `self`; `any`, weil die WebWorker-Typen fehlen). Wird per `toString()` in sw.js eingesetzt und dort mit
 * `self`, der Konfiguration und den Hilfen aufgerufen – kein Zugriff auf Modul-Bindungen.
 */
export function swMain(
  sw: any,
  config: SwConfig,
  route: (req: RouteInput, scope: string) => Route,
  stale: (keys: readonly string[], current: string) => string[],
): void {
  const CACHE = 'vszw-shell-' + config.version;
  const scope: string = sw.registration.scope;
  const indexUrl = new URL('./', scope).href;

  sw.addEventListener('install', (event: any) => {
    event.waitUntil(
      sw.caches.open(CACHE).then((cache: any) =>
        // cache: 'reload' – an HTTP-Caches vorbei, damit die neue Version wirklich neu ist.
        cache.addAll(config.files.map((file) => new sw.Request(new URL(file, scope).href, { cache: 'reload' }))),
      ),
    );
    // Kein skipWaiting(): Die neue Version wartet, bis der Spieler „neu laden“ wählt.
  });

  sw.addEventListener('activate', (event: any) => {
    event.waitUntil(
      sw.caches
        .keys()
        .then((keys: string[]) => Promise.all(stale(keys, CACHE).map((key) => sw.caches.delete(key))))
        .then(() => sw.clients.claim()),
    );
  });

  sw.addEventListener('message', (event: any) => {
    if (event.data && event.data.type === 'SKIP_WAITING') sw.skipWaiting();
  });

  // ignoreVary: Server senden oft „Vary: Origin“; vorab gecacht wurde ohne Origin-Header,
  // <script crossorigin> fragt mit – ohne ignoreVary fände der Cache offline nichts.
  const fromCache = (request: any): Promise<any> =>
    sw.caches.open(CACHE).then((cache: any) => cache.match(request, { ignoreVary: true }));

  const store = (key: any, response: any): void => {
    if (!response || !response.ok || response.type !== 'basic') return;
    const copy = response.clone();
    sw.caches.open(CACHE).then((cache: any) => cache.put(key, copy));
  };

  /**
   * Seite: Netz mit Zeitlimit, sonst die beim Installieren gecachte index.html. Die Antwort
   * aus dem Netz wird bewusst NICHT gecacht: Eine neuere index.html (neuer Build, dieser
   * Worker noch aktiv) verwiese auf Assets, die dieser Cache nicht kennt – offline gäbe das
   * einen weißen Bildschirm. Die Kopie im Cache passt so immer zu den Assets daneben.
   */
  const page = (request: any): Promise<any> => {
    const network: Promise<any> = sw.fetch(request);
    const timeout = new Promise<any>((resolve) => setTimeout(() => resolve(null), config.networkTimeoutMs));
    return Promise.race([network.catch(() => null), timeout]).then((response) => {
      if (response) return response;
      return fromCache(indexUrl).then((hit: any) => hit || network);
    });
  };

  /** Gehashte Datei: Cache, sonst Netz (und merken). */
  const asset = (request: any): Promise<any> =>
    fromCache(request).then(
      (hit: any) =>
        hit ||
        sw.fetch(request).then((response: any) => {
          store(request, response);
          return response;
        }),
    );

  /** Manifest, Icons: Cache, sonst Netz. */
  const staticFile = (request: any): Promise<any> => fromCache(request).then((hit: any) => hit || sw.fetch(request));

  sw.addEventListener('fetch', (event: any) => {
    const request = event.request;
    const kind = route(
      { url: request.url, method: request.method, mode: request.mode, accept: request.headers.get('accept') || '' },
      scope,
    );
    if (kind === 'bypass') return; // Browser erledigt die Anfrage selbst.
    event.respondWith(kind === 'page' ? page(request) : kind === 'asset' ? asset(request) : staticFile(request));
  });
}

/** Quelltext von sw.js mit eingesetzter Konfiguration. */
export function serviceWorkerSource(config: SwConfig): string {
  return [
    '/* Vom Samen zum Wald – Service Worker (erzeugt beim Bauen aus src/pwa/service-worker.ts) */',
    "'use strict';",
    `(${swMain.toString()})(self, ${JSON.stringify(config)}, ${routeRequest.toString()}, ${staleCaches.toString()});`,
    '',
  ].join('\n');
}

/**
 * Not-Aus-Worker: übernimmt sofort, löscht alle Caches des Spiels, meldet sich ab und lädt
 * offene Fenster neu (dann ohne Service Worker). Kein fetch-Handler: alles geht ans Netz.
 * Läuft per `toString()` in sw.js – keine Modul-Bindungen.
 */
export function swKill(sw: any): void {
  sw.addEventListener('install', () => sw.skipWaiting());
  sw.addEventListener('activate', (event: any) => {
    event.waitUntil(
      sw.caches
        .keys()
        .then((keys: string[]) => Promise.all(keys.filter((key) => key.indexOf('vszw-shell-') === 0).map((key) => sw.caches.delete(key))))
        .then(() => sw.registration.unregister())
        .then(() => sw.clients.matchAll({ type: 'window' }))
        .then((clients: any[]) => Promise.all(clients.map((client) => client.navigate(client.url).catch(() => undefined)))),
    );
  });
}

/** Quelltext des Not-Aus-sw.js. */
export function killServiceWorkerSource(): string {
  return [
    '/* Vom Samen zum Wald – Not-Aus: Service Worker meldet sich ab (gebaut mit VSZW_SW_KILL=1) */',
    "'use strict';",
    `(${swKill.toString()})(self);`,
    '',
  ].join('\n');
}
