import { SAVE_VERSION, expect, openGame, savedState, seedV3, stageLabel, test, waitForConfirm, waypoint } from './fixtures';

/**
 * Neuer Zyklus und Stammgäste (Schritt 2.8). Startet mit einem v3-Stand – das Laden
 * migriert ihn auf v4 (erster Zyklus, alle Tagebuch-Arten zählen als neu).
 */

const GROVE_NICHES = { roots: ['earthworm', 'vole'], litter: ['robin'], edge: ['bee'], crown: ['bluetit'] };

test('Neuer Zyklus im Hain: zwei Klicks, Toast, Stufe 0 und mehr Waldgedächtnis', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(20) + 1, seeds: 500, niches: GROVE_NICHES, plants: ['hazel'] });
  await openGame(page);
  await expect(stageLabel(page)).toHaveText('Stufe: Hain');

  const panel = page.locator('[data-ref="cycle-panel"]');
  await expect(panel.locator('[data-ref="cycle-blocker"]')).toBeHidden();
  // 5 neue Arten → mindestens 5 Punkte (Harmonie zählt erst über 100, seit 2.11), Prozent in Klammern.
  await expect(panel.locator('[data-ref="cycle-gain"]')).toHaveText(/^\+\d+ Waldgedächtnis \(\+\d+ %\)$/);
  const before = await savedState(page);
  expect(before.meta?.forestMemory ?? 0).toBe(0);

  const button = panel.locator('[data-ref="new-cycle"]');
  await button.click();
  await expect(button).toContainText('Zum Bestätigen erneut klicken');
  await waitForConfirm(page);
  await button.click();

  await expect(page.locator('#toast')).toContainText('Zyklus 2 beginnt');
  // Der Knopf verschwindet – der Fokus landet auf der Überschrift, nicht auf body.
  await expect(panel.locator('[data-ref="cycle-title"]')).toBeFocused();
  // Sofort gespeichert: Stufe 0, Waldgedächtnis gestiegen, Tagebuch bleibt.
  const after = await savedState(page);
  expect(after.version).toBe(SAVE_VERSION);
  expect(after.stage).toBe(0);
  expect(after.waypoint).toBe(0);
  expect(after.cycle.number).toBe(2);
  expect(after.meta.forestMemory).toBeGreaterThanOrEqual(5);
  expect(after.meta.journal.species).toEqual(expect.arrayContaining(['earthworm', 'vole', 'robin', 'bee', 'bluetit']));
  expect(after.niches.roots).toEqual([]);
  expect(after.plants).toEqual([]);
  await expect(stageLabel(page)).toHaveText(/Stufe: (Samen|Keimling)/);
  // Danach wieder gesperrt.
  await expect(panel.locator('[data-ref="cycle-blocker"]')).toContainText('„Hain“');
  await expect(button).toBeHidden();
});

test('vor dem Hain: Grund statt Knopf, keine Stammgäste ohne Waldgedächtnis', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await openGame(page);
  const panel = page.locator('[data-ref="cycle-panel"]');
  await expect(panel.locator('[data-ref="cycle-blocker"]')).toContainText('noch 14 Wegpunkte');
  await expect(panel.locator('[data-ref="new-cycle"]')).toBeHidden();
  await expect(panel.locator('[data-ref="regulars"]')).toBeHidden();
});

test('Stammgäste wählen: Liste ab 25 Waldgedächtnis, Auswahl wird gespeichert', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'], litter: ['robin'] }, forestMemory: 30 });
  await openGame(page);
  const regulars = page.locator('[data-ref="regulars"]');
  await expect(regulars).toBeVisible();
  await expect(regulars).toContainText('Stammgäste 0/1');
  const worm = regulars.locator('[data-regular="earthworm"]');
  await worm.click();
  await expect(regulars.locator('[data-regular="earthworm"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(regulars).toContainText('Stammgäste 1/1');
  await expect(regulars.locator('[data-regular="robin"]')).toBeDisabled();
  expect((await savedState(page)).meta.regulars).toEqual(['earthworm']);
});
