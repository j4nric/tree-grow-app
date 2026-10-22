/**
 * Reiter „Nischen“ – „Wer wohnt wo?“ (docs/ALBUM_UI.md, B.1).
 * Übergang (Schritt 1): Hier hängt die bisherige Ökosystem-Übersicht (ohne ihren Kopf –
 * Stufe, Raten und Fortschritt stehen links im Album). Schritt 5 ersetzt sie durch Sticker.
 */
import { el } from '../../dom';
import type { PageEnv, TabPage } from './registry';
import { createTabPanel } from './tab-pages';

export interface NichesPage extends TabPage {
  /** Wurzel für die Ökosystem-Übersicht (ecosystem-panel.ts). */
  readonly ecosystem: HTMLElement;
}

export function createNichesPage(_env: PageEnv): NichesPage {
  const page = createTabPanel('niches');
  const ecosystem = el('div', 'legacy-mount panel');
  ecosystem.id = 'ecosystem';
  page.body.append(ecosystem);
  return { page, ecosystem };
}
