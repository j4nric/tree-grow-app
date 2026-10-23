import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { codeFromJson, exportCode, serialize } from '../src/core/save';
import { createInitialState, createSite, type GameState, type LandscapeSite } from '../src/core/state';
import {
  SAVE_VERSION,
  back,
  expect,
  gotoTab,
  niche,
  openCoverPage,
  openGame,
  openGoalsPage,
  openLandscapeSite,
  openSavePage,
  openTab,
  readNumber,
  savedState,
  seedRaw,
  seedsValue,
  stageLabel,
  stamps,
  subpage,
  test,
  waitForConfirm,
  waypoint,
} from './fixtures';

/**
 * Landschaft und Hauptbäume je Waldtyp (ROADMAP Phase 7, 4a; DESIGN_V2.md 24.5, 25.2):
 * Stammgäste auf dem Hin- und Rückweg zwischen zwei Wäldern, Bergmischwald gründen mit der
 * Weißtanne als Vorauswahl, Abgleich zweier Geräte mit ruhenden Wäldern und ein älteres
 * Spiel, das einen Stand einer neueren Spielversion im Konto weder lädt noch überschreibt
 * (`outdated-client`).
 */

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');
const GROVE = STAGES.findIndex((s) => s.id === 'grove');

/** Spielstand auf Stufe `stage` mit offener Landschaft (Tagebuch mit drei Arten). */
function landscapeState(
  stage: number,
  opts: { own: number; regulars?: string[]; active?: LandscapeSite['id']; sites: LandscapeSite[]; corridors?: string[]; free?: string[] },
): GameState {
  const state = createInitialState(Date.now(), 4242);
  state.stage = stage;
  state.waypoint = STAGES[stage]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.number = 4;
  state.meta.forestMemory = opts.own;
  state.meta.regulars = opts.regulars ?? [];
  state.meta.achievements = ['ancient-forest'];
  state.meta.journal.species = ['earthworm', 'robin', 'bluetit'];
  state.meta.landscape = {
    active: opts.active ?? 'home',
    sites: opts.sites,
    corridors: opts.corridors ?? [],
    freeCorridors: opts.free ?? [],
    announced: true,
  };
  return state;
}

const cyclePage = (page: Page) => page.locator('[data-ref="page-cycle"]');
const regular = (page: Page, id: string) => cyclePage(page).locator(`[data-ref="regulars"] [data-regular="${id}"]`);
const treeRadio = (page: Page, id: string) => cyclePage(page).locator(`[data-ref="tree-choice"] input[data-tree="${id}"]`);
type Site = { id: string; memory: number; regulars: string[]; mainTree: string };
const siteOf = (save: Record<string, any>, id: string): Site => save.meta.landscape.sites.find((s: Site) => s.id === id);

/** Karte → U:Standort → „Als Ziel wählen“ → U:Neuer Zyklus; zwei Klicks auf den Knopf. */
async function switchTo(page: Page, site: string, buttonText: string, stampText: string): Promise<void> {
  const detail = await openLandscapeSite(page, site);
  const choose = detail.locator('[data-ref="site-choose"]');
  await choose.click();
  await expect(choose).toHaveAttribute('aria-pressed', 'true');
  await detail.locator('[data-ref="site-cycle-open"]').click();
  await expect(cyclePage(page)).not.toHaveAttribute('inert', '');
  const button = cyclePage(page).locator('[data-ref="new-cycle"]');
  await expect(button).toHaveText(buttonText);
  await button.click();
  await waitForConfirm(page);
  await button.click();
  await expect(stamps(page)).toContainText(stampText);
  // Die Seite blättert zurück zu „Ziele“.
  await expect(cyclePage(page)).toBeHidden();
}

test('Stammgäste auf dem Hin- und Rückweg: jeder Wald behält seine', async ({ page, context }) => {
  test.slow();
  // Heimatwald (aktiv, Hain) mit dem Regenwurm; im ruhenden Auwald wartet das Rotkehlchen.
  const home: LandscapeSite = { ...createSite('home'), ancient: true };
  const flood: LandscapeSite = { ...createSite('floodplain'), memory: 100, regulars: ['robin'] };
  await seedRaw(
    context,
    landscapeState(GROVE, { own: 300, regulars: ['earthworm'], sites: [home, flood], corridors: ['home-floodplain'], free: ['home-floodplain'] }),
    0,
  );
  await gotoTab(page, 'landschaft');

  // Hinweg: Der Heimatwald parkt seinen Stammgast, der Auwald bringt seinen zurück.
  await switchTo(page, 'floodplain', 'Neuen Zyklus beginnen: Auwald am Fluss', 'Du wächst jetzt in: 🌊 Auwald am Fluss');
  let save = await savedState(page);
  expect(save.meta.landscape.active).toBe('floodplain');
  expect(save.meta.regulars).toEqual(['robin']);
  expect(siteOf(save, 'home').regulars).toEqual(['earthworm']);
  expect(siteOf(save, 'floodplain').regulars).toEqual([]);
  // Im Auwald einen zweiten Stammgast wählen.
  await openGoalsPage(page, 'cycle');
  await expect(regular(page, 'robin')).toHaveAttribute('aria-pressed', 'true');
  await expect(regular(page, 'earthworm')).toHaveAttribute('aria-pressed', 'false');
  await regular(page, 'bluetit').click();
  await expect(regular(page, 'bluetit')).toHaveAttribute('aria-pressed', 'true');
  // Der ruhende Heimatwald zeigt seinen geparkten Stammgast.
  const homeSite = await openLandscapeSite(page, 'home');
  await expect(homeSite.locator('[data-ref="site-diary"] [data-row="regulars"]')).toContainText('Regenwurm');
  await back(page);

  // Der Auwald wächst bis zum Hain: als Import desselben Stands auf Stufe Hain (Abkürzung
  // für Minuten Spielzeit; Import ist ein echter Weg in das Spiel).
  await page.reload();
  await expect(stageLabel(page)).toContainText('Stufe:');
  save = await savedState(page);
  expect(save.meta.regulars).toEqual(['robin', 'bluetit']);
  save.stage = GROVE;
  save.waypoint = STAGES[GROVE]!.waypoint;
  save.totalGrowth = waypoint(save.waypoint) + 1;
  await openSavePage(page);
  const transfer = page.locator('[data-ref="save-transfer"]');
  await transfer.locator('[data-ref="import-code"]').fill(codeFromJson(JSON.stringify(save)));
  const importButton = transfer.locator('[data-ref="import"]');
  await importButton.click();
  await waitForConfirm(page);
  await importButton.click();
  await expect(transfer.locator('[data-ref="save-status"]')).toHaveText('Spielstand geladen.');
  await expect(stageLabel(page)).toHaveText('Stufe: Hain');
  await page.keyboard.press('Escape');

  // Rückweg: Der Heimatwald bekommt den Regenwurm zurück, der Auwald parkt beide Vögel.
  await openTab(page, 'landschaft');
  await switchTo(page, 'home', 'Neuen Zyklus beginnen: Heimatwald', 'Du wächst jetzt in: 🌳 Heimatwald');
  save = await savedState(page);
  expect(save.meta.landscape.active).toBe('home');
  expect(save.meta.regulars).toEqual(['earthworm']);
  expect(siteOf(save, 'home').regulars).toEqual([]);
  expect(siteOf(save, 'floodplain').regulars).toEqual(['robin', 'bluetit']);
  const floodSite = await openLandscapeSite(page, 'floodplain');
  await expect(floodSite.locator('[data-ref="site-diary"] [data-row="regulars"]')).toContainText('Rotkehlchen');
  await expect(floodSite.locator('[data-ref="site-diary"] [data-row="regulars"]')).toContainText('Blaumeise');

  // Nach dem Neuladen bleibt alles, und der Regenwurm zieht ab dem Keimling von selbst ein.
  await page.reload();
  await openTab(page, 'nischen');
  await expect(niche(page, 'roots')).toContainText('Regenwurm', { timeout: 30_000 });
  save = await savedState(page);
  expect(save.meta.regulars).toEqual(['earthworm']);
  expect(siteOf(save, 'floodplain').regulars).toEqual(['robin', 'bluetit']);
});

test('Bergmischwald gründen: Weißtanne vorausgewählt, nach dem Neuladen wächst sie', async ({ page, context }) => {
  // Urwald im Heimatwald: 2 + 3 = 5 Hähersaat, Gründen kostet 3.
  await seedRaw(context, landscapeState(ANCIENT, { own: 300, sites: [{ ...createSite('home'), ancient: true }] }), 0);
  await gotoTab(page, 'ziele');

  // Ohne Ziel: Weißtanne sichtbar, aber gesperrt; die Eiche des laufenden Zyklus ist gewählt.
  await openGoalsPage(page, 'cycle');
  await expect(treeRadio(page, 'fir')).toBeDisabled();
  await expect(cyclePage(page).locator('[data-ref="tree-choice"] [data-tree="fir"].locked')).toBeVisible();
  await expect(treeRadio(page, 'oak')).toBeChecked();

  // Ziel Bergmischwald: Der Leitbaum ist frei und vorausgewählt.
  const site = await openLandscapeSite(page, 'mountain');
  await site.locator('[data-ref="site-choose"]').click();
  await site.locator('[data-ref="site-cycle-open"]').click();
  await expect(cyclePage(page)).not.toHaveAttribute('inert', '');
  await expect(treeRadio(page, 'fir')).toBeEnabled();
  await expect(treeRadio(page, 'fir')).toBeChecked();
  await expect(treeRadio(page, 'oak')).not.toBeChecked();
  const button = cyclePage(page).locator('[data-ref="new-cycle"]');
  await expect(button).toHaveText('Bergmischwald gründen (3 🪶)');
  await button.click();
  await waitForConfirm(page);
  await button.click();
  await expect(stamps(page)).toContainText('Neuer Wald gegründet: ⛰️ Bergmischwald');

  const after = await savedState(page);
  expect(after.version).toBe(SAVE_VERSION);
  expect(after.cycle.mainTree).toBe('fir');
  expect(after.meta.landscape.active).toBe('mountain');
  expect(siteOf(after, 'mountain').mainTree).toBe('fir');
  expect(siteOf(after, 'home').mainTree).toBe('oak');
  expect(after.meta.stats.grownTrees).toContain('fir');

  // Neuladen: Die Weißtanne bleibt der Hauptbaum und wächst weiter.
  await page.reload();
  await expect(stageLabel(page)).toContainText('Stufe:');
  await openTab(page, 'ziele');
  await expect(page.locator('[data-ref="cycle-card-sub"]')).toContainText('⛰️ Bergmischwald');
  await expect(page.locator('[data-ref="cycle-card-sub"]')).toContainText('Hauptbaum 🎄 Weißtanne');
  await expect(page.locator('[data-ref="growth-rate"]')).not.toHaveText('0/s');
  await expect(stageLabel(page)).not.toHaveText('Stufe: Samen', { timeout: 30_000 });
  const grown = await savedState(page);
  expect(grown.cycle.mainTree).toBe('fir');
  // Gespeichert wird beim Verlassen bzw. regelmäßig – die Stufe ist weiter.
  await page.reload();
  await expect(stageLabel(page)).not.toHaveText('Stufe: Samen');
  expect((await savedState(page)).cycle.mainTree).toBe('fir');
});

// --- Konto: zwei Geräte und ein älteres Spiel ---------------------------------------------

declare const process: { env: Record<string, string | undefined> };
const SYNC_URL = `http://localhost:${Number(process.env.E2E_SYNC_PORT ?? Number(process.env.E2E_PORT ?? 4173) + 1)}`;

/**
 * Wie `test` aus den Fixtures (keine Konsolenfehler), aber 401/409/422 vom Sync-Server sind
 * hier erwartet (Chromium meldet sie als „Failed to load resource“); 422 ist `outdated-client`.
 */
const syncTest = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on('console', (msg) => {
        if (msg.type() === 'error' && !/status of (40[19]|422)/.test(msg.text())) errors.push(`console: ${msg.text()}`);
      });
      context.on('weberror', (err) => errors.push(`pageerror: ${err.error().message}`));
      await use(errors);
      expect(errors, 'Konsolen- oder Seitenfehler').toEqual([]);
    },
    { auto: true },
  ],
});

async function prepare(context: BrowserContext, options: { eventSource?: boolean } = {}): Promise<void> {
  await context.addInitScript(
    ({ url, eventSource }) => {
      (window as unknown as { __VSZW_SYNC_URL__: string }).__VSZW_SYNC_URL__ = url;
      // Ohne Live-Abo erfährt das Spiel erst beim Senden vom neueren Stand (422).
      if (!eventSource) delete (window as unknown as { EventSource?: unknown }).EventSource;
      // Wie in den Fixtures: Tagesziele aus, Haftnotiz „Neu hier?“ gesehen.
      (window as unknown as { __VSZW_DAILY__: boolean }).__VSZW_DAILY__ = false;
      try {
        localStorage.setItem('tree-grow-guide-hint-seen', '1');
      } catch {
        // ohne Speicher
      }
    },
    { url: SYNC_URL, eventSource: options.eventSource ?? true },
  );
}

const account = (page: Page) => page.locator('[data-ref="account"]');
const uniqueName = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function signIn(page: Page, name: string, button: 'Konto anlegen' | 'Anmelden'): Promise<void> {
  await openCoverPage(page, 'account');
  await account(page).getByLabel('Benutzername').fill(name);
  await account(page).getByLabel('Passwort').fill('geheim-wald-1');
  await account(page).getByRole('button', { name: button }).click();
  await expect(account(page).locator('[data-ref="account-who"]')).toHaveText(`Angemeldet als ${name}`);
}

async function closeAccount(page: Page): Promise<void> {
  await subpage(page, 'account').locator('[data-ref="bookmark"]').click();
  await expect(subpage(page, 'account')).toBeHidden();
  await page.locator('[data-ref="cover-close"]').click();
  await expect(page.locator('[data-ref="cover"]')).toBeHidden();
}

/** Auwald aktiv (Hain); ruhend: Heimatwald (Urwald, Regenwurm) und Bergmischwald (Weißtanne, Rotkehlchen). */
function restingForests(): GameState {
  return landscapeState(GROVE, {
    own: 120,
    active: 'floodplain',
    sites: [
      { ...createSite('home'), memory: 600, ancient: true, regulars: ['earthworm'], fauna: ['earthworm', 'robin'] },
      createSite('floodplain'),
      { ...createSite('mountain', 'fir'), memory: 100, regulars: ['robin'] },
    ],
    corridors: ['home-floodplain', 'home-mountain'],
    free: ['home-floodplain', 'home-mountain'],
  });
}

syncTest('zwei Geräte mit ruhenden Wäldern: B übernimmt sie, ein Wechsel in A kommt in B an', async ({ browser, baseURL }) => {
  syncTest.slow();
  const name = uniqueName('land');
  const contextA = await browser.newContext({ baseURL, locale: 'de-DE' });
  const contextB = await browser.newContext({ baseURL, locale: 'de-DE' });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  try {
    await prepare(contextA);
    await prepare(contextB);
    await seedRaw(contextA, restingForests(), 0);
    await openGame(a);
    await openGame(b);
    await signIn(a, name, 'Konto anlegen');
    await expect(account(a).locator('[data-ref="account-sync"]')).toHaveText(/Synchronisiert|Gespeichert/);
    await closeAccount(a);

    // B übernimmt den Stand aus dem Konto – mit allen ruhenden Wäldern.
    await signIn(b, name, 'Anmelden');
    await expect(stamps(b)).toContainText('Dein Wald aus dem Konto ist geladen');
    await closeAccount(b);
    const taken = await savedState(b);
    expect(taken.meta.landscape.active).toBe('floodplain');
    expect(siteOf(taken, 'home')).toMatchObject({ memory: 600, regulars: ['earthworm'] });
    expect(siteOf(taken, 'mountain')).toMatchObject({ memory: 100, regulars: ['robin'], mainTree: 'fir' });
    const mountainB = await openLandscapeSite(b, 'mountain');
    await expect(mountainB.locator('[data-ref="site-diary"] [data-row="regulars"]')).toContainText('Rotkehlchen');
    await back(b);
    // Tagebuch der Wälder: Gedächtnis des ruhenden Heimatwalds ist mitgekommen.
    await expect(b.locator('[data-ref="landscape-diary"] li[data-forest="home"] [data-row="memory"]')).toContainText('600 eigen');

    // A wechselt in den ruhenden Bergmischwald – vorausgewählt ist die Weißtanne von dort.
    await openTab(a, 'landschaft');
    const mountainA = await openLandscapeSite(a, 'mountain');
    await mountainA.locator('[data-ref="site-choose"]').click();
    await mountainA.locator('[data-ref="site-cycle-open"]').click();
    await expect(cyclePage(a)).not.toHaveAttribute('inert', '');
    await expect(treeRadio(a, 'fir')).toBeChecked();
    const button = cyclePage(a).locator('[data-ref="new-cycle"]');
    await expect(button).toHaveText('Neuen Zyklus beginnen: Bergmischwald');
    await button.click();
    await waitForConfirm(a);
    await button.click();
    await expect(stamps(a)).toContainText('Du wächst jetzt in: ⛰️ Bergmischwald');

    // B übernimmt den Wechsel live: Bergmischwald aktiv, der Auwald ruht jetzt.
    await expect(stamps(b)).toContainText('Auf anderem Gerät weitergespielt – übernommen.', { timeout: 20_000 });
    await openTab(b, 'ziele');
    await expect(b.locator('[data-ref="cycle-card-sub"]')).toContainText('⛰️ Bergmischwald');
    await expect(b.locator('[data-ref="cycle-card-sub"]')).toContainText('Weißtanne');
    const switched = await savedState(b);
    expect(switched.meta.landscape.active).toBe('mountain');
    expect(switched.meta.regulars).toEqual(['robin']);
    expect(switched.cycle.mainTree).toBe('fir');
    expect(siteOf(switched, 'home')).toMatchObject({ memory: 600, regulars: ['earthworm'] });
    expect(siteOf(switched, 'floodplain').memory).toBeGreaterThanOrEqual(120);
    expect(switched.meta.landscape.sites.map((s: Site) => s.id)).toEqual(['home', 'floodplain', 'mountain']);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

/** Legt über die API ein Konto an; liefert das Token. */
async function register(request: import('@playwright/test').APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${SYNC_URL}/api/register`, { data: { username: name, password: 'geheim-wald-1' } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

/** Stand einer neueren Spielversion (SAVE_VERSION + 1) mit Bergmischwald und Weißtanne. */
function futureCode(): string {
  const state = restingForests();
  state.seeds = 9999;
  const json = JSON.parse(serialize(state)) as Record<string, unknown>;
  json.version = SAVE_VERSION + 1;
  return codeFromJson(JSON.stringify(json));
}

for (const live of [true, false]) {
  syncTest(
    `älteres Spiel, neuerer Stand im Konto (${live ? 'Live-Meldung' : 'erst beim Senden: 422 outdated-client'}): nicht laden, nicht überschreiben`,
    async ({ browser, baseURL, request }) => {
      syncTest.slow();
      const name = uniqueName(live ? 'alt' : 'altput');
      const context = await browser.newContext({ baseURL, locale: 'de-DE' });
      const page = await context.newPage();
      try {
        await prepare(context, { eventSource: live });
        const own = createInitialState(Date.now(), 21);
        own.seeds = 400;
        // Junger Baum: Laubstreu (200 🌰) ist kaufbar.
        own.stage = STAGES.findIndex((s) => s.id === 'young-tree');
        own.waypoint = STAGES[own.stage]!.waypoint;
        own.totalGrowth = waypoint(own.waypoint) + 1;
        await seedRaw(context, own, 0);
        await openGame(page);
        await signIn(page, name, 'Konto anlegen');
        const sync = account(page).locator('[data-ref="account-sync"]');
        await expect(sync).toHaveText(/Synchronisiert|Gespeichert/);

        // Ein Gerät mit der neueren Spielversion speichert seinen Stand im Konto.
        // Sitzung des Spiels mitbenutzen (spart eine Anmeldung – die Grenze je IP ist knapp).
        const token = await page.evaluate(() => (JSON.parse(localStorage.getItem('vszw-session') ?? '{}') as { token: string }).token);
        expect(token).toBeTruthy();
        const headers = { Authorization: `Bearer ${token}` };
        const code = futureCode();
        // Schreibt das Spiel gerade selbst (409), mit der neuen Version noch einmal.
        const stored = { version: 0 };
        await expect(async () => {
          const current = (await (await request.get(`${SYNC_URL}/api/save`, { headers })).json()) as { version: number };
          const put = await request.put(`${SYNC_URL}/api/save`, {
            headers,
            data: { data: code, baseVersion: current.version, deviceId: 'neueres-geraet', action: true, schema: SAVE_VERSION + 1 },
          });
          expect(put.status()).toBe(200);
          stored.version = ((await put.json()) as { version: number }).version;
        }).toPass({ timeout: 10_000 });
        const version = stored.version;

        // Live: Die Änderungsmeldung nennt die neuere Version → sofort anhalten. Ohne Abo: Die
        // nächste Aktion will senden, der Server lehnt mit 422 `outdated-client` ab.
        await closeAccount(page);
        await openTab(page, 'pflege');
        await page.locator('[data-ref="care"] [data-care="leaf-litter"]').getByRole('button', { name: 'Kaufen (200 🌰)' }).click();
        await openCoverPage(page, 'account');
        await expect(sync).toContainText('Neue Spielversion – bitte neu laden', { timeout: 20_000 });

        // Der eigene Wald bleibt (nichts übernommen), der neuere Stand im Konto unangetastet.
        expect(await readNumber(seedsValue(page))).toBeLessThan(9999);
        const res = await request.get(`${SYNC_URL}/api/save`, { headers });
        expect(await res.json()).toMatchObject({ data: code, version: version, deviceId: 'neueres-geraet', schema: SAVE_VERSION + 1 });

        // Auch nach dem Neuladen lädt das ältere Spiel den neueren Stand nicht.
        await page.reload();
        await expect(stageLabel(page)).toContainText('Stufe:');
        await openCoverPage(page, 'account');
        await expect(sync).toContainText('Neue Spielversion – bitte neu laden', { timeout: 20_000 });
        expect(await readNumber(seedsValue(page))).toBeLessThan(9999);
        expect((await savedState(page)).meta.landscape?.active ?? 'home').toBe('home');
        const again = await request.get(`${SYNC_URL}/api/save`, { headers });
        expect(await again.json()).toMatchObject({ data: code, version: version, schema: SAVE_VERSION + 1 });
      } finally {
        await context.close();
      }
    },
  );
}

syncTest('Server: ein v14-Spiel darf einen v15-Stand nicht überschreiben (422 outdated-client)', async ({ request }) => {
  const token = await register(request, uniqueName('v14'));
  const headers = { Authorization: `Bearer ${token}` };
  // Ein v15-Gerät (SAVE_VERSION) hat gespeichert – mit Bergmischwald und Weißtanne.
  const put = await request.put(`${SYNC_URL}/api/save`, {
    headers,
    data: { data: exportCode(restingForests()), baseVersion: 0, deviceId: 'v15', action: true, schema: SAVE_VERSION },
  });
  expect(put.status()).toBe(200);
  const { version } = (await put.json()) as { version: number };
  const old = await request.put(`${SYNC_URL}/api/save`, {
    headers,
    data: { data: exportCode(createInitialState(0, 1)), baseVersion: version, deviceId: 'v14', action: true, schema: SAVE_VERSION - 1 },
  });
  expect(old.status()).toBe(422);
  expect(await old.json()).toMatchObject({ error: 'outdated-client', schema: SAVE_VERSION });
  const res = await request.get(`${SYNC_URL}/api/save`, { headers });
  expect(await res.json()).toMatchObject({ version, deviceId: 'v15', schema: SAVE_VERSION });
});
