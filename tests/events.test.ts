import { describe, expect, it } from 'vitest';
import { INTERLUDE_POSITION, MAX_PENDING_ENCOUNTERS } from '../src/content/encounters';
import { EVENTS, EVENTS_BY_ID, SEED_SECONDS_MIN_SEEDS } from '../src/content/events';
import { VISITORS_BY_ID } from '../src/content/visitors';
import { cardStatus, evaluate, seedSeconds, thresholdFor } from '../src/core/formulas';
import { deserialize, loadGame, serialize } from '../src/core/save';
import { createCycle, type PendingEncounter } from '../src/core/state';
import {
  chooseCard,
  chooseEventOption,
  declineEncounter,
  drawEncounter,
  eligibleEvents,
  eligibleVisitors,
  eventOptionBlocker,
  farewellVisitor,
  hostBlocker,
  hostVisitor,
  interludeThreshold,
  nextExpiry,
  rerollBlocker,
  simulateOffline,
  startNewCycle,
  tick,
  visitorSeeds,
} from '../src/core/tick';
import { resolveSpecial, stateAt } from './helpers';

const event = (id: string): PendingEncounter => ({ type: 'event', cards: [id], rerolls: 0 });
const guest = (id: string): PendingEncounter => ({ type: 'visitor', cards: [id], rerolls: 0 });

/** Index der Option eines Ereignisses mit diesem Knopftext. */
function option(eventId: string, label: string): number {
  const i = EVENTS_BY_ID.get(eventId)!.options.findIndex((o) => o.label === label);
  if (i < 0) throw new Error(`Option „${label}“ fehlt in ${eventId}`);
  return i;
}

describe('Samen-Sekunden', () => {
  it('Sekunden × aktuelle Samenrate, mindestens SEED_SECONDS_MIN_SEEDS', () => {
    const state = stateAt(5, ['earthworm', 'robin', 'bee'], 1);
    const rate = evaluate(state).seeds;
    expect(seedSeconds(state, 120)).toBeCloseTo(Math.max(SEED_SECONDS_MIN_SEEDS, 120 * rate));
    expect(seedSeconds(state, 0)).toBe(SEED_SECONDS_MIN_SEEDS);
    expect(seedSeconds(state, NaN)).toBe(SEED_SECONDS_MIN_SEEDS);
    expect(seedSeconds(state, -50)).toBe(SEED_SECONDS_MIN_SEEDS);
    expect(Number.isFinite(seedSeconds(state, 1e308))).toBe(true);
  });
});

describe('Ereignisse: Wirkungen', () => {
  it('seedsNow: Samen sofort, zur Rate vor der Wahl; die Begegnung ist erledigt', () => {
    const state = stateAt(3, ['earthworm', 'bee'], 1);
    state.pendingEncounters = [event('storm')];
    const expected = seedSeconds(state, 120);
    const result = chooseEventOption(state, 0, option('storm', 'Holz verwerten'));
    expect(result).toEqual({ ok: true, seeds: expected });
    expect(state.seeds).toBeCloseTo(expected);
    expect(state.pendingEncounters).toEqual([]);
  });

  it('timed: Bonus wirkt genau `seconds` Spielzeit, dann wieder die alten Raten', () => {
    const state = stateAt(3, ['earthworm', 'bee'], 1);
    state.pendingEncounters = [event('midsummer')];
    const before = evaluate(state);
    chooseEventOption(state, 0, option('midsummer', 'Lange Tage nutzen'));
    const during = evaluate(state);
    expect(during.growthBonus).toBeCloseTo(before.growthBonus + 0.3);
    expect(during.growth).toBeGreaterThan(before.growth);
    expect(nextExpiry(state)).toBe(360);
    state.totalGrowth = 0; // kein Wegpunkt dazwischen
    state.waypoint = 0;
    state.stage = 3;
    tick(state, 359);
    expect(evaluate(state).growthBonus).toBeCloseTo(during.growthBonus);
    const report = tick(state, 2);
    expect(report.expired).toEqual(['midsummer']);
    expect(state.cycle.timed).toEqual([]);
    expect(evaluate(state).growthBonus).toBeCloseTo(before.growthBonus);
  });

  it('cycle + habitat: Licht, Wasser, Feuchte und Totholz bis zum Neuen Zyklus', () => {
    // Ohne Tiere: sonst ändern Merkmale die Zufriedenheit und damit Tier-Wirkungen.
    const state = stateAt(4, [], 1);
    const before = evaluate(state);
    state.pendingEncounters = [event('windthrow'), event('rain'), event('storm')];
    chooseEventOption(state, 0, option('windthrow', 'Lichtung offen lassen'));
    chooseEventOption(state, 0, option('rain', 'Waldtümpel entstehen lassen'));
    chooseEventOption(state, 0, option('storm', 'Totholz liegen lassen'));
    const after = evaluate(state);
    expect(after.light).toBeCloseTo(before.light + 3);
    expect(after.water).toBeCloseTo(before.water + 3);
    expect(state.cycle.habitats).toEqual(['feucht', 'totholz']);
    // Merkmal zählt für Erscheinungsbedingungen: Pilzherbst braucht Feuchte.
    expect(eligibleEvents(state).map((e) => e.id)).toContain('mushroom-autumn');
    // +1 Platz in Höhlen & Totholz
    expect(after.slots.hollows).toBe(before.slots.hollows + 1);
    // Der Neue Zyklus setzt alles zurück.
    state.stage = 5;
    startNewCycle(state, 0);
    expect(state.cycle).toEqual({ ...createCycle(2, 0), maxHarmony: state.cycle.maxHarmony });
  });

  it('slot öffnet Höhlen schon im Jungen Baum (opensEarly) – Karten zählen den Platz', () => {
    const state = stateAt(3, [], 1);
    expect(evaluate(state).slots.hollows).toBe(0);
    state.pendingEncounters = [event('storm')];
    chooseEventOption(state, 0, option('storm', 'Totholz liegen lassen'));
    expect(evaluate(state).slots.hollows).toBe(1);
    state.pendingEncounters = [{ type: 'animal', cards: ['bat'], rerolls: 0 }];
    state.stage = 4;
    expect(cardStatus(state, 0, 0)).toBe('free');
  });

  it('harmony: +5 Harmonie bis zum Neuen Zyklus', () => {
    const state = stateAt(5, ['woodant', 'earthworm'], 1);
    const before = evaluate(state).harmony;
    state.pendingEncounters = [event('ant-trail')];
    chooseEventOption(state, 0, option('ant-trail', 'Den Hügel wachsen lassen'));
    expect(evaluate(state).harmony).toBeCloseTo(before + 5);
    expect(state.cycle.maxHarmony).toBeGreaterThanOrEqual(before + 5 - 1e-9);
  });

  it('nextEncounter: die nächste Begegnung bietet zuerst die vorgegebenen Karten', () => {
    const state = stateAt(4, ['earthworm'], 7);
    state.waypoint = 14;
    state.pendingEncounters = [event('mast-year')];
    chooseEventOption(state, 0, option('mast-year', 'Eicheln liegen lassen'));
    expect(state.cycle.forced).toEqual({ type: 'animal', ids: ['jay', 'squirrel'] });
    const next = drawEncounter(state)!;
    expect(next.type).toBe('animal');
    expect(next.cards.slice(0, 2).sort()).toEqual(['jay', 'squirrel']);
    expect(next.cards).toHaveLength(3);
    expect(state.cycle.forced).toBeNull();
  });

  it('nextEncounter mit Pflanzen; passt nichts mehr, verfällt der Vorzug still', () => {
    const plants = stateAt(4, ['robin', 'bluetit'], 3);
    plants.waypoint = 14;
    plants.cycle.forced = { type: 'plant', ids: ['rowan', 'elder', 'bramble'] };
    const enc = drawEncounter(plants)!;
    expect(enc.type).toBe('plant');
    expect([...enc.cards].sort()).toEqual(['bramble', 'elder', 'rowan'].filter((id) => enc.cards.includes(id)).sort());
    expect(enc.cards.length).toBeGreaterThan(0);

    const none = stateAt(4, ['jay', 'squirrel'], 3);
    none.waypoint = 14;
    none.cycle.forced = { type: 'animal', ids: ['jay', 'squirrel'] };
    const normal = drawEncounter(none);
    expect(none.cycle.forced).toBeNull();
    if (normal?.type === 'animal') expect(normal.cards).not.toContain('jay');
  });

  it('festgelegte Wegpunkte (1–3) gehen dem Vorzug vor', () => {
    const state = stateAt(1, [], 3);
    state.waypoint = 2; // festgelegt: Pflanze
    state.cycle.forced = { type: 'animal', ids: ['earthworm'] };
    expect(drawEncounter(state)!.type).toBe('plant');
    expect(state.cycle.forced).not.toBeNull();
  });
});

describe('Ereignisse: Regeln und Blocker', () => {
  it('jedes Ereignis höchstens einmal je Zyklus, nur ab seiner Stufe und mit Bedingungen', () => {
    const state = stateAt(3, [], 1);
    const ids = eligibleEvents(state).map((e) => e.id);
    expect(ids).toEqual(EVENTS.filter((e) => e.minStage <= 3 && !e.appears).map((e) => e.id));
    state.cycle.seen.push('storm');
    expect(eligibleEvents(state).map((e) => e.id)).not.toContain('storm');
    // Ameisenstraße: ab Hain und nur mit Waldameise.
    expect(eligibleEvents(stateAt(5, [], 1)).map((e) => e.id)).not.toContain('ant-trail');
    expect(eligibleEvents(stateAt(5, ['woodant'], 1)).map((e) => e.id)).toContain('ant-trail');
  });

  it('gezogene Ereignisse gelten sofort als gesehen', () => {
    for (let seed = 1; seed < 200; seed++) {
      const state = stateAt(4, [], seed);
      state.waypoint = 14;
      const enc = drawEncounter(state)!;
      if (enc.type === 'event' || enc.type === 'visitor') {
        expect(state.cycle.seen).toEqual(enc.cards);
        return;
      }
    }
    throw new Error('kein Ereignis gezogen');
  });

  it('Blocker als Codes; kein Ablehnen, kein Neu würfeln, keine Kartenwahl', () => {
    const state = stateAt(3, [], 1);
    expect(eventOptionBlocker(state, 0, 0)).toBe('no-encounter');
    state.pendingEncounters = [{ type: 'animal', cards: ['earthworm'], rerolls: 0 }, event('storm')];
    expect(eventOptionBlocker(state, 0, 0)).toBe('wrong-type');
    expect(eventOptionBlocker(state, 1, 5)).toBe('no-option');
    expect(eventOptionBlocker(state, 1, NaN)).toBe('no-option');
    expect(eventOptionBlocker(state, 1, 1)).toBeNull();
    expect(declineEncounter(state, 1)).toEqual({ ok: false, error: 'wrong-type' });
    expect(rerollBlocker(state, 1)).toBe('wrong-type');
    expect(chooseCard(state, 1, 0).ok).toBe(false);
    expect(state.pendingEncounters).toHaveLength(2);
    expect(chooseEventOption(state, 1, 9)).toEqual({ ok: false, error: 'no-option' });
  });
});

describe('Durchreisende', () => {
  it('Bewirten kostet Samen-Sekunden, der Gast wirkt und zählt für die Gattungsboni', () => {
    const state = stateAt(4, ['robin', 'bluetit', 'earthworm'], 1);
    state.pendingEncounters = [guest('cranes')];
    const costs = visitorSeeds(state, 'cranes')!;
    expect(costs.host).toBeCloseTo(seedSeconds(state, 40));
    expect(costs.farewell).toBeCloseTo(seedSeconds(state, 15));
    expect(hostBlocker(state, 0)).toBe('too-expensive');
    expect(hostVisitor(state, 0)).toEqual({ ok: false, error: 'too-expensive' });
    state.seeds = costs.host + 1;
    const before = evaluate(state);
    const result = hostVisitor(state, 0);
    expect(result.ok && result.seeds).toBeCloseTo(-costs.host);
    expect(state.seeds).toBeCloseTo(1);
    expect(state.cycle.visitors).toEqual([{ id: 'cranes', remaining: VISITORS_BY_ID.get('cranes')!.stay }]);
    const after = evaluate(state);
    expect(after.genusCounts.birds).toBe(before.genusCounts.birds + 1);
    expect(after.seedsBonus).toBeGreaterThanOrEqual(before.seedsBonus + 0.25 - 1e-9);
    // Gäste zählen nicht für Erscheinungsbedingungen (Vogelsaat braucht 2 Vögel – die sind schon da).
    expect(state.pendingEncounters).toEqual([]);
  });

  it('Ziehen lassen bringt Samen; ein Gast rastet nicht, solange er wartet', () => {
    const state = stateAt(4, ['earthworm'], 1);
    state.pendingEncounters = [guest('cranes')];
    const thanks = visitorSeeds(state, 'cranes')!.farewell;
    tick(state, 10);
    expect(state.cycle.visitors).toEqual([]);
    const seeds = state.seeds;
    expect(farewellVisitor(state, 0)).toEqual({ ok: true, seeds: thanks });
    expect(state.seeds).toBeCloseTo(seeds + thanks);
    expect(farewellVisitor(state, 0)).toEqual({ ok: false, error: 'no-encounter' });
  });

  it('der Gast reist nach `stay` Sekunden Spielzeit ab', () => {
    const state = stateAt(4, ['earthworm'], 1);
    state.cycle.visitors = [{ id: 'peregrine', remaining: 600 }];
    state.totalGrowth = 0;
    state.waypoint = 0;
    const withGuest = evaluate(state).harmony;
    const report = tick(state, 700);
    expect(report.expired).toEqual(['peregrine']);
    expect(evaluate(state).harmony).toBeLessThan(withGuest);
  });

  it('Kandidaten: ab Stufe, einmal je Zyklus, mit Bedingungen', () => {
    expect(eligibleVisitors(stateAt(3, [], 1))).toEqual([]);
    const old = stateAt(4, [], 1);
    expect(eligibleVisitors(old).map((v) => v.id)).toContain('cranes');
    old.cycle.seen.push('cranes');
    expect(eligibleVisitors(old).map((v) => v.id)).not.toContain('cranes');
  });
});

describe('Zwischenhalt (ab Hain)', () => {
  it('liegt auf halbem Weg zwischen zwei Wegpunkten, nur ab dem Hain und je Abschnitt einmal', () => {
    expect(interludeThreshold(stateAt(4, [], 1))).toBe(Infinity);
    const state = stateAt(5, [], 1);
    const k = state.waypoint;
    const expected = thresholdFor(k) + INTERLUDE_POSITION * (thresholdFor(k + 1) - thresholdFor(k));
    expect(interludeThreshold(state)).toBeCloseTo(expected);
    state.cycle.interlude = k;
    expect(interludeThreshold(state)).toBe(Infinity);
  });

  it('wird beim Wachsen ausgewertet: höchstens ein Ereignis/Gast, Abschnitt gilt als erledigt', () => {
    let hits = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const state = stateAt(5, ['earthworm', 'robin'], seed);
      const half = interludeThreshold(state);
      const rate = evaluate(state).growth;
      const report = tick(state, ((half - state.totalGrowth) / rate) * 1.01);
      expect(report.waypoints).toBe(0);
      expect(state.cycle.interlude).toBe(state.waypoint);
      expect(report.interludes).toBeLessThanOrEqual(1);
      expect(state.pendingEncounters.length).toBe(report.interludes);
      for (const e of state.pendingEncounters) expect(['event', 'visitor']).toContain(e.type);
      hits += report.interludes;
    }
    // INTERLUDE_CHANCE 0,5 – grob die Hälfte.
    expect(hits).toBeGreaterThan(15);
    expect(hits).toBeLessThan(45);
  });

  it('bei voller Warteschlange kommt am Zwischenhalt nichts', () => {
    const state = stateAt(5, ['earthworm'], 1);
    state.pendingEncounters = Array.from({ length: MAX_PENDING_ENCOUNTERS }, () => ({ type: 'animal' as const, cards: ['vole'], rerolls: 0 }));
    const rng = state.rngState;
    const half = interludeThreshold(state);
    tick(state, ((half - state.totalGrowth) / evaluate(state).growth) * 1.01);
    expect(state.cycle.interlude).toBe(state.waypoint);
    expect(state.pendingEncounters).toHaveLength(MAX_PENDING_ENCOUNTERS);
    expect(state.rngState).toBe(rng); // kein Zufall verbraucht
  });
});

describe('online gleich offline (mit Boni, Gästen und Zwischenhalt)', () => {
  it('viele kleine Ticks = ein großer', () => {
    const online = stateAt(5, ['earthworm', 'robin', 'bluetit', 'bee', 'woodant'], 4242);
    online.plants = ['hazel', 'anemone'];
    online.seeds = 10_000;
    online.pendingEncounters = [event('midsummer'), guest('peregrine'), event('rain')];
    chooseEventOption(online, 0, option('midsummer', 'Lange Tage nutzen'));
    hostVisitor(online, 0);
    chooseEventOption(online, 0, option('rain', 'Alles austreiben lassen'));
    const offline = structuredClone(online);
    for (let i = 0; i < 3 * 3600; i++) tick(online, 1);
    const report = simulateOffline(offline, 3 * 3600);
    expect(report.expired.sort()).toEqual(['midsummer', 'peregrine', 'rain']);
    expect(offline.waypoint).toBe(online.waypoint);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    expect(offline.cycle.seen).toEqual(online.cycle.seen);
    expect(offline.cycle.interlude).toBe(online.cycle.interlude);
    expect(offline.cycle.timed).toEqual(online.cycle.timed);
    expect(offline.cycle.visitors).toEqual(online.cycle.visitors);
    expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 4);
    expect(offline.seeds).toBeCloseTo(online.seeds, 4);
  });

  it('auch wenn währenddessen Ereignisse aufgelöst werden (Golden-Stichprobe ohne NaN)', () => {
    const state = stateAt(5, ['earthworm', 'robin'], 99);
    for (let i = 0; i < 4 * 60; i++) {
      tick(state, 60);
      while (resolveSpecial(state)) {
        // Ereignisse und Gäste auflösen
      }
      state.pendingEncounters = state.pendingEncounters.filter((e) => e.type === 'animal' || e.type === 'plant');
    }
    expect(Number.isFinite(state.seeds) && Number.isFinite(state.totalGrowth)).toBe(true);
    expect(state.cycle.seen.length).toBeGreaterThan(0);
  });
});

describe('Speichern und Laden (v5)', () => {
  it('Ereignis-Felder überstehen Speichern und Laden', () => {
    const state = stateAt(5, ['earthworm', 'woodant'], 1);
    state.seeds = 10_000;
    state.pendingEncounters = [event('storm'), event('midsummer'), guest('peregrine')];
    chooseEventOption(state, 0, 0);
    chooseEventOption(state, 0, option('midsummer', 'Alles blühen lassen'));
    state.cycle.seen.push('storm', 'midsummer', 'peregrine');
    state.cycle.forced = { type: 'animal', ids: ['jay'] };
    state.cycle.interlude = state.waypoint;
    tick(state, 5);
    const loaded = deserialize(serialize(state), 0)!;
    expect(loaded.cycle).toEqual(state.cycle);
    expect(loaded.pendingEncounters).toEqual([guest('peregrine')]);
    expect(evaluate(loaded)).toEqual(evaluate(state));
  });

  it('v4 → v5: neue Felder leer; hinter dem Zwischenhalt gilt der Abschnitt als ausgewertet', () => {
    const v4 = (growthShare: number) => {
      const s = stateAt(5, ['earthworm'], 1);
      const k = s.waypoint;
      s.totalGrowth = thresholdFor(k) + growthShare * (thresholdFor(k + 1) - thresholdFor(k));
      const raw = JSON.parse(serialize(s));
      raw.version = 4;
      for (const f of ['seen', 'bonuses', 'habitats', 'timed', 'visitors', 'forced', 'interlude']) delete raw.cycle[f];
      return JSON.stringify(raw);
    };
    const early = loadGame(v4(0.2), 0)!.state;
    expect(early.version).toBe(5);
    expect(early.cycle).toMatchObject({ seen: [], bonuses: [], habitats: [], timed: [], visitors: [], forced: null, interlude: 0 });
    const late = loadGame(v4(0.8), 0)!.state;
    expect(late.cycle.interlude).toBe(late.waypoint);
  });

  it('kaputte oder manipulierte Felder: verwerfen bzw. begrenzen statt abstürzen', () => {
    const base = JSON.parse(serialize(stateAt(5, ['earthworm'], 1)));
    base.cycle = {
      ...base.cycle,
      seen: ['storm', 'storm', 'nope', 3, 'cranes'],
      bonuses: [
        { source: 'windthrow', effect: { kind: 'light', amount: 3 } },
        { source: 'windthrow', effect: { kind: 'light', amount: 300 } }, // so vergibt es kein Ereignis
        { source: 'nope', effect: { kind: 'harmony', points: 5 } },
        'Unsinn',
      ],
      habitats: ['totholz', 'gold', 7],
      timed: [
        { source: 'midsummer', effect: { kind: 'growth', pct: 30 }, remaining: 1e9 },
        { source: 'midsummer', effect: { kind: 'seeds', pct: 60 }, remaining: -5 },
        { source: 'midsummer', effect: { kind: 'growth', pct: 30 }, remaining: NaN },
      ],
      visitors: [{ id: 'cranes', remaining: 1e9 }, { id: 'cranes', remaining: 10 }, { id: 'ufo', remaining: 10 }],
      forced: { type: 'animal', ids: ['jay', 'drache'] },
      interlude: 1e9,
    };
    base.pendingEncounters = [
      { type: 'event', cards: ['lightning', 'storm'], rerolls: 4 },
      { type: 'visitor', cards: ['ufo'], rerolls: 0 },
      { type: 'event', cards: ['ant-trail'], rerolls: 0 },
    ];
    const s = deserialize(JSON.stringify(base), 0)!;
    expect(s.cycle.seen).toEqual(['storm', 'cranes', 'lightning', 'ant-trail']);
    expect(s.cycle.bonuses).toEqual([{ source: 'windthrow', effect: { kind: 'light', amount: 3 } }]);
    expect(s.cycle.habitats).toEqual(['totholz']);
    expect(s.cycle.timed).toEqual([{ source: 'midsummer', effect: { kind: 'growth', pct: 30 }, remaining: 360 }]);
    expect(s.cycle.visitors).toEqual([{ id: 'cranes', remaining: VISITORS_BY_ID.get('cranes')!.stay }]);
    expect(s.cycle.forced).toEqual({ type: 'animal', ids: ['jay'] });
    expect(s.cycle.interlude).toBe(s.waypoint);
    expect(s.pendingEncounters).toEqual([event('lightning'), event('ant-trail')]);
    for (const bad of [{ cycle: { forced: { type: 'event', ids: ['x'] } } }, { cycle: { timed: 'x', visitors: {} } }]) {
      const t = deserialize(JSON.stringify({ ...base, ...bad }), 0)!;
      expect(t.cycle.forced).toBeNull();
      expect(t.cycle.timed).toEqual([]);
    }
  });
});
