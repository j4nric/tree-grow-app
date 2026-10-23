/**
 * Platz der Meldungsschicht (docs/ALBUM_UI.md C.5, Playtest Schritt 14 M2/S2): oben über dem
 * Bild nur, wo oben keine Navigation liegt – im Vollbild und mobil auf der Hauptansicht, solange
 * über der Bildunterschrift Platz ist. Entschieden wird beim Erscheinen; beim Scrollen wechselt
 * die Schicht nur noch nach unten, wenn die Knöpfe unter dem Bild an sie heranrücken
 * (überblendet). Unten rückt sie über scharfe Bestätigungen, markierte Knöpfe
 * (`data-stamp-avoid`, z. B. „Schließen“ im Umschlag) und den fokussierten Knopf.
 *
 * Gemessen wird nur, solange Meldungen zu sehen sind – höchstens einmal je Frame, nie im
 * Game Loop. Die Regeln selbst stehen rein in stamp-rules.ts (Vitest).
 */
import { stampLift, stampsOnTop } from './stamp-rules';
import type { Stamps } from './stamps';

/** Oberkante der oberen Meldungsschicht (stamps.css, `.stamps-top`). */
const TOP_OFFSET = 16;
/** Höhe einer Meldung, solange noch keine zu sehen ist (zwei Zeilen Stempel). */
const TOP_ESTIMATE = 90;
/** Höher rücken die Meldungen unten nie: Reiterleiste bzw. Lesezeichen und Titel bleiben frei. */
const MIN_TOP_SINGLE = 120;
const MIN_TOP_SPREAD = 96;
/** Was Meldungen nie verdecken: scharfe Bestätigungen und markierte Knöpfe. */
const AVOID = '.armed, [data-stamp-avoid]';
/** Fokussiertes Bedienelement: bleibt ebenfalls frei. */
const FOCUSABLE_CONTROL = 'button, a[href], input, select, textarea, [role="tab"], [role="button"]';
/** Größere Flächen (Polaroid, ganze Karten) zählen nicht – Anteil der Fensterhöhe. */
const MAX_AVOID_SHARE = 0.4;

export interface StampContext {
  /** Doppelseite oder Einzelseite. */
  layout(): 'spread' | 'single';
  fullscreen(): boolean;
  /** Mobil: Hauptansicht ohne Unterseite und ohne Umschlag? */
  home(): boolean;
  /** Bildunterschrift des Polaroids: Ihre Knöpfe sind die ersten unter der oberen Meldung. */
  caption: HTMLElement;
}

export interface StampPlacement {
  /** Sofort neu entscheiden (Navigation, neue oder verschwundene Meldung). */
  place(): void;
}

export function createStampPlacement(stamps: Stamps, context: StampContext): StampPlacement {
  /** Gilt die Oben/Unten-Entscheidung schon für die gerade sichtbaren Meldungen? (S2) */
  let decided = false;
  let queued = false;

  function place(): void {
    const visible = stamps.count > 0;
    const fresh = !decided;
    decided = visible;
    let top = context.fullscreen();
    if (!top && context.layout() === 'single' && context.home()) {
      const box = stamps.box();
      const height = box ? box.height : TOP_ESTIMATE;
      top = stampsOnTop(fresh, stamps.top, context.caption.getBoundingClientRect().top, TOP_OFFSET + height);
    }
    stamps.setTop(top, visible && !fresh);
    stamps.setLift(top || !visible ? 0 : lift());
  }

  /** Wie weit die Meldungen unten nach oben rücken müssen (`stampLift`). */
  function lift(): number {
    const layer = stamps.box();
    if (!layer) return 0;
    const avoid: DOMRect[] = [];
    const add = (node: Element) => {
      if (stamps.element.contains(node) || node.closest('[hidden], [inert], .turned-away')) return;
      const r = node.getBoundingClientRect();
      if (r.height === 0 || r.height > innerHeight * MAX_AVOID_SHARE || r.bottom < 0 || r.top > innerHeight) return;
      avoid.push(r);
    };
    for (const node of document.querySelectorAll(AVOID)) add(node);
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches(FOCUSABLE_CONTROL)) add(active);
    return stampLift(layer, avoid, context.layout() === 'single' ? MIN_TOP_SINGLE : MIN_TOP_SPREAD);
  }

  function soon(): void {
    if (queued || stamps.count === 0) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      place();
    });
  }

  // Auch das Scrollen der Unterseiten (mobil eigene Scrollfläche) und der Seiten am Desktop.
  document.addEventListener('scroll', soon, { passive: true, capture: true });
  window.addEventListener('resize', soon, { passive: true });
  document.addEventListener('focusin', soon);
  // Ein Klick kann eine Bestätigung scharf schalten („Zum Bestätigen erneut klicken“).
  document.addEventListener('click', soon, true);
  // Umschlag, Umblättern, Überblenden: erst am Ende liegen die Knöpfe an ihrem Platz.
  document.addEventListener('transitionend', soon, true);
  document.addEventListener('animationend', soon, true);

  return { place };
}
