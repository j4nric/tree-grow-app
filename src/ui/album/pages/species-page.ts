/**
 * Reiter „Arten“ – „Wer war schon da?“ (docs/ALBUM_UI.md, B.2).
 * Übergang (Schritt 1): Knopf zum bisherigen Naturtagebuch-Dialog. Schritt 7 ersetzt ihn
 * durch das Sticker-Raster.
 */
import { el } from '../../dom';
import type { PageEnv, TabPage } from './registry';
import { createTabPanel } from './tab-pages';

export interface SpeciesPage extends TabPage {
  /** Wurzel für den Knopf „📖 Naturtagebuch“ (journal-dialog.ts). */
  readonly journal: HTMLElement;
}

export function createSpeciesPage(_env: PageEnv): SpeciesPage {
  const page = createTabPanel('species');
  const journal = el('div', 'legacy-mount panel');
  journal.id = 'journal';
  page.body.append(journal);
  return { page, journal };
}
