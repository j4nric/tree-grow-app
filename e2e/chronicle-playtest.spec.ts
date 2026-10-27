import type { BrowserContext, Page } from '@playwright/test';
import { CHAPTER_IDS, type ChapterId } from '../src/content/chronicle';
import { SEASON_SECONDS } from '../src/content/seasons';
import { COMMON_SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { createInitialState, createSite, type ChronicleEntry, type GameState } from '../src/core/state';
import { card, encounter, expect, openGame, openGoalsPage, openLandscapeSite, openStack, openTab, seedRaw, stamps, subpage, tabPanel, test, waypoint } from './fixtures';

/**
 * Funde aus dem Playtest Phase 9 (4b) an ui-dev: Kennart-Hinweis im alten Wald (F2), Verweilen
 * im Urwald mit Restzeit bis zum Winter (F3), Kapitel als eigener Stempel und Abschluss als
 * Zettel mit Andenken (F4), „Hier öfter“ markiert das Ereignis des Waldes (F6), Kurzfassung
 * des Rückkehr-Berichts zählt Kapitel (F7), Sprungmarke „Chroniken“ (F8), Tagebuch der Wälder
 * mit „Chronik“ oben und einklappbaren Stammgästen (F9), Kennart-Karte hervorgehoben und Ereignis
 * des Waldes mit Kapitel-Hinweis in U:Begegnung (F5).
 */

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');
const WINTER = 3 * SEASON_SECONDS;
const entry = (chapter: ChapterId, cycle: number | null = 3, season: ChronicleEntry['season'] = 'autumn'): ChronicleEntry => ({ chapter, cycle, season });

/** Urwald im Heimatwald (aktiv, „Erster Schnee“ offen), Auwald vollständig mit vielen Stammgästen. */
function playtestState(opts: { elapsed?: number; homeChapters?: ChapterId[] } = {}): GameState {
  const state = createInitialState(Date.now(), 4242);
  state.stage = ANCIENT;
  state.waypoint = STAGES[ANCIENT]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.number = 4;
  state.cycle.elapsed = opts.elapsed ?? 30;
  state.meta.forestMemory = 300;
  state.meta.achievements = ['ancient-forest'];
  const many = COMMON_SPECIES.slice(0, 14).map((s) => s.id);
  state.meta.journal.species.push('beaver', ...many);
  const home = { ...createSite('home'), ancient: true, chronicle: (opts.homeChapters ?? ['ancient', 'signature']).map((c) => entry(c)) };
  const flood = { ...createSite('floodplain'), ancient: true, memory: 1000, regulars: many, chronicle: CHAPTER_IDS.map((c) => entry(c, 2, 'winter')) };
  state.meta.landscape = { active: 'home', sites: [home, flood], corridors: ['home-floodplain'], freeCorridors: ['home-floodplain'], announced: true };
  return state;
}

async function seed(context: BrowserContext, state: GameState, lastTickOffsetMs = 0): Promise<void> {
  await seedRaw(context, state, lastTickOffsetMs);
}

const site = (page: Page) => subpage(page, 'site');
const chapter = (page: Page, id: ChapterId) => site(page).locator(`[data-ref="site-chronicle-list"] [data-chapter="${id}"]`);

test('F2/F3/F6: U:Standort – Kennart kann kommen, Restzeit bis zum Winter, Ereignis des Waldes markiert', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await seed(context, playtestState());
  await openGame(page);
  await openLandscapeSite(page, 'home');
  await expect(chapter(page, 'kennart')).toContainText('Der Wald ist alt genug – jetzt kann sie jederzeit kommen.');
  await expect(chapter(page, 'kennart')).not.toContainText('Haselmaus');
  const wait = site(page).locator('[data-ref="chronicle-wait"]');
  await expect(wait).toBeVisible();
  await expect(wait).toHaveText(/^❄️ Noch \d+:\d\d min bis zum Winter – bleib, dann schreibt der Wald „Erster Schnee“\.$/);
  // Live: Die Restzeit läuft weiter.
  const before = await wait.textContent();
  await expect(wait).not.toHaveText(before!, { timeout: 5_000 });

  // Ruhender Wald: kein Verweilen-Hinweis; „Hier öfter“ nennt das Kapitel des Ereignisses.
  await openLandscapeSite(page, 'floodplain');
  await expect(site(page).locator('[data-ref="chronicle-wait"]')).toBeHidden();
  await expect(site(page).locator('[data-ref="site-events"]')).toHaveText('Hier öfter: 🌧️ Regenreicher Frühling (📜 Kapitel „Frühjahrshochwasser“), 🐌 Schneckenjahr');
});

test('F3: U:Neuer Zyklus – Verweilen beim aktiven Wald, mit anderem Ziel beim Namen', async ({ page, context }) => {
  await seed(context, playtestState());
  await openGame(page);
  const cycle = await openGoalsPage(page, 'cycle');
  const dwell = cycle.locator('[data-ref="cycle-dwell"]');
  await expect(dwell).toHaveText(/^❄️ Noch \d+:\d\d min bis zum Winter – bleib, dann schreibt der Wald „Erster Schnee“\.$/);
  await openLandscapeSite(page, 'floodplain');
  await site(page).locator('[data-ref="site-choose"]').click();
  await site(page).locator('[data-ref="site-cycle-open"]').click();
  await expect(subpage(page, 'cycle')).toBeVisible();
  await expect(subpage(page, 'cycle').locator('[data-ref="cycle-dwell"]')).toHaveText(
    /^❄️ Noch \d+:\d\d min bis zum Winter – bleibst du, schreibt die Chronik im Heimatwald „Erster Schnee“\.$/,
  );
});

test('F4: Kapitel als eigener Stempel; der Abschluss als Zettel mit Andenken', async ({ page, context }) => {
  // Fünf Kapitel stehen, zwei Sekunden vor dem Winter fällt der erste Schnee – die Chronik ist voll.
  const state = playtestState({ elapsed: WINTER - 2, homeChapters: ['ancient', 'signature', 'kennart', 'harmony', 'memory'] });
  state.meta.forestMemory = 1000;
  state.meta.journal.species.push('dormouse');
  await seed(context, state);
  await openGame(page);
  const slip = stamps(page).locator('.stamp-keepsake');
  await expect(slip).toBeVisible({ timeout: 10_000 });
  await expect(slip).toContainText('📜 Die Chronik im Heimatwald ist vollständig! Letztes Kapitel: Erster Schnee im Urwald.');
  await expect(slip).toContainText('Die Eichel des Hähers');
  await expect(slip.locator('.stamp-keepsake-icon')).toHaveText('🌰');
  // Eigene Meldung: weder Jahreszeit noch Erfolg im selben Zettel.
  await expect(slip).not.toContainText('Erfolg');
  await expect(slip).not.toContainText('Winter ·');
  await page.screenshot({ path: 'test-results/chronicle-keepsake-slip.png' });
  // Bleibt bis zum Schließen.
  await slip.getByRole('button', { name: 'Zettel schließen' }).click();
  await expect(stamps(page).locator('.stamp-keepsake')).toHaveCount(0);
});

test('F7: Kurzfassung des Rückkehr-Berichts nennt neue Kapitel', async ({ page, context }) => {
  await seed(context, playtestState({ elapsed: WINTER - 60 }), -20 * 60_000);
  await openGame(page);
  await expect(page.locator('[data-ref="return-report-summary"]')).toContainText('· 📜 1 neues Kapitel');
});

test('F8: R:Arten – Sprungmarke „Chroniken“, offene Andenken nennen ihre Kapitel', async ({ page, context }) => {
  await seed(context, playtestState());
  await openGame(page);
  await openTab(page, 'arten');
  const species = tabPanel(page, 'arten');
  const jump = species.locator('[data-jump="chronicles"]');
  await expect(jump).toBeVisible();
  await expect(jump).toContainText('Chroniken');
  // Mit „Chroniken“ fünf Streifen: auch bei 360 px ohne Querscrollen, höchstens drei Zeilen.
  await page.setViewportSize({ width: 360, height: 800 });
  const jumps = species.locator('.species-jump:visible');
  await expect(jumps).toHaveCount(5);
  const tops = await jumps.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop));
  expect(new Set(tops).size).toBeLessThanOrEqual(3);
  for (const box of await jumps.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // Tastatur: Enter auf „Chroniken“ bringt den Abschnitt ins Bild.
  await jump.focus();
  await page.keyboard.press('Enter');
  const title = species.locator('#species-chronicles-title');
  await expect(title).toBeInViewport();
  const chronicles = species.locator('[data-ref="species-chronicles"]');
  await expect(chronicles.locator('[data-chronicle="home"]')).toContainText('Noch offen: Erster Schnee, Kennart, Einklang, Gedächtnis.');
  await expect(chronicles.locator('[data-chronicle="carr"]')).toContainText('Mit der Gründung beginnt seine Chronik.');
  await expect(chronicles).not.toContainText('zu Ende');
});

test('F9: Tagebuch der Wälder – „Chronik“ oben, lange Stammgast-Listen einklappbar (390 px)', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(context, playtestState());
  await openGame(page);
  await openTab(page, 'landschaft');
  const forest = tabPanel(page, 'landschaft').locator('[data-ref="landscape-forests"] [data-forest="floodplain"]');
  await expect(forest.locator('[data-row]').first()).toHaveAttribute('data-row', 'chronicle');
  const regulars = forest.locator('[data-row="regulars"]');
  const toggle = regulars.locator('[data-ref="row-more"]');
  await expect(toggle).toHaveText('und 6 weitere ›');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const box = (await toggle.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  const last = COMMON_SPECIES[13]!.name;
  await expect(regulars).not.toContainText(last);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveText('weniger ‹');
  // Weiche Trennstellen (hyphenate) herausrechnen.
  expect((await regulars.textContent())!.replaceAll('­', '')).toContain(last);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

/** Kein Querscrollen der Seite, Treffer ≥ 44 px und nichts ragt aus dem Bild. */
async function checkMobile(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  for (const box of await encounter(page)
    .locator('.card-choose:visible')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  for (const ref of ['encounter-chapter', 'encounter-kennart-hint']) {
    const hint = encounter(page).locator(`[data-ref="${ref}"]:visible`);
    if ((await hint.count()) === 0) continue;
    const box = (await hint.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
}

for (const [width, height] of [
  [360, 740],
  [390, 844],
  [1200, 700],
] as const) {
  test(`F5: U:Begegnung – Kennart-Karte hervorgehoben, mit Kapitel und Text für Screenreader (${width} px)`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    const state = playtestState();
    // Die Haselmaus (Kennart des Heimatwalds) liegt hinten – am Handy oft außerhalb der Reihe.
    state.pendingEncounters = [{ type: 'animal', cards: ['earthworm', 'dormouse'], rerolls: 0 }];
    await seed(context, state);
    await openGame(page);
    await openStack(page);
    const kennart = card(page, 'dormouse');
    await expect(kennart).toHaveClass(/\bkennart\b/);
    await expect(kennart).toHaveAttribute('data-kennart', 'home');
    await expect(card(page, 'earthworm')).not.toHaveClass(/\bkennart\b/);
    await expect(card(page, 'earthworm').locator('[data-ref="card-kennart"]')).toHaveCount(0);
    await expect(kennart.locator('[data-ref="card-kennart"]')).toHaveText(/^🔎\s*Kennart:?\s*Lebt nur im alten Heimatwald\.$/);
    await expect(kennart.locator('[data-ref="card-kennart-chapter"]')).toHaveText('📜 Zieht sie ein, schreibt der Wald das Kapitel „Die Kennart: Haselmaus“.');
    // Der Kopf nennt sie, auch wenn die Karte außerhalb liegt.
    await expect(encounter(page).locator('[data-ref="encounter-kennart-hint"]')).toHaveText('🔎 Kennart dabei: Haselmaus');
    // Screenreader: Der Knopf beschreibt die Karte als Kennart mit Wald und Kapitel.
    const choose = kennart.locator('.card-choose');
    await expect(choose).toHaveAccessibleDescription(/Kennart\s*:\s*Lebt nur im alten Heimatwald\..*Kapitel „Die Kennart: Haselmaus“/);
    await checkMobile(page, width);
    await page.screenshot({ path: `test-results/f5-kennart-${width}.png` });
  });

  test(`F5: U:Begegnung – Ereignis des Waldes schreibt ein Kapitel der Chronik (${width} px)`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    const state = playtestState({ homeChapters: ['ancient'] });
    state.pendingEncounters = [
      { type: 'event', cards: ['mast-year'], rerolls: 0 },
      { type: 'event', cards: ['storm'], rerolls: 0 },
    ];
    await seed(context, state);
    await openGame(page);
    await openStack(page);
    const hint = encounter(page).locator('[data-ref="encounter-chapter"]');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('📜 Schreibt ein Kapitel der Chronik: „Eichelmast – der Häher legt Vorräte an“ – gleich, wie du dich entscheidest.');
    await checkMobile(page, width);
    for (const box of await encounter(page)
      .locator('.option-choose:visible')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: `test-results/f5-event-${width}.png` });
    // Entschieden: Kapitel geschrieben; das nächste Ereignis (Sturm) schreibt keins.
    await encounter(page).getByRole('button', { name: 'Eicheln liegen lassen' }).click();
    await expect(stamps(page)).toContainText('📜 Neues Kapitel im Heimatwald: Eichelmast – der Häher legt Vorräte an');
    await expect(encounter(page).locator('.encounter-title')).not.toHaveText(/Mast/);
    await expect(hint).toBeHidden();
  });
}
