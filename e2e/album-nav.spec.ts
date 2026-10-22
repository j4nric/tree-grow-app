import type { Page } from '@playwright/test';
import { STAGES } from '../src/content/stages';
import { createInitialState, createSite, type GameState } from '../src/core/state';
import {
  albumAnimationsDone,
  back,
  cover,
  expect,
  fullscreen,
  gotoTab,
  openAnimal,
  openCover,
  openFullscreen,
  openGame,
  openGoalsPage,
  openSavePage,
  openTab,
  pageTitle,
  polaroidButton,
  seedRaw,
  seedV3,
  stageLabel,
  subpage,
  tabButton,
  tabPanel,
  test,
  waypoint,
} from './fixtures';

/**
 * Navigation des Albums (docs/ALBUM_UI.md, C.1–C.3, E.2): Umblättern, Zurück über Escape,
 * Lesezeichen und Browser-Zurück, auch mitten in einer Drehung und nach einem
 * Layoutwechsel; Reiter und Hash (Neuladen, unbekannter und gesperrter Hash); reduzierte
 * Bewegung ohne `rotateY`. „Nie Ebene 3“ und der Weg durch alle Unterseiten bei 360/390/1200
 * stehen in album-viewports.spec.ts.
 *
 * Die Wischgeste „Zurück“ (C.2, `album/swipe.ts`) ist noch nicht gebaut – dafür gibt es hier
 * noch keinen Test.
 */

/** Ohne Unterseite ist nichts weggedreht und nichts gesperrt. */
async function expectFlat(page: Page): Promise<void> {
  await expect(page.locator('.turned-away')).toHaveCount(0);
  await expect(page.locator('.album [inert]')).toHaveCount(0);
  await expect(subpage(page, 'save')).toBeHidden();
}

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('Escape direkt nach dem Antippen: keine leere Seite, der Umschlag bleibt bedienbar', async ({ page }) => {
      await openGame(page);
      await openCover(page);
      await page.locator('[data-ref="save-open"]').click();
      // Noch während der Drehung zurück.
      await page.keyboard.press('Escape');
      await albumAnimationsDone(page);
      await expect(cover(page)).toBeVisible();
      await expectFlat(page);
      // Weiter bedienbar: noch einmal umblättern und zurück.
      await page.locator('[data-ref="save-open"]').click();
      await expect(subpage(page, 'save')).toBeVisible();
      await expect(subpage(page, 'save')).not.toHaveAttribute('inert', '');
      await page.keyboard.press('Escape');
      await expect(subpage(page, 'save')).toBeHidden();
      await expect(cover(page)).toBeVisible();
      await expectFlat(page);
    });

    test('Browser-Zurück direkt nach dem Antippen: keine leere Seite', async ({ page }) => {
      await openGame(page);
      await openCover(page);
      await page.locator('[data-ref="save-open"]').click();
      await page.goBack();
      await albumAnimationsDone(page);
      await expect(cover(page)).toBeVisible();
      await expectFlat(page);
    });

    test('Umschlag → Spielstand → zweimal Browser-Zurück: die App bleibt, die Hauptseite ist zu sehen', async ({ page }) => {
      await openGame(page);
      await openSavePage(page);
      await page.goBack();
      await expect(subpage(page, 'save')).toBeHidden();
      await expect(cover(page)).toBeVisible();
      await page.goBack();
      await expect(cover(page)).toBeHidden();
      expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL!).origin);
      await expect(pageTitle(page)).toBeVisible();
      await expect(page.locator('[data-ref="stage"]')).toContainText('Stufe:');
      await expectFlat(page);
    });

    test('Umschlag schließen und sofort wieder öffnen: danach sichtbar', async ({ page }) => {
      await openGame(page);
      const button = page.locator('[data-ref="cover-open"]');
      // Mobil liegt der Umschlag über Knopf und Reitern: dort nur „Schließen“.
      const ways = viewport.width > 760 ? (['Knopf', 'Reiter', 'Schließen'] as const) : (['Schließen'] as const);
      for (const close of ways) {
        await openCover(page);
        // Schließen startet die Animation – der Zustand gilt sofort.
        if (close === 'Knopf') await button.click();
        else if (close === 'Reiter') await page.locator('[data-ref="tab-care"]').click();
        else await page.locator('[data-ref="cover-close"]').click();
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        // Mitten in der Schließ-Animation wieder öffnen.
        await button.click();
        await expect(button).toHaveAttribute('aria-expanded', 'true');
        await albumAnimationsDone(page);
        await expect(cover(page), close).toBeVisible();
        await expect(cover(page)).not.toHaveClass(/cover-out/);
        await expect(page.locator('[data-ref="save-open"]')).toBeVisible();
        // Und wieder zu (Ruhezustand für die nächste Runde).
        await page.keyboard.press('Escape');
        await expect(cover(page)).toBeHidden();
      }
    });

    test('Doppelklick aufs Lesezeichen geht nur eine Ebene zurück', async ({ page }) => {
      await openGame(page);
      await openSavePage(page);
      await subpage(page, 'save').locator('[data-ref="bookmark"]').dblclick();
      await albumAnimationsDone(page);
      await expect(cover(page)).toBeVisible();
      await expect(subpage(page, 'save')).toBeHidden();
      await expect(page.locator('[data-ref="stage"]')).toContainText('Stufe:');
    });
  });
}

test('Layoutwechsel bei offener Unterseite: sichtbar, bedienbar, Zurück geht', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  await openSavePage(page);
  const save = subpage(page, 'save');

  for (const [width, height] of [
    [1200, 700],
    [390, 844],
    [1200, 700],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('[data-ref="album"]')).toHaveAttribute('data-layout', width > 760 ? 'spread' : 'single');
    await expect(save).toBeVisible();
    await expect(save).not.toHaveAttribute('inert', '');
    // Bedienbar: „Code erzeugen“ geht.
    await save.locator('[data-ref="export"]').click();
    await expect(save.locator('[data-ref="export-code"]')).toBeVisible();
  }

  await save.locator('[data-ref="bookmark"]').click();
  await expect(save).toBeHidden();
  await expect(cover(page)).toBeVisible();
  await expectFlat(page);
  // Auch mobil danach alles flach.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFlat(page);
  await page.keyboard.press('Escape');
  await expect(cover(page)).toBeHidden();
  await expect(pageTitle(page)).toBeVisible();
});

/** Vollbild zu, Canvas zurück im Polaroid, Album bedienbar (nichts mehr `inert`). */
async function expectAlbumBack(page: Page): Promise<void> {
  await expect(fullscreen(page)).toBeHidden();
  await expect(polaroidButton(page).locator('canvas#scene')).toHaveCount(1);
  await expect(page.locator('[data-ref="album"]')).not.toHaveAttribute('inert', '');
  await expect(page.locator('html')).not.toHaveClass(/album-fullscreen-open/);
  await expectFlat(page);
  await expect(pageTitle(page)).toBeVisible();
}

for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
]) {
  test.describe(`Vollbild ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const how of ['Escape', 'Browser-Zurück'] as const) {
      test(`öffnen und sofort ${how}: das Album ist wieder sichtbar und bedienbar`, async ({ page }) => {
        await openGame(page);
        const historyBefore = await page.evaluate(() => history.length);
        await polaroidButton(page).click();
        // Noch während des Aufziehens zurück.
        if (how === 'Escape') await page.keyboard.press('Escape');
        else await page.goBack();
        await expectAlbumBack(page);
        // Die App ist nicht verlassen, der Verlauf wächst nicht.
        expect(page.url()).toContain('localhost');
        expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(historyBefore + 1);
        // Bedienbar: Umschlag auf und zu, Vollbild noch einmal auf und zu.
        await openCover(page);
        await page.keyboard.press('Escape');
        await expect(cover(page)).toBeHidden();
        await openFullscreen(page);
        await page.keyboard.press('Escape');
        await expectAlbumBack(page);
      });
    }
  });
}

test('Layoutwechsel 390 ↔ 1200 bei offenem Vollbild: füllt die Fläche, schließt sauber', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  await openFullscreen(page);
  for (const [width, height] of [
    [1200, 700],
    [390, 844],
    [1200, 700],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('[data-ref="album"]')).toHaveAttribute('data-layout', width > 760 ? 'spread' : 'single');
    await expect(fullscreen(page)).toBeVisible();
    // Das Canvas folgt der neuen Fläche (Backing-Store = Layout × Pixeldichte).
    await expect
      .poll(() =>
        page.locator('canvas#scene').evaluate((el, w) => {
          const c = el as HTMLCanvasElement;
          return Math.abs(c.clientWidth - w) <= 1 && Math.abs(c.width - Math.round(c.clientWidth * devicePixelRatio)) <= 1;
        }, width),
      )
      .toBe(true);
    await expect(page.locator('[data-ref="fullscreen-close"]')).toBeInViewport();
  }
  await page.locator('[data-ref="fullscreen-close"]').click();
  await expectAlbumBack(page);
  await expect(polaroidButton(page)).toBeInViewport();
  // Auch mobil danach alles in Ordnung.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFlat(page);
  await openFullscreen(page);
  await page.keyboard.press('Escape');
  await expectAlbumBack(page);
});

/** Urwald mit freigeschalteter Landschaft (fünf Reiter). */
function landscapeState(): GameState {
  const ancient = STAGES.findIndex((s) => s.id === 'ancient-forest');
  const state = createInitialState(Date.now(), 4242);
  state.stage = ancient;
  state.waypoint = STAGES[ancient]!.waypoint;
  state.totalGrowth = waypoint(state.waypoint) + 1;
  state.meta.forestMemory = 300;
  state.meta.achievements = ['ancient-forest'];
  state.meta.landscape = { active: 'home', sites: [{ ...createSite('home'), ancient: true }], corridors: [], freeCorridors: [], announced: true };
  return state;
}

test.describe('Reiter und Hash (C.2)', () => {
  test('Klick setzt den Hash, Neuladen öffnet denselben Reiter, Hash-Wechsel wechselt den Reiter', async ({ page, context }) => {
    await seedRaw(context, landscapeState(), 0);
    await openGame(page);
    await expect(tabButton(page, 'nischen')).toHaveAttribute('aria-selected', 'true');
    for (const tab of ['arten', 'pflege', 'ziele', 'landschaft', 'nischen'] as const) {
      await openTab(page, tab);
      await expect(page).toHaveURL(new RegExp(`#${tab}$`));
      // Genau eine Reiterseite ist zu sehen.
      await expect(page.locator('.album-tabpanel:visible')).toHaveCount(1);
    }
    // Reiterwechsel legt keine Verlaufseinträge an (nur Unterseiten tun das).
    const length = await page.evaluate(() => history.length);
    await openTab(page, 'pflege');
    await openTab(page, 'arten');
    expect(await page.evaluate(() => history.length)).toBe(length);

    await page.reload();
    await expect(stageLabel(page)).toContainText('Stufe:');
    await expect(tabButton(page, 'arten')).toHaveAttribute('aria-selected', 'true');
    await expect(tabPanel(page, 'arten')).toBeVisible();

    // Hash von außen (Lesezeichen, Link): wechselt den Reiter ohne Neuladen.
    await page.evaluate(() => (location.hash = '#ziele'));
    await expect(tabButton(page, 'ziele')).toHaveAttribute('aria-selected', 'true');
    await expect(tabPanel(page, 'ziele')).toBeVisible();
  });

  test('Neuladen auf einer Unterseite: Reiter bleibt, die Unterseite nicht', async ({ page, context }) => {
    await seedRaw(context, landscapeState(), 0);
    await gotoTab(page, 'ziele');
    await openGoalsPage(page, 'stats');
    await expect(page).toHaveURL(/#ziele$/);
    await page.reload();
    await expect(stageLabel(page)).toContainText('Stufe:');
    await expect(tabPanel(page, 'ziele')).toBeVisible();
    await expect(subpage(page, 'stats')).toBeHidden();
    await expectFlat(page);
  });

  test('unbekannter Hash öffnet Nischen', async ({ page }) => {
    await page.goto('/#gibt-es-nicht');
    await expect(stageLabel(page)).toContainText('Stufe:');
    await expect(tabButton(page, 'nischen')).toHaveAttribute('aria-selected', 'true');
    await expect(tabPanel(page, 'nischen')).toBeVisible();
    // Der Hash wird berichtigt (ersetzt, kein neuer Verlaufseintrag).
    await expect(page).toHaveURL(/#nischen$/);
  });

  test('Landschaft per Hash vor der Freischaltung: Nischen, kein Reiter Landschaft', async ({ page }) => {
    await page.goto('/#landschaft');
    await expect(stageLabel(page)).toContainText('Stufe:');
    await expect(tabButton(page, 'nischen')).toHaveAttribute('aria-selected', 'true');
    await expect(tabButton(page, 'landschaft')).toBeHidden();
    await expect(tabPanel(page, 'landschaft')).toBeHidden();
    await expect(page).toHaveURL(/#nischen$/);
    // Ein späterer Hash-Wechsel auf die gesperrte Landschaft bleibt ebenso auf Nischen.
    await openTab(page, 'pflege');
    await page.evaluate(() => (location.hash = '#landschaft'));
    await expect(tabButton(page, 'nischen')).toHaveAttribute('aria-selected', 'true');
    await expect(tabPanel(page, 'landschaft')).toBeHidden();
    await expect(page).toHaveURL(/#nischen$/);
    // Tastatur überspringt den verborgenen Reiter: → von „Ziele“ springt an den Anfang.
    await openTab(page, 'ziele');
    await tabButton(page, 'ziele').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabButton(page, 'nischen')).toHaveAttribute('aria-selected', 'true');
    await expect(tabButton(page, 'nischen')).toBeFocused();
    await page.keyboard.press('End');
    await expect(tabButton(page, 'ziele')).toHaveAttribute('aria-selected', 'true');
  });
});

/*
 * Reduzierte Bewegung (C.3, E.2): Umblättern und Umschlag überblenden nur, es läuft keine
 * `rotateY`-Animation. Aufgezeichnet werden alle Animationen per Web Animations API
 * (`Element.animate`, Umblättern) und CSS (`animationstart`, Umschlag). Zur Gegenprobe läuft
 * derselbe Weg zuerst mit voller Bewegung – dort muss eine Drehung vorkommen.
 */
for (const viewport of [
  { name: 'Desktop', width: 1200, height: 700 },
  { name: 'mobil', width: 390, height: 844 },
]) {
  test(`Reduzierte Bewegung (${viewport.name}): Umblättern und Umschlag ohne rotateY`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __motionLog: string[] }).__motionLog = log;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, frames, options) {
        log.push(`animate ${JSON.stringify(frames)}`);
        return animate.call(this, frames, options);
      };
      document.addEventListener(
        'animationstart',
        (e) => {
          const target = e.target as Element;
          const sheet = [...document.styleSheets].flatMap((s) => {
            try {
              return [...s.cssRules];
            } catch {
              return [];
            }
          });
          const rule = sheet.find((r) => r instanceof CSSKeyframesRule && r.name === e.animationName) as CSSKeyframesRule | undefined;
          log.push(`css ${e.animationName} ${target.className} ${rule?.cssText ?? ''}`);
        },
        true,
      );
    });
    await seedV3(context, { totalGrowth: waypoint(14) + 1, niches: { hollows: ['owl'] } });
    const log = () => page.evaluate(() => (window as unknown as { __motionLog: string[] }).__motionLog.splice(0));

    /** Umschlag auf, Spielstand-Seite, zurück, zu; dann U:Tier und zurück. */
    async function walk(): Promise<void> {
      await openSavePage(page);
      await subpage(page, 'save').locator('[data-ref="bookmark"]').click();
      await expect(subpage(page, 'save')).toBeHidden();
      await page.locator('[data-ref="cover-close"]').click();
      await expect(cover(page)).toBeHidden();
      await openAnimal(page, 'hollows', 'owl');
      await back(page);
      await expect(subpage(page, 'animal')).toBeHidden();
      await albumAnimationsDone(page);
    }

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openGame(page);
    await log();
    await walk();
    expect((await log()).filter((line) => line.includes('rotateY')).length, 'Gegenprobe: volle Bewegung dreht').toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('body')).toHaveAttribute('data-motion', 'reduce');
    await walk();
    const lines = await log();
    // Es wurde überblendet (es lief also etwas), aber nichts dreht sich.
    expect(lines.some((line) => line.includes('opacity'))).toBe(true);
    expect(lines.filter((line) => line.includes('rotateY'))).toEqual([]);
  });
}
