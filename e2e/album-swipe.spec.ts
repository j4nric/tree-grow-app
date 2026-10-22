import type { BrowserContext, Locator, Page } from '@playwright/test';
import { animalPage, encounter, expect, openAnimal, openGame, openStack, seedV3, sticker, tabButton, tabPanel, test, waypoint } from './fixtures';

/**
 * Wisch-Zurück (docs/ALBUM_UI.md, C.2): Ein waagerechter Wisch nach rechts blättert eine
 * Unterseite zurück – über den Verlauf wie Lesezeichen und Escape. Senkrechtes Scrollen, die
 * Kartenreihe der Begegnung (`data-no-swipe`), der linke Bildschirmrand und Reiterseiten lösen
 * nichts aus. Touch-Emulation (390 × 844), Berührungen per CDP.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

interface Point {
  x: number;
  y: number;
}

/**
 * Wischt mit einem Finger von `from` nach `to` in `steps` Schritten. Die Zeitstempel der
 * Berührungen liegen fest `stepMs` auseinander (CDP `timestamp`), damit das Tempo nicht von
 * der Last der Testmaschine abhängt; dazwischen wartet der Test kurz auf einen Frame.
 */
async function swipe(page: Page, from: Point, to: Point, options: { steps?: number; stepMs?: number; during?: () => Promise<void> } = {}): Promise<void> {
  const steps = options.steps ?? 12;
  const stepMs = options.stepMs ?? 16;
  const cdp = await page.context().newCDPSession(page);
  const start = Date.now() / 1000;
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', i: number, p?: Point) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y) }] : [],
      timestamp: start + (i * stepMs) / 1000,
    });
  await touch('touchStart', 0, from);
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(16);
    await touch('touchMove', i, { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  }
  // Prüfungen mitten in der Geste (Finger liegt noch auf).
  await options.during?.();
  await touch('touchEnd', steps);
  await cdp.detach();
}

/** Mitte eines Elements (auf dem Bildschirm). */
async function center(locator: Locator): Promise<Point> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 400) };
}

const albumDepth = (page: Page) => page.evaluate(() => (history.state as { album?: number } | null)?.album ?? 0);

async function seedNiches(context: BrowserContext): Promise<void> {
  await seedV3(context, {
    totalGrowth: waypoint(14) + 1,
    niches: { roots: ['vole', 'earthworm'], edge: ['fox'], hollows: ['owl'] },
  });
}

test('Wisch nach rechts auf U:Tier blättert zurück (über den Verlauf)', async ({ page, context }) => {
  await seedNiches(context);
  await openGame(page);
  const sub = await openAnimal(page, 'hollows', 'owl');
  expect(await albumDepth(page)).toBe(1);
  const y = (await center(sub)).y;
  const main = page.locator('.spread-main');
  await swipe(page, { x: 90, y }, { x: 290, y: y + 10 }, {
    // Die Hauptansicht folgt dem Finger: sichtbar und gedreht, aber noch nicht bedienbar.
    during: async () => {
      await expect(main).toHaveClass(/turning/);
      await expect(main).not.toHaveClass(/turned-away/);
      expect(await main.evaluate((n) => (n as HTMLElement).style.transform)).toMatch(/rotateY\(-\d/);
      await expect(main).toHaveAttribute('inert', '');
    },
  });
  await expect(sub).toBeHidden();
  await expect(page).toHaveURL(/#nischen$/);
  await expect(tabPanel(page, 'nischen').locator('xpath=ancestor-or-self::*[@inert]')).toHaveCount(0);
  await expect(sticker(page, 'hollows', 'owl')).toBeFocused();
  // Verlauf und Stapel laufen nicht auseinander.
  await expect.poll(() => albumDepth(page)).toBe(0);
  // Die Seite ist wieder flach (keine Reste vom Mitführen).
  await expect(main).not.toHaveClass(/turning|turned-away/);
  expect(await main.evaluate((n) => (n as HTMLElement).style.transform)).toBe('');
});

test('Kurzer, langsamer Wisch schnappt zurück; schneller kurzer Wisch reicht', async ({ page, context }) => {
  await seedNiches(context);
  await openGame(page);
  const sub = await openAnimal(page, 'hollows', 'owl');
  const y = (await center(sub)).y;
  // 40 px in 400 ms: zu kurz und zu langsam.
  await swipe(page, { x: 120, y }, { x: 160, y }, { steps: 20, stepMs: 20 });
  await page.waitForTimeout(400);
  await expect(sub).toBeVisible();
  await expect(sub).not.toHaveAttribute('inert', '');
  await expect(page.locator('.spread-main')).toHaveClass(/turned-away/);
  await expect(page.locator('.spread-main')).not.toHaveClass(/turning/);
  expect(await albumDepth(page)).toBe(1);
  // 50 px in 45 ms (gut 1 px/ms): ein Schnipser.
  await swipe(page, { x: 120, y }, { x: 170, y }, { steps: 3, stepMs: 15 });
  await expect(sub).toBeHidden();
});

test('Senkrechtes Scrollen und der linke Bildschirmrand lösen nichts aus', async ({ page, context }) => {
  await seedNiches(context);
  await openGame(page);
  const sub = await openAnimal(page, 'hollows', 'owl');
  const { x } = await center(sub);
  // Etwas schräg, aber deutlich senkrecht: Scrollen.
  await swipe(page, { x, y: 650 }, { x: x + 40, y: 250 });
  await page.waitForTimeout(400);
  await expect(sub).toBeVisible();
  expect(await albumDepth(page)).toBe(1);
  // Vom linken Rand (iOS-Rand-Wischen gehört dem Browser).
  await swipe(page, { x: 8, y: 400 }, { x: 250, y: 400 });
  await page.waitForTimeout(400);
  await expect(sub).toBeVisible();
  // Nach links: nichts.
  await swipe(page, { x: 300, y: 400 }, { x: 80, y: 400 });
  await page.waitForTimeout(400);
  await expect(animalPage(page)).toBeVisible();
  expect(await albumDepth(page)).toBe(1);
});

test('Kartenreihe der Begegnung: Wischen blättert Karten, nicht zurück', async ({ page, context }) => {
  await seedV3(context, {
    totalGrowth: waypoint(12) + 1,
    seeds: 100,
    pendingEncounters: [{ type: 'animal', cards: ['bluetit', 'robin', 'squirrel'], rerolls: 0 }],
  });
  await openGame(page);
  await openStack(page);
  const row = encounter(page).locator('.encounter-cards');
  await expect(row).toHaveAttribute('data-no-swipe', '');
  const box = (await row.boundingBox())!;
  const y = box.y + Math.min(box.height / 2, 200);
  // Nach links wischen scrollt die Reihe weiter.
  await swipe(page, { x: 320, y }, { x: 80, y });
  await expect.poll(() => row.evaluate((n) => n.scrollLeft)).toBeGreaterThan(0);
  // Nach rechts (die Geste für „Zurück“) scrollt zurück, die Seite bleibt.
  await swipe(page, { x: 60, y }, { x: 330, y });
  await page.waitForTimeout(400);
  await expect(encounter(page)).toBeVisible();
  expect(await albumDepth(page)).toBe(1);
});

test('Reiterseite: Wischen wechselt keinen Reiter und blättert nichts', async ({ page, context }) => {
  await seedNiches(context);
  await openGame(page);
  const niches = tabPanel(page, 'nischen');
  const { y } = await center(niches);
  await swipe(page, { x: 60, y }, { x: 330, y });
  await swipe(page, { x: 330, y }, { x: 60, y });
  await page.waitForTimeout(400);
  await expect(niches).toBeVisible();
  await expect(tabButton(page, 'nischen')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/#nischen$/);
  expect(await albumDepth(page)).toBe(0);
});

test('Reduzierte Bewegung: Wisch blättert ohne Mitführen zurück', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedNiches(context);
  await openGame(page);
  const sub = await openAnimal(page, 'roots', 'vole');
  const y = (await center(sub)).y;
  const main = page.locator('.spread-main');
  await swipe(page, { x: 90, y }, { x: 290, y }, {
    // Ohne Mitführen: Die Hauptansicht bleibt weggedreht, bis der Finger loslässt.
    during: async () => {
      await expect(main).toHaveClass(/turned-away/);
      expect(await main.evaluate((n) => (n as HTMLElement).style.transform)).toBe('');
    },
  });
  await expect(sub).toBeHidden();
  await expect.poll(() => albumDepth(page)).toBe(0);
});
