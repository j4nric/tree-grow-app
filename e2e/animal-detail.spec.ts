import type { BrowserContext, Page } from '@playwright/test';
import { SPECIES_BY_ID } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { evaluate } from '../src/core/formulas';
import { createInitialState } from '../src/core/state';
import { FOOD_ENOUGH } from '../src/ui/view-format';
import { animalPage, back, expect, niche, openAnimal, openGame, seedRaw, seedV3, sticker, test, waypoint } from './fixtures';

/**
 * Tierdetails als Unterseite U:Tier (docs/ALBUM_UI.md, A.5 und B.1): Jeder Sticker einer
 * eingezogenen Art blättert um – mit Zufriedenheit und ihren Gründen, „Was es bewirkt“,
 * Räuber und Beute, Lebensgemeinschaften. Zurück über das Lesezeichen „‹ Nischen“ oder Escape.
 */

/** Junger Baum: Regenwurm und Rollassel (Humusküche noch unentdeckt), Blaumeise, Eichelhäher stört sie. */
async function seed(context: BrowserContext): Promise<void> {
  await seedV3(context, {
    totalGrowth: waypoint(8) + 1,
    niches: { roots: ['earthworm'], litter: ['woodlouse'], crown: ['bluetit', 'jay'] },
  });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const sub = document.querySelector('[data-ref="page-animal"]')!;
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sub: sub.scrollWidth - sub.clientWidth,
    };
  });
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.sub).toBeLessThanOrEqual(0);
}

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
  { name: 'schmal', width: 360, height: 740 },
]) {
  test(`U:Tier (${viewport.name}): Sticker blättert um, Escape blättert zurück und gibt den Fokus zurück`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seed(context);
    await openGame(page);

    const button = sticker(page, 'crown', 'bluetit');
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);

    const sub = await openAnimal(page, 'crown', 'bluetit');
    await expect(sub.locator('.page-title')).toHaveText('Blaumeise');
    await expect(sub.locator('.page-title')).toBeFocused();
    await expect(sub.locator('[data-ref="bookmark"]')).toHaveText('‹ Nischen');
    await expect(sub.locator('[data-ref="detail-happiness"]')).toContainText(/😊 \d+\s%/);
    await expect(sub).toContainText('Vögel · 🌳 Krone');
    // Was es braucht: Wünsche mit ✓/✗ und der Störer mit Namen
    const reasons = sub.locator('[data-ref="detail-reasons"]');
    await expect(reasons.getByRole('heading', { name: 'Was es braucht' })).toBeVisible();
    await expect(reasons.locator('[data-factor="disturb"]')).toContainText('wird gestört von Eichelhäher');
    await expect(reasons.locator('.animal-need')).not.toHaveCount(0);
    // Was es bewirkt: Beitrag als Pillen
    const effects = sub.locator('[data-ref="detail-contribution"]');
    await expect(effects.getByRole('heading', { name: 'Was es bewirkt' })).toBeVisible();
    await expect(effects.locator('.animal-contribution .animal-pill')).not.toHaveCount(0);
    // Kopfzeile: Seitenzahl bzw. Kennzahl der Nischen bleibt gleich
    await noHorizontalOverflow(page);

    await page.keyboard.press('Escape');
    await expect(sub).toBeHidden();
    await expect(button).toBeFocused();
  });
}

test('U:Tier per Tastatur: Enter blättert um, das Lesezeichen zurück', async ({ page, context }) => {
  await seed(context);
  await openGame(page);
  const button = sticker(page, 'roots', 'earthworm');
  await button.focus();
  await page.keyboard.press('Enter');
  const sub = animalPage(page);
  await expect(sub).toBeVisible();
  await expect(sub.locator('.page-title')).toHaveText('Regenwurm');
  await back(page);
  await expect(sub).toBeHidden();
  await expect(button).toBeFocused();
});

test('U:Tier: keine Spoiler für unentdeckte Lebensgemeinschaften', async ({ page, context }) => {
  await seed(context);
  await openGame(page);
  const sub = await openAnimal(page, 'roots', 'earthworm');
  const communities = sub.locator('[data-ref="detail-communities"]');
  await expect(communities).toContainText('noch unentdeckten Lebensgemeinschaft');
  // Kein Fortschritt an der Art – „2/3“ verriete, dass die übrigen Mitglieder schon da sind.
  await expect(communities).not.toContainText('Mitglieder');
  // Weder Name noch ID auf der Seite – auch nicht in Attributen.
  const html = await sub.evaluate((d) => d.outerHTML);
  expect(html).not.toContain('Humusküche');
  expect(html).not.toContain('"humus"');
  await expect(sub.locator('[data-community]')).toHaveCount(0);
});

test('Nischen: freie Plätze sind gestrichelte Kreise, keine Knöpfe', async ({ page, context }) => {
  await seed(context);
  await openGame(page);
  const crown = niche(page, 'crown');
  await expect(crown.locator('button.sticker:visible')).toHaveCount(2);
  await expect(crown.locator('.sticker-slot.is-empty button:visible')).toHaveCount(0);
  await expect(crown.locator('.sticker-empty:visible')).not.toHaveCount(0);
});

test('U:Tier: knappes Futter mit ~ statt ✓; Stimmung voll im Sticker-Titel', async ({ page, context }) => {
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

  // Kein Sticker nennt bei „100 %“ einen Futtergrund.
  const stickers = page.locator('[data-ref="page-niches"] button.sticker');
  await expect(stickers).not.toHaveCount(0);
  for (const title of await stickers.evaluateAll((list) => list.map((b) => b.getAttribute('title') ?? ''))) {
    expect(title).not.toMatch(/100 % .*(wenig Futter|teilt sich das Futter)/);
  }

  const sub = await openAnimal(page, 'crown', 'oakmoth');
  const row = sub.locator('.animal-need').first();
  await expect(row).toHaveClass(/\bpartial\b/);
  await expect(row.locator('.animal-mark')).toHaveText('~');
  await expect(row).toContainText('(teilweise)');
  await expect(row).toContainText('gedeckt');
});

test('U:Tier: „Zuerst gesehen“ nur mit Eintrag; Stammgast-Schalter wie im Tagebuch', async ({ page, context }) => {
  const state = createInitialState(Date.now(), 11);
  state.stage = 3;
  state.waypoint = STAGES[3]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  for (const id of ['earthworm', 'bluetit']) {
    state.niches[SPECIES_BY_ID.get(id)!.niche].push(id);
    state.meta.journal.species.push(id);
  }
  state.meta.journal.firstSeen.species.bluetit = { cycle: 1, season: 'spring' };
  state.meta.forestMemory = 30; // ein Stammgast-Platz
  await seedRaw(context, state, 0);
  await openGame(page);

  let sub = await openAnimal(page, 'crown', 'bluetit');
  await expect(sub.locator('[data-ref="detail-first-seen"]')).toHaveText('Zuerst gesehen: Zyklus 1, Frühling');
  const toggle = sub.locator('[data-ref="detail-regular-toggle"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(sub.locator('[data-ref="detail-regular"]')).toContainText('★ Stammgast');
  await back(page);

  // Ohne Eintrag (ältere Entdeckung) keine Zeile; der einzige Platz ist belegt.
  sub = await openAnimal(page, 'roots', 'earthworm');
  await expect(sub.locator('[data-ref="detail-first-seen"]')).toBeHidden();
  await expect(sub.locator('[data-ref="detail-regular-toggle"]')).toBeDisabled();
});
