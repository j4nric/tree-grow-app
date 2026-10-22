import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { codeFromJson, exportCode, importCode, serialize } from '../src/core/save';
import { createInitialState } from '../src/core/state';
import { SAVE_VERSION, expect, niche, openCover, openGame, openTab, readNumber, seedsValue, seedV3, stamps, test, waypoint } from './fixtures';

/**
 * Konto und Gerätesync: Ohne VITE_SYNC_URL (so ist das e2e-Build gebaut) gibt es kein
 * Konto. Mit dem Test-Hook `window.__VSZW_SYNC_URL__` spricht das Spiel mit dem lokalen
 * Sync-Server aus playwright.config.ts (server/, SQLite im Speicher) – zwei Browser-Kontexte
 * spielen dasselbe Konto, eine Aktion in A erscheint in B.
 */

declare const process: { env: Record<string, string | undefined> };
const SYNC_URL = `http://localhost:${Number(process.env.E2E_SYNC_PORT ?? Number(process.env.E2E_PORT ?? 4173) + 1)}`;

/**
 * Wie `test` aus den Fixtures (keine Konsolenfehler), aber ein Versionskonflikt (409) ist
 * hier erwartetes Verhalten, ebenso 401 beim falschen Passwort: Chromium meldet beides als
 * „Failed to load resource“.
 */
const syncTest = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on('console', (msg) => {
        // Offline-Test: abgebrochene Netzaufrufe sind dort erwartet.
        if (msg.type() === 'error' && !/status of 40[19]|ERR_INTERNET_DISCONNECTED/.test(msg.text())) errors.push(`console: ${msg.text()}`);
      });
      context.on('weberror', (err) => errors.push(`pageerror: ${err.error().message}`));
      await use(errors);
      expect(errors, 'Konsolen- oder Seitenfehler').toEqual([]);
    },
    { auto: true },
  ],
});

async function enableSync(context: BrowserContext): Promise<void> {
  await context.addInitScript((url) => {
    (window as unknown as { __VSZW_SYNC_URL__: string }).__VSZW_SYNC_URL__ = url;
  }, SYNC_URL);
}

const account = (page: Page) => page.locator('[data-ref="account"]');

async function openSettings(page: Page): Promise<void> {
  await openCover(page);
  await page.locator('[data-ref="settings-open"]').click();
  await expect(page.locator('dialog[data-ref="settings"]')).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
  await page.locator('dialog[data-ref="settings"]').getByRole('button', { name: 'Schließen' }).click();
  await expect(page.locator('dialog[data-ref="settings"]')).toBeHidden();
}

test('ohne VITE_SYNC_URL: kein Konto in den Einstellungen, keine Netzaufrufe', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://localhost') || req.url().includes('/api/')) requests.push(req.url());
  });
  await openGame(page);
  await openSettings(page);
  await expect(page.locator('dialog[data-ref="settings"]')).toContainText('Zahlenformat');
  await expect(account(page)).toHaveCount(0);
  expect(requests).toEqual([]);
});

syncTest('zwei Geräte, ein Konto: Aktion in A erscheint in B', async ({ browser, baseURL }) => {
  // Zwei Browser, Bau des Spiels, scrypt: unter paralleler Last oft über 30 s.
  syncTest.slow();
  const name = `wald${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const contextA = await browser.newContext({ baseURL, locale: 'de-DE' });
  const contextB = await browser.newContext({ baseURL, locale: 'de-DE' });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  try {
    await enableSync(contextA);
    await enableSync(contextB);
    await seedV3(contextA, {
      totalGrowth: waypoint(6) + 1, // Junger Baum: Laubstreu hat 2 Plätze
      seeds: 400,
      niches: { roots: ['earthworm'], litter: ['robin'] },
    });
    await openGame(a);
    await openGame(b);

    // A legt das Konto an (Formular, Tastatur-taugliche Felder mit Beschriftung).
    await openSettings(a);
    await expect(account(a)).toContainText('Konto');
    await account(a).getByLabel('Benutzername').fill(name);
    await account(a).getByLabel('Passwort').fill('geheim-wald-1');
    await account(a).getByRole('button', { name: 'Konto anlegen' }).click();
    await expect(account(a).locator('[data-ref="account-who"]')).toHaveText(`Angemeldet als ${name}`);
    await expect(account(a).locator('[data-ref="account-sync"]')).toHaveText(/Synchronisiert|Gespeichert/);
    await closeSettings(a);

    // B meldet sich an: Der Stand aus dem Konto ist weiter → B übernimmt ihn.
    await openSettings(b);
    await account(b).getByLabel('Benutzername').fill(name);
    await account(b).getByLabel('Passwort').fill('falsch-falsch');
    await account(b).getByRole('button', { name: 'Anmelden' }).click();
    await expect(account(b).locator('[data-ref="account-status"]')).toHaveText('Name oder Passwort stimmen nicht.');
    await account(b).getByLabel('Passwort').fill('geheim-wald-1');
    await account(b).getByLabel('Passwort').press('Enter');
    await expect(account(b).locator('[data-ref="account-who"]')).toHaveText(`Angemeldet als ${name}`);
    await expect(b.locator('dialog[data-ref="settings"]')).toContainText('Dein Wald aus dem Konto ist geladen');
    // Vor dem Ersetzen wurden beide Stände gesichert (lokal und Cloud).
    const ring = await b.evaluate(
      () => JSON.parse(localStorage.getItem('vszw-backups') ?? '[]') as { code: string; reason: string; owner: string | null }[],
    );
    const local = ring.find((e) => e.reason === 'first-login-local');
    const cloud = ring.find((e) => e.reason === 'first-login-cloud');
    expect(local?.code).toMatch(/^VSZW1:/);
    expect(cloud?.code).toMatch(/^VSZW1:/);
    expect(cloud?.owner).toBe(name);
    expect(local?.code).not.toBe(cloud?.code);
    await closeSettings(b);
    await expect(niche(b, 'litter')).toContainText('1/2 belegt');
    await expect(niche(b, 'roots')).toContainText('Regenwurm');

    // Aktion in A: Pflege kaufen → B übernimmt sie (Live über Server-Sent Events).
    await openTab(a, 'pflege');
    await a
      .locator('[data-ref="care"] [data-care="leaf-litter"]')
      .getByRole('button', { name: 'Kaufen (200 🌰)' })
      .click();
    // A steht im Reiter Pflege (der Reiter Nischen schreibt nur, solange er sichtbar ist).
    await expect(a.locator('[data-ref="care"] [data-care="leaf-litter"]')).toContainText('Rang 1/2');
    await expect(niche(b, 'litter')).toContainText('1/3 belegt', { timeout: 15_000 });
    await expect(stamps(b)).toContainText('Auf anderem Gerät weitergespielt – übernommen.');
    await openTab(b, 'pflege');
    await expect(b.locator('[data-ref="care"] [data-care="leaf-litter"]')).toContainText('Rang 1/2');

    // Abmelden in B: Spiel bleibt, Formular wieder da.
    await openSettings(b);
    await account(b).getByRole('button', { name: 'Abmelden' }).click();
    await expect(account(b).locator('[data-ref="account-status"]')).toHaveText(/Abgemeldet/);
    await expect(account(b).getByLabel('Benutzername')).toBeVisible();
    await expect(niche(b, 'litter')).toContainText('1/3 belegt');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

syncTest('Konto-Abschnitt passt auf 360 px', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: 'de-DE', viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  try {
    await enableSync(context);
    await openGame(page);
    await openSettings(page);
    const section = account(page);
    await section.getByLabel('Benutzername').scrollIntoViewIfNeeded();
    await expect(section.getByLabel('Benutzername')).toBeVisible();
    const box = await section.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    const register = await section.getByRole('button', { name: 'Konto anlegen' }).boundingBox();
    expect(register!.x + register!.width).toBeLessThanOrEqual(360);
    expect(register!.height).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});

syncTest('Stand einer neueren Spielversion im Konto: nichts übernehmen, nichts senden, Hinweis', async ({ browser, baseURL, request }) => {
  const name = `neu${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  // Ein Gerät mit neuerem Spiel hat schon gespeichert (direkt über die API).
  const registered = await request.post(`${SYNC_URL}/api/register`, { data: { username: name, password: 'geheim-wald-1' } });
  expect(registered.status()).toBe(201);
  const { token } = (await registered.json()) as { token: string };
  const future = JSON.parse(serialize(createInitialState(0, 1))) as Record<string, unknown>;
  future.version = SAVE_VERSION + 1;
  const code = codeFromJson(JSON.stringify(future));
  const put = await request.put(`${SYNC_URL}/api/save`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { data: code, baseVersion: 0, deviceId: 'zukunft', action: true, schema: SAVE_VERSION + 1 },
  });
  expect(put.status()).toBe(200);

  const context = await browser.newContext({ baseURL, locale: 'de-DE' });
  const page = await context.newPage();
  try {
    await enableSync(context);
    await openGame(page);
    await openSettings(page);
    await account(page).getByLabel('Benutzername').fill(name);
    await account(page).getByLabel('Passwort').fill('geheim-wald-1');
    await account(page).getByRole('button', { name: 'Anmelden' }).click();
    await expect(account(page).locator('[data-ref="account-sync"]')).toContainText('Neue Spielversion – bitte neu laden');
    // Der neuere Stand bleibt unangetastet.
    const res = await request.get(`${SYNC_URL}/api/save`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await res.json()).toMatchObject({ data: code, version: 1, deviceId: 'zukunft', schema: SAVE_VERSION + 1 });
  } finally {
    await context.close();
  }
});

syncTest('Abmelden mit noch nicht gesendeten Änderungen: erst Hinweis, dann trotzdem', async ({ browser, baseURL }) => {
  const name = `ab${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const context = await browser.newContext({ baseURL, locale: 'de-DE' });
  const page = await context.newPage();
  try {
    await enableSync(context);
    await seedV3(context, { totalGrowth: waypoint(6) + 1, seeds: 400, niches: { roots: ['earthworm'], litter: ['robin'] } });
    await openGame(page);
    await openSettings(page);
    await account(page).getByLabel('Benutzername').fill(name);
    await account(page).getByLabel('Passwort').fill('geheim-wald-1');
    await account(page).getByRole('button', { name: 'Konto anlegen' }).click();
    await expect(account(page).locator('[data-ref="account-sync"]')).toHaveText(/Synchronisiert|Gespeichert/);
    await closeSettings(page);

    // Offline eine Aktion: Sie kann nicht gesendet werden.
    await context.setOffline(true);
    await openTab(page, 'pflege');
    await page
      .locator('[data-ref="care"] [data-care="leaf-litter"]')
      .getByRole('button', { name: 'Kaufen (200 🌰)' })
      .click();
    await openSettings(page);
    const signOut = account(page).locator('[data-ref="account-signout"]');
    await signOut.click();
    await expect(account(page).locator('[data-ref="account-status"]')).toContainText('noch nicht im Konto');
    await expect(signOut).toHaveText('Trotzdem abmelden');
    await signOut.click();
    await expect(account(page).locator('[data-ref="account-status"]')).toHaveText(/Abgemeldet/);
    await expect(account(page).getByLabel('Benutzername')).toBeVisible();
  } finally {
    await context.close();
  }
});

syncTest('zwei Tabs, ein Browser: Abmelden und anderes Konto im zweiten Tab halten den ersten an', async ({ browser, baseURL }) => {
  syncTest.slow();
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const context = await browser.newContext({ baseURL, locale: 'de-DE' });
  const tab1 = await context.newPage();
  const tab2 = await context.newPage();
  try {
    await enableSync(context);
    await openGame(tab1);
    await openSettings(tab1);
    await account(tab1).getByLabel('Benutzername').fill(`eins${suffix}`);
    await account(tab1).getByLabel('Passwort').fill('geheim-wald-1');
    await account(tab1).getByRole('button', { name: 'Konto anlegen' }).click();
    await expect(account(tab1).locator('[data-ref="account-who"]')).toHaveText(`Angemeldet als eins${suffix}`);

    // Tab 2 teilt die Sitzung; Abmelden dort meldet auch Tab 1 ab.
    await openGame(tab2);
    await openSettings(tab2);
    await expect(account(tab2).locator('[data-ref="account-who"]')).toHaveText(`Angemeldet als eins${suffix}`);
    await account(tab2).getByRole('button', { name: 'Abmelden' }).click();
    await expect(account(tab2).getByLabel('Benutzername')).toBeVisible();
    await expect(account(tab1).getByLabel('Benutzername')).toBeVisible();

    // Tab 2 meldet sich mit einem anderen Konto an: Tab 1 gleicht nichts mehr ab.
    await account(tab2).getByLabel('Benutzername').fill(`zwei${suffix}`);
    await account(tab2).getByLabel('Passwort').fill('geheim-wald-1');
    await account(tab2).getByRole('button', { name: 'Konto anlegen' }).click();
    await expect(account(tab2).locator('[data-ref="account-who"]')).toHaveText(`Angemeldet als zwei${suffix}`);
    await expect(account(tab1).locator('[data-ref="account-stale"]')).toContainText(`„zwei${suffix}“`);
    await expect(account(tab1).getByRole('button', { name: 'Neu laden' })).toBeVisible();
  } finally {
    await context.close();
  }
});

syncTest('Sicherungen im Konto-Abschnitt wiederherstellen (Liste, mit Bestätigung, rückgängig)', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: 'de-DE' });
  const page = await context.newPage();
  try {
    await enableSync(context);
    const state = createInitialState(Date.now(), 7);
    state.seeds = 4321;
    await context.addInitScript((code) => {
      if (!localStorage.getItem('vszw-backup-before-sync')) localStorage.setItem('vszw-backup-before-sync', code);
    }, exportCode(state));
    await openGame(page);
    expect(await readNumber(seedsValue(page))).toBeLessThan(4321);
    await openSettings(page);
    const open = account(page).locator('[data-ref="account-restore"]');
    await expect(open).toHaveText('Sicherung vor dem Sync wiederherstellen');
    // Die frühere Einzel-Sicherung steht jetzt als Eintrag in der Liste.
    await open.click();
    await expect(account(page)).toContainText('Dein aktueller Wald wird dabei ersetzt.');
    const entries = account(page).locator('[data-ref="account-backup"]');
    await expect(entries).toHaveCount(1);
    await expect(account(page).locator('[data-ref="account-backups"]')).toContainText('Frühere Sicherung');
    await account(page).getByRole('button', { name: 'Abbrechen' }).click();
    expect(await readNumber(seedsValue(page))).toBeLessThan(4321);
    await open.click();
    await entries.first().click();
    await expect(account(page).locator('[data-ref="account-status"]')).toHaveText('Sicherung geladen.');
    await closeSettings(page);
    expect(await readNumber(seedsValue(page))).toBeGreaterThanOrEqual(4321);
    // Auch das Wiederherstellen lässt sich zurücknehmen: der Stand davor wurde gesichert.
    await openSettings(page);
    await open.click();
    await expect(account(page).locator('[data-ref="account-backups"]')).toContainText('Stand vor dem Wiederherstellen');
    await account(page).locator('[data-ref="account-backup"][data-reason="before-restore"]').click();
    await expect(account(page).locator('[data-ref="account-status"]')).toHaveText('Sicherung geladen.');
    await closeSettings(page);
    expect(await readNumber(seedsValue(page))).toBeLessThan(4321);
  } finally {
    await context.close();
  }
});

syncTest('veralteter Tab schreibt nie in den gemeinsamen Spielstand – auch nicht beim Neuladen', async ({ browser, baseURL, request }) => {
  syncTest.slow();
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  // Konto B hat schon einen eigenen Wald mit vielen Samen.
  const registered = await request.post(`${SYNC_URL}/api/register`, { data: { username: `bbb${suffix}`, password: 'geheim-wald-1' } });
  const { token } = (await registered.json()) as { token: string };
  const forestB = createInitialState(Date.now(), 11);
  forestB.seeds = 7777;
  const put = await request.put(`${SYNC_URL}/api/save`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { data: exportCode(forestB), baseVersion: 0, deviceId: 'anderes-geraet', action: true, schema: SAVE_VERSION },
  });
  expect(put.status()).toBe(200);

  const context = await browser.newContext({ baseURL, locale: 'de-DE' });
  const tab1 = await context.newPage();
  const tab2 = await context.newPage();
  try {
    await enableSync(context);
    await seedV3(context, { totalGrowth: waypoint(6) + 1, seeds: 400, niches: { roots: ['earthworm'] } });
    // Tab 1 spielt mit Konto A.
    await openGame(tab1);
    await openSettings(tab1);
    await account(tab1).getByLabel('Benutzername').fill(`aaa${suffix}`);
    await account(tab1).getByLabel('Passwort').fill('geheim-wald-1');
    await account(tab1).getByRole('button', { name: 'Konto anlegen' }).click();
    await expect(account(tab1).locator('[data-ref="account-sync"]')).toHaveText(/Synchronisiert|Gespeichert/);

    // Tab 2: abmelden, mit B anmelden → B's Wald wird geladen.
    await openGame(tab2);
    await openSettings(tab2);
    await account(tab2).getByRole('button', { name: 'Abmelden' }).click();
    await account(tab2).getByLabel('Benutzername').fill(`bbb${suffix}`);
    await account(tab2).getByLabel('Passwort').fill('geheim-wald-1');
    await account(tab2).getByRole('button', { name: 'Anmelden' }).click();
    await expect(tab2.locator('dialog[data-ref="settings"]')).toContainText('Dein Wald aus dem Konto ist geladen');
    await closeSettings(tab2);
    expect(await readNumber(seedsValue(tab2))).toBeGreaterThanOrEqual(7777);

    // Tab 1 ist angehalten: keine Wiederherstellen-Box, nur „Neu laden“ – ohne vorher zu speichern.
    await expect(account(tab1).locator('[data-ref="account-stale"]')).toContainText(`„bbb${suffix}“`);
    await expect(account(tab1).locator('[data-ref="account-restore"]')).toBeHidden();
    await account(tab1).getByRole('button', { name: 'Neu laden' }).click();
    await tab1.waitForLoadState('load');
    await expect(seedsValue(tab1)).toBeVisible();
    expect(await readNumber(seedsValue(tab1))).toBeGreaterThanOrEqual(7777);
    // B's Wald im Konto ist weiter B's Wald.
    await tab1.waitForTimeout(2000);
    const res = await request.get(`${SYNC_URL}/api/save`, { headers: { Authorization: `Bearer ${token}` } });
    const saved = (await res.json()) as { data: string };
    const loaded = importCode(saved.data, Date.now());
    expect(loaded.ok && loaded.result.state.seeds).toBeGreaterThanOrEqual(7777);
  } finally {
    await context.close();
  }
});
