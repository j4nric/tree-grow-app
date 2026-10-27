import {
  SAVE_VERSION,
  expect,
  gotoTab,
  niche,
  openBranch,
  openGame,
  openTab,
  researchAction,
  researchName,
  researchNode,
  savedState,
  seedV3,
  test,
  waypoint,
} from './fixtures';

/**
 * Reiter „Forschung“ (früher „Pflege“; DESIGN_V2.md 27.7, 27.12, 28.6, 28.9; Phase 11, 4a):
 * der Forschungsbaum am echten Spielstand – einen Knoten mit ⚖️ erforschen, die Wirkung sehen
 * (ein Platz mehr in der Laubstreu), Neuladen behält ihn; gesperrte Knoten, Doppelklick-Schutz,
 * die Zeile „∞“ mit Rang-Stempel, der Schalter „Plan des letzten Zyklus folgen“ mit
 * Plan-Nummern und „Zur Forschung“ an verschlossenen Nischen. Die Unterseite prüft
 * e2e/album-care.spec.ts, die Vorschau des Baums e2e/research-tree.spec.ts.
 */

/** „Erforschen · ⚖️ 80“ – mit geschütztem Leerzeichen zwischen Symbol und Zahl. */
const buyText = (cost: string) => new RegExp(`^Erforschen · ⚖️\\s${cost.replace('.', '\\.')}$`);

test('Erforschen: ⚖️ weg, ein Platz mehr, Stempel „erforscht“ – auch nach dem Neuladen', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(6) + 1, // Junger Baum: Laubstreu hat 2 Plätze
    harmonyPoints: 400,
    niches: { roots: ['earthworm'], litter: ['robin'] },
  });
  // Die Nischen-Seite schreibt nur, solange sie sichtbar ist (docs/ALBUM_UI.md, D.1).
  await gotoTab(page, 'nischen');
  await expect(niche(page, 'litter')).toContainText('1/2 belegt');
  await openTab(page, 'forschung');
  await expect(page.locator('[data-ref="tab-care"]')).toContainText('Forschung');
  // Der Vorrat wächst ab dem Laden weiter (+48/min), darum nur die Größenordnung.
  await expect(page.locator('[data-ref="care-summary"]')).toContainText(/⚖️ 4\d\d\b/);
  const litter = researchNode(page, 'leaf-litter');
  await expect(litter).toContainText('Laub liegen lassen');
  await expect(litter).toContainText('+1 Platz Laubstreu');
  // Der Baum zeigt auch spätere Ebenen – gesperrt mit Stufe.
  await expect(researchAction(page, 'light-crown')).toHaveAttribute('aria-disabled', 'true');
  await expect(researchNode(page, 'light-crown')).toHaveClass(/is-locked/);

  await researchAction(page, 'leaf-litter').click();

  await expect(litter).toHaveClass(/is-researched/);
  await expect(litter.locator('.research-node-stamp')).toHaveText('erforscht');
  await expect(researchAction(page, 'leaf-litter')).toBeHidden();
  const saved = await savedState(page);
  expect(saved.cycle.research).toEqual(['leaf-litter']);
  expect(saved.harmonyPoints).toBeLessThan(400 - 80 + 20);
  expect(saved.version).toBe(SAVE_VERSION);

  await openTab(page, 'nischen');
  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  await page.reload();
  await expect(niche(page, 'litter')).toContainText('1/3 belegt');
  await openTab(page, 'forschung');
  await expect(litter).toHaveClass(/is-researched/);
  expect((await savedState(page)).cycle.research).toEqual(['leaf-litter']);
});

test('Früherer Hash #pflege öffnet den Reiter Forschung', async ({ page, context }) => {
  await seedV3(context, { totalGrowth: waypoint(6) + 1, harmonyPoints: 100 });
  await page.goto('/#pflege');
  await expect(page.locator('[data-ref="tab-care"]')).toHaveAttribute('aria-selected', 'true');
});

test('Gesperrter Knoten (Voraussetzung fehlt): aria-disabled mit Grund, Klick erforscht nichts', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1, // Alter Baum: Waldtümpel braucht Kompost
    harmonyPoints: 5000,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'forschung');
  const pond = researchNode(page, 'pond');
  // Gesperrt per aria-disabled (nicht `disabled`): bleibt fokussierbar, Grund wird vorgelesen.
  const locked = researchAction(page, 'pond');
  await expect(locked).toHaveText('braucht Kompost');
  await expect(locked).toHaveAttribute('aria-disabled', 'true');
  await expect(locked).toHaveAccessibleName('Waldtümpel: Gesperrt: braucht Kompost.');
  // Querverweis in den anderen Ast.
  await expect(pond.locator('.research-ref')).toHaveAccessibleName('Zu Kompost im Ast Boden springen');
  await locked.click({ force: true });
  await page.waitForTimeout(450);
  expect((await savedState(page)).cycle.research ?? []).toEqual([]);
  // Mit Kompost geht es.
  await researchAction(page, 'compost').click();
  await expect(locked).toHaveAttribute('aria-disabled', 'false');
  await expect(locked).toHaveText(buyText('1.000'));
  await page.waitForTimeout(450);
  await locked.click();
  await expect(pond).toHaveClass(/is-researched/);
  await expect.poll(async () => (await savedState(page)).cycle.research).toEqual(['compost', 'pond']);
});

test('Forschung per Tastatur: nach dem Erforschen Fokus auf dem Namen, Bestätigung schwebt', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain
    harmonyPoints: 100_000,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'forschung');
  const buy = researchAction(page, 'leaf-litter');
  await expect(buy).toHaveText(buyText('80'));
  await buy.focus();
  await page.keyboard.press('Enter');
  await expect(researchNode(page, 'leaf-litter')).toHaveClass(/is-researched/);
  await expect(buy).toBeHidden();
  await expect(researchName(page, 'leaf-litter')).toBeFocused();
  // Bestätigung: schwebender Hinweis und Statuszeile für Screenreader.
  await expect(page.locator('.float-layer')).toContainText('Laub bleibt liegen');
  await expect(page.locator('[data-ref="care"]').getByRole('status')).toHaveText(/Laub/);
  expect((await savedState(page)).cycle.research).toEqual(['leaf-litter']);
});

test('Forschung: Doppelklick und gehaltene Enter-Taste erforschen nur einmal', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1,
    harmonyPoints: 100_000,
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'forschung');
  const harmonyBefore = (await savedState(page)).harmonyPoints as number;
  await researchAction(page, 'leaf-litter').dblclick();
  await expect(researchNode(page, 'leaf-litter')).toHaveClass(/is-researched/);
  await page.waitForTimeout(450);
  const saved = await savedState(page);
  expect(saved.cycle.research).toEqual(['leaf-litter']);
  // Genau einmal bezahlt (dazu kommt nur der Zufluss der wenigen Sekunden).
  expect(saved.harmonyPoints).toBeGreaterThan(harmonyBefore - 160);

  // Gehaltene Enter-Taste: Playwright meldet weitere keydown mit `repeat`.
  await researchAction(page, 'compost').focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(researchNode(page, 'compost')).toHaveClass(/is-researched/);
  await page.waitForTimeout(450);
  expect((await savedState(page)).cycle.research).toEqual(['leaf-litter', 'compost']);
});

test('Zeile „∞“: Rang-Stempel, Kosten des nächsten Rangs, Neuladen; unerreichbare Ränge', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain
    harmonyPoints: 4_000,
    research: ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle'],
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'forschung');
  const soil = researchNode(page, 'soil-life');
  await expect(soil.locator('xpath=ancestor::*[contains(@class,"research-tier-repeat")]')).toContainText('∞ immer weiter');
  await expect(soil.locator('.research-node-stamp')).toBeHidden();
  await expect(researchAction(page, 'soil-life')).toHaveText(buyText('1.500'));
  await researchAction(page, 'soil-life').click();
  await expect(soil.locator('.research-node-stamp')).toHaveText('Rang 1');
  // Der Knopf bleibt: nächster Rang 1.950 ⚖️ (Vorrat reicht noch).
  await expect(researchAction(page, 'soil-life')).toHaveText(buyText('1.950'));
  await page.waitForTimeout(450);
  await researchAction(page, 'soil-life').click();
  await expect(soil.locator('.research-node-stamp')).toHaveText('Rang 2');
  await expect(researchAction(page, 'soil-life')).toHaveText(/^Noch [\d.]+\s⚖️/);
  await expect(page.locator('[data-ref="care"] .research-branch[data-branch="soil"] .research-branch-toggle')).toContainText('∞ Rang 2');
  const saved = await savedState(page);
  expect(saved.cycle.researchRanks).toEqual({ 'soil-life': 2 });
  await page.reload();
  await openTab(page, 'forschung');
  await expect(soil.locator('.research-node-stamp')).toHaveText('Rang 2');
});

test('Zeile „∞“: Rang über dem größten Vorrat heißt „unerreichbar“', async ({ page, context }) => {
  const ranks = 120;
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1,
    harmonyPoints: 1_000,
    research: ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle', ...Array.from({ length: ranks }, () => 'soil-life')],
    researchRanks: { 'soil-life': ranks },
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'forschung');
  await expect(researchNode(page, 'soil-life').locator('.research-node-stamp')).toHaveText('Rang 120');
  await expect(researchAction(page, 'soil-life')).toHaveText('unerreichbar');
  await expect(researchAction(page, 'soil-life')).toHaveAttribute('aria-disabled', 'true');
});

test('Plan des letzten Zyklus folgen: Nummern an den Karten, Schalter kauft dezent nach Plan', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(20) + 1, // Hain
    harmonyPoints: 500,
    researchPlan: { plan: ['leaf-litter', 'compost', 'nest-boxes'], auto: false },
    niches: { roots: ['earthworm'] },
  });
  await gotoTab(page, 'forschung');
  const plan = page.locator('[data-ref="research-plan"]');
  const toggle = plan.getByRole('switch', { name: 'Plan des letzten Zyklus folgen' });
  await expect(toggle).not.toBeChecked();
  await expect(plan.locator('[data-ref="research-plan-status"]')).toContainText('Der Plan hat 3 Schritte');
  await expect(researchNode(page, 'leaf-litter').locator('.research-node-plan')).toHaveText('1');
  await expect(researchNode(page, 'compost').locator('.research-node-plan')).toHaveText('2');
  await expect(researchNode(page, 'nest-boxes').locator('.research-node-plan')).toHaveText('3');
  // Schalter-Fläche: das ganze Etikett, mindestens 44 px hoch.
  expect((await plan.locator('label').boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await toggle.check();
  // Der Tick kauft streng in Plan-Reihenfolge, soweit der Vorrat reicht (80 + 100 + 250 ⚖️).
  await expect.poll(async () => (await savedState(page)).cycle.research).toEqual(['leaf-litter', 'compost', 'nest-boxes']);
  expect((await savedState(page)).meta.research.auto).toBe(true);
  // Dezent: schwebt über dem Bild (bzw. Stempel, wenn das Bild weggescrollt ist).
  await expect(page.locator('.float-layer')).toContainText('Nach Plan erforscht');
  await expect(researchNode(page, 'nest-boxes')).toHaveClass(/is-researched/);
  await expect(researchNode(page, 'nest-boxes').locator('.research-node-plan')).toBeHidden();
  await expect(plan.locator('[data-ref="research-plan-status"]')).toHaveText('Plan erledigt – alles Weitere wählst du selbst.');
});

test('Forschung auf dem Handy: Vorrat und Kennzahl im Kopf, Punkt am Reiter, große Knöpfe, ohne Querscrollen', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedV3(context, { totalGrowth: waypoint(6) + 1, harmonyPoints: 1200, niches: { roots: ['earthworm'] } });
  await openGame(page);
  // Punkt am Reiter schon, bevor die Seite offen ist (G-13).
  const dot = page.locator('[data-ref="tab-care"] .tab-dot');
  await expect(dot).toBeVisible();
  await openTab(page, 'forschung');
  // Junger Baum: Kompost 100, Laub 80, Saatgut sortieren 200, Nistkästen 250, Wildblumen-Saum 300, Waldwiese 600 ⚖️.
  const summary = page.locator('[data-ref="care-summary"]');
  await expect(summary).toContainText('6 erforschbar');
  await expect(summary).toContainText(/⚖️ 1\.?2\d\d · \+\d+\/min/);
  const buy = researchAction(page, 'leaf-litter');
  await expect(buy).toBeVisible();
  expect((await buy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await researchName(page, 'leaf-litter').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // Drei Knoten (zusammen 1.150 ⚖️), danach reicht es für nichts mehr: Punkt weg.
  for (const [branch, id] of [['open', 'meadow'], ['hem', 'wildflower-hem'], ['crown', 'nest-boxes']] as const) {
    await openBranch(page, branch);
    await researchAction(page, id).click();
    await expect(researchNode(page, id)).toHaveClass(/is-researched/);
    await page.waitForTimeout(450);
  }
  await expect(summary).not.toContainText('erforschbar');
  await expect(dot).toBeHidden();
});

test('Mobil: „Zur Forschung“ beim verschlossenen Waldtümpel öffnet den Baum beim Knoten', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1, // Alter Baum: Forschung „Waldtümpel“ ist dran
    harmonyPoints: 10_000,
    research: ['compost'],
    niches: { roots: ['earthworm'] },
  });
  await openGame(page);
  const pond = niche(page, 'pond');
  await expect(pond).toContainText('öffnet durch Forschung „Waldtümpel“');
  // Der Knopf am Hinweis führt hin (Playtest Amphibien): Reiter „Forschung“, Karte im Bild.
  await pond.getByRole('button', { name: 'Zur Forschung: Waldtümpel öffnen' }).click();
  await expect(page.locator('[data-ref="tab-care"]')).toHaveAttribute('aria-selected', 'true');
  await expect(researchName(page, 'pond')).toBeFocused();
  await expect(researchNode(page, 'pond')).toBeInViewport();
  await researchAction(page, 'pond').click();
  // Unsichtbare Reiter holen ihre Anzeige beim Zeigen nach (docs/ALBUM_UI.md, D.1).
  await openTab(page, 'nischen');
  await expect(pond).toContainText('0/2 belegt');
  await expect(pond.locator('[data-ref="niche-care-link"]')).toBeHidden();
});
