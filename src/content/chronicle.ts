/**
 * Waldchronik (docs/DESIGN_V2.md 26.4): sechs Kapitel je Wald. Reine Daten – geschrieben
 * werden die Kapitel in src/core (`writeChapter` in core/landscape.ts, aufgerufen von tick.ts),
 * gespeichert in `meta.landscape.sites[].chronicle` (seit Spielstand v16).
 *
 * Was je Wald verschieden ist (Ereignis des Waldes, Kennart, Andenken), steht am Standort in
 * landscape.ts (`chronicleEvent`, `chronicleEventTitle`, `kennart`, `keepsake`).
 */

/** Die sechs Kapitel einer Chronik, in Anzeige-Reihenfolge (26.4). */
export type ChapterId = 'ancient' | 'first-snow' | 'signature' | 'kennart' | 'harmony' | 'memory';
export const CHAPTER_IDS: readonly ChapterId[] = ['ancient', 'first-snow', 'signature', 'kennart', 'harmony', 'memory'];

/**
 * Kapitel „Voller Einklang“: H_max eines Zyklus im aktiven Wald erreicht diesen Wert. In der
 * Landschaft erreichen alle Spielweisen 263–312 (24.10) – ein Ziel, keine Hürde. Startwert,
 * gemessen in Aufgabe 2c (26.8, Ziel e).
 */
export const CHRONICLE_HARMONY = 250;

export interface ChronicleChapter {
  id: ChapterId;
  icon: string;
  /**
   * Titel des Kapitels. Für `signature` und `kennart` nur der allgemeine Titel – der Wald setzt
   * seinen eigenen ein (`chronicleEventTitle`, „Die Kennart: Biber“).
   */
  title: string;
  /** Hinweis für ein offenes Kapitel – ohne Spoiler (keine Art, kein Ereignis beim Namen). */
  hint: string;
}

export const CHRONICLE_CHAPTERS: readonly ChronicleChapter[] = [
  { id: 'ancient', icon: '🌲', title: 'Uralt geworden', hint: 'Lass diesen Wald einmal bis zum Urwald wachsen.' },
  { id: 'first-snow', icon: '❄️', title: 'Erster Schnee im Urwald', hint: 'Erlebe hier einen Winter im Urwald.' },
  { id: 'signature', icon: '📅', title: 'Das Ereignis des Waldes', hint: 'Jeder Wald hat sein eigenes Ereignis – entscheide es hier einmal.' },
  { id: 'kennart', icon: '🔎', title: 'Die Kennart', hint: 'Die Kennart dieses Waldes zeigt sich nur, wenn er alt ist.' },
  { id: 'harmony', icon: '⚖️', title: 'Voller Einklang', hint: `Bring die Harmonie hier einmal auf ${CHRONICLE_HARMONY}.` },
  { id: 'memory', icon: '🧠', title: 'Ein Wald erinnert sich', hint: 'Fülle das Gedächtnis dieses Waldes ganz.' },
];

export const CHRONICLE_CHAPTERS_BY_ID: ReadonlyMap<ChapterId, ChronicleChapter> = new Map(CHRONICLE_CHAPTERS.map((c) => [c.id, c]));
