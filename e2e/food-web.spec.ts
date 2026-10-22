import type { BrowserContext, Page } from '@playwright/test';
import { expect, niche, openGame, seedV3, test, waypoint } from './fixtures';

/**
 * Räuber und Beute (DESIGN_V2.md 22.7): Nahrungsnetz in der Ökosystem-Übersicht, Bestand
 * an den Kacheln und Räuber/Beute in den Tierdetails – mobil bedienbar, ohne Querscrollen.
 */

const foodWeb = (page: Page) => page.locator('[data-ref="food-web"]');
const detail = (page: Page) => page.locator('[data-ref="animal-detail"]');
const tile = (page: Page, nicheId: string, species: string) =>
  niche(page, nicheId).locator(`[data-species="${species}"] button.slot-open`);

/** Wald mit Wühlmaus, Waldkauz und Rotfuchs (zwei Jäger, eine Maus → überjagt) und einem Regenwurm ohne Jäger. */
async function seed(context: BrowserContext): Promise<void> {
  await seedV3(context, {
    totalGrowth: waypoint(14) + 1,
    plants: ['hazel'],
    niches: { roots: ['vole', 'earthworm'], edge: ['fox'], hollows: ['owl'] },
  });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
  { name: 'schmal', width: 360, height: 740 },
]) {
  test(`Nahrungsnetz (${viewport.name}): aufklappbar, Zustand als Text, Hinweis`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(context);
    await openGame(page);

    const web = foodWeb(page);
    const summary = web.locator('summary');
    await expect(summary).toContainText('Nahrungsnetz');
    await expect(web.locator('[data-ref="food-web-summary"]')).toHaveText('1 überjagt · 1 ungejagt');
    const box = await summary.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Per Tastatur aufklappen (echtes <summary>).
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(web).toHaveAttribute('open', '');

    const mice = web.locator('[data-tag="kleinsaeuger"]');
    await expect(mice).toBeVisible();
    await expect(mice.locator('[data-ref="food-web-state"]')).toHaveText(/überjagt/);
    await expect(mice.locator('[data-ref="food-web-prey"]')).toContainText(/Beute: Wühlmaus · Bestand (knapp|gut|reichlich)/);
    await expect(mice.locator('[data-ref="food-web-hunters"]')).toContainText('Waldkauz');
    await expect(mice.locator('[data-ref="food-web-hunters"]')).toContainText('Rotfuchs');
    // Bestand am Maximum: Zwei Jäger brauchen mehr, als eine Wühlmaus je bieten kann.
    await expect(mice.locator('[data-ref="food-web-hint"]')).toHaveText('Mehr Jäger als Futter – eine weitere Art mit Kleinsäuger hilft.');

    const worms = web.locator('[data-tag="wuermer"]');
    await expect(worms.locator('[data-ref="food-web-state"]')).toHaveText(/ungejagt/);
    await expect(worms.locator('[data-ref="food-web-hunters"]')).toHaveText('Jäger: keine');

    await mice.scrollIntoViewIfNeeded();
    await noHorizontalOverflow(page);
    // Zeilen bleiben in der Seitenleiste (nichts ragt heraus).
    const panel = await page.locator('.eco').boundingBox();
    const row = await mice.boundingBox();
    expect(row!.x + row!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
  });
}

test('Tierdetails: Bestand der Beute, Futter des Jägers; Kachel zeigt den Bestand', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(context);
  await openGame(page);

  // Kachel der Wühlmaus: Bestand in Worten, keine Zahl.
  const vole = tile(page, 'roots', 'vole');
  await expect(vole.locator('.slot-stock')).toHaveText(/^Bestand (knapp|gut|reichlich)$/);
  await expect(tile(page, 'hollows', 'owl').locator('.slot-stock')).toBeHidden();

  await vole.click();
  const dialog = detail(page);
  await expect(dialog).toBeVisible();
  const section = dialog.locator('[data-ref="detail-predation"]');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Räuber und Beute' })).toBeVisible();
  await expect(section.locator('[data-predation="stock"]')).toContainText(/Bestand: (knapp|gut|reichlich)/);
  await expect(section.locator('[data-predation="prey-kleinsaeuger"]')).toContainText('Kleinsäuger: überjagt von');
  await expect(section.locator('[data-predation="prey-kleinsaeuger"]')).toContainText('eine weitere Art mit Kleinsäuger hilft');
  await expect(section.locator('[data-predation="prey-kleinsaeuger"]')).not.toContainText('zufriedenere Beute');
  await noHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(vole).toBeFocused();

  await tile(page, 'hollows', 'owl').click();
  await expect(dialog.locator('[data-predation="hunt-kleinsaeuger"]')).toContainText('Futter Kleinsäuger: zu knapp für 2 Jäger');
  await page.keyboard.press('Escape');

  // Der Regenwurm hat keinen Jäger: Hinweis, dass das kein Nachteil ist.
  await tile(page, 'roots', 'earthworm').click();
  await expect(dialog.locator('[data-predation="prey-wuermer"]')).toContainText('Würmer: noch kein Jäger');
  await expect(dialog.locator('[data-predation="prey-wuermer"]')).toContainText('Kein Nachteil');
});
