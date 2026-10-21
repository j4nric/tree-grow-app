import type { Page } from '@playwright/test';
import { codeFromJson } from '../src/core/save';
import { expect, niche, openGame, savedState, seedV3, stageLabel, test, waitForConfirm, waypoint } from './fixtures';

/**
 * Spielstand exportieren und importieren als Text-Code (Phase 5): Export, Löschen,
 * Import mit Bestätigung durch zweiten Klick – danach ist der Stand wieder derselbe.
 * Ungültige Codes ändern nichts.
 */

const transfer = (page: Page) => page.locator('[data-ref="save-transfer"]');

/** Vergleichbarer Stand: ohne die Uhr (lastTick) und ohne die laufenden Zähler (auch die Spielzeit). */
function comparable(save: Record<string, any>) {
  const { lastTick: _lastTick, totalGrowth: _growth, seeds: _seeds, ...rest } = save;
  const { elapsed: _elapsed, ...cycle } = rest.cycle ?? {};
  return { ...rest, cycle };
}

async function openTransfer(page: Page): Promise<void> {
  await transfer(page).locator('summary').click();
  await expect(transfer(page).locator('[data-ref="export"]')).toBeVisible();
}

test('Exportieren, Löschen, Importieren: derselbe Spielstand', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedV3(context, {
    totalGrowth: waypoint(6) + 1,
    seeds: 321,
    plants: ['moss'],
    niches: { roots: ['earthworm'], litter: ['woodlouse'], crown: ['bluetit'] },
    pendingEncounters: [{ type: 'animal', cards: ['robin', 'bee'], rerolls: 1 }],
    forestMemory: 30,
  });
  await openGame(page);
  // Neu laden: Beim Verlassen speichert das Spiel im aktuellen Format (v3 → v4).
  await page.reload();
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  const before = await savedState(page);
  expect(before.version).toBeGreaterThanOrEqual(4);

  await openTransfer(page);
  await transfer(page).locator('[data-ref="export"]').click();
  const code = await transfer(page).locator('[data-ref="export-code"]').inputValue();
  expect(code).toMatch(/^VSZW1:[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  await transfer(page).locator('[data-ref="export-copy"]').click();
  await expect(transfer(page).locator('[data-ref="save-status"]')).toHaveText(/Code kopiert|markiert/);

  // Löschen (zwei Klicks) → neues Spiel.
  const reset = page.locator('#reset');
  await reset.click();
  await waitForConfirm(page);
  await reset.click();
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  await expect(niche(page, 'roots')).not.toContainText('Regenwurm');
  // Nach dem Löschen steht kein alter Code mehr im Export-Feld.
  await expect(transfer(page).locator('[data-ref="export-code"]')).toBeHidden();
  expect(await transfer(page).locator('[data-ref="export-code"]').inputValue()).toBe('');

  // Importieren: erster Klick prüft und fragt nach, zweiter lädt.
  await transfer(page).locator('[data-ref="import-code"]').fill(code);
  const importButton = transfer(page).locator('[data-ref="import"]');
  await importButton.click();
  await expect(importButton).toContainText('Zum Bestätigen erneut klicken');
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  await waitForConfirm(page);
  await importButton.click();
  await expect(transfer(page).locator('[data-ref="save-status"]')).toHaveText('Spielstand geladen.');
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  await expect(niche(page, 'roots')).toContainText('Regenwurm');
  await expect(niche(page, 'crown')).toContainText('Blaumeise');

  const after = await savedState(page);
  expect(comparable(after)).toEqual(comparable(before));
  expect(after.totalGrowth).toBeGreaterThanOrEqual(before.totalGrowth);
  expect(after.cycle.elapsed).toBeGreaterThanOrEqual(before.cycle.elapsed);
});

test('Ungültiger Code: klare Meldung, Spielstand bleibt unverändert', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await openGame(page);
  await page.reload(); // im aktuellen Format speichern
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  const before = comparable(await savedState(page));
  await openTransfer(page);
  const status = transfer(page).locator('[data-ref="save-status"]');
  const importButton = transfer(page).locator('[data-ref="import"]');

  await importButton.click();
  await expect(status).toHaveText('Bitte füge zuerst einen Spielstand-Code ein.');

  await transfer(page).locator('[data-ref="import-code"]').fill('Hallo Wald');
  await importButton.click();
  await expect(status).toContainText('kein Spielstand-Code');
  await expect(status).toContainText('Dein Spielstand bleibt unverändert.');
  // Keine Bestätigung für Müll.
  await expect(importButton).toHaveText('Importieren');

  // Echter Code, aber ein Zeichen verändert → Prüfsumme.
  await transfer(page).locator('[data-ref="export"]').click();
  const code = await transfer(page).locator('[data-ref="export-code"]').inputValue();
  const at = 20;
  const broken = code.slice(0, at) + (code[at] === 'A' ? 'B' : 'A') + code.slice(at + 1);
  await transfer(page).locator('[data-ref="import-code"]').fill(broken);
  await importButton.click();
  await expect(status).toContainText('unvollständig oder verändert');
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  expect(comparable(await savedState(page))).toEqual(before);
});

test('Doppelklick überspringt keine Bestätigung – weder beim Import noch beim Löschen', async ({
  page,
  context,
}) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await openGame(page);
  await page.reload(); // im aktuellen Format speichern
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  const before = comparable(await savedState(page));

  // Löschen per Doppelklick: nur scharf geschaltet, nichts gelöscht.
  await page.locator('#reset').dblclick();
  await expect(page.locator('#reset')).toContainText('Wirklich alles löschen');
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');

  // Import eines anderen (gültigen) Stands per Doppelklick: nur nachgefragt.
  await openTransfer(page);
  const other = JSON.stringify({ ...(await savedState(page)), niches: { roots: [], litter: [], edge: [], crown: [], bark: [], hollows: [] } });
  await transfer(page).locator('[data-ref="import-code"]').fill(codeFromJson(other));
  const importButton = transfer(page).locator('[data-ref="import"]');
  await importButton.dblclick();
  await expect(importButton).toContainText('Zum Bestätigen erneut klicken');
  await page.waitForTimeout(300);
  await expect(niche(page, 'roots')).toContainText('Regenwurm');
  expect(comparable(await savedState(page))).toEqual(before);
});

test('Bestätigung läuft nach 5 s ab (Testuhr)', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-21T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-21T08:00:01Z'));
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await openGame(page);
  await openTransfer(page);
  await transfer(page).locator('[data-ref="export"]').click();
  const code = await transfer(page).locator('[data-ref="export-code"]').inputValue();
  await transfer(page).locator('[data-ref="import-code"]').fill(code);
  const importButton = transfer(page).locator('[data-ref="import"]');
  await importButton.click();
  await expect(importButton).toContainText('Zum Bestätigen erneut klicken');
  await page.clock.runFor(4900);
  await expect(importButton).toContainText('Zum Bestätigen erneut klicken');
  await page.clock.runFor(200);
  await expect(importButton).toHaveText('Importieren');
});

test('Import eines v1-Codes: Hinweis vorher und dieselbe Meldung wie beim Start', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await openGame(page);
  await openTransfer(page);
  const v1 = { version: 1, resources: { water: 12, light: 3, energy: 4200 }, stage: 3, totalEnergy: 5000, lastTick: 1000 };
  await transfer(page).locator('[data-ref="import-code"]').fill(codeFromJson(JSON.stringify(v1)));
  const importButton = transfer(page).locator('[data-ref="import"]');
  await importButton.click();
  await expect(transfer(page).locator('[data-ref="save-status"]')).toContainText('ersten Version');
  await waitForConfirm(page);
  await importButton.click();
  await expect(page.locator('#toast')).toContainText('Dein Wald beginnt neu – mit Erinnerungen');
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
});

test.describe('Mobil (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Export-Bereich ohne horizontales Scrollen', async ({ page, context }) => {
    await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
    await openGame(page);
    await openTransfer(page);
    await transfer(page).locator('[data-ref="export"]').tap();
    await expect(transfer(page).locator('[data-ref="export-code"]')).toBeVisible();
    const noScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noScroll).toBe(true);
  });
});
