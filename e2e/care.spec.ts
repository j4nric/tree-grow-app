import type { Page } from '@playwright/test';
import { expect, gotoTab, niche, openGame, openTab, savedState, seedV3, test, waypoint } from './fixtures';

/**
 * Forschung (seit Spielstand v17, DESIGN_V2.md 27.7) im Reiter „Pflege“ des Albums – bis zum
 * Baum aus Phase 10, 4a eine flache Notliste: einen Knoten mit ⚖️ aus dem Vorrat erforschen,
 * die Wirkung sehen (ein Platz mehr in der Laubstreu), Neuladen behält ihn. Die Unterseite
 * prüft e2e/album-care.spec.ts.
 */
test('Erforschen: ⚖️ weg, ein Platz mehr, Knoten erledigt – auch nach dem Neuladen', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(6) + 1, // Junger Baum: Laubstreu hat 2 Plätze
    harmonyPoints: 400,
    niches: { roots: ['earthworm'], litter: ['robin'] },
  });
  // Die Nischen-Seite schreibt nur, solange sie sichtbar ist (docs/ALBUM_UI.md, D.1).
  await gotoTab(page, 'nischen');
  await expect(niche(page, 'litter')).toContainText('1/2 belegt');
  await openTab(page, 'pflege');
  // Der Vorrat wächst ab dem Laden weiter (+48/min), darum nur die Größenordnung.
  await expect(page.locator('[data-ref="care-summary"]')).toContainText(/⚖️ 4\d\d\b/);
  const care = page.locator('[data-ref="care"]');
  const litter = care.locator('[data-care="leaf-litter"]');
  await expect(litter).toContainText('Laub liegen lassen');
  await expect(litter).toContainText('🪱 Boden');
  await expect(litter).toContainText('+1 Platz Laubstreu');
  // Knoten ab Alter Baum (z. B. Lichte Krone) stehen noch nicht in der Liste.
  await expect(care.locator('[data-care="light-crown"]')).toHaveCount(0);

  await litter.getByRole('button', { name: 'Erforschen (80 ⚖️)' }).click();

  await expect(litter).toContainText('erforscht');
  await expect(litter.locator('[data-buy-care="leaf-litter"]')).toBeHidden();
  const saved = await savedState(page);
  expect(saved.cycle.research).toEqual(['leaf-litter']);
  expect(saved.harmonyPoints).toBeLessThan(400 - 80 + 20);
  expect(saved.version).toBe(17);

  await openTab(page, 'nischen');
  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  await page.reload();
  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  await openTab(page, 'pflege');
  await expect(care.locator('[data-care="leaf-litter"]')).toContainText('erforscht');
  expect((await savedState(page)).cycle.research).toEqual(['leaf-litter']);
});

test('Gesperrter Knoten (Voraussetzung fehlt): aria-disabled mit Grund, Klick erforscht nichts', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1, // Alter Baum: Waldtümpel steht in der Liste, braucht Kompost
    harmonyPoints: 5000,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const pond = care.locator('[data-care="pond"]');
  await expect(pond.locator('[data-ref="care-blocker"]')).toHaveText('Braucht „Kompost“');
  // Gesperrt per aria-disabled (nicht `disabled`): bleibt fokussierbar, Grund wird vorgelesen.
  const locked = pond.getByRole('button', { name: /Erforschen/ });
  await expect(locked).toHaveAttribute('aria-disabled', 'true');
  await expect(locked).toHaveAccessibleName(/gesperrt: Braucht „Kompost“/);
  await locked.click({ force: true });
  await page.waitForTimeout(450);
  expect((await savedState(page)).cycle.research ?? []).toEqual([]);
  // Mit Kompost geht es.
  await care.locator('[data-buy-care="compost"]').click();
  await expect(pond.locator('[data-ref="care-blocker"]')).toBeHidden();
  await expect(locked).not.toHaveAttribute('aria-disabled', 'true');
  await page.waitForTimeout(450);
  await locked.click();
  await expect(pond).toContainText('erforscht');
  await expect.poll(async () => (await savedState(page)).cycle.research).toEqual(['compost', 'pond']);
});

test('Forschung per Tastatur: nach dem Erforschen Fokus auf dem Titel', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain
    harmonyPoints: 100_000,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'pflege');
  const litter = page.locator('[data-ref="care"] [data-care="leaf-litter"]');
  const buy = litter.locator('[data-buy-care="leaf-litter"]');
  await expect(buy).toHaveText('Erforschen (80 ⚖️)');
  await buy.focus();
  await page.keyboard.press('Enter');
  await expect(litter).toContainText('erforscht');
  await expect(buy).toBeHidden();
  await expect(litter.locator('[data-care-title="leaf-litter"]')).toBeFocused();
  expect((await savedState(page)).cycle.research).toEqual(['leaf-litter']);
});

test('Forschung: Doppelklick und gehaltene Enter-Taste erforschen nur einmal', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1,
    harmonyPoints: 100_000,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const litter = care.locator('[data-care="leaf-litter"]');
  const harmonyBefore = (await savedState(page)).harmonyPoints as number;
  await litter.locator('[data-buy-care="leaf-litter"]').dblclick();
  await expect(litter).toContainText('erforscht');
  await page.waitForTimeout(450);
  const saved = await savedState(page);
  expect(saved.cycle.research).toEqual(['leaf-litter']);
  // Genau einmal bezahlt (dazu kommt nur der Zufluss der wenigen Sekunden).
  expect(saved.harmonyPoints).toBeGreaterThan(harmonyBefore - 160);

  // Gehaltene Enter-Taste: Playwright meldet weitere keydown mit `repeat`.
  const compost = care.locator('[data-care="compost"]');
  await compost.locator('[data-buy-care="compost"]').focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(compost).toContainText('erforscht');
  await page.waitForTimeout(450);
  expect((await savedState(page)).cycle.research).toEqual(['leaf-litter', 'compost']);
});

/** data-care-IDs der Liste in Anzeige-Reihenfolge. */
const careIds = (page: Page) =>
  page.locator('[data-ref="care"] [data-care]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.care!));

test('Forschung: erforschbar zuerst, Reihenfolge bleibt beim Kauf stehen, Bestätigung schwebt', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain
    harmonyPoints: 2600,
    research: ['wildflower-hem'],
    niches: { roots: ['earthworm'], edge: ['bee'] },
  });
  await gotoTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const groups = await care.locator('[data-care]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.group!));
  const rank: Record<string, number> = { buyable: 0, saving: 1, locked: 2, maxed: 3 };
  const ranks = groups.map((g) => rank[g]!);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  expect(groups[0]).toBe('buyable');
  await expect(page.locator('[data-ref="care-summary"]')).toHaveText(/\d+ erforschbar/);
  await expect(care.locator('[data-care="insect-hotel"] [data-ref="care-preview"]')).toContainText('+3 ⚖️');

  const order = await careIds(page);
  const boxes = care.locator('[data-buy-care="nest-boxes"]');
  await boxes.focus();
  await page.keyboard.press('Enter');
  await expect(care.locator('[data-care="nest-boxes"]')).toContainText('erforscht');
  // Bestätigung: schwebender Hinweis und Statuszeile für Screenreader.
  await expect(page.locator('.float-layer')).toContainText('Nistkästen angebracht');
  await expect(care.getByRole('status')).toHaveText('Nistkästen angebracht');
  // Fokus in der Liste: nichts springt.
  expect(await careIds(page)).toEqual(order);

  // Fokus verlässt die Liste → neu sortiert (Nistkästen ist erforscht und rutscht nach hinten).
  await page.locator('[data-ref="tab-care"]').focus();
  await expect.poll(async () => (await careIds(page)).indexOf('nest-boxes')).toBeGreaterThan(order.indexOf('nest-boxes'));
});

test('Forschung auf dem Handy: Vorrat und Kennzahl im Kopf, Punkt am Reiter, große Knöpfe, ohne Querscrollen', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedV3(context, { totalGrowth: waypoint(6) + 1, harmonyPoints: 1200, niches: { roots: ['earthworm'] } });
  await openGame(page);
  // Punkt am Reiter schon, bevor die Seite offen ist (G-13).
  const dot = page.locator('[data-ref="tab-care"] .tab-dot');
  await expect(dot).toBeVisible();
  await openTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const buy = care.locator('[data-buy-care="leaf-litter"]');
  // Junger Baum: Kompost 100, Laub 80, Saatgut sortieren 200, Nistkästen 250, Wildblumen-Saum 300, Waldwiese 600 ⚖️.
  const summary = page.locator('[data-ref="care-summary"]');
  await expect(summary).toContainText('6 erforschbar');
  await expect(summary).toContainText(/⚖️ 1\.?2\d\d · \+\d+\/min/);
  await expect(buy).toBeVisible();
  expect((await buy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await care.locator('[data-care-title="leaf-litter"]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // Drei Knoten (zusammen 1.150 ⚖️), danach reicht es für nichts mehr: Punkt weg.
  for (const id of ['meadow', 'wildflower-hem', 'nest-boxes']) {
    await care.locator(`[data-buy-care="${id}"]`).click();
    await expect(care.locator(`[data-care="${id}"]`)).toContainText('erforscht');
  }
  await expect(summary).not.toContainText('erforschbar');
  await expect(dot).toBeHidden();
});

test('Mobil: „Zur Pflege“ beim verschlossenen Waldtümpel öffnet die Forschung beim Knoten', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1, // Alter Baum: Forschung „Waldtümpel“ steht in der Liste
    harmonyPoints: 10_000,
    research: ['compost'],
    niches: { roots: ['earthworm'] },
  });
  await openGame(page);
  const pond = niche(page, 'pond');
  await expect(pond).toContainText('öffnet durch Forschung „Waldtümpel“');
  // Der Knopf am Hinweis führt hin (Playtest Amphibien): Reiter „Pflege“, Zeile im Bild.
  await pond.getByRole('button', { name: 'Zur Pflege: Waldtümpel öffnen' }).click();
  await expect(page.locator('[data-ref="tab-care"]')).toHaveAttribute('aria-selected', 'true');
  const item = page.locator('[data-ref="care"] [data-care="pond"]');
  await expect(item.locator('[data-care-title="pond"]')).toBeFocused();
  await expect(item).toBeInViewport();
  await item.locator('[data-buy-care="pond"]').click();
  // Unsichtbare Reiter holen ihre Anzeige beim Zeigen nach (docs/ALBUM_UI.md, D.1).
  await openTab(page, 'nischen');
  await expect(pond).toContainText('0/2 belegt');
  await expect(pond.locator('[data-ref="niche-care-link"]')).toBeHidden();
});

test('Forschung: nach einem Mausklick wird neu sortiert, sobald die Maus die Liste verlässt', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain
    harmonyPoints: 2600,
    niches: { roots: ['earthworm'], edge: ['bee'] },
  });
  await gotoTab(page, 'pflege');
  const care = page.locator('[data-ref="care"]');
  const order = await careIds(page);
  const boxes = care.locator('[data-buy-care="nest-boxes"]');
  await boxes.click();
  await expect(care.locator('[data-care="nest-boxes"]')).toContainText('erforscht');
  const note = page.locator('.float-layer .float-note').filter({ hasText: 'Nistkästen angebracht' });
  const noteBox = (await note.boundingBox())!;
  const nameBox = (await care.locator('[data-care="nest-boxes"] .care-name').boundingBox())!;
  expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(nameBox.y + 2);
  // Direkt nach dem Kauf (Maus noch in der Liste, Haltezeit): nichts springt.
  expect(await careIds(page)).toEqual(order);
  // Maus raus – der per Klick fokussierte Knopf hält die Liste nicht fest; nach der
  // Haltezeit rutscht „Nistkästen“ (jetzt erforscht) nach hinten.
  await page.mouse.move(5, 5);
  await expect.poll(async () => (await careIds(page)).indexOf('nest-boxes')).toBeGreaterThan(order.indexOf('nest-boxes'));
});
