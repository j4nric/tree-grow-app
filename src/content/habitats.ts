import type { CareMeasure } from './care';
import type { Community } from './communities';
import type { Niche } from './niches';
import type { Species } from './species';
import type { TraitTier } from './traits';
import type { NicheId } from './types';

/**
 * Lebensräume nach dem Muster Waldtümpel (docs/DESIGN_V2.md 23, Phase 6 Welle 3):
 * 🌾 Waldwiese, 🪵 Totholzhaufen und 🪨 Trockenmauer – je eine Nische ohne Plätze aus der
 * Stufe, die nur durch Pflege (und das Käferjahr) öffnet, mit eigenen Arten, einer
 * Lebensgemeinschaft und der Gattung Reptilien.
 *
 * Verdrahtet seit Spielstand v13 (Schritt B, 23.7): Die Listen hier fließen in `NICHES`,
 * `SPECIES`, `TRAITS`, `COMMUNITIES` und `CARE` (der Totholzhaufen steht direkt in care.ts);
 * `GENUS_INFO`, `TAG_NAMES` und der Sommer (Reptilien +15 % 😊) stehen in ihren Dateien.
 * Inhaltstest: `tests/habitats.test.ts`.
 */

/** Die Nischen der Lebensräume (23.2). */
export type HabitatNicheId = Extract<NicheId, 'meadow' | 'deadwood' | 'wall'>;

// ---------------------------------------------------------------------------
// Nischen
// ---------------------------------------------------------------------------

/**
 * Wie der Waldtümpel: keine Plätze aus der Stufe, `opensEarly` – Plätze kommen nur über
 * die Wirkung `slot` aus Pflege und Ereignissen. Karten zieht das Spiel nur für offene
 * Nischen, darum erscheinen die Bewohner erst mit ihrem Lebensraum.
 */
export const HABITAT_NICHES: readonly (Niche & { id: HabitatNicheId })[] = [
  {
    id: 'meadow', name: 'Waldwiese', icon: '🌾', place: 'Lichtung mit hohem Gras neben dem Baum',
    slots: [0, 0, 0, 0, 0, 0, 0, 0], opensEarly: true,
  },
  {
    id: 'deadwood', name: 'Totholzhaufen', icon: '🪵', place: 'Reisig und alte Äste am Boden',
    slots: [0, 0, 0, 0, 0, 0, 0, 0], opensEarly: true,
  },
  {
    id: 'wall', name: 'Trockenmauer', icon: '🪨', place: 'Lesesteine in der Sonne',
    slots: [0, 0, 0, 0, 0, 0, 0, 0], opensEarly: true,
  },
];

// ---------------------------------------------------------------------------
// Gattung Reptilien (23.3)
// ---------------------------------------------------------------------------

export const REPTILE_INFO = { name: 'Reptilien', icon: '🦎' } as const;

/**
 * Gattungsbonus Reptilien (Schwellen 2 / 3 / 5 wie alle). Fünf Arten auf drei Lebensräume
 * verteilt: Die Stufe 5 braucht Waldwiese, Totholzhaufen und Trockenmauer – ein Spätziel
 * wie bei den Amphibien.
 */
export const REPTILE_TRAITS: readonly TraitTier[] = [
  { effects: [{ kind: 'seeds', pct: 8 }], text: '+8 % Samen' },
  { effects: [{ kind: 'growth', pct: 6 }], text: '+6 % Wachstum' },
  { effects: [{ kind: 'growth', pct: 12 }, { kind: 'seeds', pct: 10 }], text: '+12 % Wachstum, +10 % Samen' },
];

/** Jahreszeit (16.3): Sonnenbad im Sommer (steht in SEASONS). Im Winter Winterstarre ohne Abzug (wie Amphibien). */
export const REPTILE_SUMMER_HAPPINESS = 15;

// ---------------------------------------------------------------------------
// Arten (14)
// ---------------------------------------------------------------------------

export const HABITAT_SPECIES: readonly (Species & { niche: HabitatNicheId })[] = [
  // --- 🌾 Waldwiese (Junger Baum) ---------------------------------------------
  {
    id: 'cricket', name: 'Feldgrille', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'meadow', unlock: 3,
    food: ['kraut'], needs: [{ kind: 'sunny' }],
    provides: ['insekten'],
    effects: [{ kind: 'seeds', pct: 7 }],
    summary: '+7 % 🌰',
    text: 'Zirpt vor ihrer Erdröhre – an warmen Abenden singt die ganze Wiese.',
  },
  {
    id: 'fieldmouse', name: 'Feldmaus', genus: 'mammals', rarity: 0, level: 'herbivore', niche: 'meadow', unlock: 3,
    food: ['kraut', 'wurzeln'], needs: [{ kind: 'sunny' }],
    provides: ['kleinsaeuger'],
    effects: [{ kind: 'damage', pct: 4 }, { kind: 'seeds', pct: 6 }],
    summary: 'Fraß −4 % 🌿, +6 % 🌰',
    text: 'Legt unter der Wiese Vorräte an – was sie vergisst, keimt im Frühling.',
  },
  {
    id: 'rabbit', name: 'Wildkaninchen', genus: 'mammals', rarity: 0, level: 'herbivore', niche: 'meadow', unlock: 3,
    food: ['kraut'], needs: [{ kind: 'sunny' }, { kind: 'group', group: 'shrubs', min: 1 }],
    provides: ['hasen'],
    effects: [{ kind: 'light', amount: 2 }, { kind: 'seeds', pct: 4 }, { kind: 'damage', pct: 4 }],
    summary: '+2 ☀️ (hält die Wiese kurz), +4 % 🌰, Fraß −4 % 🌿',
    text: 'Hält die Wiese kurz und offen. Wo Kaninchen wohnen, ist der Fuchs nicht weit.',
  },
  {
    id: 'lizard', name: 'Waldeidechse', genus: 'reptiles', rarity: 0, level: 'predator', niche: 'meadow', unlock: 3,
    food: ['insekten'], needs: [{ kind: 'sunny' }, { kind: 'tag', tag: 'feucht' }],
    provides: ['echsen'],
    effects: [{ kind: 'control', tag: 'insekten', pct: 15 }, { kind: 'growth', pct: 4 }],
    summary: 'jagt Insekten (−15 % Fraß), +4 % 🌿',
    text: 'Bringt ihre Jungen lebend zur Welt – darum mag sie auch kühle, feuchte Lichtungen.',
  },
  {
    id: 'kestrel', name: 'Turmfalke', genus: 'birds', rarity: 1, level: 'predator', niche: 'meadow', unlock: 4,
    food: ['kleinsaeuger', 'echsen', 'insekten'], needs: [{ kind: 'sunny' }, { kind: 'tag', tag: 'hoehle' }],
    provides: [],
    effects: [{ kind: 'control', tag: 'kleinsaeuger', pct: 40 }, { kind: 'growth', pct: 5 }],
    summary: 'jagt Kleinsäuger (−40 % Fraß), +5 % 🌿',
    text: 'Rüttelt still im Wind über der Wiese – dann stößt er auf eine Maus.',
  },
  // --- 🪵 Totholzhaufen (Alter Baum) ------------------------------------------
  {
    id: 'wren', name: 'Zaunkönig', genus: 'birds', rarity: 0, level: 'predator', niche: 'deadwood', unlock: 4,
    food: ['insekten'], needs: [{ kind: 'tag', tag: 'totholz' }],
    provides: [],
    effects: [{ kind: 'control', tag: 'insekten', pct: 15 }, { kind: 'seeds', pct: 6 }],
    summary: 'jagt Insekten (−15 % Fraß), +6 % 🌰',
    text: 'Winzig, mit steil gestelltem Schwanz – und einer Stimme, die den ganzen Wald füllt.',
  },
  {
    id: 'rosechafer', name: 'Rosenkäfer', genus: 'insects', rarity: 0, level: 'decomposer', niche: 'deadwood', unlock: 4,
    food: ['totholz', 'laub'], needs: [{ kind: 'group', group: 'flowers', min: 1 }],
    provides: ['insekten', 'kaefer'],
    effects: [{ kind: 'growth', pct: 5 }, { kind: 'groupSeeds', group: 'flowers', pct: 15 }],
    summary: '+5 % 🌿, Blumen +15 % 🌰',
    text: 'Die Larven machen aus morschem Holz Erde, der Käfer glänzt grüngolden auf den Blüten.',
  },
  {
    id: 'turkeytail', name: 'Schmetterlingstramete', genus: 'fungi', rarity: 0, level: 'decomposer', niche: 'deadwood', unlock: 4,
    food: ['totholz'], needs: [{ kind: 'tag', tag: 'feucht' }],
    provides: [],
    effects: [{ kind: 'growth', pct: 6 }],
    summary: '+6 % 🌿',
    text: 'Bunte Fächer auf jedem alten Ast – sie macht Holz zu Humus.',
  },
  {
    id: 'slowworm', name: 'Blindschleiche', genus: 'reptiles', rarity: 0, level: 'predator', niche: 'deadwood', unlock: 4,
    food: ['schnecken', 'wuermer'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'shady' }],
    provides: ['echsen'],
    effects: [{ kind: 'control', tag: 'schnecken', pct: 40 }, { kind: 'growth', pct: 4 }],
    summary: 'jagt Schnecken (−40 % Fraß), +4 % 🌿',
    text: 'Keine Schlange, sondern eine Echse ohne Beine – und eine geduldige Schneckenjägerin.',
  },
  {
    id: 'weasel', name: 'Mauswiesel', genus: 'mammals', rarity: 1, level: 'predator', niche: 'deadwood', unlock: 4,
    food: ['kleinsaeuger'], needs: [{ kind: 'tag', tag: 'totholz' }, { kind: 'group', group: 'shrubs', min: 1 }],
    provides: [],
    effects: [{ kind: 'control', tag: 'kleinsaeuger', pct: 60 }, { kind: 'growth', pct: 5 }],
    summary: 'jagt Kleinsäuger (−60 % Fraß), +5 % 🌿',
    text: 'Schlank genug, um Mäusen bis in ihre Gänge zu folgen.',
  },
  // --- 🪨 Trockenmauer (Hain) -------------------------------------------------
  {
    id: 'sandlizard', name: 'Zauneidechse', genus: 'reptiles', rarity: 0, level: 'predator', niche: 'wall', unlock: 5,
    food: ['insekten'], needs: [{ kind: 'sunny' }],
    provides: ['echsen'],
    effects: [{ kind: 'control', tag: 'insekten', pct: 15 }, { kind: 'seeds', pct: 7 }],
    summary: 'jagt Insekten (−15 % Fraß), +7 % 🌰',
    text: 'Im Frühling leuchten die Flanken der Männchen grün. Morgens wärmt sie sich auf dem Stein.',
  },
  {
    id: 'masonbee', name: 'Rote Mauerbiene', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'wall', unlock: 5,
    food: ['nektar'], needs: [{ kind: 'sunny' }, { kind: 'group', group: 'shrubs', min: 1 }],
    provides: ['insekten'],
    effects: [{ kind: 'groupSeeds', group: 'shrubs', pct: 30 }, { kind: 'groupSeeds', group: 'trees', pct: 15 }, { kind: 'seeds', pct: 4 }],
    summary: 'Sträucher +30 % 🌰, Bäume +15 % 🌰, +4 % 🌰',
    text: 'Nistet in Mauerritzen und bestäubt im April die ersten Blüten.',
  },
  {
    id: 'grasssnake', name: 'Ringelnatter', genus: 'reptiles', rarity: 1, level: 'predator', niche: 'wall', unlock: 5,
    food: ['amphibien'], needs: [{ kind: 'sunny' }, { kind: 'tag', tag: 'feucht' }],
    provides: [],
    effects: [{ kind: 'growth', pct: 6 }, { kind: 'harmony', points: 2 }],
    summary: '+6 % 🌿, +2 ⚖️',
    text: 'Gelbe Halbmonde hinter dem Kopf: harmlos, scheu – und eine gute Schwimmerin.',
  },
  {
    id: 'smoothsnake', name: 'Schlingnatter', genus: 'reptiles', rarity: 1, level: 'predator', niche: 'wall', unlock: 5,
    food: ['echsen', 'kleinsaeuger'], needs: [{ kind: 'sunny' }, { kind: 'tag', tag: 'totholz' }],
    provides: [],
    effects: [{ kind: 'control', tag: 'kleinsaeuger', pct: 30 }, { kind: 'growth', pct: 5 }, { kind: 'harmony', points: 2 }],
    summary: 'jagt Kleinsäuger (−30 % Fraß), +5 % 🌿, +2 ⚖️',
    text: 'Selten gesehen: Sie jagt Eidechsen und Mäuse und hält sie umschlungen wie eine kleine Würgeschlange.',
  },
];

// ---------------------------------------------------------------------------
// Lebensgemeinschaften (9.2)
// ---------------------------------------------------------------------------

export const HABITAT_COMMUNITIES: readonly Community[] = [
  {
    id: 'meadow-song', name: 'Wiesenkonzert', icon: '🌾', members: ['cricket', ['bee', 'peacock'], 'kestrel'],
    harmony: 6, effects: [], hint: 'Zirpen, Summen – und hoch darüber ein Rütteln in der Luft.',
  },
  {
    id: 'brushpile', name: 'Unterm Reisig', icon: '🍂', members: ['wren', ['rosechafer', 'turkeytail'], ['slowworm', 'weasel']],
    harmony: 6, effects: [], hint: 'Wo Reisig liegt, singt, nagt und lauert es.',
  },
  {
    id: 'sun-wall', name: 'Sonnenmauer', icon: '🪨', members: ['sandlizard', 'masonbee', ['grasssnake', 'smoothsnake']],
    harmony: 6, effects: [], hint: 'Warme Steine, summende Ritzen, ein Rascheln im Moos.',
  },
  {
    id: 'snake-pond', name: 'Natter am Ufer', icon: '🐍', members: ['grasssnake', ['frog', 'toad'], ['newt', 'treefrog', 'crestednewt']],
    harmony: 6, effects: [], hint: 'Am Ufer liegt jemand in der Sonne und wartet geduldig.',
  },
];

// ---------------------------------------------------------------------------
// Pflege (8.1): Lebensräume öffnen
// ---------------------------------------------------------------------------

const slot = (niche: NicheId, amount: number) => ({ kind: 'cycle', effect: { kind: 'slot', niche, amount } }) as const;

/**
 * Die zwei neuen Maßnahmen (in CARE eingereiht). Die erweiterte „Totholzhaufen“ (Rang 1
 * 4.500 🌰 mit +2 Plätzen Totholzhaufen, Rang 2 +1 Platz) steht direkt in care.ts.
 */
export const MEADOW_CARE: CareMeasure = {
    id: 'meadow', name: 'Waldwiese', icon: '🌾',
    text: 'Einmal im Jahr gemäht, sonst in Ruhe gelassen – so blüht und zirpt die Lichtung.',
    boughtText: 'Wiese angelegt',
    ranks: [
      { cost: 2_400, minStage: 3, summary: '+2 Plätze Waldwiese', effects: [slot('meadow', 2)] },
      {
        cost: 16_000, minStage: 5, summary: '+2 Plätze Waldwiese, +2 ☀️',
        effects: [slot('meadow', 2), { kind: 'cycle', effect: { kind: 'light', amount: 2 } }],
      },
    ],
};

export const WALL_CARE: CareMeasure = {
    id: 'drystone-wall', name: 'Trockenmauer', icon: '🪨',
    text: 'Lesesteine ohne Mörtel, in der Sonne geschichtet – jede Ritze ein Zuhause.',
    boughtText: 'Mauer geschichtet',
    ranks: [
      {
        cost: 12_000, minStage: 5, summary: '+2 Plätze Trockenmauer, +2 ☀️',
        effects: [slot('wall', 2), { kind: 'cycle', effect: { kind: 'light', amount: 2 } }],
      },
      {
        // 36.000 statt 32.000 🌰 aus dem Entwurf: Jeder Rang kostet mindestens das Dreifache (care.ts).
        cost: 36_000, minStage: 6, summary: '+2 Plätze Trockenmauer, +2 ⚖️',
        effects: [slot('wall', 2), { kind: 'cycle', effect: { kind: 'harmony', points: 2 } }],
      },
    ],
};

export const HABITAT_CARE: readonly CareMeasure[] = [MEADOW_CARE, WALL_CARE];
