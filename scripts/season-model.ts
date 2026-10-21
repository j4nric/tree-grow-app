/**
 * Grobes Modell für Jahreszeiten und Hauptbaum-Arten im Simulator (DESIGN_V2.md 16.5,
 * 17.4) – solange die Logik in src/core/ fehlt. Es nutzt nur vorhandene Mechanik:
 *
 * - Wirkungen der Jahreszeit und der Baumart als Zeit-Boni (`cycle.timed`, Quelle
 *   „env:…“, Restdauer bis zum Ende der Jahreszeit) bzw. Platz-Wirkungen als Zyklus-Bonus
 *   (`cycle.bonuses`). `evaluate` wendet beide mit Faktor 1 an; tick() hält an der Grenze
 *   an, weil die Restdauer dort abläuft – genau wie es die echte Logik tun soll.
 * - Zufriedenheit einer Gattung (neuer Typ `happiness`) NÄHERUNGSWEISE: Zusatz-Harmonie
 *   30 · Σ Δz / Anzahl Tiere sowie die zusätzliche Wirkung ihrer Wachstums- und
 *   Samen-Boni (Δz · Grundwirkung), mit Δz = min(Punkte, 1 − z). Licht- und
 *   Kontroll-Wirkungen der Tiere bleiben außen vor (unterschätzt eher).
 * - Ereignisse und Gäste außerhalb ihrer Jahreszeit: vorübergehend als „gesehen“
 *   markiert (`cycle.seen`), damit die echte Ziehung sie überspringt.
 * - „Etwas keimt öfter“: Gewichte in ENCOUNTER_WEIGHTS werden während der Jahreszeit
 *   multipliziert und danach zurückgesetzt (`restore`).
 * - Hauptbaum-Merkmale: Nadeln der Kiefer als Habitat (1 statt 2 Einheiten Angebot).
 *   Dass die Kiefer keine Nüsse trägt, kann das Modell NICHT abbilden (MAIN_TREE_NUTS_STAGE
 *   ist fest) – die Kiefer ist hier also etwas zu stark.
 */
import { ENCOUNTER_WEIGHTS } from '../src/content/encounters';
import { SEASONS, SEASON_SECONDS, EVENT_SEASONS, VISITOR_SEASONS, type SeasonEffect } from '../src/content/seasons';
import { MAIN_TREES_BY_ID, type MainTreeId, type TreeEffect } from '../src/content/trees';
import { SPECIES_BY_ID } from '../src/content/species';
import { ENCOUNTER_TYPES, type Effect } from '../src/content/types';
import { evaluate, plantSlots } from '../src/core/formulas';
import { allAnimals, type GameState } from '../src/core/state';
import type { TimedEffect } from '../src/content/events';

export interface EnvironmentOptions {
  /** Jahreszeiten an (Wirkungen, Gewichte, Erscheinen von Ereignissen und Gästen). */
  seasons?: boolean;
  /** Art des Hauptbaums (ohne Angabe: heutiges Spiel, Eiche ohne Eigenheit). */
  mainTree?: MainTreeId;
}

const SOURCE = 'env:';
/** Restdauer für Wirkungen ohne Jahreszeit (läuft im Simulator nie ab). */
const FOREVER = 1e9;

const ORIGINAL_WEIGHTS = ENCOUNTER_WEIGHTS.map((row) => [...row]);

/** Jahreszeit-Index (0 Frühling … 3 Winter) zur Spielzeit `time` (s seit Zyklusbeginn). */
export function seasonIndex(time: number): number {
  return Math.floor(time / SEASON_SECONDS + 1e-9) % SEASONS.length;
}

/** Sekunden bis zum nächsten Wechsel der Jahreszeit. */
export function secondsToSeasonEnd(time: number): number {
  const next = (Math.floor(time / SEASON_SECONDS + 1e-9) + 1) * SEASON_SECONDS;
  return Math.max(1e-6, next - time);
}

export class Environment {
  /** IDs, die nur wegen der Jahreszeit als „gesehen“ markiert sind. */
  private fakeSeen = new Set<string>();
  private treeSetUp = false;

  constructor(private readonly options: EnvironmentOptions) {}

  get active(): boolean {
    return !!this.options.seasons || !!this.options.mainTree;
  }

  /** Bringt den Spielstand auf die Umwelt zur Zeit `time` (vor jedem Schritt aufrufen). */
  apply(state: GameState, time: number): void {
    if (!this.active) return;
    const tree = this.options.mainTree ? MAIN_TREES_BY_ID.get(this.options.mainTree)! : null;
    const season = this.options.seasons ? SEASONS[seasonIndex(time)]! : null;
    const remaining = season ? secondsToSeasonEnd(time) : FOREVER;

    // Einmalig: Platz-Wirkungen der Baumart als Zyklus-Bonus, Nadeln als Habitat.
    if (tree && !this.treeSetUp) {
      this.treeSetUp = true;
      for (const t of tree.traits) {
        if (t.effect.kind === 'slot') state.cycle.bonuses.push({ source: `${SOURCE}tree`, effect: t.effect });
      }
      if (tree.tags.includes('nadeln')) state.cycle.habitats.push('nadeln');
    }

    // Wirkungen neu setzen.
    state.cycle.timed = state.cycle.timed.filter((t) => !t.source.startsWith(SOURCE));
    const effects: (SeasonEffect | TreeEffect)[] = [];
    if (tree) for (const t of tree.traits) if (state.stage >= t.minStage && t.effect.kind !== 'slot') effects.push(t.effect);
    if (season) {
      for (const e of season.effects) {
        const negative = ('pct' in e && e.pct < 0) || ('amount' in e && e.amount < 0);
        if (negative && tree?.winterHardy) continue;
        effects.push(e);
      }
    }
    const direct: Effect[] = [];
    const happiness: { genus: string; points: number }[] = [];
    for (const e of effects) {
      if (e.kind === 'happiness') happiness.push(e);
      else if (e.kind !== 'slot') direct.push(e);
    }
    for (const e of direct) state.cycle.timed.push({ source: `${SOURCE}direct`, effect: e as TimedEffect, remaining });
    if (happiness.length > 0) {
      for (const e of this.happinessApprox(state, happiness)) {
        state.cycle.timed.push({ source: `${SOURCE}happiness`, effect: e as TimedEffect, remaining });
      }
    }

    if (season) {
      // Gewichte der Begegnungstypen (Pflanze nur, solange der Ring Platz hat).
      const ringFull = state.plants.length >= plantSlots(state.stage);
      for (let s = 0; s < ENCOUNTER_WEIGHTS.length; s++) {
        const row = ENCOUNTER_WEIGHTS[s] as unknown as number[];
        for (let i = 0; i < ENCOUNTER_TYPES.length; i++) {
          const type = ENCOUNTER_TYPES[i]!;
          const factor = type === 'plant' && ringFull ? 1 : (season.encounterFactors?.[type] ?? 1);
          row[i] = ORIGINAL_WEIGHTS[s]![i]! * factor;
        }
      }
      // Ereignisse und Gäste außerhalb ihrer Jahreszeit überspringen.
      const seen = state.cycle.seen.filter((id) => !this.fakeSeen.has(id));
      this.fakeSeen.clear();
      for (const [id, seasons] of [...Object.entries(EVENT_SEASONS), ...Object.entries(VISITOR_SEASONS)]) {
        if (!seasons.includes(season.id) && !seen.includes(id)) this.fakeSeen.add(id);
      }
      state.cycle.seen = [...seen, ...this.fakeSeen];
    }
  }

  /** Setzt die geänderten Gewichte zurück (am Ende jedes Durchgangs). */
  restore(): void {
    restoreWeights();
  }

  /** Näherung der Zufriedenheits-Wirkung als Harmonie-, Wachstums- und Samen-Bonus. */
  private happinessApprox(state: GameState, effects: { genus: string; points: number }[]): Effect[] {
    const ev = evaluate(state);
    const animals = allAnimals(state);
    if (animals.length === 0) return [];
    let dzSum = 0;
    let growth = 0;
    let seeds = 0;
    for (const id of animals) {
      const sp = SPECIES_BY_ID.get(id);
      const st = ev.animals[id];
      if (!sp || !st) continue;
      let points = 0;
      for (const e of effects) if (e.genus === sp.genus) points += e.points / 100;
      const dz = Math.min(points, 1 - st.happiness);
      if (dz <= 0) continue;
      dzSum += dz;
      for (const e of sp.effects) {
        if (e.kind === 'growth') growth += e.pct * dz;
        else if (e.kind === 'seeds') seeds += e.pct * dz;
      }
    }
    const out: Effect[] = [];
    if (dzSum > 0) out.push({ kind: 'harmony', points: (30 * dzSum) / animals.length });
    if (growth > 0) out.push({ kind: 'growth', pct: growth });
    if (seeds > 0) out.push({ kind: 'seeds', pct: seeds });
    return out;
  }
}

/** ENCOUNTER_WEIGHTS wieder auf die Originalwerte setzen. */
export function restoreWeights(): void {
  for (let s = 0; s < ENCOUNTER_WEIGHTS.length; s++) {
    const row = ENCOUNTER_WEIGHTS[s] as unknown as number[];
    for (let i = 0; i < row.length; i++) row[i] = ORIGINAL_WEIGHTS[s]![i]!;
  }
}
