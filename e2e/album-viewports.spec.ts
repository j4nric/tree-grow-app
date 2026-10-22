import type { Locator, Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, createSite, type GameState } from '../src/core/state';
import {
  cover,
  encounter,
  expect,
  gotoTab,
  note,
  openCover,
  openTab,
  overlaps,
  pageTitle,
  savedState,
  seedRaw,
  settledSubpage,
  stack,
  stageLabel,
  sticker,
  tabButton,
  tabPanel,
  test,
  waitForConfirm,
  waypoint,
  type TabHash,
} from './fixtures';

/**
 * Viewport-Matrix des Albums (docs/ALBUM_UI.md, E.2 und F-13): die Kernabläufe bei 360 × 740,
 * 390 × 844 und 1200 × 700 – Reiterwechsel samt Hash, Umblättern zu jeder Unterseite und
 * zurück über Lesezeichen, Browser-Zurück und Escape, Begegnung einkleben, Pflege kaufen,
 * Neuer Zyklus, Umschlag-Seiten. Überall: kein Querscrollen, Bedienelemente mindestens
 * 44 px, Meldungen und Haftnotizen verdecken keine Navigation. Je Reiter ein Screenshot als
 * Anhang (nur zum Ansehen, kein Pixelvergleich).
 *
 * Messungen erst, wenn das Umblättern fertig ist (`settledSubpage`: kein `inert` mehr) –
 * mitten in der Drehung ragt die Seite kurz über den Rand.
 */

const VIEWPORTS = [
  { name: '360 × 740', width: 360, height: 740 },
  { name: '390 × 844', width: 390, height: 844 },
  { name: '1200 × 700', width: 1200, height: 700 },
] as const;

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');
const TABS: readonly TabHash[] = ['nischen', 'arten', 'pflege', 'ziele', 'landschaft'];

/**
 * Bekannte Ausnahmen der 44-px-Regel (mit Grund). Der Stammgast-Stern auf dem Sticker im
 * Reiter Arten ist 26 px groß, seine Trefferfläche per ::before 40 px – er sitzt auf der
 * Ecke des 48-px-Stickers und würde sonst dessen Fläche überdecken.
 */
const SMALL_OK = ['.species-star'];

/**
 * Urwald mit Landschaft (fünf Reiter), Tiere in mehreren Nischen (Waldkauz für U:Tier und
 * Nahrungsnetz), viele Samen (Pflege), eine wartende Begegnung, Neuer Zyklus möglich. Beim
 * Laden kommt der Sammelhinweis der Erfolge – eine Meldung, die nichts verdecken darf.
 */
function richState(): GameState {
  const state = createInitialState(Date.now(), 4242);
  state.stage = ANCIENT;
  state.waypoint = STAGES[ANCIENT]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.seeds = 50_000;
  state.cycle.number = 4;
  state.meta.forestMemory = 300;
  state.meta.achievements = ['ancient-forest'];
  state.meta.landscape = { active: 'home', sites: [{ ...createSite('home'), ancient: true }], corridors: [], freeCorridors: [], announced: true };
  Object.assign(state.niches, {
    roots: ['earthworm', 'vole'],
    litter: ['robin', 'woodlouse'],
    edge: ['bee', 'fox'],
    crown: ['bluetit'],
    hollows: ['owl'],
  });
  state.meta.journal.species.push('earthworm', 'vole', 'robin', 'woodlouse', 'bee', 'fox', 'bluetit', 'owl');
  state.pendingEncounters = [{ type: 'animal', cards: ['woodpecker', 'squirrel'], rerolls: 0 }];
  return state;
}

/** Die Seite scrollt nicht quer. */
async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `Querscrollen: ${where}`).toBeLessThanOrEqual(0);
}

/**
 * Alle sichtbaren Bedienelemente in `scope` sind mindestens 44 × 44 px groß. Kästchen und
 * Schalter in einem `<label>` zählen mit der Fläche ihres Labels (Tipp aufs Label schaltet).
 */
async function expectTouchTargets(scope: Locator, where: string): Promise<void> {
  const small = await scope.evaluate((root, allowed) => {
    const out: string[] = [];
    for (const node of root.querySelectorAll<HTMLElement>('button, a[href], [role="tab"], input:not([type="hidden"]), select, summary')) {
      if (node.closest('[hidden], .turned-away') || allowed.some((sel) => node.matches(sel))) continue;
      const own = node.getBoundingClientRect();
      if (own.width === 0 || own.height === 0 || getComputedStyle(node).visibility === 'hidden') continue;
      const label = node instanceof HTMLInputElement ? node.closest('label') : null;
      const r = label ? label.getBoundingClientRect() : own;
      // Ganzzahlig gerundet: Ränder von 43,8 px zählen als 44.
      if (Math.round(r.width) < 44 || Math.round(r.height) < 44) {
        const name = (node.getAttribute('aria-label') ?? label?.textContent ?? node.textContent ?? '').trim().slice(0, 40);
        out.push(`${node.tagName.toLowerCase()}.${node.className} „${name}“ ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
      }
    }
    return out;
  }, SMALL_OK);
  expect(small, `zu kleine Bedienelemente: ${where}`).toEqual([]);
}

/**
 * Meldungen (Stempel, Zettel) liegen nie über der Navigation: Reiterleiste, Lesezeichen und
 * Titel der sichtbaren Seite, Umschlag-Knopf, Zettelstapel. Gemessen nach dem Hereinstempeln
 * und in einem Schritt (sonst könnte der Zettelstapel zwischen zwei Messungen erscheinen und
 * die Schicht per CSS nach oben rücken).
 */
async function expectStampsFree(page: Page, where: string): Promise<void> {
  const layer = page.locator('[data-ref="stamps"]');
  await layer.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
  const found = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true }) ? r : null;
    };
    /*
     * Ziele nur, wenn sie wirklich oben liegen: Mobil liegt eine Unterseite des Umschlags über
     * der ganzen Hauptansicht – Reiter und Reiterseite darunter sind dann verdeckt. Die
     * Meldungsschicht lässt Klicks durch (pointer-events: none), elementFromPoint sieht sie nicht.
     */
    const onTop = (el: Element) => {
      const r = visible(el);
      if (!r) return null;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && (el.contains(hit) || hit.contains(el)) ? r : null;
    };
    const stamps = [...document.querySelectorAll('[data-ref="stamp"]')].map(visible).filter((r): r is DOMRect => r !== null);
    const targets: [string, string][] = [
      ['Reiterleiste', '[data-ref="tabs"]'],
      ['Lesezeichen', '[data-ref="bookmark"]'],
      ['Seitentitel', '.page-title'],
      ['Umschlag-Knopf', '[data-ref="cover-open"]'],
      ['Zettelstapel', '[data-ref="encounter-stack"]'],
    ];
    const hits: string[] = [];
    for (const s of stamps) {
      if (s.left < -0.5 || s.right > window.innerWidth + 0.5) hits.push('Meldung ragt aus dem Bild');
      for (const [name, selector] of targets) {
        for (const el of document.querySelectorAll(selector)) {
          const r = onTop(el);
          if (!r) continue;
          const dx = Math.min(s.right, r.right) - Math.max(s.left, r.left);
          const dy = Math.min(s.bottom, r.bottom) - Math.max(s.top, r.top);
          if (dx > 1 && dy > 1) hits.push(`Meldung verdeckt ${name}`);
        }
      }
    }
    return { count: stamps.length, hits };
  });
  expect(found.hits, where).toEqual([]);
}

/** Screenshot als Anhang und Datei in test-results/ (nur ansehen, kein Pixelvergleich). */
async function shot(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

/** Alles flach: keine Unterseite offen, nichts weggedreht oder gesperrt. */
async function expectFlat(page: Page): Promise<void> {
  await expect(page.locator('.turned-away')).toHaveCount(0);
  await expect(page.locator('.album [inert]')).toHaveCount(0);
  await expect(page.locator('[data-ref^="page-"]:not(.album-tabpanel):visible')).toHaveCount(0);
}

type BackWay = 'Lesezeichen' | 'Browser-Zurück' | 'Escape';

async function goBack(page: Page, sub: Locator, way: BackWay): Promise<void> {
  if (way === 'Lesezeichen') await sub.locator('[data-ref="bookmark"]').click();
  else if (way === 'Browser-Zurück') await page.goBack();
  else await page.keyboard.press('Escape');
  await expect(sub).toBeHidden();
}

/** Prüft eine fertig aufgeschlagene Unterseite: Lesezeichen und Titel im Bild, Maße, Meldungen. */
async function checkSubpage(page: Page, sub: Locator, label: string): Promise<void> {
  const bookmark = sub.locator('[data-ref="bookmark"]');
  await expect(bookmark, label).toBeInViewport();
  await expect(sub.locator('.page-title'), label).toBeVisible();
  // Unterseiten ändern den Hash nicht (C.2).
  await expectNoHorizontalScroll(page, label);
  await expectTouchTargets(sub, label);
  await expectStampsFree(page, label);
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    const mobile = viewport.width < 760;

    test('Reiter: Hash, kein Querscrollen, Bedienelemente ≥ 44 px, Meldung verdeckt nichts', async ({ page, context }) => {
      await seedRaw(context, richState(), 0);
      await gotoTab(page, 'nischen');
      // Beim Laden kommt eine Meldung (Erfolge nachgetragen) – sie darf nichts verdecken.
      await expect(page.locator('[data-ref="stamp"]')).not.toHaveCount(0);
      for (const tab of TABS) {
        await openTab(page, tab);
        await expect(page).toHaveURL(new RegExp(`#${tab}$`));
        await expect(pageTitle(page)).toBeVisible();
        await expectNoHorizontalScroll(page, `Reiter ${tab}`);
        await expectTouchTargets(page.locator('[data-ref="tabs"]'), `Reiterleiste bei ${tab}`);
        await expectTouchTargets(tabPanel(page, tab), `Reiter ${tab}`);
        await expectStampsFree(page, `Reiter ${tab}`);
        await shot(page, `${viewport.width}x${viewport.height}-${tab}`);
      }
      // Umschlag-Knopf und Zettelstapel sind selbst groß genug.
      for (const control of [page.locator('[data-ref="cover-open"]'), stack(page)]) {
        const box = (await control.boundingBox())!;
        expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
        expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
      }
      // Haftnotiz: ganz im Bild, verdeckt ihren Auslöser nicht, „Verstanden“ ≥ 44 px.
      await openTab(page, 'nischen');
      const label = page.locator('button.tape-label-harmony');
      await label.click();
      const harmony = note(page, 'harmony-note');
      await expect(harmony).toBeVisible();
      await harmony.evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished.catch(() => undefined))));
      const noteBox = (await harmony.boundingBox())!;
      expect(noteBox.x).toBeGreaterThanOrEqual(0);
      expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(viewport.width);
      expect(overlaps(noteBox, (await label.boundingBox())!), 'Notiz verdeckt ihren Auslöser').toBe(false);
      await expectTouchTargets(harmony, 'Harmonie-Notiz');
      await expectNoHorizontalScroll(page, 'Harmonie-Notiz offen');
      await page.keyboard.press('Escape');
      await expect(harmony).toBeHidden();
    });

    /**
     * Öffnet per `open`, prüft die fertig aufgeschlagene Unterseite und blättert zurück –
     * abwechselnd über Lesezeichen, Browser-Zurück und Escape. Mit `tab`: Hash und Reiter
     * bleiben, danach ist alles flach.
     */
    function visitor(page: Page) {
      const ways: BackWay[] = ['Lesezeichen', 'Browser-Zurück', 'Escape'];
      let turn = 0;
      return async (kind: string, open: () => Promise<void>, tab: TabHash | null): Promise<void> => {
        await open();
        const sub = await settledSubpage(page, kind);
        const label = `U:${kind}`;
        await checkSubpage(page, sub, label);
        if (tab) await expect(page, label).toHaveURL(new RegExp(`#${tab}$`));
        await shot(page, `${viewport.width}x${viewport.height}-${kind}`);
        const way = ways[turn++ % ways.length]!;
        await goBack(page, sub, way);
        if (tab) {
          await expect(tabPanel(page, tab), `${label} ${way}`).toBeVisible();
          await expect(page, `${label} ${way}`).toHaveURL(new RegExp(`#${tab}$`));
          await expectFlat(page);
        }
      };
    }

    test('Nischen: U:Tier → Nahrungsnetz → Begegnung (nie Ebene 3), Pflanze setzen, Harmonie', async ({ page, context }) => {
      await seedRaw(context, richState(), 0);
      await gotoTab(page, 'nischen');
      const visit = visitor(page);

      // U:Tier, Ebene 2 (Nahrungsnetz), dann die Begegnung als „Ebene 3“.
      await sticker(page, 'hollows', 'owl').click();
      const animal = await settledSubpage(page, 'animal');
      await checkSubpage(page, animal, 'U:animal');
      await animal.locator('[data-ref="detail-food-web"]').click();
      const web = await settledSubpage(page, 'foodweb');
      await checkSubpage(page, web, 'U:foodweb (Ebene 2)');
      // Der Zettelstapel bleibt auf Unterseiten erreichbar; die Begegnung ersetzt die oberste Seite.
      await stack(page).click();
      const enc = await settledSubpage(page, 'encounter');
      await checkSubpage(page, enc, 'U:encounter (statt Ebene 3)');
      await expect(web).toBeHidden();
      await goBack(page, enc, 'Lesezeichen');
      await expect(animal).toBeVisible();
      await expect(animal).not.toHaveAttribute('inert', '');
      await goBack(page, animal, 'Browser-Zurück');
      await expectFlat(page);
      await expect(page).toHaveURL(/#nischen$/);

      await visit('plant-picker', () => page.locator('[data-ref="plant-open"]').click(), 'nischen');
      await visit('foodweb', () => page.locator('[data-ref="food-web-link"]').click(), 'nischen');
      await visit(
        'harmony',
        async () => {
          await page.locator('button.tape-label-harmony').click();
          await note(page, 'harmony-note').getByRole('button', { name: 'Mehr ›' }).click();
        },
        'nischen',
      );
    });

    test('Pflege, Ziele, Landschaft: Unterseiten umblättern und zurück', async ({ page, context }) => {
      await seedRaw(context, richState(), 0);
      await gotoTab(page, 'pflege');
      const visit = visitor(page);
      await visit('care-item', () => tabPanel(page, 'pflege').locator('[data-care-title="leaf-litter"]').click(), 'pflege');

      await openTab(page, 'ziele');
      for (const kind of ['cycle', 'achievements', 'stats']) {
        await visit(kind, () => page.locator(`[data-ref="${kind}-open"]`).click(), 'ziele');
      }

      await openTab(page, 'landschaft');
      await visit('site', () => page.locator('[data-ref="landscape-map"] [data-site="floodplain"]').click(), 'landschaft');
    });

    test('Umschlag: Anleitung samt Kapitel, Einstellungen, Spielstand', async ({ page, context }) => {
      await seedRaw(context, richState(), 0);
      await gotoTab(page, 'landschaft');
      const visit = visitor(page);
      // Umschlag (eigene Ebene 0).
      await openCover(page);
      await expectNoHorizontalScroll(page, 'Umschlag');
      await expectTouchTargets(cover(page), 'Umschlag');
      await shot(page, `${viewport.width}x${viewport.height}-umschlag`);
      for (const kind of ['guide', 'settings', 'save']) {
        await visit(kind, () => page.locator(`[data-ref="${kind}-open"]`).click(), null);
        await expect(cover(page), `Umschlag nach U:${kind}`).toBeVisible();
      }
      // Anleitung → Kapitel (Ebene 2) → zurück zum Verzeichnis.
      await page.locator('[data-ref="guide-open"]').click();
      const guide = await settledSubpage(page, 'guide');
      await guide.locator('.guide-toc-link').first().click();
      const chapter = await settledSubpage(page, 'guide-chapter');
      await checkSubpage(page, chapter, 'U:guide-chapter');
      await goBack(page, chapter, 'Escape');
      await expect(guide).toBeVisible();
      await goBack(page, guide, 'Browser-Zurück');
      await expect(cover(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(cover(page)).toBeHidden();
      await expectFlat(page);
      // Hash und Reiter stimmen nach allem Hin und Her noch überein.
      await expect(page).toHaveURL(/#landschaft$/);
      await expect(tabButton(page, 'landschaft')).toHaveAttribute('aria-selected', 'true');
    });

    test('Kernabläufe: Begegnung einkleben, Pflege kaufen, Neuer Zyklus, Neuladen behält Reiter und Stand', async ({ page, context }) => {
      await seedRaw(context, richState(), 0);
      await gotoTab(page, 'nischen');

      // Begegnung: Stapel → U:Begegnung → einkleben → leerer Stapel blättert zurück.
      await stack(page).click();
      const enc = await settledSubpage(page, 'encounter');
      if (mobile) await expect(stack(page)).toBeHidden();
      const choose = enc.getByRole('button', { name: 'Buntspecht einkleben' });
      // Mobil ohne Scrollen zu sehen; die Doppelseite scrollt rechts in sich.
      if (mobile) await expect(choose).toBeInViewport();
      await expectTouchTargets(enc, 'U:Begegnung');
      await expectNoHorizontalScroll(page, 'U:Begegnung');
      await page.waitForTimeout(400); // Eingabesperre nach neuen Karten (Schutz vor Doppelklicks)
      await choose.click();
      await expect(encounter(page)).toBeHidden();
      await expect(stack(page)).toBeHidden();
      await expect(pageTitle(page)).toBeFocused();
      await expect(page.locator('[data-species="woodpecker"]').first()).toBeVisible();
      expect((await savedState(page)).pendingEncounters).toEqual([]);

      // Pflege: direkt in der Liste kaufen.
      await openTab(page, 'pflege');
      const item = tabPanel(page, 'pflege').locator('[data-care="leaf-litter"]');
      const seedsBefore = (await savedState(page)).seeds as number;
      await item.locator('.care-buy').click();
      await expect.poll(async () => (await savedState(page)).cycle.care?.['leaf-litter'] ?? 0).toBe(1);
      expect((await savedState(page)).seeds).toBeLessThan(seedsBefore);
      await expectNoHorizontalScroll(page, 'nach dem Kauf');
      await expectStampsFree(page, 'nach dem Kauf');

      // Neuer Zyklus: Reiter Ziele → U:Neuer Zyklus → zwei Klicks.
      await openTab(page, 'ziele');
      await page.locator('[data-ref="cycle-open"]').click();
      const cycle = await settledSubpage(page, 'cycle');
      const start = cycle.locator('[data-ref="new-cycle"]');
      await expect(start).toBeVisible();
      await start.scrollIntoViewIfNeeded();
      await start.click();
      await expect(start).toContainText('Zum Bestätigen erneut klicken');
      await waitForConfirm(page);
      await start.click();
      await expect(page.locator('[data-ref="stamps"]')).toContainText('Zyklus 5 beginnt');
      await expect(cycle).toBeHidden();
      await expect(pageTitle(page)).toBeFocused();
      await expect(stageLabel(page)).toHaveText(/Stufe: (Samen|Keimling)/);
      await expectNoHorizontalScroll(page, 'nach dem Neuen Zyklus');
      await expectStampsFree(page, 'Meldung „Zyklus 5 beginnt“');
      await shot(page, `${viewport.width}x${viewport.height}-neuer-zyklus`);

      // Neuladen: derselbe Reiter (Hash), derselbe Stand.
      await page.reload();
      await expect(stageLabel(page)).toContainText('Stufe:');
      await expect(tabButton(page, 'ziele')).toHaveAttribute('aria-selected', 'true');
      await expect(tabPanel(page, 'ziele')).toBeVisible();
      const saved = await savedState(page);
      expect(saved.cycle.number).toBe(5);
      expect(saved.meta.journal.species).toContain('woodpecker');
    });
  });
}
