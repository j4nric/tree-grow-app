/**
 * Reiter „Landschaft“ – „Unsere Wälder“ (docs/ALBUM_UI.md, B.5); erst nach der Freischaltung.
 * Übergang (Schritt 1): die bisherige Karte aus dem Bereich „Neuer Zyklus“ (cycle-panel.ts
 * steuert sie weiter, das Ziel gilt für den Knopf im Reiter „Ziele“). Schritt 10 ersetzt sie.
 */
import { el } from '../../dom';
import type { PageEnv, TabPage } from './registry';
import { createTabPanel } from './tab-pages';

export interface LandscapePage extends TabPage {
  readonly landscape: HTMLElement;
}

export function createLandscapePage(_env: PageEnv): LandscapePage {
  const page = createTabPanel('landscape');
  const landscape = el('div', 'legacy-mount panel');
  page.body.append(landscape);
  return { page, landscape };
}
