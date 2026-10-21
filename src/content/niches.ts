import type { NicheId } from './types';

/**
 * Nischen am Hauptbaum. Jede Nische hat je Stufe begrenzte Plätze; 0 = noch geschlossen.
 * Zusätzliche Plätze bringen Tiere mit der Wirkung `slot` (z. B. Borkenkäfer, Buntspecht).
 */
export interface Niche {
  id: NicheId;
  name: string;
  icon: string;
  /** Lage am Baum (für Texte und später die Ankerpunkte im Renderer). */
  place: string;
  /** Plätze je Stufe (Index = Stufe). */
  slots: readonly number[];
  /**
   * Plätze aus Wirkungen (`slot`) öffnen die Nische schon, bevor die Stufe sie freigibt
   * (Höhlen entstehen mit dem Totholz). Sonst bleibt eine geschlossene Nische zu.
   */
  opensEarly?: boolean;
}

export const NICHES: readonly Niche[] = [
  { id: 'roots', name: 'Wurzelraum', icon: '🪱', place: 'Erde, Wurzeln', slots: [0, 1, 2, 2, 3, 3, 4, 4] },
  { id: 'litter', name: 'Laubstreu', icon: '🍂', place: 'Boden um den Stamm', slots: [0, 0, 1, 2, 2, 3, 3, 4] },
  { id: 'edge', name: 'Waldsaum', icon: '🌼', place: 'Blumen, Sträucher, Wiese rund um den Baum', slots: [0, 0, 1, 2, 3, 3, 4, 4] },
  { id: 'crown', name: 'Krone', icon: '🌳', place: 'Äste, Blätter', slots: [0, 0, 0, 2, 2, 3, 4, 4] },
  { id: 'bark', name: 'Stamm & Rinde', icon: '🪵', place: 'Borke', slots: [0, 0, 0, 1, 2, 2, 3, 3] },
  {
    id: 'hollows', name: 'Höhlen & Totholz', icon: '🕳️', place: 'Spechthöhlen, tote Äste',
    slots: [0, 0, 0, 0, 1, 2, 2, 3], opensEarly: true,
  },
  {
    // Erweiterung Amphibien (DESIGN_V2.md 5.5): keine Plätze aus der Stufe. Der Tümpel
    // entsteht durch die Pflege „Waldtümpel“ (+2, im Hain +1) oder das Ereignis
    // „Regenreicher Frühling“ (+1) bzw. „Krötenwanderung“ (+1).
    id: 'pond', name: 'Waldtümpel', icon: '🫧', place: 'Wasser und Ufer der Senke',
    slots: [0, 0, 0, 0, 0, 0, 0, 0], opensEarly: true,
  },
];

export const NICHES_BY_ID: ReadonlyMap<NicheId, Niche> = new Map(NICHES.map((n) => [n.id, n]));
