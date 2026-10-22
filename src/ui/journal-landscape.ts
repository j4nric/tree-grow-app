/**
 * Tagebuch-Teil „Landschaft“ (DESIGN_V2.md 24.11, docs/ALBUM_UI.md A.10 #114): Zusammenfassung,
 * Hähersaat, gegründete Wälder mit ihren Angaben und die Korridore.
 *
 * Übergang (Phase 8, Schritt 7): Bis Schritt 7 war das ein Reiter im Dialog „Naturtagebuch“.
 * Der Dialog ist durch den Album-Reiter „Arten“ ersetzt; dieser Teil hängt bis Schritt 10 als
 * Abschnitt „Unsere Wälder“ im Reiter „Landschaft“ (eingehängt in album/legacy.ts). Schritt 10
 * übernimmt ihn in R:Landschaft bzw. U:Standort und löscht die Datei samt CSS (`.journal-*`
 * in style.css).
 *
 * Reine Darstellung von `JournalLandscapeView`; neu gebaut nur, wenn sich die Ansicht ändert.
 */
import { el } from './dom';
import { hyphenate } from './hyphenate';
import type { JournalLandscapeRowView, JournalLandscapeView, JournalSiteView } from './view-model';

export interface JournalLandscapeSection {
  readonly element: HTMLElement;
  /** Neue Ansicht (null: Landschaft gesperrt – Abschnitt leer und verborgen). */
  update(view: JournalLandscapeView | null): void;
}

/** Beschreibungsliste aus Zeilen „Bezeichnung – Wert“ (Angaben zu einem Wald, Hähersaat). */
function rowList(rows: readonly JournalLandscapeRowView[], className: string): HTMLDListElement {
  const dl = el('dl', className);
  for (const r of rows) {
    const wrap = el('div', `${className}-row`);
    wrap.dataset.row = r.key;
    wrap.append(el('dt', '', r.label), el('dd', '', hyphenate(r.value)));
    dl.append(wrap);
  }
  return dl;
}

function siteItem(s: JournalSiteView): HTMLElement {
  const li = el('li', `journal-entry discovered journal-site${s.active ? ' current' : ''}${s.ancient ? ' ancient' : ''}`);
  li.dataset.site = s.id;
  const icon = el('span', 'journal-icon', s.icon);
  icon.setAttribute('aria-hidden', 'true');
  const body = el('div', 'journal-body');
  body.append(el('h4', 'journal-name', hyphenate(s.name)));
  if (s.active) {
    const badge = el('p', 'journal-tree-status current');
    const star = el('span', '', '★ ');
    star.setAttribute('aria-hidden', 'true');
    badge.append(star, 'hier wächst dein Wald');
    body.append(badge);
  }
  if (s.forestType) body.append(el('p', 'journal-facts', hyphenate(s.forestType)));
  li.append(icon, body, rowList(s.rows, 'journal-site-facts'));
  return li;
}

export function createJournalLandscapeSection(): JournalLandscapeSection {
  const element = el('section', 'journal-landscape');
  element.dataset.ref = 'journal-landscape';
  element.setAttribute('aria-labelledby', 'journal-landscape-title');
  element.hidden = true;
  let signature = '';

  function update(view: JournalLandscapeView | null): void {
    const next = JSON.stringify(view);
    if (next === signature) return;
    signature = next;
    element.hidden = view === null;
    if (!view) {
      element.replaceChildren();
      return;
    }
    const title = el('h3', 'journal-section-title', 'Unsere Wälder');
    title.id = 'journal-landscape-title';
    const summary = el('p', 'journal-landscape-summary', view.summary);
    summary.dataset.ref = 'journal-landscape-summary';
    const seedsTitle = el('h4', 'journal-section-title', '🪶 Hähersaat');
    seedsTitle.id = 'journal-landscape-seeds-title';
    const seeds = rowList(view.jaySeeds, 'journal-seeds');
    seeds.dataset.ref = 'journal-jay-seeds';
    seeds.setAttribute('aria-labelledby', seedsTitle.id);
    const seedsNote = el('p', 'journal-text', view.jaySeedsNote);
    const sitesTitle = el('h4', 'journal-section-title', 'Wälder');
    sitesTitle.id = 'journal-landscape-sites-title';
    const sites = el('ul', 'journal-grid journal-sites');
    sites.setAttribute('aria-labelledby', sitesTitle.id);
    sites.append(...view.sites.map(siteItem));
    const hint = view.sitesHint ? [el('p', 'journal-progress', view.sitesHint)] : [];
    const corridorTitle = el('h4', 'journal-section-title', 'Korridore');
    corridorTitle.id = 'journal-landscape-corridors-title';
    let corridors: HTMLElement;
    if (view.corridors.length === 0) {
      corridors = el('p', 'journal-empty', 'Noch keine Korridore – der erste entsteht mit der Gründung eines Waldes.');
    } else {
      corridors = el('ul', 'journal-corridors');
      corridors.setAttribute('aria-labelledby', corridorTitle.id);
      corridors.append(
        ...view.corridors.map((c) => {
          const li = el('li', 'journal-corridor');
          li.dataset.corridor = c.id;
          const icon = el('span', 'journal-corridor-icon', c.icon);
          icon.setAttribute('aria-hidden', 'true');
          const text = el('span', 'journal-corridor-text');
          text.append(
            el('strong', 'journal-corridor-name', hyphenate(c.name)),
            el('span', 'journal-corridor-ends', hyphenate(c.ends)),
            el('span', 'journal-corridor-note', c.note),
          );
          li.append(icon, text);
          return li;
        }),
      );
    }
    element.replaceChildren(title, summary, seedsTitle, seeds, seedsNote, sitesTitle, sites, ...hint, corridorTitle, corridors);
  }

  return { element, update };
}
