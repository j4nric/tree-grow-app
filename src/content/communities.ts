import type { Effect } from './types';

/**
 * Lebensgemeinschaften (docs/DESIGN_V2.md, 9.2): Leben bzw. wachsen alle Mitglieder im
 * Ökosystem, gibt es Harmonie-Punkte und manchmal eine Extra-Wirkung. Zahlen und IDs
 * ursprünglich aus dem Prototyp (scripts/v2, entfernt in Schritt 2.10). Im Naturtagebuch
 * erscheinen sie als Silhouette mit Rätselhinweis, bis sie einmal entdeckt (aktiv) waren.
 */

/**
 * Ein Mitglied: eine Art- oder Pflanzen-ID – oder eine Liste von IDs, von denen eine
 * genügt (z. B. „Pfifferling oder Steinpilz“).
 */
export type CommunityMember = string | readonly string[];

export interface Community {
  id: string;
  name: string;
  /** Symbol in der Seitenleiste (erst nach der Entdeckung sichtbar). */
  icon: string;
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
    id: 'humus', name: 'Humusküche', icon: '🪱', members: ['earthworm', 'woodlouse', ['chanterelle', 'porcini']],
    harmony: 8, effects: [{ kind: 'growth', pct: 5 }], hint: 'Aus Laub wird Erde, aus Erde wird Leben.',
  },
  {
    id: 'caterpillar-watch', name: 'Raupenwacht', icon: '🐛', members: ['oakmoth', 'bluetit', ['bat', 'woodant']],
    harmony: 8, effects: [], hint: 'Tags und nachts wird die Krone bewacht.',
  },
  {
    id: 'deadwood', name: 'Totholz-Kette', icon: '🪵', members: ['barkbeetle', 'woodpecker', 'tinder', ['owl', 'bat']],
    harmony: 10, effects: [], hint: 'Was stirbt, schafft Wohnraum.',
  },
  {
    id: 'night-shift', name: 'Nachtschicht', icon: '🦉', members: ['owl', 'bat', ['hedgehog', 'glowworm']],
    harmony: 6, effects: [], hint: 'Wenn du schläfst, arbeiten sie.',
  },
  {
    id: 'seed-couriers', name: 'Samenboten', icon: '🌰', members: ['squirrel', 'jay', 'bee'],
    harmony: 8, effects: [{ kind: 'seeds', pct: 10 }], hint: 'Blüte, Frucht und Versteck.',
  },
  {
    id: 'wild-edge', name: 'Wilder Waldsaum', icon: '🦊', members: ['deer', 'fox', 'wolf'],
    harmony: 10, effects: [], hint: 'Erst der Jäger bringt den Wald ins Gleichgewicht.',
  },
  {
    id: 'flower-hem', name: 'Blütensaum', icon: '🌸', members: ['bee', 'peacock', 'nettle', ['strawberry', 'foxglove']],
    harmony: 6, effects: [], hint: 'Wo Brennnesseln stehen dürfen, tanzen Falter.',
  },
  {
    id: 'birch-bond', name: 'Birkenbund', icon: '🌳', members: ['birch', 'flyagaric', 'moss'],
    harmony: 6, effects: [], hint: 'Weiß, rot und grün – ein altes Bündnis.',
  },
  {
    id: 'damp-ground', name: 'Feuchter Grund', icon: '💧', members: ['moss', 'fern', ['slug', 'salamander']],
    harmony: 6, effects: [], hint: 'Im Schatten, wo es nie ganz trocknet.',
  },
  // Erweiterung Amphibien (DESIGN_V2.md 5.5)
  {
    id: 'pond-life', name: 'Tümpelleben', icon: '🐸', members: ['toad', 'newt', ['fern', 'hartstongue']],
    harmony: 6, effects: [{ kind: 'water', amount: 2 }], hint: 'Wo sich Farne über das Wasser beugen, kehrt jemand jedes Frühjahr heim.',
  },
  {
    id: 'slug-watch', name: 'Schneckenwacht', icon: '🐌', members: ['toad', 'hedgehog', ['glowworm', 'salamander']],
    harmony: 6, effects: [], hint: 'Nachts geht es den Schnecken an den Kragen – von drei Seiten.',
  },
];

export const COMMUNITIES_BY_ID: ReadonlyMap<string, Community> = new Map(COMMUNITIES.map((c) => [c.id, c]));

