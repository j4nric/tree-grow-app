import type { Page } from '@playwright/test';
import { cover, expect, fullscreen, openCover, openFullscreen, openGame, openSavePage, pageTitle, polaroidButton, subpage, test } from './fixtures';

/**
 * Navigation des Albums (docs/ALBUM_UI.md, C.1–C.3): Umblättern, Zurück über Escape,
 * Lesezeichen und Browser-Zurück, auch mitten in einer Drehung und nach einem
 * Layoutwechsel. Grundlage für die album-nav-Spec aus Schritt 13.
 */

/** Ohne Unterseite ist nichts weggedreht und nichts gesperrt. */
async function expectFlat(page: Page): Promise<void> {
  await expect(page.locator('.turned-away')).toHaveCount(0);
  await expect(page.locator('.album [inert]')).toHaveCount(0);
  await expect(subpage(page, 'save')).toBeHidden();
}

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('Escape direkt nach dem Antippen: keine leere Seite, der Umschlag bleibt bedienbar', async ({ page }) => {
      await openGame(page);
      await openCover(page);
      await page.locator('[data-ref="save-open"]').click();
      // Noch während der Drehung zurück.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(900);
      await expect(cover(page)).toBeVisible();
      await expectFlat(page);
      // Weiter bedienbar: noch einmal umblättern und zurück.
      await page.locator('[data-ref="save-open"]').click();
      await expect(subpage(page, 'save')).toBeVisible();
      await expect(subpage(page, 'save')).not.toHaveAttribute('inert', '');
      await page.keyboard.press('Escape');
      await expect(subpage(page, 'save')).toBeHidden();
      await expect(cover(page)).toBeVisible();
      await expectFlat(page);
    });

    test('Browser-Zurück direkt nach dem Antippen: keine leere Seite', async ({ page }) => {
      await openGame(page);
      await openCover(page);
      await page.locator('[data-ref="save-open"]').click();
      await page.goBack();
      await page.waitForTimeout(900);
      await expect(cover(page)).toBeVisible();
      await expectFlat(page);
    });

    test('Umschlag → Spielstand → zweimal Browser-Zurück: die App bleibt, die Hauptseite ist zu sehen', async ({ page }) => {
      await openGame(page);
      await openSavePage(page);
      await page.goBack();
      await expect(subpage(page, 'save')).toBeHidden();
      await expect(cover(page)).toBeVisible();
      await page.goBack();
      await expect(cover(page)).toBeHidden();
      expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL!).origin);
      await expect(pageTitle(page)).toBeVisible();
      await expect(page.locator('[data-ref="stage"]')).toContainText('Stufe:');
      await expectFlat(page);
    });

    test('Umschlag schließen und sofort wieder öffnen: danach sichtbar', async ({ page }) => {
      await openGame(page);
      const button = page.locator('[data-ref="cover-open"]');
      // Mobil liegt der Umschlag über Knopf und Reitern: dort nur „Schließen“.
      const ways = viewport.width > 760 ? (['Knopf', 'Reiter', 'Schließen'] as const) : (['Schließen'] as const);
      for (const close of ways) {
        await openCover(page);
        // Schließen startet die Animation – der Zustand gilt sofort.
        if (close === 'Knopf') await button.click();
        else if (close === 'Reiter') await page.locator('[data-ref="tab-care"]').click();
        else await page.locator('[data-ref="cover-close"]').click();
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        // Mitten in der Schließ-Animation wieder öffnen.
        await button.click();
        await expect(button).toHaveAttribute('aria-expanded', 'true');
        await page.waitForTimeout(900);
        await expect(cover(page), close).toBeVisible();
        await expect(cover(page)).not.toHaveClass(/cover-out/);
        await expect(page.locator('[data-ref="save-open"]')).toBeVisible();
        // Und wieder zu (Ruhezustand für die nächste Runde).
        await page.keyboard.press('Escape');
        await expect(cover(page)).toBeHidden();
      }
    });

    test('Doppelklick aufs Lesezeichen geht nur eine Ebene zurück', async ({ page }) => {
      await openGame(page);
      await openSavePage(page);
      await page.locator('[data-ref="bookmark"]').dblclick();
      await page.waitForTimeout(900);
      await expect(cover(page)).toBeVisible();
      await expect(subpage(page, 'save')).toBeHidden();
      await expect(page.locator('[data-ref="stage"]')).toContainText('Stufe:');
    });
  });
}

test('Layoutwechsel bei offener Unterseite: sichtbar, bedienbar, Zurück geht', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  await openSavePage(page);
  const save = subpage(page, 'save');

  for (const [width, height] of [
    [1200, 700],
    [390, 844],
    [1200, 700],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('[data-ref="album"]')).toHaveAttribute('data-layout', width > 760 ? 'spread' : 'single');
    await expect(save).toBeVisible();
    await expect(save).not.toHaveAttribute('inert', '');
    // Bedienbar: „Code erzeugen“ geht.
    await save.locator('[data-ref="export"]').click();
    await expect(save.locator('[data-ref="export-code"]')).toBeVisible();
  }

  await page.locator('[data-ref="bookmark"]').click();
  await expect(save).toBeHidden();
  await expect(cover(page)).toBeVisible();
  await expectFlat(page);
  // Auch mobil danach alles flach.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFlat(page);
  await page.keyboard.press('Escape');
  await expect(cover(page)).toBeHidden();
  await expect(pageTitle(page)).toBeVisible();
});

/** Vollbild zu, Canvas zurück im Polaroid, Album bedienbar (nichts mehr `inert`). */
async function expectAlbumBack(page: Page): Promise<void> {
  await expect(fullscreen(page)).toBeHidden();
  await expect(polaroidButton(page).locator('canvas#scene')).toHaveCount(1);
  await expect(page.locator('[data-ref="album"]')).not.toHaveAttribute('inert', '');
  await expect(page.locator('html')).not.toHaveClass(/album-fullscreen-open/);
  await expectFlat(page);
  await expect(pageTitle(page)).toBeVisible();
}

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
]) {
  test.describe(`Vollbild ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const how of ['Escape', 'Browser-Zurück'] as const) {
      test(`öffnen und sofort ${how}: das Album ist wieder sichtbar und bedienbar`, async ({ page }) => {
        await openGame(page);
        const historyBefore = await page.evaluate(() => history.length);
        await polaroidButton(page).click();
        // Noch während des Aufziehens zurück.
        if (how === 'Escape') await page.keyboard.press('Escape');
        else await page.goBack();
        await expectAlbumBack(page);
        // Die App ist nicht verlassen, der Verlauf wächst nicht.
        expect(page.url()).toContain('localhost');
        expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(historyBefore + 1);
        // Bedienbar: Umschlag auf und zu, Vollbild noch einmal auf und zu.
        await openCover(page);
        await page.keyboard.press('Escape');
        await expect(cover(page)).toBeHidden();
        await openFullscreen(page);
        await page.keyboard.press('Escape');
        await expectAlbumBack(page);
      });
    }
  });
}

test('Layoutwechsel 390 ↔ 1200 bei offenem Vollbild: füllt die Fläche, schließt sauber', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  await openFullscreen(page);
  for (const [width, height] of [
    [1200, 700],
    [390, 844],
    [1200, 700],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('[data-ref="album"]')).toHaveAttribute('data-layout', width > 760 ? 'spread' : 'single');
    await expect(fullscreen(page)).toBeVisible();
    // Das Canvas folgt der neuen Fläche (Backing-Store = Layout × Pixeldichte).
    await expect
      .poll(() =>
        page.locator('canvas#scene').evaluate((el, w) => {
          const c = el as HTMLCanvasElement;
          return Math.abs(c.clientWidth - w) <= 1 && Math.abs(c.width - Math.round(c.clientWidth * devicePixelRatio)) <= 1;
        }, width),
      )
      .toBe(true);
    await expect(page.locator('[data-ref="fullscreen-close"]')).toBeInViewport();
  }
  await page.locator('[data-ref="fullscreen-close"]').click();
  await expectAlbumBack(page);
  await expect(polaroidButton(page)).toBeInViewport();
  // Auch mobil danach alles in Ordnung.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFlat(page);
  await openFullscreen(page);
  await page.keyboard.press('Escape');
  await expectAlbumBack(page);
});
