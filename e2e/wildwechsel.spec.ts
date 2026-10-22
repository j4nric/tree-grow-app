import { CORRIDORS_BY_ID } from '../src/content/landscape';
import { SPECIES_BY_ID } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { loadGame, serialize } from '../src/core/save';
import { createInitialState, createSite, type GameState } from '../src/core/state';
import { tick, type WildwechselCard } from '../src/core/tick';
import { card, dialog, expect, openGame, openStack, seedRaw, stack, test, waypoint } from './fixtures';

/**
 * Wildwechsel in der Oberfläche (DESIGN_V2.md 24.6, Roadmap Phase 7 → 1c): Ein v14-Stand mit
 * Korridoren und Bestand (`fauna`) in den Nachbarwäldern steht kurz vor einem Wegpunkt; der
 * Startwert ist so gesucht, dass dort eine Wildwechsel-Karte kommt. Die Karte nennt den Weg –
 * nach dem Neuladen nicht mehr (die Markierung steht nicht im Spielstand).
 */

const OLD_TREE = STAGES.findIndex((s) => s.id === 'old-tree');
const BEECH_FAUNA = ['robin', 'bluetit', 'squirrel', 'woodpecker', 'jay', 'deer', 'fox', 'owl', 'wolf', 'toad'];
const HEATH_FAUNA = ['bee', 'peacock', 'glowworm'];

/** Alter Baum, kurz vor dem nächsten Wegpunkt; drei Korridore am Heimatwald (30 %). */
function wildwechselState(rngSeed: number): GameState {
  const state = createInitialState(Date.now(), rngSeed);
  state.stage = OLD_TREE;
  state.waypoint = STAGES[OLD_TREE]!.waypoint;
  // Knapp unter dem nächsten Wegpunkt (das Laden setzt den Wegpunkt aus dem Wachstum): Nach
  // Sekundenbruchteilen zieht der Game Loop die Begegnung – viele kleine Ticks halten genau dort
  // wie ein großer, darum gilt der hier gesuchte Startwert auch im Browser.
  state.totalGrowth = waypoint(state.waypoint + 1) - 1;
  state.cycle.number = 4;
  state.meta.forestMemory = 300;
  state.meta.achievements = ['ancient-forest'];
  // Der Bestand ruhender Wälder zählt nur aus entdeckten Arten (Laden, 24.6).
  state.meta.journal.species = [...BEECH_FAUNA, ...HEATH_FAUNA];
  for (const id of ['earthworm', 'vole']) {
    state.niches[SPECIES_BY_ID.get(id)!.niche].push(id);
    state.meta.journal.species.push(id);
  }
  const neighbour = (id: 'beechwood' | 'heath' | 'carr', fauna: string[]) => ({ ...createSite(id), memory: 1000, ancient: true, fauna });
  state.meta.landscape = {
    active: 'home',
    sites: [{ ...createSite('home'), ancient: true }, neighbour('beechwood', BEECH_FAUNA), neighbour('heath', HEATH_FAUNA), neighbour('carr', [])],
    corridors: ['home-beechwood', 'home-heath', 'home-carr'],
    // Gratis-Korridore der Gründungen – sonst kürzt die Kosten-Prüfung beim Laden.
    freeCorridors: ['home-beechwood', 'home-heath', 'home-carr'],
    announced: true,
  };
  return state;
}

/** Erster Startwert, bei dem der nächste Wegpunkt (nach dem Laden wie im Browser) einen Wildwechsel bringt. */
function findSeed(): { seed: number; hit: WildwechselCard } {
  for (let seed = 1; seed <= 2000; seed++) {
    const loaded = loadGame(serialize(wildwechselState(seed)), Date.now());
    if (!loaded) continue;
    const report = tick(loaded.state, 2);
    const hit = report.wildwechsel[0];
    if (hit && loaded.state.pendingEncounters.length === 1) return { seed, hit };
  }
  throw new Error('Kein Startwert mit Wildwechsel gefunden');
}

test('Wildwechsel-Karte nennt den Weg, die Landschaft die Chance – nach dem Neuladen kein Hinweis', async ({ page, context }) => {
  const { seed, hit } = findSeed();
  await seedRaw(context, wildwechselState(seed), 0);
  await openGame(page);
  await expect(stack(page)).toBeVisible();

  // Landschaft: Chance am aktiven Wald und der Korridor mit Bestand drüben.
  const map = page.locator('[data-ref="landscape"]');
  await expect(map.locator('[data-ref="wildwechsel-chance"]')).toHaveText('🦌 Wildwechsel im Heimatwald: 30 % je Tierbegegnung');
  const beech = map.locator('li[data-corridor="home-beechwood"]');
  await expect(beech).toHaveClass(/wildwechsel/);
  await expect(beech.locator('[data-ref="corridor-wildwechsel"]')).toHaveText('🦌 Wildwechsel aus den Buchenhallen (10 Arten im Bestand)');
  // Nachbar ohne Bestand: kein Hinweis.
  await expect(map.locator('li[data-corridor="home-carr"] [data-ref="corridor-wildwechsel"]')).toBeHidden();

  await openStack(page);
  const routed = card(page, hit.species);
  const via = CORRIDORS_BY_ID.get(hit.corridor)!.name;
  const route = routed.locator('[data-ref="card-route"]');
  await expect(route).toBeVisible();
  await expect(route).toContainText(`kommt`);
  await expect(route).toContainText(via);
  // Für Screenreader mit Text, nicht nur mit Symbol – und als Beschreibung des Knopfs.
  await expect(route).toContainText('Wildwechsel:');
  await expect(routed.locator('.card-choose')).toHaveAccessibleDescription(/Wildwechsel: kommt/);
  // Nur genau diese Karte.
  await expect(dialog(page).locator('[data-ref="card-route"]')).toHaveCount(1);

  // Neuladen: Die Begegnung wartet noch, aber welche Karte über den Korridor kam, weiß der
  // Spielstand nicht – lieber kein Hinweis als ein falscher.
  await page.reload();
  await expect(stack(page)).toBeVisible();
  await openStack(page);
  await expect(card(page, hit.species)).toBeVisible();
  await expect(dialog(page).locator('[data-ref="card-route"]')).toHaveCount(0);
});

for (const width of [360, 390]) {
  test(`Wildwechsel-Hinweise laufen bei ${width} px nicht über`, async ({ page, context }) => {
    const { seed, hit } = findSeed();
    await page.setViewportSize({ width, height: 800 });
    await seedRaw(context, wildwechselState(seed), 0);
    await openGame(page);
    await openStack(page);
    const route = card(page, hit.species).locator('[data-ref="card-route"]');
    await expect(route).toBeVisible();
    // Kein Überlauf: Inhalt passt in die Karte (Breiten aus dem DOM, nicht aus Schriftmaßen).
    const fits = await route.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const cardBox = el.closest('.encounter-card')!.getBoundingClientRect();
      return el.scrollWidth <= el.clientWidth + 1 && box.left >= cardBox.left - 1 && box.right <= cardBox.right + 1;
    });
    expect(fits).toBe(true);
    await page.keyboard.press('Escape');
    const chance = page.locator('[data-ref="wildwechsel-chance"]');
    await chance.scrollIntoViewIfNeeded();
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noOverflow).toBe(true);
    const row = page.locator('li[data-corridor="home-beechwood"] [data-ref="corridor-wildwechsel"]');
    const rowFits = await row.evaluate((el) => {
      const li = el.closest('li')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return box.right <= li.right + 1 && el.scrollWidth <= el.clientWidth + 1;
    });
    expect(rowFits).toBe(true);
  });
}
