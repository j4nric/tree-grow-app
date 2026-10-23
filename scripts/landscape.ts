/**
 * Simulation der Waldlandschaft (docs/DESIGN_V2.md, Abschnitt 24) mit der ECHTEN Logik aus
 * src/core/: Jeder Zyklus ist ein echter Zyklus bis zum Urwald (scripts/simulate.ts, runGame,
 * alle Systeme, mit Pflege); Gründen, Wechseln und Korridore laufen über startNewCycle und
 * buildCorridor, Eigenheiten, Gaben, Merkmale und wirksames Gedächtnis über evaluate.
 * Bis Schritt A (Spielstand v14) war das ein Modell, das die Landschaft um den Simulator
 * herum nachbaute; die Varianten der Regeln von damals stehen in DESIGN_V2.md 24.10.
 *
 * Seit Schritt B (24.11) ziehen auch Wildwechsel-Karten und die Gewichte der Gattungen eines
 * Waldtyps (`featured`) mit – sie stecken in drawEncounter/drawAnimals der echten Logik.
 *
 * Spieler-Politik (ein „vernünftiger“ Spieler, keine Optimierung): Jeder Zyklus läuft bis
 * zum Urwald. Danach (1) einen neuen Wald gründen, sobald die Hähersaat reicht (Reihenfolge
 * FOUND_ORDER, nur neben dem aktiven Wald – sonst zurück in den Heimatwald), (2) sonst im Wald
 * mit dem kleinsten eigenen Gedächtnis weiterspielen (bei Gleichstand im aktuellen), (3) nach
 * dem Neustart Korridore kaufen, solange sie bezahlbar sind (zuerst die am aktiven Wald, dann
 * die billigsten). Stammgäste wie in runCycles: die besten Tiere des Waldes, den er verlässt.
 *
 * Ausführen: tests/landscape-balance.test.ts (SIM_LANDSCAPE=1 für den großen Lauf).
 */
import { CORRIDORS, HOME_SITE, LANDSCAPE_SITES, type ForestSite, type SiteId } from '../src/content/landscape';
import type { MainTreeId } from '../src/content/trees';
import { regularSlotsOf } from '../src/core/formulas';
import { SPECIES_BY_ID } from '../src/content/species';
import { effectiveForestMemory, jaySeeds, wildwechselChance } from '../src/core/landscape';
import { normalizeSeed, type RngHolder } from '../src/core/rng';
import { allAnimals, createInitialState, createSite, MAX_FOREST_MEMORY, type GameState } from '../src/core/state';
import { buildCorridor, corridorBlocker, previewNewCycle, setRegulars, startNewCycle } from '../src/core/tick';
import { formatTime, median, rankRegulars, runGame, type RunResult, type Strategy } from './simulate';

/** Reihenfolge der Gründungen (frei wählbar im Spiel). */
export const FOUND_ORDER: readonly SiteId[] = ['floodplain', 'beechwood', 'heath', 'carr', 'mountain'];

export interface LandscapeOptions {
  strategy: Strategy;
  seed: number;
  /** Höchstens so viele Zyklen insgesamt. */
  maxCycles: number;
  /** Höchstdauer eines Zyklus (s); erreicht er den Urwald nicht, beginnt trotzdem ein neuer. */
  cycleMaxSeconds: number;
  /** Nur bis die Landschaft vollständig ist (alle Wälder, alle Korridore) statt bis alles voll ist. */
  stopWhenComplete?: boolean;
  /**
   * Wildwechsel-Karten (24.6). Standard: an. `false` leert vor jedem Zyklus den Bestand
   * (`fauna`) aller Wälder – gewürfelt wird weiter (gleicher Zufall bis zum ersten Treffer),
   * es gibt nur nie eine passende Art. Vergleich „ohne Wildwechsel“ (2c).
   */
  wildwechsel?: boolean;
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
  /** Wildwechsel-Chance am aktiven Wald (0 ohne Korridor, 24.6). */
  wildwechselChance: number;
  /** Tierbegegnungen (erste Ziehung) und davon mit Wildwechsel-Karte; gewählte Wildwechsel-Karten. */
  animalEncounters: number;
  wildwechselOffered: number;
  wildwechselChosen: number;
  /** Vielfalt (7.7) über die Begegnungen des Zyklus. */
  sameSet: number;
  cardEncounters: number;
  rerollOpen: number;
  fewCards: number;
  worthwhile: number;
  allEncounters: number;
  /** Längste Strecke ohne lohnende Begegnung (s) im ganzen Zyklus. */
  drought: number;
  /** Verschiedene Arten auf den Tierkarten (erste Ziehung) und Karten seltener/legendärer Arten. */
  distinctOffered: number;
  rareOffered: number;
  /** Arten im Wald beim Ende des Zyklus. */
  speciesAtEnd: number;
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
  /** Höchste Harmonie (H_max) je Wald über alle Zyklen dort. */
  bestHarmony: Partial<Record<SiteId, number>>;
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

/** Vielfalt der Begegnungen eines Zyklus (7.7) und Wildwechsel-Karten (24.6). */
function varietyOf(result: RunResult) {
  const vs = result.variety;
  const cards = vs.filter((v) => v.type === 'animal' || v.type === 'plant');
  const animals = vs.filter((v) => v.type === 'animal');
  const offered = new Set<string>();
  let rare = 0;
  for (const v of animals) {
    for (const id of v.ids ?? []) {
      offered.add(id);
      if ((SPECIES_BY_ID.get(id)?.rarity ?? 0) >= 2) rare++;
    }
  }
  let last = 0;
  let drought = 0;
  for (const v of vs) {
    if (!v.worthwhile) continue;
    drought = Math.max(drought, v.time - last);
    last = v.time;
  }
  drought = Math.max(drought, result.final.time - last);
  return {
    animalEncounters: animals.length,
    wildwechselOffered: animals.filter((v) => v.wildwechsel).length,
    sameSet: vs.filter((v) => v.sameAsPrevious).length,
    cardEncounters: cards.length,
    rerollOpen: cards.filter((v) => v.rerollBlocked === null).length,
    fewCards: cards.filter((v) => v.stage >= 2 && v.cards <= 2).length,
    worthwhile: vs.filter((v) => v.worthwhile).length,
    allEncounters: vs.length,
    drought,
    distinctOffered: offered.size,
    rareOffered: rare,
  };
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
 * Waldtypen im Vergleich (24.7, wie die Baumarten in 17.4): ein Zyklus bis zum Urwald auf
 * einem frischen Spielstand, in dem der Standort `site` aktiv ist (Eigenheit und Merkmale;
 * alle Wälder gegründet, also überall alle Gaben; keine Korridore), mit festem
 * Waldgedächtnis und dem Leitbaum als Hauptbaum (sonst Eiche). Liefert die Zeit bis zum Urwald (s) und H_max.
 */
export function siteRun(
  strategy: Strategy,
  site: SiteId,
  seed: number,
  memory: number,
  maxSeconds = 6 * 3600,
  mainTree?: MainTreeId,
  care = true,
): { seconds: number | null; hain: number | null; maxHarmony: number; seen: string[]; communities: string[]; wall: number } {
  const state = createInitialState(0, seed);
  // Eigenes Wetter je Durchgang (seit 2c): Das Wetter hängt an Zyklusnummer und Startzeit
  // (21.4) – mit Startzeit 0 hätten alle Durchgänge dieselbe Wetterfolge.
  state.cycle.startedAt = 1_700_000_000_000 + seed * 86_400_017;
  const tree = mainTree ?? LANDSCAPE_SITES.find((s) => s.id === site)!.leadTree ?? 'oak';
  state.meta.forestMemory = memory;
  // Alle Wälder gegründet (ruhend, Gedächtnis 0, keine Korridore): überall dieselben Gaben,
  // der Vergleich misst nur Eigenheit, Merkmale und Leitbaum.
  for (const s of LANDSCAPE_SITES) if (s.id !== HOME_SITE) state.meta.landscape.sites.push(createSite(s.id));
  state.meta.landscape.active = site;
  const result = runGame(strategy, { seed, targetStage: 7, maxSeconds, care, mainTree: tree }, { state, rng: { rngState: normalizeSeed(seed * 7919 + 17) } });
  return {
    seconds: result.stages[7]?.time ?? null,
    hain: result.stages[5]?.time ?? null,
    maxHarmony: state.cycle.maxHarmony,
    seen: [...state.cycle.seen],
    // Frischer Spielstand: Das Tagebuch enthält genau die Lebensgemeinschaften dieses Zyklus.
    communities: [...state.meta.journal.communities],
    // Tiere auf der Trockenmauer im Urwald (26.2: öffnet der Mauer-Platz der Heide die Mauer?).
    wall: state.niches.wall?.length ?? 0,
  };
}

/** Sind alle Wälder gegründet und alle Korridore gebaut? */
function complete(state: GameState): boolean {
  const l = state.meta.landscape;
  return l.sites.length === LANDSCAPE_SITES.length && l.corridors.length === CORRIDORS.length;
}

/** Spielt eine ganze Landschaft (siehe Kopf). */
export function runLandscape(options: LandscapeOptions): LandscapeRun {
  const state = createInitialState(0, options.seed);
  const rng: RngHolder = { rngState: normalizeSeed(options.seed * 7919 + 17) };
  const cyclesAt = new Map<SiteId, number>();
  let time = 0;
  const run: LandscapeRun = {
    cycles: [], unlockAt: null, foundedAt: { home: 0 }, allFoundedAt: null, completeAt: null, allMaxedAt: null,
    firstCycle: {}, bestHarmony: {}, maxGrowth: 0, maxSeedsRate: 0, maxSeedsHeld: 0, maxCycleGrowth: 0, lifetimeGrowth: 0,
    totalSeconds: 0, jayEarned: 0, jaySpent: 0,
  };

  for (let n = 1; n <= options.maxCycles; n++) {
    const active = state.meta.landscape.active;
    const ownBefore = state.meta.forestMemory;
    const effective = effectiveForestMemory(state);
    if (options.wildwechsel === false) for (const site of state.meta.landscape.sites) site.fauna = [];
    const chance = wildwechselChance(state);
    const chosenBefore = state.meta.stats.wildwechselChosen;
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
    run.bestHarmony[active] = Math.max(run.bestHarmony[active] ?? 0, state.cycle.maxHarmony);
    cyclesAt.set(active, (cyclesAt.get(active) ?? 0) + 1);
    if (ancient && run.firstCycle[active] === undefined) run.firstCycle[active] = seconds;

    const preview = previewNewCycle(state);
    run.cycles.push({
      site: active, number: n, siteCycle: cyclesAt.get(active)!, seconds, ancient, ownBefore, effective, gain: preview.memoryGain,
      mainTree: state.cycle.mainTree, maxGrowth: p.growth, maxSeedsRate: p.seedsRate, seedsPeak: p.seeds,
      totalGrowth: state.totalGrowth, maxHarmony: state.cycle.maxHarmony, wildwechselChance: chance,
      wildwechselChosen: state.meta.stats.wildwechselChosen - chosenBefore, speciesAtEnd: new Set(allAnimals(state)).size,
      ...varietyOf(result),
    });
    const landscape = preview.landscape;
    if (run.unlockAt === null && landscape.unlockedAfter) run.unlockAt = time;

    // Nächster Wald: gründen (nur nebenan), sonst zurück in den Heimatwald, sonst der kleinste.
    const choice = (id: SiteId) => landscape.sites.find((s) => s.id === id)!;
    const cost = choice(FOUND_ORDER.find((id) => !choice(id).founded) ?? HOME_SITE).cost;
    const affordable = landscape.unlockedAfter && ancient && cost !== null && landscape.jaySeedsAfter.available >= cost;
    let next: SiteId = active;
    let founding = false;
    if (affordable) {
      const target = FOUND_ORDER.find((id) => !choice(id).founded && choice(id).blocker === null);
      if (target) {
        next = target;
        founding = true;
      } else {
        next = HOME_SITE; // von hier aus liegt kein freier Standort daneben
      }
    }
    if (!founding && next === active && landscape.sites.filter((s) => s.founded).length > 1) {
      let best = choice(active);
      for (const s of landscape.sites) if (s.founded && s.memory < best.memory) best = s;
      next = best.id;
    }
    const ranked = rankRegulars(state, options.strategy);
    if (run.allMaxedAt === null && landscape.sites.every((s) => s.founded && s.memory >= MAX_FOREST_MEMORY)) {
      run.allMaxedAt = time;
    }
    if (run.allMaxedAt !== null || (options.stopWhenComplete && run.completeAt !== null)) break;

    const started = startNewCycle(state, 0, undefined, next);
    if (!started.ok) throw new Error(`Neuer Zyklus gescheitert: ${started.error}`);
    if (started.founded) {
      run.foundedAt[next] = time;
      if (state.meta.landscape.sites.length === LANDSCAPE_SITES.length) run.allFoundedAt = time;
    }
    // Korridore kaufen (nicht, wenn er nur heimkehrt, um von dort zu gründen).
    if (!(affordable && !founding)) {
      for (;;) {
        const open = CORRIDORS.filter((c) => corridorBlocker(state, c.id) === null);
        if (open.length === 0) break;
        open.sort((a, b) => Number(b.sites.includes(next)) - Number(a.sites.includes(next)) || a.cost - b.cost);
        if (!buildCorridor(state, open[0]!.id).ok) break;
      }
    }
    if (run.completeAt === null && complete(state)) run.completeAt = time;
    if (!setRegulars(state, ranked.slice(0, regularSlotsOf(state))).ok) throw new Error('Stammgäste nicht wählbar');
  }
  run.totalSeconds = time;
  const seeds = jaySeeds(state);
  run.jayEarned = seeds.earned;
  run.jaySpent = seeds.spent;
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
  const head = '| Spielweise | Freischaltung | 2. Wald | 3. | 4. | 5. | 6. Wald | Landschaft vollständig | alle Wälder voll | Zyklen | davon Ernte (wirksam 1000) |';
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
  const head = '| Spielweise | Heimatwald | 2. Wald | 3. | 4. | 5. | 6. Wald |';
  const sep = '|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => `| ${r.label} | ${[0, 1, 2, 3, 4, 5].map((k) => minutes(medianOrNull(r.runs.map((run) => firstCycleOf(run, k))))).join(' | ')} |`);
  return [head, sep, ...lines].join('\n');
}

/** Höchste Harmonie je Wald (Median über die Läufe; Frage Harmonie-Hebel, 24.13). */
export function harmonyTable(rows: readonly LandscapeSummary[]): string {
  const head = `| Spielweise | ${LANDSCAPE_SITES.map((s) => `${s.icon} ${s.name}`).join(' | ')} |`;
  const sep = `|---|${LANDSCAPE_SITES.map(() => '---').join('|')}|`;
  const lines = rows.map((r) => `| ${r.label} | ${LANDSCAPE_SITES.map((s) => Math.round(median(r.runs.map((run) => run.bestHarmony[s.id] ?? 0)))).join(' | ')} |`);
  return [head, sep, ...lines].join('\n');
}

/** Höchstwerte über das ganze Spiel (Größenordnung für die Frage break_infinity.js). */
export function peakTable(rows: readonly LandscapeSummary[]): string {
  const head = '| Spielweise | 🌿/s max | 🌰/s max | 🌰 Bestand max | Wachstum je Zyklus max | Wachstum gesamt max | Spielzeit max |';
  const sep = '|---|---|---|---|---|---|---|';
  const sci = (x: number) => x.toExponential(1).replace('.', ',').replace('e+', ' · 10^');
  const max = (r: LandscapeSummary, f: (run: LandscapeRun) => number) => Math.max(...r.runs.map(f));
  const lines = rows.map(
    (r) =>
      `| ${r.label} | ${sci(max(r, (x) => x.maxGrowth))} | ${sci(max(r, (x) => x.maxSeedsRate))} | ${sci(max(r, (x) => x.maxSeedsHeld))} | ${sci(max(r, (x) => x.maxCycleGrowth))} | ${sci(max(r, (x) => x.lifetimeGrowth))} | ${hours(max(r, (x) => x.totalSeconds))} |`,
  );
  return [head, sep, ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// Wildwechsel und Vielfalt (2c, DESIGN_V2.md 24.6 / 7.7)
// ---------------------------------------------------------------------------

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1).replace('.', ',')} %` : '–');
const num = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '–');

/** Zyklen mit Korridor am aktiven Wald (nur dort kann es Wildwechsel geben). */
function corridorCycles(run: LandscapeRun): LandscapeCycle[] {
  return run.cycles.filter((c) => c.wildwechselChance > 0);
}

/** Summe einer Kennzahl über alle Zyklen aller Läufe (Filter optional). */
function total(r: LandscapeSummary, f: (c: LandscapeCycle) => number, keep: (c: LandscapeCycle) => boolean = () => true): number {
  let s = 0;
  for (const run of r.runs) for (const c of run.cycles) if (keep(c)) s += f(c);
  return s;
}

/**
 * Zyklen bis zur ersten gewählten Wildwechsel-Karte, gezählt ab der Gründung des 2. Waldes
 * (1 = schon im ersten Zyklus dort; Erfolg `wildwechsel-1`, Ziel ≤ 2). null = nie.
 */
export function cyclesToFirstWildwechsel(run: LandscapeRun): number | null {
  const start = run.cycles.findIndex((c) => c.site !== HOME_SITE);
  if (start < 0) return null;
  const hit = run.cycles.findIndex((c, i) => i >= start && c.wildwechselChosen > 0);
  return hit < 0 ? null : hit - start + 1;
}

/** Vielfalt der Begegnungen (7.7) in Zyklen mit Korridor – je Zeile eine Variante. */
export function varietyLandscapeTable(rows: readonly LandscapeSummary[]): string {
  const head =
    '| Variante | Zyklen mit Korridor | Tierbegegnungen je Zyklus | mit Wildwechsel-Karte | gewählt je Zyklus | gleiches Set wie vorige | 1–2 Karten | Neu würfeln möglich | lohnend | Durststrecke je Zyklus Median / 90 % | Arten auf Karten je Zyklus | selten/legendär je Zyklus | Arten im Wald (Urwald) |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => {
    const keep = (c: LandscapeCycle) => c.wildwechselChance > 0;
    const n = total(r, () => 1, keep);
    const cycles = r.runs.flatMap(corridorCycles);
    const droughts = cycles.map((c) => c.drought);
    const q90 = [...droughts].sort((a, b) => a - b)[Math.floor(0.9 * (droughts.length - 1))] ?? NaN;
    return `| ${r.label} | ${num(n / r.runs.length, 0)} | ${num(total(r, (c) => c.animalEncounters, keep) / n)} | ${pct(total(r, (c) => c.wildwechselOffered, keep) / total(r, (c) => c.animalEncounters, keep))} | ${num(total(r, (c) => c.wildwechselChosen, keep) / n, 2)} | ${pct(total(r, (c) => c.sameSet, keep) / total(r, (c) => c.allEncounters, keep))} | ${pct(total(r, (c) => c.fewCards, keep) / total(r, (c) => c.cardEncounters, keep))} | ${pct(total(r, (c) => c.rerollOpen, keep) / total(r, (c) => c.cardEncounters, keep))} | ${pct(total(r, (c) => c.worthwhile, keep) / total(r, (c) => c.allEncounters, keep))} | ${formatTime(median(droughts))} / ${formatTime(q90)} | ${num(total(r, (c) => c.distinctOffered, keep) / n)} | ${num(total(r, (c) => c.rareOffered, keep) / n, 2)} | ${num(total(r, (c) => c.speciesAtEnd, keep) / n)} |`;
  });
  return [head, sep, ...lines].join('\n');
}

/** Wildwechsel je Chance (Korridore am aktiven Wald): Anteil Tierbegegnungen mit Karte, gewählt. */
export function wildwechselChanceTable(rows: readonly LandscapeSummary[]): string {
  const head = '| Spielweise | Chance | Zyklen | Tierbegegnungen | mit Wildwechsel-Karte | davon gewählt | erste gewählte: Zyklen ab 2. Wald (Median / 90 % / nie) |';
  const sep = '|---|---|---|---|---|---|---|';
  const lines: string[] = [];
  for (const r of rows) {
    const firsts = r.runs.map(cyclesToFirstWildwechsel);
    const found = firsts.filter((x): x is number => x !== null).sort((a, b) => a - b);
    const first = `${num(median(found), 0)} / ${num(found[Math.floor(0.9 * (found.length - 1))] ?? NaN, 0)} / ${firsts.length - found.length}`;
    for (const chance of [0.1, 0.2, 0.3]) {
      const keep = (c: LandscapeCycle) => Math.abs(c.wildwechselChance - chance) < 1e-9;
      const n = total(r, () => 1, keep);
      if (n === 0) continue;
      const animals = total(r, (c) => c.animalEncounters, keep);
      const offered = total(r, (c) => c.wildwechselOffered, keep);
      lines.push(`| ${r.label} | ${Math.round(chance * 100)} % | ${n} | ${animals} | ${pct(offered / animals)} | ${pct(total(r, (c) => c.wildwechselChosen, keep) / offered)} | ${chance === 0.1 ? first : ''} |`);
    }
  }
  return [head, sep, ...lines].join('\n');
}

/**
 * Führt `fn` ohne die Gattungen der Waldtypen (`featured`, 24.6) aus – nur für Vergleichsläufe
 * („wie vor Schritt B“). Ändert die Daten zur Laufzeit und stellt sie danach wieder her.
 */
export function withoutFeatured<T>(fn: () => T): T {
  const saved = LANDSCAPE_SITES.map((s) => s.featured);
  for (const s of LANDSCAPE_SITES) (s as { featured: ForestSite['featured'] }).featured = [];
  try {
    return fn();
  } finally {
    LANDSCAPE_SITES.forEach((s, i) => ((s as { featured: ForestSite['featured'] }).featured = saved[i]!));
  }
}

/**
 * Führt `fn` ohne das Wetter der Waldtypen aus (`ForestSite.weather`, 24.14): jeder Wald zieht
 * dann das Wetter des Heimatwaldes – nur für Vergleichsläufe („wie vor 3c“). Ändert die Daten
 * zur Laufzeit (core/weather.ts liest sie bei jedem Zug) und stellt sie danach wieder her.
 */
export function withoutSiteWeather<T>(fn: () => T): T {
  const saved = LANDSCAPE_SITES.map((s) => s.weather);
  for (const s of LANDSCAPE_SITES) (s as { weather: ForestSite['weather'] }).weather = {};
  try {
    return fn();
  } finally {
    LANDSCAPE_SITES.forEach((s, i) => ((s as { weather: ForestSite['weather'] }).weather = saved[i]!));
  }
}

/**
 * Führt `fn` ohne die Ereignis-Faktoren der Waldtypen aus (`ForestSite.eventFactors`, 24.13,
 * 26.2) – nur für Vergleichsläufe („vor Phase 9, 1a“ bzw. „vor 3e“). Ändert die Daten zur
 * Laufzeit (core/tick.ts liest sie bei jedem Zug) und stellt sie danach wieder her.
 */
export function withoutSiteEvents<T>(fn: () => T): T {
  const saved = LANDSCAPE_SITES.map((s) => s.eventFactors);
  for (const s of LANDSCAPE_SITES) (s as { eventFactors: ForestSite['eventFactors'] }).eventFactors = {};
  try {
    return fn();
  } finally {
    LANDSCAPE_SITES.forEach((s, i) => ((s as { eventFactors: ForestSite['eventFactors'] }).eventFactors = saved[i]!));
  }
}

/**
 * Führt `fn` mit den Eigenheiten eines Standorts ohne die Platz-Wirkung für `niche` aus – nur
 * für Vergleichsläufe (26.2: Kiefernheide ohne den Mauer-Platz). Stellt die Daten danach wieder her.
 */
export function withoutSiteSlot<T>(site: SiteId, niche: string, fn: () => T): T {
  const data = LANDSCAPE_SITES.find((s) => s.id === site)!;
  const saved = data.traits;
  (data as { traits: ForestSite['traits'] }).traits = saved.filter((t) => !(t.effect.kind === 'slot' && t.effect.niche === niche));
  try {
    return fn();
  } finally {
    (data as { traits: ForestSite['traits'] }).traits = saved;
  }
}
