import { describe, expect, it } from 'vitest';
import { COMMUNITY_BOOST_HARMONY } from '../src/content/abilities';
import { COMMUNITIES } from '../src/content/communities';
import { PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { TRAITS } from '../src/content/traits';
import { GENERA, NICHE_IDS, type NicheId } from '../src/content/types';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import {
  activeCommunities,
  communityChanges,
  evaluate,
  evaluateEcosystem,
  growth,
  hasSpecies,
  memberOptions,
  nextPlantCost,
  nicheOverflow,
  nicheSlots,
  nichesAfterChoice,
  plantCost,
  plantSlots,
  plantsAfterChoice,
  secondsToNextWaypoint,
  stageForWaypoint,
  stageProgress,
  thresholdFor,
  waypointProgress,
  waypointsForGrowth,
} from '../src/core/formulas';
import { randomInt } from '../src/core/rng';
import { MAX_FOREST_MEMORY, createInitialState } from '../src/core/state';
import { COMMUNITIES as REFERENCE_COMMUNITIES } from '../scripts/v2/content';
import { evaluate as referenceEvaluate, emptyEco } from '../scripts/v2/model';
import { SPRING_GROWTH, fakeSpecies, stateAt, withFakeSpecies } from './helpers';

describe('evaluate', () => {
  it('leerer Samen: Harmonie 5 (Tragfähigkeit), 1,05 🌿/s (im Frühling +10 %)', () => {
    const ev = evaluate(createInitialState(0));
    expect(ev.harmony).toBeCloseTo(5);
    expect(ev.multiplier).toBeCloseTo(1.05);
    expect(ev.growth).toBeCloseTo(1.05 * (1 + SPRING_GROWTH));
    expect(ev.seeds).toBeCloseTo(0.105);
    expect(ev.avgHappiness).toBe(0);
  });

  it('Regenwurm im Keimling: 75 % zufrieden, Harmonie ~38 (Beispiel aus dem Design)', () => {
    const ev = evaluate(stateAt(1, ['earthworm']));
    expect(ev.animals.earthworm!.happiness).toBeCloseTo(0.75);
    expect(ev.animals.earthworm!.needs).toEqual([false]); // keine Feuchte ohne Moos
    expect(ev.harmony).toBeCloseTo(38.17, 1);
    // 2 🌿/s · (1 + 8 % · 0,75 + 10 % Frühling) · 1,38
    expect(ev.growth).toBeCloseTo(2 * (1.06 + SPRING_GROWTH) * (1 + ev.harmony / 100));
  });

  it('Räuber mindert Fraß: Blaumeise halbiert den Schaden des Eichenwicklers', () => {
    const alone = evaluate(stateAt(3, ['oakmoth']));
    expect(alone.damage).toBeCloseTo(0.1);
    expect(alone.unguarded).toBe(1);
    const guarded = evaluate(stateAt(3, ['oakmoth', 'bluetit']));
    const z = guarded.animals.bluetit!.happiness;
    expect(guarded.damage).toBeCloseTo(0.1 * (1 - 0.5 * z));
    expect(guarded.animals.oakmoth!.hunters).toBe(1);
  });

  it('Lebensraum-Ketten: Borkenkäfer bringt Totholz für Rollassel', () => {
    const without = evaluate(stateAt(3, ['woodlouse']));
    const withBeetle = evaluate(stateAt(3, ['woodlouse', 'barkbeetle']));
    expect(without.animals.woodlouse!.needs).toEqual([false]);
    expect(withBeetle.animals.woodlouse!.needs).toEqual([true]);
    expect(withBeetle.animals.woodlouse!.happiness).toBeGreaterThan(without.animals.woodlouse!.happiness);
  });

  it('Gattungsbonus ab 2 Arten', () => {
    const ev = evaluate(stateAt(3, ['earthworm', 'woodlouse', 'centipede']));
    expect(ev.genusCounts.soil).toBe(3);
    expect(ev.traitTiers.soil).toBe(2);
    expect(ev.traitTiers.birds).toBe(0);
  });

  it('Waldgedächtnis: +2 % Wachstum und Samen je Punkt, ungültige Werte zählen nicht', () => {
    const base = evaluate(stateAt(2));
    const state = stateAt(2);
    state.meta.forestMemory = 5;
    const boosted = evaluate(state);
    expect(boosted.growth).toBeCloseTo(base.growth * 1.1);
    expect(boosted.seeds).toBeCloseTo(base.seeds * 1.1);
    state.meta.forestMemory = NaN;
    expect(evaluate(state).growth).toBeCloseTo(base.growth);
  });

  it('Cache: Änderungen am Ökosystem werden sofort sichtbar', () => {
    const state = stateAt(1);
    const before = evaluate(state);
    expect(evaluate(state)).toBe(before); // unverändert → derselbe Wert
    state.niches.roots.push('earthworm');
    expect(evaluate(state).harmony).toBeGreaterThan(before.harmony);
    state.niches.roots.length = 0;
    expect(evaluate(state).harmony).toBeCloseTo(before.harmony);
  });

  it('Waldgedächtnis ist auf MAX_FOREST_MEMORY begrenzt', () => {
    const state = stateAt(2);
    state.meta.forestMemory = MAX_FOREST_MEMORY;
    const capped = evaluate(state).growth;
    for (const huge of [1e9, Number.MAX_VALUE]) {
      state.meta.forestMemory = huge;
      expect(evaluate(state).growth).toBe(capped);
    }
    state.meta.forestMemory = Infinity; // ungültig → zählt nicht
    expect(evaluate(state).growth).toBeCloseTo(evaluate(stateAt(2)).growth);
  });

  it('das gecachte Ergebnis ist tief eingefroren', () => {
    const ev = evaluate(stateAt(3, ['earthworm', 'oakmoth']));
    for (const part of [ev, ev.animals, ev.animals.earthworm, ev.animals.earthworm!.needs, ev.slots, ev.genusCounts, ev.traitTiers, ev.breakdown, ev.communities]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
    expect(() => {
      (ev.slots as Record<string, number>).roots = 99;
    }).toThrow(TypeError);
    expect(() => (ev.animals.earthworm!.needs as boolean[]).push(true)).toThrow(TypeError);
    // Vorschauen bleiben veränderbar (nicht geteilt).
    expect(Object.isFrozen(evaluateEcosystem({ stage: 1, niches: stateAt(1).niches, forestMemory: 0 }))).toBe(false);
  });

  it('übersteht unbekannte Arten und ungültige Stufen', () => {
    const ev = evaluateEcosystem({
      stage: 99,
      niches: { roots: ['gibt-es-nicht'], litter: [], edge: [], crown: [], bark: [], hollows: [] },
      forestMemory: 0,
    });
    expect(Number.isFinite(ev.growth)).toBe(true);
    expect(ev.avgHappiness).toBe(0);
  });

  it('stimmt mit dem Referenzmodell (scripts/v2/model.ts) überein – jede Art einzeln und paarweise auf jeder Stufe', () => {
    const problems: string[] = [];
    for (let stage = 0; stage < STAGES.length; stage++) {
      for (let i = 0; i < SPECIES.length; i++) {
        for (let j = i; j < SPECIES.length; j++) {
          const ids = i === j ? [SPECIES[i]!.id] : [SPECIES[i]!.id, SPECIES[j]!.id];
          problems.push(...diffWithReference(stage, ids, []).problems);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 15_000);

  it('evaluate(state) (mit Cache) rechnet wie evaluateEcosystem', () => {
    const state = stateAt(5, ['earthworm', 'woodlouse', 'porcini', 'glowworm', 'oakmoth']);
    state.plants = ['moss', 'fern'];
    // Ein neuer Zyklus: Frühling, Stieleiche.
    const direct = evaluateEcosystem({ stage: 5, niches: state.niches, plants: state.plants, forestMemory: 0, season: 'spring', mainTree: 'oak' });
    expect(evaluate(state)).toEqual(direct);
  });
});

/** Art-ID → Nische (für den Aufbau der Vergleichs-Ökosysteme). */
const NICHE_OF = new Map(SPECIES.map((s) => [s.id, s.niche]));
const PLANT_IDS = new Set(PLANTS.map((p) => p.id));

/**
 * Vergleicht evaluateEcosystem() mit dem Referenzmodell – vollständig, auch mit
 * Lebensgemeinschaften. Gibt Abweichungen als Texte zurück (leer = gleich) und wie viele
 * Lebensgemeinschaften das Modell gefunden hat. Bewusst ohne expect() je Wert: Der
 * Vergleich läuft zigtausendfach, gemeldet wird gesammelt (schneller, gleiche Aussage).
 * IDs in `ids` sind Arten oder Pflanzen (Pflanzen kommen zusätzlich in den Pflanzring).
 */
function diffWithReference(
  stage: number,
  ids: readonly string[],
  plants: readonly string[],
): { problems: string[]; communities: number } {
  const eco = emptyEco();
  eco.stage = stage;
  eco.plants = [...plants];
  const niches = {} as Record<NicheId, string[]>;
  for (const n of NICHE_IDS) niches[n] = [];
  for (const id of ids) {
    if (PLANT_IDS.has(id)) {
      eco.plants.push(id);
      continue;
    }
    const n = NICHE_OF.get(id)!;
    eco.animals[n].push(id);
    niches[n].push(id);
  }
  const ref = referenceEvaluate(eco);
  const ours = evaluateEcosystem({ stage, niches, plants: eco.plants, forestMemory: 0 });
  const problems: string[] = [];
  const label = () => `${stage}: ${ids.join(',')} | ${eco.plants.join(',')}`;
  // Wie toBeCloseTo(b, digits): |a − b| < 10^−digits / 2
  const close = (what: string, a: number, b: number, digits: number) => {
    if (!(Math.abs(a - b) < Math.pow(10, -digits) / 2)) problems.push(`${label()} – ${what}: ${a} ≠ ${b}`);
  };
  const same = (what: string, a: unknown, b: unknown) => {
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    if (ja !== jb) problems.push(`${label()} – ${what}: ${ja} ≠ ${jb}`);
  };
  close('harmony', ours.harmony, ref.harmony, 9);
  close('growth', ours.growth, ref.growth, 9);
  close('seeds', ours.seeds, ref.seeds, 9);
  close('avgHappiness', ours.avgHappiness, ref.avgHappiness, 9);
  close('supply', ours.supply, ref.supply, 12);
  close('variety', ours.breakdown.variety, ref.breakdown.variety, 12);
  close('pyramid', ours.breakdown.pyramid, ref.breakdown.pyramid, 9);
  close('communities', ours.breakdown.communities, ref.breakdown.communities, 12);
  close('extra', ours.breakdown.extra, ref.breakdown.extra, 12);
  same('unguarded', ours.unguarded, ref.pyramid.unguarded);
  same('aktive Lebensgemeinschaften', activeCommunities(ours), ref.communities);
  same('traitTiers', GENERA.map((g) => ours.traitTiers[g]), GENERA.map((g) => ref.traitTiers[g]));
  // Plätze inkl. „+1 Höhlen“ von Borkenkäfer und Buntspecht und dem Baumeister
  same('slots', NICHE_IDS.map((n) => ours.slots[n]), NICHE_IDS.map((n) => ref.slots[n]));
  for (const id of ids) {
    if (!PLANT_IDS.has(id)) close(`Zufriedenheit ${id}`, ours.animals[id]!.happiness, ref.happiness.get(id)!, 12);
  }
  return { problems, communities: ref.communities.length };
}

/** Alle Kombinationen, je Mitglied eine Alternative zu wählen. */
function memberCombinations(members: readonly (string | readonly string[])[]): string[][] {
  let out: string[][] = [[]];
  for (const m of members) out = out.flatMap((combo) => memberOptions(m).map((id) => [...combo, id]));
  return out;
}

describe('Lebensgemeinschaften', () => {
  it('9 Lebensgemeinschaften wie im Referenzmodell; Mitglieder sind Arten oder Pflanzen', () => {
    expect(COMMUNITIES).toHaveLength(9);
    expect(COMMUNITIES.map((c) => [c.id, c.name, c.harmony, c.members, c.effects, c.hint])).toEqual(
      REFERENCE_COMMUNITIES.map((c) => [c.id, c.name, c.harmony, c.members, c.effects, c.hint]),
    );
    for (const c of COMMUNITIES) {
      for (const m of c.members) {
        for (const id of memberOptions(m)) expect(NICHE_OF.has(id) || PLANT_IDS.has(id), `${c.id}: ${id}`).toBe(true);
      }
      // Mindestens 3 Mitglieder: Paare bilden nie eine Gemeinschaft.
      expect(c.members.length, c.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('Humusküche: +8 Harmonie und +5 % Wachstum; fehlende Mitglieder werden genannt', () => {
    const partial = evaluate(stateAt(3, ['earthworm']));
    expect(partial.communities.find((c) => c.id === 'humus')).toEqual({
      id: 'humus',
      active: false,
      present: 1,
      total: 3,
      missing: [['woodlouse'], ['chanterelle', 'porcini']],
      harmony: 0,
    });
    expect(partial.communities.map((c) => c.id)).toEqual(COMMUNITIES.map((c) => c.id));
    expect(partial.breakdown.communities).toBe(0);

    const ev = evaluate(stateAt(3, ['earthworm', 'woodlouse', 'porcini']));
    expect(ev.communities.find((c) => c.id === 'humus')).toMatchObject({ active: true, present: 3, missing: [], harmony: 8 });
    expect(activeCommunities(ev)).toEqual(['humus']);
    expect(ev.breakdown.communities).toBe(8);
    const b = ev.breakdown;
    expect(ev.harmony).toBeCloseTo(b.variety + b.happiness + b.pyramid + b.communities + b.extra, 12);
    // +5 % Wachstum, nicht mit Zufriedenheit skaliert
    const animalBonus = ['earthworm', 'woodlouse', 'porcini'].reduce((sum, id) => {
      const sp = SPECIES.find((s) => s.id === id)!;
      const pct = sp.effects.reduce((p, e) => p + (e.kind === 'growth' ? e.pct : 0), 0);
      return sum + (pct / 100) * ev.animals[id]!.happiness;
    }, 0);
    const traitBonus = GENERA.reduce((sum, g) => sum + growthOfTraits(g, ev.traitTiers[g]), 0);
    expect(ev.growthBonus - animalBonus - traitBonus - SPRING_GROWTH).toBeCloseTo(0.05, 12);
  });

  it('Pflanzen zählen als Mitglieder (Birkenbund, Feuchter Grund)', () => {
    const state = stateAt(3, ['flyagaric', 'slug']);
    state.plants = ['birch', 'moss', 'fern'];
    const ev = evaluate(state);
    expect(activeCommunities(ev)).toEqual(['birch-bond', 'damp-ground']);
    expect(ev.breakdown.communities).toBe(12);
    state.plants = ['birch', 'moss'];
    expect(evaluate(state).communities.find((c) => c.id === 'damp-ground')!.missing).toEqual([['fern']]);
  });

  it('Lichterabend (Glühwürmchen): jede aktive Lebensgemeinschaft +COMMUNITY_BOOST_HARMONY', () => {
    const base = ['owl', 'bat', 'hedgehog', 'earthworm', 'woodlouse', 'chanterelle'];
    const without = evaluate(stateAt(5, base));
    expect(activeCommunities(without)).toEqual(['humus', 'night-shift']);
    expect(without.breakdown.communities).toBe(14);
    const withGlow = evaluate(stateAt(5, [...base, 'glowworm']));
    expect(withGlow.abilities).toContain('communityBoost');
    expect(withGlow.breakdown.communities).toBe(14 + 2 * COMMUNITY_BOOST_HARMONY);
    expect(withGlow.communities.find((c) => c.id === 'night-shift')!.harmony).toBe(6 + COMMUNITY_BOOST_HARMONY);
    // Ohne Lebensgemeinschaft bringt der Lichterabend nichts.
    expect(evaluate(stateAt(5, ['glowworm'])).breakdown.communities).toBe(0);
  });

  it('unbekannte IDs bilden keine Gemeinschaft, Duplikate zählen nicht doppelt', () => {
    const ev = evaluateEcosystem({
      stage: 5,
      niches: { roots: ['earthworm', 'earthworm', 'gibt-es-nicht'], litter: [], edge: [], crown: [], bark: [], hollows: [] },
      plants: ['moss', 'moss', 'fern', 'fern'],
      forestMemory: 0,
    });
    expect(activeCommunities(ev)).toEqual([]);
    expect(ev.communities.find((c) => c.id === 'damp-ground')!.missing).toEqual([['slug', 'salamander']]);
    expect(Number.isFinite(ev.harmony)).toBe(true);
  });

  it('jede Lebensgemeinschaft mit jeder Mitglieder-Kombination wie im Referenzmodell (auch unvollständig, mit Lichterabend)', () => {
    const problems: string[] = [];
    let active = 0;
    for (const c of COMMUNITIES) {
      for (const combo of memberCombinations(c.members)) {
        // vollständig, mit Glühwürmchen, und je ein Mitglied fehlt
        const variants = [combo, [...new Set([...combo, 'glowworm'])], ...combo.map((_, i) => combo.filter((__, k) => k !== i))];
        for (let stage = 0; stage < STAGES.length; stage++) {
          for (const ids of variants) {
            const d = diffWithReference(stage, ids, []);
            problems.push(...d.problems);
            if (d.communities > 0) active++;
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(active).toBeGreaterThan(100);
  });

  it('communityChanges: neu entstandene und zerfallene Gemeinschaften zwischen zwei Auswertungen', () => {
    const before = evaluate(stateAt(3, ['earthworm', 'woodlouse']));
    const after = evaluate(stateAt(3, ['earthworm', 'woodlouse', 'chanterelle']));
    const forward = communityChanges(before, after);
    expect(forward.completed.map((c) => [c.id, c.harmony])).toEqual([['humus', 8]]);
    expect(forward.broken).toEqual([]);
    // Rückwärts: Die Humusküche zerfällt, die Harmonie von vorher wird genannt.
    const backward = communityChanges(after, before);
    expect(backward.completed).toEqual([]);
    expect(backward.broken.map((c) => [c.id, c.harmony])).toEqual([['humus', 8]]);
    // Keine Änderung: beide leer.
    expect(communityChanges(after, after)).toEqual({ completed: [], broken: [] });
  });
});

/** Wachstumsbonus (Anteil) der ersten `tiers` Gattungsboni. */
function growthOfTraits(genus: keyof typeof TRAITS, tiers: number): number {
  let sum = 0;
  for (let i = 0; i < tiers; i++) for (const e of TRAITS[genus][i]!.effects) if (e.kind === 'growth') sum += e.pct / 100;
  return sum;
}

describe('evaluate mit Begleitpflanzen', () => {
  /** Stand auf Stufe `stage` mit Tieren und Pflanzen (Plätze werden nicht geprüft). */
  const withPlants = (stage: number, animals: string[], plants: string[]) => {
    const state = stateAt(stage, animals);
    state.plants = plants;
    return state;
  };

  it('Pflanzen wachsen und tragen Samen; der Hauptbaum bleibt gleich', () => {
    const base = evaluate(stateAt(2));
    const ev = evaluate(withPlants(2, [], ['strawberry']));
    // Setzling: 3,5 + 0,3 Wachstum, 0,25 + 1 Samen; Licht 3 ≥ 2, Wasser 3 ≥ 1 → V = 1
    expect(ev.supply).toBe(1);
    expect(ev.lightNeed).toBe(2);
    expect(ev.waterNeed).toBe(1);
    expect(ev.groupCounts).toEqual({ trees: 1, shrubs: 0, flowers: 1, mosses: 0 });
    expect(ev.growth).toBeCloseTo(3.8 * (1 + SPRING_GROWTH) * ev.multiplier);
    expect(ev.seeds).toBeCloseTo(1.25 * ev.multiplier);
    expect(ev.plantGrowth).toBeCloseTo(0.3 * (1 + SPRING_GROWTH) * ev.multiplier);
    expect(ev.plantSeeds).toBeCloseTo(1 * ev.multiplier);
    // Vielfalt: +3 Gruppe Blumen, +1 Art; Pyramide: Tragfähigkeit bleibt 5
    expect(ev.breakdown.variety).toBe(base.breakdown.variety + 4);
    expect(ev.plantSlots).toBe(2);
  });

  it('Versorgung: zu wenig Licht bremst nur die Begleitpflanzen', () => {
    // Junger Baum: Licht 5, Wasser 5. Zwei Birken brauchen 8 Licht → V = 5/8.
    const ev = evaluate(withPlants(3, [], ['birch', 'birch']));
    expect(ev.lightNeed).toBe(8);
    expect(ev.supply).toBeCloseTo(5 / 8);
    expect(ev.growth).toBeCloseTo((6 + (5 / 8) * 3) * (1 + SPRING_GROWTH) * ev.multiplier);
    expect(ev.sunny).toBe(false); // 5 − 8 < 2 frei
  });

  it('Versorgung: Wasser begrenzt, Moos speichert Wasser (negativer Bedarf)', () => {
    // Keimling: Wasser 2. Buschwindröschen + Moos: Wasserbedarf 1 − 2 = −1 → keine Grenze.
    const ev = evaluate(withPlants(1, [], ['anemone', 'moss']));
    expect(ev.waterNeed).toBe(-1);
    expect(ev.supply).toBe(1);
    // Setzling (Wasser 3): Wurmfarn ×2 brauchen 4 Wasser → V = 3/4; Regenwurm bringt +2·z.
    const dry = evaluate(withPlants(2, [], ['fern', 'fern']));
    expect(dry.supply).toBeCloseTo(3 / 4);
    const wet = evaluate(withPlants(2, ['earthworm'], ['fern', 'fern']));
    expect(wet.water).toBeCloseTo(3 + 2 * wet.animals.earthworm!.happiness);
    expect(wet.supply).toBe(1);
  });

  it('Versorgung bleibt in [0, 1], auch auf Stufe 0 ohne Licht', () => {
    const ev = evaluate(withPlants(0, [], ['birch']));
    expect(ev.supply).toBe(0);
    expect(ev.growth).toBeCloseTo(1 * (1 + SPRING_GROWTH) * ev.multiplier); // nur der Hauptbaum
    expect(Number.isFinite(ev.seeds)).toBe(true);
  });

  it('Wünsche werden erfüllbar: Sträucher, 2× Bäume, Blumen, Nektar, Feuchte', () => {
    const robin = evaluate(withPlants(3, ['robin'], ['hazel'])).animals.robin!;
    expect(robin.needs).toEqual([true]); // 1× Sträucher
    const tit = evaluate(withPlants(3, ['bluetit', 'woodpecker'], ['rowan'])).animals.bluetit!;
    expect(tit.needs).toEqual([true, true]); // 2× Bäume (Hauptbaum + Eberesche), Baumhöhle
    const bee = evaluate(withPlants(2, ['bee'], ['anemone']));
    expect(bee.animals.bee!.needs).toEqual([true, true]); // Blumen, sonnig (3 − 1 ≥ 2)
    expect(bee.animals.bee!.food).toBe(1); // Nektar
    expect(evaluate(withPlants(2, ['bee'], ['strawberry'])).animals.bee!.needs).toEqual([true, false]); // 3 − 2 < 2: nicht sonnig
    const worm = evaluate(withPlants(1, ['earthworm'], ['moss'])).animals.earthworm!;
    expect(worm.needs).toEqual([true]); // Feuchte
    expect(worm.happiness).toBe(1);
  });

  it('Nahrung: Pflanzen bieten je 1 Einheit, Nachfrage teilt sie', () => {
    // Rotkehlchen frisst Beeren: Brombeere bietet 1, ein Fresser → satt.
    const ev = evaluate(withPlants(2, ['robin'], ['bramble']));
    expect(ev.animals.robin!.food).toBe(1);
  });

  it('unbekannte Pflanzen-IDs werden übersprungen', () => {
    const ev = evaluate(withPlants(2, [], ['gibt-es-nicht']));
    expect(ev).toMatchObject({ supply: 1, lightNeed: 0, plantGrowth: 0 });
    expect(ev.growth).toBeCloseTo(evaluate(stateAt(2)).growth);
  });

  it('Cache: Pflanzen ändern die Auswertung sofort', () => {
    const state = stateAt(2);
    const before = evaluate(state).growth;
    state.plants.push('hazel');
    expect(evaluate(state).growth).toBeGreaterThan(before);
  });

  it('stimmt mit dem Referenzmodell überein – Stichproben mit Tieren und Pflanzen (inkl. Lebensgemeinschaften)', () => {
    const rng = { rngState: 20261020 };
    const problems: string[] = [];
    let withCommunities = 0;
    for (let n = 0; n < 3000; n++) {
      const stage = randomInt(rng, STAGES.length);
      // Je Art mit Wahrscheinlichkeit 1/2, 1/4 oder 1/8 – kleine wie volle Ökosysteme.
      const sparsity = 2 + randomInt(rng, 3) * 2;
      const ids = SPECIES.filter(() => randomInt(rng, sparsity) === 0).map((s) => s.id);
      const plants = Array.from({ length: randomInt(rng, 13) }, () => PLANTS[randomInt(rng, PLANTS.length)]!.id);
      const d = diffWithReference(stage, ids, plants);
      problems.push(...d.problems);
      if (d.communities > 0) withCommunities++;
    }
    expect(problems).toEqual([]);
    // Ein guter Teil der Stichproben enthält Lebensgemeinschaften – aber nicht alle.
    expect(withCommunities).toBeGreaterThan(500);
    expect(withCommunities).toBeLessThan(3000);
  }, 15_000);

  it('stimmt mit dem Referenzmodell überein – jede Pflanze einzeln und doppelt auf jeder Stufe', () => {
    const problems: string[] = [];
    for (let stage = 0; stage < STAGES.length; stage++) {
      for (const p of PLANTS) {
        for (const plants of [[p.id], [p.id, p.id]]) {
          problems.push(...diffWithReference(stage, ['earthworm', 'bee', 'robin'], plants).problems);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('Pflanzring und Kosten', () => {
  it('plantSlots je Stufe, 0 für unbekannte Stufen', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(plantSlots)).toEqual([0, 1, 2, 3, 5, 7, 9, 12]);
    expect(plantSlots(99)).toBe(0);
    expect(plantSlots(-1)).toBe(0);
    expect(plantSlots(NaN)).toBe(0);
  });

  it('plantCost: 20 · 1,9^n', () => {
    expect(plantCost(0)).toBe(20);
    expect(plantCost(1)).toBeCloseTo(38);
    expect(plantCost(2)).toBeCloseTo(72.2);
    expect(Math.round(plantCost(8))).toBe(3397);
    expect(plantCost(-3)).toBe(20);
    expect(plantCost(NaN)).toBe(20);
    expect(plantCost(2000)).toBe(Infinity); // nie bezahlbar, aber kein NaN
    const state = stateAt(3);
    state.plants = ['hazel', 'hazel'];
    expect(nextPlantCost(state)).toBeCloseTo(72.2);
  });

  it('plantsAfterChoice: Duplikate erlaubt, Ring voll → nur mit Ersatz', () => {
    const state = stateAt(2); // Setzling: 2 Plätze
    expect(plantsAfterChoice(state, 'hazel')).toEqual(['hazel']);
    state.plants = ['moss'];
    expect(plantsAfterChoice(state, 'hazel', 'moss')).toBeNull(); // Ring noch frei
    state.plants = ['hazel', 'moss'];
    expect(plantsAfterChoice(state, 'moss', 'moss')).toBeNull(); // dieselbe Pflanze
    expect(plantsAfterChoice(state, 'hazel')).toBeNull();
    expect(plantsAfterChoice(state, 'hazel', 'moss')).toEqual(['hazel', 'hazel']);
    expect(plantsAfterChoice(state, 'hazel', 'birch')).toBeNull();
    expect(plantsAfterChoice(state, 'gibt-es-nicht', 'moss')).toBeNull();
    expect(state.plants).toEqual(['hazel', 'moss']); // Eingabe unverändert
  });
});

describe('Wegpunkte und Stufen', () => {
  it('waypointsForGrowth zählt erreichte Schwellen', () => {
    expect(waypointsForGrowth(0)).toBe(0);
    expect(waypointsForGrowth(3.99)).toBe(0);
    expect(waypointsForGrowth(4)).toBe(1);
    expect(waypointsForGrowth(168)).toBe(3);
    expect(waypointsForGrowth(1e300)).toBe(WAYPOINT_COUNT);
    expect(waypointsForGrowth(Infinity)).toBe(WAYPOINT_COUNT);
    expect(waypointsForGrowth(NaN)).toBe(0);
    expect(waypointsForGrowth(-5)).toBe(0);
  });

  it('thresholdFor: 0 am Start, Infinity nach dem letzten Wegpunkt', () => {
    expect(thresholdFor(0)).toBe(0);
    expect(thresholdFor(-3)).toBe(0);
    expect(thresholdFor(WAYPOINT_COUNT + 1)).toBe(Infinity);
  });

  it('stageForWaypoint folgt den Stufen-Wegpunkten', () => {
    expect([0, 1, 2, 3, 5, 6, 11, 12, 20, 28, 36, 99].map(stageForWaypoint)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 7]);
  });

  it('nicheSlots: geschlossen auf Stufe 0, unbekannte Stufen = 0', () => {
    expect(Object.values(nicheSlots(0)).every((n) => n === 0)).toBe(true);
    expect(nicheSlots(1).roots).toBe(1);
    expect(nicheSlots(99).roots).toBe(0);
    expect(Object.keys(nicheSlots(3))).toEqual([...NICHE_IDS]);
  });

  it('nicheSlots mit Tieren: Borkenkäfer und Buntspecht schaffen je +1 Platz Höhlen', () => {
    const at = (stage: number, ids: string[]) => nicheSlots(stage, stateAt(stage, ids).niches);
    expect(nicheSlots(3).hollows).toBe(0);
    expect(at(3, []).hollows).toBe(0);
    expect(at(3, ['barkbeetle']).hollows).toBe(1); // Höhlen öffnen vor dem Alten Baum
    expect(at(4, ['barkbeetle']).hollows).toBe(2);
    expect(at(4, ['barkbeetle', 'woodpecker']).hollows).toBe(3);
    expect(at(7, ['barkbeetle', 'woodpecker']).hollows).toBe(5);
    expect(at(4, ['barkbeetle']).bark).toBe(2); // andere Nischen unverändert
    // Unbekannte Arten und fehlende Nischen stören nicht.
    expect(nicheSlots(4, { bark: ['gibt-es-nicht', 'barkbeetle'] }).hollows).toBe(2);
    expect(nicheSlots(4, {}).hollows).toBe(1);
  });

  it('nicheSlots: Platz-Wirkungen öffnen keine geschlossene Nische ohne opensEarly', () => {
    const builder = fakeSpecies({ id: 'test-builder', niche: 'roots', effects: [{ kind: 'slot', niche: 'crown', amount: 1 }] });
    withFakeSpecies([builder], () => {
      expect(nicheSlots(1, { roots: ['test-builder'] }).crown).toBe(0); // Krone erst ab Junger Baum
      expect(nicheSlots(3, { roots: ['test-builder'] }).crown).toBe(3);
    });
  });

  it('nicheOverflow und nichesAfterChoice: entlassene Platz-Schaffer dürfen niemanden obdachlos machen', () => {
    const owl = fakeSpecies({ id: 'test-owl', niche: 'hollows' });
    const nuthatch = fakeSpecies({ id: 'test-nuthatch', niche: 'bark' });
    withFakeSpecies([owl, nuthatch], () => {
      const state = stateAt(3, ['barkbeetle']);
      state.niches.hollows.push('test-owl'); // 1/1 Höhlenplatz dank Borkenkäfer
      expect(nicheOverflow(3, state.niches).hollows).toBe(0);
      expect(nichesAfterChoice(state, 'test-nuthatch', 'barkbeetle')).toBeNull();
      expect(nichesAfterChoice(state, 'woodpecker', 'barkbeetle')!.bark).toEqual(['woodpecker']);
      expect(nichesAfterChoice(state, 'test-nuthatch', 'gibt-es-nicht')).toBeNull();
      expect(nichesAfterChoice(state, 'test-nuthatch')).toBeNull(); // Stamm 1/1 voll
      state.niches.hollows.length = 0;
      expect(nichesAfterChoice(state, 'test-nuthatch', 'barkbeetle')!.bark).toEqual(['test-nuthatch']);
      expect(state.niches.bark).toEqual(['barkbeetle']); // Eingabe unverändert
    });
  });

  it('hasSpecies', () => {
    const state = stateAt(3, ['robin']);
    expect(hasSpecies(state, 'robin')).toBe(true);
    expect(hasSpecies(state, 'bee')).toBe(false);
    expect(hasSpecies({ niches: {} as typeof state.niches }, 'robin')).toBe(false);
  });

  it('growth() = Stufe + Fortschritt, stetig und in [0, 8]', () => {
    const state = createInitialState(0);
    expect(growth(state)).toBe(0);
    state.totalGrowth = 2;
    expect(growth(state)).toBeCloseTo(0.5);
    const mid = stateAt(2);
    mid.totalGrowth = (thresholdFor(3) + thresholdFor(6)) / 2;
    expect(growth(mid)).toBeCloseTo(2.5);
    const last = stateAt(7);
    last.totalGrowth = 1e12;
    expect(growth(last)).toBe(8);
    expect(stageProgress(last)).toBe(1);
  });

  it('waypointProgress und secondsToNextWaypoint', () => {
    const state = createInitialState(0);
    state.totalGrowth = 1;
    expect(waypointProgress(state)).toBeCloseTo(0.25);
    expect(secondsToNextWaypoint(state)).toBeCloseTo(3 / (1.05 * (1 + SPRING_GROWTH)));
    const done = stateAt(7);
    expect(waypointProgress(done)).toBe(1);
    expect(secondsToNextWaypoint(done)).toBe(Infinity);
  });
});
