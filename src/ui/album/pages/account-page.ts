/**
 * Unterseite „Konto“ aus dem Umschlag (docs/ALBUM_UI.md, B.7 und A.12 #130): Der Abschnitt aus
 * account-panel.ts hängt sich wie bisher über `mount` ein – jetzt hier statt in den
 * Einstellungen. Ohne Sync-Adresse (VITE_SYNC_URL) wird nie etwas eingehängt; dann bleibt
 * auch der Eintrag im Umschlag verborgen (cover.ts).
 */
import { createBookmark } from '../bookmark';
import { createPage } from '../page';
import { initialNav, pageNumber } from '../nav';
import type { PageEnv, Subpage } from './registry';
import './forms.css';
import './account-page.css';

export interface AccountPage extends Subpage {
  /** Konto-Abschnitt (account-panel.ts) einhängen. */
  mount(section: HTMLElement): void;
}

export function createAccountPage(env: PageEnv): AccountPage {
  const page = createPage({
    kind: 'account',
    title: 'Konto',
    meta: 'Sync zwischen Geräten',
    number: pageNumber({ ...initialNav(), cover: true, stack: [{ kind: 'account' }] }),
    className: 'album-subpage account-page',
  });
  const bookmark = createBookmark(() => env.back());
  bookmark.setLabel('Umschlag');
  page.element.prepend(bookmark.element);
  return {
    page,
    bookmark,
    mount(section) {
      page.body.append(section);
    },
  };
}
