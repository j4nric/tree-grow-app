/**
 * Unterseite „Begegnung“ (docs/ALBUM_UI.md, A.6 #68–80, C.7 und G-8) – ersetzt den
 * Kartenwahl-Dialog. Der Zettelstapel blättert hierher um; die Seite zeigt die vorderste
 * Begegnung: Kopf als Zettel, Karten aus `encounter-cards.ts`, „Neu würfeln“ und
 * „Ablehnen“. Das Lesezeichen heißt „‹ Später“ und legt die Begegnung zurück (wie Escape
 * und Browser-Zurück).
 *
 * Nach einer Entscheidung kommt die nächste ohne neues Umblättern (der Inhalt wird
 * überblendet), bis keine mehr wartet – dann blättert die Seite von selbst zurück.
 *
 * Reine Darstellung: Die Karten kommen aus `toEncounterView`, der Wildwechsel-Weg aus
 * `deps.encounterMark()`; Entscheidungen gehen über `deps.actions.encounter` an main.ts.
 */
import { evaluate } from '../../../core/formulas';
import { encounterActionKey, toEncounterView } from '../../adapters';
import { createEncounterSheet } from '../../encounter-cards';
import { restartAnimation, prefersReducedMotion } from '../../feedback';
import { applyWildwechselMark } from '../../wildwechsel-view';
import { createBookmark } from '../bookmark';
import { initialNav, pageNumber } from '../nav';
import { createPage, type Page } from '../page';
import type { PageEnv, Subpage } from './registry';
import './subpage.css';
import './encounter-page.css';

/** Beschriftung des Lesezeichens: „Später“ legt die Begegnung zurück (A.6 #78). */
export const LATER_LABEL = 'Später';

export interface EncounterPage extends Subpage {
  /** Ansicht neu bauen (z. B. nach einer Aktion, neuer Stufe, Zahlenformat). */
  invalidate(): void;
  /** Die vorderste Begegnung ist erledigt (neue Karten, auch wenn sie gleich aussehen). */
  resolved(): void;
}

export function createEncounterPage(env: PageEnv): EncounterPage {
  const deps = env.deps;
  const base = createPage({
    kind: 'encounter',
    title: 'Begegnung',
    number: pageNumber({ ...initialNav(), stack: [{ kind: 'encounter' }] }),
    className: 'album-subpage encounter-page',
  });
  const bookmark = createBookmark(() => env.back());
  base.element.prepend(bookmark.element);

  const sheet = createEncounterSheet(deps.actions.encounter, { title: base.title });
  // Kopf als Zettel: Die Seitenüberschrift steht darin (Fokusziel nach dem Umblättern).
  base.header.replaceChildren(sheet.head);
  base.header.classList.add('enc-page-head');
  base.body.append(sheet.element);

  /**
   * Nach dem Umblättern bekommt die erste wählbare Karte den Fokus (wie bisher im Dialog:
   * Pfeiltasten und Enter wirken sofort), sonst die Überschrift.
   */
  const page: Page = {
    ...base,
    focusTitle() {
      if (!sheet.focusFirst()) base.focusTitle();
    },
  };

  let dirty = true;
  /** Zählt erledigte Begegnungen – zwei gleich aussehende nacheinander gelten als verschieden. */
  let serial = 0;
  let shownActionKey: string | null = null;
  let shownQueued = -1;
  let shownSerial = -1;
  /** Zurückblättern läuft schon (Stapel leer) – nicht jeden Frame erneut auslösen. */
  let leaving = false;
  let opened = false;

  deps.preferences.onChange(() => (dirty = true));

  function setLaterLabel(): void {
    bookmark.setLabel(LATER_LABEL);
    bookmark.element.setAttribute('aria-label', 'Später – Begegnung zurücklegen');
  }

  /** Zeigt die vorderste wartende Begegnung; ohne Begegnung blättert die Seite zurück. */
  function refresh(): void {
    if (!opened) return;
    const state = deps.state();
    const pending = state.pendingEncounters.length;
    if (pending === 0) {
      if (!leaving) {
        leaving = true;
        sheet.clear();
        env.back();
      }
      return;
    }
    leaving = false;
    const queued = pending - 1;
    const actionKey = encounterActionKey(state, 0);
    if (!dirty && actionKey === shownActionKey && queued === shownQueued && serial === shownSerial) return;
    const view = toEncounterView(state, 0, evaluate(state));
    if (!view) return;
    // Wildwechsel (24.6): Weg der vordersten Begegnung (main.ts weiß, wie die Karte kam).
    applyWildwechselMark(view, deps.encounterMark());
    view.key = String(serial);
    const next = shownSerial >= 0 && serial !== shownSerial;
    dirty = false;
    shownActionKey = actionKey;
    shownQueued = queued;
    shownSerial = serial;
    const fresh = sheet.show(view, queued);
    page.element.dataset.kind = view.kind;
    if (fresh && next) {
      // Nächste Begegnung ohne neues Umblättern: Inhalt kurz überblenden.
      if (!prefersReducedMotion()) restartAnimation(page.element, 'enc-swap');
      if (!page.element.inert) sheet.focusFirst();
    }
  }

  return {
    page,
    bookmark,
    opened() {
      opened = true;
      leaving = false;
      dirty = true;
      shownSerial = -1;
      setLaterLabel();
      refresh();
    },
    update() {
      refresh();
      // Erst wenn die Seite ruhig liegt (nicht mehr beim Umblättern): Legende beim ersten Mal.
      if (opened && !leaving && !page.element.inert && !page.element.hidden) sheet.revealLegendOnce();
    },
    reset() {
      sheet.clear();
      dirty = true;
      serial++;
    },
    invalidate() {
      dirty = true;
    },
    resolved() {
      serial++;
      dirty = true;
    },
  };
}
