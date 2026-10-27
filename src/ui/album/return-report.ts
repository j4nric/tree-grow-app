/**
 * Rückkehr-Bericht im Album (docs/ALBUM_UI.md, A.11 #116 und C.8): Zettel „Während du weg
 * warst …“ auf der linken Seite (Desktop) bzw. unter den Etiketten (mobil) mit der
 * Kurzfassung, „Details ›“ blättert zur Unterseite mit allen Punkten, „Abheften“ blendet den
 * Zettel aus. Die Regeln, wann ein Bericht kommt, ersetzt wird oder verschwindet, bleiben in
 * main.ts (`showReturnReport` / `hideReturnReport`).
 *
 * Der Bericht endet mit der Zielzeile (DESIGN_V2.md 28.7/28.9, Phase 11, 4c): am Zettel ein Knopf
 * „🎯 Genug für 6 Ausbaustufen ›“ bzw. „🎯 Nächstes: … ›“, auf der Unterseite derselbe Punkt mit
 * Preis als letzte Zeile und „Zum Ziel ›“. Beide springen wie die Zielzeile (album/index.ts).
 *
 * Der Zettel ist keine Live-Region – angesagt wird die Kurzfassung über die Stempelschicht
 * (role="status"), sonst käme sie doppelt. Inhalte nur per textContent; die Liste wird nur
 * bei einem neuen Bericht neu gebaut.
 */
import { el, setAttr, setText } from '../dom';
import { restartAnimation } from '../feedback';
import type { ReturnReportView } from '../return-report-view';
import type { ReturnGoalView } from '../upgrade-view';
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
  /** Ende des Berichts: Zielzeile bzw. „Genug für N Ausbaustufen“ (null = ohne Ziel). */
  setGoal(view: ReturnGoalView | null): void;
  /** Zettel ausblenden (Abheften oder spätere Rückkehr ohne Bericht). */
  hide(): void;
  readonly open: boolean;
}

/** Beginnt der Punkt schon mit einem Symbol? */
const OWN_ICON = /^\p{Extended_Pictographic}/u;

export function createReturnReport(env: PageEnv, focusFallback: () => HTMLElement | null, onGoal: () => void): ReturnReport {
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
  const goal = el('button', 'return-slip-goal');
  goal.type = 'button';
  goal.dataset.ref = 'return-report-goal';
  goal.hidden = true;
  // Kurz („Genug für 6 Ausbaustufen ›“) bzw. auf der Doppelseite ganz – dort ersetzt der Knopf die
  // Zielzeile im Kopf, solange der Zettel offen ist (Platz fürs Polaroid, return-report.css).
  const goalShort = el('span', 'return-slip-goal-short');
  const goalFull = el('span', 'return-slip-goal-full');
  goal.append(goalShort, goalFull);
  goal.addEventListener('click', onGoal);
  slip.append(tape, title, summary, goal, actions);
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
  // Letzter Punkt: das Ziel (bleibt beim Neubau der Liste am Ende).
  const goalItem = el('li', 'return-page-item return-page-item-own return-page-goal');
  goalItem.dataset.ref = 'return-report-goal-item';
  goalItem.hidden = true;
  const pageActions = el('div', 'return-page-actions');
  const file = el('button', 'return-page-file', 'Abheften');
  file.type = 'button';
  file.dataset.ref = 'return-report-file';
  const pageGoal = el('button', 'return-page-goal-jump', 'Zum Ziel ›');
  pageGoal.type = 'button';
  pageGoal.dataset.ref = 'return-report-goal-jump';
  pageGoal.hidden = true;
  pageGoal.addEventListener('click', onGoal);
  pageActions.append(pageGoal, file);
  page.body.append(lead, list, pageActions);

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
        list.replaceChildren(
          ...view.details.map((text) => {
            const item = el('li', 'return-page-item', text);
            // Eigenes Symbol am Anfang (🏅, 🎴 …): kein 🌿 davor (K14).
            if (OWN_ICON.test(text)) item.classList.add('return-page-item-own');
            return item;
          }),
          goalItem,
        );
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
    setGoal(view) {
      goal.hidden = view === null;
      goalItem.hidden = view === null;
      pageGoal.hidden = view === null;
      if (!view) return;
      setText(goalShort, view.text);
      setText(goalFull, view.full);
      setAttr(goal, 'aria-label', view.aria);
      setText(goalItem, view.detail);
      setAttr(pageGoal, 'aria-label', view.aria);
    },
    hide,
    get open() {
      return !slip.hidden;
    },
  };
}
