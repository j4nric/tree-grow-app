import type { Page } from '@playwright/test';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { SPECIES_BY_ID } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { CONFIRM_MIN_MS } from '../src/ui/confirm';
import {
  dialog,
  expect,
  niche,
  openGame,
  savedState,
  seedNewGame,
  stack,
  stageLabel,
  test,
} from './fixtures';

/**
 * Voller Zyklus mit festem Seed (Roadmap 2.9).
 *
 * Neues Spiel (v5, fester Zufalls-Seed, Waldgedächtnis knapp unter einem Stammgast-Platz), Testuhr angehalten: Zeit vergeht nur über
 * `page.clock` (Sprünge < 60 s, damit keine Willkommens-Meldung kommt). Strategie, bewusst
 * einfach und deterministisch: bei jeder Begegnung die erste wählbare Karte (mit der
 * vorausgewählten Ersetzung), sonst ablehnen; eine Pflanze setzen, sobald die Samen reichen
 * (die erste setzbare). So geht es bis zum Hain, dann in den Neuen Zyklus, ein Stammgast
 * wird gewählt und zieht ein. Am Ende Neuladen.
 *
 * Mit `--repeat-each=2` müssen beide Läufe dieselbe Spur haben (Annotation „spur“).
 */

const START = new Date('2026-10-21T08:00:00Z');
const RNG_SEED = 20261022;
/**
 * Start-Waldgedächtnis knapp unter einem Stammgast-Platz (25): Jeder Zyklus bringt
 * mindestens einen Punkt, also gibt es danach sicher einen Platz – unabhängig davon, wie
 * der Seed verläuft (robust gegen neue Inhalte, die den Zufall verschieben).
 */
const START_MEMORY = 24;
const HAIN = STAGES[NEW_CYCLE_MIN_STAGE]!.name;

async function stageIndex(page: Page): Promise<number> {
  const text = ((await stageLabel(page).textContent()) ?? '').replace('Stufe: ', '').trim();
  return STAGES.findIndex((s) => s.name === text);
}

const cyclePanel = (page: Page) => page.locator('[data-ref="cycle-panel"]');
const plantOpen = (page: Page) => page.locator('[data-ref="plant-open"]');
const picker = (page: Page) => page.locator('[data-ref="plant-picker"]');

/** Zeit vergehen lassen und ein paar Frames laufen lassen (Ansichten aktualisieren). */
async function advance(page: Page, ms: number): Promise<void> {
  await page.clock.fastForward(ms);
  await page.clock.runFor(50);
}

/** Oberste Begegnung: erste wählbare Karte, sonst ablehnen. Gibt die Wahl zurück (null = abgelehnt). */
async function chooseFirst(page: Page): Promise<string | null> {
  await page.clock.fastForward(400); // Eingabesperre nach neuen Karten (läuft auf der Testuhr)
  const cards = dialog(page).locator('.encounter-card');
  await expect(cards.first()).toBeVisible();
  // Ereignis oder Gast (seit Schritt 2.4): erste Option bzw. bewirten, wenn die Samen
  // reichen, sonst „Ziehen lassen“ (geht immer).
  const option = await cards.first().getAttribute('data-option');
  if (option !== null) {
    const first = cards.first().locator('.card-choose');
    const host = option === 'host' && !(await first.isDisabled());
    await (option === 'host' && !host ? cards.last() : cards.first()).locator('.card-choose').click();
    await page.clock.runFor(50);
    return option === 'host' ? (host ? 'host' : 'farewell') : option;
  }
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const choose = cards.nth(i).getByRole('button', { name: /wählen/ });
    if (await choose.isDisabled()) continue;
    const id = (await cards.nth(i).getAttribute('data-card')) ?? '';
    await choose.click();
    await page.clock.runFor(50);
    return id;
  }
  await dialog(page).getByRole('button', { name: /Ablehnen/ }).click();
  await page.clock.runFor(50);
  return null;
}

/** Erste setzbare Pflanze setzen, wenn die Samen reichen. Gibt die Pflanze zurück. */
async function plantIfAffordable(page: Page): Promise<string | null> {
  const button = plantOpen(page);
  if (!(await button.isVisible())) return null;
  if (/noch nicht genug/.test((await button.getAttribute('aria-label')) ?? '')) return null;
  await button.click();
  await expect(picker(page)).toBeVisible();
  await page.clock.fastForward(400); // Eingabesperre nach dem Öffnen
  const rows = picker(page).locator('[data-plant]');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const choose = rows.nth(i).getByRole('button', { name: /setzen für/ });
    if ((await choose.count()) === 0 || (await choose.isDisabled())) continue;
    const id = (await rows.nth(i).getAttribute('data-plant')) ?? '';
    await choose.click();
    await expect(picker(page)).toBeHidden();
    await page.clock.runFor(50);
    return id;
  }
  await picker(page).getByRole('button', { name: 'Schließen' }).click();
  await expect(picker(page)).toBeHidden();
  return null;
}

test('voller Zyklus mit festem Seed: bis zum Hain, Neuer Zyklus, Stammgast zieht ein, Neuladen', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const startedAt = Date.now();
  // Uhr anhalten: Zeit vergeht nur über fastForward/runFor → jeder Lauf ist gleich.
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await seedNewGame(context, RNG_SEED, START, START_MEMORY);
  await openGame(page);
  await expect(stageLabel(page)).toHaveText(`Stufe: ${STAGES[0]!.name}`);
  const fresh = await savedState(page);
  expect(fresh.version).toBe(5);
  expect(fresh.cycle.number).toBe(1);

  const blocker = cyclePanel(page).locator('[data-ref="cycle-blocker"]');
  const newCycleButton = cyclePanel(page).locator('[data-ref="new-cycle"]');
  /** Spur für den Vergleich zweier Läufe: Spielsekunde je Wegpunkt, Wahlen, Pflanzen. */
  const trail: string[] = [];

  // --- Zyklus 1: bis zum Hain ---------------------------------------------------------
  let gameSeconds = 0;
  let lastStage = 0;
  let lastWaypoint = 0;
  let encounters = 0;
  let planted = 0;
  for (;;) {
    const step = gameSeconds < 60 ? 5_000 : 55_000;
    await advance(page, step);
    gameSeconds += step / 1000;
    expect(gameSeconds, `${HAIN} sollte in unter 120 Spielminuten erreicht sein`).toBeLessThan(120 * 60);

    const stage = await stageIndex(page);
    expect(stage, 'unbekannte Stufe').toBeGreaterThanOrEqual(0);
    expect(stage, 'Stufen gehen nie zurück').toBeGreaterThanOrEqual(lastStage);
    lastStage = stage;
    const { waypoint } = await savedState(page);
    expect(waypoint, 'Wegpunkte gehen nie zurück').toBeGreaterThanOrEqual(lastWaypoint);
    if (waypoint > lastWaypoint) trail.push(`t${gameSeconds}:wp${waypoint}`);
    lastWaypoint = waypoint;

    if (stage >= NEW_CYCLE_MIN_STAGE) break;
    // Vor dem Hain: Grund statt Knopf.
    await expect(blocker).toContainText(`„${HAIN}“`);
    await expect(newCycleButton).toBeHidden();

    if (await stack(page).isVisible()) {
      await stack(page).click();
      await expect(dialog(page)).toBeVisible();
      while (await dialog(page).isVisible()) {
        const chosen = await chooseFirst(page);
        trail.push(chosen ?? '-');
        encounters++;
      }
      await expect(stack(page)).toBeHidden();
    }
    const plant = await plantIfAffordable(page);
    if (plant) {
      trail.push(`+${plant}`);
      planted++;
    }
  }

  await expect(stageLabel(page)).toHaveText(`Stufe: ${HAIN}`);
  const atGrove = await savedState(page);
  expect(atGrove.version).toBe(5);
  expect(atGrove.cycle.number).toBe(1);
  expect(atGrove.waypoint).toBeGreaterThanOrEqual(STAGES[NEW_CYCLE_MIN_STAGE]!.waypoint);
  expect(encounters, 'unterwegs gab es Begegnungen').toBeGreaterThanOrEqual(10);
  expect(planted, 'unterwegs wurden Pflanzen gesetzt').toBeGreaterThanOrEqual(1);
  const journal = atGrove.meta.journal.species as string[];
  expect(journal.length, 'Arten im Tagebuch').toBeGreaterThanOrEqual(5);
  trail.push(`hain@${gameSeconds}`);

  // --- Neuer Zyklus: zwei Klicks --------------------------------------------------------
  await expect(blocker).toBeHidden();
  const gainText = (await cyclePanel(page).locator('[data-ref="cycle-gain"]').textContent()) ?? '';
  const gain = Number(/^\+(\d+) Waldgedächtnis/.exec(gainText)?.[1]);
  expect(gain, `Vorschau „${gainText}“`).toBeGreaterThan(0);
  trail.push(`gain${gain}`);

  await newCycleButton.click();
  await expect(newCycleButton).toContainText('Zum Bestätigen erneut klicken');
  // Der zweite Klick zählt erst nach der Schutzzeit gegen Doppelklicks (ui/confirm.ts).
  await page.clock.fastForward(CONFIRM_MIN_MS + 50);
  await newCycleButton.click();
  await page.clock.runFor(50);

  await expect(page.locator('#toast')).toContainText('Zyklus 2 beginnt');
  await expect(cyclePanel(page).locator('[data-ref="cycle-title"]')).toBeFocused();
  await expect(stageLabel(page)).toHaveText(`Stufe: ${STAGES[0]!.name}`);
  await expect(cyclePanel(page).locator('[data-ref="forest-memory"]')).toContainText(`Waldgedächtnis ${START_MEMORY + gain} ·`);
  const cycle2 = await savedState(page);
  expect(cycle2.version).toBe(5);
  expect(cycle2.cycle.number).toBe(2);
  expect(cycle2.stage).toBe(0);
  expect(cycle2.waypoint).toBe(0);
  expect(cycle2.meta.forestMemory, 'Waldgedächtnis = Start + Vorschau').toBe(START_MEMORY + gain);
  expect(cycle2.meta.journal.species, 'Tagebuch bleibt').toEqual(journal);
  expect(cycle2.plants).toEqual([]);
  expect(Object.values(cycle2.niches as Record<string, string[]>).flat()).toEqual([]);
  expect(cycle2.pendingEncounters).toEqual([]);
  // Wieder gesperrt bis zum Hain.
  await expect(blocker).toContainText(`„${HAIN}“`);
  await expect(newCycleButton).toBeHidden();

  // --- Stammgast wählen und einziehen lassen ------------------------------------------
  const regulars = page.locator('[data-ref="regulars"]');
  const slots = Math.floor((START_MEMORY + gain) / 25);
  expect(slots, 'mindestens ein Stammgast-Platz').toBeGreaterThanOrEqual(1);
  await expect(regulars).toBeVisible();
  await expect(regulars).toContainText(`Stammgäste 0/${slots}`);
  const option = regulars.locator('[data-regular]:not([disabled])').first();
  const regular = (await option.getAttribute('data-regular')) ?? '';
  const species = SPECIES_BY_ID.get(regular)!;
  expect(species, regular).toBeTruthy();
  await option.click();
  await expect(regulars.locator(`[data-regular="${regular}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(regulars).toContainText(`Stammgäste 1/${slots}`);
  expect((await savedState(page)).meta.regulars).toEqual([regular]);
  trail.push(`regular:${regular}`);

  // Begegnungen bleiben offen (der Stapel lehnt ab dem vierten selbst ab) – so hält keine
  // Karte den Platz des Stammgasts besetzt. Einziehen beim ersten Wegpunkt mit freiem Platz.
  const arrival = page.locator('.float-note').filter({ hasText: `Stammgast ${species.name} ist eingezogen.` });
  let arrivedAt = -1;
  for (let seconds = 0; seconds < 30 * 60; ) {
    await advance(page, 5_000);
    seconds += 5;
    const saved = await savedState(page);
    if (!(saved.niches[species.niche] as string[]).includes(regular)) {
      expect(saved.stage, 'Stammgast zieht spätestens ab seiner Freischalt-Stufe ein').toBeLessThanOrEqual(
        species.unlock,
      );
      continue;
    }
    arrivedAt = seconds;
    expect(saved.stage).toBeGreaterThanOrEqual(species.unlock);
    // Die Meldung schwebt kurz über der Szene (CSS-Animation, 3 s Echtzeit).
    await expect(arrival).toBeAttached();
    trail.push(`arrived@${seconds}:wp${saved.waypoint}`);
    break;
  }
  expect(arrivedAt, `Stammgast ${regular} ist nicht eingezogen`).toBeGreaterThan(0);
  await expect(niche(page, species.niche).locator(`[data-species="${regular}"]`)).toBeVisible();

  // --- Neuladen: derselbe Zustand -------------------------------------------------------
  const before = await savedState(page);
  const stageText = await stageLabel(page).textContent();
  await page.reload();
  await expect(stageLabel(page)).toHaveText(stageText ?? '');
  const after = await savedState(page);
  expect(after.version).toBe(5);
  expect(after.cycle.number).toBe(2);
  for (const key of ['waypoint', 'stage', 'plants', 'niches', 'pendingEncounters', 'rngState', 'cycle', 'meta']) {
    expect(after[key], key).toEqual(before[key]);
  }
  await expect(cyclePanel(page).locator('.cycle-sub')).toHaveText('Zyklus 2');
  await expect(cyclePanel(page).locator('[data-ref="forest-memory"]')).toContainText(`Waldgedächtnis ${START_MEMORY + gain} ·`);
  await expect(regulars.locator(`[data-regular="${regular}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(niche(page, species.niche).locator(`[data-species="${regular}"]`)).toBeVisible();

  test.info().annotations.push({ type: 'spur', description: trail.join(' ') });
  test.info().annotations.push({ type: 'laufzeit', description: `${Math.round((Date.now() - startedAt) / 1000)} s` });
});
