import type { Page } from '@playwright/test';
import { expect, openGame, test } from './fixtures';

/**
 * Klang (⚙️ Einstellungen → Klang): Standard aus, Wahl bleibt nach dem Neuladen, und
 * nichts bricht – weder mit echtem Web Audio noch ganz ohne AudioContext.
 * `body[data-sound]` zeigt den Zustand der Klangkulisse (off/waiting/running/paused/unavailable).
 */

const settings = (page: Page) => page.locator('[data-ref="settings"]');
const soundGroup = (page: Page) => settings(page).locator('[data-setting="sound"]');
const soundState = (page: Page) => page.evaluate(() => document.body.dataset.sound);

async function openSettings(page: Page): Promise<void> {
  await page.locator('[data-ref="settings-open"]').click();
  await expect(settings(page)).toBeVisible();
}

test('Klang: Standard aus, umschalten per Tastatur, bleibt nach dem Neuladen', async ({ page }) => {
  await openGame(page);
  expect(await soundState(page)).toBe('off');
  await openSettings(page);
  await expect(settings(page).getByRole('group', { name: 'Klang' })).toBeVisible();
  await expect(soundGroup(page).getByLabel(/^Aus \(Standard/)).toBeChecked();

  // Tastatur: Fokus auf die gewählte Option, Pfeil nach unten wählt „Leise“.
  await soundGroup(page).getByLabel(/^Aus \(Standard/).focus();
  await page.keyboard.press('ArrowDown');
  await expect(soundGroup(page).getByLabel(/^Leise/)).toBeChecked();
  await expect.poll(() => soundState(page)).toMatch(/^(running|paused)$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tree-grow-settings') ?? '{}').sound)).toBe('quiet');

  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
  // Nach dem Neuladen wartet der Klang auf eine Interaktion (Autoplay-Regeln).
  expect(await soundState(page)).toBe('waiting');
  await openSettings(page);
  await expect(soundGroup(page).getByLabel(/^Leise/)).toBeChecked();
  await expect.poll(() => soundState(page)).toMatch(/^(running|paused)$/);

  await soundGroup(page).getByLabel(/^Normal/).check();
  await soundGroup(page).getByLabel(/^Aus \(Standard/).check();
  await expect.poll(() => soundState(page)).toBe('off');
  await page.reload();
  await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
  expect(await soundState(page)).toBe('off');
});

test('Klang ohne Web Audio: keine Fehler, Einstellung bleibt wählbar', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.AudioContext;
    delete w.webkitAudioContext;
  });
  await openGame(page);
  expect(await page.evaluate(() => 'AudioContext' in window)).toBe(false);
  await openSettings(page);
  await soundGroup(page).getByLabel(/^Normal/).check();
  await expect.poll(() => soundState(page)).toBe('unavailable');
  await page.keyboard.press('Escape');
  // Spiel läuft weiter: ein paar Frames und Klicks ohne Fehler.
  await page.mouse.click(10, 10);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
  await page.mouse.click(10, 10);
  expect(await soundState(page)).toBe('unavailable');
});
