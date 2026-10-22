import type { Locator, Page } from '@playwright/test';
import { SPECIES_BY_ID } from '../src/content/species';
import {
  SAVE_VERSION,
  dialog,
  expect,
  niche,
  openGame,
  overlaps,
  parseGermanNumber,
  savedState,
  seedV3,
  stack,
  stageLabel,
  stamps,
  test,
  waypoint,
} from './fixtures';

/**
 * Langlauf (Roadmap 1.7) und Funde aus dem Playtest (1.8).
 *
 * Der Langlauf spielt den echten Build vom leeren Spielstand bis „Alter Baum“: Die Zeit
 * läuft über `page.clock` im Zeitraffer (Sprünge < 60 s, damit keine Willkommens-Meldung
 * kommt), der Zufallsgenerator startet mit festem Seed. Wie ein Spieler öffnet der Test
 * den Stapel, liest die Vorschau und wählt bei Tieren die Karte mit dem größten
 * Harmonie-Plus, bei Pflanzen die mit dem größten Wachstums-Plus – lohnt keine, lehnt er ab.
 * Geprüft werden Regeln, die für jeden Seed gelten.
 */

const STAGES = ['Samen', 'Keimling', 'Setzling', 'Junger Baum', 'Alter Baum'] as const;

interface Decision {
  kind: 'animal' | 'plant' | 'special';
  offered: string[];
  chosen: string | null;
  replaced: string | null;
}

async function stageIndex(page: Page): Promise<number> {
  const text = ((await stageLabel(page).textContent()) ?? '').replace('Stufe: ', '').trim();
  return STAGES.indexOf(text as (typeof STAGES)[number]);
}

/** Alle Tiere im gespeicherten Ökosystem. */
async function savedAnimals(page: Page): Promise<string[]> {
  const niches = (await savedState(page)).niches as Record<string, string[]>;
  return Object.values(niches).flat();
}

/** Wert eines Vorschau-Chips (z. B. '⚖️' Harmonie, '🌿' Wachstum) einer Karte, 0 wenn er fehlt. */
async function previewValue(card: Locator, icon: string): Promise<number> {
  const chip = card.locator('.preview-chip').filter({ has: card.page().locator('.preview-icon', { hasText: icon }) });
  if ((await chip.count()) === 0) return 0;
  return parseGermanNumber((await chip.first().locator('.preview-value').textContent()) ?? '');
}

/**
 * Löst die oberste Begegnung im offenen Dialog wie ein vernünftiger Spieler:
 * - Tiere: die Karte mit dem größten Harmonie-Plus (mit der vorausgewählten Ersetzung);
 *   lohnt keine, wird abgelehnt.
 * - Pflanzen („Etwas keimt“, gratis): die Karte mit dem größten Wachstums-Plus, bei
 *   Gleichstand die mit mehr Harmonie; nur ablehnen, wenn jede Karte das Wachstum senkt
 *   (z. B. weil ein voller Ring eine bessere Pflanze ersetzen müsste).
 */
async function decide(page: Page): Promise<Decision> {
  const cards = dialog(page).locator('.encounter-card');
  await expect(cards.first()).toBeVisible();
  // Ereignis oder Gast (seit Schritt 2.4): erste Option bzw. „Ziehen lassen“ (immer möglich).
  if ((await cards.first().getAttribute('data-option')) !== null) {
    const id = (await cards.first().getAttribute('data-option')) ?? '';
    const target = id === 'host' ? cards.last() : cards.first();
    await target.locator('.card-choose').click();
    return { kind: 'special', offered: [id], chosen: null, replaced: null };
  }
  const kind = (await cards.first().getAttribute('data-plant')) !== null ? 'plant' : 'animal';
  const count = await cards.count();
  const offered: string[] = [];
  let best: { index: number; score: number; replaced: string | null } | null = null;
  for (let i = 0; i < count; i++) {
    const c = cards.nth(i);
    offered.push((await c.getAttribute('data-card')) ?? '');
    if (await c.getByRole('button', { name: /wählen/ }).isDisabled()) continue;
    const harmony = await previewValue(c, '⚖️');
    // Pflanzen: Wachstum (in %) zählt zuerst, Harmonie entscheidet bei Gleichstand.
    const score = kind === 'plant' ? (await previewValue(c, '🌿')) + harmony / 1000 : harmony;
    const select = c.getByRole('combobox');
    const replaced = (await select.count()) > 0 ? await select.inputValue() : null;
    if (!best || score > best.score) best = { index: i, score, replaced };
  }
  if (best && best.score > 0) {
    await cards.nth(best.index).getByRole('button', { name: /wählen/ }).click();
    return { kind, offered, chosen: offered[best.index]!, replaced: best.replaced };
  }
  await dialog(page).getByRole('button', { name: /Ablehnen/ }).click();
  return { kind, offered, chosen: null, replaced: null };
}

test('Langlauf: vom leeren Spielstand bis „Alter Baum“ mit festem Seed', async ({ page, context }) => {
  test.setTimeout(120_000);
  // Uhr anhalten: Zeit vergeht nur über fastForward/runFor → jeder Lauf ist gleich.
  await page.clock.install({ time: new Date('2026-10-21T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-21T08:00:01Z'));
  await seedV3(context, { rngState: 20261021 });
  await openGame(page);
  await expect(stageLabel(page)).toHaveText('Stufe: Samen');

  const decisions: Decision[] = [];
  let lastStage = 0;
  let gameSeconds = 0;

  for (;;) {
    // Am Anfang kleine Schritte (Wegpunkte alle paar Sekunden), später fast eine Minute.
    const step = gameSeconds < 60 ? 5_000 : 55_000;
    await page.clock.fastForward(step);
    await page.clock.runFor(50); // ein paar Frames: Ansichten aktualisieren
    gameSeconds += step / 1000;
    expect(gameSeconds, 'Alter Baum sollte in unter 45 Spielminuten erreicht sein').toBeLessThan(45 * 60);

    const stage = await stageIndex(page);
    expect(stage, 'unbekannte Stufe').toBeGreaterThanOrEqual(0);
    expect(stage, 'Stufen gehen nie zurück').toBeGreaterThanOrEqual(lastStage);
    lastStage = stage;
    // Am Ziel: Die Begegnung zum Alter Baum bleibt bewusst offen (Neuladen-Prüfung unten).
    if (stage === STAGES.indexOf('Alter Baum')) break;

    if (!(await stack(page).isVisible())) continue;
    await stack(page).click();
    await expect(dialog(page)).toBeVisible();
    while (await dialog(page).isVisible()) {
      await page.clock.fastForward(400); // Eingabesperre nach neuen Karten (läuft auf der Testuhr)
      const present = await savedAnimals(page);
      const plantsBefore = ((await savedState(page)).plants ?? []) as string[];
      const d = await decide(page);
      // Karten einer Begegnung sind verschieden; Tiere leben noch nicht im Ökosystem
      // (Pflanzen dürfen mehrfach wachsen).
      expect(new Set(d.offered).size, `doppelte Karten: ${d.offered}`).toBe(d.offered.length);
      if (d.kind === 'animal') {
        for (const id of d.offered) expect(present, `${id} wird angeboten, lebt aber schon hier`).not.toContain(id);
      }
      decisions.push(d);
      await page.clock.runFor(50);
      // Jede Entscheidung ist sofort gespeichert.
      if (d.kind === 'animal') {
        const after = await savedAnimals(page);
        if (d.chosen) expect(after).toContain(d.chosen);
        if (d.replaced) expect(after).not.toContain(d.replaced);
      } else if (d.chosen) {
        const plants = (await savedState(page)).plants as string[];
        expect(plants).toContain(d.chosen);
        // Ersetzen hält die Ringgröße, sonst kommt genau eine Pflanze dazu.
        expect(plants.length).toBe(plantsBefore.length + (d.replaced ? 0 : 1));
      }
    }
    await expect(stack(page)).toBeHidden();
  }

  await expect(stageLabel(page)).toHaveText('Stufe: Alter Baum');
  const chosen = decisions.filter((d) => d.chosen && d.kind === 'animal');
  expect(chosen.length, `ein vernünftiger Spieler findet mehrere passende Tiere: ${JSON.stringify(decisions)}`).toBeGreaterThanOrEqual(4);
  // Die erste Begegnung (Keimling) ist ein Tier – nur Arten, die schon am Keimling leben können.
  expect(decisions[0]!.kind, 'die erste Begegnung ist ein Tier').toBe('animal');
  for (const id of decisions[0]!.offered) {
    expect(SPECIES_BY_ID.get(id)?.unlock, `${id} an der ersten Begegnung`).toBeLessThanOrEqual(1);
  }
  // Wegpunkt 2 bringt immer „Etwas keimt“ – ab dann wächst mindestens eine Begleitpflanze.
  expect(decisions[1]!.kind, 'die zweite Begegnung ist eine Pflanze').toBe('plant');
  const plantsChosen = decisions.filter((d) => d.chosen && d.kind === 'plant');
  expect(plantsChosen.length, JSON.stringify(decisions)).toBeGreaterThanOrEqual(2);

  const saved = await savedState(page);
  expect(saved.version).toBe(SAVE_VERSION);
  expect(saved.waypoint).toBeGreaterThanOrEqual(12);
  // Jeder Wegpunkt bringt höchstens eine Begegnung: entschieden oder noch wartend (die von
  // „Alter Baum“ bleibt offen). Ohne passende Art entfällt sie (z. B. Wegpunkt 2 im
  // Keimling bei besetztem Wurzelraum) – das darf nur selten passieren.
  expect(saved.pendingEncounters.length).toBeGreaterThanOrEqual(1);
  const encounters = decisions.length + saved.pendingEncounters.length;
  const trail = JSON.stringify(decisions);
  expect(encounters, trail).toBeLessThanOrEqual(saved.waypoint);
  expect(encounters, trail).toBeGreaterThanOrEqual(saved.waypoint - 2);
  expect(Number.isFinite(saved.totalGrowth) && Number.isFinite(saved.seeds)).toBe(true);
  const animals = await savedAnimals(page);
  expect(new Set(animals).size).toBe(animals.length);
  // Die gewählten Pflanzen wachsen im Ring und erscheinen in der Seitenleiste.
  expect(saved.plants.length).toBeGreaterThanOrEqual(2);
  for (const id of new Set(saved.plants as string[])) {
    await expect(page.locator(`[data-ref="plant-ring"] [data-plant="${id}"]`).first()).toBeVisible();
  }
  // Harmonie und Wachstum sind nach ~20 Spielminuten deutlich über dem Start.
  expect(parseGermanNumber((await page.locator('[data-ref="harmony"]').textContent()) ?? '')).toBeGreaterThan(30);
  expect(parseGermanNumber((await page.locator('[data-ref="growth-rate"]').textContent()) ?? '')).toBeGreaterThan(10);

  // Neuladen zeigt denselben Stand: Stufe, Bewohner, wartende Begegnung mit denselben Karten.
  const pending = saved.pendingEncounters[0].cards as string[];
  await page.reload();
  await expect(stageLabel(page)).toHaveText('Stufe: Alter Baum');
  for (const [id, list] of Object.entries(saved.niches as Record<string, string[]>)) {
    for (const animal of list) await expect(niche(page, id).locator(`[data-species="${animal}"]`)).toBeVisible();
  }
  await stack(page).click();
  await expect(dialog(page)).toBeVisible();
  for (const id of pending) await expect(dialog(page).locator(`[data-card="${id}"]`)).toBeVisible();
});

test.describe('Stufen-Banner', () => {
  test('bricht auf dem Desktop nicht unnötig um', async ({ page, context }) => {
    await page.setViewportSize({ width: 1200, height: 700 });
    // Kurz vor dem Hain: Der Stufenwechsel kommt nach wenigen Frames.
    await seedV3(context, { totalGrowth: waypoint(20) - 0.5 });
    await openGame(page);
    const banner = page.locator('#stage-banner');
    await expect(banner).toContainText('Hain');
    // Der gleichzeitig freigeschaltete Erfolg steht im Banner (kein zweiter Hinweis daneben).
    await expect(banner.locator('.stage-banner-extra')).toContainText('Nicht mehr allein');
    await expect(stamps(page)).not.toContainText('Nicht mehr allein');
    const text = banner.locator('span').first();
    // Layouthöhe statt umschließendem Rechteck: Das Polaroid im Album ist leicht gedreht.
    const { height, fontSize } = await text.evaluate((e) => ({
      height: (e as HTMLElement).offsetHeight,
      fontSize: parseFloat(getComputedStyle(e).fontSize),
    }));
    // Eine Zeile (vorher: auf die halbe Szenenbreite begrenzt → zwei Zeilen)
    expect(height).toBeLessThan(fontSize * 1.8);
  });

  test.describe('Mobil (390×844)', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('wird beim Stufenwechsel nicht vom Begegnungs-Stapel verdeckt', async ({ page, context }) => {
      // Jeder Stufenwechsel bringt eine Begegnung: Banner und Stapel erscheinen zugleich.
      await seedV3(context, { totalGrowth: waypoint(1) - 0.3 });
      await openGame(page);
      const banner = page.locator('#stage-banner');
      await expect(banner).toContainText('Keimling');
      await expect(stack(page)).toBeVisible();
      const bannerBox = (await banner.boundingBox())!;
      const stackBox = (await stack(page).boundingBox())!;
      expect(overlaps(bannerBox, stackBox), 'Banner und Stapel überlappen').toBe(false);
      // Das Banner bleibt innerhalb der Szene.
      const sceneBox = (await page.locator('.scene').boundingBox())!;
      expect(bannerBox.x).toBeGreaterThanOrEqual(sceneBox.x);
      expect(bannerBox.x + bannerBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width);
    });
  });
});
