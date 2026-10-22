/**
 * Rückkehr-Bericht im Album (docs/ALBUM_UI.md, A.11 #116 und C.8): Zettel „Während du weg
 * warst …“ auf der linken Seite (Desktop) bzw. unter den Etiketten (mobil) mit der
 * Kurzfassung, „Details ›“ blättert zur Unterseite mit allen Punkten, „Abheften“ blendet den
 * Zettel aus. Die Regeln, wann ein Bericht kommt, ersetzt wird oder verschwindet, bleiben in
 * main.ts (`showReturnReport` / `hideReturnReport`).
 *
 * Der Zettel ist keine Live-Region – angesagt wird die Kurzfassung über die Stempelschicht
 * (role="status"), sonst käme sie doppelt. Inhalte nur per textContent; die Liste wird nur
 * bei einem neuen Bericht neu gebaut.
 */
import { el, setText } from '../dom';
import { restartAnimation } from '../feedback';
import type { ReturnReportView } from '../return-report-view';
import { createBookmark } from './bookmark';
import { createPage } from './page';
import { initialNav, pageNumber } from './nav';
import type { PageEnv, Subpage } from './pages/registry';
import './return-report.css';

export interface ReturnReport {
  /** Zettel auf der linken Seite. */
  readonly slip: HTMLElement;
  /** Unterseite „Rückkehr-Bericht“ (U:Rückkehr-Bericht). */
  readonly subpage: Subpage;
  /** Neuer Bericht: ersetzt den alten, Zettel wieder sichtbar. */
  show(view: ReturnReportView): void;
  /** Zettel ausblenden (Abheften oder spätere Rückkehr ohne Bericht). */
  hide(): void;
  readonly open: boolean;
}

export function createReturnReport(env: PageEnv, focusFallback: () => HTMLElement | null): ReturnReport {
  // --- Zettel ---------------------------------------------------------------------------
  const slip = el('section', 'return-slip');
  slip.dataset.ref = 'return-report';
  const tape = el('span', 'return-slip-tape');
  tape.setAttribute('aria-hidden', 'true');
  const title = el('h2', 'return-slip-title', 'Während du weg warst …');
  title.id = 'return-slip-title';
  slip.setAttribute('aria-labelledby', title.id);
  const summary = el('p', 'return-slip-summary');
  summary.dataset.ref = 'return-report-summary';
  const actions = el('div', 'return-slip-actions');
  const details = el('button', 'return-slip-details', 'Details ›');
  details.type = 'button';
  details.dataset.ref = 'return-report-details';
  details.setAttribute('aria-label', 'Rückkehr-Bericht: Details');
  const close = el('button', 'return-slip-close', 'Abheften');
  close.type = 'button';
  close.dataset.ref = 'return-report-close';
  close.setAttribute('aria-label', 'Rückkehr-Bericht abheften');
  actions.append(details, close);
  slip.append(tape, title, summary, actions);
  slip.hidden = true;

  // --- Unterseite -----------------------------------------------------------------------
  const page = createPage({
    kind: 'return-report',
    title: 'Rückkehr-Bericht',
    number: pageNumber({ ...initialNav(), stack: [{ kind: 'return-report' }] }),
    className: 'album-subpage return-page',
  });
  const bookmark = createBookmark(() => env.back());
  page.element.prepend(bookmark.element);
  const lead = el('p', 'return-page-lead', 'Während du weg warst …');
  const list = el('ul', 'return-page-list');
  list.dataset.ref = 'return-report-list';
  list.setAttribute('aria-label', 'Details zur Rückkehr');
  const file = el('button', 'return-page-file', 'Abheften');
  file.type = 'button';
  file.dataset.ref = 'return-report-file';
  page.body.append(lead, list, file);

  let shownDetails = '';

  details.addEventListener('click', () => env.open({ kind: 'return-report' }));
  close.addEventListener('click', () => hide());
  file.addEventListener('click', () => {
    hide();
    env.back();
  });

  function hide(): void {
    // Fokus nicht mit dem Zettel verschwinden lassen (sonst landet er auf body).
    if (slip.contains(document.activeElement)) focusFallback()?.focus({ preventScroll: true });
    slip.hidden = true;
  }

  return {
    slip,
    subpage: { page, bookmark },
    show(view) {
      setText(summary, view.headline);
      const key = view.details.join('\n');
      if (key !== shownDetails) {
        shownDetails = key;
        list.replaceChildren(...view.details.map((text) => el('li', 'return-page-item', text)));
      }
      slip.hidden = false;
      restartAnimation(slip, 'fresh');
      // Doppelseite: Die linke Seite scrollt in sich – den Zettel ins Bild holen (nur dort).
      // Erst nach dem nächsten Auffrischen (Etiketten und Stufenleiste füllen sich noch).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const left = slip.closest<HTMLElement>('.spread-left');
          if (slip.hidden || !left || getComputedStyle(left).overflowY !== 'auto') return;
          if (left.scrollHeight > left.clientHeight) slip.scrollIntoView({ block: 'nearest' });
        }),
      );
    },
    hide,
    get open() {
      return !slip.hidden;
    },
  };
}
