import { describe, expect, it } from 'vitest';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { NICHE_IDS } from '../src/content/types';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import {
  evaluate,
  evaluateEcosystem,
  growth,
  nicheSlots,
  secondsToNextWaypoint,
  stageForWaypoint,
  stageProgress,
  thresholdFor,
  waypointProgress,
  waypointsForGrowth,
} from '../src/core/formulas';
import { createInitialState } from '../src/core/state';
import { evaluate as referenceEvaluate, emptyEco } from '../scripts/v2/model';
import { stateAt } from './helpers';

describe('evaluate', () => {
  it('leerer Samen: Harmonie 5 (Tragfähigkeit), 1,05 🌿/s', () => {
    const ev = evaluate(createInitialState(0));
    expect(ev.harmony).toBeCloseTo(5);
    expect(ev.multiplier).toBeCloseTo(1.05);
    expect(ev.growth).toBeCloseTo(1.05);
    expect(ev.seeds).toBeCloseTo(0.105);
    expect(ev.avgHappiness).toBe(0);
  });

  it('Regenwurm im Keimling: 75 % zufrieden, Harmonie ~38 (Beispiel aus dem Design)', () => {
    const ev = evaluate(stateAt(1, ['earthworm']));
    expect(ev.animals.earthworm!.happiness).toBeCloseTo(0.75);
    expect(ev.animals.earthworm!.needs).toEqual([false]); // keine Feuchte ohne Moos
    expect(ev.harmony).toBeCloseTo(38.17, 1);
    // 2 🌿/s · (1 + 8 % · 0,75) · 1,38
    expect(ev.growth).toBeCloseTo(2 * 1.06 * (1 + ev.harmony / 100));
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

  it('übersteht unbekannte Arten und ungültige Stufen', () => {
    const ev = evaluateEcosystem({
      stage: 99,
      niches: { roots: ['gibt-es-nicht'], litter: [], edge: [], crown: [], bark: [] },
      forestMemory: 0,
    });
    expect(Number.isFinite(ev.growth)).toBe(true);
    expect(ev.avgHappiness).toBe(0);
  });

  it('stimmt mit dem Referenzmodell (scripts/v2/model.ts) überein – alle Kombinationen der 9 Arten', () => {
    for (let stage = 0; stage < STAGES.length; stage++) {
      for (let mask = 0; mask < 1 << SPECIES.length; mask++) {
        const ids = SPECIES.filter((_, i) => mask & (1 << i)).map((s) => s.id);
        const ours = evaluate(stateAt(stage, ids));
        const eco = emptyEco();
        eco.stage = stage;
        for (const id of ids) eco.animals[SPECIES.find((s) => s.id === id)!.niche].push(id);
        const ref = referenceEvaluate(eco);
        const label = `${stage}: ${ids.join(',')}`;
        expect(ours.harmony, label).toBeCloseTo(ref.harmony, 9);
        expect(ours.growth, label).toBeCloseTo(ref.growth, 9);
        expect(ours.seeds, label).toBeCloseTo(ref.seeds, 9);
        expect(ours.avgHappiness, label).toBeCloseTo(ref.avgHappiness, 9);
      }
    }
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
    expect(secondsToNextWaypoint(state)).toBeCloseTo(3 / 1.05);
    const done = stateAt(7);
    expect(waypointProgress(done)).toBe(1);
    expect(secondsToNextWaypoint(done)).toBe(Infinity);
  });
});
