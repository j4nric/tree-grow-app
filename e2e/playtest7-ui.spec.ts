import type { Page } from '@playwright/test';
import { SPECIES_BY_ID } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { loadGame, serialize } from '../src/core/save';
import { createInitialState, createSite, type GameState, type LandscapeSite } from '../src/core/state';
import { tick } from '../src/core/tick';
import {
  albumAnimationsDone,
  card,
  encounter,
  expect,
  gotoTab,
  landscapeUnlockState,
  openCoverPage,
  openGame,
  openLandscapeSite,
  openStack,
  seedRaw,
  stack,
  stamps,
  subpage,
  test,
  waypoint,
} from './fixtures';

/**
 * Funde aus dem Playtest Phase 7 (ROADMAP 4b, Owner `ui-dev`) im Browser: Satzgrenze in der
 * Sammelmeldung (S4), Wetter und Sperrgrund auf der Karte (S2, K3), Erklärung „Feuchte“ (K7),
 * Grund der Vorauswahl in der Baumwahl (S5), „erneut tippen“ auf Touch (K6), Wetter in der
 * Spielanleitung (S2) und die Wildwechsel-Karte am Handy (K4).
 */

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');
const OLD_TREE = STAGES.findIndex((s) => s.id === 'old-tree');

function landscapeState(stage: number, opts: { active?: LandscapeSite['id']; sites?: LandscapeSite[]; corridors?: string[]; mainTree?: 'fir' } = {}): GameState {
  const state = createInitialState(Date.now(), 4242);
  state.stage = stage;
  state.waypoint = STAGES[stage]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.number = 4;
  state.meta.forestMemory = 1000;
  state.meta.achievements = ['ancient-forest'];
  if (opts.mainTree) state.cycle.mainTree = opts.mainTree;
  const corridors = opts.corridors ?? [];
  state.meta.landscape = {
    active: opts.active ?? 'home',
    sites: opts.sites ?? [{ ...createSite('home'), ancient: true }],
    corridors,
    freeCorridors: corridors,
    announced: true,
  };
  return state;
}

const map = (page: Page) => page.locator('[data-ref="landscape-map"]');
const cyclePage = (page: Page) => subpage(page, 'cycle');

test('Freischaltung: Erfolge und Häher-Satz sind durch einen Punkt getrennt (S4)', async ({ page, context }) => {
  await seedRaw(context, landscapeUnlockState(), 0);
  await openGame(page);
  const text = stamps(page).filter({ hasText: 'Eichelhäher' });
  await expect(text).toBeVisible();
  // Vorher: „… und 1 weitere 🪶 Ein Eichelhäher …“ – jetzt endet jeder Teil mit einem Satzzeichen.
  await expect(text).toContainText(/[.!?…:“]\s🪶 Ein Eichelhäher/);
  await expect(text).not.toContainText(/[\p{L}\d]\s🪶 Ein Eichelhäher/u);
});

test('Karte: Wetter je Standort, Sperrgrund nach der Gründung, „Feuchte“ erklärt (S2, K3, K7)', async ({ page, context }) => {
  const mountain: LandscapeSite = { ...createSite('mountain', 'fir') };
  await seedRaw(context, landscapeState(OLD_TREE, { active: 'mountain', sites: [{ ...createSite('home'), ancient: true, memory: 1000 }, mountain], corridors: ['home-mountain'], mainTree: 'fir' }), 0);
  await gotoTab(page, 'landschaft');
  await albumAnimationsDone(page);
  // Wetter: kleines Zeichen an der Ecke, der Satz als Tooltip und im Namen des Knopfs.
  const heath = map(page).locator('[data-site="heath"]');
  await expect(heath.locator('.lsc-site-weather')).toHaveText('🌡️');
  await expect(heath.locator('.lsc-site-weather')).toHaveAttribute('title', /^Wetter: 🌡️ Viel Sonne/);
  await expect(heath).toHaveAccessibleName(/Wetter: 🌡️ Viel Sonne, im Sommer oft Dürre/);
  await expect(map(page).locator('[data-site="home"] .lsc-site-weather')).toHaveCount(0);
  // Der neue Wald ist noch kein Urwald: Der Grund steht kurz im Knopf (statt „gesperrt“).
  await expect(heath.locator('.lsc-site-status')).toHaveText(/^erst im Urwald · \d+\s🪶$/);
  await expect(map(page)).not.toContainText('gesperrt');
  // Tagebuch der Wälder: Wetter-Zeile beim Bergmischwald.
  await expect(page.locator('[data-forest="mountain"] [data-row="weather"]')).toContainText('🌨️ Viel Neuschnee im Winter');

  // U:Standort Erlenbruch: „Feuchte“ erklärt, Zahl und 🪶 bleiben zusammen.
  const site = await openLandscapeSite(page, 'carr');
  await expect(site.locator('.page-title')).toContainText('🐸 Erlenbruch');
  await expect(site.locator('[data-ref="site-habitat"]')).toContainText('💧 Feuchte heißt:');
  const glued = await site.locator('[data-ref="site-status"]').evaluate((el) => el.textContent ?? '');
  expect(glued).toMatch(/\d 🪶$/);
});

test('Baumwahl: Weißtanne mit Grund, „Wächst jetzt“ an der Eiche (S5)', async ({ page, context }) => {
  await seedRaw(context, landscapeState(ANCIENT), 0);
  await gotoTab(page, 'landschaft');
  const site = await openLandscapeSite(page, 'mountain');
  await site.locator('[data-ref="site-choose"]').click();
  await site.locator('[data-ref="site-cycle-open"]').click();
  await expect(cyclePage(page)).not.toHaveAttribute('inert', '');
  const fir = cyclePage(page).locator('.cyc-packet[data-tree="fir"]');
  const oak = cyclePage(page).locator('.cyc-packet[data-tree="oak"]');
  await expect(fir.locator('input')).toBeChecked();
  await expect(fir.locator('[data-ref="tree-note"]')).toHaveText('Leitbaum im Bergmischwald – die Gründung schaltet sie frei, darum vorausgewählt.');
  await expect(oak.locator('[data-ref="tree-note"]')).toHaveText('Wächst jetzt im Heimatwald');
  // Kein „(jetzt)“ mehr am Namen – der Knopf heißt wie die Art, der Grund ist seine Beschreibung.
  await expect(oak.locator('input')).toHaveAccessibleName('Stieleiche');
  await expect(fir.locator('input')).toHaveAccessibleDescription(/^Leitbaum im Bergmischwald/);
});

test('Spielanleitung: Wetter je Waldtyp im Kapitel „Wetter“ (S2)', async ({ page, context }) => {
  await seedRaw(context, landscapeState(ANCIENT), 0);
  await openGame(page);
  await openCoverPage(page, 'guide');
  await subpage(page, 'guide').locator('[data-chapter="weather"]').click();
  const chapter = subpage(page, 'guide-chapter');
  await expect(chapter).toContainText('Jeder Waldtyp der Landschaft hat sein eigenes Wetter');
  await expect(chapter).toContainText('⛰️ Bergmischwald: 🌨️ Viel Neuschnee im Winter');
});

test.describe('Handy (Touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Neuer Zyklus: „Zum Bestätigen erneut tippen“ (K6)', async ({ page, context }) => {
    await seedRaw(context, landscapeState(ANCIENT), 0);
    await gotoTab(page, 'ziele');
    await page.locator('[data-ref="cycle-open"]').tap();
    await expect(cyclePage(page)).not.toHaveAttribute('inert', '');
    const button = cyclePage(page).locator('[data-ref="new-cycle"]');
    await button.scrollIntoViewIfNeeded();
    await button.tap();
    await expect(button).toHaveText('Wirklich neu beginnen? Zum Bestätigen erneut tippen');
  });

  test('Wildwechsel: Kopf nennt die Karte, die Reihe holt sie ins Bild (K4)', async ({ page, context }) => {
    const { state, species } = wildwechselSecondCard();
    await seedRaw(context, state, 0);
    await openGame(page);
    await expect(stack(page)).toBeVisible();
    await openStack(page);
    const name = SPECIES_BY_ID.get(species)!.name;
    await expect(encounter(page).locator('[data-ref="encounter-route-hint"]')).toHaveText(new RegExp(`^🦌 Wildwechsel: ${name} kommt `));
    // Die Karte liegt nicht an erster Stelle, steht aber ganz im sichtbaren Bereich der Reihe.
    const routed = card(page, species);
    await expect
      .poll(() =>
        routed.evaluate((el) => {
          const row = el.closest('.encounter-cards')!.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          return box.left >= row.left - 1 && box.right <= row.right + 1;
        }),
      )
      .toBe(true);
  });
});

/** Wildwechsel-Stand (wie e2e/wildwechsel.spec.ts), bei dem die Wildwechsel-Karte nicht die erste ist. */
function wildwechselSecondCard(): { state: GameState; species: string } {
  const BEECH = ['robin', 'bluetit', 'squirrel', 'woodpecker', 'jay', 'deer', 'fox', 'owl', 'wolf', 'toad'];
  const HEATH = ['bee', 'peacock', 'glowworm'];
  const make = (seed: number) => {
    const state = createInitialState(Date.now(), seed);
    state.stage = OLD_TREE;
    state.waypoint = STAGES[OLD_TREE]!.waypoint;
    state.totalGrowth = waypoint(state.waypoint + 1) - 1;
    state.cycle.number = 4;
    state.meta.forestMemory = 300;
    state.meta.achievements = ['ancient-forest'];
    state.meta.journal.species = [...BEECH, ...HEATH];
    for (const id of ['earthworm', 'vole']) {
      state.niches[SPECIES_BY_ID.get(id)!.niche].push(id);
      state.meta.journal.species.push(id);
    }
    const n = (id: 'beechwood' | 'heath' | 'carr', fauna: string[]) => ({ ...createSite(id), memory: 1000, ancient: true, fauna });
    state.meta.landscape = {
      active: 'home',
      sites: [{ ...createSite('home'), ancient: true }, n('beechwood', BEECH), n('heath', HEATH), n('carr', [])],
      corridors: ['home-beechwood', 'home-heath', 'home-carr'],
      freeCorridors: ['home-beechwood', 'home-heath', 'home-carr'],
      announced: true,
    };
    return state;
  };
  for (let seed = 1; seed <= 3000; seed++) {
    const loaded = loadGame(serialize(make(seed)), Date.now());
    if (!loaded) continue;
    const report = tick(loaded.state, 2);
    const hit = report.wildwechsel[0];
    const pending = loaded.state.pendingEncounters;
    if (hit && pending.length === 1 && pending[0]!.cards.indexOf(hit.species) >= 1) return { state: make(seed), species: hit.species };
  }
  throw new Error('Kein Startwert mit Wildwechsel an zweiter oder dritter Stelle gefunden');
}
