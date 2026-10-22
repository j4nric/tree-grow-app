/**
 * Gemeinsames Grundgerüst der Reiterseiten (Rolle `tabpanel`, feste Seitenzahl).
 */
import { createPage, type Page } from '../page';
import { TAB_LABELS, initialNav, pageNumber, type TabId } from '../nav';

/** Seitenkopf je Reiter: Überschrift als Frage (docs/ALBUM_UI.md, B.1–B.5). */
export const TAB_TITLES: Readonly<Record<TabId, string>> = {
  niches: 'Wer wohnt wo?',
  species: 'Wer war schon da?',
  care: 'Was tun wir für den Wald?',
  goals: 'Was haben wir vor?',
  landscape: 'Unsere Wälder',
};

export function createTabPanel(tab: TabId): Page {
  const page = createPage({ kind: tab, title: TAB_TITLES[tab], number: pageNumber(initialNav(tab)), className: 'album-tabpanel' });
  page.element.id = `tabpanel-${tab}`;
  page.element.setAttribute('role', 'tabpanel');
  page.element.dataset.tab = tab;
  page.element.setAttribute('aria-label', TAB_LABELS[tab]);
  page.element.removeAttribute('aria-labelledby');
  return page;
}
