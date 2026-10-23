import { NICHES } from '../src/content/niches';
import { PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { encounter, expect, openGame, openPlantPicker, openStack, pageTitle, savedState, seedRaw, seedV3, stack, test, waypoint } from './fixtures';

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
  // Uhr anhalten: Sonst sammelt der Baum in Echtzeit weiter Samen, und unter Last stand in der
  // Samen-Zeile schon „31“ oder „32“ statt „30“. Das Umblättern läuft auch mit angehaltener Uhr.
  await page.clock.install({ time: new Date('2026-10-22T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-22T08:00:01Z'));
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

/**
 * Spätspiel (Playtest Schritt 14, S1): Urwald, alle Nischen voll, drei Tiere zur Wahl – lange
 * Karten mit Tausch-Auswahl. „Einkleben“ liegt ohne Scrollen im Bild (Karten in einer Reihe,
 * Knopf vor den Einzelheiten); die dritte Karte bricht nicht in eine zweite Reihe um.
 */
function lateEncounterState(): GameState {
  const ancient = STAGES.findIndex((s) => s.id === 'ancient-forest');
  const state = createInitialState(Date.now(), 777);
  state.stage = ancient;
  state.waypoint = STAGES[ancient]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) * 1.4;
  state.seeds = 1_234_567;
  const living = new Set<string>();
  for (const n of NICHES) {
    const cap = n.slots[ancient] ?? 0;
    if (cap === 0) continue;
    const ids = SPECIES.filter((sp) => sp.niche === n.id && sp.unlock <= ancient).slice(0, cap).map((sp) => sp.id);
    (state.niches as Record<string, string[]>)[n.id] = ids;
    for (const id of ids) living.add(id);
  }
  state.plants = PLANTS.slice(0, 10).map((p) => p.id);
  const cards = SPECIES.filter((sp) => sp.unlock <= ancient && !living.has(sp.id) && (state.niches as Record<string, string[]>)[sp.niche]?.length)
    .slice(0, 3)
    .map((sp) => sp.id);
  state.pendingEncounters = [
    { type: 'animal', cards, rerolls: 0 },
    { type: 'event', cards: ['storm'], rerolls: 0 },
  ];
  return state;
}

for (const { width, height } of [
  { width: 1200, height: 700 },
  { width: 1280, height: 800 },
  { width: 360, height: 740 },
]) {
  test(`Spätspiel ${width} × ${height}: „Einkleben“ ohne Scrollen, Karten in einer Reihe, „Wer zieht weiter?“`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    await seedRaw(context, lateEncounterState(), 0);
    await openGame(page);
    await openStack(page);
    const cards = encounter(page).locator('.encounter-card');
    await expect(cards).toHaveCount(3);
    // Volle Nische: kompakte Frage statt „Wen entlassen?“.
    await expect(cards.first().locator('.card-replace-label')).toContainText('voll. Wer zieht weiter?');
    await expect(encounter(page)).not.toContainText('Wen entlassen');
    const boxes = await cards.evaluateAll((nodes) =>
      nodes.map((n) => {
        const card = n.getBoundingClientRect();
        const button = n.querySelector('.card-choose')!.getBoundingClientRect();
        return { top: Math.round(card.top), buttonBottom: button.bottom };
      }),
    );
    // Eine Reihe: alle Karten beginnen auf gleicher Höhe (± Neigung).
    for (const b of boxes) expect(Math.abs(b.top - boxes[0]!.top)).toBeLessThanOrEqual(12);
    // Mindestens die erste Karte ganz im Bild – mit ihrem Knopf über dem unteren Rand der Seite.
    const first = cards.first().getByRole('button', { name: /einkleben/ });
    await expect(first).toBeInViewport({ ratio: 1 });
    const pageBottom = await encounter(page).evaluate((p) => Math.min(innerHeight, p.closest('.spread-sub, .album-subpage')!.getBoundingClientRect().bottom));
    for (const b of boxes) expect(b.buttonBottom).toBeLessThanOrEqual(pageBottom);
    // Ohne Scrollen wählbar: einkleben, die nächste Begegnung (Ereignis) erscheint.
    await first.click();
    await expect(encounter(page)).toContainText('Sturmnacht');
  });
}
