import type { NicheId } from './types';

/**
 * Nischen am Hauptbaum. Jede Nische hat je Stufe begrenzte Plätze; 0 = noch geschlossen.
 * Prototyp: nur die Nischen, in denen die 9 Arten leben (Höhlen & Totholz folgt mit 2.2).
 */
export interface Niche {
  id: NicheId;
  name: string;
  icon: string;
  /** Lage am Baum (für Texte und später die Ankerpunkte im Renderer). */
  place: string;
  /** Plätze je Stufe (Index = Stufe). */
  slots: readonly number[];
}

export const NICHES: readonly Niche[] = [
  { id: 'roots', name: 'Wurzelraum', icon: '🪱', place: 'Erde, Wurzeln', slots: [0, 1, 2, 2, 3, 3, 4, 4] },
  { id: 'litter', name: 'Laubstreu', icon: '🍂', place: 'Boden um den Stamm', slots: [0, 0, 1, 2, 2, 3, 3, 4] },
  { id: 'edge', name: 'Waldsaum', icon: '🌼', place: 'Blumen, Sträucher, Wiese rund um den Baum', slots: [0, 0, 1, 2, 3, 3, 4, 4] },
  { id: 'crown', name: 'Krone', icon: '🌳', place: 'Äste, Blätter', slots: [0, 0, 0, 2, 2, 3, 4, 4] },
  { id: 'bark', name: 'Stamm & Rinde', icon: '🪵', place: 'Borke', slots: [0, 0, 0, 1, 2, 2, 3, 3] },
];

export const NICHES_BY_ID: ReadonlyMap<NicheId, Niche> = new Map(NICHES.map((n) => [n.id, n]));
