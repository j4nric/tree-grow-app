/**
 * Reiter „Ziele“ – „Was haben wir vor?“ (docs/ALBUM_UI.md, B.4).
 * Übergang (Schritt 1): Tagesziele und der bisherige Bereich „Neuer Zyklus“. Schritt 9
 * ersetzt sie.
 */
import { el } from '../../dom';
import type { PageEnv, TabPage } from './registry';
import { createTabPanel } from './tab-pages';

export interface GoalsPage extends TabPage {
  readonly daily: HTMLElement;
  readonly cycle: HTMLElement;
}

export function createGoalsPage(_env: PageEnv): GoalsPage {
  const page = createTabPanel('goals');
  const daily = el('div', 'legacy-mount panel');
  daily.id = 'daily';
  const cycle = el('div', 'legacy-mount panel');
  cycle.id = 'cycle';
  page.body.append(daily, cycle);
  return { page, daily, cycle };
}
