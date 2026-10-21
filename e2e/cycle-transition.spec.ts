import { expect, openGame, savedState, seedV3, stageLabel, test, waypoint } from './fixtures';

/**
 * Übergang zum Neuen Zyklus in der Szene (render/cycle.ts, DESIGN_V2.md §10): Der alte
 * Wald verblasst, eine Eichel fällt, der neue Samen leuchtet auf (~5,5 s). Danach das
 * normale Bild der Stufe 0 mit dem Erinnerungsbaum im Hintergrund. Mit Testuhr, damit
 * die Sequenz verlässlich durchläuft.
 */

// Minimale Typisierung statt @types/node (wie in playwright.config.ts).
declare const process: { env: Record<string, string | undefined> };

/** Optionaler Ordner für Screenshots der Sequenz (lokal: E2E_SHOTS=…). */
const SHOTS = process.env.E2E_SHOTS;

test('Neuer Zyklus: Übergangs-Sequenz läuft ohne Fehler, danach Stufe-0-Bild', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-21T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-21T08:00:01Z'));
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1,
    seeds: 500,
    plants: ['hazel', 'birch', 'moss'],
    niches: { roots: ['earthworm', 'vole'], litter: ['robin'], edge: ['bee'], crown: ['bluetit'] },
  });
  await openGame(page);
  await expect(stageLabel(page)).toHaveText('Stufe: Hain');
  const canvas = page.locator('canvas#scene');

  const button = page.locator('[data-ref="new-cycle"]');
  await button.click();
  await button.click();
  await expect(page.locator('#toast')).toContainText('Zyklus 2 beginnt');
  await expect(stageLabel(page)).toHaveText(/Stufe: (Samen|Keimling)/);
  expect((await savedState(page)).meta.forestMemory).toBeGreaterThan(0);

  // Mitten in der Sequenz: der alte Wald verblasst.
  await page.clock.runFor(2500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/uebergang-mitte.png` });
  const middle = await canvas.screenshot();

  // Nach ~6 s ist die Sequenz vorbei: normales Bild der neuen Stufe.
  await page.clock.runFor(4000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/uebergang-ende.png` });
  const after = await canvas.screenshot();
  expect(after.equals(middle), 'Bild nach der Sequenz unterscheidet sich von der Mitte').toBe(false);
  await expect(stageLabel(page)).toHaveText(/Stufe: (Samen|Keimling)/);
});
