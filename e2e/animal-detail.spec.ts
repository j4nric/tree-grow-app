import type { BrowserContext, Page } from '@playwright/test';
import { expect, niche, openGame, seedV3, test, waypoint } from './fixtures';

/**
 * Tierdetails: Jede eingezogene Art in der Nischen-Übersicht ist ein Knopf, der einen
 * Dialog im Stil der Begegnungskarte öffnet – mit Zufriedenheit und ihren Gründen.
 */

const detail = (page: Page) => page.locator('[data-ref="animal-detail"]');
const tile = (page: Page, nicheId: string, species: string) =>
  niche(page, nicheId).locator(`[data-species="${species}"] button.slot-open`);

/** Junger Baum: Regenwurm und Rollassel (Humusküche noch unentdeckt), Blaumeise, Eichelhäher stört sie. */
async function seed(context: BrowserContext): Promise<void> {
  await seedV3(context, {
    totalGrowth: waypoint(8) + 1,
    niches: { roots: ['earthworm'], litter: ['woodlouse'], crown: ['bluetit', 'jay'] },
  });
}

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
  { name: 'schmal', width: 360, height: 740 },
]) {
  test(`Tierdetails (${viewport.name}): Kachel öffnet Dialog, Esc gibt den Fokus zurück`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(context);
    await openGame(page);

    const button = tile(page, 'crown', 'bluetit');
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await button.click();

    const dialog = detail(page);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Blaumeise' })).toBeVisible();
    await expect(dialog.locator('[data-ref="detail-happiness"]')).toContainText(/😊 \d+\s%/);
    await expect(dialog).toContainText('Vögel');
    await expect(dialog).toContainText('Nische: 🌳 Krone');
    // Gründe: Wünsche mit ✓/✗ und der Störer mit Namen
    await expect(dialog.locator('[data-factor="disturb"]')).toContainText('wird gestört von Eichelhäher');
    await expect(dialog.locator('.card-conditions li')).not.toHaveCount(0);
    // Beitrag als Chips wie auf der Karte
    await expect(dialog.locator('.detail-contribution .preview-chip')).not.toHaveCount(0);

    // Kein Querscrollen – weder Seite noch Dialog
    const overflow = await page.evaluate(() => {
      const d = document.querySelector('[data-ref="animal-detail"]')!;
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dialog: d.scrollWidth - d.clientWidth,
      };
    });
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.dialog).toBeLessThanOrEqual(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });
}

test('Tierdetails per Tastatur: Enter öffnet, „Schließen“ gibt den Fokus zurück', async ({ page, context }) => {
  await seed(context);
  await openGame(page);
  const button = tile(page, 'roots', 'earthworm');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Regenwurm' })).toBeVisible();
  await expect(detail(page).locator('[data-ref="detail-close"]')).toBeFocused();
  await detail(page).locator('[data-ref="detail-close"]').click();
  await expect(detail(page)).toBeHidden();
  await expect(button).toBeFocused();
});

test('Tierdetails: keine Spoiler für unentdeckte Lebensgemeinschaften', async ({ page, context }) => {
  await seed(context);
  await openGame(page);
  await tile(page, 'roots', 'earthworm').click();
  const dialog = detail(page);
  await expect(dialog.locator('[data-ref="detail-communities"]')).toContainText('???');
  await expect(dialog.locator('[data-ref="detail-communities"]')).toContainText('2/3 Mitglieder');
  // Weder Name noch ID im Dialog – auch nicht in Attributen.
  const html = await dialog.evaluate((d) => d.outerHTML);
  expect(html).not.toContain('Humusküche');
  expect(html).not.toContain('"humus"');
  await expect(dialog.locator('[data-community]')).toHaveCount(0);
});
