import type { BrowserContext } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, createSite, type GameState, type LandscapeSite } from '../src/core/state';
import {
  expect,
  gotoTab,
  openCoverPage,
  openGame,
  openGoalsPage,
  openTab,
  overlaps,
  savedState,
  seedRaw,
  stamps,
  subpage,
  tabButton,
  test,
  waitForConfirm,
  waypoint,
} from './fixtures';

/**
 * Karte der Landschaft (DESIGN_V2.md 24.5, 24.6): Freischaltung, Gründen, Wechseln,
 * Korridor bauen. Spielstände als v14 direkt aus createInitialState (fester Seed).
 */

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');
const GROVE = STAGES.findIndex((s) => s.id === 'grove');

/** Spielstand auf Stufe `stage` mit Landschaft. */
function landscapeState(
  stage: number,
  opts: { own: number; active?: LandscapeSite['id']; sites?: LandscapeSite[]; corridors?: string[]; free?: string[]; announced?: boolean },
): GameState {
  const state = createInitialState(Date.now(), 4242);
  state.stage = stage;
  state.waypoint = STAGES[stage]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.number = 4;
  state.meta.forestMemory = opts.own;
  state.meta.achievements = ['ancient-forest'];
  const active = opts.active ?? 'home';
  const sites = opts.sites ?? [{ ...createSite('home'), ancient: true }];
  state.meta.landscape = { active, sites, corridors: opts.corridors ?? [], freeCorridors: opts.free ?? [], announced: opts.announced ?? true };
  return state;
}

async function seed(context: BrowserContext, state: GameState): Promise<void> {
  await seedRaw(context, state, 0);
}

/** Unterseite „Neuer Zyklus“ (Reiter „Ziele“); das Ziel aus der Karte gilt für ihren Knopf. */
const panel = (page: import('@playwright/test').Page) => page.locator('[data-ref="page-cycle"]');

test('Freischaltung beim Laden, dann aus dem Urwald den Auwald gründen', async ({ page, context }) => {
  await seed(context, landscapeState(ANCIENT, { own: 300, announced: false }));
  await openGame(page);
  // Meldung der Freischaltung (einmal).
  await expect(stamps(page)).toContainText('Eichelhäher');
  // Der Reiter „Landschaft“ ist erschienen.
  await openTab(page, 'landschaft');
  const map = page.locator('[data-ref="landscape"]');
  await expect(map).toBeVisible();
  await expect(map.locator('[data-ref="jay-seeds"]')).toContainText('🪶 5 Hähersaat');
  // Heimatwald ist „hier“, die übrigen sind wählbar (gründen · 3 🪶).
  await expect(map.locator('[data-site="home"]')).toContainText('hier');
  await expect(map.locator('[data-site="home"]')).toHaveAttribute('aria-current', 'location');
  const flood = map.locator('[data-site="floodplain"]');
  await expect(flood).toContainText('gründen · 3 🪶');
  await flood.click();
  await expect(flood).toHaveAccessibleName(/Ziel des nächsten Zyklus/);
  await expect(map.locator('[data-ref="landscape-live"]')).toHaveText('Auwald am Fluss: Ziel des nächsten Zyklus.');
  const detail = map.locator('[data-ref="site-detail"]');
  await expect(detail).toContainText('Auwald am Fluss');
  await expect(detail).toContainText('Verzicht (nur hier): Pilze −15 % 😊');
  await expect(detail).toContainText('Gabe (nach der Gründung): Ab Alter Baum +1 Platz Waldtümpel in allen Wäldern');
  await expect(map.locator('[data-ref="landscape-target"]')).toContainText('neuer Wald für 3 🪶');

  await openGoalsPage(page, 'cycle');
  const button = panel(page).locator('[data-ref="new-cycle"]');
  await expect(button).toHaveText('Auwald am Fluss gründen (3 🪶)');
  await expect(panel(page).locator('[data-ref="cycle-target"]')).toContainText('neuer Wald für 3 🪶');
  await button.click();
  await waitForConfirm(page);
  await button.click();
  await expect(stamps(page)).toContainText('Neuer Wald gegründet: 🌊 Auwald am Fluss');

  const after = await savedState(page);
  expect(after.meta.landscape.active).toBe('floodplain');
  expect(after.meta.landscape.sites.map((s: { id: string }) => s.id)).toEqual(['home', 'floodplain']);
  expect(after.meta.landscape.freeCorridors).toEqual(['home-floodplain']);
  expect(after.meta.forestMemory).toBe(0);
  await expect(page.locator('[data-ref="cycle-card-sub"]')).toContainText('🌊 Auwald am Fluss');
  await expect(map.locator('[data-site="floodplain"]')).toContainText('hier');
  // Der Gratis-Korridor steht in der Liste – ohne Kaufknopf.
  await openTab(page, 'landschaft');
  const corridor = map.locator('li[data-corridor="home-floodplain"]');
  await expect(corridor).toBeVisible();
  await expect(corridor).toContainText('Weg der Häher, gratis');
  await expect(corridor.locator('button')).toBeHidden();
  // Spielanleitung: jetzt der ganze Abschnitt.
  await openCoverPage(page, 'guide');
  await subpage(page, 'guide').locator('[data-chapter="landscape"]').click();
  await expect(page.locator('[data-section="landscape"]')).toContainText('Waldlandschaft und Hähersaat');
  await page.keyboard.press('Escape');
  // Nach dem Neuladen keine zweite Meldung.
  await page.reload();
  await expect(page.locator('[data-ref="stage"]')).toContainText('Stufe:');
  await page.waitForTimeout(500);
  await expect(stamps(page)).not.toContainText('Eichelhäher');
});

test('vom Hain aus zurück in den Heimatwald wechseln: Gedächtnis kommt mit', async ({ page, context }) => {
  const home: LandscapeSite = { ...createSite('home'), memory: 320, ancient: true, regulars: [] };
  const flood: LandscapeSite = { ...createSite('floodplain'), memory: 0 };
  await seed(
    context,
    landscapeState(GROVE, { own: 40, active: 'floodplain', sites: [home, flood], corridors: ['home-floodplain'], free: ['home-floodplain'] }),
  );
  await gotoTab(page, 'landschaft');
  const map = page.locator('[data-ref="landscape"]');
  await expect(map).toBeVisible();
  // Gründen geht nur aus dem Urwald – mit Grund als Text.
  await map.locator('[data-site="mountain"]').click();
  await expect(map.locator('[data-ref="site-blocker"]')).toContainText('Nur aus dem Urwald');
  const button = panel(page).locator('[data-ref="new-cycle"]');
  await openGoalsPage(page, 'cycle');
  await expect(button).toHaveText('Neuen Zyklus beginnen');
  await openTab(page, 'landschaft');
  // Wechsel zum Heimatwald per Tastatur.
  // Erst wenn die Seite nach dem Zurückblättern wieder bedienbar ist (nicht mehr inert).
  const homeSite = map.locator('[data-site="home"]');
  await expect(async () => {
    await homeSite.focus();
    await expect(homeSite).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press('Enter');
  // Wirksam heute (320 + ½ · 40, wie im Tagebuch) – der Gewinn dieses Zyklus steht benannt dahinter.
  await expect(map.locator('[data-ref="site-memory"]')).toHaveText(/^Gedächtnis 320 eigen · 340 wirksam dort( \(nach diesem Zyklus \d+\))?$/);
  await openGoalsPage(page, 'cycle');
  await expect(button).toHaveText('Neuen Zyklus beginnen: Heimatwald');
  await button.click();
  await waitForConfirm(page);
  await button.click();
  await expect(stamps(page)).toContainText('Du wächst jetzt in: 🌳 Heimatwald');
  const after = await savedState(page);
  expect(after.meta.landscape.active).toBe('home');
  expect(after.meta.forestMemory).toBe(320);
  const parked = after.meta.landscape.sites.find((s: { id: string }) => s.id === 'floodplain');
  expect(parked.memory).toBeGreaterThanOrEqual(40);
});

test('Korridor bauen: Altwasser zwischen Auwald und Erlenbruch', async ({ page, context }) => {
  const flood: LandscapeSite = { ...createSite('floodplain'), memory: 300 };
  const carr: LandscapeSite = { ...createSite('carr'), memory: 200, ancient: true };
  await seed(
    context,
    landscapeState(GROVE - 2, {
      own: 600,
      sites: [{ ...createSite('home'), ancient: true }, flood, carr],
      corridors: ['home-floodplain', 'home-carr'],
      free: ['home-floodplain', 'home-carr'],
    }),
  );
  await gotoTab(page, 'landschaft');
  const map = page.locator('[data-ref="landscape"]');
  // Verdient 6 + 2 + 3 + 2 + 2 = 15, ausgegeben 3 + 5 = 8.
  await expect(map.locator('[data-ref="jay-seeds"]')).toHaveText('🪶 7 Hähersaat');
  const row = map.locator('li[data-corridor="floodplain-carr"]');
  await expect(row).toBeVisible();
  const build = row.getByRole('button', { name: 'Altwasser bauen, 3 Hähersaat' });
  await expect(build).toBeEnabled();
  // Korridore zu nicht gegründeten Wäldern stehen nicht in der Liste.
  await expect(map.locator('li[data-corridor="home-heath"]')).toBeHidden();
  // Zwei Klicks: Hähersaat ist knapp, der Bau dauerhaft.
  await build.click();
  const armed = row.getByRole('button', { name: 'Altwasser wirklich bauen? Zum Bestätigen erneut klicken' });
  await expect(armed).toBeVisible();
  expect((await savedState(page)).meta.landscape.corridors).not.toContain('floodplain-carr');
  await waitForConfirm(page);
  await armed.click();
  await expect(stamps(page)).toContainText('Altwasser gebaut');
  await expect(map.locator('[data-ref="jay-seeds"]')).toHaveText('🪶 4 Hähersaat');
  await expect(row).toContainText('verbunden');
  const after = await savedState(page);
  expect(after.meta.landscape.corridors).toContain('floodplain-carr');
  expect(after.meta.landscape.freeCorridors).not.toContain('floodplain-carr');
});

for (const [width, height, scale, font] of [
  [360, 780, 1, ''],
  [360, 780, 1.1, ''],
  [360, 780, 1.25, ''],
  [390, 844, 1, ''],
  [1280, 720, 1, ''],
  [1280, 720, 1.1, ''],
  // Breite Schrift wie auf Linux-Runnern ohne Inter.
  [360, 780, 1.1, 'DejaVu Sans'],
  [1280, 720, 1.1, 'DejaVu Sans'],
] as const) test(`${width} px, Schrift ${scale * 100} %${font ? ` ${font}` : ''}: Karte ohne Querscrollen, Standorte ≥ 44 px ohne Überlappung`, async ({ page, context }) => {
  await page.setViewportSize({ width, height });
  await seed(context, landscapeState(ANCIENT, { own: 300 }));
  await gotoTab(page, 'landschaft');
  // Größere Schrift (andere Schriftbreiten auf anderen Systemen): Knöpfe werden höher.
  await page.evaluate((s) => (document.documentElement.style.fontSize = `${s * 100}%`), scale);
  if (font) await page.addStyleTag({ content: `:root, body, button { font-family: '${font}', sans-serif !important; }` });
  const map = page.locator('[data-ref="landscape-map"]');
  await map.scrollIntoViewIfNeeded();
  await expect(map).toBeVisible();
  const box = (await map.boundingBox())!;
  for (const id of ['home', 'floodplain', 'carr', 'beechwood', 'mountain', 'heath']) {
    const b = (await map.locator(`[data-site="${id}"]`).boundingBox())!;
    expect(b.height, id).toBeGreaterThanOrEqual(44);
    expect(b.width, id).toBeGreaterThanOrEqual(44);
    expect(b.x, id).toBeGreaterThanOrEqual(box.x - 1);
    expect(b.x + b.width, id).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const boxes = await Promise.all(['home', 'floodplain', 'carr', 'beechwood', 'mountain', 'heath'].map(async (id) => (await map.locator(`[data-site="${id}"]`).boundingBox())!));
  // Mindestens 4 px Abstand zwischen den Knöpfen (auch keine 1-px-Überlappung).
  const grow = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4 });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(grow(boxes[i]!), grow(boxes[j]!)), `${i}/${j}`).toBe(false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Hain mit genug Gedächtnis nach diesem Zyklus, aber noch nicht frei: keine Karte (Spoiler)', async ({ page, context }) => {
  // Erfolg da, Gedächtnis nach dem Zyklus über der Schwelle – aber nicht im Urwald.
  const state = landscapeState(GROVE, { own: 249, announced: false });
  state.cycle.maxHarmony = 200;
  await seed(context, state);
  await gotoTab(page, 'ziele');
  await openGoalsPage(page, 'cycle');
  await expect(panel(page).locator('[data-ref="new-cycle"]')).toBeVisible();
  await expect(panel(page).locator('[data-ref="cycle-target"]')).toBeHidden();
  await expect(page.locator('[data-ref="landscape"]')).toBeHidden();
  await expect(tabButton(page, 'landschaft')).toBeHidden();
});

test('vor der Freischaltung: keine Karte', async ({ page, context }) => {
  const state = landscapeState(ANCIENT, { own: 100 });
  await seed(context, state);
  await gotoTab(page, 'ziele');
  await openGoalsPage(page, 'cycle');
  await expect(panel(page).locator('[data-ref="new-cycle"]')).toBeVisible();
  await expect(panel(page).locator('[data-ref="cycle-target"]')).toBeHidden();
  await expect(page.locator('[data-ref="landscape"]')).toBeHidden();
  await expect(tabButton(page, 'landschaft')).toBeHidden();
});
