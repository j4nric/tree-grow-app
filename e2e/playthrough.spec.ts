import type { Page } from '@playwright/test';
import {
  dialog,
  expect,
  niche,
  openGame,
  overlaps,
  parseGermanNumber,
  savedState,
  seedV2,
  stack,
  stageLabel,
  test,
  waypoint,
} from './fixtures';

/**
 * Langlauf (Roadmap 1.7) und Funde aus dem Playtest (1.8).
 *
 * Der Langlauf spielt den echten Build vom leeren Spielstand bis „Alter Baum“: Die Zeit
 * läuft über `page.clock` im Zeitraffer (Sprünge < 60 s, damit keine Willkommens-Meldung
 * kommt), der Zufallsgenerator startet mit festem Seed. Wie ein Spieler öffnet der Test
 * den Stapel, liest die Vorschau und wählt die Karte mit dem größten Harmonie-Plus –
 * lohnt keine, lehnt er ab. Geprüft werden Regeln, die für jeden Seed gelten.
 */

const STAGES = ['Samen', 'Keimling', 'Setzling', 'Junger Baum', 'Alter Baum'] as const;

interface Decision {
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

/**
 * Löst die oberste Begegnung im offenen Dialog: beste Karte nach Harmonie-Vorschau
 * (mit der vorausgewählten Ersetzung), sonst ablehnen.
 */
async function decide(page: Page): Promise<Decision> {
  const cards = dialog(page).locator('.encounter-card');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  const offered: string[] = [];
  let best: { index: number; harmony: number; replaced: string | null } | null = null;
  for (let i = 0; i < count; i++) {
    const c = cards.nth(i);
    offered.push((await c.getAttribute('data-species')) ?? '');
    if (await c.getByRole('button', { name: /wählen/ }).isDisabled()) continue;
    const harmony = parseGermanNumber((await c.locator('.preview-chip .preview-value').first().textContent()) ?? '');
    const select = c.getByRole('combobox');
    const replaced = (await select.count()) > 0 ? await select.inputValue() : null;
    if (!best || harmony > best.harmony) best = { index: i, harmony, replaced };
  }
  if (best && best.harmony > 0) {
    await cards.nth(best.index).getByRole('button', { name: /wählen/ }).click();
    return { offered, chosen: offered[best.index]!, replaced: best.replaced };
  }
  await dialog(page).getByRole('button', { name: /Ablehnen/ }).click();
  return { offered, chosen: null, replaced: null };
}

test('Langlauf: vom leeren Spielstand bis „Alter Baum“ mit festem Seed', async ({ page, context }) => {
  test.setTimeout(60_000);
  // Uhr anhalten: Zeit vergeht nur über fastForward/runFor → jeder Lauf ist gleich.
  await page.clock.install({ time: new Date('2026-10-21T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-21T08:00:01Z'));
  await seedV2(context, { rngState: 20261021 });
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
      const d = await decide(page);
      // Jede Art höchstens einmal: Angebote sind verschieden und leben noch nicht im Ökosystem.
      expect(new Set(d.offered).size, `doppelte Karten: ${d.offered}`).toBe(d.offered.length);
      for (const id of d.offered) expect(present, `${id} wird angeboten, lebt aber schon hier`).not.toContain(id);
      decisions.push(d);
      await page.clock.runFor(50);
      // Jede Entscheidung ist sofort gespeichert.
      const after = await savedAnimals(page);
      if (d.chosen) expect(after).toContain(d.chosen);
      if (d.replaced) expect(after).not.toContain(d.replaced);
    }
    await expect(stack(page)).toBeHidden();
  }

  await expect(stageLabel(page)).toHaveText('Stufe: Alter Baum');
  const chosen = decisions.filter((d) => d.chosen);
  expect(chosen.length, `ein vernünftiger Spieler findet mehrere passende Tiere: ${JSON.stringify(decisions)}`).toBeGreaterThanOrEqual(4);
  expect(decisions[0]!.offered, 'die erste Begegnung ist immer der Regenwurm').toEqual(['earthworm']);

  const saved = await savedState(page);
  expect(saved.version).toBe(2);
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
  for (const id of pending) await expect(dialog(page).locator(`[data-species="${id}"]`)).toBeVisible();
});

test.describe('Stufen-Banner', () => {
  test('bricht auf dem Desktop nicht unnötig um', async ({ page, context }) => {
    await page.setViewportSize({ width: 1200, height: 700 });
    // Kurz vor dem Hain: Der Stufenwechsel kommt nach wenigen Frames.
    await seedV2(context, { totalGrowth: waypoint(20) - 0.5 });
    await openGame(page);
    const banner = page.locator('#stage-banner');
    await expect(banner).toContainText('Hain');
    const text = banner.locator('span');
    const { height, fontSize } = await text.evaluate((e) => ({
      height: e.getBoundingClientRect().height,
      fontSize: parseFloat(getComputedStyle(e).fontSize),
    }));
    // Eine Zeile (vorher: auf die halbe Szenenbreite begrenzt → zwei Zeilen)
    expect(height).toBeLessThan(fontSize * 1.8);
  });

  test.describe('Mobil (390×844)', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('wird beim Stufenwechsel nicht vom Begegnungs-Stapel verdeckt', async ({ page, context }) => {
      // Jeder Stufenwechsel bringt eine Begegnung: Banner und Stapel erscheinen zugleich.
      await seedV2(context, { totalGrowth: waypoint(1) - 0.3 });
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
