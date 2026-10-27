import { describe, expect, it } from 'vitest';
import { ARCHITECT } from '../src/content/abilities';
import { ENCOUNTER_WEIGHTS, INTERLUDE_CHANCE, INTERLUDE_POSITION, INTERLUDE_STAGE, INTERLUDE_WEIGHTS, PLANT_WEIGHT_IN_RING, RARITY_WEIGHTS, SCRIPTED_ENCOUNTERS } from '../src/content/encounters';
import { FOREST_MEMORY_BONUS, MEMORY_HARMONY_DIVISOR, MEMORY_PER_HARMONY_POINT, MEMORY_PER_NEW_SPECIES, MEMORY_PER_REGULAR_SLOT } from '../src/content/memory';
import { NICHES } from '../src/content/niches';
import { PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../src/content/traits';
import { MAIN_TREES } from '../src/content/trees';
import { GENERA, NICHE_IDS, type Genus, type NicheId } from '../src/content/types';
import { cycleMemoryGain, evaluateEcosystem, memoryHarmonyBonus, nicheSlots, sowingCostAt, type Ecosystem, type Evaluation } from '../src/core/formulas';

/**
 * Abgleich Formeln ↔ Zahlen (ersetzt den Vergleich mit dem Referenzmodell scripts/v2,
 * entfernt in 2.10). Zwei Teile:
 *
 * 1. Gezielte Regeln mit von Hand gerechneten Erwartungen (Wirkung = pct × Zufriedenheit,
 *    Platz-Arten, Gattungsboni ab 2/3/5, Pflanzen einzeln und doppelt).
 * 2. Eine eingefrorene Golden-Tabelle (tests/__snapshots__/golden.json): evaluateEcosystem
 *    je Art und je Pflanze auf jeder Stufe sowie die Content-Konstanten. Jede Zahlen-
 *    änderung zeigt sich dort als Diff. Gewollte Änderungen übernehmen mit
 *    `npx vitest run tests/golden.test.ts -u` und in docs/GAME_DESIGN.md nachtragen.
 */

const emptyNiches = (): Record<NicheId, string[]> => Object.fromEntries(NICHE_IDS.map((n) => [n, []])) as unknown as Record<NicheId, string[]>;

/** Ökosystem mit genau diesen Arten (in ihren Nischen) und Pflanzen, ohne Jahreszeit und Baumart. */
function eco(stage: number, species: readonly string[] = [], plants: readonly string[] = [], extra: Partial<Ecosystem> = {}): Ecosystem {
  const niches = emptyNiches();
  for (const id of species) niches[SPECIES.find((s) => s.id === id)!.niche].push(id);
  return { stage, niches, plants, forestMemory: 0, ...extra };
}

const URWALD = STAGES.length - 1;

describe('Formeln ↔ Zahlen: gezielte Regeln', () => {
  it('Wirkung einer Art = pct × Zufriedenheit (🌿, 🌰, Gruppen, Licht, Wasser, Harmonie)', () => {
    const tree = STAGES[URWALD]!;
    let happy = 0;
    for (const sp of SPECIES) {
      const ev = evaluateEcosystem(eco(URWALD, [sp.id]));
      const z = ev.animals[sp.id]!.happiness;
      if (z > 0) happy++;
      let growth = 0;
      let seeds = 0;
      let treeGroup = 0;
      let light = tree.light;
      let water = tree.water;
      let harmony = 0;
      for (const e of sp.effects) {
        if (e.kind === 'growth') growth += (e.pct / 100) * z;
        if (e.kind === 'seeds') seeds += (e.pct / 100) * z;
        if (e.kind === 'groupGrowth' && e.group === 'trees') treeGroup += (e.pct / 100) * z;
        if (e.kind === 'light') light += e.amount * z;
        if (e.kind === 'water') water += e.amount * z;
        if (e.kind === 'harmony') harmony += e.points * z;
      }
      // Eine einzelne Art erreicht keinen Gattungsbonus und keine Gemeinschaft.
      expect(Object.values(ev.traitTiers).every((t) => t === 0), sp.id).toBe(true);
      expect(ev.growthBonus, sp.id).toBeCloseTo(growth, 12);
      expect(ev.seedsBonus, sp.id).toBeCloseTo(seeds, 12);
      expect(ev.breakdown.extra, sp.id).toBeCloseTo(harmony, 12);
      expect(ev.light, sp.id).toBeCloseTo(Math.max(0, light), 12);
      expect(ev.water, sp.id).toBeCloseTo(Math.max(0, water), 12);
      // 🌿/s des Hauptbaums: Baum × (1 + Bäume-Bonus) × max(0,5; 1 + Boni − Fraß) × (1 + H/100).
      const factor = Math.max(0.5, 1 + growth - ev.damage);
      expect(ev.growth, sp.id).toBeCloseTo(tree.treeGrowth * (1 + treeGroup) * factor * (1 + ev.harmony / 100), 9);
    }
    // Allein sind fast alle Arten etwas zufrieden (legendäre ohne Wünsche nicht) – sonst prüft der Test nichts.
    expect(happy).toBeGreaterThan(0.8 * SPECIES.length);
  });

  it('halbe Zufriedenheit halbiert die Wirkung (Störung senkt z, Wirkung folgt)', () => {
    // Eichelhäher stört die Blaumeise: −0,15 Zufriedenheit, ihr 🌰-Bonus sinkt im selben Verhältnis.
    const alone = evaluateEcosystem(eco(URWALD, ['bluetit']));
    const disturbed = evaluateEcosystem(eco(URWALD, ['bluetit', 'jay']));
    const z0 = alone.animals.bluetit!.happiness;
    const z1 = disturbed.animals.bluetit!.happiness;
    expect(z0 - z1).toBeCloseTo(0.15, 12);
    const jay = disturbed.animals.jay!.happiness;
    expect(disturbed.seedsBonus).toBeCloseTo(0.04 * z1 + 0.1 * jay, 12);
  });

  it('Platz-Arten: Buntspecht und Borkenkäfer +1 Höhlen, Schwarzspecht (Baumeister) +1 Krone und +1 Höhlen', () => {
    const expected: Record<string, Partial<Record<NicheId, number>>> = {
      woodpecker: { hollows: 1 },
      barkbeetle: { hollows: 1 },
      blackwoodpecker: { crown: 1, hollows: 1 },
    };
    expect(ARCHITECT.slots).toEqual([
      { niche: 'crown', amount: 1 },
      { niche: 'hollows', amount: 1 },
    ]);
    for (const sp of SPECIES) {
      const want = expected[sp.id] ?? {};
      for (let stage = sp.unlock; stage < STAGES.length; stage++) {
        const base = nicheSlots(stage);
        const ev = evaluateEcosystem(eco(stage, [sp.id]));
        for (const n of NICHE_IDS) {
          // Geschlossene Nischen öffnen sich nur mit opensEarly (Höhlen).
          const opens = base[n] > 0 || NICHES.find((x) => x.id === n)!.opensEarly === true;
          expect(ev.slots[n] - base[n], `${sp.id} Stufe ${stage} ${n}`).toBe(opens ? (want[n] ?? 0) : 0);
        }
      }
    }
    // Zwei Platz-Arten addieren sich.
    const both = evaluateEcosystem(eco(5, ['woodpecker', 'barkbeetle']));
    expect(both.slots.hollows).toBe(nicheSlots(5).hollows + 2);
    // Höhlen öffnen schon vor dem Alter Baum (Junger Baum: 0 → 1).
    expect(nicheSlots(3).hollows).toBe(0);
    expect(evaluateEcosystem(eco(3, ['barkbeetle'])).slots.hollows).toBe(1);
  });

  it('Gattungsboni greifen genau ab 2, 3 und 5 Arten und wirken voll (Faktor 1)', () => {
    expect(TRAIT_THRESHOLDS).toEqual([2, 3, 5]);
    const tierFor = [0, 0, 1, 2, 2, 3, 3];
    for (const g of GENERA) {
      for (let n = 0; n < tierFor.length; n++) {
        // Gäste zählen für die Gattung, ohne eigene Wirkungen – so wirkt nur der Gattungsbonus.
        const ev = evaluateEcosystem(eco(URWALD, [], [], { guestGenera: Array<Genus>(n).fill(g) }));
        const tier = tierFor[n]!;
        expect(ev.traitTiers[g], `${g} × ${n}`).toBe(tier);
        let growth = 0;
        let seeds = 0;
        for (const t of TRAITS[g].slice(0, tier)) {
          for (const e of t.effects) {
            if (e.kind === 'growth') growth += e.pct / 100;
            if (e.kind === 'seeds') seeds += e.pct / 100;
          }
        }
        expect(ev.growthBonus, `${g} × ${n}`).toBeCloseTo(growth, 12);
        expect(ev.seedsBonus, `${g} × ${n}`).toBeCloseTo(seeds, 12);
      }
    }
  });

  it('Gattungsboni mit echten Arten: 1/2/3/4/5 Bodenleben → Stufe 0/1/2/2/3', () => {
    const soil = SPECIES.filter((s) => s.genus === 'soil').map((s) => s.id);
    expect(soil.length).toBeGreaterThanOrEqual(5);
    const tiers = [1, 2, 3, 4, 5].map((n) => evaluateEcosystem(eco(URWALD, soil.slice(0, n))).traitTiers.soil);
    expect(tiers).toEqual([0, 1, 2, 2, 3]);
  });

  it('jede Pflanze einzeln und doppelt (Urwald): Harmonie 9, 🌿 = (Baum + n · Pflanze) × 1,09', () => {
    const st = STAGES[URWALD]!;
    for (const p of PLANTS) {
      for (const n of [1, 2]) {
        const ev = evaluateEcosystem(eco(URWALD, [], Array<string>(n).fill(p.id)));
        // Vielfalt 3 (Gruppe) + 1 (Art, doppelt zählt einfach) + Tragfähigkeit 5.
        expect(ev.harmony, `${p.id} × ${n}`).toBeCloseTo(9, 12);
        expect(ev.supply, `${p.id} × ${n}`).toBe(1);
        const groupTrees = p.group === 'trees' ? 1 + n : 1;
        expect(ev.groupCounts.trees, `${p.id} × ${n}`).toBe(groupTrees);
        expect(ev.plantGrowth, `${p.id} × ${n}`).toBeCloseTo(n * p.growth * 1.09, 12);
        expect(ev.plantSeeds, `${p.id} × ${n}`).toBeCloseTo(n * p.seeds * 1.09, 12);
        expect(ev.growth, `${p.id} × ${n}`).toBeCloseTo((st.treeGrowth + n * p.growth) * 1.09, 12);
        expect(ev.seeds, `${p.id} × ${n}`).toBeCloseTo((st.treeSeeds + n * p.seeds) * 1.09, 12);
        expect(ev.lightNeed, `${p.id} × ${n}`).toBe(n * p.light);
        expect(ev.waterNeed, `${p.id} × ${n}`).toBe(n * p.water);
      }
    }
  });

  it('zu wenig Licht bremst nur die Begleitpflanzen: zwei Birken im Jungen Baum', () => {
    // Licht 5, Bedarf 2 × 4 = 8 → V = 0,625; der Hauptbaum wächst voll.
    const ev = evaluateEcosystem(eco(3, [], ['birch', 'birch']));
    expect(ev.supply).toBeCloseTo(5 / 8, 12);
    expect(ev.growth).toBeCloseTo((6 + 0.625 * 3) * ev.multiplier, 12);
  });

  it('Waldgedächtnis: +1 % je Punkt auf 🌿 und 🌰', () => {
    expect(FOREST_MEMORY_BONUS).toBe(0.01);
    const a = evaluateEcosystem(eco(5));
    const b = evaluateEcosystem(eco(5, [], [], { forestMemory: 30 }));
    expect(b.growth / a.growth).toBeCloseTo(1.3, 12);
    expect(b.seeds / a.seeds).toBeCloseTo(1.3, 12);
  });
});

/** Gerundet auf 8 signifikante Stellen (stabil gegen Gleitkomma-Rauschen, scharf für Zahlen). */
const r = (x: number) => Number(x.toPrecision(8));
const row = (ev: Evaluation) => `🌿 ${r(ev.growth)} · 🌰 ${r(ev.seeds)} · ⚖️ ${r(ev.harmony)}`;

describe('Formeln ↔ Zahlen: Golden-Tabelle', () => {
  it('evaluateEcosystem je Stufe, Art, Pflanze und Baumart sowie die Content-Konstanten', async () => {
    const evaluations: Record<string, Record<string, string>> = {};
    for (let stage = 0; stage < STAGES.length; stage++) {
      const out: Record<string, string> = {};
      out['(leer)'] = row(evaluateEcosystem(eco(stage)));
      for (const t of MAIN_TREES) out[`baum:${t.id}`] = row(evaluateEcosystem(eco(stage, [], [], { mainTree: t.id })));
      for (const sp of SPECIES) out[`art:${sp.id}`] = row(evaluateEcosystem(eco(stage, [sp.id])));
      for (const p of PLANTS) {
        out[`pflanze:${p.id}`] = row(evaluateEcosystem(eco(stage, [], [p.id])));
        out[`pflanze:${p.id}×2`] = row(evaluateEcosystem(eco(stage, [], [p.id, p.id])));
      }
      evaluations[`${stage} ${STAGES[stage]!.name}`] = out;
    }
    const constants = {
      stages: Object.fromEntries(
        STAGES.map((s) => [
          s.id,
          `Wegpunkt ${s.waypoint}: 🌿 ${s.treeGrowth} 🌰 ${s.treeSeeds} ☀️ ${s.light} 💧 ${s.water} Pflanzplätze ${s.plantSlots}`,
        ]),
      ),
      nicheSlots: Object.fromEntries(NICHES.map((n) => [n.id, n.slots.join(' ')])),
      plants: Object.fromEntries(
        PLANTS.map((p) => [p.id, `${p.group} ab ${p.unlock}: 🌿 ${p.growth} 🌰 ${p.seeds} ☀️ ${p.light} 💧 ${p.water} [${p.provides.join(', ')}]`]),
      ),
      // Aussaat (seit Phase 10, 2b, ersetzt „Pflanze setzen“ 20 · 1,9^n; Faktor 1,6 statt 1,75 seit
      // Phase 11, 3a): Preis nach n Aussaaten,
      // ohne Forschung und außerhalb des Frühlings (cycle.elapsed = 180 s = Sommer).
      sowingCost: Array.from({ length: 17 }, (_, n) => sowingCostAt(n, [], 180)),
      rarityWeights: RARITY_WEIGHTS.map((w) => w.join(' ')),
      encounterWeights: ENCOUNTER_WEIGHTS.map((w) => w.join(' ')),
      scriptedEncounters: SCRIPTED_ENCOUNTERS.join(' '),
      plantWeights: { inRing: PLANT_WEIGHT_IN_RING },
      interlude: { stage: INTERLUDE_STAGE, position: INTERLUDE_POSITION, chance: INTERLUDE_CHANCE, weights: INTERLUDE_WEIGHTS.join(' ') },
      traits: Object.fromEntries(GENERA.map((g) => [g, TRAITS[g].map((t) => t.text)])),
      memory: {
        bonus: FOREST_MEMORY_BONUS,
        harmonyDivisor: MEMORY_HARMONY_DIVISOR,
        perHarmonyPoint: MEMORY_PER_HARMONY_POINT,
        // Regel je Wegpunkt ab Hain (seit Schritt 2.11b gleitend, Sockel-Teiler seit dem Abgleich
        // mit der Sperrklinke): Teiler, Schwelle, Obergrenze, voll ab.
        harmonyBonusByWaypoint: Array.from({ length: 17 }, (_, i) => {
          const b = memoryHarmonyBonus(20 + i);
          return `Wegpunkt ${b.waypoint}: Sockel je ${b.divisor}, über ${b.threshold}, höchstens ${b.maxPoints} (Panel ab ${b.bonusFrom}, voll ab ${b.fullAt})`;
        }),
        perNewSpecies: MEMORY_PER_NEW_SPECIES,
        perRegularSlot: MEMORY_PER_REGULAR_SLOT,
        // Gewinn ohne neue Arten je höchster Harmonie – H_max wird gerundet wie die Anzeige.
        gainByMaxHarmony: Object.fromEntries(
          [20, 24, 28, 32, 36].map((w) => [
            `Wegpunkt ${w}`,
            [4.4, 4.5, 81, 100.4, 100.5, 103, 110.4, 114.6, 120, 130, 140, 150, 155, 160, 165, 174, 180, 195].map(
              (h) => `H_max ${h} → ${cycleMemoryGain(h, 0, 0, w)}`,
            ),
          ]),
        ),
      },
    };
    await expect(`${JSON.stringify({ constants, evaluations }, null, 2)}\n`).toMatchFileSnapshot('./__snapshots__/golden.json');
  });
});
