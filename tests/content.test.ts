import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_ENCOUNTER,
  DECLINE_SEEDS,
  ENCOUNTER_WEIGHTS,
  INTERLUDE_CHANCE,
  INTERLUDE_POSITION,
  INTERLUDE_STAGE,
  INTERLUDE_WEIGHTS,
  MAX_PENDING_ENCOUNTERS,
  PLANT_WEIGHT_IN_RING,
  PLANT_WEIGHT_RING_FULL,
  RARITY_WEIGHTS,
  REROLL_BASE_COST,
  SCRIPTED_ENCOUNTERS,
} from '../src/content/encounters';
import { COMMUNITIES } from '../src/content/communities';
import { NICHES, NICHES_BY_ID } from '../src/content/niches';
import { PLANTS, PLANTS_BY_ID, PLANT_GROUP_INFO } from '../src/content/plants';
import { ABILITY_INFO } from '../src/content/abilities';
import { BASE_HAPPINESS, GENUS_INFO, RARITY_NAMES, SPECIES, SPECIES_BY_ID, TAG_NAMES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../src/content/traits';
import { ENCOUNTER_TYPES, GENERA, NICHE_IDS, PLANT_GROUPS } from '../src/content/types';
import { slotEffects } from '../src/core/formulas';
import { WAYPOINT_BASE, WAYPOINT_COUNT, WAYPOINT_POWER, WAYPOINT_THRESHOLDS, waypointThreshold } from '../src/content/waypoints';
import { EVENTS, EVENTS_BY_ID, SEED_SECONDS_MIN_SEEDS, type EventEffect } from '../src/content/events';
import { VISITORS, VISITORS_BY_ID } from '../src/content/visitors';
import { CARE, CARE_BY_ID } from '../src/content/care';
import type { Condition } from '../src/content/types';
import {
  EVENT_SEASONS,
  SEASONS,
  SEASONS_BY_ID,
  SEASON_IDS,
  SEASON_SECONDS,
  VISITOR_SEASONS,
  YEAR_SECONDS,
  type SeasonEffect,
} from '../src/content/seasons';
import { DEFAULT_MAIN_TREE, MAIN_TREES, MAIN_TREES_BY_ID, MAIN_TREE_IDS, type TreeEffect } from '../src/content/trees';
import { TREE_SPECIES } from '../src/render/plant';

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

  it('Kurztexte nennen die 🌿- und 🌰-Wirkungen der Arten (Balancing 2.10)', () => {
    // Früher prüfte dieser Test die Zahlen gegen den Prototyp scripts/v2/content.ts (entfernt
    // in Schritt 2.10). Jetzt: Wer eine Zahl ändert, muss auch den Kurztext ändern.
    const pct = (n: number) => `+${n} % `;
    for (const s of SPECIES) {
      for (const e of s.effects) {
        if (e.kind === 'growth') expect(s.summary, s.id).toContain(`${pct(e.pct)}🌿`);
        if (e.kind === 'seeds') expect(s.summary, s.id).toContain(`${pct(e.pct)}🌰`);
        if (e.kind === 'groupGrowth') expect(s.summary, s.id).toContain(`${pct(e.pct)}🌿`);
        if (e.kind === 'groupSeeds') expect(s.summary, s.id).toContain(`${pct(e.pct)}🌰`);
      }
    }
  });

  it('🌿-Wirkungen der Arten bleiben mild (Balancing 2.10: höchstens +15 %, Summe ≤ 2,5)', () => {
    // Mit ×0,75 gegenüber dem Prototyp ist der Wachstums-Spieler höchstens ~15 % schneller
    // als der Harmonie-Spieler (DESIGN_V2.md 15.4, Stand Schritt 2.10).
    let sum = 0;
    for (const s of SPECIES) {
      for (const e of s.effects) {
        if (e.kind !== 'growth' && e.kind !== 'groupGrowth') continue;
        expect(e.pct, s.id).toBeGreaterThan(0);
        expect(e.pct, s.id).toBeLessThanOrEqual(15);
        sum += e.pct / 100;
      }
    }
    expect(sum).toBeLessThanOrEqual(2.5);
  });

  it('🌿-Gattungsboni bleiben mild und stehen im Text (Balancing 2.10: höchstens +18 %)', () => {
    for (const g of GENERA) {
      for (const tier of TRAITS[g]) {
        for (const e of tier.effects) {
          if (e.kind !== 'growth' && e.kind !== 'groupGrowth') continue;
          expect(e.pct, g).toBeLessThanOrEqual(18);
          expect(tier.text, g).toContain(`+${e.pct} % Wachstum`);
        }
      }
    }
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

  it('Vielfalt-Gewichte (DESIGN_V2.md 7.7): dämpfen nur, schließen nie aus', () => {
    for (const w of [PLANT_WEIGHT_RING_FULL, PLANT_WEIGHT_IN_RING]) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1);
    }
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
    // 3,5 · k^3,5 seit Schritt 2.10 (vorher 3,5 · k^3,4; DESIGN_V2.md 3).
    expect(WAYPOINT_BASE).toBe(3.5);
    expect(WAYPOINT_POWER).toBe(3.5);
    expect(waypointThreshold(0)).toBe(0);
    expect(waypointThreshold(1)).toBe(4);
    expect(waypointThreshold(3)).toBe(164);
    expect(waypointThreshold(20)).toBe(125_220);
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

describe('Ereignisse und Durchreisende (DESIGN_V2.md 7.4, 7.5)', () => {
  /** Bedingungen wie bei den Arten; „sonnig“/„schattig“ gelten in `appears` immer – darum verboten. */
  const checkCondition = (c: Condition, where: string) => {
    expect(['tag', 'group', 'species', 'genus'], where).toContain(c.kind);
    if (c.kind === 'tag') expect(TAG_NAMES[c.tag], where).toBeDefined();
    if (c.kind === 'group') expect(PLANT_GROUPS, where).toContain(c.group);
    if (c.kind === 'species') expect(SPECIES_BY_ID.has(c.id) || PLANTS_BY_ID.has(c.id), where).toBe(true);
    if (c.kind === 'genus') expect(GENERA, where).toContain(c.genus);
    if (c.kind === 'group' || c.kind === 'genus') expect(c.min, where).toBeGreaterThanOrEqual(1);
  };

  it('IDs sind eindeutig – auch über Arten, Pflanzen, Ereignisse und Gäste hinweg', () => {
    const ids = [...SPECIES.map((s) => s.id), ...PLANTS.map((p) => p.id), ...EVENTS.map((e) => e.id), ...VISITORS.map((v) => v.id)];
    expect(unique(ids)).toBe(true);
    expect(unique(EVENTS.map((e) => e.name))).toBe(true);
    expect(unique(VISITORS.map((v) => v.name))).toBe(true);
    expect(EVENTS_BY_ID.size).toBe(EVENTS.length);
    expect(VISITORS_BY_ID.size).toBe(VISITORS.length);
  });

  it('8–10 Ereignisse mit Name, Symbol, Text und 2–3 Optionen', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(8);
    expect(EVENTS.length).toBeLessThanOrEqual(10);
    for (const e of EVENTS) {
      expect(e.name.length, e.id).toBeGreaterThan(0);
      expect(e.icon.length, e.id).toBeGreaterThan(0);
      expect(e.text.length, e.id).toBeGreaterThan(0);
      expect(e.text.length, `${e.id}: Text kurz`).toBeLessThanOrEqual(100);
      expect(e.options.length, e.id).toBeGreaterThanOrEqual(2);
      expect(e.options.length, e.id).toBeLessThanOrEqual(3);
      expect(unique(e.options.map((o) => o.label)), e.id).toBe(true);
      // Ereignisse gibt es ab Junger Baum (7.1).
      expect(e.minStage, e.id).toBeGreaterThanOrEqual(3);
      expect(e.minStage, e.id).toBeLessThan(STAGES.length);
      for (const c of e.appears ?? []) checkCondition(c, e.id);
      for (const o of e.options) {
        expect(o.label.length, e.id).toBeGreaterThan(0);
        expect(o.summary.length, e.id).toBeGreaterThan(0);
        expect(o.effects.length, `${e.id}: ${o.label}`).toBeGreaterThan(0);
      }
      // Eine echte Wahl: mindestens eine Option wirkt anders als nur mit Samen.
      expect(e.options.some((o) => o.effects.some((x) => x.kind !== 'seedsNow')), e.id).toBe(true);
    }
  });

  it('keine Option ist eine Strafe: jede Wirkung ist positiv und in sinnvollen Grenzen', () => {
    const check = (x: EventEffect, where: string) => {
      switch (x.kind) {
        case 'seedsNow':
          expect(x.seconds, where).toBeGreaterThanOrEqual(30);
          expect(x.seconds, where).toBeLessThanOrEqual(300);
          break;
        case 'timed':
          expect(x.seconds, where).toBeGreaterThanOrEqual(60);
          expect(x.seconds, where).toBeLessThanOrEqual(900);
          expect(x.effect.pct, where).toBeGreaterThan(0);
          expect(x.effect.pct, where).toBeLessThanOrEqual(100);
          if (x.effect.kind === 'groupGrowth' || x.effect.kind === 'groupSeeds') expect(PLANT_GROUPS).toContain(x.effect.group);
          break;
        case 'cycle':
          if (x.effect.kind === 'light' || x.effect.kind === 'water') {
            expect(x.effect.amount, where).toBeGreaterThan(0);
            expect(x.effect.amount, where).toBeLessThanOrEqual(5);
          }
          if (x.effect.kind === 'slot') {
            expect(NICHES_BY_ID.has(x.effect.niche), where).toBe(true);
            expect(x.effect.amount, where).toBe(1);
          }
          if (x.effect.kind === 'harmony') {
            expect(x.effect.points, where).toBeGreaterThan(0);
            expect(x.effect.points, where).toBeLessThanOrEqual(8);
          }
          break;
        case 'habitat':
          expect(TAG_NAMES[x.tag], where).toBeDefined();
          break;
        case 'nextEncounter':
          expect(x.ids.length, where).toBeGreaterThan(0);
          expect(unique([...x.ids]), where).toBe(true);
          for (const id of x.ids) {
            if (x.type === 'animal') expect(SPECIES_BY_ID.has(id), `${where}: ${id}`).toBe(true);
            else expect(PLANTS_BY_ID.has(id), `${where}: ${id}`).toBe(true);
          }
          break;
      }
    };
    for (const e of EVENTS) {
      for (const o of e.options) for (const x of o.effects) check(x, `${e.id}: ${o.label}`);
      // Erzwungene Karten sind ab der Stufe des Ereignisses freigeschaltet (mindestens eine).
      for (const o of e.options) {
        for (const x of o.effects) {
          if (x.kind !== 'nextEncounter') continue;
          const unlocks = x.ids.map((id) => (x.type === 'animal' ? SPECIES_BY_ID.get(id)!.unlock : PLANTS_BY_ID.get(id)!.unlock));
          expect(Math.min(...unlocks), e.id).toBeLessThanOrEqual(e.minStage);
        }
      }
    }
    expect(SEED_SECONDS_MIN_SEEDS).toBeGreaterThan(0);
  });

  it('Durchreisende: Gattung, Dauer, Wirkung, Bewirten kostet mehr, als Ziehenlassen bringt', () => {
    expect(VISITORS.length).toBeGreaterThanOrEqual(5);
    // Der Renderer hat eigene Bilder für diese IDs (PR #19).
    for (const id of ['cranes', 'bramblings', 'hummingbird-moth']) expect(VISITORS_BY_ID.has(id), id).toBe(true);
    for (const v of VISITORS) {
      expect(v.name.length, v.id).toBeGreaterThan(0);
      expect(v.icon.length, v.id).toBeGreaterThan(0);
      expect(v.text.length, v.id).toBeGreaterThan(0);
      expect(v.summary.length, v.id).toBeGreaterThan(0);
      expect(GENERA, v.id).toContain(v.genus);
      // Durchreisende gibt es ab Alter Baum (7.1).
      expect(v.minStage, v.id).toBeGreaterThanOrEqual(4);
      expect(v.minStage, v.id).toBeLessThan(STAGES.length);
      for (const c of v.appears ?? []) checkCondition(c, v.id);
      expect(v.stay, v.id).toBeGreaterThanOrEqual(120);
      expect(v.stay, v.id).toBeLessThanOrEqual(900);
      expect(v.effects.length, v.id).toBeGreaterThan(0);
      for (const e of v.effects) {
        if (e.kind === 'harmony') {
          expect(e.points, v.id).toBeGreaterThan(0);
          expect(e.points, v.id).toBeLessThanOrEqual(8);
        } else {
          expect(e.pct, v.id).toBeGreaterThan(0);
          expect(e.pct, v.id).toBeLessThanOrEqual(100);
        }
        if (e.kind === 'groupGrowth' || e.kind === 'groupSeeds') expect(PLANT_GROUPS).toContain(e.group);
      }
      expect(v.farewellSeeds, v.id).toBeGreaterThan(0);
      expect(v.hostCost, v.id).toBeGreaterThan(v.farewellSeeds);
      // Bewirten ist bezahlbar: höchstens 1½ Minuten Samenproduktion.
      expect(v.hostCost, v.id).toBeLessThanOrEqual(90);
    }
  });

  it('Takt: Ereignisse ab Junger Baum, Gäste ab Alter Baum – und dann gibt es immer welche ohne Bedingung', () => {
    ENCOUNTER_WEIGHTS.forEach(([, , event, visitor], stage) => {
      if (event > 0) {
        expect(stage).toBeGreaterThanOrEqual(3);
        expect(EVENTS.some((e) => e.minStage <= stage && !e.appears), `Stufe ${stage}`).toBe(true);
      }
      if (visitor > 0) {
        expect(stage).toBeGreaterThanOrEqual(4);
        expect(VISITORS.some((v) => v.minStage <= stage && !v.appears), `Stufe ${stage}`).toBe(true);
      }
    });
    // Jedes Ereignis und jeder Gast kann auch gezogen werden.
    for (const e of EVENTS) expect(ENCOUNTER_WEIGHTS[e.minStage]![2], e.id).toBeGreaterThan(0);
    // Ereignisse und Gäste verdrängen höchstens ein Viertel der Begegnungen am Wegpunkt.
    for (const [animal, plant, event, visitor] of ENCOUNTER_WEIGHTS) {
      expect((event + visitor) / (animal + plant + event + visitor)).toBeLessThanOrEqual(0.25);
    }
    // Zwischenhalt (ab Hain): zusätzlich, in der Mitte zwischen zwei Wegpunkten.
    expect(INTERLUDE_STAGE).toBeGreaterThanOrEqual(4);
    expect(INTERLUDE_STAGE).toBeLessThan(STAGES.length);
    expect(INTERLUDE_POSITION).toBeGreaterThan(0);
    expect(INTERLUDE_POSITION).toBeLessThan(1);
    expect(INTERLUDE_CHANCE).toBeGreaterThan(0);
    expect(INTERLUDE_CHANCE).toBeLessThanOrEqual(1);
    expect(INTERLUDE_WEIGHTS[0] + INTERLUDE_WEIGHTS[1]).toBeGreaterThan(0);
    // Ab dem Zwischenhalt gibt es Ereignisse und Gäste.
    expect(EVENTS.some((e) => e.minStage <= INTERLUDE_STAGE && !e.appears)).toBe(true);
    expect(VISITORS.some((v) => v.minStage <= INTERLUDE_STAGE && !v.appears)).toBe(true);
    for (const v of VISITORS) expect(ENCOUNTER_WEIGHTS[v.minStage]![3], v.id).toBeGreaterThan(0);
  });
});

describe('Lebensgemeinschaften: Inhalte', () => {
  it('jede Gemeinschaft hat ein eigenes Symbol (Seitenleiste)', () => {
    for (const c of COMMUNITIES) expect(c.icon.trim().length, c.id).toBeGreaterThan(0);
    expect(unique(COMMUNITIES.map((c) => c.icon))).toBe(true);
    expect(unique(COMMUNITIES.map((c) => c.id))).toBe(true);
    expect(unique(COMMUNITIES.map((c) => c.name))).toBe(true);
  });
});

describe('Pflegemaßnahmen (DESIGN_V2.md 8)', () => {
  it('6–8 Maßnahmen, IDs eindeutig (auch gegenüber Arten, Pflanzen, Ereignissen, Gästen)', () => {
    expect(CARE.length).toBeGreaterThanOrEqual(6);
    expect(CARE.length).toBeLessThanOrEqual(8);
    const ids = [
      ...CARE.map((c) => c.id),
      ...SPECIES.map((x) => x.id),
      ...PLANTS.map((x) => x.id),
      ...EVENTS.map((x) => x.id),
      ...VISITORS.map((x) => x.id),
    ];
    expect(unique(ids)).toBe(true);
    expect(unique(CARE.map((c) => c.name))).toBe(true);
    expect(CARE_BY_ID.size).toBe(CARE.length);
  });

  it('jede Maßnahme hat eine kurze Bestätigung nach dem Kauf (boughtText)', () => {
    for (const c of CARE) {
      expect(c.boughtText.trim().length, c.id).toBeGreaterThan(0);
      expect(c.boughtText.length, c.id).toBeLessThanOrEqual(30);
    }
    expect(unique(CARE.map((c) => c.boughtText))).toBe(true);
  });

  it('Name, Symbol, Text, Bedingungen und Ausschlüsse sind gültig', () => {
    for (const c of CARE) {
      expect(c.name.length, c.id).toBeGreaterThan(0);
      expect(c.icon.length, c.id).toBeGreaterThan(0);
      expect(c.text.length, c.id).toBeGreaterThan(0);
      expect(c.text.length, c.id).toBeLessThanOrEqual(100);
      for (const r of c.requires ?? []) {
        expect(['tag', 'group', 'species', 'genus'], c.id).toContain(r.kind);
        if (r.kind === 'species') expect(SPECIES_BY_ID.has(r.id) || PLANTS_BY_ID.has(r.id), c.id).toBe(true);
        if (r.kind === 'genus') expect(GENERA, c.id).toContain(r.genus);
        if (r.kind === 'group') expect(PLANT_GROUPS, c.id).toContain(r.group);
        if (r.kind === 'tag') expect(TAG_NAMES[r.tag], c.id).toBeDefined();
      }
      // Ausschlüsse gelten in beide Richtungen.
      for (const other of c.excludes ?? []) {
        expect(CARE_BY_ID.get(other)?.excludes ?? [], `${c.id} ↔ ${other}`).toContain(c.id);
        expect(other).not.toBe(c.id);
      }
    }
  });

  it('Ränge: 1–3, Kosten steigen stark, Freischaltung ab Junger Baum und nie rückwärts', () => {
    for (const c of CARE) {
      expect(c.ranks.length, c.id).toBeGreaterThanOrEqual(1);
      expect(c.ranks.length, c.id).toBeLessThanOrEqual(3);
      expect(c.ranks[0]!.minStage, c.id).toBeGreaterThanOrEqual(3);
      c.ranks.forEach((r, i) => {
        expect(r.cost, `${c.id} Rang ${i + 1}`).toBeGreaterThanOrEqual(500);
        expect(r.cost, `${c.id} Rang ${i + 1}`).toBeLessThanOrEqual(50_000);
        expect(r.minStage).toBeLessThan(STAGES.length);
        expect(r.summary.length).toBeGreaterThan(0);
        expect(r.effects.length).toBeGreaterThan(0);
        if (i > 0) {
          expect(r.cost, `${c.id} Rang ${i + 1}`).toBeGreaterThanOrEqual(3 * c.ranks[i - 1]!.cost);
          expect(r.minStage).toBeGreaterThanOrEqual(c.ranks[i - 1]!.minStage);
        }
      });
    }
  });

  it('Wirkungen: gültig, in Grenzen, jeder Rang bringt etwas (Abzüge nur bei Licht/Wasser)', () => {
    for (const c of CARE) {
      for (const r of c.ranks) {
        let positive = 0;
        for (const e of r.effects) {
          if (e.kind === 'habitat') {
            expect(TAG_NAMES[e.tag], c.id).toBeDefined();
            positive++;
            continue;
          }
          const x = e.effect;
          switch (x.kind) {
            case 'slot':
              expect(NICHES_BY_ID.has(x.niche), c.id).toBe(true);
              expect(x.amount, c.id).toBe(1);
              positive++;
              break;
            case 'light':
            case 'water':
              expect(Math.abs(x.amount), c.id).toBeLessThanOrEqual(3);
              expect(x.amount, c.id).not.toBe(0);
              if (x.amount > 0) positive++;
              break;
            case 'harmony':
              expect(x.points, c.id).toBeGreaterThan(0);
              expect(x.points, c.id).toBeLessThanOrEqual(5);
              positive++;
              break;
            default:
              expect(x.pct, c.id).toBeGreaterThan(0);
              expect(x.pct, c.id).toBeLessThanOrEqual(40);
              if (x.kind === 'groupGrowth' || x.kind === 'groupSeeds') expect(PLANT_GROUPS).toContain(x.group);
              positive++;
          }
        }
        expect(positive, `${c.id}: ${r.summary}`).toBeGreaterThan(0);
      }
    }
  });

  it('Samen-Senke: vor dem Hain gibt es mehr zu kaufen, als bis dahin verdient wird', () => {
    // Bis zum Hain verdient der Harmonie-Spieler ~15.000 🌰 (DESIGN_V2.md 15.4) – es muss
    // priorisiert werden. Danach bleibt die Senke bis zum Urwald groß.
    const before = CARE.flatMap((c) => c.ranks.filter((r) => r.minStage < 5)).reduce((s, r) => s + r.cost, 0);
    const later = CARE.flatMap((c) => c.ranks.filter((r) => r.minStage >= 5)).reduce((s, r) => s + r.cost, 0);
    expect(before).toBeGreaterThan(15_000);
    expect(later).toBeGreaterThan(100_000);
  });
});

/** Ist die Wirkung ein Gewinn (> 0) oder ein Verzicht (< 0)? */
function sign(e: SeasonEffect | TreeEffect): number {
  switch (e.kind) {
    case 'growth':
    case 'seeds':
    case 'groupGrowth':
    case 'groupSeeds':
      return Math.sign(e.pct);
    case 'light':
    case 'water':
    case 'slot':
      return Math.sign(e.amount);
    case 'harmony':
    case 'happiness':
      return Math.sign(e.points);
  }
}

/** Zahlen einer Wirkung liegen in sanften Grenzen (DESIGN_V2.md 16.3, 17.3). */
function expectGentle(e: SeasonEffect | TreeEffect, label: string): void {
  switch (e.kind) {
    case 'growth':
      expect(e.pct, label).toBeGreaterThanOrEqual(-10);
      expect(e.pct, label).toBeLessThanOrEqual(20);
      break;
    case 'seeds':
      expect(e.pct, label).toBeGreaterThan(0);
      expect(e.pct, label).toBeLessThanOrEqual(30);
      break;
    case 'groupGrowth':
    case 'groupSeeds':
      expect(PLANT_GROUPS, label).toContain(e.group);
      expect(e.pct, label).toBeGreaterThan(0);
      expect(e.pct, label).toBeLessThanOrEqual(60);
      break;
    case 'light':
    case 'water':
      expect(Math.abs(e.amount), label).toBeGreaterThan(0);
      expect(Math.abs(e.amount), label).toBeLessThanOrEqual(3);
      break;
    case 'slot':
      expect(NICHE_IDS, label).toContain(e.niche);
      expect(e.amount, label).toBe(1);
      break;
    case 'harmony':
      expect(e.points, label).toBeGreaterThan(0);
      expect(e.points, label).toBeLessThanOrEqual(5);
      break;
    case 'happiness':
      expect(GENERA, label).toContain(e.genus);
      expect(e.points, label).toBeGreaterThan(0);
      expect(e.points, label).toBeLessThanOrEqual(20);
      break;
  }
}

describe('Jahreszeiten: Inhalte (DESIGN_V2.md 16)', () => {
  it('vier Jahreszeiten in fester Reihenfolge, mit Name, Symbol, Text und Kurzform', () => {
    expect(SEASON_IDS).toEqual(['spring', 'summer', 'autumn', 'winter']);
    expect(SEASONS.map((s) => s.id)).toEqual(SEASON_IDS);
    expect(unique(SEASONS.map((s) => s.name))).toBe(true);
    expect(unique(SEASONS.map((s) => s.icon))).toBe(true);
    for (const [i, s] of SEASONS.entries()) {
      expect(SEASONS_BY_ID.get(s.id)).toBe(s);
      expect(s.name.length, s.id).toBeGreaterThan(0);
      expect(s.text.length, s.id).toBeGreaterThan(10);
      expect(s.summary.length, s.id).toBeGreaterThan(0);
      // Grafik: Mitte der Jahreszeit = ganzzahliger Wert von SceneInput.season.
      expect(s.renderValue, s.id).toBe(i);
    }
  });

  it('ein Jahr dauert einige Minuten Spielzeit (ruhiger Wechsel, mehrmals bis zum Hain)', () => {
    expect(SEASON_SECONDS).toBeGreaterThanOrEqual(120);
    expect(SEASON_SECONDS).toBeLessThanOrEqual(300);
    expect(YEAR_SECONDS).toBe(4 * SEASON_SECONDS);
    // Bis zum Hain (~45–60 min) vergehen mehrere Jahre.
    expect((45 * 60) / YEAR_SECONDS).toBeGreaterThanOrEqual(3);
  });

  it('jede Jahreszeit hat mindestens eine positive Wirkung, alle Zahlen sind sanft', () => {
    for (const s of SEASONS) {
      expect(s.effects.length, s.id).toBeGreaterThan(0);
      expect(s.effects.some((e) => sign(e) > 0), s.id).toBe(true);
      for (const e of s.effects) {
        expect(e.kind, s.id).not.toBe('slot');
        expectGentle(e, `${s.id}: ${e.kind}`);
      }
    }
  });

  it('der einzige Abzug ist weniger Wachstum im Winter; übers Jahr bleibt das Wachstum gleich', () => {
    for (const s of SEASONS) {
      const negative = s.effects.filter((e) => sign(e) < 0);
      if (s.id === 'winter') expect(negative).toEqual([{ kind: 'growth', pct: -10 }]);
      else expect(negative, s.id).toEqual([]);
    }
    const growth = SEASONS.flatMap((s) => s.effects).reduce((sum, e) => sum + (e.kind === 'growth' ? e.pct : 0), 0);
    expect(Math.abs(growth / SEASONS.length)).toBeLessThanOrEqual(2.5);
  });

  it('Begegnungsfaktoren dämpfen oder verstärken nur, schließen nie aus', () => {
    for (const s of SEASONS) {
      for (const [type, factor] of Object.entries(s.encounterFactors ?? {})) {
        expect(ENCOUNTER_TYPES, s.id).toContain(type);
        expect(factor, `${s.id}: ${type}`).toBeGreaterThan(0);
        expect(factor, `${s.id}: ${type}`).toBeLessThanOrEqual(2);
      }
    }
    expect(SEASONS_BY_ID.get('spring')!.encounterFactors?.plant).toBeGreaterThan(1);
  });

  it('Jahreszeiten von Ereignissen und Gästen verweisen auf gültige IDs', () => {
    for (const [table, ids] of [
      [EVENT_SEASONS, EVENTS_BY_ID],
      [VISITOR_SEASONS, VISITORS_BY_ID],
    ] as const) {
      for (const [id, seasons] of Object.entries(table)) {
        expect(ids.has(id), id).toBe(true);
        expect(seasons.length, id).toBeGreaterThan(0);
        expect(seasons.length, id).toBeLessThan(4); // sonst ganzjährig: Eintrag weglassen
        expect(unique([...seasons]), id).toBe(true);
        for (const s of seasons) expect(SEASON_IDS, id).toContain(s);
      }
    }
  });

  it('Zugvögel ziehen im Winter fort, Kraniche kommen im Frühling und Herbst', () => {
    expect(VISITOR_SEASONS.cranes).toEqual(['spring', 'autumn']);
    expect(VISITOR_SEASONS.cranes).not.toContain('winter');
    expect(VISITOR_SEASONS.swallows).not.toContain('winter');
    expect(VISITOR_SEASONS.bramblings).toContain('winter');
  });

  it('in jeder Jahreszeit gibt es Ereignisse ab Junger Baum und Gäste ab Hain ohne Bedingung', () => {
    for (const s of SEASON_IDS) {
      const inSeason = (table: Readonly<Record<string, readonly string[]>>, id: string) => !table[id] || table[id]!.includes(s);
      expect(EVENTS.some((e) => e.minStage <= 3 && !e.appears && inSeason(EVENT_SEASONS, e.id)), s).toBe(true);
      expect(VISITORS.some((v) => v.minStage <= INTERLUDE_STAGE && !v.appears && inSeason(VISITOR_SEASONS, v.id)), s).toBe(true);
    }
  });
});

describe('Hauptbaum-Arten: Inhalte (DESIGN_V2.md 17)', () => {
  it('Eiche, Buche, Kiefer – dieselben IDs wie im Renderer', () => {
    expect(MAIN_TREE_IDS).toEqual(['oak', 'beech', 'pine']);
    expect([...TREE_SPECIES]).toEqual([...MAIN_TREE_IDS]);
    expect(MAIN_TREES.map((t) => t.id)).toEqual(MAIN_TREE_IDS);
    expect(DEFAULT_MAIN_TREE).toBe('oak');
    expect(unique(MAIN_TREES.map((t) => t.name))).toBe(true);
    for (const t of MAIN_TREES) {
      expect(MAIN_TREES_BY_ID.get(t.id)).toBe(t);
      expect(t.name.length * t.icon.length * t.fruit.length * t.text.length * t.summary.length, t.id).toBeGreaterThan(0);
    }
  });

  it('die Eiche ist immer wählbar und entspricht dem heutigen Hauptbaum', () => {
    const oak = MAIN_TREES_BY_ID.get('oak')!;
    expect(oak.unlockPlant).toBeNull();
    // Wie der Hauptbaum vor v6: Laub, Wurzeln, Eicheln ab Alter Baum.
    expect(oak.tags).toEqual(['laub', 'wurzeln']);
    expect(oak.nutsFromStage).toBe(4);
    expect(oak.winterHardy).toBe(false);
  });

  it('Buche und Kiefer schalten sich über ihre Begleitpflanze im Naturtagebuch frei', () => {
    for (const t of MAIN_TREES.filter((x) => x.id !== 'oak')) {
      const plant = PLANTS_BY_ID.get(t.unlockPlant ?? '');
      expect(plant, t.id).toBeDefined();
      expect(plant!.group, t.id).toBe('trees');
      // Erreichbar im ersten Zyklus (vor dem Neuen Zyklus ab Hain).
      expect(plant!.unlock, t.id).toBeLessThan(5);
      expect(t.unlockHint, t.id).toContain(plant!.name);
    }
  });

  it('Merkmale, Nüsse und Eigenheiten sind gültig und klein: ein Gewinn, höchstens ein Verzicht', () => {
    for (const t of MAIN_TREES) {
      expect(t.tags.length, t.id).toBeGreaterThan(0);
      for (const tag of t.tags) expect(Object.keys(TAG_NAMES), t.id).toContain(tag);
      expect(unique([...t.tags]), t.id).toBe(true);
      if (t.nutsFromStage !== null) {
        expect(t.nutsFromStage, t.id).toBeGreaterThanOrEqual(0);
        expect(t.nutsFromStage, t.id).toBeLessThan(STAGES.length);
      }
      expect(t.traits.length, t.id).toBeGreaterThan(0);
      expect(t.traits.length, t.id).toBeLessThanOrEqual(3);
      expect(t.traits.some((x) => sign(x.effect) > 0), t.id).toBe(true);
      expect(t.traits.filter((x) => sign(x.effect) < 0).length, t.id).toBeLessThanOrEqual(1);
      for (const x of t.traits) {
        expect(x.minStage, t.id).toBeGreaterThanOrEqual(0);
        expect(x.minStage, t.id).toBeLessThan(STAGES.length);
        // Verzichte erst, wenn der Baum groß ist – nie am zarten Anfang.
        if (sign(x.effect) < 0) expect(x.minStage, t.id).toBeGreaterThanOrEqual(3);
        expectGentle(x.effect, `${t.id}: ${x.effect.kind}`);
      }
    }
  });

  it('nur die Kiefer ist winterfest, und nur sie trägt Nadeln statt Nüssen', () => {
    expect(MAIN_TREES.filter((t) => t.winterHardy).map((t) => t.id)).toEqual(['pine']);
    const pine = MAIN_TREES_BY_ID.get('pine')!;
    expect(pine.tags).toContain('nadeln');
    expect(pine.nutsFromStage).toBeNull();
    for (const t of MAIN_TREES.filter((x) => x.id !== 'pine')) expect(t.nutsFromStage, t.id).not.toBeNull();
  });
});
