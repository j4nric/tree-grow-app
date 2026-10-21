import type { Page } from '@playwright/test';
import { expect, openGame, savedState, seedV3, test, waypoint } from './fixtures';

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
  await page.locator('[data-ref="journal-open"]').click();
  await expect(journal(page)).toBeVisible();
}

test('Naturtagebuch: Zähler, Reiter, keine Spoiler, Esc gibt den Fokus zurück', async ({ page, context }) => {
  await seedYoungTree(context);
  await openGame(page);
  await openJournal(page);

  await expect(journal(page).locator('[data-ref="journal-counts"]')).toHaveText(
    '3/32 Arten · 1/14 Pflanzen · 0/9 Gemeinschaften',
  );
  await expect(journal(page).locator('[data-ref="journal-meta"]')).toHaveText(
    'Zyklus 1 · Waldgedächtnis 30 (+60 % Wachstum und Samen)',
  );
  // Arten: entdeckte mit Angaben, unentdeckte als „???“.
  const tit = journal(page).locator('[data-species="bluetit"]');
  await expect(tit).toContainText('Blaumeise');
  await expect(tit).toContainText('Vögel · gewöhnlich · Nische: Krone');
  await expect(journal(page).locator('.journal-entry.unknown')).toHaveCount(29 + 13 + 9);
  // Keine Spoiler: Name und ID einer unentdeckten Art stehen nirgends im DOM.
  const html = await page.content();
  expect(html).not.toContain('Feuersalamander');
  expect(html).not.toContain('"salamander"');

  // Reiter per Pfeiltaste: Pflanzen.
  await expect(page.getByRole('tab', { name: /Arten/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Pflanzen/ })).toHaveAttribute('aria-selected', 'true');
  await expect(journal(page).locator('[data-plant="moss"]')).toContainText('wächst gerade hier');
  await page.getByRole('tab', { name: /Gemeinschaften/ }).click();
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
  const regulars = page.locator('[data-ref="regulars"]');
  await expect(regulars).toContainText('Stammgäste 1/1');
  await expect(regulars.locator('[data-regular="bluetit"]')).toHaveAttribute('aria-pressed', 'true');

  // Und zurück: im Zyklus-Panel abwählen → im Tagebuch abgewählt.
  await regulars.locator('[data-regular="bluetit"]').click();
  await openJournal(page);
  await expect(journal(page).locator('[data-species="bluetit"] .journal-regular')).toHaveAttribute('aria-pressed', 'false');
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
    await page.getByRole('tab', { name: /Gemeinschaften/ }).tap();
    expect(await noScroll()).toBe(true);
    await expect(journal(page).getByRole('button', { name: 'Schließen' })).toBeInViewport();
  });
});
