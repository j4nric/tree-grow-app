import type { Page } from '@playwright/test';
import { COMMUNITIES } from '../src/content/communities';
import { PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { expect, legacyGrowth, openGame, openGoalsPage, openTab, savedState, seedRaw, seedV3, stamps, test, waypoint } from './fixtures';

/**
 * Naturtagebuch (DESIGN_V2.md 10, 11.2): Knopf in der Seitenleiste, modaler Dialog mit
 * Reitern, keine Spoiler für Unentdecktes, Stammgäste direkt im Tagebuch wählbar.
 */

const journal = (page: Page) => page.locator('[data-ref="journal"]');

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
  await page.locator('[data-ref="journal-open"]').click();
  await expect(journal(page)).toBeVisible();
}

test('Naturtagebuch: Zähler, Reiter, keine Spoiler, Esc gibt den Fokus zurück', async ({ page, context }) => {
  await seedYoungTree(context);
  await openGame(page);
  await openJournal(page);

  await expect(journal(page).locator('[data-ref="journal-counts"]')).toHaveText(
    '3/51 Arten · 1/14 Pflanzen · 0/15 Gemeinschaften',
  );
  await expect(journal(page).locator('[data-ref="journal-meta"]')).toHaveText(
    'Zyklus 1 · Waldgedächtnis 30 (+30 % Wachstum und Samen)',
  );
  // Arten: entdeckte mit Angaben, unentdeckte als „???“.
  const tit = journal(page).locator('[data-species="bluetit"]');
  await expect(tit).toContainText('Blaumeise');
  await expect(tit).toContainText('Vögel · gewöhnlich · Nische: Krone');
  await expect(journal(page).locator('.journal-entry.unknown')).toHaveCount(48 + 13 + 15 + 2); // + 2 verborgene Hauptbaum-Arten (Andenken)
  // Keine Spoiler: Name und ID einer unentdeckten Art stehen nirgends im DOM.
  const html = await page.content();
  expect(html).not.toContain('Feuersalamander');
  expect(html).not.toContain('"salamander"');

  // Reiter per Pfeiltaste: Pflanzen.
  await expect(journal(page).getByRole('tab', { name: /Arten/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(journal(page).getByRole('tab', { name: /Pflanzen/ })).toHaveAttribute('aria-selected', 'true');
  await expect(journal(page).locator('[data-plant="moss"]')).toContainText('wächst gerade hier');
  await journal(page).getByRole('tab', { name: /Gemeinschaften/ }).click();
  await expect(journal(page).locator('[data-panel="communities"]')).toContainText('Aus Laub wird Erde, aus Erde wird Leben.');

  // Esc schließt, der Fokus kehrt zum Knopf zurück.
  await page.keyboard.press('Escape');
  await expect(journal(page)).toBeHidden();
  await expect(page.locator('[data-ref="journal-open"]')).toBeFocused();
});

test('Stammgast im Tagebuch wählen: Zyklus-Panel synchron, gespeichert', async ({ page, context }) => {
  await seedYoungTree(context);
  await openGame(page);
  await openJournal(page);
  await expect(journal(page).locator('[data-ref="journal-regulars"]')).toContainText('Stammgäste 0/1');

  const toggle = journal(page).locator('[data-species="bluetit"] .journal-regular');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  await expect(journal(page).locator('[data-ref="journal-regulars"]')).toContainText('Stammgäste 1/1');
  // Plätze voll: andere Arten gesperrt.
  await expect(journal(page).locator('[data-species="earthworm"] .journal-regular')).toBeDisabled();
  expect((await savedState(page)).meta.regulars).toEqual(['bluetit']);

  await journal(page).getByRole('button', { name: 'Schließen' }).click();
  await openGoalsPage(page, 'cycle');
  const regulars = page.locator('[data-ref="regulars"]');
  await expect(regulars).toContainText('Stammgäste 1/1');
  await expect(regulars.locator('[data-regular="bluetit"]')).toHaveAttribute('aria-pressed', 'true');

  // Und zurück: im Zyklus-Panel abwählen → im Tagebuch abgewählt.
  await regulars.locator('[data-regular="bluetit"]').click();
  await expect(regulars.locator('[data-regular="bluetit"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-ref="bookmark"]:visible').click();
  await openJournal(page);
  await expect(journal(page).locator('[data-species="bluetit"] .journal-regular')).toHaveAttribute('aria-pressed', 'false');
});

test('keine Spoiler in Attributen: class, title, aria-*, data-* und id nennen nichts Unentdecktes', async ({
  page,
  context,
}) => {
  await seedYoungTree(context);
  await openGame(page);
  await openJournal(page);
  const { attrs, text } = await journal(page).evaluate((d) => {
    const out: string[] = [];
    for (const e of [d, ...d.querySelectorAll('*')]) {
      for (const a of e.attributes) {
        if (['class', 'title', 'id'].includes(a.name) || a.name.startsWith('aria-') || a.name.startsWith('data-')) {
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
  const toggle = journal(page).locator('[data-species="bluetit"] .journal-regular');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toBeFocused();
});

test('Stammgast zieht bei offenem Tagebuch ein: Hinweis im Dialog, kein Toast, „lebt gerade hier“', async ({
  page,
  context,
}) => {
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
  const robin = journal(page).locator('[data-species="robin"]');
  await expect(robin).not.toContainText('lebt gerade hier');
  await robin.locator('.journal-regular').click();
  await expect(robin.locator('.journal-regular')).toHaveAttribute('aria-pressed', 'true');

  // Wegpunkt erreicht: Das Rotkehlchen zieht als Stammgast in die Laubstreu.
  await page.clock.runFor(3000);
  await expect(journal(page).locator('.encounter-notice')).toHaveText('Stammgast Rotkehlchen ist eingezogen.');
  await expect(robin).toContainText('lebt gerade hier');
  await expect(page.locator('#live-status')).toHaveText('');
  // Der v3-Stand mit Waldgedächtnis zeigt beim Laden den Hinweis zur Neugewichtung (2.10);
  // der Einzug selbst darf keinen Toast auslösen.
  await expect(stamps(page)).not.toContainText('Rotkehlchen');
  await expect(page.locator('.float-note')).toHaveCount(0);
  expect((await savedState(page)).niches.litter).toEqual(['robin']);
});

test.describe('Mobil (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Naturtagebuch ohne horizontales Scrollen', async ({ page, context }) => {
    await seedYoungTree(context);
    await openGame(page);
    await openJournal(page);
    const noScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await noScroll()).toBe(true);
    // Auch der Dialog selbst scrollt nicht seitlich.
    const dialogOverflow = await journal(page).evaluate((d) => d.scrollWidth - d.clientWidth);
    expect(dialogOverflow).toBeLessThanOrEqual(0);
    await journal(page).getByRole('tab', { name: /Gemeinschaften/ }).tap();
    expect(await noScroll()).toBe(true);
    await expect(journal(page).getByRole('button', { name: 'Schließen' })).toBeInViewport();
  });
});
