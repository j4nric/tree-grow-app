import type { Page } from '@playwright/test';
import { COMMUNITIES } from '../src/content/communities';
import { PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import {
  expect,
  legacyGrowth,
  openGame,
  openGoalsPage,
  openTab,
  savedState,
  seedRaw,
  seedV3,
  stamps,
  tabPanel,
  test,
  waypoint,
} from './fixtures';

/**
 * Naturtagebuch als Album-Reiter „Arten“ (DESIGN_V2.md 10, 11.2; docs/ALBUM_UI.md B.2):
 * Zähler im Kopf, Sticker-Raster ohne Spoiler für Unentdecktes, Pflanzen, Gemeinschaften,
 * Stammgäste direkt am Sticker wählbar (synchron mit „Neuer Zyklus“).
 */

const species = (page: Page) => tabPanel(page, 'arten');
const cell = (page: Page, id: string) => species(page).locator(`[data-species="${id}"]`);
const star = (page: Page, id: string) => cell(page, id).locator('.species-star');

async function seedYoungTree(context: import('@playwright/test').BrowserContext): Promise<void> {
  // Junger Baum, drei Arten entdeckt, Moos wächst, 30 Waldgedächtnis → ein Stammgast-Platz.
  await seedV3(context, {
    totalGrowth: waypoint(6) + 1,
    niches: { roots: ['earthworm'], litter: ['woodlouse'], crown: ['bluetit'] },
    plants: ['moss'],
    forestMemory: 30,
  });
}

async function openJournal(page: Page): Promise<void> {
  await openTab(page, 'arten');
  await expect(species(page).locator('[data-ref="journal-counts"]')).not.toBeEmpty();
}

test('Reiter Arten: Zähler, Raster nach Gattung, keine Spoiler', async ({ page, context }) => {
  await seedYoungTree(context);
  await openGame(page);
  await openJournal(page);

  await expect(species(page).locator('[data-ref="journal-counts"]')).toHaveText('3/51 Arten · 1/14 Pflanzen · 0/15 Gemeinschaften');
  await expect(species(page).locator('[data-ref="journal-meta"]')).toHaveText('Zyklus 1 · Waldgedächtnis 30 (+30 % Wachstum und Samen)');
  await expect(species(page).locator('.page-meta')).toHaveText('3 von 51 Arten');
  // Arten: entdeckte mit Namen und Angaben, unentdeckte als „???“.
  const tit = cell(page, 'bluetit');
  await expect(tit).toContainText('Blaumeise');
  await expect(tit.locator('button.sticker')).toHaveAttribute('title', 'Vögel · gewöhnlich · Nische: Krone');
  await expect(tit).toHaveClass(/is-present/);
  await expect(species(page).locator('[data-ref="species-count-birds"]')).toHaveText(/^1 von \d+$/);
  await expect(species(page).locator('.species-cell.is-unknown')).toHaveCount(48 + 13);
  await expect(species(page).locator('.species-community.is-unknown')).toHaveCount(15);
  await expect(species(page).locator('.species-tree.is-unknown')).toHaveCount(2); // verborgene Hauptbaum-Arten
  // Keine Spoiler: Name und ID einer unentdeckten Art stehen nirgends im DOM.
  const html = await page.content();
  expect(html).not.toContain('Feuersalamander');
  expect(html).not.toContain('"salamander"');

  // Pflanzen und Gemeinschaften.
  await expect(species(page).locator('[data-plant="moss"]')).toHaveClass(/is-present/);
  await expect(species(page).locator('[data-ref="species-communities"]')).toContainText('Aus Laub wird Erde, aus Erde wird Leben.');
});

test('Tipp auf einen Sticker blättert zu U:Tier, eine Silhouette zeigt nur einen Hinweis', async ({ page, context }) => {
  await seedYoungTree(context);
  await openGame(page);
  await openJournal(page);

  // Silhouette: Haftnotiz mit Gattung und Seltenheit, ohne Namen.
  const unknown = species(page).locator('.species-group[data-genus="amphibians"] .species-cell.is-unknown button.sticker').first();
  await unknown.click();
  const note = page.locator('[data-ref="species-note"]');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Amphibien');
  for (const sp of SPECIES.filter((s) => s.genus === 'amphibians')) await expect(note).not.toContainText(sp.name);
  await page.keyboard.press('Escape');
  await expect(note).toBeHidden();

  // Pflanze: Haftnotiz mit Fakten.
  await species(page).locator('[data-plant="moss"] button.sticker').click();
  await expect(page.locator('[data-ref="plant-note"]')).toContainText('Moose');
  await page.keyboard.press('Escape');

  // Entdeckte Art: U:Tier mit Lesezeichen „‹ Arten“, zurück mit Fokus auf dem Sticker.
  await cell(page, 'bluetit').locator('button.sticker').click();
  const sub = page.locator('[data-ref="page-animal"]');
  await expect(sub).toBeVisible();
  await expect(sub).toHaveAttribute('data-species', 'bluetit');
  await expect(sub).not.toHaveAttribute('inert', '');
  await expect(sub.locator('[data-ref="bookmark"]')).toHaveText('‹ Arten');
  await sub.locator('[data-ref="bookmark"]').click();
  await expect(sub).toBeHidden();
  await expect(cell(page, 'bluetit').locator('button.sticker')).toBeFocused();
});

test('Stammgast am Sticker wählen: „Neuer Zyklus“ synchron, gespeichert', async ({ page, context }) => {
  await seedYoungTree(context);
  await openGame(page);
  await openJournal(page);
  await expect(species(page).locator('[data-ref="journal-regulars"]')).toContainText('Stammgäste 0/1');

  const toggle = star(page, 'bluetit');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  await expect(species(page).locator('[data-ref="journal-regulars"]')).toContainText('Stammgäste 1/1');
  // Plätze voll: andere Arten gesperrt.
  await expect(star(page, 'earthworm')).toBeDisabled();
  expect((await savedState(page)).meta.regulars).toEqual(['bluetit']);

  await openGoalsPage(page, 'cycle');
  const regulars = page.locator('[data-ref="regulars"]');
  await expect(regulars).toContainText('Stammgäste 1/1');
  await expect(regulars.locator('[data-regular="bluetit"]')).toHaveAttribute('aria-pressed', 'true');

  // Und zurück: auf U:Neuer Zyklus abwählen → im Reiter Arten abgewählt.
  await regulars.locator('[data-regular="bluetit"]').click();
  await expect(regulars.locator('[data-regular="bluetit"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-ref="bookmark"]:visible').click();
  await openJournal(page);
  await expect(star(page, 'bluetit')).toHaveAttribute('aria-pressed', 'false');
});

test('keine Spoiler in Attributen: class, title, aria-*, data-* und id nennen nichts Unentdecktes', async ({
  page,
  context,
}) => {
  await seedYoungTree(context);
  await openGame(page);
  await openJournal(page);
  const { attrs, text } = await species(page).evaluate((d) => {
    const out: string[] = [];
    for (const e of [d, ...d.querySelectorAll('*')]) {
      for (const a of e.attributes) {
        if (['class', 'title', 'id', 'style'].includes(a.name) || a.name.startsWith('aria-') || a.name.startsWith('data-')) {
          out.push(`${a.name}=${a.value}`);
        }
      }
    }
    return { attrs: out.join('\n'), text: d.textContent ?? '' };
  });
  const known = new Set(['earthworm', 'woodlouse', 'bluetit', 'moss']);
  const leaks: string[] = [];
  const idPattern = (id: string) => new RegExp(`[="\\s-]${id}(\\b|$)`, 'm');
  for (const entry of [...SPECIES, ...PLANTS]) {
    if (known.has(entry.id)) continue;
    if (attrs.includes(entry.name) || text.includes(entry.name)) leaks.push(`Name ${entry.name}`);
    if (idPattern(entry.id).test(attrs)) leaks.push(`ID ${entry.id}`);
  }
  // Keine Gemeinschaft ist entdeckt.
  for (const c of COMMUNITIES) {
    if (attrs.includes(c.name) || text.includes(c.name)) leaks.push(`Gemeinschaft ${c.name}`);
    if (idPattern(c.id).test(attrs)) leaks.push(`Gemeinschafts-ID ${c.id}`);
  }
  expect(leaks).toEqual([]);
});

test('Stammgast per Leertaste umschalten: der Fokus bleibt auf dem Schalter', async ({ page, context }) => {
  await seedYoungTree(context);
  await openGame(page);
  await openJournal(page);
  const toggle = star(page, 'bluetit');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toBeFocused();
});

test('Stammgast zieht bei offenem Reiter ein: Hinweis über der Szene, Sticker „lebt hier“ und farbig', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-21T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-21T08:00:01Z'));
  // Kurz vor Wegpunkt 7 (Junger Baum), das Rotkehlchen ist entdeckt, lebt aber nicht hier.
  await seedRaw(
    context,
    {
      version: 3,
      totalGrowth: legacyGrowth(waypoint(7) - 1),
      seeds: 0,
      waypoint: 0,
      stage: 0,
      plants: [],
      niches: { roots: ['earthworm'], litter: [], edge: [], crown: ['bluetit'], bark: [], hollows: [] },
      pendingEncounters: [],
      rngState: 123456789,
      meta: { forestMemory: 30, journal: { species: ['earthworm', 'bluetit', 'robin'], keepsakes: [] } },
    },
    0,
  );
  await openGame(page);
  await openJournal(page);
  const robin = cell(page, 'robin');
  await expect(robin).toHaveClass(/is-away/);
  await star(page, 'robin').click();
  await expect(star(page, 'robin')).toHaveAttribute('aria-pressed', 'true');

  // Wegpunkt erreicht: Das Rotkehlchen zieht als Stammgast in die Laubstreu.
  await page.clock.runFor(3000);
  // Ohne Dialog schwebt der Hinweis über dem Polaroid (A.11 #121) und steht in der Statuszeile.
  await page.clock.runFor(100);
  await expect(page.locator('#live-status')).toContainText('Stammgast Rotkehlchen ist eingezogen.');
  await expect(stamps(page)).not.toContainText('Rotkehlchen');
  await expect(robin).toHaveClass(/is-present/);
  await expect(robin).not.toHaveClass(/is-away/);
  expect((await savedState(page)).niches.litter).toEqual(['robin']);
});

for (const width of [360, 390]) {
  test.describe(`Mobil (${width} px)`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });

    test('Reiter Arten ohne horizontales Scrollen, Sprungmarken und Sterne bedienbar', async ({ page, context }) => {
      await seedYoungTree(context);
      await openGame(page);
      await openJournal(page);
      const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(await noScroll()).toBe(true);
      // Kein Element ragt rechts aus der Seite heraus.
      const overflow = await species(page).evaluate((p) => {
        const right = p.getBoundingClientRect().right + 0.5;
        return [...p.querySelectorAll('*')].filter((n) => n.getBoundingClientRect().right > right).map((n) => n.className);
      });
      expect(overflow).toEqual([]);
      // Fünf Spalten im Raster.
      const tops = await species(page)
        .locator('.species-group[data-genus="birds"] .species-cell')
        .evaluateAll((cells) => cells.map((c) => Math.round(c.getBoundingClientRect().top)));
      expect(tops.filter((t) => t === tops[0]).length).toBe(5);
      for (const h of await species(page).locator('.species-jump').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(h).toBeGreaterThanOrEqual(44);
      }
      // Sprungmarke „Gemeinschaften“: Abschnitt im Bild, nicht unter der Reiterleiste – und
      // knapp darunter, ohne Streifen des vorigen Abschnitts dazwischen.
      await species(page).locator('[data-jump="communities"]').tap();
      const heading = species(page).locator('#species-heading-communities');
      await expect(heading).toBeInViewport();
      await expect
        .poll(async () => {
          const box = (await heading.boundingBox())!;
          const tabs = (await page.locator('.tab-strip').boundingBox())!;
          const gap = box.y - (tabs.y + tabs.height);
          return gap >= -1 && gap <= 24;
        })
        .toBe(true);
      expect(await noScroll()).toBe(true);
    });
  });
}
