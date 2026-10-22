import { describe, expect, it } from 'vitest';
import { CARE, CARE_BY_ID } from '../src/content/care';
import { COMMUNITIES, COMMUNITIES_BY_ID } from '../src/content/communities';
import { EVENTS, EVENTS_BY_ID } from '../src/content/events';
import { HABITAT_CARE, HABITAT_COMMUNITIES, HABITAT_NICHES, HABITAT_SPECIES, REPTILE_TRAITS } from '../src/content/habitats';
import { NICHES, NICHES_BY_ID } from '../src/content/niches';
import { PLANTS_BY_ID } from '../src/content/plants';
import {
  OVERHUNT_MAX_UNITS,
  OVERHUNT_PENALTY,
  PREDATION_EVENTS,
  PREDATION_EVENT_SEASONS,
  STOCK_BASE,
  STOCK_HIGH,
  STOCK_LOW,
  STOCK_RANGE,
  WEATHER_EVENT_FACTORS,
} from '../src/content/predation';
import { EVENT_SEASONS, SEASONS_BY_ID, SEASON_IDS, type SeasonId } from '../src/content/seasons';
import { GENUS_INFO, SPECIES, SPECIES_BY_ID, TAG_NAMES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { TRAITS } from '../src/content/traits';
import { GENERA, NICHE_IDS, type Condition, type Tag } from '../src/content/types';

/**
 * Inhaltstest für Welle 3 (DESIGN_V2.md 22 und 23): Räuber und Beute, Lebensräume. Seit
 * Spielstand v13 (Schritt B) sind die Lebensräume verdrahtet – geprüft wird, dass sie in den
 * echten Listen stehen und in sich stimmig sind. Die Logik prüfen tests/predation.test.ts
 * und tests/habitats-core.test.ts.
 */

const PREY_TAGS: readonly Tag[] = ['amphibien', 'echsen', 'hasen'];
const HABITAT_IDS = new Set<string>(HABITAT_NICHES.map((n) => n.id));
const HABITAT_SPECIES_IDS = new Set<string>(HABITAT_SPECIES.map((s) => s.id));
const knownId = (id: string) => SPECIES_BY_ID.has(id) || PLANTS_BY_ID.has(id);
const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

function checkCondition(c: Condition, where: string): void {
  switch (c.kind) {
    case 'tag':
    case 'unhunted':
      expect(c.tag in TAG_NAMES, `${where}: ${c.tag}`).toBe(true);
      break;
    case 'species':
      expect(knownId(c.id), `${where}: ${c.id}`).toBe(true);
      break;
    case 'genus':
      expect(GENERA, where).toContain(c.genus);
      break;
    default:
      break;
  }
}

describe('Lebensräume (DESIGN_V2.md 23)', () => {
  it('neue Nischen: verdrahtet (hinten angefügt), keine Plätze aus der Stufe, öffnen nur durch Wirkungen', () => {
    expect(HABITAT_NICHES.map((n) => n.id)).toEqual(['meadow', 'deadwood', 'wall']);
    expect(NICHE_IDS.slice(-3)).toEqual(['meadow', 'deadwood', 'wall']);
    expect(NICHES.map((n) => n.id)).toEqual([...NICHE_IDS]);
    for (const n of HABITAT_NICHES) {
      expect(NICHES_BY_ID.get(n.id), n.id).toBe(n);
      expect(n.slots.length, n.id).toBe(STAGES.length);
      expect(n.slots.every((s) => s === 0), n.id).toBe(true);
      expect(n.opensEarly, n.id).toBe(true);
    }
  });

  it('14 Arten in SPECIES: eindeutige IDs, 3–5 je Lebensraum, nur gewöhnlich und selten (keine neue Fähigkeit)', () => {
    expect(HABITAT_SPECIES.length).toBe(14);
    expect(SPECIES.length).toBe(51);
    expect(unique(SPECIES.map((s) => s.id))).toBe(true);
    for (const s of HABITAT_SPECIES) {
      expect(SPECIES_BY_ID.get(s.id), s.id).toBe(s);
      expect(PLANTS_BY_ID.has(s.id), s.id).toBe(false);
      expect(HABITAT_IDS.has(s.niche), s.id).toBe(true);
      expect(s.rarity === 0 || s.rarity === 1, s.id).toBe(true);
      expect(s.unlock >= 3 && s.unlock <= 5, s.id).toBe(true);
      expect(s.name.length > 0 && s.text.length > 0 && s.summary.length > 0, s.id).toBe(true);
      expect(s.food.length, s.id).toBeGreaterThan(0);
      for (const t of [...s.food, ...s.provides]) expect(t in TAG_NAMES, `${s.id}: ${t}`).toBe(true);
      for (const c of [...s.needs, ...(s.appears ?? [])]) checkCondition(c, s.id);
      expect(s.effects.some((e) => e.kind === 'ability'), s.id).toBe(false);
      // Stärke wie im Katalog: gewöhnlich bis 7 % 🌿, selten bis 9 % (Wachstum ×0,75 seit 2.10).
      for (const e of s.effects) {
        if (e.kind === 'growth') expect(e.pct, s.id).toBeLessThanOrEqual(s.rarity === 0 ? 7 : 9);
        if (e.kind === 'harmony') expect(e.points, s.id).toBeLessThanOrEqual(2);
      }
    }
    // Nur die Lebensraum-Arten wohnen in den neuen Nischen.
    for (const s of SPECIES) expect(HABITAT_IDS.has(s.niche), s.id).toBe(HABITAT_SPECIES_IDS.has(s.id));
    for (const n of HABITAT_NICHES) {
      const count = HABITAT_SPECIES.filter((s) => s.niche === n.id).length;
      expect(count, n.id).toBeGreaterThanOrEqual(3);
      expect(count, n.id).toBeLessThanOrEqual(5);
    }
  });

  it('Reptilien: Gattung mit 5 Arten auf allen drei Lebensräumen, drei Bonus-Stufen, Sonnenbad im Sommer', () => {
    expect(GENERA).toContain('reptiles');
    expect(GENUS_INFO.reptiles).toEqual({ name: 'Reptilien', icon: '🦎' });
    expect(TRAITS.reptiles).toBe(REPTILE_TRAITS);
    expect(REPTILE_TRAITS.length).toBe(3);
    const reptiles = SPECIES.filter((s) => s.genus === 'reptiles');
    expect(reptiles.length).toBe(5);
    expect(new Set(reptiles.map((s) => s.niche))).toEqual(new Set(['meadow', 'deadwood', 'wall']));
    const happiness = (season: SeasonId) =>
      SEASONS_BY_ID.get(season)!.effects.filter((e) => e.kind === 'happiness' && e.genus === 'reptiles');
    expect(happiness('summer')).toEqual([{ kind: 'happiness', genus: 'reptiles', points: 15 }]);
    // Winterstarre ohne Abzug, sonst keine Wirkung.
    for (const season of ['spring', 'autumn', 'winter'] as const) expect(happiness(season), season).toEqual([]);
  });

  it('neue Merkmale haben Namen: Amphibien, Echsen, Kaninchen', () => {
    expect(PREY_TAGS.map((t) => TAG_NAMES[t])).toEqual(['Amphibien', 'Echsen', 'Kaninchen']);
  });

  it('jeder Lebensraum hat eine Lebensgemeinschaft (in COMMUNITIES) mit bekannten Mitgliedern', () => {
    expect(unique(COMMUNITIES.map((c) => c.id))).toBe(true);
    expect(HABITAT_COMMUNITIES.map((c) => c.id)).toEqual(['meadow-song', 'brushpile', 'sun-wall', 'snake-pond']);
    for (const c of HABITAT_COMMUNITIES) {
      expect(COMMUNITIES_BY_ID.get(c.id), c.id).toBe(c);
      expect(c.harmony, c.id).toBe(6);
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
    const measures = [...HABITAT_CARE, CARE_BY_ID.get('deadwood-pile')!];
    for (const m of HABITAT_CARE) expect(CARE_BY_ID.get(m.id), m.id).toBe(m);
    expect(unique(CARE.map((m) => m.id))).toBe(true);
    for (const n of HABITAT_NICHES) {
      const opener = measures.find((m) =>
        m.ranks[0]!.effects.some((e) => e.kind === 'cycle' && e.effect.kind === 'slot' && e.effect.niche === n.id && e.effect.amount >= 2),
      );
      expect(opener, n.id).toBeDefined();
    }
    for (const m of measures) {
      m.ranks.forEach((r, i) => {
        expect(r.cost, m.id).toBeGreaterThan(0);
        if (i > 0) {
          expect(r.cost, m.id).toBeGreaterThanOrEqual(2 * m.ranks[i - 1]!.cost);
          expect(r.minStage, m.id).toBeGreaterThan(m.ranks[i - 1]!.minStage);
        }
      });
    }
    // Totholzhaufen (erweitert): Rang 1 4.500 🌰 mit Totholz und 2 Plätzen, Rang 2 +1 Platz.
    const pile = CARE_BY_ID.get('deadwood-pile')!;
    expect(pile.ranks.map((r) => r.cost)).toEqual([4_500, 14_000]);
    const pileSlots = pile.ranks.map((r) =>
      r.effects.reduce((sum, e) => sum + (e.kind === 'cycle' && e.effect.kind === 'slot' && e.effect.niche === 'deadwood' ? e.effect.amount : 0), 0),
    );
    expect(pileSlots).toEqual([2, 1]);
    expect(pile.ranks[0]!.effects).toContainEqual({ kind: 'habitat', tag: 'totholz' });
    // Waldwiese 2.400 / 16.000 🌰, Trockenmauer 12.000 / 32.000 🌰 (23.2).
    expect(CARE_BY_ID.get('meadow')!.ranks.map((r) => [r.cost, r.minStage])).toEqual([[2_400, 3], [16_000, 5]]);
    expect(CARE_BY_ID.get('drystone-wall')!.ranks.map((r) => [r.cost, r.minStage])).toEqual([[12_000, 5], [36_000, 6]]);
  });

  it('Lebensräume kommen nacheinander: Wiese (Junger Baum), Totholzhaufen (Alter Baum), Mauer (Hain)', () => {
    const firstStage = (niche: string) =>
      Math.min(
        ...CARE.flatMap((m) =>
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

  it('neue Jagdpaare: jedes neue Beute-Merkmal hat Beute und Jäger; Fuchs ↔ Kaninchen, Natter ↔ Amphibien, Echsen', () => {
    for (const tag of PREY_TAGS) {
      expect(SPECIES.some((s) => s.provides.includes(tag)), `${tag}: Beute`).toBe(true);
      expect(SPECIES.some((s) => s.level === 'predator' && s.food.includes(tag)), `${tag}: Jäger`).toBe(true);
    }
    // Die Ringelnatter jagt Amphibien; alle fünf Amphibien sind Beute.
    expect(SPECIES_BY_ID.get('grasssnake')!.food).toEqual(['amphibien']);
    const amphibians = SPECIES.filter((x) => x.genus === 'amphibians');
    expect(amphibians.length).toBe(5);
    for (const s of amphibians) expect(s.provides, s.id).toContain('amphibien');
    // Der Fuchs frisst Kaninchen und hält sie klein (−70 %); seine Kurzwirkung nennt es.
    const fox = SPECIES_BY_ID.get('fox')!;
    expect(fox.food).toEqual(['kleinsaeuger', 'hasen']);
    expect(fox.effects).toContainEqual({ kind: 'control', tag: 'hasen', pct: 70 });
    expect(fox.summary).toBe('jagt Kleinsäuger (−50 %) und Kaninchen (−70 % Fraß), +6 % 🌰');
    expect(SPECIES.filter((s) => s.provides.includes('hasen')).map((s) => s.id)).toEqual(['rabbit']);
    // Echsen: Eidechsen und Blindschleiche sind Beute von Turmfalke und Schlingnatter.
    expect(SPECIES.filter((s) => s.provides.includes('echsen')).map((s) => s.id)).toEqual(['lizard', 'slowworm', 'sandlizard']);
    expect(SPECIES.filter((s) => s.food.includes('echsen')).map((s) => s.id)).toEqual(['kestrel', 'smoothsnake']);
    // Jede Kontrolle eines neuen Merkmals gehört zu einem Jäger, der es frisst.
    for (const s of SPECIES) {
      for (const e of s.effects) if (e.kind === 'control' && PREY_TAGS.includes(e.tag)) expect(s.food, s.id).toContain(e.tag);
    }
  });

  it('Massenjahre: nur mit Bedingung „ungejagt“, die ein Räuber beheben kann; Versprechen einlösbar', () => {
    for (const e of PREDATION_EVENTS) {
      expect(EVENTS.filter((x) => x.id === e.id).length, e.id).toBe(1);
      expect(EVENT_SEASONS[e.id], e.id).toEqual(PREDATION_EVENT_SEASONS[e.id]);
      expect(e.options.length, e.id).toBe(2);
      expect(e.minStage, e.id).toBeGreaterThanOrEqual(3);
      const unhunted = (e.appears ?? []).filter((c) => c.kind === 'unhunted');
      expect(unhunted.length, e.id).toBe(1);
      const tag = (unhunted[0] as { tag: Tag }).tag;
      expect(SPECIES.some((s) => s.provides.includes(tag)), e.id).toBe(true);
      expect(SPECIES.some((s) => s.level === 'predator' && s.food.includes(tag)), e.id).toBe(true);
      for (const o of e.options) {
        for (const x of o.effects) {
          if (x.kind !== 'nextEncounter') continue;
          // Die Einladung bietet Jäger genau dieser Beute an: Sie fressen sie oder halten sie
          // klein (`control`) – beides beendet „ungejagt“.
          for (const id of x.ids) {
            const s = SPECIES_BY_ID.get(id);
            expect(s, `${e.id}: ${id}`).toBeDefined();
            const controls = s!.effects.some((y) => y.kind === 'control' && y.tag === tag);
            expect(s!.food.includes(tag) || controls, `${e.id}: ${id}`).toBe(true);
          }
          // Wie bei allen Ereignissen (content.test.ts): ab minStage alle bis auf höchstens
          // eine freigeschaltet und mit offener Nische (Lebensräume können noch zu sein).
          const ready = x.ids.filter((id) => {
            const s = SPECIES_BY_ID.get(id)!;
            return s.unlock <= e.minStage && NICHES_BY_ID.get(s.niche)!.slots[e.minStage]! > 0;
          });
          expect(ready.length, `${e.id}: ${ready.join(', ')}`).toBeGreaterThanOrEqual(Math.max(Math.min(2, x.ids.length), x.ids.length - 1));
        }
      }
      expect(PREDATION_EVENT_SEASONS[e.id], e.id).toBeDefined();
      for (const s of PREDATION_EVENT_SEASONS[e.id]!) expect(SEASON_IDS, e.id).toContain(s);
    }
  });

  it('Massenjahre mit Lebensraum-Arten (22.5): Mauswiesel, Blindschleiche, Platz im Totholzhaufen', () => {
    const invited = (id: string) =>
      EVENTS_BY_ID.get(id)!.options.flatMap((o) => o.effects.flatMap((x) => (x.kind === 'nextEncounter' ? x.ids : [])));
    expect(invited('vole-year')).toEqual(['owl', 'fox', 'weasel']);
    expect(invited('slug-year')).toEqual(['hedgehog', 'glowworm', 'slowworm']);
    const rot = EVENTS_BY_ID.get('beetle-year')!.options[1]!;
    expect(rot.effects).toEqual([
      { kind: 'habitat', tag: 'totholz' },
      { kind: 'cycle', effect: { kind: 'slot', niche: 'deadwood', amount: 1 } },
    ]);
  });

  it('Wetter → Begegnungen: nur bekannte Wetter und Ereignisse, Faktor 1 < f ≤ 3', () => {
    const weathers = ['mild', 'rain', 'sun', 'fog', 'snow', 'drought', 'storm', 'frost'];
    for (const [w, factors] of Object.entries(WEATHER_EVENT_FACTORS)) {
      expect(weathers, w).toContain(w);
      for (const [id, f] of Object.entries(factors)) {
        expect(EVENTS_BY_ID.has(id), `${w}: ${id}`).toBe(true);
        expect(f > 1 && f <= 3, `${w}: ${id}`).toBe(true);
      }
    }
  });
});
