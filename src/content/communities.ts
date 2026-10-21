import type { Effect } from './types';

/**
 * Lebensgemeinschaften (docs/DESIGN_V2.md, 9.2): Leben bzw. wachsen alle Mitglieder im
 * Ökosystem, gibt es Harmonie-Punkte und manchmal eine Extra-Wirkung. Zahlen und IDs aus
 * scripts/v2/content.ts. Im Naturtagebuch erscheinen sie als Silhouette mit Rätselhinweis,
 * bis sie einmal entdeckt (aktiv) waren.
 */

/**
 * Ein Mitglied: eine Art- oder Pflanzen-ID – oder eine Liste von IDs, von denen eine
 * genügt (z. B. „Pfifferling oder Steinpilz“).
 */
export type CommunityMember = string | readonly string[];

export interface Community {
  id: string;
  name: string;
  members: readonly CommunityMember[];
  /** Harmonie-Punkte, solange die Gemeinschaft besteht (nicht mit Zufriedenheit skaliert). */
  harmony: number;
  /** Extra-Wirkungen (nicht mit Zufriedenheit skaliert). */
  effects: readonly Effect[];
  /** Rätselhinweis im Naturtagebuch. */
  hint: string;
}

export const COMMUNITIES: readonly Community[] = [
  {
    id: 'humus', name: 'Humusküche', members: ['earthworm', 'woodlouse', ['chanterelle', 'porcini']],
    harmony: 8, effects: [{ kind: 'growth', pct: 5 }], hint: 'Aus Laub wird Erde, aus Erde wird Leben.',
  },
  {
    id: 'caterpillar-watch', name: 'Raupenwacht', members: ['oakmoth', 'bluetit', ['bat', 'woodant']],
    harmony: 8, effects: [], hint: 'Tags und nachts wird die Krone bewacht.',
  },
  {
    id: 'deadwood', name: 'Totholz-Kette', members: ['barkbeetle', 'woodpecker', 'tinder', ['owl', 'bat']],
    harmony: 10, effects: [], hint: 'Was stirbt, schafft Wohnraum.',
  },
  {
    id: 'night-shift', name: 'Nachtschicht', members: ['owl', 'bat', ['hedgehog', 'glowworm']],
    harmony: 6, effects: [], hint: 'Wenn du schläfst, arbeiten sie.',
  },
  {
    id: 'seed-couriers', name: 'Samenboten', members: ['squirrel', 'jay', 'bee'],
    harmony: 8, effects: [{ kind: 'seeds', pct: 10 }], hint: 'Blüte, Frucht und Versteck.',
  },
  {
    id: 'wild-edge', name: 'Wilder Waldsaum', members: ['deer', 'fox', 'wolf'],
    harmony: 10, effects: [], hint: 'Erst der Jäger bringt den Wald ins Gleichgewicht.',
  },
  {
    id: 'flower-hem', name: 'Blütensaum', members: ['bee', 'peacock', 'nettle', ['strawberry', 'foxglove']],
    harmony: 6, effects: [], hint: 'Wo Brennnesseln stehen dürfen, tanzen Falter.',
  },
  {
    id: 'birch-bond', name: 'Birkenbund', members: ['birch', 'flyagaric', 'moss'],
    harmony: 6, effects: [], hint: 'Weiß, rot und grün – ein altes Bündnis.',
  },
  {
    id: 'damp-ground', name: 'Feuchter Grund', members: ['moss', 'fern', ['slug', 'salamander']],
    harmony: 6, effects: [], hint: 'Im Schatten, wo es nie ganz trocknet.',
  },
];

export const COMMUNITIES_BY_ID: ReadonlyMap<string, Community> = new Map(COMMUNITIES.map((c) => [c.id, c]));

