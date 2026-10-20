import { describe, expect, it } from 'vitest';
import { CARDS_PER_ENCOUNTER, DECLINE_SEEDS, MAX_PENDING_ENCOUNTERS, RARITY_WEIGHTS, REROLL_BASE_COST } from '../src/content/encounters';
import { NICHES, NICHES_BY_ID } from '../src/content/niches';
import { BASE_HAPPINESS, GENUS_INFO, RARITY_NAMES, SPECIES, TAG_NAMES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../src/content/traits';
import { GENERA, NICHE_IDS, PLANT_GROUPS } from '../src/content/types';
import { WAYPOINT_BASE, WAYPOINT_COUNT, WAYPOINT_POWER, WAYPOINT_THRESHOLDS, waypointThreshold } from '../src/content/waypoints';
import * as reference from '../scripts/v2/content';

const unique = (ids: string[]) => new Set(ids).size === ids.length;

describe('Inhalte v2', () => {
  it('IDs und Namen sind eindeutig', () => {
    expect(unique(SPECIES.map((s) => s.id))).toBe(true);
    expect(unique(SPECIES.map((s) => s.name))).toBe(true);
    expect(unique(NICHES.map((n) => n.id))).toBe(true);
    expect(unique(STAGES.map((s) => s.id))).toBe(true);
  });

  it('der Prototyp hat 3 Gattungen × 3 Arten, je mindestens 2 gewöhnliche', () => {
    for (const g of GENERA) {
      const of = SPECIES.filter((s) => s.genus === g);
      expect(of).toHaveLength(3);
      expect(of.filter((s) => s.rarity === 0).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('Verweise der Arten sind gültig', () => {
    for (const s of SPECIES) {
      expect(NICHES_BY_ID.has(s.niche), `${s.id}: Nische`).toBe(true);
      expect(GENUS_INFO[s.genus], `${s.id}: Gattung`).toBeDefined();
      expect(RARITY_NAMES[s.rarity]).toBeDefined();
      expect(BASE_HAPPINESS[s.rarity]).toBeDefined();
      expect(s.unlock).toBeGreaterThanOrEqual(1);
      expect(s.unlock).toBeLessThan(STAGES.length);
      // Die Nische ist offen, sobald die Art freigeschaltet ist.
      expect(NICHES_BY_ID.get(s.niche)!.slots[s.unlock], `${s.id}: Nische offen ab unlock`).toBeGreaterThan(0);
      for (const t of [...s.food, ...s.provides]) expect(TAG_NAMES[t], `${s.id}: Merkmal ${t}`).toBeDefined();
      for (const c of s.needs) {
        if (c.kind === 'tag') expect(TAG_NAMES[c.tag]).toBeDefined();
        if (c.kind === 'group') expect(PLANT_GROUPS).toContain(c.group);
      }
      for (const e of s.effects) {
        if (e.kind === 'control') expect(TAG_NAMES[e.tag]).toBeDefined();
        if (e.kind === 'groupSeeds' || e.kind === 'groupGrowth') expect(PLANT_GROUPS).toContain(e.group);
      }
      expect(s.food.length).toBeGreaterThan(0);
      expect(s.summary.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(0);
    }
  });

  it('übernimmt die Zahlen aus scripts/v2/content.ts', () => {
    for (const s of SPECIES) {
      const ref = reference.SPECIES.find((r) => r.id === s.id)!;
      expect(ref, s.id).toBeDefined();
      expect(s).toMatchObject({
        name: ref.name,
        genus: ref.genus,
        rarity: ref.rarity,
        level: ref.level,
        niche: ref.niche,
        unlock: ref.unlock,
        food: ref.food,
        needs: ref.needs,
        provides: ref.provides,
        text: ref.text,
      });
      // Einzige Abweichung: „+1 Platz Höhlen“ entfällt (die Nische gibt es im Prototyp nicht).
      expect(s.effects).toEqual(ref.effects.filter((e) => e.kind !== 'slot'));
    }
    STAGES.forEach((stage, i) => {
      expect(stage.name).toBe(reference.STAGE_NAMES[i]);
      expect(stage.waypoint).toBe(reference.STAGE_WAYPOINTS[i]);
      expect(stage.treeGrowth).toBe(reference.TREE_GROWTH[i]);
      expect(stage.treeSeeds).toBe(reference.TREE_SEEDS[i]);
      expect(stage.light).toBe(reference.LIGHT_BUDGET[i]);
      expect(stage.water).toBe(reference.WATER_BUDGET[i]);
    });
    for (const n of NICHES) expect(n.slots).toEqual(reference.NICHE_SLOTS[n.id]);
    for (const g of GENERA) expect(TRAITS[g].map((t) => t.effects)).toEqual(reference.TRAITS[g]);
    expect(TRAIT_THRESHOLDS).toEqual(reference.TRAIT_THRESHOLDS);
    expect(RARITY_WEIGHTS).toEqual(reference.RARITY_WEIGHTS);
    expect(WAYPOINT_COUNT).toBe(reference.WAYPOINT_COUNT);
    // Bewusste Abweichung: Der Prototyp ohne Pflanzen nutzt einen flacheren Exponenten
    // (DESIGN_V2.md 15.4); die Wegpunkte liegen darum früher, nie später als im Design.
    expect(WAYPOINT_BASE).toBe(reference.WAYPOINT_BASE);
    expect(WAYPOINT_POWER).toBeLessThanOrEqual(reference.WAYPOINT_POWER);
    for (let k = 1; k <= WAYPOINT_COUNT; k++) expect(waypointThreshold(k)).toBeLessThanOrEqual(reference.waypointThreshold(k));
  });

  it('Stufen, Nischen und Wegpunkte passen zusammen', () => {
    expect(STAGES[0]!.waypoint).toBe(0);
    expect(STAGES[STAGES.length - 1]!.waypoint).toBe(WAYPOINT_COUNT);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i]!.waypoint).toBeGreaterThan(STAGES[i - 1]!.waypoint);
      expect(STAGES[i]!.treeGrowth).toBeGreaterThan(STAGES[i - 1]!.treeGrowth);
    }
    for (const n of NICHES) {
      expect(n.slots).toHaveLength(STAGES.length);
      for (let i = 1; i < n.slots.length; i++) expect(n.slots[i]).toBeGreaterThanOrEqual(n.slots[i - 1]!);
    }
    expect(NICHE_IDS).toEqual(NICHES.map((n) => n.id));
    expect(WAYPOINT_THRESHOLDS).toHaveLength(WAYPOINT_COUNT + 1);
    expect(WAYPOINT_THRESHOLDS[0]).toBe(0);
    for (let k = 1; k <= WAYPOINT_COUNT; k++) expect(WAYPOINT_THRESHOLDS[k]).toBeGreaterThan(WAYPOINT_THRESHOLDS[k - 1]!);
    expect(waypointThreshold(0)).toBe(0);
    expect(waypointThreshold(1)).toBe(4);
    expect(waypointThreshold(3)).toBe(135);
    expect(RARITY_WEIGHTS).toHaveLength(STAGES.length);
  });

  it('Gattungsboni gibt es für jede Gattung und Schwelle', () => {
    for (const g of GENERA) {
      expect(TRAITS[g]).toHaveLength(TRAIT_THRESHOLDS.length);
      for (const tier of TRAITS[g]) expect(tier.text.length).toBeGreaterThan(0);
    }
  });

  it('Begegnungs-Konstanten sind sinnvoll', () => {
    expect(CARDS_PER_ENCOUNTER).toBe(3);
    expect(MAX_PENDING_ENCOUNTERS).toBe(3);
    expect(DECLINE_SEEDS).toBeGreaterThan(0);
    expect(REROLL_BASE_COST).toBeGreaterThan(DECLINE_SEEDS);
  });
});
