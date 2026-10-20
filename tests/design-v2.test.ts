import { describe, expect, it } from 'vitest';
import {
  COMMUNITIES,
  GENERA,
  NICHES,
  PLANTS,
  SPECIES,
  STAGE_NAMES,
  STAGE_WAYPOINTS,
  TRAITS,
  type Condition,
} from '../scripts/v2/content';
import {
  HARMONY,
  RANDOM,
  RAREST,
  STRATEGIES,
  YIELD,
  decisionStats,
  decisionTable,
  median,
  miscTable,
  monteCarlo,
  runGame,
  stageTable,
  strategyStats,
  strategyTable,
} from '../scripts/v2/sim';

/**
 * Monte-Carlo-Prüfung des v2-Designs (docs/DESIGN_V2.md, Abschnitt „Simulation“).
 * Alle Grenzen sind bewusst großzügig: Der Test soll grobe Fehlentwicklungen im
 * Design zeigen, nicht einzelne Zahlen festnageln.
 *
 * Tabellen im Protokoll:   npx vitest run tests/design-v2.test.ts --silent=false
 * Mehr Durchgänge (Doku):  DESIGN_V2_RUNS=1000 npx vitest run tests/design-v2.test.ts --silent=false
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const RUNS = Number(env.DESIGN_V2_RUNS ?? 40);
const HAIN = 5;
const URWALD = 7;
const MAX_SECONDS = 8 * 60 * 60;

/** Zielzeiten v2 für den harmonie-orientierten Spieler (vorläufig), Toleranz Faktor 2. */
const TARGETS: { stage: number; seconds: number; label: string }[] = [
  { stage: 2, seconds: 60, label: '~ 1 min' },
  { stage: 3, seconds: 5 * 60, label: '~ 5 min' },
  { stage: 4, seconds: 20 * 60, label: '~ 20 min' },
  { stage: 5, seconds: 60 * 60, label: '~ 60 min' },
  { stage: 6, seconds: 100 * 60, label: '~ 1:40 h' },
  { stage: 7, seconds: 140 * 60, label: '~ 2:20 h' },
];
const TARGET_LABELS: (string | null)[] = STAGE_NAMES.map((_, s) => (s === 1 ? '< 30 s' : TARGETS.find((t) => t.stage === s)?.label ?? null));

describe('Design v2 – Inhalte des Prototyps', () => {
  it('hat 24–32 Arten in fünf Gattungen, jede Gattung mit einer legendären Art', () => {
    expect(SPECIES.length).toBeGreaterThanOrEqual(24);
    expect(SPECIES.length).toBeLessThanOrEqual(32);
    for (const g of GENERA) {
      expect(SPECIES.some((s) => s.genus === g && s.rarity === 3)).toBe(true);
      expect(SPECIES.filter((s) => s.genus === g).length).toBeGreaterThanOrEqual(5);
      expect(TRAITS[g]).toHaveLength(3);
    }
    expect(PLANTS.length).toBeGreaterThanOrEqual(12);
  });

  it('hat eindeutige IDs und nur gültige Verweise', () => {
    const ids = [...SPECIES.map((s) => s.id), ...PLANTS.map((p) => p.id)];
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(ids);
    const checkCondition = (c: Condition) => {
      if (c.kind === 'species') expect(known.has(c.id), c.id).toBe(true);
    };
    for (const s of SPECIES) {
      expect(NICHES).toContain(s.niche);
      s.needs.forEach(checkCondition);
      s.appears?.forEach(checkCondition);
      if (s.rarity >= 2) expect(s.appears, `${s.name} braucht eine Erscheinungsbedingung`).toBeDefined();
      for (const e of s.effects) if (e.kind === 'disturb') expect(known.has(e.target), e.target).toBe(true);
    }
    for (const c of COMMUNITIES) for (const m of c.members.flat()) expect(known.has(m), m).toBe(true);
  });

  it('ist deterministisch: gleicher Seed, gleiches Spiel', () => {
    const a = runGame(HARMONY, { seed: 7, targetStage: HAIN, maxSeconds: MAX_SECONDS });
    const b = runGame(HARMONY, { seed: 7, targetStage: HAIN, maxSeconds: MAX_SECONDS });
    expect(a.stageTimes).toEqual(b.stageTimes);
    expect(a.finalEco).toEqual(b.finalEco);
  });
});

describe('Design v2 – Monte-Carlo-Simulation', () => {
  // Vergleich aller Strategien bis „Hain“ (erstes sinnvolles Prestige), dazu der
  // Harmonie-Spieler bis „Urwald“ für Stufenzeiten und Takt.
  const all = monteCarlo(STRATEGIES, RUNS, { targetStage: HAIN, maxSeconds: MAX_SECONDS });
  const harmonyFull = monteCarlo([HARMONY], RUNS, { targetStage: URWALD, maxSeconds: MAX_SECONDS })[0]!;
  const byId = (id: string) => all.find((s) => s.strategy.id === id)!;
  const harmony = byId(HARMONY.id);
  const stackers = all.filter((s) => s.strategy.id.startsWith('stack-'));

  console.log(`Design v2 – ${RUNS} Durchgänge je Strategie, Kennzahlen bei „Hain“\n${strategyTable(all, HAIN)}`);
  console.log(`Gierig nach Harmonie – Stufen und Takt\n${stageTable(harmonyFull, TARGET_LABELS)}`);
  console.log(`Zufällig – Stufen und Takt\n${stageTable(byId(RANDOM.id), [])}`);
  console.log(`Wie echt ist die Wahl? (Tier- und Pflanzenbegegnungen bis Hain)\n${decisionTable(all)}`);
  console.log(`Begegnungen, Seltenheit, Gattungen bis Hain\n${miscTable(all)}`);

  it('(a) Harmonie-Streben schlägt das Stapeln jeder einzelnen Gattung', () => {
    const h = strategyStats(harmony, HAIN);
    for (const s of stackers) {
      const st = strategyStats(s, HAIN);
      expect(h.harmony, s.strategy.name).toBeGreaterThan(st.harmony);
      // Nicht langsamer als 5 % gegenüber dem besten Stapler.
      expect(h.time, s.strategy.name).toBeLessThan(st.time * 1.05);
    }
  });

  it('(a) seltenste Karte und Zufall sind nicht besser als Harmonie-Streben', () => {
    const h = strategyStats(harmony, HAIN);
    for (const id of [RAREST.id, RANDOM.id]) {
      const st = strategyStats(byId(id), HAIN);
      expect(h.harmony).toBeGreaterThan(st.harmony);
      expect(h.time).toBeLessThan(st.time);
    }
  });

  it('(a) Wachstum und Harmonie ziehen grob in dieselbe Richtung', () => {
    const h = strategyStats(harmony, HAIN);
    const y = strategyStats(byId(YIELD.id), HAIN);
    // Reines Wachstums-Streben ist schneller, aber nicht um Welten …
    expect(h.time).toBeLessThan(y.time * 1.4);
    // … und verliert dabei etwas Harmonie (Zielkonflikt), aber nicht alles.
    expect(y.harmony).toBeGreaterThan(h.harmony * 0.8);
    expect(y.harmony).toBeLessThan(h.harmony);
  });

  it('(b) Begegnungen kommen früh häufig und später alle paar Minuten', () => {
    const gaps = (stage: number) => harmonyFull.runs.flatMap((r) => r.gaps.filter((g) => g.stage === stage).map((g) => g.seconds));
    expect(median(gaps(1))).toBeLessThan(60);
    expect(median(gaps(2))).toBeLessThan(2 * 60);
    for (let stage = 1; stage <= HAIN; stage++) {
      expect(median(gaps(stage)), STAGE_NAMES[stage]).toBeGreaterThan(10);
      expect(median(gaps(stage)), STAGE_NAMES[stage]).toBeLessThan(8 * 60);
    }
    expect(median(gaps(2))).toBeLessThan(median(gaps(HAIN)));
  });

  it('(c) Stufen werden etwa zu den Zielzeiten erreicht', () => {
    const first = median(harmonyFull.runs.map((r) => r.stageTimes[1]!));
    expect(first).toBeLessThan(30);
    for (const { stage, seconds } of TARGETS) {
      const t = strategyStats(harmonyFull, stage).time;
      expect(t, STAGE_NAMES[stage]).toBeGreaterThan(seconds / 2);
      expect(t, STAGE_NAMES[stage]).toBeLessThan(seconds * 2);
    }
    expect(STAGE_WAYPOINTS[HAIN]).toBeGreaterThanOrEqual(15);
  });

  it('(d) die meisten Wahlen sind echt, aber nicht alle', () => {
    for (const s of [harmony, byId(YIELD.id), byId(RANDOM.id)]) {
      const d = decisionStats(s);
      expect(d.count).toBeGreaterThan(0);
      expect(d.realShare, s.strategy.name).toBeGreaterThan(0.4);
      expect(d.realShare, s.strategy.name).toBeLessThan(0.97);
      expect(d.obviousShare, s.strategy.name).toBeGreaterThan(0.03);
      expect(d.allBadShare, s.strategy.name).toBeLessThan(0.35);
    }
  });
});
