import type { Page } from '@playwright/test';
import { expect, note, openCover, openCoverPage, openGame, overlaps, seedV3, subpage, test, waypoint } from './fixtures';

/**
 * Spielanleitung, Einstellungen und der Hinweis „Neu hier?“ beim ersten Start – im Album
 * (docs/ALBUM_UI.md, B.7 und A.12): Umschlag → Unterseiten, Kapitel zum Umblättern, „Neu hier?“
 * als Haftnotiz am Umschlag-Knopf. Einstellungen liegen in localStorage (nicht im Spielstand)
 * und wirken nach dem Neuladen.
 */

// Hier zählt der erste Start: „Neu hier?“ nicht vorab als gesehen markieren (fixtures.ts).
test.use({ guideHint: true });

const guide = (page: Page) => subpage(page, 'guide');
const chapterPage = (page: Page) => subpage(page, 'guide-chapter');
const settings = (page: Page) => subpage(page, 'settings');
const hint = (page: Page) => note(page, 'guide-hint');
const motion = (page: Page) => page.evaluate(() => document.body.dataset.motion);

/** Kapitel aus dem Inhaltsverzeichnis aufschlagen (Umblättern abgewartet). */
async function openChapter(page: Page, id: string): Promise<void> {
  await guide(page).locator(`[data-chapter="${id}"]`).click();
  await expect(chapterPage(page)).toBeVisible();
  await expect(chapterPage(page)).not.toHaveAttribute('inert', '');
  await expect(chapterPage(page)).toHaveAttribute('data-section', id);
}

/** Zurück zum Inhaltsverzeichnis (Lesezeichen „‹ Spielanleitung“). */
async function backToToc(page: Page): Promise<void> {
  await chapterPage(page).locator('[data-ref="bookmark"]').click();
  await expect(guide(page)).not.toHaveAttribute('inert', '');
  await expect(chapterPage(page)).toBeHidden();
}

test('erster Start: Haftnotiz „Neu hier?“ öffnet die Anleitung und kommt danach nicht wieder', async ({ page }) => {
  await openGame(page);
  await expect(hint(page)).toBeVisible();
  await expect(hint(page)).toContainText('Neu hier?');
  // Geht von selbst auf: kein Fokusraub.
  await expect(hint(page)).not.toBeFocused();
  await hint(page).getByRole('button', { name: 'Anleitung lesen ›' }).click();
  await expect(guide(page)).toBeVisible();
  await expect(hint(page)).toBeHidden();
  // Ohne Umschlag aufgeschlagen: Das Lesezeichen nennt den Reiter.
  await expect(guide(page).locator('[data-ref="bookmark"]')).toHaveText('‹ Nischen');
  await expect(guide(page)).not.toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
  // Fokus nicht im Nichts: Er steht auf dem Umschlag-Knopf, an dem die Notiz hing.
  await expect(page.locator('[data-ref="cover-open"]')).toBeFocused();

  await page.reload();
  await openCover(page);
  await expect(page.locator('[data-ref="guide-open"]')).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
});

test('mobil: „Neu hier?“ liegt unter den Etiketten, das Bild mit dem Samen bleibt frei', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  await expect(hint(page)).toBeVisible();
  const box = (await hint(page).boundingBox())!;
  const photo = (await page.locator('.polaroid-photo').boundingBox())!;
  expect(overlaps(box, photo), 'Notiz verdeckt das Polaroid').toBe(false);
  await expect(hint(page)).toBeInViewport({ ratio: 1 });
  await hint(page).getByRole('button', { name: 'Verstanden' }).click();
  await expect(page.locator('[data-ref="cover-open"]')).toBeFocused();
});

test('geladener Spielstand: kein Hinweis „Neu hier?“', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await openGame(page);
  await openCover(page);
  await expect(page.locator('[data-ref="guide-open"]')).toBeVisible();
  await expect(hint(page)).toHaveCount(0);
});

test('Hinweis lässt sich schließen, ohne die Anleitung zu öffnen', async ({ page }) => {
  await openGame(page);
  await hint(page).getByRole('button', { name: 'Verstanden' }).click();
  await expect(hint(page)).toBeHidden();
  await expect(guide(page)).toBeHidden();
  await expect(page.locator('[data-ref="cover-open"]')).toBeFocused();
});

test('Spielanleitung: Inhaltsverzeichnis, Kapitel mit Zahlen aus dem Spiel, Blättern, Fokus zurück', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  await openCoverPage(page, 'guide');
  await expect(guide(page).getByRole('heading', { name: 'Spielanleitung' })).toBeFocused();
  await expect(guide(page).locator('[data-ref="bookmark"]')).toHaveText('‹ Umschlag');
  await expect(guide(page).locator('[data-chapter]')).toHaveCount(22);
  await expect(guide(page)).toContainText('22 Kapitel');

  // Waldlandschaft: im neuen Spiel nur eine Andeutung (Spoiler-Regel).
  await openChapter(page, 'landscape');
  await expect(chapterPage(page).getByRole('heading', { level: 2 })).toBeFocused();
  await expect(chapterPage(page)).toContainText('Ein Wald bleibt nicht allein');
  await expect(chapterPage(page)).not.toContainText('Hähersaat');
  await expect(chapterPage(page).locator('[data-ref="bookmark"]')).toHaveText('‹ Spielanleitung');
  await backToToc(page);

  for (const [id, text] of [
    ['predation', 'knapp, gut oder reichlich'],
    ['growth', /\d+ Wegpunkte/],
    ['seasons', 'Jeder Zyklus beginnt im Frühling'],
    ['events', 'höchstens einmal pro Zyklus'],
    ['care', /\d+ Knoten in \d+ Ästen/],
  ] as const) {
    await openChapter(page, id);
    await expect(chapterPage(page)).toContainText(text);
    await expect(chapterPage(page)).not.toContainText('kommt bald');
    await backToToc(page);
  }

  // Umblättern auf der Kapitelseite: erstes Kapitel ohne „davor“, weiter zum zweiten.
  await openChapter(page, 'growth');
  await expect(chapterPage(page).locator('[data-ref="guide-prev"]')).toBeHidden();
  await chapterPage(page).locator('[data-ref="guide-next"]').click();
  await expect(chapterPage(page)).toHaveAttribute('data-section', 'encounters');
  await expect(chapterPage(page).getByRole('heading', { level: 2 })).toBeFocused();
  await expect(chapterPage(page).locator('[data-ref="guide-prev"]')).toHaveText('‹ Wachstum und Wegpunkte');
  // Blättern geht nicht tiefer: Zurück führt zum Inhaltsverzeichnis, dann zum Umschlag.
  await page.keyboard.press('Escape');
  await expect(guide(page)).not.toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
  await expect(page.locator('[data-ref="guide-open"]')).toBeFocused();
});

test('Bewegung reduzieren: An greift sofort und nach dem Neuladen, Automatisch folgt dem System', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openGame(page);
  expect(await motion(page)).toBe('full');

  await openCoverPage(page, 'settings');
  await settings(page).getByLabel(/^An –/).check();
  expect(await motion(page)).toBe('reduce');
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();
  await expect(page.locator('[data-ref="settings-open"]')).toBeFocused();

  await page.reload();
  await openCover(page);
  await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
  expect(await motion(page)).toBe('reduce');

  // „Aus“ überstimmt ein System mit weniger Bewegung, „Automatisch“ folgt ihm.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCoverPage(page, 'settings');
  await expect(settings(page).getByLabel(/^An –/)).toBeChecked();
  await settings(page).getByLabel(/^Aus –/).check();
  expect(await motion(page)).toBe('full');
  await settings(page).getByLabel(/^Automatisch/).check();
  expect(await motion(page)).toBe('reduce');
});

test('Automatisch folgt einer Systemumschaltung auch nach dem Laden', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openGame(page);
  expect(await motion(page)).toBe('full');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => motion(page)).toBe('reduce');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => motion(page)).toBe('full');
});

test('Zahlenformat ausgeschrieben: große Samenzahl ohne „Mio.“', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, seeds: 2_500_000 });
  await openGame(page);
  const seeds = page.locator('[data-ref="seeds"]');
  await expect(seeds).toContainText('Mio.');
  await openCoverPage(page, 'settings');
  await settings(page).getByLabel(/^Ausgeschrieben/).check();
  await expect(seeds).toHaveText(/^2\.500\.\d{3}$/);
  await page.reload();
  await expect(seeds).toHaveText(/^2\.500\.\d{3}$/);
});

test.describe('Mobil (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  const noScroll = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  /** Quer-Überlauf einer Unterseite (scrollt mobil in der Ablage `.spread-sub`). */
  const overflowX = (page: Page, kind: string) =>
    subpage(page, kind).evaluate((p) => {
      const sub = p.closest<HTMLElement>('.spread-sub')!;
      return Math.max(sub.scrollWidth - sub.clientWidth, p.scrollWidth - p.clientWidth);
    });

  test('ausgeschrieben: 99.999.999 Samen passen in die Kachel', async ({ page, context }) => {
    await page.addInitScript(() => localStorage.setItem('tree-grow-settings', JSON.stringify({ numbers: 'long' })));
    await page.clock.install({ time: new Date('2026-10-21T08:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-21T08:00:01Z'));
    await seedV3(context, { totalGrowth: waypoint(6) + 1, seeds: 99_999_999 });
    await openGame(page);
    const seeds = page.locator('[data-ref="seeds"]');
    await expect(seeds).toHaveText('99.999.999');
    const overflow = () =>
      seeds.evaluate((value) => {
        const tile = value.closest<HTMLElement>('.tape-label')!;
        return Math.max(
          tile.scrollWidth - tile.clientWidth,
          value.getBoundingClientRect().right - tile.getBoundingClientRect().right,
        );
      });
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(await noScroll(page)).toBe(true);
    // Auch bei der schmalsten unterstützten Breite (360 px).
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(await noScroll(page)).toBe(true);
  });

  for (const width of [390, 360]) {
    test(`Hinweis, Umschlag, Anleitung und Einstellungen ohne horizontales Scrollen (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openGame(page);
      await expect(hint(page)).toBeVisible();
      expect(await noScroll(page)).toBe(true);
      // Die Notiz bleibt im Bild.
      const box = (await hint(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await openCover(page);
      await expect(hint(page)).toBeHidden();
      expect(await page.locator('[data-ref="cover"]').evaluate((c) => c.scrollWidth - c.clientWidth)).toBeLessThanOrEqual(0);
      await page.locator('[data-ref="guide-open"]').tap();
      await expect(guide(page)).not.toHaveAttribute('inert', '');
      expect(await noScroll(page)).toBe(true);
      expect(await overflowX(page, 'guide')).toBeLessThanOrEqual(0);
      await guide(page).locator('[data-chapter="encounters"]').tap();
      await expect(chapterPage(page)).not.toHaveAttribute('inert', '');
      expect(await overflowX(page, 'guide-chapter')).toBeLessThanOrEqual(0);
      // Alle Knöpfe groß genug für Touch.
      for (const button of await chapterPage(page).getByRole('button').all()) {
        if (!(await button.isVisible())) continue;
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(guide(page)).toBeHidden();
      await page.locator('[data-ref="settings-open"]').tap();
      await expect(settings(page)).not.toHaveAttribute('inert', '');
      expect(await noScroll(page)).toBe(true);
      expect(await overflowX(page, 'settings')).toBeLessThanOrEqual(0);
    });
  }
});
