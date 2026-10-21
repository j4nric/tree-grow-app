import { createInitialState } from '../src/core/state';
import { SAVE_VERSION, expect, niche, openGame, savedState, seedRaw, seedV3, stageLabel, test, waitForConfirm, waypoint } from './fixtures';

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
  // 5 neue Arten → mindestens 10 Punkte, Prozent in Klammern.
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
  expect(after.meta.forestMemory).toBeGreaterThanOrEqual(10);
  expect(after.meta.journal.species).toEqual(expect.arrayContaining(['earthworm', 'vole', 'robin', 'bee', 'bluetit']));
  expect(after.niches.roots).toEqual([]);
  expect(after.plants).toEqual([]);
  // Langzeit-Statistik (v8): aus dem v3-Stand migriert, überdauert den Zyklus.
  expect(after.meta.stats.grownTrees).toEqual(['oak']);
  expect(after.meta.stats.completedCyclesGrowth).toBeGreaterThanOrEqual(waypoint(20));
  expect(after.meta.stats.bestHarmony).toBeGreaterThan(0);
  expect(after.meta.stats.playSeconds).toBeGreaterThan(0);
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
  // Die Regel fürs Waldgedächtnis steht schon vor dem Hain da.
  await expect(panel.locator('[data-ref="memory-rule"]')).toHaveText(
    'Waldgedächtnis: 1 Punkt je 5 Punkte höchster Harmonie und je neue Art. Höchste Harmonie ab 101 zählt extra: etwa +3 je Punkt (bis 115). Die Schwelle steigt mit dem Wachstum bis 164 im Urwald, dort 1 Punkt je 7 – Erreichtes bleibt.',
  );
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

test('Mobil: Amphibien-Stammgast wartet auf den Waldtümpel und zieht mit der Pflege ein', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Alter Baum, Tümpel noch nicht angelegt; Erdkröte gewählt, Grasfrosch nur entdeckt.
  const state = createInitialState(Date.now(), 7);
  state.totalGrowth = waypoint(12) + 1;
  state.waypoint = 12;
  state.stage = 4;
  state.seeds = 10_000;
  state.niches.roots = ['earthworm'];
  state.meta.journal.species = ['earthworm', 'toad', 'frog'];
  state.meta.forestMemory = 50;
  state.meta.regulars = ['toad'];
  await seedRaw(context, state, 0);
  await openGame(page);

  const regulars = page.locator('[data-ref="regulars"]');
  const toad = regulars.locator('[data-regular="toad"]');
  const toadNote = regulars.locator('[data-regular-note="toad"]');
  await expect(toadNote).toHaveText('wartet auf den Waldtümpel');
  await expect(toad).toHaveAccessibleDescription('wartet auf den Waldtümpel');
  await expect(regulars.locator('[data-regular="frog"]')).toHaveAccessibleDescription(
    'zieht erst ein, wenn der Waldtümpel wieder angelegt ist (Pflege ab „Alter Baum“)',
  );
  await expect(regulars.locator('[data-regular-note="earthworm"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // Tümpel anlegen: Die Kröte zieht sofort ein, statt zu warten steht der Hinweis fürs nächste Mal da.
  await niche(page, 'pond').getByRole('button', { name: 'Zur Pflege: Waldtümpel öffnen' }).click();
  await page.locator('[data-ref="care"] [data-buy-care="pond"]').click();
  await expect(toadNote).toHaveText('zieht erst ein, wenn der Waldtümpel wieder angelegt ist (Pflege ab „Alter Baum“)');
  await expect(toad).toContainText('lebt hier');
  expect((await savedState(page)).niches.pond).toEqual(['toad']);
});
