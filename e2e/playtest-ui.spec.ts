import type { Page } from '@playwright/test';
import { dialog, expect, openGame, seedV3, settle, stack, test, waypoint } from './fixtures';

/**
 * Funde aus dem Playtest (mobil): wartende Begegnungen bleiben beim Scrollen erreichbar,
 * die Reiter des Naturtagebuchs passen in eine Zeile – ohne Querscrollen der Seite.
 */

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [360, 390]) {
  test(`Mobil ${width} px: wartende Begegnung beim Scrollen sichtbar, Seitenleiste ohne Countdown`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 800 });
    await seedV3(context, {
      totalGrowth: waypoint(6) + 1,
      niches: { roots: ['earthworm'] },
      pendingEncounters: [
        { type: 'animal', cards: ['bluetit', 'oakmoth'], rerolls: 0 },
        { type: 'animal', cards: ['robin'], rerolls: 0 },
      ],
    });
    await openGame(page);
    // Seitenleiste: Knopf statt „Nächste Begegnung in …“.
    const pending = page.locator('[data-ref="pending-encounters"]');
    await expect(pending).toBeVisible();
    await expect(pending).toContainText('2 Begegnungen warten');
    await expect(page.locator('[data-ref="progress-hint"]')).toBeHidden();
    expect((await pending.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Weit nach unten scrollen: Der Stapel schwebt am unteren Rand und bleibt im Bild.
    await expect(stack(page)).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('#scene-dock')).toHaveClass(/floating/);
    await expect(stack(page)).toBeInViewport();
    const box = (await stack(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Der schwebende Stapel öffnet den Dialog, Esc gibt den Fokus zurück.
    await stack(page).click();
    await expect(dialog(page)).toBeVisible();
    await settle(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();

    // Der Knopf in der Seitenleiste öffnet ebenfalls den Stapel.
    await pending.click();
    await expect(dialog(page)).toBeVisible();
    await settle(page);
    await page.keyboard.press('Escape');
    await expect(pending).toBeFocused();

    // Ganz nach oben: Der Stapel sitzt wieder in der Szene.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#scene-dock')).not.toHaveClass(/floating/);
  });

  test(`Mobil ${width} px: Naturtagebuch-Reiter in einer Zeile, scrollbar, per Tastatur bedienbar`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 800 });
    await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'], crown: ['bluetit'] } });
    await openGame(page);
    await page.locator('[data-ref="journal-open"]').click();
    const journal = page.locator('[data-ref="journal"]');
    await expect(journal).toBeVisible();

    const tablist = journal.getByRole('tablist');
    const tabs = journal.getByRole('tab');
    await expect(tabs).toHaveCount(6);
    // Eine Zeile: alle Reiter auf derselben Höhe, die Leiste nicht höher als ein Reiter.
    const tops = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const listBox = (await tablist.boundingBox())!;
    expect(listBox.height).toBeLessThan(70);
    for (const box of await tabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Tastatur: bis zum letzten Reiter – er wird in die Leiste gescrollt und ist sichtbar.
    await journal.getByRole('tab', { name: /Arten/ }).focus();
    await page.keyboard.press('End');
    const stats = journal.getByRole('tab', { name: /Statistik/ });
    await expect(stats).toHaveAttribute('aria-selected', 'true');
    await expect(stats).toBeFocused();
    await expect
      .poll(async () => {
        const tab = (await stats.boundingBox())!;
        const list = (await tablist.boundingBox())!;
        return tab.x >= list.x - 1 && tab.x + tab.width <= list.x + list.width + 1;
      })
      .toBe(true);
    await page.keyboard.press('Home');
    await expect(journal.getByRole('tab', { name: /Arten/ })).toHaveAttribute('aria-selected', 'true');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
}
