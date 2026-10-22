/**
 * Rückkehr-Bericht in der Seitenleiste (Playtest Phase 6): kleine, schließbare Karte oben im
 * Panel mit der Kurzfassung der Rückkehr und einem Knopf „Details“, der alle Punkte
 * aufklappt (Begrüßung, Mittelwetter, Stammgäste, Erfolge, Tagesziele, Landschaft …).
 * Mobil liegt die Karte direkt unter der Szene, am Desktop oben in der Seitenleiste – im
 * Fluss der Seite, sie verdeckt also nichts.
 *
 * Bedienung: echte Knöpfe (Tastatur und Touch, ≥ 44 px). „Details“ klappt auf
 * (aria-expanded) und setzt den Fokus auf die Liste, damit Screenreader sie vorlesen;
 * Escape klappt wieder zu (Fokus zurück auf „Details“). „Schließen“ blendet die Karte aus
 * und gibt den Fokus an `fallbackFocus` (die Überschrift der Seitenleiste).
 *
 * Die Karte selbst ist keine Live-Region – angesagt wird die Kurzfassung über den Toast
 * (role="status"), sonst käme sie doppelt. Inhalte nur per textContent.
 */
import { el, setAttr, setText } from './dom';
import { prefersReducedMotion } from './feedback';
import type { ReturnReportView } from './return-report-view';

export interface ReturnReportPanel {
  /** Zeigt einen neuen Bericht (zugeklappt) – ersetzt den alten. */
  show(view: ReturnReportView): void;
  hide(): void;
  readonly element: HTMLElement;
  readonly open: boolean;
}

export function createReturnReportPanel(root: HTMLElement, fallbackFocus?: HTMLElement | null): ReturnReportPanel {
  const section = el('section', 'return-report');
  section.dataset.ref = 'return-report';
  const title = el('h2', 'return-report-title', 'Rückkehr-Bericht');
  title.id = 'return-report-title';
  section.setAttribute('aria-labelledby', title.id);

  const summary = el('p', 'return-report-summary');
  summary.dataset.ref = 'return-report-summary';

  const actions = el('div', 'return-report-actions');
  const toggle = el('button', 'return-report-toggle', 'Details');
  toggle.type = 'button';
  toggle.dataset.ref = 'return-report-details';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'return-report-list');
  const close = el('button', 'return-report-close');
  close.type = 'button';
  close.dataset.ref = 'return-report-close';
  close.setAttribute('aria-label', 'Rückkehr-Bericht schließen');
  const closeIcon = el('span', '', '✕');
  closeIcon.setAttribute('aria-hidden', 'true');
  close.append(closeIcon);
  actions.append(toggle, close);

  const list = el('ul', 'return-report-list');
  list.id = 'return-report-list';
  list.dataset.ref = 'return-report-list';
  list.tabIndex = -1;
  list.setAttribute('aria-label', 'Details zur Rückkehr');
  list.hidden = true;

  const head = el('div', 'return-report-head');
  head.append(title, actions);
  section.append(head, summary, list);
  section.hidden = true;
  root.append(section);

  let shownDetails: readonly string[] = [];

  function setExpanded(expanded: boolean): void {
    list.hidden = !expanded;
    setAttr(toggle, 'aria-expanded', String(expanded));
  }

  toggle.addEventListener('click', () => {
    const expand = toggle.getAttribute('aria-expanded') !== 'true';
    setExpanded(expand);
    if (expand) {
      list.focus({ preventScroll: true });
      list.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  });

  close.addEventListener('click', hide);

  section.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || toggle.getAttribute('aria-expanded') !== 'true') return;
    event.preventDefault();
    setExpanded(false);
    toggle.focus();
  });

  /** Liegt der Fokus in `node`? (Dann darf es nicht einfach verschwinden.) */
  const focusIn = (node: HTMLElement) => node.contains(document.activeElement);

  function hide(): void {
    // Fokus nicht mit der Karte verschwinden lassen (sonst landet er auf body).
    if (focusIn(section)) fallbackFocus?.focus({ preventScroll: true });
    section.hidden = true;
    setExpanded(false);
  }

  return {
    show(view) {
      setText(summary, view.headline);
      // Liste nur neu bauen, wenn sich die Punkte ändern (selten: je Rückkehr).
      if (view.details.join('\n') !== shownDetails.join('\n')) {
        shownDetails = [...view.details];
        list.replaceChildren(...view.details.map((text) => el('li', 'return-report-item', text)));
      }
      // Fokus in der aufgeklappten Liste: vor dem Zuklappen auf „Details“ setzen.
      if (focusIn(list)) toggle.focus({ preventScroll: true });
      setExpanded(false);
      // Neu einblenden: kurze Einblend-Animation (CSS, entfällt bei reduzierter Bewegung).
      section.classList.remove('fresh');
      section.hidden = false;
      void section.offsetWidth;
      section.classList.add('fresh');
    },
    hide,
    element: section,
    get open() {
      return !section.hidden;
    },
  };
}
