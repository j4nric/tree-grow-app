/**
 * Tagesziele (docs/DESIGN_V2.md, Abschnitt 19): zwei bis drei kleine Aufgaben je
 * Kalendertag aus dem Naturtagebuch. Reine Daten – Auswahl, Fortschritt und Belohnung
 * stehen in src/core/daily.ts, die Texte baut src/ui/daily-view.ts aus den Vorlagen hier.
 *
 * Regeln:
 * - Jedes Ziel ist bei einem kurzen Besuch (5–15 min) auf der aktuellen Stufe schaffbar:
 *   Die Auswahl prüft dafür nur den Spielstand beim Tageswechsel (Stufe, Ökosystem,
 *   Samen und Raten), siehe `DAILY_VISIT_SECONDS`. Ziele, die nicht passen, kommen gar
 *   nicht erst in Frage – es gibt keine unmöglichen Ziele.
 * - Belohnungen sind bescheiden: Samen-Sekunden wie beim Ablehnen (nur etwas mehr) und
 *   gelegentlich eine Begegnung mit selteneren Arten. Kein Ziel ist Pflicht, nichts verfällt
 *   außer der Serie, wenn ein Tag ohne erfülltes Ziel vergeht.
 * - `offline`: Darf das Nachrechnen der Offline-Zeit dieses Ziel erfüllen? Nur bei Zielen,
 *   die am Zustand des Waldes hängen (Zufriedenheit, Lebensgemeinschaft). Alles, was
 *   Handlungen oder Zeit am Bildschirm zählt, braucht aktives Spiel.
 * - Arten (`kind`) sind Teil des Spielstands (`meta.daily.goals`): nie umbenennen.
 */

/** Arten von Tageszielen (Teil des Spielstands). */
export type DailyGoalKind =
  /** 🌿 Wachstum sammeln (aktiv gespielte Zeit × Rate). */
  | 'growth'
  /** 🌰 Samen sammeln (aktiv gespielte Zeit × Rate; Ausgeben zählt nicht dagegen). */
  | 'seeds'
  /** Begegnungen entscheiden: Karte wählen, ablehnen, Ereignis entscheiden, Gast bewirten oder ziehen lassen. */
  | 'decide'
  /** Eine Begleitpflanze für Samen setzen. */
  | 'plant'
  /** Einen Rang Pflege kaufen. */
  | 'care'
  /** Harmonie über einer Schwelle halten (aktiv gespielte Sekunden, aufsummiert). */
  | 'harmony'
  /** In einer Jahreszeit N Arten einer Gattung im Ökosystem beobachten. */
  | 'observe'
  /** Die Zufriedenheit einer Gattung auf P % bringen. */
  | 'satisfaction'
  /** Eine Lebensgemeinschaft nach ihrem Rätselhinweis entdecken. */
  | 'community';

export interface DailyGoalTemplate {
  kind: DailyGoalKind;
  /** Symbol in der Liste. */
  icon: string;
  /**
   * Text mit Platzhaltern: {n} Zielwert, {species} „eine Art“ / „2 Arten“, {encounters}
   * „eine Begegnung“ / „2 Begegnungen“, {genus} Gattung
   * im Genitiv („der Säugetiere“, „des Bodenlebens“), {yourGenus} besitzanzeigend („deiner
   * Säugetiere“), {season} Jahreszeit („im Winter“), {harmony} Schwelle, {minutes} Minuten,
   * {hint} Rätselhinweis der Lebensgemeinschaft.
   */
  text: string;
  /** Gewicht bei der Auswahl (größer = häufiger). */
  weight: number;
  /** Frühestens ab dieser Stufe (Index in STAGES). */
  minStage: number;
  /** Zählt das Nachrechnen der Offline-Zeit (siehe oben)? */
  offline: boolean;
  /**
   * `build`: verändert den Wald (Pflanze, Pflege, Lebensgemeinschaft); `hold`: verlangt einen
   * Zustand (Zufriedenheit, Harmonie halten). Beide kommen nie am selben Tag – sonst könnte
   * z. B. eine neue Pflanze das Licht nehmen, das die Insekten für ihr Ziel brauchen.
   */
  group?: 'build' | 'hold';
}

export const DAILY_GOALS: readonly DailyGoalTemplate[] = [
  { kind: 'decide', icon: '🃏', text: 'Entscheide {encounters} – annehmen, ablehnen oder ziehen lassen.', weight: 4, minStage: 0, offline: false },
  { kind: 'observe', icon: '🔭', text: 'Beobachte {season} {species} {genus} in deinem Wald.', weight: 4, minStage: 1, offline: false },
  { kind: 'satisfaction', icon: '😊', text: 'Bring die Zufriedenheit {yourGenus} auf {n} %.', weight: 3, minStage: 1, offline: true, group: 'hold' },
  { kind: 'community', icon: '🧩', text: 'Ein Rätsel im Naturtagebuch: „{hint}“ Entdecke diese Lebensgemeinschaft.', weight: 5, minStage: 1, offline: true, group: 'build' },
  { kind: 'plant', icon: '🌱', text: 'Setze eine Begleitpflanze in den Pflanzring.', weight: 3, minStage: 1, offline: false, group: 'build' },
  { kind: 'care', icon: '🧤', text: 'Gönn deinem Wald eine Pflege.', weight: 3, minStage: 2, offline: false, group: 'build' },
  { kind: 'harmony', icon: '⚖️', text: 'Halte die Harmonie {minutes} Minuten lang bei mindestens {harmony}.', weight: 3, minStage: 1, offline: false, group: 'hold' },
  { kind: 'growth', icon: '🌿', text: 'Lass deinen Baum um {n} 🌿 wachsen.', weight: 1, minStage: 0, offline: false },
  { kind: 'seeds', icon: '🌰', text: 'Sammle {n} 🌰.', weight: 1, minStage: 0, offline: false },
];

export const DAILY_GOALS_BY_KIND: ReadonlyMap<DailyGoalKind, DailyGoalTemplate> = new Map(DAILY_GOALS.map((g) => [g.kind, g]));

/** So viele Ziele gibt es je Tag (weniger nur, wenn der Pool nicht genug verschiedene Arten hergibt). */
export const DAILY_GOAL_COUNT = 3;
/** Mindestens so viele (Wachstum und Samen passen immer). */
export const DAILY_MIN_GOALS = 2;

/**
 * Planungsfenster der Auswahl (s): Was der Spieler in so viel Spielzeit mit der aktuellen
 * Rate erreicht, gilt als schaffbar (Wegpunkte, Samen für Pflanze und Pflege). Raten
 * zählen dabei nur mit DAILY_RATE_MARGIN (der Winter bremst um 10 %).
 */
export const DAILY_VISIT_SECONDS = 600;
export const DAILY_RATE_MARGIN = 0.8;
/** Wachstums- und Samen-Ziel: so viele Sekunden Produktion zur Rate beim Tageswechsel. */
export const DAILY_PRODUCE_SECONDS = 300;
/** Harmonie-Ziel: so lange (s, aktiv gespielt, aufsummiert). */
export const DAILY_HOLD_SECONDS = 300;
/** Höchstens so viele Begegnungen bzw. beobachtete Arten. */
export const DAILY_MAX_DECIDE = 3;
export const DAILY_MAX_OBSERVE = 3;
/** Zufriedenheits-Ziel: nur, wenn das Ziel mindestens so viele Prozentpunkte über dem jetzigen Wert liegt. */
export const DAILY_SATISFACTION_STEP = 5;
/** Harmonie-Ziel erst ab dieser Schwelle (darunter ist „halten“ bedeutungslos). */
export const DAILY_MIN_HARMONY = 5;

/**
 * Belohnung je erfülltem Ziel: Samen-Sekunden (wie Ablehnen mit 10 s, mindestens 5 🌰;
 * siehe seedSeconds). Gemessen < 5 % der Samen der ersten Stunde (DESIGN_V2.md 19.5).
 */
export const DAILY_SEED_SECONDS = 15;
/**
 * Gelegentlich trägt ein Ziel statt der Samen eine Begegnung mit selteneren Arten
 * (Tierkarten ab „selten“). Je Tag höchstens eins, mit dieser Wahrscheinlichkeit, ab der
 * Stufe DAILY_RARE_MIN_STAGE (Junger Baum). Passt beim Erfüllen keine seltene Art oder ist
 * der Stapel voll, gibt es stattdessen die Samen.
 */
export const DAILY_RARE_CHANCE = 0.3;
export const DAILY_RARE_MIN_STAGE = 3;
/** Kleinste Seltenheit der Karten dieser Begegnung (1 = selten). */
export const DAILY_RARE_MIN_RARITY = 1;
