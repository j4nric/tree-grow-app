import { NICHES } from '../src/content/niches';
import { PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { createInitialState, type GameState } from '../src/core/state';
import { encounter, expect, openGame, openStack, pageTitle, savedState, seedRaw, seedV3, sowButton, sowNow, stack, test, waypoint } from './fixtures';

/**
 * Zettelstapel und U:Begegnung (docs/ALBUM_UI.md, C.7 und A.6): Text und Schatten des
 * Stapels, Wackeln bei neuen Zetteln, „‹ Später“, nächste Begegnung ohne neues Umblättern,
 * leerer Stapel blättert von selbst zurück; „🌱 Säen“ öffnet die Aussaat in U:Begegnung.
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
  // Wegpunkt 2: die geschenkte Aussaat als zweiter Zettel (27.5) – der Stapel wackelt (Klasse
  // bis zum Ende der Animation).
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
  const saved = await savedState(page);
  expect(saved.pendingEncounters).toHaveLength(1);
  expect(saved.cycle.sowing).not.toBeNull();
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

test('„🌱 Säen“: erste Aussaat gratis, Kartenwahl in U:Begegnung, danach Preis mit Saatzeit', async ({ page, context }) => {
  // Setzling (2 Pflanzplätze), Frühling: Die erste Aussaat ist gratis, die zweite kostet ⌈20 · 0,8⌉.
  await seedV3(context, { totalGrowth: waypoint(3) + 1, seeds: 30 });
  await openGame(page);
  await expect(sowButton(page)).toContainText('🌱 Säen');
  await expect(sowButton(page)).toContainText('gratis');
  // Der Knopf blättert um, er öffnet kein Popup.
  await expect(sowButton(page)).not.toHaveAttribute('aria-haspopup');
  const sheet = await sowNow(page);
  await expect(sheet).toContainText('Aussaat – drei Samen, ein Platz');
  await expect(sheet.locator('[data-ref="encounter-decline"]')).toContainText('Zurücklegen');
  await expect(sheet.locator('[data-ref="encounter-reroll"]')).toBeVisible();
  // Der Stapel liegt solange verborgen; die Aussaat steht im Spielstand (Neuladen würfelt nicht neu).
  const cards = (await savedState(page)).cycle.sowing.cards as string[];
  expect(cards).toHaveLength(3);
  await sheet.getByRole('button', { name: /einkleben/ }).first().click();
  await expect(encounter(page)).toBeHidden();
  const saved = await savedState(page);
  expect(saved.cycle.sowing).toBeNull();
  expect(saved.cycle.sowings).toBe(1);
  expect(saved.plants).toEqual([cards[0]]);
  await expect(sowButton(page)).toContainText('16 🌰');
  await expect(sowButton(page)).toContainText('Saatzeit');
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`Setzen aus der Aussaat spielt die Aussaat-Animation ohne Fehler (Phase 10, 4d; Bewegung: ${reducedMotion})`, async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion });
    await seedV3(context, { totalGrowth: waypoint(6) + 1, seeds: 30, plants: ['fern'] });
    await openGame(page);
    const sheet = await sowNow(page);
    const cards = (await savedState(page)).cycle.sowing.cards as string[];
    await sheet.getByRole('button', { name: /einkleben/ }).first().click();
    await expect(encounter(page)).toBeHidden();
    // Flug (~2,7 s) abwarten: die Szene läuft weiter, die Pflanze steht im Spielstand.
    await page.waitForTimeout(3000);
    expect((await savedState(page)).plants).toEqual(['fern', cards[0]]);
    await expect(page.locator('canvas').first()).toBeVisible();
  });
}

test('offene Aussaat: Zettel „Aussaat!“ oben auf dem Stapel, „‹ Später“ legt sie zurück, Neuladen behält die Karten', async ({ page, context }) => {
  // Eine „Etwas keimt“-Begegnung aus einem alten Stand wird beim Laden die offene Aussaat (27.9).
  await seedV3(context, {
    totalGrowth: waypoint(3) + 1,
    seeds: 30,
    pendingEncounters: [
      { type: 'animal', cards: ['bluetit'], rerolls: 0 },
      { type: 'plant', cards: ['hazel', 'fern', 'nettle'], rerolls: 0 },
    ],
  });
  await openGame(page);
  await expect(stack(page)).toHaveText('🌱2 Zettel: Aussaat!');
  await expect(sowButton(page)).toContainText('Aussaat offen');
  await openStack(page);
  await expect(encounter(page)).toContainText('Aussaat – drei Samen, ein Platz');
  await expect(encounter(page)).toContainText('Hasel');
  await page.keyboard.press('Escape');
  await expect(encounter(page)).toBeHidden();
  await page.reload();
  await expect(stack(page)).toHaveText('🌱2 Zettel: Aussaat!');
  // Zurücklegen: Samen gutgeschrieben, danach liegt die Tierbegegnung oben.
  await openStack(page);
  await encounter(page).locator('[data-ref="encounter-decline"]').click();
  await expect(encounter(page)).toContainText('Blaumeise');
  const saved = await savedState(page);
  expect(saved.cycle.sowing).toBeNull();
  expect(saved.seeds).toBeGreaterThan(30);
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
