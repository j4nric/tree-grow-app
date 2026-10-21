import type { PlantGroup, Tag } from './types';

/**
 * Begleitpflanzen um den Hauptbaum (docs/DESIGN_V2.md, Abschnitt 4). Zahlen aus
 * scripts/v2/content.ts. Pflanzen kommen über die Begegnung „Etwas keimt“ (gratis) oder
 * werden mit Samen gesetzt; dieselbe Pflanze darf mehrfach wachsen. Sie sterben nicht –
 * ist der Pflanzring voll (`Stage.plantSlots`), heißt es ersetzen oder warten.
 */
export interface Plant {
  id: string;
  name: string;
  group: PlantGroup;
  /** Ab dieser Stufe (Index in STAGES) kann die Pflanze keimen oder gesetzt werden. */
  unlock: number;
  /** Grundwachstum 🌿/s (mal Versorgung, Gruppen-Boni, Harmonie). */
  growth: number;
  /** Grundsamen 🌰/s. */
  seeds: number;
  /** Lichtbedarf ☀️. */
  light: number;
  /** Wasserbedarf 💧 – negativ: speichert Wasser (Moos). */
  water: number;
  /** Futter und Lebensraum für Tiere (je Pflanze 1 Einheit). */
  provides: readonly Tag[];
  text: string;
}

export const PLANT_GROUP_INFO: Readonly<Record<PlantGroup, { name: string; icon: string }>> = {
  trees: { name: 'Bäume', icon: '🌳' },
  shrubs: { name: 'Sträucher', icon: '🫐' },
  flowers: { name: 'Blumen & Kräuter', icon: '🌸' },
  mosses: { name: 'Moose & Farne', icon: '🍃' },
};

export const PLANTS: readonly Plant[] = [
  // --- Bäume ------------------------------------------------------------------
  {
    id: 'birch', name: 'Hänge-Birke', group: 'trees', unlock: 3, growth: 1.5, seeds: 0.3, light: 4, water: 2,
    provides: ['laub'], text: 'Pionierin mit weißer Rinde – wächst schnell, wo Licht ist.',
  },
  {
    id: 'rowan', name: 'Eberesche', group: 'trees', unlock: 3, growth: 1, seeds: 0.6, light: 3, water: 2,
    provides: ['laub', 'beeren', 'nektar'], text: 'Ihre roten Beeren sind ein Festmahl für Vögel.',
  },
  {
    id: 'beech', name: 'Rotbuche', group: 'trees', unlock: 4, growth: 2, seeds: 0.4, light: 3, water: 3,
    provides: ['laub', 'nuesse'], text: 'Die Mutter des Waldes – kommt auch im Schatten zurecht.',
  },
  {
    id: 'pine', name: 'Waldkiefer', group: 'trees', unlock: 4, growth: 1.5, seeds: 0.4, light: 3, water: 1,
    provides: ['laub', 'nadeln'], text: 'Genügsam und harzig, liebt sandigen Boden.',
  },
  // --- Sträucher --------------------------------------------------------------
  {
    id: 'hazel', name: 'Hasel', group: 'shrubs', unlock: 2, growth: 0.8, seeds: 0.6, light: 2, water: 2,
    provides: ['laub', 'nuesse'], text: 'Blüht schon im Februar – und dann die Nüsse!',
  },
  {
    id: 'bramble', name: 'Brombeere', group: 'shrubs', unlock: 2, growth: 0.5, seeds: 1, light: 2, water: 1,
    provides: ['beeren', 'nektar'], text: 'Stachelig, wuchernd, ein sicheres Versteck.',
  },
  {
    id: 'elder', name: 'Schwarzer Holunder', group: 'shrubs', unlock: 3, growth: 0.8, seeds: 0.8, light: 2, water: 2,
    provides: ['laub', 'beeren', 'nektar'], text: 'Duftende Dolden im Juni, dunkle Beeren im Herbst.',
  },
  // --- Blumen & Kräuter -------------------------------------------------------
  {
    id: 'anemone', name: 'Buschwindröschen', group: 'flowers', unlock: 1, growth: 0.3, seeds: 0.8, light: 1, water: 1,
    provides: ['nektar', 'kraut'], text: 'Blüht, bevor sich das Kronendach schließt.',
  },
  {
    id: 'nettle', name: 'Große Brennnessel', group: 'flowers', unlock: 2, growth: 0.4, seeds: 0.6, light: 2, water: 2,
    provides: ['kraut'], text: 'Brennt – und ernährt die Raupen vieler Falter.',
  },
  {
    id: 'strawberry', name: 'Wald-Erdbeere', group: 'flowers', unlock: 2, growth: 0.3, seeds: 1, light: 2, water: 1,
    provides: ['beeren', 'nektar', 'kraut'], text: 'Winzig, rot und süßer als jede Gartenerdbeere.',
  },
  {
    id: 'foxglove', name: 'Roter Fingerhut', group: 'flowers', unlock: 3, growth: 0.3, seeds: 1.4, light: 3, water: 1,
    provides: ['nektar'], text: 'Hohe Glockenblüten – die Hummeln kriechen ganz hinein.',
  },
  // --- Moose & Farne ----------------------------------------------------------
  {
    id: 'moss', name: 'Frauenhaarmoos', group: 'mosses', unlock: 1, growth: 0.3, seeds: 0.2, light: 0, water: -2,
    provides: ['feucht'], text: 'Ein grünes Polster, das Regen speichert wie ein Schwamm.',
  },
  {
    id: 'fern', name: 'Wurmfarn', group: 'mosses', unlock: 2, growth: 0.6, seeds: 0.2, light: 1, water: 2,
    provides: ['feucht'], text: 'Rollt im Frühling seine Wedel aus wie Bischofsstäbe.',
  },
  {
    id: 'hartstongue', name: 'Hirschzunge', group: 'mosses', unlock: 4, growth: 0.7, seeds: 0.3, light: 0, water: 2,
    provides: ['feucht'], text: 'Ein Farn mit ungeteilten, glänzenden Blättern – liebt tiefen Schatten.',
  },
];

export const PLANTS_BY_ID: ReadonlyMap<string, Plant> = new Map(PLANTS.map((p) => [p.id, p]));

/**
 * Pflanzen setzen kostet Samen: PLANT_COST_BASE · PLANT_COST_GROWTH^n, n = Begleitpflanzen,
 * die schon wachsen (Hauptbaum zählt nicht) → 20 · 38 · 72 · 137 · 261 · 495 … 🌰.
 */
export const PLANT_COST_BASE = 20;
export const PLANT_COST_GROWTH = 1.9;
