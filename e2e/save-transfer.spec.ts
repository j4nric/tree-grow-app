import type { Page } from '@playwright/test';
import { expect, niche, openGame, savedState, seedV3, stageLabel, test, waypoint } from './fixtures';

/**
 * Spielstand exportieren und importieren als Text-Code (Phase 5): Export, Löschen,
 * Import mit Bestätigung durch zweiten Klick – danach ist der Stand wieder derselbe.
 * Ungültige Codes ändern nichts.
 */

const transfer = (page: Page) => page.locator('[data-ref="save-transfer"]');

/** Vergleichbarer Stand: ohne die Uhr (lastTick) und ohne die laufenden Zähler. */
function comparable(save: Record<string, any>) {
  const { lastTick: _lastTick, totalGrowth: _growth, seeds: _seeds, ...rest } = save;
  return rest;
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
  await reset.click();
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  await expect(niche(page, 'roots')).not.toContainText('Regenwurm');

  // Importieren: erster Klick prüft und fragt nach, zweiter lädt.
  await transfer(page).locator('[data-ref="import-code"]').fill(code);
  const importButton = transfer(page).locator('[data-ref="import"]');
  await importButton.click();
  await expect(importButton).toContainText('Zum Bestätigen erneut klicken');
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  await importButton.click();
  await expect(transfer(page).locator('[data-ref="save-status"]')).toHaveText('Spielstand geladen.');
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  await expect(niche(page, 'roots')).toContainText('Regenwurm');
  await expect(niche(page, 'crown')).toContainText('Blaumeise');

  const after = await savedState(page);
  expect(comparable(after)).toEqual(comparable(before));
  expect(after.totalGrowth).toBeGreaterThanOrEqual(before.totalGrowth);
});

test('Ungültiger Code: klare Meldung, Spielstand bleibt unverändert', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, niches: { roots: ['earthworm'] } });
  await openGame(page);
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
