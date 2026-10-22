import type { BrowserContext, Page } from '@playwright/test';
import { back, expect, openAnimal, openGame, seedV3, settledSubpage, sticker, test, waypoint } from './fixtures';

/**
 * Räuber und Beute (DESIGN_V2.md 22.7) im Album: Link „Nahrungsnetz ›“ im Reiter Nischen
 * blättert zu U:Nahrungsnetz um; Bestand als Punkt am Sticker und im Kopf von U:Tier;
 * „Räuber und Beute“ in U:Tier mit „Nahrungsnetz ›“ (Ebene 2) – mobil ohne Querscrollen.
 */

const foodWeb = (page: Page) => page.locator('[data-ref="food-web"]');

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
  test(`Nahrungsnetz (${viewport.name}): Link blättert um, Zustand als Text, Hinweis, Jäger-Sticker`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(context);
    await openGame(page);

    const link = page.locator('[data-ref="food-web-link"]');
    await expect(link).toContainText('Nahrungsnetz');
    await expect(page.locator('[data-ref="food-web-summary"]')).toHaveText('1 überjagt · 1 ungejagt');
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Per Tastatur (echter Knopf).
    await link.focus();
    await page.keyboard.press('Enter');
    const sub = await settledSubpage(page, 'foodweb');
    await expect(sub.locator('[data-ref="bookmark"]')).toHaveText('‹ Nischen');

    const web = foodWeb(page);
    const mice = web.locator('[data-tag="kleinsaeuger"]');
    await expect(mice).toBeVisible();
    await expect(mice.locator('[data-ref="food-web-state"]')).toHaveText(/überjagt/);
    await expect(mice.locator('[data-ref="food-web-prey"]')).toContainText(/Beute: Wühlmaus · Bestand (knapp|gut|reichlich)/);
    await expect(mice.locator('[data-ref="food-web-hunters"]')).toContainText('Waldkauz');
    await expect(mice.locator('[data-ref="food-web-hunters"]')).toContainText('Rotfuchs');
    await expect(mice.locator('.web-hunter:visible')).toHaveCount(2);
    // Bestand am Maximum: Zwei Jäger brauchen mehr, als eine Wühlmaus je bieten kann.
    await expect(mice.locator('[data-ref="food-web-hint"]')).toHaveText('Mehr Jäger als Futter – eine weitere Art, die Kleinsäuger bietet, hilft.');

    const worms = web.locator('[data-tag="wuermer"]');
    await expect(worms.locator('[data-ref="food-web-state"]')).toHaveText(/ungejagt/);
    await expect(worms.locator('[data-ref="food-web-hunters"]')).toHaveText('Jäger: keine');

    await mice.scrollIntoViewIfNeeded();
    await noHorizontalOverflow(page);
    // Zeilen bleiben auf der Seite (nichts ragt heraus).
    const panel = await sub.boundingBox();
    const row = await mice.boundingBox();
    expect(row!.x + row!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);

    await back(page);
    await expect(sub).toBeHidden();
    await expect(link).toBeFocused();
  });
}

test('U:Tier: Bestand der Beute, Futter des Jägers, „Nahrungsnetz ›“ als Ebene 2', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(context);
  await openGame(page);

  // Sticker der Wühlmaus: Bestand als Punkt und in Worten (Screenreader), keine Zahl.
  const vole = sticker(page, 'roots', 'vole');
  await expect(vole.locator('.sticker-stock')).toBeVisible();
  await expect(vole).toContainText(/Bestand (knapp|gut|reichlich)/);
  await expect(sticker(page, 'hollows', 'owl').locator('.sticker-stock')).toBeHidden();

  let sub = await openAnimal(page, 'roots', 'vole');
  await expect(sub.locator('[data-ref="detail-stock"]')).toContainText(/Bestand: (knapp|gut|reichlich)/);
  const section = sub.locator('[data-ref="detail-predation"]');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Räuber und Beute' })).toBeVisible();
  await expect(section.locator('[data-predation="stock"]')).toContainText(/Bestand: (knapp|gut|reichlich)/);
  await expect(section.locator('[data-predation="prey-kleinsaeuger"]')).toContainText('Kleinsäuger: überjagt von');
  await expect(section.locator('[data-predation="prey-kleinsaeuger"]')).toContainText('eine weitere Art, die Kleinsäuger bietet, hilft');
  await expect(section.locator('[data-predation="prey-kleinsaeuger"]')).not.toContainText('zufriedenere Beute');
  await noHorizontalOverflow(page);

  // Ebene 2: Nahrungsnetz, das Lesezeichen nennt die Art.
  await section.locator('[data-ref="detail-food-web"]').click();
  const web = await settledSubpage(page, 'foodweb');
  await expect(web.locator('[data-ref="bookmark"]')).toHaveText('‹ Wühlmaus');
  await back(page);
  await expect(web).toBeHidden();
  await expect(sub).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sub).toBeHidden();
  await expect(vole).toBeFocused();

  sub = await openAnimal(page, 'hollows', 'owl');
  await expect(sub.locator('[data-predation="hunt-kleinsaeuger"]')).toContainText('Futter Kleinsäuger: zu knapp für 2 Jäger');
  await page.keyboard.press('Escape');
  await expect(sub).toBeHidden();

  // Der Regenwurm hat keinen Jäger: Hinweis, dass das kein Nachteil ist.
  sub = await openAnimal(page, 'roots', 'earthworm');
  await expect(sub.locator('[data-predation="prey-wuermer"]')).toContainText('Würmer: noch kein Jäger');
  await expect(sub.locator('[data-predation="prey-wuermer"]')).toContainText('Kein Nachteil');
});
