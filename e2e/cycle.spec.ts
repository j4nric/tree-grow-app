import { createInitialState } from '../src/core/state';
import {
  SAVE_VERSION,
  back,
  expect,
  gotoTab,
  niche,
  openGoalsPage,
  openTab,
  pageTitle,
  savedState,
  seedRaw,
  seedV3,
  stageLabel,
  stamps,
  test,
  waitForConfirm,
  waypoint,
} from './fixtures';

/**
 * Neuer Zyklus und Stammgäste (Schritt 2.8) – im Album auf der Unterseite „Neuer Zyklus“ des
 * Reiters „Ziele“ (ALBUM_UI.md B.4). Startet mit einem v3-Stand – das Laden migriert ihn auf
 * v4 (erster Zyklus, alle Tagebuch-Arten zählen als neu).
 */

const GROVE_NICHES = { roots: ['earthworm', 'vole'], litter: ['robin'], edge: ['bee'], crown: ['bluetit'] };

test('Neuer Zyklus im Hain: zwei Klicks, Toast, Stufe 0 und mehr Waldgedächtnis', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(20) + 1, seeds: 500, niches: GROVE_NICHES, plants: ['hazel'] });
  await gotoTab(page, 'ziele');
  await expect(stageLabel(page)).toHaveText('Stufe: Hain');
  // Punkt am Reiter und Kurzkarte: ein Neuer Zyklus ist möglich.
  await expect(page.locator('[data-ref="tab-goals"] .tab-dot')).toBeVisible();
  await expect(page.locator('[data-ref="cycle-card"]')).toHaveClass(/ready/);
  await expect(page.locator('[data-ref="cycle-card-line"]')).toHaveText(/^\+\d+ Waldgedächtnis/);

  const panel = await openGoalsPage(page, 'cycle');
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

  await expect(stamps(page)).toContainText('Zyklus 2 beginnt');
  // Zurück zu „Ziele“ – der Fokus landet auf der Überschrift, nicht auf body.
  await expect(panel).toBeHidden();
  await expect(pageTitle(page)).toBeFocused();
  await expect(pageTitle(page)).toHaveText('Was haben wir vor?');
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
  // Danach wieder gesperrt: Kurzkarte mit Grund, kein Punkt am Reiter.
  await expect(page.locator('[data-ref="cycle-card-line"]')).toContainText('„Hain“');
  await expect(page.locator('[data-ref="tab-goals"] .tab-dot')).toBeHidden();
  await openGoalsPage(page, 'cycle');
  await expect(panel.locator('[data-ref="cycle-blocker"]')).toContainText('„Hain“');
  await expect(button).toBeHidden();
});

test('vor dem Hain: Grund statt Knopf, keine Stammgäste ohne Waldgedächtnis', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await gotoTab(page, 'ziele');
  await expect(page.locator('[data-ref="tab-goals"] .tab-dot')).toBeHidden();
  const panel = await openGoalsPage(page, 'cycle');
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
  await gotoTab(page, 'ziele');
  await openGoalsPage(page, 'cycle');
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

test('Mobil: Amphibien-Stammgast wartet auf den Waldtümpel und zieht mit der Forschung ein', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Alter Baum, Tümpel noch nicht angelegt; Erdkröte gewählt, Grasfrosch nur entdeckt.
  const state = createInitialState(Date.now(), 7);
  state.totalGrowth = waypoint(12) + 1;
  state.waypoint = 12;
  state.stage = 4;
  state.seeds = 10_000;
  state.harmonyPoints = 10_000;
  state.cycle.research = ['compost']; // Waldtümpel braucht Kompost
  state.niches.roots = ['earthworm'];
  state.meta.journal.species = ['earthworm', 'toad', 'frog'];
  state.meta.forestMemory = 50;
  state.meta.regulars = ['toad'];
  await seedRaw(context, state, 0);
  await gotoTab(page, 'ziele');
  await openGoalsPage(page, 'cycle');

  const regulars = page.locator('[data-ref="regulars"]');
  const toad = regulars.locator('[data-regular="toad"]');
  const toadNote = regulars.locator('[data-regular-note="toad"]');
  await expect(toadNote).toHaveText('wartet auf den Waldtümpel');
  await expect(toad).toHaveAccessibleDescription('wartet auf den Waldtümpel');
  await expect(regulars.locator('[data-regular="frog"]')).toHaveAccessibleDescription(
    'zieht im nächsten Zyklus erst ein, wenn der Waldtümpel wieder angelegt ist (Forschung ab „Alter Baum“)',
  );
  await expect(regulars.locator('[data-regular-note="earthworm"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // Tümpel anlegen: Die Kröte zieht sofort ein, statt zu warten steht der Hinweis fürs nächste Mal da.
  await back(page);
  await openTab(page, 'nischen');
  await niche(page, 'pond').getByRole('button', { name: 'Zur Pflege: Waldtümpel öffnen' }).click();
  await page.locator('[data-ref="care"] [data-buy-care="pond"]').click();
  await expect.poll(async () => (await savedState(page)).niches.pond).toEqual(['toad']);
  await openGoalsPage(page, 'cycle');
  await expect(toadNote).toHaveText('zieht im nächsten Zyklus erst ein, wenn der Waldtümpel wieder angelegt ist (Forschung ab „Alter Baum“)');
  await expect(toad).toContainText('lebt hier');
  expect((await savedState(page)).niches.pond).toEqual(['toad']);
});
