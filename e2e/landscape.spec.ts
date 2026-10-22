import type { BrowserContext } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, createSite, type GameState, type LandscapeSite } from '../src/core/state';
import { expect, openGame, savedState, seedRaw, test, waitForConfirm, waypoint } from './fixtures';

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

const panel = (page: import('@playwright/test').Page) => page.locator('[data-ref="cycle-panel"]');

test('Freischaltung beim Laden, dann aus dem Urwald den Auwald gründen', async ({ page, context }) => {
  await seed(context, landscapeState(ANCIENT, { own: 300, announced: false }));
  await openGame(page);
  // Meldung der Freischaltung (einmal).
  await expect(page.locator('#toast')).toContainText('Eichelhäher');
  const map = panel(page).locator('[data-ref="landscape"]');
  await expect(map).toBeVisible();
  await expect(map.locator('[data-ref="jay-seeds"]')).toContainText('🪶 5 Hähersaat');
  // Heimatwald ist „hier“, die übrigen sind wählbar (gründen · 3 🪶).
  await expect(map.locator('[data-site="home"]')).toContainText('hier');
  await expect(map.locator('[data-site="home"]')).toHaveAttribute('aria-current', 'location');
  const flood = map.locator('[data-site="floodplain"]');
  await expect(flood).toContainText('gründen · 3 🪶');
  await flood.click();
  await expect(flood).toHaveAttribute('aria-pressed', 'true');
  const detail = map.locator('[data-ref="site-detail"]');
  await expect(detail).toContainText('Auwald am Fluss');
  await expect(detail).toContainText('Verzicht (nur hier): Pilze −15 % 😊');
  await expect(detail).toContainText('Gabe (nach der Gründung): Ab Alter Baum +1 Platz Waldtümpel in allen Wäldern');
  await expect(map.locator('[data-ref="landscape-target"]')).toContainText('neuer Wald für 3 🪶');

  const button = panel(page).locator('[data-ref="new-cycle"]');
  await expect(button).toHaveText('Auwald am Fluss gründen (3 🪶)');
  await button.click();
  await waitForConfirm(page);
  await button.click();
  await expect(page.locator('#toast')).toContainText('Neuer Wald gegründet: 🌊 Auwald am Fluss');

  const after = await savedState(page);
  expect(after.meta.landscape.active).toBe('floodplain');
  expect(after.meta.landscape.sites.map((s: { id: string }) => s.id)).toEqual(['home', 'floodplain']);
  expect(after.meta.landscape.freeCorridors).toEqual(['home-floodplain']);
  expect(after.meta.forestMemory).toBe(0);
  await expect(panel(page).locator('.cycle-sub')).toContainText('🌊 Auwald am Fluss');
  await expect(map.locator('[data-site="floodplain"]')).toContainText('hier');
  // Der Gratis-Korridor steht in der Liste – ohne Kaufknopf.
  const corridor = map.locator('li[data-corridor="home-floodplain"]');
  await expect(corridor).toBeVisible();
  await expect(corridor).toContainText('Weg der Häher, gratis');
  await expect(corridor.locator('button')).toBeHidden();
  // Nach dem Neuladen keine zweite Meldung.
  await page.reload();
  await expect(page.locator('[data-ref="stage"]')).toContainText('Stufe:');
  await page.waitForTimeout(500);
  await expect(page.locator('#toast')).not.toContainText('Eichelhäher');
});

test('vom Hain aus zurück in den Heimatwald wechseln: Gedächtnis kommt mit', async ({ page, context }) => {
  const home: LandscapeSite = { ...createSite('home'), memory: 320, ancient: true, regulars: [] };
  const flood: LandscapeSite = { ...createSite('floodplain'), memory: 0 };
  await seed(
    context,
    landscapeState(GROVE, { own: 40, active: 'floodplain', sites: [home, flood], corridors: ['home-floodplain'], free: ['home-floodplain'] }),
  );
  await openGame(page);
  const map = panel(page).locator('[data-ref="landscape"]');
  await expect(map).toBeVisible();
  // Gründen geht nur aus dem Urwald – mit Grund als Text.
  await map.locator('[data-site="mountain"]').click();
  await expect(map.locator('[data-ref="site-blocker"]')).toContainText('Nur aus dem Urwald');
  const button = panel(page).locator('[data-ref="new-cycle"]');
  await expect(button).toHaveText('Neuen Zyklus beginnen');
  // Wechsel zum Heimatwald per Tastatur.
  await map.locator('[data-site="home"]').focus();
  await page.keyboard.press('Enter');
  await expect(map.locator('[data-ref="site-memory"]')).toContainText('Gedächtnis 320 eigen');
  await expect(button).toHaveText('Neuen Zyklus beginnen: Heimatwald');
  await button.click();
  await waitForConfirm(page);
  await button.click();
  await expect(page.locator('#toast')).toContainText('Du wächst jetzt in: 🌳 Heimatwald');
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
  await openGame(page);
  const map = panel(page).locator('[data-ref="landscape"]');
  // Verdient 6 + 2 + 3 + 2 + 2 = 15, ausgegeben 3 + 5 = 8.
  await expect(map.locator('[data-ref="jay-seeds"]')).toHaveText('🪶 7 Hähersaat');
  const row = map.locator('li[data-corridor="floodplain-carr"]');
  await expect(row).toBeVisible();
  const build = row.getByRole('button', { name: 'Altwasser bauen, 3 Hähersaat' });
  await expect(build).toBeEnabled();
  // Korridore zu nicht gegründeten Wäldern stehen nicht in der Liste.
  await expect(map.locator('li[data-corridor="home-heath"]')).toBeHidden();
  await build.click();
  await expect(page.locator('#toast')).toContainText('Altwasser gebaut');
  await expect(map.locator('[data-ref="jay-seeds"]')).toHaveText('🪶 4 Hähersaat');
  await expect(row).toContainText('verbunden');
  const after = await savedState(page);
  expect(after.meta.landscape.corridors).toContain('floodplain-carr');
  expect(after.meta.landscape.freeCorridors).not.toContain('floodplain-carr');
});

test('Mobil 360 px: Karte ohne Querscrollen, Standorte ≥ 44 px', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seed(context, landscapeState(ANCIENT, { own: 300 }));
  await openGame(page);
  const map = panel(page).locator('[data-ref="landscape-map"]');
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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('vor der Freischaltung: keine Karte', async ({ page, context }) => {
  const state = landscapeState(ANCIENT, { own: 100 });
  await seed(context, state);
  await openGame(page);
  await expect(panel(page).locator('[data-ref="new-cycle"]')).toBeVisible();
  await expect(panel(page).locator('[data-ref="landscape"]')).toBeHidden();
});
