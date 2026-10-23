/**
 * Stückweises Aufdecken einer langen Seite (R3, Leistung; Reiter Arten).
 *
 * Beim ersten Zeigen muss der Browser die ganze Seite auslegen und malen – auf Arten im
 * Spätspiel ≈ 1200 Objekte und ≈ 4700 px, bei 4× CPU-Drosselung zwei Long Tasks von je
 * ≈ 200 ms. Darum sind die Blöcke unterhalb des ersten Bildschirms zunächst gesperrt
 * (`content-visibility: hidden` mit geschätzter Höhe, `estimateBlockHeight`: Die Seite ist
 * gleich ungefähr so lang wie fertig, das Hochrücken der Reiterleiste und die Scroll-Lage
 * stimmen) und kommen in Leerlaufzeit dazu: **ein Block je Leerlauf-Rückruf**. Ein
 * Rückruf, der während eines Leerlaufs geplant wird, läuft erst im nächsten – dazwischen liegt
 * also ein Frame, der nur den einen neuen Block auslegt. Ein Zeitbudget wie bei den Stickern
 * hilft hier nicht: Das Aufdecken selbst kostet nichts, die Arbeit kommt erst im Frame.
 *
 * Gebaut wird die Seite weiterhin vollständig (DOM, Daten, Aktualisieren) – verborgen ist nur
 * die Darstellung. Braucht jemand die ganze Seite sofort (Sprungmarke), deckt `all` den Rest
 * auf einmal auf.
 */
import { IdleQueue } from '../../../render/idle';

export interface DeferredReveal {
  /** Beginnt das Aufdecken (mehrfach aufrufbar; nur der erste Aufruf plant). */
  start(): void;
  /** Deckt alle noch verborgenen Blöcke sofort auf. */
  all(): void;
  /** Noch verborgene Blöcke. */
  readonly pending: number;
}

/**
 * `reveal(i)` deckt Block `i` auf (0 … count − 1, in dieser Reihenfolge, jeder genau einmal).
 * `active()`: Ist die Seite gerade zu sehen? Sonst ruht das Aufdecken bis zum nächsten
 * `start` – verborgen aufgedeckte Blöcke müsste der Browser beim nächsten Zeigen alle auf
 * einmal auslegen. Die Warteschlange ist austauschbar (Tests).
 */
export function createDeferredReveal(
  count: number,
  reveal: (index: number) => void,
  active: () => boolean = () => true,
  queue: IdleQueue = new IdleQueue(),
): DeferredReveal {
  let next = 0;
  let started = false;
  const KEY = 'reveal';
  const step = (): void => {
    if (next >= count) return;
    if (!active()) {
      started = false;
      return;
    }
    reveal(next++);
    if (next < count) queue.schedule(KEY, step);
  };
  return {
    start() {
      if (started) return;
      started = true;
      if (next < count) queue.schedule(KEY, step);
    },
    all() {
      started = true;
      queue.cancel(KEY);
      while (next < count) reveal(next++);
    },
    get pending() {
      return count - next;
    },
  };
}

/**
 * Wie viele Gruppen gleich beim ersten Zeigen sichtbar sein sollen: so viele, bis zusammen
 * mindestens `minCells` Zellen stehen (den ersten Bildschirm füllen), mindestens eine.
 */
export function initialGroupCount(sizes: readonly number[], minCells: number): number {
  let cells = 0;
  for (let i = 0; i < sizes.length; i++) {
    cells += sizes[i]!;
    if (cells >= minCells) return i + 1;
  }
  return sizes.length;
}

/** Geschätzte Spalten des Sticker-Rasters (mobil 5–6, Doppelseite 7 – lieber etwas zu hoch). */
export const ESTIMATE_COLUMNS = 6;
/** Geschätzte Höhe einer Rasterzeile (Sticker, zwei Namenszeilen, Abstand) und eines Titels. */
export const ESTIMATE_ROW_PX = 88;
export const ESTIMATE_TITLE_PX = 34;

/**
 * Platzhalter-Höhe eines gesperrten Rasterblocks mit `cells` Zellen (Gattung, Pflanzen). Nur
 * eine Schätzung: Bis zum Aufdecken liegt der Block unter dem ersten Bildschirm.
 */
export function estimateGridHeight(cells: number): number {
  const rows = Math.ceil(Math.max(0, cells) / ESTIMATE_COLUMNS);
  return ESTIMATE_TITLE_PX + rows * ESTIMATE_ROW_PX;
}
