import { HABITAT_SPECIES } from '../src/content/habitats';
import { SPECIES, SPECIES_BY_ID } from '../src/content/species';
import { NICHE_IDS, type NicheId } from '../src/content/types';
import { evaluateEcosystem, type Ecosystem } from '../src/core/formulas';
import { random, randomInt, type RngHolder } from '../src/core/rng';

/**
 * Referenz „vor Räuber und Beute“ (DESIGN_V2.md 22.3, Variante b): zufällige Ökosysteme
 * (eigener, fester Zufall) und ihre Werte mit der Formel von main 9dde233 (Tiere je 1 Futter,
 * Räuberdruck 0,10 je Jäger, höchstens 2). Die Werte stehen fest in
 * `tests/predation-main-reference.json`; `tests/predation.test.ts` prüft, dass kein Tier und
 * keine Harmonie heute darunter liegt.
 *
 * Neu erzeugen (nur, wenn sich Arten oder andere Regeln absichtlich ändern – dann auf dem
 * Stand VOR der Änderung, mit der alten Räuber-Formel):
 *
 *   REFERENCE_OUT=tests/predation-main-reference.json npx vitest run tests/predation-reference.gen.test.ts
 */

export const REFERENCE_SEED = 2026;

/** Arten, die erst nach der Referenz dazukamen (Lebensräume, DESIGN_V2.md 23.4). */
const LATER = new Set(HABITAT_SPECIES.map((s) => s.id));
export const REFERENCE_COUNT = 300;

export interface ReferenceCase {
  stage: number;
  animals: string[];
  plants: string[];
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  mainTree: 'oak' | 'pine';
}

export interface ReferenceValue {
  harmony: number;
  /** Art-ID → [Zufriedenheit, Futter]. */
  animals: Record<string, [number, number]>;
}

/** Feste Zufalls-Ökosysteme (unabhängig von Math.random). */
export function referenceCases(count = REFERENCE_COUNT, seed = REFERENCE_SEED): ReferenceCase[] {
  const rng: RngHolder = { rngState: seed };
  const seasons = ['spring', 'summer', 'autumn', 'winter'] as const;
  const out: ReferenceCase[] = [];
  for (let i = 0; i < count; i++) {
    const stage = 1 + randomInt(rng, 7);
    // Nur der Katalog vor den Lebensräumen (die Referenz stammt von main 9dde233).
    const animals = SPECIES.filter((s) => s.unlock <= stage && !LATER.has(s.id))
      .filter(() => random(rng) < 0.35)
      .map((s) => s.id);
    const plants = random(rng) < 0.5 ? ['hazel', 'moss'] : [];
    out.push({ stage, animals, plants, season: seasons[randomInt(rng, 4)]!, mainTree: random(rng) < 0.5 ? 'oak' : 'pine' });
  }
  return out;
}

export function referenceEcosystem(c: ReferenceCase): Ecosystem {
  const niches = Object.fromEntries(NICHE_IDS.map((n) => [n, [] as string[]])) as Record<NicheId, string[]>;
  for (const id of c.animals) niches[SPECIES_BY_ID.get(id)!.niche].push(id);
  return { stage: c.stage, niches, plants: c.plants, forestMemory: 0, season: c.season, mainTree: c.mainTree };
}

const round = (x: number) => Math.round(x * 1e9) / 1e9;

export function referenceValue(c: ReferenceCase): ReferenceValue {
  const ev = evaluateEcosystem(referenceEcosystem(c));
  const animals: Record<string, [number, number]> = {};
  for (const [id, st] of Object.entries(ev.animals)) animals[id] = [round(st.happiness), round(st.food)];
  return { harmony: round(ev.harmony), animals };
}
