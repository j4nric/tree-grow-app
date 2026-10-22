import type { Page } from '@playwright/test';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { STAGES } from '../src/content/stages';
import { createInitialState } from '../src/core/state';
import { SAVE_VERSION, expect, openGame, savedState, seedRaw, stageLabel, test, waitForConfirm, waypoint } from './fixtures';

/**
 * Jahreszeiten und Wahl des Hauptbaums (DESIGN_V2.md 16, 17) im Browser. Die Testuhr steht
 * still; Zeit vergeht nur über `page.clock`.
 */

const START = new Date('2026-10-21T08:00:00Z');
const season = (page: Page) => page.locator('[data-ref="season"]');
const cyclePanel = (page: Page) => page.locator('[data-ref="cycle-panel"]');

async function startClock(page: Page): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
}

test('kurz vor dem Wechsel: nach dem Wechsel zeigt die Kopfzeile die neue Jahreszeit', async ({ page, context }) => {
  await startClock(page);
  const state = createInitialState(START.getTime(), 4711);
  state.cycle.elapsed = 178; // 2 s vor dem Sommer
  await seedRaw(context, state, 0);
  await openGame(page);
  await expect(season(page)).toContainText('🌱 Frühling · noch 0:0');
  await expect(season(page)).toHaveAttribute('title', /Frühling: \+10 % 🌿/);
  // Wirkungen auch per Tastatur: Knopf klappt eine sichtbare Zeile auf.
  const effects = page.locator('[data-ref="season-effects"]');
  await expect(effects).toBeHidden();
  await season(page).focus();
  await page.keyboard.press('Enter');
  await expect(season(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(effects).toBeVisible();
  await expect(effects).toHaveText(/Frühling: \+10 % 🌿/);

  await page.clock.runFor(3_000);
  await expect(season(page)).toHaveText(/^☀️ Sommer · noch (3:00|2:5\d) min$/);
  await expect(season(page)).toHaveAttribute('data-season', 'summer');
  // Kurzer Hinweis beim Wechsel – zusammen mit dem Wetter des neuen Tages.
  await expect(page.locator('#toast')).toContainText(/^☀️ Sommer · \S+ [^–]+ – Lange, helle Tage/);

  // Der Spielstand führt die Spielzeit (gespeichert spätestens beim Verlassen).
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  const saved = await savedState(page);
  expect(saved.version).toBe(SAVE_VERSION);
  expect(saved.cycle.elapsed).toBeGreaterThan(180);
  expect(saved.cycle.elapsed).toBeLessThan(190);
});

test('Neuer Zyklus mit der Rotbuche: Auswahl, Sperrhinweis, Spielstand und Anzeige', async ({ page, context }) => {
  await startClock(page);
  // Hain erreicht, Rotbuche einmal im Pflanzring gewachsen (Tagebuch), Waldkiefer nicht.
  const state = createInitialState(START.getTime(), 99);
  state.totalGrowth = waypoint(STAGES[NEW_CYCLE_MIN_STAGE]!.waypoint) + 1;
  state.meta.journal.plants = ['beech'];
  state.cycle.maxHarmony = 80;
  await seedRaw(context, state, 0);
  await openGame(page);
  await expect(stageLabel(page)).toHaveText(`Stufe: ${STAGES[NEW_CYCLE_MIN_STAGE]!.name}`);
  await expect(cyclePanel(page).locator('[data-ref="main-tree"]')).toHaveText('Hauptbaum: 🌳 Stieleiche');

  const choice = cyclePanel(page).locator('[data-ref="tree-choice"]');
  await expect(choice).toBeVisible();
  const radio = (id: string) => choice.locator(`input[data-tree="${id}"]`);
  await expect(radio('oak')).toBeChecked();
  await expect(radio('beech')).toBeEnabled();
  await expect(radio('pine')).toBeDisabled();
  // Eigenheit bzw. Sperrhinweis als Beschreibung des Knopfs (aria-describedby).
  await expect(radio('pine')).toHaveAccessibleDescription('Lass einmal eine Waldkiefer im Pflanzring wachsen.');
  await expect(radio('beech')).toHaveAccessibleDescription(/Pilze \+15 %/);
  await expect(radio('beech')).toHaveAccessibleName('Rotbuche');

  // Wahl per Klick auf den Namen; die Gruppe wird dabei nicht neu gebaut (Fokus bleibt).
  await choice.locator('.cycle-tree[data-tree="beech"]').getByText('Rotbuche').click();
  await expect(radio('beech')).toBeChecked();
  await expect(radio('beech')).toBeFocused();
  await page.clock.runFor(1_000);
  await expect(radio('beech')).toBeChecked();
  await expect(radio('beech')).toBeFocused();

  const button = cyclePanel(page).locator('[data-ref="new-cycle"]');
  await button.click();
  await expect(button).toContainText('Zum Bestätigen erneut klicken');
  await waitForConfirm(page, { clock: true });
  await button.click();
  await page.clock.runFor(50);

  await expect(page.locator('#toast')).toContainText('Aus einer Buchecker wächst ein neuer Baum.');
  await expect(stageLabel(page)).toHaveText(`Stufe: ${STAGES[0]!.name}`);
  await expect(cyclePanel(page).locator('[data-ref="main-tree"]')).toHaveText('Hauptbaum: 🍂 Rotbuche');
  await expect(season(page)).toContainText('🌱 Frühling');
  const saved = await savedState(page);
  expect(saved.cycle.number).toBe(2);
  expect(saved.cycle.mainTree).toBe('beech');
  expect(saved.cycle.elapsed).toBeLessThan(5);

  // Neuladen: die Buche bleibt.
  await page.reload();
  await expect(cyclePanel(page).locator('[data-ref="main-tree"]')).toHaveText('Hauptbaum: 🍂 Rotbuche');
  expect((await savedState(page)).cycle.mainTree).toBe('beech');
});
