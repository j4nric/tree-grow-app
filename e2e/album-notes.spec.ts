import { STAGES } from '../src/content/stages';
import { createInitialState } from '../src/core/state';
import { expect, note, openFullscreen, openGame, overlaps, seedRaw, settledStamp, stamp, test, waypoint } from './fixtures';

/**
 * Haftnotizen und Meldungen des Albums (docs/ALBUM_UI.md, C.4 und C.5): auf und zu, Klick
 * außerhalb, Escape, nur eine zur Zeit, Fokus zurück an den Auslöser; Stempel und Zettel.
 */

const GROVE = STAGES.findIndex((s) => s.id === 'grove');

function grove() {
  const state = createInitialState(Date.now(), 99);
  state.stage = GROVE;
  state.waypoint = STAGES[GROVE]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.niches.roots = ['earthworm', 'vole'];
  state.meta.journal.species.push('earthworm', 'vole');
  return state;
}

const harmonyLabel = (page: import('@playwright/test').Page) => page.locator('button.tape-label-harmony');

test('Etikett Harmonie: Notiz mit „Verstanden“, Klick außerhalb, Escape, nur eine zur Zeit', async ({ page, context }) => {
  await seedRaw(context, grove(), 0);
  await openGame(page);
  const harmony = note(page, 'harmony-note');
  await expect(harmony).toBeHidden();
  await expect(harmonyLabel(page)).toHaveAttribute('aria-expanded', 'false');

  await harmonyLabel(page).click();
  await expect(harmony).toBeVisible();
  await expect(harmony).toHaveAttribute('role', 'note');
  await expect(harmonyLabel(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(harmony).toContainText('Wie gut dein Wald zusammenpasst');
  await expect(harmony).toContainText(/jetzt: Wachstum ×\d/);
  // „Mehr ›“ führt zu U:Harmonie (Schritt 5) – geprüft im eigenen Test unten.
  await expect(harmony.getByRole('button', { name: 'Mehr ›' })).toBeVisible();
  // Ganz im Bild.
  const box = (await harmony.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  // „Verstanden“ schließt, der Fokus geht zurück ans Etikett.
  await harmony.getByRole('button', { name: 'Verstanden' }).click();
  await expect(harmony).toBeHidden();
  await expect(harmonyLabel(page)).toBeFocused();
  await expect(harmonyLabel(page)).toHaveAttribute('aria-expanded', 'false');

  // Zweiter Tipp auf den Auslöser schließt wieder.
  await harmonyLabel(page).click();
  await expect(harmony).toBeVisible();
  await harmonyLabel(page).click();
  await expect(harmony).toBeHidden();

  // Nur eine Notiz zur Zeit: Samen öffnen schließt Harmonie.
  await harmonyLabel(page).click();
  await page.locator('button.tape-label-seeds').click();
  await expect(note(page, 'seeds-note')).toBeVisible();
  await expect(harmony).toBeHidden();
  await expect(page.locator('[role="note"]:visible')).toHaveCount(1);

  // Klick außerhalb schließt.
  await page.locator('.album-title').click();
  await expect(note(page, 'seeds-note')).toBeHidden();

  // Escape schließt und lässt den Fokus am Auslöser.
  await page.locator('button.tape-label-growth').focus();
  await page.keyboard.press('Enter');
  await expect(note(page, 'growth-note')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(note(page, 'growth-note')).toBeHidden();
  await expect(page.locator('button.tape-label-growth')).toBeFocused();
});

test('Reiterwechsel schließt die offene Notiz', async ({ page, context }) => {
  await seedRaw(context, grove(), 0);
  await openGame(page);
  await page.locator('[data-ref="season"]').click();
  await expect(note(page, 'season-note')).toBeVisible();
  await expect(note(page, 'season-note')).toContainText(/Frühling|Sommer|Herbst|Winter/);
  await page.locator('[data-ref="tab-care"]').click();
  await expect(note(page, 'season-note')).toBeHidden();
});

test('Harmonie-Notiz: „Mehr ›“ blättert zu U:Harmonie um, das Lesezeichen zurück', async ({ page, context }) => {
  await seedRaw(context, grove(), 0);
  await openGame(page);
  await harmonyLabel(page).click();
  await note(page, 'harmony-note').getByRole('button', { name: 'Mehr ›' }).click();
  await expect(note(page, 'harmony-note')).toBeHidden();
  const sub = page.locator('[data-ref="page-harmony"]');
  await expect(sub).toBeVisible();
  await expect(sub).not.toHaveAttribute('inert', '');
  await expect(sub.locator('[data-ref="harmony-parts"]')).toContainText('Summe:');
  await expect(sub.locator('[data-ref="harmony-tiers"] [aria-current="true"]')).toHaveCount(1);
  await expect(sub.locator('.page-title')).toBeFocused();
  await sub.locator('[data-ref="bookmark"]').click();
  await expect(sub).toBeHidden();
});

test('Gattung: Chip öffnet die Erklärung als Haftnotiz', async ({ page, context }) => {
  await seedRaw(context, grove(), 0);
  await openGame(page);
  const chip = page.locator('.family-badge').first();
  await chip.click();
  const family = note(page, 'family-note');
  await expect(family).toBeVisible();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  await expect(family.locator('[data-ref="family-detail"]')).not.toBeEmpty();
  await chip.click();
  await expect(family).toBeHidden();
});

test.describe('mobil', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('Notiz bei 360 px ganz im Bild, Knöpfe 44 px, kein Querscrollen', async ({ page, context }) => {
    await seedRaw(context, grove(), 0);
    await openGame(page);
    await harmonyLabel(page).tap();
    const harmony = note(page, 'harmony-note');
    await expect(harmony).toBeVisible();
    const box = (await harmony.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    const ok = (await harmony.getByRole('button', { name: 'Verstanden' }).boundingBox())!;
    expect(ok.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    // Tippen außerhalb schließt.
    await page.locator('.album-head').tap({ position: { x: 250, y: 20 } });
    await expect(harmony).toBeHidden();
  });

  test('Meldung beim Laden: Stempel bzw. Zettel oben, ganz im Bild', async ({ page, context }) => {
    await seedRaw(context, grove(), 0);
    await openGame(page);
    await expect(stamp(page)).toContainText('neue Erfolge');
    const message = await settledStamp(page);
    const box = (await message.boundingBox())!;
    expect(box.y).toBeLessThan(160);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  });
});

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
]) {
  test(`Vollbild (${viewport.name}): Meldung über der Szene, nicht unter „Zurück ins Album“`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedRaw(context, grove(), 0);
    await openGame(page);
    await expect(stamp(page)).toContainText('neue Erfolge');
    await openFullscreen(page);
    const message = await settledStamp(page);
    await expect(message).toBeVisible();
    const box = (await message.boundingBox())!;
    const close = (await page.locator('[data-ref="fullscreen-close"]').boundingBox())!;
    expect(overlaps(box, close), 'Meldung verdeckt „Zurück ins Album“').toBe(false);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    // Über der Szene: Die Schicht liegt höher als die Vollbild-Ebene.
    const [layerZ, fullZ] = await page.evaluate(() => [
      Number(getComputedStyle(document.querySelector('[data-ref="stamps"]')!).zIndex),
      Number(getComputedStyle(document.querySelector('[data-ref="fullscreen"]')!).zIndex),
    ]);
    expect(layerZ).toBeGreaterThan(fullZ);
  });
}
