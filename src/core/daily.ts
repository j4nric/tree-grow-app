import {
  DAILY_GOALS,
  DAILY_GOALS_BY_KIND,
  DAILY_GOAL_COUNT,
  DAILY_HOLD_SECONDS,
  DAILY_MAX_DECIDE,
  DAILY_MAX_OBSERVE,
  DAILY_MIN_HARMONY,
  DAILY_PRODUCE_SECONDS,
  DAILY_RARE_CHANCE,
  DAILY_RARE_MIN_RARITY,
  DAILY_RARE_MIN_STAGE,
  DAILY_RATE_MARGIN,
  DAILY_SATISFACTION_STEP,
  DAILY_SEED_SECONDS,
  DAILY_VISIT_SECONDS,
  type DailyGoalKind,
  type DailyGoalTemplate,
} from '../content/daily';
import { MAX_PENDING_ENCOUNTERS, SCRIPTED_ENCOUNTERS } from '../content/encounters';
import { PLANTS_BY_ID } from '../content/plants';
import { RESEARCH } from '../content/research';
import { SOWING_MIN_STAGE } from '../content/sowing';
import { SEASONS, SEASON_IDS, type SeasonId } from '../content/seasons';
import { SPECIES_BY_ID } from '../content/species';
import { GENERA, type Genus } from '../content/types';
import { WAYPOINT_COUNT } from '../content/waypoints';
import {
  ecosystemOf,
  evaluate,
  evaluateEcosystem,
  harmonyIncome,
  plantSlots,
  seedSeconds,
  seedSecondsRate,
  sowingCostAt,
  thresholdFor,
  type Evaluation,
} from './formulas';
import { normalizeSeed, random, randomInt, weightedIndex, type RngHolder } from './rng';
import { seasonIdAt } from './season';
import { allAnimals, type DailyGoal, type GameState } from './state';
import { effectiveForestMemory } from './landscape';
import { drawAnimals, researchBlocker } from './tick';

/*
 * Tagesziele (DESIGN_V2.md 20). Reine Funktionen über den Spielstand – keine Uhr, kein
 * Math.random(): Der Tag kommt als Schlüssel „JJJJ-MM-TT“ herein (main.ts rechnet ihn aus
 * der lokalen Uhr bzw. der Serverzeit des Kontos), der Zufall aus `meta.daily.seed` und dem
 * Tag. Gleicher Spielstand + gleicher Tag → gleiche Ziele.
 *
 * Ablauf: `updateDaily(state, day, …)` läuft beim Start, nach dem Nachrechnen der
 * Offline-Zeit, nach jeder Aktion und gedrosselt im Game Loop. Sie
 *   1. wechselt den Tag, wenn `day` später ist als der gespeicherte (neue Ziele, Serie
 *      zurücksetzen, wenn ein Tag fehlt),
 *   2. führt den Fortschritt nach (Zustände und aktiv gespielte Zeit),
 *   3. erfüllt und belohnt fertige Ziele (Samen-Sekunden bzw. seltene Begegnung, Serie).
 * Aktionen (Begegnung entscheiden, aus einer Aussaat setzen, Forschung) zählen schon in tick.ts
 * (countDailyAction, core/daily-actions.ts).
 */

// ---------------------------------------------------------------------------
// Tage
// ---------------------------------------------------------------------------

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Tag aus Jahr, Monat (1–12) und Tag (1–31) als „JJJJ-MM-TT“. */
export function dayKeyOf(year: number, month: number, day: number): string {
  const pad = (n: number, w: number) => String(Math.trunc(n)).padStart(w, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Tage seit dem 1.1.1970 (proleptischer Gregorianischer Kalender, reine Rechnung). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Tagesnummer eines gültigen Schlüssels, sonst NaN. */
export function dayNumber(key: string): number {
  const m = DAY_KEY.exec(key);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
  const n = daysFromCivil(y, mo, d);
  // 31.02. o. Ä.: Rückrechnung ergäbe einen anderen Tag.
  return dayKeyFromNumber(n) === key ? n : NaN;
}

/** Umkehrung von dayNumber. */
export function dayKeyFromNumber(n: number): string {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return dayKeyOf(yoe + era * 400 + (m <= 2 ? 1 : 0), m, d);
}

/** Ist das ein gültiger Tag „JJJJ-MM-TT“? */
export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(dayNumber(value));
}

/** FNV-1a (32 Bit) über einen Text. */
function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Auswahl der Ziele
// ---------------------------------------------------------------------------

/** Was die Auswahl über den Spielstand wissen muss (einmal je Tageswechsel gerechnet). */
interface GenerationContext {
  state: GameState;
  ev: Readonly<Evaluation>;
  /** Auswertung ohne Zeit-Boni und Gäste je Jahreszeit (die bleiben nicht). */
  seasonal: Record<SeasonId, Evaluation>;
  /** Samen, die bis zum Ende des Besuchs zur Verfügung stehen (abzüglich geplanter Käufe). */
  budget: number;
  /** Freie Plätze im Pflanzring (abzüglich geplanter Pflanzen). */
  ringFree: number;
  /** Bereits geplante Pflanzen bzw. Aussaaten (für die Kosten weiterer). */
  plantsPlanned: number;
}

/**
 * Preis der `i`-ten weiteren Aussaat (0 = die nächste) nach den schon geplanten – mit dem
 * Zähler, der Forschung und der Jahreszeit von jetzt (DESIGN_V2.md 27.6).
 */
function plannedSowingCost(ctx: GenerationContext, i: number): number {
  const c = ctx.state.cycle;
  return sowingCostAt(c.sowings + ctx.plantsPlanned + i, c.research, c.elapsed);
}

/** Abgerundet auf zwei geltende Ziffern (≥ 1): 384 → 380, 7,6 → 7. */
export function roundTarget(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  if (value < 10) return Math.max(1, Math.floor(value));
  const step = Math.pow(10, Math.floor(Math.log10(value)) - 1);
  return Math.floor(value / step) * step;
}

/** Ø Zufriedenheit (0–1) der Arten einer Gattung im Ökosystem; null, wenn keine lebt. */
export function genusHappiness(state: GameState, ev: Pick<Evaluation, 'animals'>, genus: Genus): number | null {
  let sum = 0;
  let n = 0;
  for (const id of allAnimals(state)) {
    if (SPECIES_BY_ID.get(id)?.genus !== genus) continue;
    const h = ev.animals[id]?.happiness;
    sum += typeof h === 'number' && Number.isFinite(h) ? h : 0;
    n++;
  }
  return n > 0 ? sum / n : null;
}

/** Arten einer Gattung im Ökosystem. */
export function genusPresent(state: GameState, genus: Genus): number {
  return allAnimals(state).filter((id) => SPECIES_BY_ID.get(id)?.genus === genus).length;
}

/** Jahreszeit, in der eine Gattung zufriedener ist (Wirkung `happiness`), sonst null. */
export function genusSeason(genus: Genus): SeasonId | null {
  return SEASONS.find((s) => s.effects.some((e) => e.kind === 'happiness' && e.genus === genus))?.id ?? null;
}

function seasonalEvaluations(state: GameState): Record<SeasonId, Evaluation> {
  // Ohne Wetter und Nacht: Die Ziele schätzen das Ökosystem je Jahreszeit, nicht den Tag.
  const eco = ecosystemOf({ ...state, cycle: { ...state.cycle, timed: [], visitors: [] } }, {}, 'off');
  const out = {} as Record<SeasonId, Evaluation>;
  for (const id of SEASON_IDS) out[id] = evaluateEcosystem({ ...eco, season: id });
  return out;
}

/** Ein Vorschlag: das Ziel und was es von Samen und Pflanzring verbraucht. */
interface Candidate {
  goal: DailyGoal;
  cost: number;
  plants: number;
}

const goal = (kind: DailyGoalKind, target: number, extra: Partial<DailyGoal> = {}): DailyGoal => ({
  kind,
  target,
  progress: 0,
  reward: 'seeds',
  done: false,
  ...extra,
});

/** Gattungen mit mindestens einer Art im Ökosystem (Reihenfolge wie GENERA). */
const presentGenera = (state: GameState) => GENERA.filter((g) => genusPresent(state, g) > 0);

/**
 * Baut einen Vorschlag für eine Vorlage – oder null, wenn das Ziel jetzt nicht sicher
 * schaffbar wäre. Zufall (Gattung, Lebensgemeinschaft) aus `rng`.
 */
function propose(template: DailyGoalTemplate, ctx: GenerationContext, rng: RngHolder): Candidate | null {
  const { state, ev, seasonal } = ctx;
  const window = DAILY_VISIT_SECONDS * DAILY_RATE_MARGIN;
  const growthRate = ev.growth > 0 && Number.isFinite(ev.growth) ? ev.growth : 0;
  switch (template.kind) {
    case 'growth': {
      if (!(growthRate > 0)) return null;
      return { goal: goal('growth', roundTarget(growthRate * DAILY_PRODUCE_SECONDS)), cost: 0, plants: 0 };
    }
    case 'seeds': {
      const rate = seedSecondsRate(state);
      if (!(rate > 0) || !Number.isFinite(rate)) return null;
      return { goal: goal('seeds', roundTarget(rate * DAILY_PRODUCE_SECONDS)), cost: 0, plants: 0 };
    }
    case 'decide': {
      // Offene Begegnungen plus Wegpunkte, die im Besuch zur jetzigen Rate sicher kommen. Der
      // Wegpunkt der geschenkten Aussaat (27.5) zählt nicht – dort kommt evtl. keine Begegnung.
      let n = state.pendingEncounters.length;
      const reach = state.totalGrowth + growthRate * window;
      for (let k = state.waypoint + 1; k <= WAYPOINT_COUNT && n < DAILY_MAX_DECIDE && thresholdFor(k) <= reach; k++) {
        if (SCRIPTED_ENCOUNTERS[k - 1] !== 'sowing') n++;
      }
      n = Math.min(DAILY_MAX_DECIDE, n);
      return n >= 1 ? { goal: goal('decide', n), cost: 0, plants: 0 } : null;
    }
    case 'plant': {
      // „Säe einmal aus und setze die Pflanze“ (27.5): eine Aussaat muss bezahlbar sein; bei
      // vollem Ring ersetzt die Pflanze eine andere (Säen geht immer ab dem Keimling).
      const cost = plannedSowingCost(ctx, 0);
      const unlocked = state.stage >= SOWING_MIN_STAGE && [...PLANTS_BY_ID.values()].some((p) => p.unlock <= state.stage);
      if (!unlocked || cost > ctx.budget) return null;
      return { goal: goal('plant', 1), cost, plants: 1 };
    }
    case 'care': {
      // Forschung (seit v17, 27.7): bezahlt mit ⚖️ – Vorrat plus Zufluss im Besuch, nicht mit
      // dem Samen-Budget. Ein Ziel je Tag, darum kein eigenes Harmonie-Budget.
      let cheapest = Infinity;
      for (const node of RESEARCH) {
        const blocker = researchBlocker(state, node.id);
        if (blocker === null || blocker === 'too-expensive') cheapest = Math.min(cheapest, node.cost);
      }
      const points = Number.isFinite(state.harmonyPoints) ? Math.max(0, state.harmonyPoints) : 0;
      const available = points + harmonyIncome(ev.harmony, effectiveForestMemory(state)) * window;
      if (!(cheapest <= available)) return null;
      return { goal: goal('care', 1), cost: 0, plants: 0 };
    }
    case 'harmony': {
      // Schwelle: die niedrigste Harmonie über alle Jahreszeiten (ohne Zeit-Boni), auf 5 abgerundet.
      const low = Math.min(...SEASON_IDS.map((id) => seasonal[id].harmony));
      const threshold = Math.floor(low / 5) * 5;
      if (!(threshold >= DAILY_MIN_HARMONY) || !Number.isFinite(threshold)) return null;
      return { goal: goal('harmony', DAILY_HOLD_SECONDS, { harmony: threshold }), cost: 0, plants: 0 };
    }
    case 'observe': {
      const genera = presentGenera(state);
      if (genera.length === 0) return null;
      const genus = genera[randomInt(rng, genera.length)]!;
      const season = genusSeason(genus) ?? SEASON_IDS[randomInt(rng, SEASON_IDS.length)]!;
      const n = Math.min(DAILY_MAX_OBSERVE, genusPresent(state, genus));
      return { goal: goal('observe', n, { genus, season }), cost: 0, plants: 0 };
    }
    case 'satisfaction': {
      // Ziel = beste Jahreszeit (ohne Zeit-Boni), auf 5 % abgerundet – und spürbar über dem
      // jetzigen Wert. Ohne Änderung am Ökosystem erreicht spätestens nach einem Jahr (12 min).
      const now = seasonIdAt(state.cycle.elapsed);
      const options: { genus: Genus; target: number }[] = [];
      for (const genus of presentGenera(state)) {
        const current = genusHappiness(state, seasonal[now], genus);
        const peak = Math.max(...SEASON_IDS.map((id) => genusHappiness(state, seasonal[id], genus) ?? 0));
        if (current === null) continue;
        const target = Math.min(100, Math.floor((peak * 100) / 5) * 5);
        if (target >= Math.round(current * 100) + DAILY_SATISFACTION_STEP) options.push({ genus, target });
      }
      if (options.length === 0) return null;
      const pick = options[randomInt(rng, options.length)]!;
      return { goal: goal('satisfaction', pick.target, { genus: pick.genus }), cost: 0, plants: 0 };
    }
    case 'community': {
      // Unentdeckte Lebensgemeinschaften, denen nur noch Pflanzen fehlen, die jetzt gesät
      // werden können (freigeschaltet, Platz im Ring, Samen reichen für so viele Aussaaten).
      const known = new Set(state.meta.journal.communities);
      const options: { id: string; plants: number; cost: number }[] = [];
      for (const c of ev.communities) {
        if (c.active || known.has(c.id) || c.missing.length === 0) continue;
        const plantable = c.missing.every((ids) => ids.some((id) => (PLANTS_BY_ID.get(id)?.unlock ?? Infinity) <= state.stage));
        const k = c.missing.length;
        if (!plantable || k > ctx.ringFree) continue;
        let cost = 0;
        for (let i = 0; i < k; i++) cost += plannedSowingCost(ctx, i);
        if (cost <= ctx.budget) options.push({ id: c.id, plants: k, cost });
      }
      if (options.length === 0) return null;
      const pick = options[randomInt(rng, options.length)]!;
      return { goal: goal('community', 1, { community: pick.id }), cost: pick.cost, plants: pick.plants };
    }
  }
}

/**
 * Die Ziele eines Tages: bis zu DAILY_GOAL_COUNT verschiedene Arten, gewichtet gezogen aus
 * den Vorlagen, die auf dieser Stufe passen und jetzt sicher schaffbar sind. Samen für
 * Pflanze und Pflege werden dabei verplant (beides zusammen muss in den Besuch passen).
 * Danach trägt mit DAILY_RARE_CHANCE eines der Ziele statt Samen eine seltene Begegnung.
 * Verändert den Spielstand nicht.
 */
export function generateDailyGoals(state: GameState, day: string): DailyGoal[] {
  const rng: RngHolder = { rngState: normalizeSeed((state.meta.daily.seed ^ hashText(day)) >>> 0) };
  // Ohne Wetter und Nacht: Die Ziele hängen nicht davon ab, wann am Tag gewürfelt wird.
  const ev = evaluate(state, 'off');
  const ctx: GenerationContext = {
    state,
    ev,
    seasonal: seasonalEvaluations(state),
    budget: Math.max(0, state.seeds) + seedSecondsRate(state) * DAILY_VISIT_SECONDS * DAILY_RATE_MARGIN,
    ringFree: Math.max(0, plantSlots(state.stage) - state.plants.length),
    plantsPlanned: 0,
  };
  const goals: DailyGoal[] = [];
  const used = new Set<DailyGoalKind>();
  const groups = new Set<string>();
  while (goals.length < DAILY_GOAL_COUNT) {
    const options: { template: DailyGoalTemplate; candidate: Candidate }[] = [];
    for (const template of DAILY_GOALS) {
      if (used.has(template.kind) || template.minStage > state.stage) continue;
      // „Umbauen“ und „Zustand halten“ nie am selben Tag (content/daily.ts, `group`).
      if (template.group && groups.has(template.group === 'build' ? 'hold' : 'build')) continue;
      const candidate = propose(template, ctx, rng);
      if (candidate) options.push({ template, candidate });
    }
    const i = weightedIndex(rng, options.map((o) => o.template.weight));
    if (i < 0) break;
    const { template, candidate } = options[i]!;
    used.add(template.kind);
    if (template.group) groups.add(template.group);
    goals.push(candidate.goal);
    ctx.budget -= candidate.cost;
    ctx.ringFree -= candidate.plants;
    ctx.plantsPlanned += candidate.plants;
  }
  if (state.stage >= DAILY_RARE_MIN_STAGE && goals.length > 0 && random(rng) < DAILY_RARE_CHANCE) {
    goals[randomInt(rng, goals.length)]!.reward = 'rare';
  }
  return goals;
}

/**
 * Nach dem Neuen Zyklus (Stufe Samen, leerer Wald): offene Ziele an den neuen Wald anpassen,
 * damit keines unmöglich wird. Jede offene Art wird mit dem neuen Stand neu berechnet
 * (Zielwert und Parameter wie bei der Auswahl); Wachstum und Samen behalten ihren Anteil,
 * Harmonie halten die gesammelten Sekunden, Zählziele ihren Stand, Zustände (Beobachten,
 * Zufriedenheit) beginnen bei 0. Passt eine Art nicht mehr, tritt eine andere, jetzt
 * schaffbare an ihre Stelle (Belohnung bleibt); alle Ziele bleiben verschiedene Arten (ein
 * doppeltes aus älteren Ständen wird ersetzt). Erfüllte Ziele bleiben unverändert.
 * Zufall aus Startwert, Tag und Zyklusnummer – deterministisch. Ruft startNewCycle auf.
 */
export function refreshDailyAfterNewCycle(state: GameState): void {
  const daily = state.meta.daily;
  if (!isDayKey(daily.day) || daily.goals.every((g) => g.done)) return;
  const rng: RngHolder = {
    rngState: normalizeSeed((daily.seed ^ hashText(`${daily.day}#${state.cycle.number}`)) >>> 0),
  };
  const ctx: GenerationContext = {
    state,
    ev: evaluate(state, 'off'), // ohne Wetter und Nacht wie generateDailyGoals
    seasonal: seasonalEvaluations(state),
    budget: Math.max(0, state.seeds) + seedSecondsRate(state) * DAILY_VISIT_SECONDS * DAILY_RATE_MARGIN,
    ringFree: Math.max(0, plantSlots(state.stage) - state.plants.length),
    plantsPlanned: 0,
  };
  const groupOf = (kind: DailyGoalKind) => DAILY_GOALS_BY_KIND.get(kind)?.group;
  /** Ein Ziel neu berechnen; `others`: die übrigen Ziele, gegen die es verschieden sein muss. */
  const refreshGoal = (old: DailyGoal, others: readonly DailyGoal[]): DailyGoal => {
    if (old.done) return old;
    const clash = (t: DailyGoalTemplate) => {
      const g = t.group;
      return !!g && others.some((o) => (groupOf(o.kind) ?? g) !== g);
    };
    const own = DAILY_GOALS_BY_KIND.get(old.kind)!;
    // Eine schon vergebene Art (doppeltes Ziel aus einem Stand vor der Korrektur) wird ersetzt.
    const taken = others.some((o) => o.kind === old.kind);
    const same = !taken && own.minStage <= state.stage ? propose(own, ctx, rng) : null;
    let next: DailyGoal;
    if (same) {
      next = { ...same.goal, reward: old.reward };
      const share = old.target > 0 ? Math.min(1, Math.max(0, old.progress / old.target)) : 0;
      if (old.kind === 'growth' || old.kind === 'seeds') next.progress = share * next.target;
      else if (old.kind === 'harmony' || old.kind === 'decide' || old.kind === 'plant' || old.kind === 'care') {
        next.progress = Math.min(old.progress, next.target);
      }
      ctx.budget -= same.cost;
      ctx.ringFree -= same.plants;
      ctx.plantsPlanned += same.plants;
    } else {
      const options: { template: DailyGoalTemplate; candidate: Candidate }[] = [];
      for (const t of DAILY_GOALS) {
        if (t.minStage > state.stage || others.some((o) => o.kind === t.kind) || t.kind === old.kind || clash(t)) continue;
        const c = propose(t, ctx, rng);
        if (c) options.push({ template: t, candidate: c });
      }
      const k = weightedIndex(rng, options.map((o) => o.template.weight));
      if (k < 0) return old; // nichts passt (kann mit Wachstum/Samen nicht passieren)
      const c = options[k]!.candidate;
      next = { ...c.goal, reward: old.reward };
      ctx.budget -= c.cost;
      ctx.ringFree -= c.plants;
      ctx.plantsPlanned += c.plants;
    }
    return next;
  };
  // Neue Liste schrittweise aufbauen: Ersatz-Kandidaten werden gegen die schon gewählten
  // neuen Ziele (davor) und die alten Ziele (danach) geprüft – sonst zögen zwei ersetzte
  // Ziele dieselbe Art (Playtest Schritt 14, M1).
  const before = daily.goals;
  const chosen: DailyGoal[] = [];
  for (let i = 0; i < before.length; i++) chosen.push(refreshGoal(before[i]!, [...chosen, ...before.slice(i + 1)]));
  daily.goals = chosen;
}

// ---------------------------------------------------------------------------
// Fortschritt, Belohnung, Serie
// ---------------------------------------------------------------------------

export interface DailyUpdateOptions {
  /**
   * Seit dem letzten Aufruf aktiv gespielte Sekunden (Game Loop). Zählt für Wachstum, Samen
   * und Harmonie halten. Offline-Zeit nie hier übergeben.
   */
  activeSeconds?: number;
  /**
   * Aufruf nach dem Nachrechnen der Offline-Zeit: nur Ziele mit `offline: true` (Zustände
   * wie Zufriedenheit und Lebensgemeinschaft) werden geprüft.
   */
  offline?: boolean;
  /**
   * Im aktiven Spiel tatsächlich gutgeschriebenes Wachstum und erzeugte Samen (ohne
   * automatisches Ablehnen) seit dem letzten Aufruf. Fehlt es, rechnen Wachstums- und
   * Samen-Ziel mit Rate × `activeSeconds`.
   */
  produced?: { growth: number; seeds: number };
}

/** So viele Tage darf der gespeicherte Tag vor dem heutigen liegen (Zeitzonen), sonst wird zurückgesetzt. */
export const MAX_FUTURE_DAYS = 1;

/** Ein eben erfülltes Ziel und seine Belohnung. */
export interface DailyCompletion {
  goal: DailyGoal;
  /** Gutgeschriebene Samen (0 bei seltener Begegnung). */
  seeds: number;
  /** Eine seltene Begegnung liegt jetzt im Stapel. */
  rare: boolean;
}

export interface DailyUpdate {
  /** Neuer Tag: neue Ziele (speichern, Ansicht neu bauen). */
  rolled: boolean;
  completed: DailyCompletion[];
  /** Mit diesem Aufruf sind alle Ziele des Tages erfüllt. */
  perfect: boolean;
}

/** Darf das Nachrechnen der Offline-Zeit diese Art erfüllen? */
export function countsOffline(kind: DailyGoalKind): boolean {
  return DAILY_GOALS_BY_KIND.get(kind)?.offline ?? false;
}

/** Gleitkomma-Rest beim Aufsummieren (Sekunden, 🌿, 🌰). */
const EPSILON = 1e-9;

/**
 * Wechselt bei Bedarf den Tag, führt den Fortschritt nach und belohnt erfüllte Ziele.
 * `day`: heutiger Tag „JJJJ-MM-TT“; ungültige Werte wechseln nichts. Ein früherer Tag als
 * der gespeicherte (Uhr zurückgestellt) wechselt ebenfalls nichts – die Ziele gelten weiter.
 */
export function updateDaily(state: GameState, day: string, options: DailyUpdateOptions = {}): DailyUpdate {
  const daily = state.meta.daily;
  const result: DailyUpdate = { rolled: false, completed: [], perfect: false };
  if (isDayKey(day) && isDayKey(daily.day) && dayNumber(daily.day) - dayNumber(day) > MAX_FUTURE_DAYS) {
    // Gespeicherter Tag liegt mehr als einen Tag in der Zukunft (Geräteuhr vorgestellt, Stand
    // von einem Gerät mit falscher Uhr übers Konto): sonst blieben die Ziele bis dahin
    // eingefroren. Auf heute zurücksetzen, Serie neu, letzter Tag nicht in der Zukunft.
    daily.streak = 0;
    if (isDayKey(daily.lastDay) && daily.lastDay > day) daily.lastDay = '';
    daily.day = day;
    daily.goals = generateDailyGoals(state, day);
    result.rolled = true;
  } else if (isDayKey(day) && (!isDayKey(daily.day) || day > daily.day)) {
    // Fehlt mindestens ein ganzer Tag seit dem letzten erfüllten Ziel: Serie beginnt neu.
    if (!isDayKey(daily.lastDay) || dayNumber(day) - dayNumber(daily.lastDay) > 1) daily.streak = 0;
    daily.day = day;
    daily.goals = generateDailyGoals(state, day);
    result.rolled = true;
  }
  if (daily.goals.every((g) => g.done)) return result;
  const offline = options.offline === true;
  const seconds = !offline && Number.isFinite(options.activeSeconds) && options.activeSeconds! > 0 ? options.activeSeconds! : 0;
  const amount = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
  const produced =
    !offline && options.produced ? { growth: amount(options.produced.growth), seeds: amount(options.produced.seeds) } : null;
  const ev = evaluate(state);
  const season = seasonIdAt(state.cycle.elapsed);
  for (const g of daily.goals) {
    if (g.done || (offline && !countsOffline(g.kind))) continue;
    switch (g.kind) {
      case 'growth':
        if (produced) g.progress += produced.growth;
        else if (ev.growth > 0 && Number.isFinite(ev.growth)) g.progress += ev.growth * seconds;
        break;
      case 'seeds':
        if (produced) g.progress += produced.seeds;
        else if (ev.seeds > 0 && Number.isFinite(ev.seeds)) g.progress += ev.seeds * seconds;
        break;
      case 'harmony':
        if (g.harmony !== undefined && ev.harmony >= g.harmony) g.progress += seconds;
        break;
      case 'observe':
        if (g.genus && g.season === season) g.progress = Math.max(g.progress, genusPresent(state, g.genus));
        break;
      case 'satisfaction': {
        const h = g.genus ? genusHappiness(state, ev, g.genus) : null;
        if (h !== null) g.progress = Math.max(g.progress, Math.round(h * 100));
        break;
      }
      case 'community':
        if (g.community && state.meta.journal.communities.includes(g.community)) g.progress = 1;
        break;
      case 'decide':
      case 'plant':
      case 'care':
        break; // zählen die Aktionen selbst (countDailyAction)
    }
    g.progress = Math.min(g.target, Math.max(0, g.progress));
    if (g.progress >= g.target - EPSILON) result.completed.push(complete(state, g));
  }
  if (result.completed.length > 0 && daily.goals.every((g) => g.done)) {
    daily.perfectDays++;
    result.perfect = true;
  }
  return result;
}

/** Erfüllt ein Ziel: Belohnung, Zähler und Serie. */
function complete(state: GameState, g: DailyGoal): DailyCompletion {
  const daily = state.meta.daily;
  g.done = true;
  g.progress = g.target;
  daily.goalsDone++;
  // Serie: erster erfüllter Tag nach gestern zählt weiter, nach einer Lücke beginnt sie bei 1.
  if (daily.lastDay !== daily.day) {
    const gap = dayNumber(daily.day) - dayNumber(daily.lastDay);
    daily.streak = gap === 1 ? daily.streak + 1 : 1;
    daily.lastDay = daily.day;
    daily.bestStreak = Math.max(daily.bestStreak, daily.streak);
  }
  if (g.reward === 'rare' && state.pendingEncounters.length < MAX_PENDING_ENCOUNTERS) {
    const cards = drawAnimals(state, [], state, DAILY_RARE_MIN_RARITY);
    if (cards.length > 0) {
      state.pendingEncounters.push({ type: 'animal', cards, rerolls: 0 });
      return { goal: g, seeds: 0, rare: true };
    }
  }
  const seeds = seedSeconds(state, DAILY_SEED_SECONDS);
  state.seeds = Math.min(Number.MAX_VALUE, state.seeds + seeds);
  return { goal: g, seeds, rare: false };
}

/** Serie, wie sie heute gilt: nach einem verpassten Tag 0 (auch vor dem nächsten Wechsel). */
export function dailyStreak(state: GameState, today: string): number {
  const { lastDay, streak } = state.meta.daily;
  if (!isDayKey(lastDay) || !isDayKey(today)) return 0;
  // Negative Lücke (andere Zeitzone, Uhr zurückgestellt): die Serie gilt weiter.
  return dayNumber(today) - dayNumber(lastDay) <= 1 ? streak : 0;
}
