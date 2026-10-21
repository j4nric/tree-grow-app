import type { Page } from '@playwright/test';
import { expect, openGame, seedV3, test, waypoint } from './fixtures';

/**
 * Spielanleitung, Einstellungen und der Hinweis „Neu hier?“ beim ersten Start.
 * Einstellungen liegen in localStorage (nicht im Spielstand) und wirken nach dem Neuladen.
 */

const guide = (page: Page) => page.locator('[data-ref="guide"]');
const settings = (page: Page) => page.locator('[data-ref="settings"]');
const motion = (page: Page) => page.evaluate(() => document.body.dataset.motion);

test('erster Start: Hinweis „Neu hier?“, öffnet die Anleitung, kommt danach nicht wieder', async ({ page }) => {
  await openGame(page);
  const hint = page.locator('[data-ref="guide-hint"]');
  await expect(hint).toContainText('Neu hier?');
  await hint.getByRole('button', { name: 'Spielanleitung öffnen' }).click();
  await expect(guide(page)).toBeVisible();
  await expect(hint).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
  // Fokus nicht im Nichts: Der Hinweis ist weg, der Fokus steht auf „Spielanleitung“.
  await expect(page.locator('[data-ref="guide-open"]')).toBeFocused();

  await page.reload();
  await expect(page.locator('[data-ref="guide-open"]')).toBeVisible();
  await expect(page.locator('[data-ref="guide-hint"]')).toHaveCount(0);
});

test('geladener Spielstand: kein Hinweis „Neu hier?“', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await openGame(page);
  await expect(page.locator('[data-ref="guide-open"]')).toBeVisible();
  await expect(page.locator('[data-ref="guide-hint"]')).toHaveCount(0);
});

test('Hinweis lässt sich schließen, ohne die Anleitung zu öffnen', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Hinweis schließen' }).click();
  await expect(page.locator('[data-ref="guide-hint"]')).toHaveCount(0);
  await expect(guide(page)).toBeHidden();
});

test('Spielanleitung: Abschnitte mit Zahlen aus dem Spiel, keine Platzhalter, Fokus zurück', async ({ page }) => {
  await openGame(page);
  const open = page.locator('[data-ref="guide-open"]');
  await open.click();
  await expect(guide(page)).toBeVisible();
  await expect(guide(page).getByRole('heading', { name: '❓ Spielanleitung' })).toBeFocused();
  await expect(guide(page).locator('[data-section]')).toHaveCount(11);
  await expect(guide(page).locator('[data-section="growth"]')).toContainText(/\d+ Wegpunkte/);
  await expect(guide(page).locator('[data-section="events"]')).toContainText('höchstens einmal pro Zyklus');
  await expect(guide(page).locator('[data-section="care"]')).toContainText(/\d+ Pflegemaßnahmen/);
  await expect(guide(page).getByText('kommt bald')).toHaveCount(0);
  await guide(page).getByRole('button', { name: 'Schließen' }).click();
  await expect(guide(page)).toBeHidden();
  await expect(open).toBeFocused();
});

test('Bewegung reduzieren: An greift sofort und nach dem Neuladen, Automatisch folgt dem System', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openGame(page);
  expect(await motion(page)).toBe('full');

  await page.locator('[data-ref="settings-open"]').click();
  await expect(settings(page)).toBeVisible();
  await settings(page).getByLabel(/^An –/).check();
  expect(await motion(page)).toBe('reduce');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-ref="settings-open"]')).toBeFocused();

  await page.reload();
  await expect(page.locator('[data-ref="settings-open"]')).toBeVisible();
  expect(await motion(page)).toBe('reduce');

  // „Aus“ überstimmt ein System mit weniger Bewegung, „Automatisch“ folgt ihm.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-ref="settings-open"]').click();
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
  await page.locator('[data-ref="settings-open"]').click();
  await settings(page).getByLabel(/^Ausgeschrieben/).check();
  await expect(seeds).toHaveText(/^2\.500\.\d{3}$/);
  await page.reload();
  await expect(seeds).toHaveText(/^2\.500\.\d{3}$/);
});

test.describe('Mobil (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  const noScroll = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

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
        const tile = value.closest<HTMLElement>('.eco-stat')!;
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

  test('Hinweis, Anleitung und Einstellungen ohne horizontales Scrollen', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('[data-ref="guide-hint"]')).toBeVisible();
    expect(await noScroll(page)).toBe(true);
    await page.locator('[data-ref="guide-open"]').tap();
    await expect(guide(page)).toBeVisible();
    expect(await noScroll(page)).toBe(true);
    expect(await guide(page).evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
    await guide(page).getByRole('button', { name: 'Schließen' }).tap();
    await page.locator('[data-ref="settings-open"]').tap();
    await expect(settings(page)).toBeVisible();
    expect(await noScroll(page)).toBe(true);
    expect(await settings(page).evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
  });
});
