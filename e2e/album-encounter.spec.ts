import { encounter, expect, openGame, openPlantPicker, openStack, pageTitle, savedState, seedV3, stack, test, waypoint } from './fixtures';

/**
 * Zettelstapel und U:Begegnung (docs/ALBUM_UI.md, C.7 und A.6): Text und Schatten des
 * Stapels, Wackeln bei neuen Zetteln, „‹ Später“, nächste Begegnung ohne neues Umblättern,
 * leerer Stapel blättert von selbst zurück; U:Pflanze setzen als Unterseite der Nischen.
 */

test('Zettelstapel: „2 Zettel: Besuch wartet!“, Ereignis mit Namen, Symbol als Sticker', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1,
    seeds: 100,
    niches: { roots: ['earthworm'] },
    pendingEncounters: [
      { type: 'animal', cards: ['bluetit'], rerolls: 0 },
      { type: 'event', cards: ['storm'], rerolls: 0 },
    ],
  });
  await openGame(page);
  await expect(stack(page)).toHaveText('🐾2 Zettel: Besuch wartet!');
  await expect(stack(page)).toHaveAttribute('data-count', '2');
  await expect(stack(page)).toHaveAccessibleName('2 Begegnungen warten – ansehen');

  // Tier einkleben: Der Stapel zeigt jetzt das Ereignis.
  await openStack(page);
  await encounter(page).getByRole('button', { name: 'Blaumeise einkleben' }).click();
  await expect(encounter(page)).toContainText('Sturmnacht');
  await expect(stack(page)).toHaveText('🌩️1 Zettel: Sturmnacht!');
  await expect(stack(page)).toHaveAttribute('data-count', '1');
});

test('Neuer Zettel wackelt einmal; U:Begegnung: „‹ Später“, Escape und Zurückblättern', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Uhr anhalten: Der nächste Wegpunkt kommt erst, wenn der Test die Zeit vorstellt.
  await page.clock.install({ time: new Date('2026-10-22T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-22T08:00:01Z'));
  await seedV3(context, {
    totalGrowth: waypoint(2) - 1,
    niches: { roots: ['earthworm'] },
    pendingEncounters: [{ type: 'animal', cards: ['earthworm'], rerolls: 0 }],
  });
  await openGame(page);
  await page.clock.runFor(100);
  await expect(stack(page)).toHaveAttribute('data-count', '1');
  await expect(stack(page)).not.toHaveClass(/note-stack-wobble/);
  // Wegpunkt 2: ein zweiter Zettel – der Stapel wackelt (Klasse bis zum Ende der Animation).
  await page.clock.fastForward(10_000);
  await page.clock.runFor(50);
  await expect(stack(page)).toHaveAttribute('data-count', '2');
  await expect(stack(page)).toHaveClass(/note-stack-wobble/);
  await expect(stack(page)).toHaveAttribute('aria-label', /2 Begegnungen warten/);
  await page.clock.resume();

  await openStack(page);
  // Mobil liegt die Unterseite über allem – der Stapel ist dort verborgen.
  await expect(stack(page)).toBeHidden();
  const later = encounter(page).locator('[data-ref="bookmark"]');
  await expect(later).toHaveText('‹ Später');
  await later.click();
  await expect(encounter(page)).toBeHidden();
  await expect(stack(page)).toBeVisible();
  await expect(stack(page)).toBeFocused();

  await openStack(page);
  await page.keyboard.press('Escape');
  await expect(encounter(page)).toBeHidden();
  expect((await savedState(page)).pendingEncounters).toHaveLength(2);
});

test('Nächste Begegnung ohne neues Umblättern, leerer Stapel blättert zurück', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(6) + 1,
    seeds: 50,
    pendingEncounters: [
      { type: 'animal', cards: ['bluetit'], rerolls: 0 },
      { type: 'animal', cards: ['robin'], rerolls: 0 },
    ],
  });
  await openGame(page);
  await openStack(page);
  await expect(encounter(page).locator('[data-ref="encounter-queue"]')).toHaveText('noch 1 weitere Begegnung wartet');
  await encounter(page).getByRole('button', { name: 'Blaumeise einkleben' }).click();
  // Gleiche Seite, neuer Inhalt; der Fokus springt auf die neue Karte.
  const robin = encounter(page).getByRole('button', { name: 'Rotkehlchen einkleben' });
  await expect(robin).toBeFocused();
  await expect(encounter(page)).not.toHaveAttribute('inert', '');
  await expect(encounter(page).locator('[data-ref="encounter-queue"]')).toBeHidden();
  await page.waitForTimeout(400);
  await robin.click();
  await expect(encounter(page)).toBeHidden();
  await expect(stack(page)).toBeHidden();
  await expect(pageTitle(page)).toBeFocused();
});

test('U:Pflanze setzen: Lesezeichen „‹ Nischen“, Samen-Zeile, Escape blättert zurück', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(3) + 1, seeds: 30 });
  await openGame(page);
  // Der Knopf blättert um, er öffnet kein Popup (früher Dialog: aria-haspopup="dialog").
  await expect(page.locator('[data-ref="plant-open"]')).not.toHaveAttribute('aria-haspopup');
  const picker = await openPlantPicker(page);
  await expect(picker.locator('[data-ref="bookmark"]')).toHaveText('‹ Nischen');
  await expect(picker.locator('[data-ref="picker-seeds"]')).toHaveText('Du hast 30 🌰');
  // Fokus auf der ersten setzbaren Pflanze.
  await expect(picker.locator('.picker-choose:not([disabled])').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(page.locator('[data-ref="plant-open"]')).toBeFocused();
});
