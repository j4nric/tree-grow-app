import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { expect, openGame, savedState, seedV3, stageLabel } from './fixtures';

/**
 * Installierbare App (PWA) gegen den Produktions-Build (vite preview, playwright.config.ts):
 * Manifest und Icons, Service Worker mit Offline-Start, Update-Hinweis – und dass der
 * Sync-Server (andere Origin) nie im Cache landet.
 *
 * In automatisierten Browsern meldet das Spiel den Service Worker nur an, wenn der Test es
 * vor dem Laden mit `window.__VSZW_SW__ = true` erlaubt (src/ui/pwa.ts); alle anderen
 * e2e-Tests laufen also wie bisher ohne ihn.
 */

declare const process: { env: Record<string, string | undefined> };
const SYNC_URL = `http://localhost:${Number(process.env.E2E_SYNC_PORT ?? Number(process.env.E2E_PORT ?? 4173) + 1)}`;

/** Wie `test` aus den Fixtures, aber abgebrochene Netzaufrufe sind offline erwartet. */
const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on('console', (msg) => {
        if (msg.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(msg.text())) errors.push(`console: ${msg.text()}`);
      });
      context.on('weberror', (err) => errors.push(`pageerror: ${err.error().message}`));
      await use(errors);
      expect(errors, 'Konsolen- oder Seitenfehler').toEqual([]);
    },
    { auto: true },
  ],
});

async function enableServiceWorker(context: BrowserContext, options: { sync?: boolean } = {}): Promise<void> {
  await context.addInitScript(
    ({ sync }) => {
      const w = window as unknown as { __VSZW_SW__: boolean; __VSZW_SYNC_URL__?: string };
      w.__VSZW_SW__ = true;
      if (sync) w.__VSZW_SYNC_URL__ = sync;
    },
    { sync: options.sync ? SYNC_URL : '' },
  );
}

/** Wartet, bis der Service Worker aktiv ist und die Seite steuert (clients.claim). */
async function waitForController(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** Alle URLs in den Caches der Seite. */
async function cachedUrls(page: Page): Promise<{ cache: string; urls: string[] }[]> {
  return page.evaluate(async () => {
    const out: { cache: string; urls: string[] }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out.push({ cache: name, urls: (await cache.keys()).map((r) => r.url) });
    }
    return out;
  });
}

const account = (page: Page) => page.locator('[data-ref="account"]');

async function openSettings(page: Page): Promise<void> {
  await page.locator('[data-ref="settings-open"]').click();
  await expect(page.locator('dialog[data-ref="settings"]')).toBeVisible();
}

test('Manifest ist gültig, verlinkt und seine Icons liegen bereit', async ({ page, baseURL }) => {
  await openGame(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href, 'relativ, damit es unter /tree-grow-app/ funktioniert').toBe('./manifest.webmanifest');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#3f8f3a');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', './icons/apple-touch-icon.png');

  const manifestUrl = new URL(href!, `${baseURL}/`).href;
  const response = await page.request.get(manifestUrl);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: 'Vom Samen zum Wald',
    lang: 'de',
    display: 'standalone',
    start_url: './',
    scope: './',
    theme_color: '#3f8f3a',
    background_color: '#f3f1e8',
  });
  expect(manifest.short_name.length).toBeLessThanOrEqual(15);
  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose: string }[];
  expect(icons.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
  for (const icon of [...icons, { src: 'icons/apple-touch-icon.png', sizes: '180x180' }]) {
    expect(icon.src.startsWith('/'), 'relative Icon-Pfade').toBe(false);
    const res = await page.request.get(new URL(icon.src, manifestUrl).href);
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('image/png');
    // Breite und Höhe aus dem PNG-Kopf (IHDR)
    const png = await res.body();
    const size = Number(icon.sizes.split('x')[0]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
  }
});

test('ohne Freigabe kein Service Worker (e2e und Entwicklung bleiben unberührt)', async ({ page }) => {
  await openGame(page);
  await page.waitForLoadState('load');
  await page.waitForTimeout(300);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test('Service Worker: Offline-Start nach einem Besuch, Konto zeigt Offline, Sync-Server nie im Cache', async ({
  page,
  context,
}) => {
  test.slow(); // Konto anlegen (scrypt) unter paralleler Last
  await enableServiceWorker(context, { sync: true });
  await openGame(page);
  await waitForController(page);

  // Konto anlegen: Netzaufrufe an den Sync-Server (andere Origin) inkl. Event-Stream
  const name = `pwa${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  await openSettings(page);
  await account(page).getByLabel('Benutzername').fill(name);
  await account(page).getByLabel('Passwort').fill('geheim-wald-1');
  await account(page).getByRole('button', { name: 'Konto anlegen' }).click();
  await expect(account(page).locator('[data-ref="account-who"]')).toHaveText(`Angemeldet als ${name}`);
  await expect(account(page).locator('[data-ref="account-sync"]')).toHaveText(/Synchronisiert|Gespeichert/);

  // Ein Aufruf an den Sync-Server geht nicht durch den Service Worker
  const viaWorker: string[] = [];
  page.on('response', (res) => {
    if (res.url().startsWith(SYNC_URL) && res.fromServiceWorker()) viaWorker.push(res.url());
  });
  await page.evaluate((url) => fetch(`${url}/api/health`).then((r) => r.status), SYNC_URL);

  const caches = await cachedUrls(page);
  expect(caches).toHaveLength(1);
  expect(caches[0]!.cache).toMatch(/^vszw-shell-[0-9a-f]{8}$/);
  const origin = new URL(page.url()).origin;
  const urls = caches[0]!.urls;
  expect(urls.some((u) => /\/assets\/index-[\w-]+\.js$/.test(u))).toBe(true);
  expect(urls.some((u) => /\/assets\/account-[\w-]+\.js$/.test(u)), 'Konto-Chunk für den Offline-Start').toBe(true);
  expect(urls).toContain(`${origin}/`);
  expect(urls).toContain(`${origin}/manifest.webmanifest`);
  for (const url of urls) {
    expect(url.startsWith(`${origin}/`), url).toBe(true);
    expect(url).not.toContain('/api/');
  }
  expect(viaWorker).toEqual([]);

  // Offline neu laden: Das Spiel startet aus dem Cache, das Konto zeigt seinen Offline-Zustand.
  await context.setOffline(true);
  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(stageLabel(page)).toContainText('Stufe:');
  await openSettings(page);
  await expect(account(page).locator('[data-ref="account-who"]')).toHaveText(`Angemeldet als ${name}`);
  await expect(account(page).locator('[data-ref="account-sync"]')).toHaveText(/^Offline/, { timeout: 15_000 });
  await context.setOffline(false);
});

test('neue Version: Hinweis „Neue Version verfügbar – neu laden“ lädt neu, ohne Fortschritt zu verlieren', async ({
  page,
  context,
}) => {
  await enableServiceWorker(context);
  await seedV3(context, { seeds: 400 });
  await openGame(page);
  await waitForController(page);

  // Neue Version simulieren: dieselbe Registrierung mit geänderter Skript-Adresse – der
  // Browser installiert einen neuen Worker, der wie nach einem neuen Build wartet.
  await page.evaluate(() => navigator.serviceWorker.register('./sw.js?neu=1', { scope: './' }));

  const hint = page.locator('[data-ref="update-hint"]');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Neue Version verfügbar –');
  await expect(hint.getByRole('button', { name: 'neu laden' })).toBeVisible();
  await expect(hint.getByRole('button', { name: 'Später' })).toBeVisible();

  // Spielstand nach dem Neuladen wie vorher (gespeichert über persist() vor dem Neuladen)
  const before = await savedState(page);
  await page.waitForTimeout(1200);
  const navigation = page.waitForEvent('framenavigated');
  await hint.getByRole('button', { name: 'neu laden' }).click();
  await navigation;
  await openGame(page);
  const after = await savedState(page);
  expect(after.seeds).toBeGreaterThanOrEqual(400);
  expect(after.totalGrowth).toBeGreaterThan(before.totalGrowth);
  // Der neue Worker hat übernommen (SKIP_WAITING → controllerchange), nicht nur ein Neuladen.
  // (Danach meldet das Spiel wieder „./sw.js“ an – für den Browser erneut eine neue Adresse.)
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/sw\.js\?neu=1$/);
});
