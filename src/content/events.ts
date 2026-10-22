import { PREDATION_EVENTS } from './predation';
import type { Condition, Effect, Tag } from './types';

/**
 * Ereignisse mit Wahl (docs/DESIGN_V2.md 7.4). Reine Daten – die Logik steht in
 * src/core/tick.ts (chooseEventOption) und formulas.ts (Wirkungen, DESIGN_V2.md 7.8).
 *
 * Regeln:
 * - Jedes Ereignis kommt höchstens einmal pro Zyklus (gilt als „gesehen“, sobald es
 *   gezogen wird – auch wenn es noch in der Warteschlange wartet).
 * - Es kommt nur in Frage ab `minStage` und wenn alle `appears`-Bedingungen erfüllt
 *   sind (gleiche Prüfung wie bei den Arten: `speciesAppears`).
 * - Keine Option ist eine Strafe: Jede Wirkung bringt etwas (alle Zahlen > 0). Es gibt
 *   kein „Ablehnen“ – die Samen-Option ist die neutrale Wahl.
 */

/**
 * Wirkungen, die eine Zeit lang gelten (`timed`) – wie die gleichnamigen Tier-Wirkungen,
 * aber NICHT mit Zufriedenheit skaliert (Faktor 1, wie bei Lebensgemeinschaften).
 */
export type TimedEffect = Extract<Effect, { kind: 'growth' | 'seeds' | 'groupGrowth' | 'groupSeeds' }>;

/**
 * Wirkungen, die bis zum Neuen Zyklus gelten (`cycle`), Faktor 1:
 * - `light` / `water`: zusätzliches Licht bzw. Wasser für die Begleitpflanzen.
 * - `slot`: zusätzliche Plätze in einer Nische. Wie bei Tieren öffnet das eine noch
 *   geschlossene Nische nur, wenn sie `opensEarly` hat (Höhlen & Totholz).
 * - `harmony`: Harmonie-Punkte (zählen wie die Sonderpunkte der Tiere).
 */
export type CycleEffect = Extract<Effect, { kind: 'light' | 'water' | 'slot' | 'harmony' }>;

/** Begegnungstypen, die ein Ereignis als nächste Begegnung erzwingen kann. */
export type ForcedEncounterType = 'animal' | 'plant';

/**
 * Wirkung einer Ereignis-Option. Alle Zahlen sind positiv.
 *
 * - `seedsNow`: Sofort Samen = `seconds` × aktuelle Samenrate (🌰/s laut `evaluate`,
 *   inklusive gerade aktiver Boni), mindestens SEED_SECONDS_MIN_SEEDS. So bleibt der
 *   Wert in jeder Stufe gleich spürbar („2 Minuten Samen“).
 * - `timed`: `effect` gilt für `seconds` Sekunden Spielzeit (online wie offline, siehe
 *   DESIGN_V2.md 7.8). Derselbe Bonus aus zwei Quellen addiert sich wie bei Tieren.
 * - `cycle`: `effect` gilt bis zum Neuen Zyklus.
 * - `habitat`: Das Ökosystem stellt bis zum Neuen Zyklus das Merkmal `tag` bereit
 *   (1 Einheit Angebot wie eine Begleitpflanze; zählt für Nahrung, Wünsche und
 *   Erscheinungsbedingungen, z. B. Totholz für den Buntspecht).
 * - `nextEncounter`: Die nächste gezogene Begegnung (nicht festgelegte Wegpunkte) ist
 *   vom Typ `type` und bietet zuerst Karten aus `ids` an – zufällig daraus gezogen
 *   (Zufall des Spielstands), höchstens FORCED_MAX_CARDS (encounters.ts) – die übrige Karte
 *   wird normal gezogen, damit eine andere Wahl bleibt. Arten nur, wenn sie
 *   freigeschaltet sind, noch nicht im Ökosystem leben und ihre Nische offen ist
 *   (Seltenheit und Erscheinungsbedingung werden übergangen); Pflanzen nur, wenn sie
 *   freigeschaltet sind. Fehlende Karten werden normal gezogen. Passt keine ID mehr,
 *   verfällt der Vorzug still.
 */
export type EventEffect =
  | { kind: 'seedsNow'; seconds: number }
  | { kind: 'timed'; seconds: number; effect: TimedEffect }
  | { kind: 'cycle'; effect: CycleEffect }
  | { kind: 'habitat'; tag: Tag }
  | { kind: 'nextEncounter'; type: ForcedEncounterType; ids: readonly string[] };

export interface EventOption {
  /** Knopftext, kurz und im Imperativ bzw. als Handlung. */
  label: string;
  /** Wirkung in Kurzform für die Karte, z. B. „+25 % 🌿 für 5 min“. */
  summary: string;
  effects: readonly EventEffect[];
}

export interface GameEvent {
  id: string;
  name: string;
  icon: string;
  /** Stimmungstext (ein Satz). */
  text: string;
  /** Ab dieser Stufe (Index in STAGES). Ereignisse gibt es ab Junger Baum (3). */
  minStage: number;
  /** Bedingungen wie `Species.appears` (alle müssen erfüllt sein). */
  appears?: readonly Condition[];
  /** 2–3 Optionen. */
  options: readonly EventOption[];
}

/** Untergrenze für Samen aus `seedsNow` und Durchreisenden (wie Ablehnen). */
export const SEED_SECONDS_MIN_SEEDS = 5;

export const EVENTS: readonly GameEvent[] = [
  // --- ab Junger Baum ---------------------------------------------------------
  {
    id: 'storm', name: 'Sturmnacht', icon: '🌩️', minStage: 3,
    text: 'Ein Ast ist abgebrochen und liegt im Laub.',
    options: [
      {
        label: 'Totholz liegen lassen', summary: 'Totholz, +1 Platz in Höhlen & Totholz (Zyklus)',
        effects: [{ kind: 'habitat', tag: 'totholz' }, { kind: 'cycle', effect: { kind: 'slot', niche: 'hollows', amount: 1 } }],
      },
      { label: 'Holz verwerten', summary: '2 min 🌰 sofort', effects: [{ kind: 'seedsNow', seconds: 120 }] },
    ],
  },
  {
    id: 'rain', name: 'Regenreicher Frühling', icon: '🌧️', minStage: 3,
    text: 'In einer Senke sammelt sich das Wasser.',
    options: [
      {
        label: 'Waldtümpel entstehen lassen', summary: 'Feuchte, +3 💧, +1 Platz Waldtümpel (Zyklus)',
        effects: [
          { kind: 'habitat', tag: 'feucht' },
          { kind: 'cycle', effect: { kind: 'water', amount: 3 } },
          { kind: 'cycle', effect: { kind: 'slot', niche: 'pond', amount: 1 } },
        ],
      },
      {
        label: 'Alles austreiben lassen', summary: '+25 % 🌿 für 5 min',
        effects: [{ kind: 'timed', seconds: 300, effect: { kind: 'growth', pct: 25 } }],
      },
      { label: 'Wasser ableiten', summary: '1½ min 🌰 sofort', effects: [{ kind: 'seedsNow', seconds: 90 }] },
    ],
  },
  {
    id: 'midsummer', name: 'Mittsommer', icon: '☀️', minStage: 3,
    text: 'Die längsten Tage des Jahres – das Licht reicht bis tief in den Abend.',
    options: [
      {
        label: 'Lange Tage nutzen', summary: '+30 % 🌿 für 6 min',
        effects: [{ kind: 'timed', seconds: 360, effect: { kind: 'growth', pct: 30 } }],
      },
      {
        label: 'Alles blühen lassen', summary: '+60 % 🌰 für 6 min',
        effects: [{ kind: 'timed', seconds: 360, effect: { kind: 'seeds', pct: 60 } }],
      },
    ],
  },
  {
    id: 'mushroom-autumn', name: 'Pilzherbst', icon: '🍄', minStage: 3,
    text: 'Über Nacht stehen überall Hüte im Moos.',
    appears: [{ kind: 'tag', tag: 'feucht' }],
    options: [
      {
        label: 'Den Hüten Zeit lassen', summary: 'nächste Begegnung: Pilze',
        effects: [{ kind: 'nextEncounter', type: 'animal', ids: ['chanterelle', 'porcini', 'tinder', 'flyagaric'] }],
      },
      {
        label: 'Myzel wachsen lassen', summary: 'Bäume +40 % 🌿 für 8 min',
        effects: [{ kind: 'timed', seconds: 480, effect: { kind: 'groupGrowth', group: 'trees', pct: 40 } }],
      },
      { label: 'Pilze sammeln', summary: '1½ min 🌰 sofort', effects: [{ kind: 'seedsNow', seconds: 90 }] },
    ],
  },
  // Jahreszeiten-Ereignisse (EVENT_SEASONS in seasons.ts, DESIGN_V2.md 16.4)
  {
    id: 'late-frost', name: 'Spätfrost', icon: '🧊', minStage: 3,
    text: 'Eine klare Mainacht – der Frost hat die jungen Blätter geschwärzt.',
    options: [
      {
        label: 'Neu austreiben lassen', summary: '+30 % 🌿 für 5 min',
        effects: [{ kind: 'timed', seconds: 300, effect: { kind: 'growth', pct: 30 } }],
      },
      {
        label: 'Den Frühblühern das Licht lassen', summary: 'Blumen +60 % 🌿 für 8 min',
        effects: [{ kind: 'timed', seconds: 480, effect: { kind: 'groupGrowth', group: 'flowers', pct: 60 } }],
      },
      { label: 'Reserven schonen', summary: '1½ min 🌰 sofort', effects: [{ kind: 'seedsNow', seconds: 90 }] },
    ],
  },
  {
    id: 'heatwave', name: 'Hitzewelle', icon: '🌡️', minStage: 3,
    text: 'Wochenlang kein Regen – schon im Juli rascheln die ersten gelben Blätter.',
    options: [
      // Hydraulischer Lift: Tiefe Wurzeln heben nachts Wasser in den trockenen Oberboden.
      { label: 'Tiefer wurzeln', summary: '+2 💧 (Zyklus)', effects: [{ kind: 'cycle', effect: { kind: 'water', amount: 2 } }] },
      {
        label: 'Früh reifen lassen', summary: '+50 % 🌰 für 6 min',
        effects: [{ kind: 'timed', seconds: 360, effect: { kind: 'seeds', pct: 50 } }],
      },
    ],
  },
  {
    id: 'leaf-fall', name: 'Laubfall', icon: '🍁', minStage: 3,
    text: 'Ein Herbststurm hat die Krone geleert – knöcheltief liegt das Laub.',
    options: [
      {
        // Keine Nacktschnecke: Ein Fraß-Tier wäre als Belohnung eine versteckte Strafe.
        label: 'Laub den Bodentieren lassen', summary: 'nächste Begegnung: Laubbewohner',
        effects: [{ kind: 'nextEncounter', type: 'animal', ids: ['hedgehog', 'centipede', 'woodlouse', 'snail'] }],
      },
      { label: 'Zu Humus werden lassen', summary: '+4 ⚖️ (Zyklus)', effects: [{ kind: 'cycle', effect: { kind: 'harmony', points: 4 } }] },
    ],
  },
  {
    id: 'snow-break', name: 'Schneebruch', icon: '🌨️', minStage: 3,
    text: 'Nasser Schnee lastet auf der Krone – krachend bricht ein Ast.',
    options: [
      {
        // Nur Arten, die ab Junger Baum kommen können (Höhlen & Totholz ist dort noch zu).
        label: 'Den Ast liegen lassen', summary: 'Totholz, nächste Begegnung: Totholzbewohner',
        effects: [
          { kind: 'habitat', tag: 'totholz' },
          { kind: 'nextEncounter', type: 'animal', ids: ['tinder', 'barkbeetle', 'centipede', 'woodlouse'] },
        ],
      },
      {
        label: 'Reisig aufschichten', summary: '+1 Platz Laubstreu (Zyklus)',
        effects: [{ kind: 'cycle', effect: { kind: 'slot', niche: 'litter', amount: 1 } }],
      },
      { label: 'Äste räumen', summary: '2 min 🌰 sofort', effects: [{ kind: 'seedsNow', seconds: 120 }] },
    ],
  },
  // --- ab Alter Baum ----------------------------------------------------------
  {
    id: 'windthrow', name: 'Windwurf', icon: '🌪️', minStage: 4,
    text: 'Ein alter Nachbarbaum ist umgestürzt – plötzlich ist es hell.',
    options: [
      { label: 'Lichtung offen lassen', summary: '+3 ☀️ (Zyklus)', effects: [{ kind: 'cycle', effect: { kind: 'light', amount: 3 } }] },
      { label: 'Stamm verwerten', summary: '2½ min 🌰 sofort', effects: [{ kind: 'seedsNow', seconds: 150 }] },
    ],
  },
  {
    id: 'mast-year', name: 'Mastjahr', icon: '🌰', minStage: 4,
    text: 'Die Eiche trägt so viele Eicheln wie seit Jahren nicht.',
    // Für die Eiche ab Alter Baum immer erfüllt; die Kiefer (trees.ts) trägt keine Nüsse.
    appears: [{ kind: 'tag', tag: 'nuesse' }],
    options: [
      {
        label: 'Eicheln liegen lassen', summary: 'nächste Begegnung: Samenverbreiter',
        effects: [{ kind: 'nextEncounter', type: 'animal', ids: ['jay', 'squirrel'] }],
      },
      {
        label: 'Eicheln sammeln', summary: '+50 % 🌰 für 8 min',
        effects: [{ kind: 'timed', seconds: 480, effect: { kind: 'seeds', pct: 50 } }],
      },
    ],
  },
  {
    id: 'bee-swarm', name: 'Bienenschwarm', icon: '🐝', minStage: 4,
    text: 'Eine summende Traube Honigbienen hängt im Geäst und sucht eine Bleibe.',
    appears: [{ kind: 'tag', tag: 'hoehle' }],
    options: [
      {
        label: 'Die Höhle überlassen', summary: 'Blumen und Sträucher +60 % 🌰 für 10 min',
        effects: [
          { kind: 'timed', seconds: 600, effect: { kind: 'groupSeeds', group: 'flowers', pct: 60 } },
          { kind: 'timed', seconds: 600, effect: { kind: 'groupSeeds', group: 'shrubs', pct: 60 } },
        ],
      },
      { label: 'Weiterziehen lassen', summary: '1½ min 🌰 sofort', effects: [{ kind: 'seedsNow', seconds: 90 }] },
    ],
  },
  {
    id: 'bird-sown', name: 'Vogelsaat', icon: '🫐', minStage: 4,
    text: 'Die Vögel haben Beerensamen mitgebracht – überall spitzt es grün.',
    appears: [{ kind: 'genus', genus: 'birds', min: 2 }],
    options: [
      {
        label: 'Sämlinge stehen lassen', summary: 'nächste Begegnung: Beerensträucher',
        effects: [{ kind: 'nextEncounter', type: 'plant', ids: ['rowan', 'elder', 'bramble'] }],
      },
      {
        label: 'Beeren reifen lassen', summary: '+40 % 🌰 für 6 min',
        effects: [{ kind: 'timed', seconds: 360, effect: { kind: 'seeds', pct: 40 } }],
      },
    ],
  },
  {
    // Erweiterung Amphibien (DESIGN_V2.md 5.5): nur im Frühling (EVENT_SEASONS).
    id: 'toad-migration', name: 'Krötenwanderung', icon: '🐸', minStage: 4,
    text: 'In einer milden Regennacht machen sich die Kröten auf den Weg zum Tümpel.',
    appears: [{ kind: 'species', id: 'toad' }],
    options: [
      {
        label: 'Den Wanderweg frei lassen', summary: '+4 ⚖️ (Zyklus)',
        effects: [{ kind: 'cycle', effect: { kind: 'harmony', points: 4 } }],
      },
      {
        label: 'Laichplätze schaffen', summary: '+1 Platz Waldtümpel (Zyklus), nächste Begegnung: Amphibien',
        effects: [
          { kind: 'cycle', effect: { kind: 'slot', niche: 'pond', amount: 1 } },
          { kind: 'nextEncounter', type: 'animal', ids: ['frog', 'newt', 'treefrog', 'crestednewt'] },
        ],
      },
    ],
  },
  // --- ab Hain ----------------------------------------------------------------
  {
    id: 'lightning', name: 'Blitzschlag', icon: '⚡', minStage: 5,
    text: 'Ein Blitz hat einen Nachbarbaum gespalten. Der Stumpf raucht noch.',
    appears: [{ kind: 'group', group: 'trees', min: 3 }],
    options: [
      {
        label: 'Als Biotopbaum stehen lassen', summary: 'Totholz, +1 Platz Stamm & Rinde (Zyklus)',
        effects: [{ kind: 'habitat', tag: 'totholz' }, { kind: 'cycle', effect: { kind: 'slot', niche: 'bark', amount: 1 } }],
      },
      { label: 'Die Lücke nutzen', summary: '+2 ☀️ (Zyklus)', effects: [{ kind: 'cycle', effect: { kind: 'light', amount: 2 } }] },
      { label: 'Holz verwerten', summary: '2½ min 🌰 sofort', effects: [{ kind: 'seedsNow', seconds: 150 }] },
    ],
  },
  {
    id: 'ant-trail', name: 'Ameisenstraße', icon: '🐜', minStage: 5,
    text: 'Die Waldameisen tragen Samen in ihren Hügel – und verlieren unterwegs die Hälfte.',
    appears: [{ kind: 'species', id: 'woodant' }],
    options: [
      { label: 'Den Hügel wachsen lassen', summary: '+5 ⚖️ (Zyklus)', effects: [{ kind: 'cycle', effect: { kind: 'harmony', points: 5 } }] },
      {
        label: 'Samen verbreiten lassen', summary: 'Blumen +60 % 🌿 für 10 min, 1 min 🌰 sofort',
        effects: [
          { kind: 'timed', seconds: 600, effect: { kind: 'groupGrowth', group: 'flowers', pct: 60 } },
          { kind: 'seedsNow', seconds: 60 },
        ],
      },
    ],
  },
  // --- Massenjahre: Beute ohne Jäger (DESIGN_V2.md 22.5, Daten in predation.ts) ---------
  ...PREDATION_EVENTS,
];

export const EVENTS_BY_ID: ReadonlyMap<string, GameEvent> = new Map(EVENTS.map((e) => [e.id, e]));
