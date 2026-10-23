import { HABITAT_SPECIES, REPTILE_INFO } from './habitats';
import type { SiteId } from './landscape';
import type { Condition, Effect, Genus, Level, NicheId, Rarity, Tag } from './types';

/**
 * Alle 57 Tierarten (und Pilze): 32 in den 5 Grundgattungen (docs/DESIGN_V2.md, 5.3),
 * 5 Amphibien der Erweiterung Waldtümpel (5.5, Laubfrosch und Kammmolch seit dem Playtest),
 * 14 Arten der Lebensräume (23.4, Daten in habitats.ts) und 6 Kennarten der Landschaft (26.3). Die Grafik-Ebene
 * erwartet genau diese IDs. 🌿-Wirkungen seit dem Balancing 2.10 ×0,75 gegenüber dem
 * Prototyp (DESIGN_V2.md 15.4). Borkenkäfer (Totholz) und Buntspecht (gezimmerte Höhle)
 * bringen je +1 Platz in „Höhlen & Totholz“,
 * der Schwarzspecht als Baumeister (abilities.ts) je +1 in Krone und Höhlen.
 */
export interface Species {
  id: string;
  name: string;
  genus: Genus;
  rarity: Rarity;
  level: Level;
  niche: NicheId;
  /** Ab dieser Stufe (Index in STAGES) kann die Art angeboten werden. */
  unlock: number;
  /** Nahrung: das am besten verfügbare Merkmal zählt (doppelt gewichtet). */
  food: readonly Tag[];
  /** Weitere Wünsche an den Lebensraum (je einfach gewichtet). */
  needs: readonly Condition[];
  /**
   * Erscheinungsbedingung (besonders und legendär): Die Art wird erst als Karte
   * angeboten, wenn alle Bedingungen erfüllt sind. „sonnig“/„schattig“ gelten dabei immer
   * als erfüllt, Gattungen zählen ohne Fähigkeiten (DESIGN_V2.md 5.2, 7.3).
   */
  appears?: readonly Condition[];
  /** Merkmale, die die Art anderen bereitstellt (Futter, Totholz, Baumhöhle …). */
  provides: readonly Tag[];
  /** Grundwirkung; wird mit der Zufriedenheit multipliziert (außer Fraß). */
  effects: readonly Effect[];
  /** Kurze Wirkung für Karten und Übersicht. */
  summary: string;
  text: string;
}

export const GENUS_INFO: Readonly<Record<Genus, { name: string; icon: string }>> = {
  birds: { name: 'Vögel', icon: '🐦' },
  insects: { name: 'Insekten', icon: '🐝' },
  mammals: { name: 'Säugetiere', icon: '🦔' },
  soil: { name: 'Bodenleben', icon: '🪱' },
  fungi: { name: 'Pilze', icon: '🍄' },
  amphibians: { name: 'Amphibien', icon: '🐸' },
  reptiles: REPTILE_INFO,
};

export const RARITY_NAMES: readonly string[] = ['gewöhnlich', 'selten', 'besonders', 'legendär'];

/** Grundzufriedenheit je Seltenheit: seltene Arten sind wählerischer. */
export const BASE_HAPPINESS: readonly number[] = [0.25, 0.15, 0.05, 0];

export const LEVEL_NAMES: Readonly<Record<Level, string>> = {
  herbivore: 'Pflanzenfresser',
  predator: 'Räuber',
  decomposer: 'Zersetzer & Partner',
};

export const SPECIES: readonly Species[] = [
  // --- Vögel --------------------------------------------------------------------
  {
    id: 'robin', name: 'Rotkehlchen', genus: 'birds', rarity: 0, level: 'predator', niche: 'litter', unlock: 2,
    food: ['wuermer', 'insekten', 'beeren'], needs: [{ kind: 'group', group: 'shrubs', min: 1 }],
    provides: [],
    effects: [{ kind: 'control', tag: 'insekten', pct: 20 }, { kind: 'seeds', pct: 8 }],
    summary: 'jagt Insekten (−20 % Fraß), +8 % 🌰',
    text: 'Folgt jedem, der im Boden gräbt – vielleicht kommt ein Wurm zum Vorschein.',
  },
  {
    id: 'bluetit', name: 'Blaumeise', genus: 'birds', rarity: 0, level: 'predator', niche: 'crown', unlock: 3,
    food: ['raupen', 'insekten'], needs: [{ kind: 'group', group: 'trees', min: 2 }, { kind: 'tag', tag: 'hoehle' }],
    provides: [],
    effects: [{ kind: 'control', tag: 'raupen', pct: 50 }, { kind: 'seeds', pct: 4 }],
    summary: 'jagt Raupen (−50 % Fraß), +4 % 🌰',
    text: 'Ein Meisenpaar verfüttert im Frühling Tausende Raupen.',
  },
  {
    id: 'woodpecker', name: 'Buntspecht', genus: 'birds', rarity: 1, level: 'predator', niche: 'bark', unlock: 4,
    food: ['kaefer', 'insekten', 'nuesse'], needs: [{ kind: 'tag', tag: 'totholz' }],
    provides: ['hoehle'],
    effects: [{ kind: 'control', tag: 'kaefer', pct: 60 }, { kind: 'slot', niche: 'hollows', amount: 1 }, { kind: 'growth', pct: 3 }],
    summary: 'jagt Käfer (−60 % Fraß), +1 Platz Höhlen, +3 % 🌿',
    text: 'Klopft, horcht, hackt. Seine alten Höhlen sind begehrter Wohnraum.',
  },
  {
    id: 'jay', name: 'Eichelhäher', genus: 'birds', rarity: 1, level: 'herbivore', niche: 'crown', unlock: 4,
    food: ['nuesse'], needs: [],
    provides: [],
    effects: [{ kind: 'growth', pct: 9 }, { kind: 'seeds', pct: 10 }, { kind: 'disturb', target: 'bluetit' }],
    summary: '+9 % 🌿, +10 % 🌰, stört die Blaumeise',
    text: 'Der Förster des Waldes: vergräbt Tausende Eicheln und findet nicht alle wieder.',
  },
  {
    id: 'owl', name: 'Waldkauz', genus: 'birds', rarity: 2, level: 'predator', niche: 'hollows', unlock: 4,
    food: ['kleinsaeuger'], needs: [{ kind: 'group', group: 'trees', min: 2 }],
    appears: [{ kind: 'tag', tag: 'kleinsaeuger' }],
    provides: [],
    effects: [{ kind: 'control', tag: 'kleinsaeuger', pct: 70 }, { kind: 'growth', pct: 6 }, { kind: 'ability', id: 'nightWatch' }],
    summary: 'jagt Kleinsäuger (−70 % Fraß), +6 % 🌿, Nachtwache',
    text: 'Huhu-huuu. Nachts jagt er lautlos über den Waldboden.',
  },
  {
    id: 'blackwoodpecker', name: 'Schwarzspecht', genus: 'birds', rarity: 3, level: 'predator', niche: 'bark', unlock: 5,
    food: ['insekten', 'kaefer'], needs: [{ kind: 'species', id: 'woodant' }, { kind: 'tag', tag: 'totholz' }, { kind: 'group', group: 'trees', min: 3 }],
    appears: [{ kind: 'species', id: 'woodpecker' }],
    provides: ['hoehle'],
    effects: [{ kind: 'growth', pct: 8 }, { kind: 'control', tag: 'kaefer', pct: 40 }, { kind: 'ability', id: 'architect' }],
    summary: '+8 % 🌿, jagt Käfer (−40 % Fraß), Baumeister',
    text: 'Der Baumeister des Waldes. In seine Höhlen ziehen später Kauz, Fledermaus und Hohltaube.',
  },

  // --- Insekten -----------------------------------------------------------------
  {
    id: 'oakmoth', name: 'Eichenwickler', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'crown', unlock: 3,
    food: ['laub'], needs: [],
    provides: ['insekten', 'raupen'],
    effects: [{ kind: 'damage', pct: 10 }, { kind: 'growth', pct: 2 }],
    summary: 'Fraß −10 % 🌿, +2 % 🌿 (Raupenkot)',
    text: 'Eine grüne Raupe, die sich in Blätter einrollt – Meisenfutter erster Güte.',
  },
  {
    id: 'bee', name: 'Wildbiene', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'edge', unlock: 2,
    food: ['nektar'], needs: [{ kind: 'group', group: 'flowers', min: 1 }, { kind: 'sunny' }],
    provides: ['insekten'],
    effects: [{ kind: 'groupSeeds', group: 'flowers', pct: 40 }, { kind: 'groupSeeds', group: 'shrubs', pct: 25 }, { kind: 'seeds', pct: 5 }],
    summary: 'Blumen +40 % 🌰, Sträucher +25 % 🌰, +5 % 🌰',
    text: 'Summt von Blüte zu Blüte und bringt Früchte hervor.',
  },
  {
    id: 'peacock', name: 'Tagpfauenauge', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'edge', unlock: 3,
    food: ['nektar'], needs: [{ kind: 'species', id: 'nettle' }, { kind: 'sunny' }],
    provides: ['insekten', 'raupen'],
    effects: [{ kind: 'seeds', pct: 10 }, { kind: 'groupSeeds', group: 'flowers', pct: 20 }],
    summary: '+10 % 🌰, Blumen +20 % 🌰',
    text: 'Vier blaue Augen auf rotem Grund. Die Raupen wachsen nur auf Brennnesseln.',
  },
  {
    id: 'barkbeetle', name: 'Borkenkäfer', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'bark', unlock: 3,
    food: ['laub', 'nadeln'], needs: [],
    provides: ['insekten', 'kaefer', 'totholz'],
    effects: [{ kind: 'damage', pct: 8 }, { kind: 'slot', niche: 'hollows', amount: 1 }],
    summary: 'Fraß −8 % 🌿, schafft Totholz: +1 Platz Höhlen',
    text: 'Zeichnet feine Gänge unter die Rinde. Schön anzusehen, schlecht für den Baum.',
  },
  {
    id: 'woodant', name: 'Rote Waldameise', genus: 'insects', rarity: 1, level: 'predator', niche: 'litter', unlock: 4,
    food: ['insekten'], needs: [{ kind: 'tag', tag: 'nadeln' }, { kind: 'sunny' }],
    provides: ['insekten'],
    effects: [{ kind: 'control', tag: 'raupen', pct: 40 }, { kind: 'groupSeeds', group: 'flowers', pct: 30 }, { kind: 'growth', pct: 3 }],
    summary: 'jagt Raupen (−40 % Fraß), Blumen +30 % 🌰, +3 % 🌿',
    text: 'Ein Hügel aus Nadeln, eine Million Schwestern – und sie tragen Samen davon.',
  },
  {
    id: 'glowworm', name: 'Glühwürmchen', genus: 'insects', rarity: 2, level: 'predator', niche: 'edge', unlock: 4,
    food: ['schnecken'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'group', group: 'flowers', min: 1 }],
    appears: [{ kind: 'tag', tag: 'schnecken' }],
    provides: ['insekten'],
    effects: [{ kind: 'control', tag: 'schnecken', pct: 60 }, { kind: 'harmony', points: 4 }, { kind: 'ability', id: 'communityBoost' }],
    summary: 'jagt Schnecken (−60 % Fraß), +4 ⚖️, Lichterabend',
    text: 'Seine Larven jagen Schnecken. An Juniabenden leuchtet der Waldsaum.',
  },
  {
    id: 'stagbeetle', name: 'Hirschkäfer', genus: 'insects', rarity: 3, level: 'decomposer', niche: 'hollows', unlock: 5,
    food: ['totholz'], needs: [{ kind: 'shady' }, { kind: 'genus', genus: 'fungi', min: 1 }, { kind: 'sunny' }],
    appears: [{ kind: 'tag', tag: 'totholz' }],
    provides: ['insekten', 'kaefer'],
    effects: [{ kind: 'growth', pct: 8 }, { kind: 'harmony', points: 5 }, { kind: 'ability', id: 'decomposerBoost' }],
    summary: '+8 % 🌿, +5 ⚖️, König des Totholzes',
    text: 'Seine Larven leben fünf Jahre im morschen Holz. Geduld ist alles.',
  },

  // --- Säugetiere ---------------------------------------------------------------
  {
    id: 'vole', name: 'Wühlmaus', genus: 'mammals', rarity: 0, level: 'herbivore', niche: 'roots', unlock: 1,
    food: ['wurzeln', 'kraut'], needs: [],
    provides: ['kleinsaeuger'],
    effects: [{ kind: 'damage', pct: 8 }, { kind: 'seeds', pct: 4 }],
    summary: 'Fraß −8 % 🌿, +4 % 🌰',
    text: 'Knabbert an zarten Wurzeln. Lecker findet sie vor allem der Kauz.',
  },
  {
    id: 'squirrel', name: 'Eichhörnchen', genus: 'mammals', rarity: 0, level: 'herbivore', niche: 'crown', unlock: 3,
    food: ['nuesse'], needs: [{ kind: 'group', group: 'trees', min: 2 }],
    provides: [],
    effects: [{ kind: 'seeds', pct: 12 }, { kind: 'growth', pct: 5 }, { kind: 'disturb', target: 'bluetit' }],
    summary: '+12 % 🌰, +5 % 🌿, stört die Blaumeise',
    text: 'Versteckt Hunderte Nüsse – und vergisst zum Glück viele davon.',
  },
  {
    id: 'deer', name: 'Reh', genus: 'mammals', rarity: 0, level: 'herbivore', niche: 'edge', unlock: 4,
    food: ['kraut', 'laub'], needs: [{ kind: 'group', group: 'shrubs', min: 1 }, { kind: 'sunny' }],
    provides: ['rehe'],
    effects: [{ kind: 'light', amount: 3 }, { kind: 'damage', pct: 10 }],
    summary: '+3 ☀️, Fraß −10 % 🌿',
    text: 'Zupft am liebsten die frischesten Triebe – und hält so den Saum offen.',
  },
  {
    id: 'mole', name: 'Maulwurf', genus: 'mammals', rarity: 1, level: 'predator', niche: 'roots', unlock: 2,
    food: ['wuermer', 'insekten'], needs: [],
    provides: [],
    effects: [{ kind: 'water', amount: 2 }, { kind: 'growth', pct: 4 }, { kind: 'disturb', target: 'earthworm' }],
    summary: '+2 💧, +4 % 🌿, stört den Regenwurm',
    text: 'Gräbt unermüdlich – zum Leidwesen der Regenwürmer.',
  },
  {
    id: 'hedgehog', name: 'Igel', genus: 'mammals', rarity: 1, level: 'predator', niche: 'litter', unlock: 3,
    food: ['schnecken', 'insekten', 'wuermer'], needs: [{ kind: 'group', group: 'shrubs', min: 1 }],
    provides: [],
    effects: [{ kind: 'control', tag: 'schnecken', pct: 70 }, { kind: 'growth', pct: 3 }],
    summary: 'jagt Schnecken (−70 % Fraß), +3 % 🌿',
    text: 'Schmatzt sich nachts durchs Laub. Schnecken sind sein Leibgericht.',
  },
  {
    id: 'fox', name: 'Rotfuchs', genus: 'mammals', rarity: 1, level: 'predator', niche: 'edge', unlock: 4,
    // Frisst seit den Lebensräumen auch Kaninchen und hält sie klein (DESIGN_V2.md 22.2):
    // −70 %, damit ein zufriedener Fuchs das Wildkaninchen allein „bewacht“.
    food: ['kleinsaeuger', 'hasen'], needs: [{ kind: 'group', group: 'shrubs', min: 2 }],
    provides: [],
    effects: [{ kind: 'control', tag: 'kleinsaeuger', pct: 50 }, { kind: 'control', tag: 'hasen', pct: 70 }, { kind: 'seeds', pct: 6 }],
    summary: 'jagt Kleinsäuger (−50 %) und Kaninchen (−70 % Fraß), +6 % 🌰',
    text: 'Springt mit einem Satz auf die Maus unter dem Laub – und verteilt Beerensamen.',
  },
  {
    id: 'bat', name: 'Braunes Langohr', genus: 'mammals', rarity: 2, level: 'predator', niche: 'hollows', unlock: 4,
    food: ['insekten'], needs: [{ kind: 'group', group: 'flowers', min: 2 }],
    appears: [{ kind: 'genus', genus: 'insects', min: 2 }],
    provides: [],
    effects: [{ kind: 'control', tag: 'insekten', pct: 40 }, { kind: 'seeds', pct: 8 }, { kind: 'ability', id: 'countsAsBird' }],
    summary: 'jagt Insekten (−40 % Fraß), +8 % 🌰, zählt als Vogel',
    text: 'Hört mit riesigen Ohren jeden Nachtfalter.',
  },
  {
    id: 'wolf', name: 'Wolf', genus: 'mammals', rarity: 3, level: 'predator', niche: 'edge', unlock: 6,
    food: ['rehe'], needs: [{ kind: 'group', group: 'trees', min: 3 }],
    appears: [{ kind: 'species', id: 'deer' }],
    provides: [],
    effects: [{ kind: 'growth', pct: 11 }, { kind: 'ability', id: 'fear' }],
    summary: '+11 % 🌿, Landschaft der Angst',
    text: 'Er ist zurück. Wo er durchzieht, wächst der Wald wieder dichter.',
  },

  // --- Bodenleben ---------------------------------------------------------------
  {
    id: 'earthworm', name: 'Regenwurm', genus: 'soil', rarity: 0, level: 'decomposer', niche: 'roots', unlock: 1,
    food: ['laub'], needs: [{ kind: 'tag', tag: 'feucht' }],
    provides: ['wuermer'],
    effects: [{ kind: 'water', amount: 2 }, { kind: 'growth', pct: 6 }],
    summary: '+6 % 🌿, +2 💧',
    text: 'Frisst sich durch die Erde und hinterlässt Gänge, durch die der Regen sickert.',
  },
  {
    id: 'woodlouse', name: 'Rollassel', genus: 'soil', rarity: 0, level: 'decomposer', niche: 'litter', unlock: 2,
    food: ['laub'], needs: [{ kind: 'tag', tag: 'totholz' }],
    provides: ['insekten'],
    effects: [{ kind: 'growth', pct: 6 }],
    summary: '+6 % 🌿',
    text: 'Rollt sich bei Gefahr zur Kugel und macht aus Laub fruchtbare Erde.',
  },
  {
    id: 'slug', name: 'Nacktschnecke', genus: 'soil', rarity: 0, level: 'herbivore', niche: 'litter', unlock: 2,
    food: ['kraut'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'shady' }],
    provides: ['schnecken'],
    effects: [{ kind: 'damage', pct: 6 }, { kind: 'water', amount: 1 }],
    summary: 'Fraß −6 % 🌿, +1 💧',
    text: 'Kommt nachts, wenn es feucht ist. Und sie hat Hunger.',
  },
  {
    id: 'centipede', name: 'Steinläufer', genus: 'soil', rarity: 1, level: 'predator', niche: 'litter', unlock: 3,
    food: ['insekten', 'wuermer'], needs: [{ kind: 'tag', tag: 'totholz' }],
    provides: [],
    effects: [{ kind: 'control', tag: 'insekten', pct: 30 }, { kind: 'growth', pct: 5 }],
    summary: 'jagt Insekten (−30 % Fraß), +5 % 🌿',
    text: 'Fünfzehn Beinpaare, flink und nachts auf der Jagd unter der Rinde.',
  },
  {
    id: 'snail', name: 'Weinbergschnecke', genus: 'soil', rarity: 2, level: 'decomposer', niche: 'litter', unlock: 4,
    food: ['laub', 'kraut'], needs: [{ kind: 'group', group: 'flowers', min: 2 }, { kind: 'tag', tag: 'feucht' }],
    appears: [{ kind: 'tag', tag: 'feucht' }],
    provides: ['schnecken'],
    effects: [{ kind: 'growth', pct: 9 }, { kind: 'water', amount: 2 }, { kind: 'ability', id: 'calm' }],
    summary: '+9 % 🌿, +2 💧, Gelassen',
    text: 'Trägt ihr Haus seit Jahren mit sich herum. Eile kennt sie nicht.',
  },
  {
    id: 'salamander', name: 'Feuersalamander', genus: 'soil', rarity: 3, level: 'predator', niche: 'litter', unlock: 5,
    food: ['schnecken', 'wuermer', 'insekten'], needs: [{ kind: 'group', group: 'mosses', min: 2 }, { kind: 'tag', tag: 'totholz' }, { kind: 'shady' }],
    appears: [{ kind: 'group', group: 'mosses', min: 2 }, { kind: 'tag', tag: 'totholz' }],
    provides: [],
    effects: [{ kind: 'growth', pct: 11 }, { kind: 'control', tag: 'schnecken', pct: 50 }, { kind: 'ability', id: 'mossNoWater' }],
    summary: '+11 % 🌿, jagt Schnecken (−50 % Fraß), Hüter der Feuchte',
    text: 'Schwarz-gelb und uralt. Wo er lebt, ist der Wald noch feucht und heil.',
  },

  // --- Amphibien (Erweiterung Waldtümpel, DESIGN_V2.md 5.5) -----------------------
  // Leben nur im Waldtümpel – Karten kommen erst, wenn er Plätze hat (Pflege oder
  // Ereignis). Der Feuersalamander bleibt Bodenleben (lebt an Land, siehe 5.1).
  {
    id: 'toad', name: 'Erdkröte', genus: 'amphibians', rarity: 0, level: 'predator', niche: 'pond', unlock: 4,
    food: ['schnecken', 'wuermer', 'insekten'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'shady' }],
    provides: ['amphibien'],
    effects: [{ kind: 'control', tag: 'schnecken', pct: 40 }, { kind: 'growth', pct: 4 }],
    summary: 'jagt Schnecken (−40 % Fraß), +4 % 🌿',
    text: 'Wandert jedes Frühjahr zurück zu dem Tümpel, in dem sie selbst geschlüpft ist.',
  },
  {
    id: 'frog', name: 'Grasfrosch', genus: 'amphibians', rarity: 0, level: 'predator', niche: 'pond', unlock: 4,
    food: ['insekten', 'wuermer'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'sunny' }],
    provides: ['amphibien'],
    effects: [{ kind: 'control', tag: 'insekten', pct: 20 }, { kind: 'seeds', pct: 5 }],
    summary: 'jagt Insekten (−20 % Fraß), +5 % 🌰',
    text: 'Laicht als einer der Ersten im Jahr – große Ballen im flachen, sonnigen Wasser.',
  },
  {
    id: 'newt', name: 'Bergmolch', genus: 'amphibians', rarity: 1, level: 'predator', niche: 'pond', unlock: 4,
    food: ['insekten', 'wuermer'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'shady' }, { kind: 'group', group: 'mosses', min: 1 }],
    provides: ['amphibien'],
    effects: [{ kind: 'control', tag: 'insekten', pct: 25 }, { kind: 'growth', pct: 5 }, { kind: 'harmony', points: 2 }],
    summary: 'jagt Insekten (−25 % Fraß), +5 % 🌿, +2 ⚖️',
    text: 'Im Frühling glänzt das Männchen blau, mit getupftem Kamm und orangem Bauch.',
  },
  // Playtest Amphibien: Laubfrosch (Sonnenseite, 🌰) und Kammmolch (Schattenseite, 🌿) –
  // mit 5 Arten ist die Gattungsstufe 5 erreichbar (Pflege 4 Plätze + 1 aus einem Ereignis).
  {
    id: 'treefrog', name: 'Laubfrosch', genus: 'amphibians', rarity: 1, level: 'predator', niche: 'pond', unlock: 4,
    food: ['insekten'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'sunny' }, { kind: 'group', group: 'shrubs', min: 1 }],
    provides: ['amphibien'],
    effects: [{ kind: 'control', tag: 'insekten', pct: 20 }, { kind: 'seeds', pct: 6 }, { kind: 'harmony', points: 2 }],
    summary: 'jagt Insekten (−20 % Fraß), +6 % 🌰, +2 ⚖️',
    text: 'Klettert mit Haftscheiben ins Gebüsch. In Mainächten trägt sein Ruf weit über den Tümpel.',
  },
  {
    id: 'crestednewt', name: 'Kammmolch', genus: 'amphibians', rarity: 1, level: 'predator', niche: 'pond', unlock: 5,
    food: ['schnecken', 'wuermer'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'shady' }, { kind: 'tag', tag: 'totholz' }],
    provides: ['amphibien'],
    effects: [{ kind: 'control', tag: 'schnecken', pct: 30 }, { kind: 'growth', pct: 6 }, { kind: 'harmony', points: 2 }],
    summary: 'jagt Schnecken (−30 % Fraß), +6 % 🌿, +2 ⚖️',
    text: 'Der größte unserer Molche. Zur Laichzeit trägt das Männchen einen gezackten Kamm wie ein kleiner Drache.',
  },

  // --- Pilze --------------------------------------------------------------------
  {
    id: 'chanterelle', name: 'Pfifferling', genus: 'fungi', rarity: 0, level: 'decomposer', niche: 'roots', unlock: 1,
    food: ['wurzeln'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'shady' }],
    provides: [],
    effects: [{ kind: 'groupGrowth', group: 'trees', pct: 8 }],
    summary: 'Bäume +8 % 🌿',
    text: 'Goldgelb im Moos – und unterirdisch mit den Baumwurzeln verbunden.',
  },
  {
    id: 'tinder', name: 'Zunderschwamm', genus: 'fungi', rarity: 0, level: 'decomposer', niche: 'bark', unlock: 3,
    food: ['laub'], needs: [{ kind: 'group', group: 'trees', min: 2 }],
    provides: ['totholz'],
    effects: [{ kind: 'growth', pct: 4 }, { kind: 'damage', pct: 3 }],
    summary: '+4 % 🌿, Fraß −3 % 🌿, schafft Totholz',
    text: 'Ein Hufeisen aus Holz am Stamm. Er macht aus altem Holz neues Leben.',
  },
  {
    id: 'porcini', name: 'Steinpilz', genus: 'fungi', rarity: 1, level: 'decomposer', niche: 'roots', unlock: 3,
    food: ['wurzeln'], needs: [{ kind: 'group', group: 'trees', min: 2 }, { kind: 'genus', genus: 'soil', min: 1 }],
    provides: [],
    effects: [{ kind: 'groupGrowth', group: 'trees', pct: 15 }, { kind: 'water', amount: 3 }],
    summary: 'Bäume +15 % 🌿, +3 💧',
    text: 'Feine Pilzfäden umspinnen die Wurzeln und tauschen Wasser gegen Zucker.',
  },
  {
    id: 'flyagaric', name: 'Fliegenpilz', genus: 'fungi', rarity: 2, level: 'decomposer', niche: 'roots', unlock: 4,
    food: ['wurzeln'], needs: [{ kind: 'species', id: 'birch' }, { kind: 'tag', tag: 'feucht' }],
    appears: [{ kind: 'species', id: 'birch' }],
    provides: [],
    effects: [{ kind: 'groupGrowth', group: 'trees', pct: 11 }, { kind: 'seeds', pct: 10 }, { kind: 'ability', id: 'rarityBoost' }],
    summary: 'Bäume +11 % 🌿, +10 % 🌰, Glückspilz',
    text: 'Rot mit weißen Tupfen, der treue Begleiter der Birke. Bringt Glück.',
  },
  {
    id: 'honeyfungus', name: 'Hallimasch', genus: 'fungi', rarity: 3, level: 'decomposer', niche: 'roots', unlock: 5,
    food: ['wurzeln', 'totholz'], needs: [{ kind: 'group', group: 'trees', min: 3 }, { kind: 'tag', tag: 'totholz' }, { kind: 'genus', genus: 'fungi', min: 2 }],
    appears: [{ kind: 'genus', genus: 'fungi', min: 2 }, { kind: 'tag', tag: 'totholz' }],
    provides: [],
    effects: [{ kind: 'growth', pct: 15 }, { kind: 'ability', id: 'minSupply' }],
    summary: '+15 % 🌿, Waldweites Netz',
    text: 'Das größte Lebewesen der Erde ist ein Pilz. Sein Netz verbindet den ganzen Wald.',
  },

  // --- Lebensräume (DESIGN_V2.md 23.4): Waldwiese, Totholzhaufen, Trockenmauer ----
  ...HABITAT_SPECIES,

  // --- Kennarten (DESIGN_V2.md 26.3) ---------------------------------------------
  // Je Wald der Landschaft eine seltene Art, die nur dort lebt und nur, wenn der Wald alt ist
  // (Bedingung `site`). Nur vorhandene Wirkungsarten, keine Fähigkeit; besonders, ab Hain.
  // Startwerte – Aufgabe 2c misst sie (±5 % je Waldtyp). Haselmaus und Ziegenmelker sind
  // nachtaktiv (daytime.ts). Erscheinen nie vor der Landschaft: `site` braucht ihre Freischaltung.
  {
    id: 'dormouse', name: 'Haselmaus', genus: 'mammals', rarity: 2, level: 'herbivore', niche: 'crown', unlock: 5,
    food: ['nuesse', 'beeren'], needs: [{ kind: 'group', group: 'shrubs', min: 1 }],
    appears: [{ kind: 'site', site: 'home' }],
    provides: [],
    effects: [{ kind: 'seeds', pct: 6 }, { kind: 'harmony', points: 4 }],
    summary: '+6 % 🌰, +4 ⚖️',
    text: 'Schläft sieben Monate im Jahr – und klettert in Sommernächten bis in die Haselspitzen.',
  },
  {
    id: 'beaver', name: 'Biber', genus: 'mammals', rarity: 2, level: 'herbivore', niche: 'pond', unlock: 5,
    food: ['laub', 'kraut'], needs: [{ kind: 'group', group: 'trees', min: 2 }],
    appears: [{ kind: 'site', site: 'floodplain' }],
    // Statt „+1 Platz Waldtümpel“ (26.3, Entwurf): Eine Platz-Wirkung in der eigenen Nische
    // machte dem Biber selbst Platz und öffnete als Stammgast einen geschlossenen Tümpel (Regel
    // „Platz-Wirkungen nie in der eigenen Nische“, tests/content.test.ts). Sein Damm schafft
    // darum Feuchte und Wasser – Startwert für 2c. Er wünscht sich Bäume zum Fällen, nicht
    // Feuchte: sonst deckte er seinen eigenen Wunsch (Regel in tests/content.test.ts).
    provides: ['feucht'],
    effects: [{ kind: 'water', amount: 2 }, { kind: 'harmony', points: 4 }],
    summary: '+2 💧, schafft Feuchte, +4 ⚖️',
    text: 'Er staut den Bach, und wo vorher ein Rinnsal war, quaken bald die Frösche.',
  },
  {
    id: 'moorfrog', name: 'Moorfrosch', genus: 'amphibians', rarity: 2, level: 'predator', niche: 'pond', unlock: 5,
    food: ['insekten', 'wuermer'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'group', group: 'mosses', min: 1 }],
    appears: [{ kind: 'site', site: 'carr' }],
    provides: ['amphibien'],
    effects: [{ kind: 'groupGrowth', group: 'mosses', pct: 10 }, { kind: 'harmony', points: 6 }],
    summary: 'Moose & Farne +10 % 🌿, +6 ⚖️',
    text: 'Ein paar Tage im Frühling sind die Männchen himmelblau. Dann ist das ganze Bruch ein Konzert.',
  },
  {
    id: 'hericium', name: 'Ästiger Stachelbart', genus: 'fungi', rarity: 2, level: 'decomposer', niche: 'bark', unlock: 5,
    food: ['totholz'], needs: [{ kind: 'tag', tag: 'totholz' }, { kind: 'shady' }],
    appears: [{ kind: 'site', site: 'beechwood' }],
    provides: [],
    effects: [{ kind: 'growth', pct: 6 }, { kind: 'harmony', points: 4 }],
    summary: '+6 % 🌿, +4 ⚖️',
    text: 'Wie ein weißer Korallenstock an einer toten Buche. Er wächst nur, wo der Wald sehr alt ist.',
  },
  {
    id: 'lynx', name: 'Luchs', genus: 'mammals', rarity: 2, level: 'predator', niche: 'edge', unlock: 5,
    food: ['rehe'], needs: [{ kind: 'group', group: 'trees', min: 3 }],
    appears: [{ kind: 'site', site: 'mountain' }, { kind: 'species', id: 'deer' }],
    provides: [],
    effects: [{ kind: 'growth', pct: 6 }, { kind: 'control', tag: 'rehe', pct: 30 }, { kind: 'harmony', points: 4 }],
    summary: '+6 % 🌿, hält Rehe klein (−30 % Fraß), +4 ⚖️',
    text: 'Pinselohren im Unterholz. Du siehst ihn nie – er sieht dich immer.',
  },
  {
    id: 'nightjar', name: 'Ziegenmelker', genus: 'birds', rarity: 2, level: 'predator', niche: 'edge', unlock: 5,
    food: ['insekten'], needs: [{ kind: 'sunny' }],
    appears: [{ kind: 'site', site: 'heath' }],
    provides: [],
    effects: [{ kind: 'seeds', pct: 5 }, { kind: 'harmony', points: 4 }],
    summary: '+5 % 🌰, +4 ⚖️',
    text: 'Schnurrt in der Dämmerung wie eine Nähmaschine. Am Tag ist er ein Stück Kiefernrinde.',
  },
];

export const SPECIES_BY_ID: ReadonlyMap<string, Species> = new Map(SPECIES.map((s) => [s.id, s]));

/**
 * Wald einer Kennart (DESIGN_V2.md 26.3): der Standort ihrer Bedingung `site`, sonst null (keine
 * Kennart). Kennarten zählen nicht zu „alle Arten“ (Erfolg `species-all`), sondern eigens.
 */
export function kennartSite(sp: Pick<Species, 'appears'> | undefined): SiteId | null {
  for (const c of sp?.appears ?? []) if (c.kind === 'site') return c.site;
  return null;
}

/** Ist diese Art-ID eine Kennart? (Unbekannte IDs: nein.) */
export function isKennart(id: string): boolean {
  return kennartSite(SPECIES_BY_ID.get(id)) !== null;
}

/** Die Kennarten in SPECIES-Reihenfolge. */
export const KENNARTEN: readonly Species[] = SPECIES.filter((s) => kennartSite(s) !== null);

/** Alle übrigen Arten – „alle Bewohner“ ohne Landschaft (Erfolg `species-all`, Zähler „n von m“). */
export const COMMON_SPECIES: readonly Species[] = SPECIES.filter((s) => kennartSite(s) === null);

/** Anzeigenamen der Merkmale (für Wünsche und Nahrung auf Karten). */
export const TAG_NAMES: Readonly<Record<Tag, string>> = {
  laub: 'Laub',
  wurzeln: 'Wurzeln',
  nuesse: 'Nüsse',
  nadeln: 'Nadeln',
  beeren: 'Beeren',
  nektar: 'Nektar',
  kraut: 'Kräuter',
  feucht: 'Feuchte',
  totholz: 'Totholz',
  hoehle: 'Baumhöhle',
  insekten: 'Insekten',
  raupen: 'Raupen',
  kaefer: 'Käfer',
  wuermer: 'Würmer',
  schnecken: 'Schnecken',
  kleinsaeuger: 'Kleinsäuger',
  rehe: 'Rehe',
  amphibien: 'Amphibien',
  echsen: 'Echsen',
  hasen: 'Kaninchen',
};
