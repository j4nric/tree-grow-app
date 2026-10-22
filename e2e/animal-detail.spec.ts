import type { BrowserContext, Page } from '@playwright/test';
import { SPECIES_BY_ID } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { evaluate } from '../src/core/formulas';
import { createInitialState } from '../src/core/state';
import { FOOD_ENOUGH } from '../src/ui/view-format';
import { expect, niche, openGame, seedRaw, seedV3, test, waypoint } from './fixtures';

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
  const communities = dialog.locator('[data-ref="detail-communities"]');
  await expect(communities).toContainText('noch unentdeckten Lebensgemeinschaft');
  // Kein Fortschritt an der Art – „2/3“ verriete, dass die übrigen Mitglieder schon da sind.
  await expect(communities).not.toContainText('Mitglieder');
  // Weder Name noch ID im Dialog – auch nicht in Attributen.
  const html = await dialog.evaluate((d) => d.outerHTML);
  expect(html).not.toContain('Humusküche');
  expect(html).not.toContain('"humus"');
  await expect(dialog.locator('[data-community]')).toHaveCount(0);
});

test('Tierdetails: freie Plätze sind keine Knöpfe', async ({ page, context }) => {
  await seed(context);
  await openGame(page);
  const crown = niche(page, 'crown');
  await expect(crown.locator('button.slot-open')).toHaveCount(2);
  await expect(crown.locator('.slot.empty button')).toHaveCount(0);
});

test('Tierdetails: Ziehen vom Karteninhalt auf den Hintergrund schließt nicht', async ({ page, context }) => {
  await seed(context);
  await openGame(page);
  await tile(page, 'crown', 'bluetit').click();
  const dialog = detail(page);
  await expect(dialog).toBeVisible();
  // Textauswahl: Maus auf der Karte drücken, außerhalb loslassen.
  const title = await dialog.locator('#animal-detail-title').boundingBox();
  await page.mouse.move(title!.x + 5, title!.y + 5);
  await page.mouse.down();
  await page.mouse.move(2, 2, { steps: 4 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  // Ein echter Klick auf den Hintergrund schließt.
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
});

test('Tierdetails: knappes Futter mit ~ statt ✓, volle Zufriedenheit ohne Futtergrund', async ({ page, context }) => {
  const start = new Date('2026-10-21T08:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
  // Vier Laubfresser teilen sich das Laub der Rotbuche – der Eichenwickler wird nicht satt.
  const state = createInitialState(start.getTime(), 7);
  state.stage = 3;
  state.waypoint = STAGES[3]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.cycle.mainTree = 'beech';
  for (const id of ['earthworm', 'woodlouse', 'oakmoth', 'barkbeetle']) {
    state.niches[SPECIES_BY_ID.get(id)!.niche].push(id);
    state.meta.journal.species.push(id);
  }
  const food = evaluate(state).animals.oakmoth!.food;
  expect(food).toBeGreaterThan(0);
  expect(food).toBeLessThan(FOOD_ENOUGH);
  await seedRaw(context, state, 0);
  await openGame(page);

  // Keine Kachel nennt bei „100 %“ einen Futtergrund.
  const tiles = page.locator('button.slot-open');
  await expect(tiles).not.toHaveCount(0);
  for (const text of await tiles.allInnerTexts()) {
    expect(text.replace(/\s+/g, ' ')).not.toMatch(/100 % .*(wenig Futter|teilt sich das Futter)/);
  }

  await tile(page, 'crown', 'oakmoth').click();
  const row = detail(page).locator('.card-conditions li').first();
  await expect(row).toHaveClass(/\bpartial\b/);
  await expect(row.locator('.mark')).toHaveText('~');
  await expect(row).toContainText('(teilweise)');
  await expect(row).toContainText('gedeckt');
});
