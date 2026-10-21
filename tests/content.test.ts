import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_ENCOUNTER,
  DECLINE_SEEDS,
  ENCOUNTER_WEIGHTS,
  MAX_PENDING_ENCOUNTERS,
  RARITY_WEIGHTS,
  REROLL_BASE_COST,
  SCRIPTED_ENCOUNTERS,
} from '../src/content/encounters';
import { NICHES, NICHES_BY_ID } from '../src/content/niches';
import { PLANTS, PLANTS_BY_ID, PLANT_COST_BASE, PLANT_COST_GROWTH, PLANT_GROUP_INFO } from '../src/content/plants';
import { ABILITY_INFO } from '../src/content/abilities';
import { BASE_HAPPINESS, GENUS_INFO, RARITY_NAMES, SPECIES, SPECIES_BY_ID, TAG_NAMES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../src/content/traits';
import { ENCOUNTER_TYPES, GENERA, NICHE_IDS, PLANT_GROUPS } from '../src/content/types';
import { plantCost, slotEffects } from '../src/core/formulas';
import { WAYPOINT_BASE, WAYPOINT_COUNT, WAYPOINT_POWER, WAYPOINT_THRESHOLDS, waypointThreshold } from '../src/content/waypoints';
import * as reference from '../scripts/v2/content';

const unique = (ids: string[]) => new Set(ids).size === ids.length;

describe('Inhalte v2', () => {
  it('IDs und Namen sind eindeutig', () => {
    expect(unique(SPECIES.map((s) => s.id))).toBe(true);
    expect(unique(SPECIES.map((s) => s.name))).toBe(true);
    expect(unique(NICHES.map((n) => n.id))).toBe(true);
    expect(unique(STAGES.map((s) => s.id))).toBe(true);
    expect(unique(PLANTS.map((p) => p.id))).toBe(true);
    expect(unique(PLANTS.map((p) => p.name))).toBe(true);
    // Pflanzen- und Art-IDs überschneiden sich nicht (eindeutig im Tagebuch und in Karten).
    expect(unique([...SPECIES.map((s) => s.id), ...PLANTS.map((p) => p.id)])).toBe(true);
  });

  it('32 Arten in 5 Gattungen (6–8 je Gattung), Seltenheit 14 / 8 / 5 / 5 (DESIGN_V2.md 5.2)', () => {
    expect(SPECIES).toHaveLength(32);
    expect(GENERA).toEqual(['birds', 'insects', 'mammals', 'soil', 'fungi']);
    for (const g of GENERA) {
      const of = SPECIES.filter((s) => s.genus === g);
      expect(of.length, g).toBeGreaterThanOrEqual(5);
      expect(of.length, g).toBeLessThanOrEqual(8);
      expect(of.filter((s) => s.rarity === 0).length, g).toBeGreaterThanOrEqual(2);
      // Jede Gattung hat genau eine legendäre Art, frühestens ab dem Hain.
      const legendary = of.filter((s) => s.rarity === 3);
      expect(legendary, g).toHaveLength(1);
      expect(legendary[0]!.unlock, g).toBeGreaterThanOrEqual(5);
      expect(GENUS_INFO[g].name.length).toBeGreaterThan(0);
      expect(GENUS_INFO[g].icon.length).toBeGreaterThan(0);
    }
    expect([0, 1, 2, 3].map((r) => SPECIES.filter((s) => s.rarity === r).length)).toEqual([14, 8, 5, 5]);
    // Dieselben IDs wie das Referenzmodell – die Grafik-Ebene erwartet sie.
    expect(SPECIES.map((s) => s.id).sort()).toEqual(reference.SPECIES.map((s) => s.id).sort());
  });

  it('besondere und legendäre Arten haben Erscheinungsbedingung und Fähigkeit, die übrigen nicht', () => {
    for (const s of SPECIES) {
      const abilities = s.effects.filter((e) => e.kind === 'ability');
      if (s.rarity >= 2) {
        expect(s.appears?.length, `${s.id}: erscheint, wenn …`).toBeGreaterThan(0);
        expect(abilities, `${s.id}: Fähigkeit`).toHaveLength(1);
      } else {
        expect(s.appears, s.id).toBeUndefined();
        expect(abilities, s.id).toHaveLength(0);
      }
    }
    // Jede Fähigkeit gehört zu genau einer Art und hat Name und Text.
    const used = SPECIES.flatMap((s) => s.effects.flatMap((e) => (e.kind === 'ability' ? [e.id] : [])));
    expect([...used].sort()).toEqual(Object.keys(ABILITY_INFO).sort());
    for (const info of Object.values(ABILITY_INFO)) {
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.text.length).toBeGreaterThan(0);
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
      for (const c of [...s.needs, ...(s.appears ?? [])]) {
        if (c.kind === 'tag') expect(TAG_NAMES[c.tag]).toBeDefined();
        if (c.kind === 'group') expect(PLANT_GROUPS).toContain(c.group);
        if (c.kind === 'species') expect(SPECIES_BY_ID.has(c.id) || PLANTS_BY_ID.has(c.id), `${s.id}: ${c.id}`).toBe(true);
        if (c.kind === 'species') expect(c.id, s.id).not.toBe(s.id);
        if (c.kind === 'genus') expect(GENERA).toContain(c.genus);
      }
      for (const e of s.effects) {
        if (e.kind === 'control') expect(TAG_NAMES[e.tag]).toBeDefined();
        if (e.kind === 'groupSeeds' || e.kind === 'groupGrowth') expect(PLANT_GROUPS).toContain(e.group);
        if (e.kind === 'disturb') expect(SPECIES_BY_ID.has(e.target) && e.target !== s.id, `${s.id}: stört ${e.target}`).toBe(true);
        if (e.kind === 'ability') expect(ABILITY_INFO[e.id], `${s.id}: ${e.id}`).toBeDefined();
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
      expect(s.effects).toEqual(ref.effects);
      expect(s.appears, s.id).toEqual(ref.appears);
    }
    expect(PLANTS.map((p) => p.id)).toEqual(reference.PLANTS.map((p) => p.id));
    for (const p of PLANTS) {
      const ref = reference.PLANTS.find((r) => r.id === p.id)!;
      expect({ ...p, provides: [...p.provides] }, p.id).toEqual({ ...ref, provides: [...ref.provides] });
    }
    for (const g of PLANT_GROUPS) expect(PLANT_GROUP_INFO[g].name).toBe(reference.GROUP_NAMES[g]);
    expect(STAGES.map((s) => s.plantSlots)).toEqual([...reference.PLANT_SLOTS]);
    expect(PLANT_COST_BASE).toBe(reference.PLANT_COST_BASE);
    expect(PLANT_COST_GROWTH).toBe(reference.PLANT_COST_GROWTH);
    for (let n = 0; n < 12; n++) expect(plantCost(n)).toBeCloseTo(reference.plantCost(n), 9);
    expect(ENCOUNTER_WEIGHTS).toEqual(reference.ENCOUNTER_WEIGHTS);
    expect(SCRIPTED_ENCOUNTERS).toEqual(reference.SCRIPTED_ENCOUNTERS);
    STAGES.forEach((stage, i) => {
      expect(stage.name).toBe(reference.STAGE_NAMES[i]);
      expect(stage.waypoint).toBe(reference.STAGE_WAYPOINTS[i]);
      expect(stage.treeGrowth).toBe(reference.TREE_GROWTH[i]);
      expect(stage.treeSeeds).toBe(reference.TREE_SEEDS[i]);
      expect(stage.light).toBe(reference.LIGHT_BUDGET[i]);
      expect(stage.water).toBe(reference.WATER_BUDGET[i]);
    });
    expect([...NICHE_IDS]).toEqual([...reference.NICHES]);
    for (const n of NICHES) expect(n.slots).toEqual(reference.NICHE_SLOTS[n.id]);
    for (const g of GENERA) expect(TRAITS[g].map((t) => t.effects)).toEqual(reference.TRAITS[g]);
    for (const g of GENERA) expect(TRAITS[g].map((t) => t.text)).toEqual(reference.TRAIT_TEXT[g]);
    for (const g of GENERA) expect(GENUS_INFO[g].name).toBe(reference.GENUS_NAMES[g]);
    expect(TRAIT_THRESHOLDS).toEqual(reference.TRAIT_THRESHOLDS);
    expect(RARITY_WEIGHTS).toEqual(reference.RARITY_WEIGHTS);
    expect(WAYPOINT_COUNT).toBe(reference.WAYPOINT_COUNT);
    // Exponent wie im Design. Bewusste Abweichung: Wegpunkte 12,5 % früher (Basis 3,5
    // statt 4, DESIGN_V2.md 15.4) – nie später.
    expect(WAYPOINT_POWER).toBe(reference.WAYPOINT_POWER);
    expect(WAYPOINT_BASE).toBeLessThanOrEqual(reference.WAYPOINT_BASE);
    for (let k = 1; k <= WAYPOINT_COUNT; k++) expect(waypointThreshold(k)).toBeLessThanOrEqual(reference.waypointThreshold(k));
  });

  it('Höhlen & Totholz: öffnet mit dem Alten Baum, früher nur durch Platz-Wirkungen', () => {
    const hollows = NICHES_BY_ID.get('hollows')!;
    expect(hollows.slots.findIndex((n) => n > 0)).toBe(4);
    expect(hollows.opensEarly).toBe(true);
    expect(NICHES.filter((n) => n.opensEarly).map((n) => n.id)).toEqual(['hollows']);
    const slotGivers = SPECIES.filter((s) => slotEffects(s).length > 0).map((s) => s.id);
    expect(slotGivers.sort()).toEqual(['barkbeetle', 'blackwoodpecker', 'woodpecker']);
    for (const s of SPECIES) {
      for (const e of slotEffects(s)) expect(NICHES_BY_ID.has(e.niche) && e.amount > 0).toBe(true);
    }
  });

  it('Platz-Wirkungen betreffen nie die eigene Nische (sonst könnte eine Art sich selbst Platz machen)', () => {
    for (const s of SPECIES) {
      for (const e of slotEffects(s)) expect(e.niche, s.id).not.toBe(s.niche);
    }
  });

  it('Pflanzen: gültige Gruppen, Merkmale, Freischaltung und Zahlen', () => {
    for (const p of PLANTS) {
      expect(PLANT_GROUPS, p.id).toContain(p.group);
      expect(PLANT_GROUP_INFO[p.group]).toBeDefined();
      expect(p.unlock, p.id).toBeGreaterThanOrEqual(1);
      expect(p.unlock, p.id).toBeLessThan(STAGES.length);
      // Ab der Freischaltung gibt es Platz im Pflanzring.
      expect(STAGES[p.unlock]!.plantSlots, p.id).toBeGreaterThan(0);
      for (const t of p.provides) expect(TAG_NAMES[t], `${p.id}: Merkmal ${t}`).toBeDefined();
      expect(p.provides.length, p.id).toBeGreaterThan(0);
      for (const n of [p.growth, p.seeds, p.light, p.water]) expect(Number.isFinite(n), p.id).toBe(true);
      expect(p.growth).toBeGreaterThan(0);
      expect(p.seeds).toBeGreaterThan(0);
      expect(p.light).toBeGreaterThanOrEqual(0);
      expect(p.text.length).toBeGreaterThan(0);
      expect(PLANTS_BY_ID.get(p.id)).toBe(p);
    }
    // Jede Gruppe ist vertreten; ab dem Keimling kann immer etwas keimen.
    for (const g of PLANT_GROUPS) expect(PLANTS.some((p) => p.group === g), g).toBe(true);
    expect(PLANTS.filter((p) => p.unlock <= 1).length).toBeGreaterThan(0);
    // Was Tiere fressen oder sich wünschen, bietet irgendwer an (Hauptbaum, Pflanze oder Tier).
    const offered = new Set([...PLANTS.flatMap((p) => p.provides), ...SPECIES.flatMap((s) => s.provides), 'laub', 'wurzeln', 'nuesse']);
    for (const s of SPECIES) {
      for (const t of s.food) expect(offered.has(t), `${s.id}: Nahrung ${t}`).toBe(true);
      for (const c of s.needs) if (c.kind === 'tag') expect(offered.has(c.tag), `${s.id}: Wunsch ${c.tag}`).toBe(true);
    }
  });

  it('Pflanzring wächst mit der Stufe', () => {
    expect(STAGES[0]!.plantSlots).toBe(0);
    for (let i = 1; i < STAGES.length; i++) expect(STAGES[i]!.plantSlots).toBeGreaterThanOrEqual(STAGES[i - 1]!.plantSlots);
  });

  it('Begegnungsgewichte: je Stufe, Spalten wie ENCOUNTER_TYPES, Tier und Pflanze immer möglich', () => {
    expect(ENCOUNTER_WEIGHTS).toHaveLength(STAGES.length);
    expect(ENCOUNTER_TYPES).toEqual(['animal', 'plant', 'event', 'visitor']);
    for (const w of ENCOUNTER_WEIGHTS) {
      expect(w).toHaveLength(ENCOUNTER_TYPES.length);
      expect(w[0]).toBeGreaterThan(0);
      expect(w[1]).toBeGreaterThan(0);
      for (const x of w) expect(x).toBeGreaterThanOrEqual(0);
    }
    for (const t of SCRIPTED_ENCOUNTERS) expect(['animal', 'plant']).toContain(t);
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
    expect(waypointThreshold(3)).toBe(147);
    expect(waypointThreshold(20)).toBe(92805);
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
