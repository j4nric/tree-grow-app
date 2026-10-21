import {
  card,
  dialog,
  expect,
  niche,
  openGame,
  openStack,
  readNumber,
  savedState,
  seedRaw,
  seedV2,
  seedsValue,
  settle,
  stack,
  stageLabel,
  test,
  waypoint,
} from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Smoke-Tests für „Vom Samen zum Wald“ (v2-Prototyp: Begegnungen und Kartenwahl).
 * Bedienung: Wartende Begegnungen liegen als Stapel am Rand der Szene; erst ein Klick
 * darauf öffnet den Kartenwahl-Dialog.
 * Bewusst ohne Pixel- oder Layout-Vergleiche: Selektoren nur über Rollen, Text und
 * data-ref-/data-Attribute, damit Änderungen an Optik und Renderer die Tests nicht brechen.
 * Gemeinsame Hilfen (Spielstand setzen, Fehler sammeln) stehen in fixtures.ts.
 */

test('Spiel startet ohne Fehler mit Titel und Canvas, ohne Klick-Button, Upgrades und Dialog', async ({ page }) => {
  await openGame(page);
  await expect(page).toHaveTitle('Vom Samen zum Wald');
  await expect(page.getByRole('heading', { level: 1, name: 'Vom Samen zum Wald' })).toBeVisible();
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  await expect(page.getByRole('button', { name: /Wachsen/ })).toHaveCount(0);
  await expect(page.locator('.upgrade')).toHaveCount(0);
  await expect(stack(page)).toBeHidden();
  await expect(dialog(page)).toBeHidden();
  await expect(niche(page, 'roots')).toContainText('verschlossen');

  const canvas = page.locator('canvas#scene');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  // Einige Frames laufen lassen, damit Fehler im Game Loop auffallen.
  await page.waitForTimeout(500);
});

test('Wachstum läuft von selbst, die erste Begegnung wartet ruhig im Stapel', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('[data-ref="growth-rate"]')).not.toHaveText('0/s');
  // Erster Wegpunkt bei 4 Gesamt-Wachstum: nach ~4 s ist der Samen ein Keimling.
  await expect(stageLabel(page)).toHaveText('Stufe: Keimling', { timeout: 8_000 });
  await expect(stack(page)).toBeVisible();
  await expect(stack(page)).toHaveText(/1 Begegnung wartet/);
  // Der Dialog drängt sich nicht auf.
  await page.waitForTimeout(300);
  await expect(dialog(page)).toBeHidden();

  await openStack(page);
  const worm = card(page, 'earthworm');
  await expect(worm).toContainText('Regenwurm');
  await expect(worm).toContainText('Bodenleben');
  await expect(worm).toContainText('gewöhnlich');
  await expect(worm).toContainText('Wurzelraum');
  await expect(worm).toContainText('Harmonie'); // Vorschau (Screenreader-Text)

  // „Später“ legt die Begegnung zurück auf den Stapel.
  await dialog(page).getByRole('button', { name: 'Später' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(stack(page)).toBeVisible();
});

test('Karte wählen: Tier zieht ein, nächste Begegnung folgt, Neuladen zeigt denselben Stand', async ({
  page,
  context,
}) => {
  // Junger Baum mit zwei offenen Begegnungen (Karten fest im Spielstand)
  await seedV2(context, {
    totalGrowth: waypoint(6) + 1,
    seeds: 3,
    niches: { roots: ['earthworm'] },
    pendingEncounters: [
      { type: 'animal', cards: ['bluetit', 'oakmoth', 'robin'], rerolls: 0 },
      { type: 'animal', cards: ['woodlouse', 'barkbeetle'], rerolls: 0 },
    ],
  });
  await openGame(page);
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  await expect(stack(page)).toHaveText(/2 Begegnungen warten/);
  await expect(dialog(page)).toBeHidden();

  await openStack(page);
  await expect(dialog(page)).toContainText('noch 1 weitere Begegnung wartet');
  await card(page, 'bluetit').getByRole('button', { name: 'Blaumeise wählen' }).click();

  // Die nächste wartende Begegnung erscheint direkt.
  await expect(card(page, 'woodlouse')).toBeVisible();
  await expect(card(page, 'barkbeetle')).toBeVisible();
  await expect(niche(page, 'crown')).toContainText('Blaumeise');
  await expect(stack(page)).toHaveText(/1 Begegnung wartet/);

  await page.reload();
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  await expect(dialog(page)).toBeHidden();
  await expect(niche(page, 'crown')).toContainText('Blaumeise');
  await expect(niche(page, 'roots')).toContainText('Regenwurm');
  await expect(stack(page)).toHaveText(/1 Begegnung wartet/);
  await openStack(page);
  await expect(card(page, 'woodlouse')).toBeVisible();
  await expect(card(page, 'barkbeetle')).toBeVisible();

  const saved = await savedState(page);
  expect(saved.version).toBe(2);
  expect(saved.niches.crown).toEqual(['bluetit']);
  expect(saved.pendingEncounters).toEqual([{ type: 'animal', cards: ['woodlouse', 'barkbeetle'], rerolls: 0 }]);
});

test('Neu würfeln kostet Samen, Ablehnen bringt Samen, Escape legt zurück', async ({ page, context }) => {
  await seedV2(context, {
    totalGrowth: waypoint(6) + 1,
    seeds: 12,
    pendingEncounters: [
      { type: 'animal', cards: ['bluetit'], rerolls: 0 },
      { type: 'animal', cards: ['robin'], rerolls: 0 },
    ],
  });
  await openGame(page);
  await openStack(page);

  const reroll = dialog(page).getByRole('button', { name: /Neu würfeln \(−10 🌰\)/ });
  await expect(reroll).toBeEnabled();
  await reroll.click();
  await expect(dialog(page).getByRole('button', { name: /Neu würfeln \(−20 🌰\)/ })).toBeDisabled();
  // Der Grund steht sichtbar im Dialog (nicht nur im title-Attribut).
  await expect(dialog(page).getByText('Neu würfeln: Nicht genug Samen')).toBeVisible();
  expect(await readNumber(seedsValue(page))).toBeLessThan(5);
  expect((await savedState(page)).pendingEncounters[0].rerolls).toBe(1);

  await settle(page);
  await dialog(page).getByRole('button', { name: /Ablehnen \(\+5 🌰\)/ }).click();
  // Die zweite Begegnung (Rotkehlchen) folgt direkt.
  await expect(card(page, 'robin')).toBeVisible();
  await expect(stack(page)).toHaveText(/1 Begegnung wartet/);
  expect(await readNumber(seedsValue(page))).toBeGreaterThanOrEqual(7);

  await settle(page);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(stack(page)).toBeVisible();
});

test('Doppelklick auf „Ablehnen“ lehnt bei gleich aussehenden Begegnungen nur eine ab', async ({
  page,
  context,
}) => {
  // Keimling: beide Begegnungen bieten nur den Regenwurm an – sie sehen identisch aus.
  await seedV2(context, {
    totalGrowth: waypoint(1) + 1,
    pendingEncounters: [
      { type: 'animal', cards: ['earthworm'], rerolls: 0 },
      { type: 'animal', cards: ['earthworm'], rerolls: 0 },
    ],
  });
  await openGame(page);
  await expect(stageLabel(page)).toHaveText('Stufe: Keimling');
  await openStack(page);
  await dialog(page).getByRole('button', { name: /Ablehnen/ }).dblclick();

  await expect(stack(page)).toHaveText(/1 Begegnung wartet/);
  await expect(dialog(page)).toBeVisible();
  await expect(card(page, 'earthworm')).toBeVisible();
  await page.waitForTimeout(500);
  expect((await savedState(page)).pendingEncounters).toHaveLength(1);
});

test('Volle Nische: Tier ersetzen', async ({ page, context }) => {
  await seedV2(context, {
    totalGrowth: waypoint(6) + 1,
    niches: { litter: ['woodlouse', 'centipede'] },
    pendingEncounters: [{ type: 'animal', cards: ['robin'], rerolls: 0 }],
  });
  await openGame(page);
  await openStack(page);
  const robin = card(page, 'robin');
  await expect(robin).toContainText('voll');
  await robin.getByRole('combobox').selectOption('centipede');
  await expect(robin).toContainText('ersetzt Steinläufer');
  await robin.getByRole('button', { name: 'Rotkehlchen wählen (ersetzt Steinläufer)' }).click();

  // Keine Begegnung mehr: Dialog und Stapel verschwinden.
  await expect(dialog(page)).toBeHidden();
  await expect(stack(page)).toBeHidden();
  await expect(niche(page, 'litter')).toContainText('Rotkehlchen');
  await expect(niche(page, 'litter')).toContainText('Rollassel');
  await expect(niche(page, 'litter')).not.toContainText('Steinläufer');
  // Der Stapel ist verschwunden: Der Fokus landet auf der Überschrift statt im Nichts.
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  expect((await savedState(page)).niches.litter).toEqual(['woodlouse', 'robin']);
});

test('„Spielstand löschen“ setzt nach Bestätigung zurück', async ({ page, context }) => {
  await seedV2(context, {
    totalGrowth: waypoint(6) + 1,
    seeds: 500,
    niches: { roots: ['earthworm'], crown: ['bluetit'] },
    pendingEncounters: [{ type: 'animal', cards: ['robin'], rerolls: 0 }],
  });
  await openGame(page);
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');
  await expect(stack(page)).toBeVisible();

  // Ein einzelner Klick fragt nur nach und lässt den Stand unverändert.
  await page.getByRole('button', { name: 'Spielstand löschen' }).click();
  await expect(page.getByRole('button', { name: /Wirklich alles löschen/ })).toBeVisible();
  await expect(stageLabel(page)).toHaveText('Stufe: Junger Baum');

  // Der zweite Klick bestätigt und setzt zurück.
  await page.getByRole('button', { name: /Wirklich alles löschen/ }).click();
  await expect(page.getByRole('button', { name: 'Spielstand löschen' })).toBeVisible();
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');
  expect(await readNumber(seedsValue(page))).toBeLessThan(5);
  await expect(niche(page, 'crown')).not.toContainText('Blaumeise');
  await expect(stack(page)).toBeHidden();

  // Auch nach dem Neuladen bleibt der Stand zurückgesetzt.
  await page.reload();
  await expect(stageLabel(page)).toHaveText(/Stufe: (Samen|Keimling)/);
  await expect(niche(page, 'crown')).not.toContainText('Blaumeise');
  expect(await readNumber(seedsValue(page))).toBeLessThan(5);
});

test('v1-Spielstand: Neustart mit Andenken-Meldung', async ({ page, context }) => {
  await seedRaw(
    context,
    {
      version: 1,
      resources: { water: 10, light: 10, energy: 9000 },
      upgrades: { 'root-hairs': 10, cotyledon: 10 },
      stage: 4,
      totalEnergy: 50_000,
    },
    -2 * 60 * 60 * 1000,
  );
  await openGame(page);
  const toast = page.locator('#toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Dein Wald beginnt neu – mit Erinnerungen.');
  await expect(stageLabel(page)).toHaveText(/Stufe: (Samen|Keimling)/);

  const saved = await savedState(page);
  expect(saved.version).toBe(2);
  expect(saved.meta.forestMemory).toBe(5);
  expect(saved).not.toHaveProperty('upgrades');

  // Beim nächsten Laden kommt die Meldung nicht noch einmal.
  await page.reload();
  await expect(stageLabel(page)).toContainText('Stufe:');
  await page.waitForTimeout(300);
  await expect(toast).toBeHidden();
});

test('Offline-Fortschritt: Willkommens-Meldung, Begegnungen warten im Stapel', async ({ page, context }) => {
  await seedV2(context, {
    totalGrowth: waypoint(3) + 1,
    niches: { roots: ['earthworm'] },
    lastTickOffsetMs: -60 * 60 * 1000,
  });
  await openGame(page);

  const toast = page.locator('#toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Willkommen zurück');
  await expect(toast).toContainText('1 Std.');
  await expect(toast).not.toContainText('max. 8 Std.');
  await expect(toast).toContainText('🌿');
  await expect(toast).toContainText(/Begegnung/);
  // In einer Stunde vergehen mehrere Wegpunkte – höchstens 3 Begegnungen warten.
  await expect(stack(page)).toHaveText(/3 Begegnungen warten/);
  await expect(dialog(page)).toBeHidden();
});

test('Offline länger als 8 Stunden: Meldung nennt die simulierte Dauer', async ({ page, context }) => {
  await seedV2(context, {
    totalGrowth: waypoint(3) + 1,
    niches: { roots: ['earthworm'] },
    lastTickOffsetMs: -30 * 60 * 60 * 1000,
  });
  await openGame(page);
  const toast = page.locator('#toast');
  await expect(toast).toContainText('In 8 Std. (max. 8 Std.)');
  // Mehr als 3 Wegpunkte: überzählige Begegnungen ziehen weiter und bringen Samen.
  await expect(toast).toContainText(/Begegnungen? zog(en)? weiter: \+\d+ 🌰/);
});

test('ohne Offline-Zeit erscheint keine Willkommens-Meldung', async ({ page, context }) => {
  await seedV2(context, { totalGrowth: waypoint(3) + 1 });
  await openGame(page);
  await page.waitForTimeout(300);
  await expect(page.locator('#toast')).toBeHidden();
});

test.describe('Mobil (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  async function expectNoHorizontalScroll(page: Page): Promise<void> {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  }

  test('kein horizontales Scrollen beim Start', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('canvas#scene')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('kein horizontales Scrollen mit vollen Nischen, 3 Begegnungen, offenem Dialog und großen Zahlen', async ({
    page,
    context,
  }) => {
    await seedV2(context, {
      totalGrowth: waypoint(20) + 1,
      seeds: 9.87e8,
      forestMemory: 500,
      niches: {
        roots: ['earthworm'],
        litter: ['robin', 'woodlouse', 'centipede'],
        edge: ['bee'],
        crown: ['bluetit', 'oakmoth'],
        bark: ['barkbeetle', 'woodpecker'],
      },
      pendingEncounters: [
        { type: 'animal', cards: ['robin', 'bee', 'woodpecker'], rerolls: 5 },
        { type: 'animal', cards: ['centipede', 'oakmoth', 'earthworm'], rerolls: 0 },
        { type: 'animal', cards: ['bluetit', 'barkbeetle', 'woodlouse'], rerolls: 0 },
      ],
    });
    await openGame(page);
    await expect(stageLabel(page)).toHaveText('Stufe: Hain');
    await expect(stack(page)).toHaveText(/3 Begegnungen warten/);
    await expect(stack(page)).toBeInViewport();
    await expectNoHorizontalScroll(page);

    await stack(page).tap();
    await expect(dialog(page)).toBeVisible();
    await expect(card(page, 'robin')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
