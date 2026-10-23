import type { BrowserContext, Page } from '@playwright/test';
import { CHAPTER_IDS, type ChapterId } from '../src/content/chronicle';
import { SEASON_SECONDS } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { createInitialState, createSite, type ChronicleEntry, type GameState } from '../src/core/state';
import {
  back,
  expect,
  openCoverPage,
  openGame,
  openGoalsPage,
  landscapeUnlockState,
  openLandscapeSite,
  openStack,
  openTab,
  seedRaw,
  encounter,
  stamps,
  subpage,
  tabPanel,
  test,
  waypoint,
} from './fixtures';

/**
 * Waldchronik und Kennarten im Album (DESIGN_V2.md 26.7, ROADMAP Phase 9, 3a): Abschnitt
 * „Chronik“ auf U:Standort, Kennzahl und Wachssiegel im Reiter „Landschaft“, Spalte im Tagebuch
 * der Wälder, offene Kapitel beim Ziel-Wald, Reihe „Kennarten“ und Andenken in R:Arten, Stempel
 * je neuem Kapitel, Kapitel im Rückkehr-Bericht, Spielanleitung, 360 px ohne Querscrollen.
 */

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');
/** Beginn des Winters in der Spielzeit eines Jahres (Frühling, Sommer, Herbst, Winter). */
const WINTER = 3 * SEASON_SECONDS;

const entry = (chapter: ChapterId, cycle: number | null, season: ChronicleEntry['season'] = null): ChronicleEntry => ({ chapter, cycle, season });

/**
 * Urwald im Heimatwald mit freier Landschaft. Der Heimatwald hat zwei Kapitel („Uralt
 * geworden“ ohne Datum, das Ereignis im 3. Zyklus, Herbst), der Auwald eine vollständige
 * Chronik (alt, volles Gedächtnis, Biber im Tagebuch – sonst nähme das Laden die Kapitel weg).
 * `unlocked: false`: Wald (eine Stufe darunter) vor der Freischaltung.
 */
function chronicleState(opts: { elapsed?: number; unlocked?: boolean } = {}): GameState {
  const state = createInitialState(Date.now(), 4242);
  const unlocked = opts.unlocked ?? true;
  // Vor der Freischaltung eine Stufe unter dem Urwald (sonst schaltet der Erfolg sie beim Laden frei).
  state.stage = unlocked ? ANCIENT : ANCIENT - 1;
  state.waypoint = STAGES[state.stage]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.number = 4;
  state.cycle.elapsed = opts.elapsed ?? 30;
  state.meta.forestMemory = 300;
  state.meta.achievements = unlocked ? ['ancient-forest'] : [];
  const home = { ...createSite('home'), ancient: true, chronicle: [entry('ancient', null), entry('signature', 3, 'autumn')] };
  const sites = [home];
  if (unlocked) {
    sites.push({ ...createSite('floodplain'), ancient: true, memory: 1000, chronicle: CHAPTER_IDS.map((c) => entry(c, 2, 'winter')) });
    state.meta.journal.species.push('beaver');
  }
  state.meta.landscape = {
    active: 'home',
    sites,
    corridors: unlocked ? ['home-floodplain'] : [],
    freeCorridors: unlocked ? ['home-floodplain'] : [],
    announced: unlocked,
  };
  return state;
}

async function seed(context: BrowserContext, state: GameState, lastTickOffsetMs = 0): Promise<void> {
  await seedRaw(context, state, lastTickOffsetMs);
}

const site = (page: Page) => subpage(page, 'site');
const chapter = (page: Page, id: ChapterId) => site(page).locator(`[data-ref="site-chronicle-list"] [data-chapter="${id}"]`);

test('U:Standort zeigt sechs Zettel mit Stempel und Hinweis, vollständig das Andenken', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await seed(context, chronicleState());
  await openGame(page);

  // Reiter „Landschaft“: Kennzahl, Wachssiegel am Auwald, Spalte „Chronik“ im Tagebuch.
  await openTab(page, 'landschaft');
  const panel = tabPanel(page, 'landschaft');
  await expect(panel.locator('[data-ref="chronicle-total"]')).toHaveText('📜 8 / 36 Kapitel');
  const map = panel.locator('[data-ref="landscape-map"]');
  await expect(map.locator('[data-site="floodplain"] [data-ref="site-seal"]')).toBeVisible();
  await expect(map.locator('[data-site="floodplain"] [data-ref="site-seal"]')).toHaveText('🪵');
  await expect(map.locator('[data-site="home"] [data-ref="site-seal"]')).toBeHidden();
  await expect(map.locator('[data-site="floodplain"]')).toHaveAccessibleName(/Chronik 6 \/ 6 – vollständig/);
  const forests = panel.locator('[data-ref="landscape-forests"]');
  await expect(forests.locator('[data-forest="floodplain"] [data-row="chronicle"]')).toContainText('6 / 6 – vollständig');
  await expect(forests.locator('[data-forest="home"] [data-row="chronicle"]')).toContainText('2 / 6 – offen: Erster Schnee, Kennart, Einklang, Gedächtnis');

  // Heimatwald: zwei geschriebene Zettel mit Stempel, vier offene mit Hinweis, kein Andenken.
  await openLandscapeSite(page, 'home');
  const section = site(page).locator('[data-ref="site-chronicle"]');
  await expect(section).toBeVisible();
  await expect(section.locator('[data-ref="site-chronicle-count"]')).toHaveText('2 / 6');
  await expect(site(page).locator('[data-ref="site-chronicle-list"] > li')).toHaveCount(6);
  await expect(chapter(page, 'ancient')).toHaveClass(/written/);
  await expect(chapter(page, 'ancient').locator('[data-ref="chapter-stamp"]')).toHaveText('schon früher');
  await expect(chapter(page, 'signature').locator('[data-ref="chapter-stamp"]')).toHaveText('3. Zyklus · Herbst');
  await expect(chapter(page, 'first-snow')).not.toHaveClass(/written/);
  await expect(chapter(page, 'first-snow').locator('[data-ref="chapter-stamp"]')).toBeHidden();
  await expect(chapter(page, 'first-snow')).toContainText('Erlebe hier einen Winter im Urwald.');
  // Offene Kennart ohne Namen (Spoiler-Regel).
  await expect(chapter(page, 'kennart')).toContainText('zeigt sich nur, wenn er alt ist');
  await expect(chapter(page, 'kennart')).not.toContainText('Haselmaus');
  await expect(site(page).locator('[data-ref="site-keepsake"]')).toBeHidden();

  // Auwald: vollständig, das Andenken als großer Sticker; die Kennart beim Namen.
  await back(page);
  await openLandscapeSite(page, 'floodplain');
  await expect(site(page).locator('[data-ref="site-chronicle-count"]')).toHaveText('6 / 6');
  await expect(chapter(page, 'kennart')).toContainText('Biber');
  await expect(chapter(page, 'signature')).toContainText('Frühjahrshochwasser');
  const keepsake = site(page).locator('[data-ref="site-keepsake"]');
  await expect(keepsake).toBeVisible();
  await expect(keepsake).toContainText('Biberholz');

  // Ein nicht gegründeter Wald: Hinweis statt Zetteln.
  await back(page);
  await openLandscapeSite(page, 'carr');
  await expect(site(page).locator('[data-ref="site-chronicle"]')).toContainText('beginnt mit der Gründung');
  await expect(site(page).locator('[data-ref="site-chronicle-list"]')).toBeHidden();
});

test('Neues Kapitel online: Stempel, Zettel bekommt das Datum, bleibt nach dem Neuladen', async ({ page, context }) => {
  // Zwei Sekunden vor dem Winter im Urwald: „Erster Schnee im Urwald“.
  await seed(context, chronicleState({ elapsed: WINTER - 2 }));
  await openGame(page);
  await expect(stamps(page)).toContainText('📜 Neues Kapitel im Heimatwald: Erster Schnee im Urwald', { timeout: 10_000 });
  await openLandscapeSite(page, 'home');
  await expect(chapter(page, 'first-snow')).toHaveClass(/written/);
  await expect(chapter(page, 'first-snow').locator('[data-ref="chapter-stamp"]')).toHaveText('4. Zyklus · Winter');
  await expect(site(page).locator('[data-ref="site-chronicle-count"]')).toHaveText('3 / 6');
  await page.reload();
  await openLandscapeSite(page, 'home');
  await expect(chapter(page, 'first-snow').locator('[data-ref="chapter-stamp"]')).toHaveText('4. Zyklus · Winter');
});

test('Ereignis des Waldes entschieden: Stempel „Neues Kapitel“ (Aktion, Vergleich vorher/nachher)', async ({ page, context }) => {
  const state = chronicleState();
  // Heimatwald ohne sein Ereignis – die Eichelmast wartet im Stapel.
  state.meta.landscape.sites[0]!.chronicle = [entry('ancient', null)];
  state.pendingEncounters = [{ type: 'event', cards: ['mast-year'], rerolls: 0 }];
  await seed(context, state);
  await openGame(page);
  await openStack(page);
  await encounter(page).getByRole('button', { name: 'Eicheln liegen lassen' }).click();
  await expect(stamps(page)).toContainText('📜 Neues Kapitel im Heimatwald: Eichelmast – der Häher legt Vorräte an');
  await openLandscapeSite(page, 'home');
  await expect(chapter(page, 'signature').locator('[data-ref="chapter-stamp"]')).toHaveText(/^4\. Zyklus · /);
});

test('Freischaltung der Landschaft nennt die Kapitel, die der Heimatwald still geschrieben hat', async ({ page, context }) => {
  await seedRaw(context, landscapeUnlockState(), 0);
  await openGame(page);
  await expect(stamps(page)).toContainText('Eichelhäher');
  await expect(stamps(page)).toContainText('📜 Im Heimatwald steht schon 1 Kapitel der Chronik.');
  await expect(stamps(page)).not.toContainText('Neues Kapitel');
});

test('Offline geschriebene Kapitel stehen im Rückkehr-Bericht', async ({ page, context }) => {
  // 20 Minuten weg, kurz vor dem Winter: offline fällt der erste Schnee.
  await seed(context, chronicleState({ elapsed: WINTER - 60 }), -20 * 60_000);
  await openGame(page);
  await expect(page.locator('[data-ref="return-report"]')).toBeVisible();
  await page.locator('[data-ref="return-report-details"]').click();
  await expect(subpage(page, 'return-report')).toBeVisible();
  await expect(page.locator('[data-ref="return-report-list"]')).toContainText('📜 Neues Kapitel im Heimatwald: Erster Schnee im Urwald.');
});

test('U:Neuer Zyklus nennt die offenen Kapitel des Ziel-Walds', async ({ page, context }) => {
  await seed(context, chronicleState());
  await openGame(page);
  const cycle = await openGoalsPage(page, 'cycle');
  await expect(cycle.locator('[data-ref="cycle-chronicle"]')).toHaveText('📜 Chronik 2 / 6 – offen: Erster Schnee, Kennart, Einklang, Gedächtnis');
  // Anderes Ziel (Erlenbruch, neu): ein neuer Wald beginnt seine Chronik.
  await openLandscapeSite(page, 'carr');
  await site(page).locator('[data-ref="site-choose"]').click();
  await site(page).locator('[data-ref="site-cycle-open"]').click();
  await expect(subpage(page, 'cycle')).toBeVisible();
  await expect(subpage(page, 'cycle').locator('[data-ref="cycle-chronicle"]')).toHaveText('📜 Chronik 0 / 6 – ein neuer Wald beginnt seine Chronik.');
});

test('R:Arten: Reihe „Kennarten“ und Andenken der Chroniken – erst mit der Landschaft', async ({ page, context }) => {
  await seed(context, chronicleState());
  await openGame(page);
  await openTab(page, 'arten');
  const species = tabPanel(page, 'arten');
  const row = species.locator('[data-ref="species-kennarten"]');
  await expect(row).toBeAttached();
  await expect(row.locator('li.species-cell')).toHaveCount(6);
  await expect(row.locator('[data-ref="species-count-kennarten"]')).toHaveText('1 von 6');
  await expect(row.locator('[data-species="beaver"]')).toBeAttached();
  // Unentdeckt: Silhouette mit ihrem Wald, ohne ID.
  await expect(row.locator('li.is-unknown')).toHaveCount(5);
  await expect(row.locator('li.is-unknown [data-species]')).toHaveCount(0);
  await expect(row.locator('li.is-unknown .sr-only').first()).toContainText('Unentdeckte Kennart');
  // Andenken: sechs Chroniken, der Auwald mit seinem Andenken.
  await species.locator('[data-jump="keepsakes"]').click();
  const chronicles = species.locator('[data-ref="species-chronicles"]');
  await expect(chronicles).toBeVisible();
  await expect(chronicles.locator('li')).toHaveCount(6);
  await expect(chronicles.locator('[data-chronicle="floodplain"]')).toContainText('Biberholz');
  await expect(chronicles.locator('[data-chronicle="home"]')).toContainText('Chronik 2 / 6');
  await expect(chronicles.locator('[data-chronicle="home"]')).not.toContainText('Eichel des Hähers');
});

test('Vor der Landschaft: keine Kennarten, keine Chronik, kein Kapitel in der Anleitung', async ({ page, context }) => {
  await seed(context, chronicleState({ unlocked: false }));
  await openGame(page);
  await openTab(page, 'arten');
  const species = tabPanel(page, 'arten');
  await expect(species.locator('[data-ref="species-count-birds"]')).not.toHaveText('');
  await expect(species.locator('[data-ref="species-kennarten"]')).toHaveCount(0);
  await expect(species.locator('[data-ref="species-chronicles"]')).toBeHidden();
  expect(await page.content()).not.toContain('Kennarten');
  await openCoverPage(page, 'guide');
  await expect(subpage(page, 'guide').locator('[data-chapter="landscape"]')).toBeVisible();
  await expect(subpage(page, 'guide').locator('[data-chapter="chronicle"]')).toHaveCount(0);
});

test('Spielanleitung: Kapitel „Chroniken und Kennarten“ mit der Landschaft', async ({ page, context }) => {
  await seed(context, chronicleState());
  await openGame(page);
  await openCoverPage(page, 'guide');
  const link = subpage(page, 'guide').locator('[data-chapter="chronicle"]');
  await expect(link).toBeVisible();
  await expect(link).toContainText('Chroniken und Kennarten');
});

for (const width of [360, 390]) {
  test(`mobil ${width} px: U:Standort mit Chronik und Andenken ohne Querscrollen`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 800 });
    await seed(context, chronicleState());
    await openGame(page);
    await openLandscapeSite(page, 'floodplain');
    await expect(site(page).locator('[data-ref="site-keepsake"]')).toBeVisible();
    await site(page).locator('[data-ref="site-chronicle"]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // Kein Zettel ragt aus der Seite.
    const pageBox = (await site(page).boundingBox())!;
    for (const li of await site(page).locator('[data-ref="site-chronicle-list"] > li').all()) {
      const box = (await li.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(pageBox.x - 2);
      expect(box.x + box.width).toBeLessThanOrEqual(pageBox.x + pageBox.width + 2);
    }
    await page.screenshot({ path: `test-results/chronicle-site-${width}.png` });
  });
}
