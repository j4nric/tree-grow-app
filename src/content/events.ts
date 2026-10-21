import type { Condition, Effect, Tag } from './types';

/**
 * Ereignisse mit Wahl (docs/DESIGN_V2.md 7.4). Reine Daten – die Logik folgt in Schritt
 * 2.4 (core-engineer, Umsetzungsnotiz in DESIGN_V2.md 7.8).
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
 *   (Zufall des Spielstands), höchstens CARDS_PER_ENCOUNTER. Arten nur, wenn sie
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
        label: 'Waldtümpel entstehen lassen', summary: 'Feuchte, +3 💧 (Zyklus)',
        effects: [{ kind: 'habitat', tag: 'feucht' }, { kind: 'cycle', effect: { kind: 'water', amount: 3 } }],
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
];

export const EVENTS_BY_ID: ReadonlyMap<string, GameEvent> = new Map(EVENTS.map((e) => [e.id, e]));
