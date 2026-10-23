import type { BrowserContext, Page } from '@playwright/test';
import { COMMUNITIES } from '../src/content/communities';
import { V1_KEEPSAKE_ID } from '../src/content/memory';
import { PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { createInitialState } from '../src/core/state';
import { expect, gotoTab, seedRaw, tabPanel, test } from './fixtures';

/**
 * Seitensuche (R3, Phase 9 / 1b): Aufgeschobene Blöcke sind `hidden="until-found"` – gesperrt mit
 * geschätzter Höhe, aber durchsuchbar. Findet die Suche etwas darin (`beforematch`), ist sofort
 * alles aufgedeckt. Strg+F lässt sich nicht fernsteuern; ein Textfragment (`#:~:text=`) nimmt
 * denselben Weg. Die Headless-Shell kann keine Textfragmente – darum das volle Chromium
 * (`channel: 'chromium'`, kommt mit `playwright install chromium`).
 */
test.use({ channel: 'chromium' });

const panel = (page: Page) => tabPanel(page, 'arten');

/** Hain mit vollem Tagebuch (wie album-species.spec.ts). */
async function seedFullJournal(context: BrowserContext): Promise<void> {
  const state = createInitialState(Date.now(), 4242);
  const grove = STAGES.findIndex((s) => s.id === 'grove');
  state.stage = grove;
  state.waypoint = STAGES[grove]!.waypoint;
  state.meta.journal.species = SPECIES.map((s) => s.id);
  state.meta.journal.plants = PLANTS.map((p) => p.id);
  state.meta.journal.communities = COMMUNITIES.map((c) => c.id);
  state.meta.journal.keepsakes = [V1_KEEPSAKE_ID];
  await seedRaw(context, state, 0);
}

test('gesperrt mit Platzhalter-Höhe, Textfragment deckt alles auf', async ({ page, context }) => {
  // Aufdecken in Leerlaufzeit anhalten: Die Blöcke bleiben gesperrt, bis die Suche kommt.
  await context.addInitScript(() => {
    (window as { requestIdleCallback?: unknown }).requestIdleCallback = () => 0;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await seedFullJournal(context);
  await gotoTab(page, 'arten');
  const deferred = panel(page).locator('[data-deferred]');
  await expect.poll(() => deferred.count()).toBeGreaterThan(3);
  const blocks = await deferred.evaluateAll((els) =>
    els.map((el) => ({
      hidden: el.getAttribute('hidden'),
      cv: getComputedStyle(el).contentVisibility,
      height: (el as HTMLElement).offsetHeight,
      estimate: parseFloat((el as HTMLElement).style.getPropertyValue('--deferred-height')),
    })),
  );
  for (const b of blocks) {
    expect(b.hidden).toBe('until-found');
    expect(b.cv).toBe('hidden');
    // Platzhalter: genau die geschätzte Höhe (Seitenlänge und Scroll-Lage stimmen).
    expect(b.height).toBe(b.estimate);
  }
  const memories = panel(page).locator('#species-memories-title');
  await expect(memories).not.toBeInViewport();

  await page.goto('/#arten:~:text=Erinnerungen');
  await expect(deferred).toHaveCount(0);
  await expect(panel(page).locator('[hidden="until-found"]')).toHaveCount(0);
  await expect(memories).toBeInViewport();
});
