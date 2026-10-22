import { describe, expect, it } from 'vitest';
import { CARE_BY_ID } from '../src/content/care';
import { COMMUNITIES } from '../src/content/communities';
import { EVENTS, EVENTS_BY_ID } from '../src/content/events';
import {
  HABITAT_CARE,
  HABITAT_COMMUNITIES,
  HABITAT_NICHES,
  HABITAT_SPECIES,
  REPTILE_TRAITS,
  type HabitatSpecies,
  type W3Condition,
  type W3Tag,
} from '../src/content/habitats';
import { NICHES_BY_ID } from '../src/content/niches';
import { PLANTS_BY_ID } from '../src/content/plants';
import {
  EFFECT_ADDITIONS,
  FOOD_ADDITIONS,
  OVERHUNT_MAX_UNITS,
  OVERHUNT_PENALTY,
  PREDATION_EVENTS,
  PREDATION_EVENT_SEASONS,
  PROVIDES_ADDITIONS,
  STOCK_BASE,
  STOCK_HIGH,
  STOCK_LOW,
  STOCK_RANGE,
  WEATHER_EVENT_FACTORS,
} from '../src/content/predation';
import { EVENT_SEASONS, SEASON_IDS } from '../src/content/seasons';
import { SPECIES, SPECIES_BY_ID, TAG_NAMES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { GENERA } from '../src/content/types';

/**
 * Inhaltstest für Welle 3, Teil A (DESIGN_V2.md 22 und 23): Räuber und Beute, Lebensräume.
 * Die Lebensräume sind noch nicht verdrahtet (Spielstand v13 fehlt) – geprüft wird, dass sie
 * in sich stimmig sind und sich beim Verdrahten ohne Kollision einfügen. Räuber und Beute
 * (Schritt A/C) sind verdrahtet; ihre Logik prüft tests/predation.test.ts.
 */

const PREY_TAGS: readonly W3Tag[] = ['amphibien', 'echsen', 'hasen'];
const KNOWN_TAGS = new Set<string>([...Object.keys(TAG_NAMES), ...PREY_TAGS]);
const HABITAT_IDS = new Set<string>(HABITAT_NICHES.map((n) => n.id));
const NEW_BY_ID = new Map<string, HabitatSpecies>(HABITAT_SPECIES.map((s) => [s.id, s]));
/** Wie sie nach dem Verdrahten zusammen aussehen (vorhandene Arten mit den Ergänzungen). */
const ALL = [
  ...SPECIES.map((s) => ({
    id: s.id,
    level: s.level,
    niche: s.niche as string,
    unlock: s.unlock,
    food: [...s.food, ...(FOOD_ADDITIONS[s.id] ?? [])] as W3Tag[],
    provides: [...s.provides, ...(PROVIDES_ADDITIONS[s.id] ?? [])] as W3Tag[],
  })),
  ...HABITAT_SPECIES.map((s) => ({ id: s.id, level: s.level, niche: s.niche as string, unlock: s.unlock, food: [...s.food], provides: [...s.provides] })),
];
const ALL_BY_ID = new Map(ALL.map((s) => [s.id, s]));
const knownId = (id: string) => ALL_BY_ID.has(id) || PLANTS_BY_ID.has(id);
const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

function checkCondition(c: W3Condition, where: string): void {
  switch (c.kind) {
    case 'tag':
    case 'unhunted':
      expect(KNOWN_TAGS.has(c.tag), `${where}: ${c.tag}`).toBe(true);
      break;
    case 'species':
      expect(knownId(c.id), `${where}: ${c.id}`).toBe(true);
      break;
    case 'genus':
      expect([...GENERA, 'reptiles'], where).toContain(c.genus);
      break;
    default:
      break;
  }
}

describe('Lebensräume (DESIGN_V2.md 23)', () => {
  it('neue Nischen: eigene IDs, keine Plätze aus der Stufe, öffnen nur durch Wirkungen', () => {
    expect(HABITAT_NICHES.map((n) => n.id)).toEqual(['meadow', 'deadwood', 'wall']);
    for (const n of HABITAT_NICHES) {
      expect(NICHES_BY_ID.has(n.id as never), n.id).toBe(false);
      expect(n.slots.length, n.id).toBe(STAGES.length);
      expect(n.slots.every((s) => s === 0), n.id).toBe(true);
      expect(n.opensEarly, n.id).toBe(true);
    }
  });

  it('14 Arten: eindeutige IDs, 3–5 je Lebensraum, nur gewöhnlich und selten (keine neue Fähigkeit)', () => {
    expect(HABITAT_SPECIES.length).toBe(14);
    expect(unique(HABITAT_SPECIES.map((s) => s.id))).toBe(true);
    for (const s of HABITAT_SPECIES) {
      expect(SPECIES_BY_ID.has(s.id), `${s.id} kollidiert mit species.ts`).toBe(false);
      expect(PLANTS_BY_ID.has(s.id), s.id).toBe(false);
      expect(HABITAT_IDS.has(s.niche), s.id).toBe(true);
      expect(s.rarity === 0 || s.rarity === 1, s.id).toBe(true);
      expect(s.unlock >= 3 && s.unlock <= 5, s.id).toBe(true);
      expect(s.name.length > 0 && s.text.length > 0 && s.summary.length > 0, s.id).toBe(true);
      expect(s.food.length, s.id).toBeGreaterThan(0);
      for (const t of [...s.food, ...s.provides]) expect(KNOWN_TAGS.has(t), `${s.id}: ${t}`).toBe(true);
      for (const c of [...s.needs, ...(s.appears ?? [])]) checkCondition(c, s.id);
      expect(s.effects.some((e) => e.kind === 'ability'), s.id).toBe(false);
      // Stärke wie im Katalog: gewöhnlich bis 7 % 🌿, selten bis 9 % (Wachstum ×0,75 seit 2.10).
      for (const e of s.effects) {
        if (e.kind === 'growth') expect(e.pct, s.id).toBeLessThanOrEqual(s.rarity === 0 ? 7 : 9);
        if (e.kind === 'harmony') expect(e.points, s.id).toBeLessThanOrEqual(2);
      }
    }
    for (const n of HABITAT_NICHES) {
      const count = HABITAT_SPECIES.filter((s) => s.niche === n.id).length;
      expect(count, n.id).toBeGreaterThanOrEqual(3);
      expect(count, n.id).toBeLessThanOrEqual(5);
    }
  });

  it('Reptilien: neue Gattung mit 5 Arten auf mindestens zwei Lebensräumen, drei Bonus-Stufen', () => {
    expect(GENERA).not.toContain('reptiles' as never);
    const reptiles = HABITAT_SPECIES.filter((s) => s.genus === 'reptiles');
    expect(reptiles.length).toBe(5);
    expect(new Set(reptiles.map((s) => s.niche)).size).toBeGreaterThanOrEqual(2);
    expect(REPTILE_TRAITS.length).toBe(3);
  });

  it('jeder Lebensraum hat eine Lebensgemeinschaft mit bekannten Mitgliedern', () => {
    const ids = new Set(COMMUNITIES.map((c) => c.id));
    for (const c of HABITAT_COMMUNITIES) {
      expect(ids.has(c.id), c.id).toBe(false);
      expect(c.harmony, c.id).toBeGreaterThan(0);
      expect(c.hint.length, c.id).toBeGreaterThan(0);
      for (const m of c.members) for (const id of typeof m === 'string' ? [m] : m) expect(knownId(id), `${c.id}: ${id}`).toBe(true);
    }
    for (const n of HABITAT_NICHES) {
      const own = new Set(HABITAT_SPECIES.filter((s) => s.niche === n.id).map((s) => s.id));
      const has = HABITAT_COMMUNITIES.some((c) => c.members.some((m) => (typeof m === 'string' ? [m] : m).some((id) => own.has(id))));
      expect(has, n.id).toBe(true);
    }
  });

  it('Pflege öffnet jeden Lebensraum mit mindestens 2 Plätzen; Kosten steigen je Rang mindestens ×2', () => {
    for (const n of HABITAT_NICHES) {
      const opener = HABITAT_CARE.find((m) =>
        m.ranks[0]!.effects.some((e) => e.kind === 'cycle' && e.effect.kind === 'slot' && e.effect.niche === n.id && e.effect.amount >= 2),
      );
      expect(opener, n.id).toBeDefined();
    }
    for (const m of HABITAT_CARE) {
      // Neue Maßnahmen haben eigene IDs; der Totholzhaufen ersetzt den vorhandenen Eintrag.
      if (m.id !== 'deadwood-pile') expect(CARE_BY_ID.has(m.id), m.id).toBe(false);
      else expect(CARE_BY_ID.get(m.id)!.ranks.length).toBe(m.ranks.length);
      m.ranks.forEach((r, i) => {
        expect(r.cost, m.id).toBeGreaterThan(0);
        if (i > 0) {
          expect(r.cost, m.id).toBeGreaterThanOrEqual(2 * m.ranks[i - 1]!.cost);
          expect(r.minStage, m.id).toBeGreaterThan(m.ranks[i - 1]!.minStage);
        }
      });
    }
  });

  it('Lebensräume kommen nacheinander: Wiese (Junger Baum), Totholzhaufen (Alter Baum), Mauer (Hain)', () => {
    const firstStage = (niche: string) =>
      Math.min(
        ...HABITAT_CARE.flatMap((m) =>
          m.ranks.filter((r) => r.effects.some((e) => e.kind === 'cycle' && e.effect.kind === 'slot' && e.effect.niche === niche)).map((r) => r.minStage),
        ),
      );
    expect([firstStage('meadow'), firstStage('deadwood'), firstStage('wall')]).toEqual([3, 4, 5]);
    // Bewohner sind spätestens dann freigeschaltet, wenn ihr Lebensraum öffnen kann (mindestens einer).
    for (const n of HABITAT_NICHES) {
      expect(HABITAT_SPECIES.some((s) => s.niche === n.id && s.unlock <= firstStage(n.id)), n.id).toBe(true);
    }
  });
});

describe('Räuber und Beute (DESIGN_V2.md 22)', () => {
  it('Bestand 0,5 … 1,5; Überjagung höchstens so stark wie der bisherige Räuberdruck', () => {
    expect(STOCK_BASE).toBe(0.5);
    expect(STOCK_BASE + STOCK_RANGE).toBe(1.5);
    expect(STOCK_LOW).toBeGreaterThan(STOCK_BASE);
    expect(STOCK_HIGH).toBeLessThan(STOCK_BASE + STOCK_RANGE);
    // Bisheriger Räuberdruck: 0,10 je Jäger, höchstens 2 Jäger (−20 %).
    expect(OVERHUNT_PENALTY * OVERHUNT_MAX_UNITS).toBeCloseTo(0.2);
  });

  it('Ergänzungen betreffen vorhandene Arten; jedes neue Beute-Merkmal hat Beute und Jäger', () => {
    for (const map of [PROVIDES_ADDITIONS, FOOD_ADDITIONS, EFFECT_ADDITIONS]) {
      for (const id of Object.keys(map)) expect(SPECIES_BY_ID.has(id), id).toBe(true);
    }
    for (const tag of PREY_TAGS) {
      expect(ALL.some((s) => s.provides.includes(tag)), `${tag}: Beute`).toBe(true);
      expect(ALL.some((s) => s.level === 'predator' && s.food.includes(tag)), `${tag}: Jäger`).toBe(true);
    }
    // Die Ringelnatter jagt Amphibien; alle fünf Amphibien sind Beute.
    for (const s of SPECIES.filter((x) => x.genus === 'amphibians')) expect(PROVIDES_ADDITIONS[s.id], s.id).toContain('amphibien');
    // Jede Kontrolle eines neuen Merkmals hat eine passende Nahrung.
    for (const [id, effects] of Object.entries(EFFECT_ADDITIONS)) {
      for (const e of effects) if (e.kind === 'control') expect(ALL_BY_ID.get(id)!.food, id).toContain(e.tag);
    }
  });

  it('Massenjahre: nur mit Bedingung „ungejagt“, die ein Räuber beheben kann; Versprechen einlösbar', () => {
    for (const e of PREDATION_EVENTS) {
      // Verdrahtet (Schritt A): genau einmal in EVENTS, Jahreszeiten in EVENT_SEASONS.
      expect(EVENTS.filter((x) => x.id === e.id).length, e.id).toBe(1);
      expect(EVENT_SEASONS[e.id], e.id).toEqual(PREDATION_EVENT_SEASONS[e.id]);
      expect(e.options.length, e.id).toBe(2);
      expect(e.minStage, e.id).toBeGreaterThanOrEqual(3);
      const unhunted = (e.appears ?? []).filter((c) => c.kind === 'unhunted');
      expect(unhunted.length, e.id).toBe(1);
      const tag = (unhunted[0] as { tag: W3Tag }).tag;
      expect(ALL.some((s) => s.provides.includes(tag)), e.id).toBe(true);
      expect(ALL.some((s) => s.level === 'predator' && s.food.includes(tag)), e.id).toBe(true);
      for (const o of e.options) {
        for (const x of o.effects) {
          if (x.kind !== 'nextEncounter') continue;
          // Die Einladung bietet Jäger genau dieser Beute an: Sie fressen sie oder halten sie
          // klein (`control`) – beides beendet „ungejagt“.
          for (const id of x.ids) {
            const s = ALL_BY_ID.get(id);
            expect(s, `${e.id}: ${id}`).toBeDefined();
            const effects = [...(SPECIES_BY_ID.get(id)?.effects ?? NEW_BY_ID.get(id)?.effects ?? []), ...(EFFECT_ADDITIONS[id] ?? [])];
            const controls = effects.some((y) => y.kind === 'control' && y.tag === tag);
            expect(s!.food.includes(tag) || controls, `${e.id}: ${id}`).toBe(true);
          }
          // Wie bei allen Ereignissen (content.test.ts): ab minStage alle bis auf höchstens
          // eine freigeschaltet und mit offener Nische (neue Lebensräume sind dann noch zu).
          const ready = x.ids.filter((id) => {
            const s = ALL_BY_ID.get(id)!;
            const niche = NICHES_BY_ID.get(s.niche as never);
            return s.unlock <= e.minStage && !!niche && niche.slots[e.minStage]! > 0;
          });
          expect(ready.length, `${e.id}: ${ready.join(', ')}`).toBeGreaterThanOrEqual(Math.max(Math.min(2, x.ids.length), x.ids.length - 1));
        }
      }
      expect(PREDATION_EVENT_SEASONS[e.id], e.id).toBeDefined();
      for (const s of PREDATION_EVENT_SEASONS[e.id]!) expect(SEASON_IDS, e.id).toContain(s);
    }
  });

  it('Wetter → Begegnungen: nur bekannte Wetter und Ereignisse, Faktor 1 < f ≤ 3', () => {
    const weathers = ['mild', 'rain', 'sun', 'fog', 'snow', 'drought', 'storm', 'frost'];
    const events = new Set([...EVENTS_BY_ID.keys(), ...PREDATION_EVENTS.map((e) => e.id)]);
    for (const [w, factors] of Object.entries(WEATHER_EVENT_FACTORS)) {
      expect(weathers, w).toContain(w);
      for (const [id, f] of Object.entries(factors)) {
        expect(events.has(id), `${w}: ${id}`).toBe(true);
        expect(f > 1 && f <= 3, `${w}: ${id}`).toBe(true);
      }
    }
  });
});
