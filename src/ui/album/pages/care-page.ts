/**
 * Reiter „Pflege“ – „Was tun wir für den Wald?“ (docs/ALBUM_UI.md, B.3).
 * Übergang (Schritt 1): aktive Boni und die bisherige Pflege-Liste. Schritt 8 ersetzt sie.
 */
import { el } from '../../dom';
import type { PageEnv, TabPage } from './registry';
import { createTabPanel } from './tab-pages';

export interface CarePage extends TabPage {
  readonly bonuses: HTMLElement;
  readonly care: HTMLElement;
}

export function createCarePage(_env: PageEnv): CarePage {
  const page = createTabPanel('care');
  const bonuses = el('div', 'legacy-mount panel');
  bonuses.id = 'bonuses';
  const care = el('div', 'legacy-mount panel');
  care.id = 'care';
  page.body.append(bonuses, care);
  return { page, bonuses, care };
}
