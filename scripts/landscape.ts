/**
 * Modell der Waldlandschaft (docs/DESIGN_V2.md, Abschnitt 24) auf der ECHTEN Spiellogik.
 *
 * Die Landschaft ist noch nicht in src/core/ umgesetzt. Dieses Skript spielt sie mit dem
 * Simulator (scripts/simulate.ts, runGame) nach: Jeder Zyklus ist ein echter Zyklus bis zum
 * Urwald; die Landschaft verwaltet das Skript drumherum:
 *
 * - **Eigenes Waldgedächtnis je Wald.** Vor dem Zyklus steht in `meta.forestMemory` das
 *   wirksame Gedächtnis (eigenes + Korridor-Zufluss, höchstens MAX_FOREST_MEMORY), beim
 *   Neuen Zyklus wieder das eigene – der Gewinn (previewNewCycle) gehört dem Wald.
 * - **Eigenheiten und Gaben exakt:** Sie haben dieselben Typen wie die Eigenheiten der
 *   Hauptbaum-Arten. Das Skript hängt sie für die Dauer eines Zyklus an die Eigenheiten des
 *   gewählten Hauptbaums (`MAIN_TREES_BY_ID`), die Merkmale (Feuchte) an `cycle.habitats`.
 *   So rechnet evaluate() sie wie im fertigen Spiel. Nach jedem Lauf wird zurückgesetzt.
 * - **Nicht im Modell:** Wildwechsel-Karten und die Gewichte der Gattungen eines Waldtyps
 *   (`featured`) – sie ändern, welche Karten kommen, kaum das Tempo. Messung nach der
 *   Umsetzung (24.11).
 *
 * Spieler-Politik (ein „vernünftiger“ Spieler, keine Optimierung): Jeder Zyklus läuft bis
 * zum Urwald. Danach (1) einen neuen Wald gründen, sobald die Hähersaat reicht (Reihenfolge
 * FOUND_ORDER), (2) Korridore kaufen, solange sie bezahlbar sind (zuerst die am nächsten
 * Wald, dann die billigsten), (3) sonst im Wald mit dem kleinsten eigenen Gedächtnis
 * weiterspielen (bei Gleichstand im aktuellen). Stammgäste wie in runCycles.
 *
 * Ausführen: tests/landscape-balance.test.ts (SIM_LANDSCAPE=1 für den großen Lauf).
 */
import {
  CORRIDORS,
  FOUNDING_COSTS,
  HOME_SITE,
  JAY_SEEDS_FIRST_ANCIENT,
  JAY_SEEDS_MEMORY_STEP,
  LANDSCAPE_SITES,
  LANDSCAPE_SITES_BY_ID,
  LANDSCAPE_UNLOCK_MEMORY,
  CORRIDOR_INFLOW,
  CORRIDOR_INFLOW_CAP,
  type Corridor,
  type SiteId,
} from '../src/content/landscape';
import { MAIN_TREES_BY_ID, type MainTree, type MainTreeId } from '../src/content/trees';
import type { TreeTrait } from '../src/content/trees';
import { normalizeSeed, type RngHolder } from '../src/core/rng';
import { createInitialState, MAX_FOREST_MEMORY, type GameState } from '../src/core/state';
import { isTreeUnlocked, previewNewCycle, setRegulars, startNewCycle } from '../src/core/tick';
import { regularSlots } from '../src/core/formulas';
import { formatTime, median, rankRegulars, runGame, type RunResult, type Strategy } from './simulate';

/** Stellschrauben (Standard = Daten in src/content/landscape.ts). */
export interface LandscapeRules {
  inflow: number;
  /** Höchstens so viel Zufluss über alle Korridore zusammen. */
  inflowCap: number;
  /** Die Gründung baut den Korridor zwischen altem und neuem Wald gleich mit (Weg der Häher). */
  freeCorridor: boolean;
  unlockMemory: number;
  foundingCosts: readonly number[];
  /** Kosten je Korridor (Standard: CORRIDORS). */
  corridorCost: (c: Corridor) => number;
  memoryStep: number;
  firstAncient: number;
  /** Eigenheiten und Gaben anwenden (zum Vergleich abschaltbar). */
  siteEffects: boolean;
}

export const DEFAULT_RULES: LandscapeRules = {
  inflow: CORRIDOR_INFLOW,
  inflowCap: CORRIDOR_INFLOW_CAP,
  freeCorridor: true,
  unlockMemory: LANDSCAPE_UNLOCK_MEMORY,
  foundingCosts: FOUNDING_COSTS,
  corridorCost: (c) => c.cost,
  memoryStep: JAY_SEEDS_MEMORY_STEP,
  firstAncient: JAY_SEEDS_FIRST_ANCIENT,
  siteEffects: true,
};

/** Reihenfolge der Gründungen im Modell (frei wählbar im Spiel). */
export const FOUND_ORDER: readonly SiteId[] = ['floodplain', 'beechwood', 'heath', 'carr', 'mountain'];

export interface LandscapeOptions {
  strategy: Strategy;
  seed: number;
  rules?: Partial<LandscapeRules>;
  /** Höchstens so viele Zyklen insgesamt. */
  maxCycles: number;
  /** Höchstdauer eines Zyklus (s); erreicht er den Urwald nicht, beginnt trotzdem ein neuer. */
  cycleMaxSeconds: number;
  /** Nur bis die Landschaft vollständig ist (alle Wälder, alle Korridore) statt bis alles voll ist. */
  stopWhenComplete?: boolean;
}

export interface LandscapeCycle {
  site: SiteId;
  /** Laufende Nummer des Zyklus im ganzen Spiel (ab 1) und je Wald (ab 1). */
  number: number;
  siteCycle: number;
  seconds: number;
  ancient: boolean;
  ownBefore: number;
  effective: number;
  gain: number;
  mainTree: MainTreeId;
  maxGrowth: number;
  maxSeedsRate: number;
  seedsPeak: number;
  totalGrowth: number;
  maxHarmony: number;
}

export interface LandscapeRun {
  cycles: LandscapeCycle[];
  /** Kumulierte Spielzeit (s) bis … (null = nie). */
  unlockAt: number | null;
  foundedAt: Partial<Record<SiteId, number>>;
  allFoundedAt: number | null;
  completeAt: number | null;
  allMaxedAt: number | null;
  /** Dauer des ersten Zyklus je Wald bis zum Urwald (s). */
  firstCycle: Partial<Record<SiteId, number>>;
  /** Höchstwerte über das ganze Spiel (Frage break_infinity.js, 24.9). */
  maxGrowth: number;
  maxSeedsRate: number;
  maxSeedsHeld: number;
  maxCycleGrowth: number;
  lifetimeGrowth: number;
  totalSeconds: number;
  /** Hähersaat am Ende: verdient / ausgegeben. */
  jayEarned: number;
  jaySpent: number;
}

interface SiteRecord {
  own: number;
  ancient: boolean;
  cycles: number;
}

/** Korridor zwischen zwei Standorten (falls es einen gibt). */
export function corridorBetween(a: SiteId, b: SiteId): Corridor | undefined {
  return CORRIDORS.find((c) => c.sites.includes(a) && c.sites.includes(b) && a !== b);
}

/** Hähersaat, die die Wälder bisher eingebracht haben (abgeleitet, 24.4). */
export function jaySeedsEarned(sites: ReadonlyMap<SiteId, { own: number; ancient: boolean }>, rules: Pick<LandscapeRules, 'memoryStep' | 'firstAncient'> = DEFAULT_RULES): number {
  let sum = 0;
  for (const s of sites.values()) {
    sum += Math.floor(Math.min(MAX_FOREST_MEMORY, s.own) / rules.memoryStep);
    if (s.ancient) sum += rules.firstAncient;
  }
  return sum;
}

/** Wirksames Gedächtnis eines Waldes: eigenes + Zufluss über gebaute Korridore, gedeckelt. */
export function effectiveMemory(
  site: SiteId,
  sites: ReadonlyMap<SiteId, { own: number }>,
  corridors: ReadonlySet<string>,
  inflow: number,
  inflowCap: number,
): number {
  let flow = 0;
  for (const c of CORRIDORS) {
    if (!corridors.has(c.id) || !c.sites.includes(site)) continue;
    const other = c.sites[0] === site ? c.sites[1] : c.sites[0];
    flow += inflow * (sites.get(other)?.own ?? 0);
  }
  return Math.min(MAX_FOREST_MEMORY, Math.floor((sites.get(site)?.own ?? 0) + Math.min(inflowCap, flow)));
}

const baseTraits = new Map<MainTreeId, readonly TreeTrait[]>();

/** Eigenheiten des Standorts und Gaben aller gegründeten Wälder an den Hauptbaum hängen. */
function applySite(tree: MainTreeId, site: SiteId, founded: readonly SiteId[], on: boolean): void {
  const t = MAIN_TREES_BY_ID.get(tree) as MainTree & { traits: readonly TreeTrait[] };
  if (!baseTraits.has(tree)) baseTraits.set(tree, t.traits);
  const base = baseTraits.get(tree)!;
  if (!on) {
    t.traits = base;
    return;
  }
  const gifts = founded.map((id) => LANDSCAPE_SITES_BY_ID.get(id)!.gift).filter((g): g is TreeTrait => g !== null);
  t.traits = [...base, ...LANDSCAPE_SITES_BY_ID.get(site)!.traits, ...gifts];
}

/** Alle Eigenheiten wieder wie in den Daten (nach jedem Lauf). */
export function restoreTrees(): void {
  for (const [id, traits] of baseTraits) (MAIN_TREES_BY_ID.get(id) as MainTree & { traits: readonly TreeTrait[] }).traits = traits;
}

function treeFor(state: GameState, site: SiteId): MainTreeId {
  const lead = LANDSCAPE_SITES_BY_ID.get(site)!.leadTree;
  return lead && isTreeUnlocked(state, lead) ? lead : 'oak';
}

function peaks(result: RunResult) {
  let growth = 0;
  let seedsRate = 0;
  let seeds = 0;
  for (const s of [...result.stages, ...result.samples, result.final]) {
    if (!s) continue;
    growth = Math.max(growth, s.growth);
    seedsRate = Math.max(seedsRate, s.seedsRate);
    seeds = Math.max(seeds, s.seeds);
  }
  return { growth, seedsRate, seeds };
}

/**
 * Waldtypen im Vergleich (24.10, wie die Baumarten in 17.4): ein Zyklus bis zum Urwald auf
 * einem frischen Spielstand mit festem Waldgedächtnis, Eigenheit und Merkmalen des Standorts,
 * Leitbaum als Hauptbaum (sonst Eiche), ohne Gaben. Liefert die Zeit bis zum Urwald (s) und
 * H_max – oder null, wenn er in `maxSeconds` nicht erreicht wird.
 */
export function siteRun(
  strategy: Strategy,
  site: SiteId,
  seed: number,
  memory: number,
  maxSeconds = 6 * 3600,
  mainTree?: MainTreeId,
): { seconds: number | null; hain: number | null; maxHarmony: number } {
  const state = createInitialState(0, seed);
  const tree = mainTree ?? LANDSCAPE_SITES_BY_ID.get(site)!.leadTree ?? 'oak';
  state.cycle.mainTree = tree;
  state.meta.forestMemory = memory;
  for (const tag of LANDSCAPE_SITES_BY_ID.get(site)!.habitats) state.cycle.habitats.push(tag);
  applySite(tree, site, [], true);
  try {
    const result = runGame(strategy, { seed, targetStage: 7, maxSeconds, care: true, mainTree: tree }, { state, rng: { rngState: normalizeSeed(seed * 7919 + 17) } });
    return { seconds: result.stages[7]?.time ?? null, hain: result.stages[5]?.time ?? null, maxHarmony: state.cycle.maxHarmony };
  } finally {
    restoreTrees();
  }
}

/** Spielt eine ganze Landschaft (siehe Kopf). */
export function runLandscape(options: LandscapeOptions): LandscapeRun {
  const rules: LandscapeRules = { ...DEFAULT_RULES, ...options.rules };
  const state = createInitialState(0, options.seed);
  const rng: RngHolder = { rngState: normalizeSeed(options.seed * 7919 + 17) };
  const sites = new Map<SiteId, SiteRecord>([[HOME_SITE, { own: 0, ancient: false, cycles: 0 }]]);
  const founded: SiteId[] = [HOME_SITE];
  const corridors = new Set<string>();
  let spent = 0;
  let active: SiteId = HOME_SITE;
  let time = 0;
  const run: LandscapeRun = {
    cycles: [], unlockAt: null, foundedAt: { home: 0 }, allFoundedAt: null, completeAt: null, allMaxedAt: null,
    firstCycle: {}, maxGrowth: 0, maxSeedsRate: 0, maxSeedsHeld: 0, maxCycleGrowth: 0, lifetimeGrowth: 0,
    totalSeconds: 0, jayEarned: 0, jaySpent: 0,
  };
  const unlocked = () => run.unlockAt !== null;
  const available = () => jaySeedsEarned(sites, rules) - spent;

  try {
    for (let n = 1; n <= options.maxCycles; n++) {
      const rec = sites.get(active)!;
      const effective = effectiveMemory(active, sites, corridors, rules.inflow, rules.inflowCap);
      state.meta.forestMemory = effective;
      applySite(state.cycle.mainTree, active, founded.slice(1), rules.siteEffects && unlocked());
      if (rules.siteEffects) for (const tag of LANDSCAPE_SITES_BY_ID.get(active)!.habitats) state.cycle.habitats.push(tag);

      const result = runGame(options.strategy, { seed: options.seed, targetStage: 7, maxSeconds: options.cycleMaxSeconds, care: true }, { state, rng });
      const seconds = result.final.time;
      const ancient = result.stages[7] !== null;
      time += seconds;
      const p = peaks(result);
      run.maxGrowth = Math.max(run.maxGrowth, p.growth);
      run.maxSeedsRate = Math.max(run.maxSeedsRate, p.seedsRate);
      run.maxSeedsHeld = Math.max(run.maxSeedsHeld, p.seeds);
      run.maxCycleGrowth = Math.max(run.maxCycleGrowth, state.totalGrowth);
      run.lifetimeGrowth += state.totalGrowth;
      rec.cycles++;
      if (ancient && run.firstCycle[active] === undefined) run.firstCycle[active] = seconds;

      // Neuer Zyklus: Gewinn gehört dem Wald (eigenes Gedächtnis).
      state.meta.forestMemory = rec.own;
      const ranked = rankRegulars(state, options.strategy);
      const ownBefore = rec.own;
      const gain = previewNewCycle(state).memoryGain;
      run.cycles.push({
        site: active, number: n, siteCycle: rec.cycles, seconds, ancient, ownBefore, effective, gain,
        mainTree: state.cycle.mainTree, maxGrowth: p.growth, maxSeedsRate: p.seedsRate, seedsPeak: p.seeds,
        totalGrowth: state.totalGrowth, maxHarmony: state.cycle.maxHarmony,
      });
      if (ancient) rec.ancient = true;
      rec.own = Math.min(MAX_FOREST_MEMORY, rec.own + gain);

      // Freischaltung: einmal Urwald (Erfolg) und genug Gedächtnis im Heimatwald.
      if (!unlocked() && sites.get(HOME_SITE)!.ancient && sites.get(HOME_SITE)!.own >= rules.unlockMemory) run.unlockAt = time;

      // Nächster Wald: gründen, Korridore, sonst der mit dem kleinsten Gedächtnis.
      let next: SiteId = active;
      const cost = rules.foundingCosts[founded.length - 1];
      const affordable = unlocked() && cost !== undefined && available() >= cost && founded.length < LANDSCAPE_SITES.length;
      if (affordable && ancient) {
        // Neue Wälder entstehen neben dem Wald, in dem gerade der Urwald steht.
        const target = FOUND_ORDER.find((id) => !sites.has(id) && corridorBetween(active, id) !== undefined);
        if (target) {
          spent += cost;
          if (rules.freeCorridor) corridors.add(corridorBetween(active, target)!.id);
          sites.set(target, { own: 0, ancient: false, cycles: 0 });
          founded.push(target);
          run.foundedAt[target] = time;
          next = target;
          if (founded.length === LANDSCAPE_SITES.length) run.allFoundedAt = time;
        } else {
          next = HOME_SITE; // von hier aus liegt kein freier Standort daneben
        }
      }
      if (unlocked() && !(affordable && next === HOME_SITE && active !== HOME_SITE)) {
        for (;;) {
          const open = CORRIDORS.filter((c) => !corridors.has(c.id) && c.sites.every((s) => sites.has(s)));
          if (open.length === 0) break;
          open.sort((a, b) => Number(b.sites.includes(next)) - Number(a.sites.includes(next)) || rules.corridorCost(a) - rules.corridorCost(b));
          const c = open[0]!;
          if (available() < rules.corridorCost(c)) break;
          spent += rules.corridorCost(c);
          corridors.add(c.id);
        }
        if (run.completeAt === null && founded.length === LANDSCAPE_SITES.length && corridors.size === CORRIDORS.length) run.completeAt = time;
      }
      if (next === active && founded.length > 1) {
        let best = active;
        for (const id of founded) if (sites.get(id)!.own < sites.get(best)!.own) best = id;
        next = best;
      }
      if (run.allMaxedAt === null && founded.length === LANDSCAPE_SITES.length && [...sites.values()].every((s) => s.own >= MAX_FOREST_MEMORY)) {
        run.allMaxedAt = time;
      }
      if (run.allMaxedAt !== null || (options.stopWhenComplete && run.completeAt !== null)) break;

      // Wechsel in den nächsten Wald (Hauptbaum: Leitbaum, falls freigeschaltet).
      applySite(state.cycle.mainTree, active, [], false);
      const started = startNewCycle(state, 0, treeFor(state, next));
      if (!started.ok) throw new Error(`Neuer Zyklus gescheitert: ${started.error}`);
      // startNewCycle hat den Gewinn auf das eigene Gedächtnis des alten Waldes gebucht.
      active = next;
      state.meta.forestMemory = effectiveMemory(active, sites, corridors, rules.inflow, rules.inflowCap);
      // Der Spieler nimmt die besten Tiere des Waldes, den er gerade verlässt (wie runCycles).
      if (!setRegulars(state, ranked.slice(0, regularSlots(state.meta.forestMemory))).ok) throw new Error('Stammgäste nicht wählbar');
    }
  } finally {
    restoreTrees();
  }
  run.totalSeconds = time;
  run.jayEarned = jaySeedsEarned(sites, rules);
  run.jaySpent = spent;
  return run;
}

// ---------------------------------------------------------------------------
// Auswertung (Tabellen für DESIGN_V2.md 24.10)
// ---------------------------------------------------------------------------

export interface LandscapeSummary {
  label: string;
  runs: LandscapeRun[];
}

const hours = (s: number | null) => (s === null || !Number.isFinite(s) ? '–' : `${(s / 3600).toFixed(1).replace('.', ',')} h`);
const minutes = (s: number | null) => (s === null || !Number.isFinite(s) ? '–' : s >= 3600 ? formatTime(s) : `${Math.round(s / 60)} min`);

/** Median, wobei „nie“ (null) als unendlich zählt. */
export function medianOrNull(values: readonly (number | null | undefined)[]): number | null {
  const m = median(values.map((x) => (x === null || x === undefined ? Infinity : x)));
  return Number.isFinite(m) ? m : null;
}

/** Gegründete Wälder in Reihenfolge der Gründung (ohne den Heimatwald). */
export function foundingOrder(run: LandscapeRun): SiteId[] {
  return (Object.entries(run.foundedAt) as [SiteId, number][])
    .filter(([id]) => id !== HOME_SITE)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
}

/** Erster Zyklus (bis Urwald) im k-ten gegründeten Wald (k = 0: Heimatwald). */
export function firstCycleOf(run: LandscapeRun, k: number): number | null {
  const id = k === 0 ? HOME_SITE : foundingOrder(run)[k - 1];
  return id === undefined ? null : run.firstCycle[id] ?? null;
}

/** Zyklen mit vollem wirksamem Gedächtnis („Erntezyklen“) und ihre Dauer. */
export function harvestStats(run: LandscapeRun): { cycles: number; seconds: number } {
  const full = run.cycles.filter((c) => c.effective >= MAX_FOREST_MEMORY);
  return { cycles: full.length, seconds: full.reduce((s, c) => s + c.seconds, 0) };
}

/** Meilensteine (kumulierte Spielzeit, Median). */
export function milestoneTable(rows: readonly LandscapeSummary[]): string {
  const head = '| Variante | Freischaltung | 2. Wald | 3. | 4. | 5. | 6. Wald | Landschaft vollständig | alle Wälder voll | Zyklen | davon Ernte (wirksam 1000) |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => {
    const founded = [1, 2, 3, 4, 5].map((k) =>
      hours(medianOrNull(r.runs.map((run) => {
        const id = foundingOrder(run)[k - 1];
        return id === undefined ? null : run.foundedAt[id] ?? null;
      }))),
    );
    const cycles = median(r.runs.map((run) => run.cycles.length));
    const harvest = median(r.runs.map((run) => harvestStats(run).cycles));
    const harvestTime = median(r.runs.map((run) => harvestStats(run).seconds));
    return `| ${r.label} | ${hours(medianOrNull(r.runs.map((x) => x.unlockAt)))} | ${founded.join(' | ')} | ${hours(medianOrNull(r.runs.map((x) => x.completeAt)))} | ${hours(medianOrNull(r.runs.map((x) => x.allMaxedAt)))} | ${cycles} | ${harvest} (${hours(harvestTime)}) |`;
  });
  return [head, sep, ...lines].join('\n');
}

/** Erster Zyklus bis zum Urwald je Wald (in Reihenfolge der Gründung, Median). */
export function firstCycleTable(rows: readonly LandscapeSummary[]): string {
  const head = '| Variante | Heimatwald | 2. Wald | 3. | 4. | 5. | 6. Wald |';
  const sep = '|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => `| ${r.label} | ${[0, 1, 2, 3, 4, 5].map((k) => minutes(medianOrNull(r.runs.map((run) => firstCycleOf(run, k))))).join(' | ')} |`);
  return [head, sep, ...lines].join('\n');
}

/** Höchstwerte über das ganze Spiel (Größenordnung für die Frage break_infinity.js). */
export function peakTable(rows: readonly LandscapeSummary[]): string {
  const head = '| Variante | 🌿/s max | 🌰/s max | 🌰 Bestand max | Wachstum je Zyklus max | Wachstum gesamt max | Spielzeit max |';
  const sep = '|---|---|---|---|---|---|---|';
  const sci = (x: number) => x.toExponential(1).replace('.', ',').replace('e+', ' · 10^');
  const max = (r: LandscapeSummary, f: (run: LandscapeRun) => number) => Math.max(...r.runs.map(f));
  const lines = rows.map(
    (r) =>
      `| ${r.label} | ${sci(max(r, (x) => x.maxGrowth))} | ${sci(max(r, (x) => x.maxSeedsRate))} | ${sci(max(r, (x) => x.maxSeedsHeld))} | ${sci(max(r, (x) => x.maxCycleGrowth))} | ${sci(max(r, (x) => x.lifetimeGrowth))} | ${hours(max(r, (x) => x.totalSeconds))} |`,
  );
  return [head, sep, ...lines].join('\n');
}
