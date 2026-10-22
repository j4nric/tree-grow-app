import { describe, expect, it } from 'vitest';
import { SPECIES_BY_ID } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import type { SeasonId } from '../src/content/seasons';
import type { Effect } from '../src/content/types';
import { appearsContext, evaluate, evaluateEcosystem, nicheSlots, slotBonuses } from '../src/core/formulas';
import { SAVE_KEY, deserialize, exportCode, importCode, loadGame, serialize, storedSaveIsNewer } from '../src/core/save';
import { SAVE_VERSION, type GameState } from '../src/core/state';
import { buyCare, chooseEventOption, drawAnimals, eligibleEvents, startNewCycle } from '../src/core/tick';
import { isNewerSchema } from '../src/sync/policy';
import { stateAt } from './helpers';
import { MemoryStorage } from './memory-storage';

/**
 * Lebensräume (DESIGN_V2.md 23, Schritt B): Spielstand v13 mit Migration und robustem
 * Laden, Schutz vor älteren Clients und die Logik der neuen Nischen, Arten und Jagdpaare.
 * Inhalte prüft tests/habitats.test.ts, online = offline tests/tick.test.ts.
 */

const HABITATS = ['meadow', 'deadwood', 'wall'] as const;

/** Stand im Format v12: ohne die drei Nischen der Lebensräume. */
function asV12(state: GameState, patch: (raw: Record<string, any>) => void = () => {}): string {
  const raw = JSON.parse(serialize(state));
  raw.version = 12;
  for (const n of HABITATS) delete raw.niches[n];
  patch(raw);
  return JSON.stringify(raw);
}

/** Platz-Boni eines Stands als Wirkungen (für evaluateEcosystem ohne Jahreszeit und Wetter). */
const slotBonusEffects = (state: GameState): Effect[] => slotBonuses(state).map((b) => ({ kind: 'slot', niche: b.niche, amount: b.amount }));

/** Alter Baum mit viel Samen. */
function rich(stage: number, animals: string[] = [], seed = 3): GameState {
  const state = stateAt(stage, animals, seed);
  state.seeds = 1e6;
  return state;
}

describe('Spielstand v13 (DESIGN_V2.md 23.6)', () => {
  it('aktuelle Version mit den Lebensräumen (seit v13); neue Stände haben die drei Nischen leer', () => {
    expect(SAVE_VERSION).toBe(14);
    const state = stateAt(0);
    for (const n of HABITATS) expect(state.niches[n], n).toEqual([]);
    expect(state.version).toBe(14);
  });

  it('v12 → v13 ohne Pflege: Nischen leer und geschlossen, sonst unverändert', () => {
    const before = stateAt(4, ['earthworm', 'robin', 'bluetit'], 5);
    const loaded = loadGame(asV12(before), 0)!.state;
    expect(loaded.version).toBe(14);
    for (const n of HABITATS) {
      expect(loaded.niches[n], n).toEqual([]);
      expect(evaluate(loaded).slots[n], n).toBe(0);
    }
    expect(loaded.niches.litter).toEqual(['robin']);
    expect(loaded.niches.crown).toEqual(['bluetit']);
    expect(loaded.cycle.bonuses).toEqual([]);
  });

  it('v12 → v13 mit Totholzhaufen Rang 1 (3.500 🌰 bezahlt): Nische leer mit 2 Plätzen, Rang 2 im Hain mit 3', () => {
    const old = stateAt(4, [], 5);
    old.cycle.care = { 'deadwood-pile': 1 };
    const loaded = loadGame(asV12(old), 0)!.state;
    expect(loaded.cycle.care).toEqual({ 'deadwood-pile': 1 });
    expect(loaded.niches.deadwood).toEqual([]);
    expect(evaluate(loaded).slots.deadwood).toBe(2);
    expect(nicheSlots(loaded.stage, loaded.niches, slotBonuses(loaded)).deadwood).toBe(2);
    const grove = stateAt(5, [], 5);
    grove.cycle.care = { 'deadwood-pile': 2 };
    expect(evaluate(loadGame(asV12(grove), 0)!.state).slots.deadwood).toBe(3);
  });

  it('v12 → v13: Käferjahr „Das Holz vermodern lassen“ bekommt seinen Platz nachgetragen (wie v11 beim Regen)', () => {
    const old = stateAt(5, [], 5);
    old.cycle.seen = ['beetle-year'];
    old.cycle.habitats = ['totholz'];
    const loaded = loadGame(asV12(old), 0)!.state;
    expect(loaded.cycle.bonuses).toEqual([{ source: 'beetle-year', effect: { kind: 'slot', niche: 'deadwood', amount: 1 } }]);
    expect(evaluate(loaded).slots.deadwood).toBe(1);
    // Zweimal laden: kein zweiter Platz.
    expect(loadGame(serialize(loaded), 0)!.state.cycle.bonuses).toEqual(loaded.cycle.bonuses);
  });

  it('v12 → v13: kein Platz, wenn Spechte gewählt, das Käferjahr noch wartet oder das Totholz von einem anderen Ereignis stammt', () => {
    // Spechte angelockt: kein Totholz.
    const woodpeckers = stateAt(5, [], 5);
    woodpeckers.cycle.seen = ['beetle-year'];
    expect(loadGame(asV12(woodpeckers), 0)!.state.cycle.bonuses).toEqual([]);
    // Wartet noch in der Warteschlange.
    const waiting = stateAt(5, [], 5);
    waiting.cycle.seen = ['beetle-year'];
    waiting.pendingEncounters = [{ type: 'event', cards: ['beetle-year'], rerolls: 0 }];
    expect(loadGame(asV12(waiting), 0)!.state.cycle.bonuses).toEqual([]);
    // Totholz aus der Sturmnacht (vergibt auch Totholz): nicht eindeutig → nichts nachtragen.
    const storm = stateAt(5, [], 5);
    storm.cycle.seen = ['storm', 'beetle-year'];
    storm.cycle.habitats = ['totholz'];
    const loaded = loadGame(asV12(storm), 0)!.state;
    expect(loaded.cycle.habitats).toEqual(['totholz']);
    expect(loaded.cycle.bonuses.filter((b) => b.source === 'beetle-year')).toEqual([]);
  });

  it('jede Version v2 … v12 lädt ohne Absturz, mit leeren Lebensräumen', () => {
    const base = stateAt(5, ['earthworm', 'robin'], 9);
    base.cycle.care = { 'deadwood-pile': 1 };
    for (let version = 2; version <= 12; version++) {
      const loaded = loadGame(asV12(base, (raw) => (raw.version = version)), 0);
      expect(loaded, `v${version}`).not.toBeNull();
      for (const n of HABITATS) expect(loaded!.state.niches[n], `v${version} ${n}`).toEqual([]);
      expect(loaded!.state.version).toBe(SAVE_VERSION);
    }
  });

  it('Roundtrip v13 mit Bewohnern aller drei Lebensräume', () => {
    const state = stateAt(5, ['cricket', 'kestrel', 'wren', 'weasel', 'sandlizard', 'grasssnake'], 4);
    state.cycle.care = { meadow: 1, 'deadwood-pile': 1, 'drystone-wall': 1 };
    const loaded = deserialize(serialize(state), 0)!;
    expect(loaded.niches.meadow).toEqual(['cricket', 'kestrel']);
    expect(loaded.niches.deadwood).toEqual(['wren', 'weasel']);
    expect(loaded.niches.wall).toEqual(['sandlizard', 'grasssnake']);
    expect(evaluate(loaded)).toEqual(evaluate(state));
  });

  it('robust: kaputte Nischen, fremde Arten, falsche Nische, Duplikate und zu viele Bewohner', () => {
    const state = stateAt(5, [], 4);
    state.cycle.care = { meadow: 1, 'drystone-wall': 1 };
    const raw = JSON.parse(serialize(state));
    raw.niches.meadow = ['cricket', 'cricket', 'gibt-es-nicht', 42, null, 'fieldmouse', 'rabbit', 'lizard'];
    raw.niches.deadwood = 'kein Array';
    raw.niches.wall = [{ id: 'sandlizard' }, 'wren']; // Zaunkönig gehört in den Totholzhaufen (dort 0 Plätze)
    const loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(loaded.niches.meadow).toEqual(['cricket', 'fieldmouse']); // gekürzt auf 2 Plätze
    expect(loaded.niches.deadwood).toEqual([]);
    expect(loaded.niches.wall).toEqual([]);
    // Alle gespeicherten bekannten Arten haben hier gelebt – auch gekürzte bleiben im Tagebuch.
    for (const id of ['cricket', 'fieldmouse', 'rabbit', 'lizard', 'wren']) expect(loaded.meta.journal.species, id).toContain(id);
    // Pflege mit NaN, negativ, unbekannt, zu hoch.
    raw.cycle.care = { meadow: Number.NaN, 'drystone-wall': 99, 'unbekannt': 1, 'deadwood-pile': -3 };
    const careLoaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(careLoaded.cycle.care).toEqual({ 'drystone-wall': 1 }); // Rang 2 erst ab Wald
    expect(careLoaded.niches.meadow).toEqual([]); // ohne Wiese keine Plätze
  });

  it('Neuer Zyklus leert die Lebensräume (Pflege beginnt von vorn)', () => {
    const state = stateAt(5, ['cricket', 'wren', 'sandlizard'], 4);
    state.cycle.care = { meadow: 1, 'deadwood-pile': 1, 'drystone-wall': 1 };
    expect(startNewCycle(state, 1000).ok).toBe(true);
    for (const n of HABITATS) expect(state.niches[n], n).toEqual([]);
    expect(evaluate(state).slots).toMatchObject({ meadow: 0, deadwood: 0, wall: 0 });
  });
});

describe('Schutz für ältere Clients: „Stand ist neuer“ (DESIGN_V2.md 22.8, 23.6)', () => {
  it('ein v12-Client erkennt einen v13-Stand als neuer – beim Abgleich (Schema) und beim Import', () => {
    // Der Abgleich schreibt SAVE_VERSION als Schema mit; ein v12-Spiel blockiert dann.
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: SAVE_VERSION }, 12)).toBe(true);
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: SAVE_VERSION }, SAVE_VERSION)).toBe(false);
    // Ein Code dieser Version mit Massenjahr-IDs und Lebensraum-Arten trägt die aktuelle Version (seit v14: 14).
    const state = stateAt(5, ['cricket'], 4);
    state.cycle.care = { meadow: 1 };
    state.cycle.seen = ['vole-year'];
    const code = exportCode(state);
    const imported = importCode(code, 0);
    expect(imported.ok && imported.result.state.version).toBe(14);
    expect(imported.ok && imported.result.state.cycle.seen).toEqual(['vole-year']);
    expect(imported.ok && imported.result.state.niches.meadow).toEqual(['cricket']);
  });

  it('storedSaveIsNewer: nur ein gespeicherter Stand mit höherer Version (dann weder laden noch überschreiben)', () => {
    const storage = new MemoryStorage();
    expect(storedSaveIsNewer(storage)).toBe(false); // nichts gespeichert
    storage.setItem(SAVE_KEY, serialize(stateAt(1)));
    expect(storedSaveIsNewer(storage)).toBe(false);
    storage.setItem(SAVE_KEY, JSON.stringify({ ...JSON.parse(serialize(stateAt(1))), version: SAVE_VERSION + 1 }));
    expect(storedSaveIsNewer(storage)).toBe(true);
    for (const bad of ['{', '[]', '{"version":"14"}', JSON.stringify({ version: Number.NaN }), JSON.stringify({ version: 12 })]) {
      storage.setItem(SAVE_KEY, bad);
      expect(storedSaveIsNewer(storage), bad).toBe(false);
    }
    // Blockierter Speicher (privater Modus): kein Absturz.
    const broken = { getItem: () => { throw new Error('blockiert'); } } as unknown as Storage;
    expect(storedSaveIsNewer(broken)).toBe(false);
  });
});

describe('Lebensräume im Spiel (DESIGN_V2.md 23.2–23.5)', () => {
  it('Waldwiese: Pflege ab Junger Baum öffnet 2 Plätze; ihre Arten kommen erst dann als Karten', () => {
    const state = rich(3, [], 11);
    const meadowIds = new Set(['cricket', 'fieldmouse', 'rabbit', 'lizard']);
    for (let i = 0; i < 40; i++) expect(drawAnimals(state).some((id) => meadowIds.has(id))).toBe(false);
    expect(buyCare(state, 'meadow').ok).toBe(true);
    expect(state.seeds).toBe(1e6 - 2_400);
    expect(evaluate(state).slots.meadow).toBe(2);
    let seen = false;
    for (let i = 0; i < 60 && !seen; i++) seen = drawAnimals(state).some((id) => meadowIds.has(id));
    expect(seen).toBe(true);
    // Rang 2 erst im Hain.
    expect(buyCare(state, 'meadow').ok).toBe(false);
  });

  it('Trockenmauer ab Hain (+2 Plätze, +2 ☀️), Totholzhaufen ab Alter Baum (Totholz, +2 Plätze)', () => {
    const old = rich(4);
    expect(buyCare(old, 'drystone-wall').ok).toBe(false);
    const light = evaluate(old).light;
    expect(buyCare(old, 'deadwood-pile').ok).toBe(true);
    expect(evaluate(old).slots.deadwood).toBe(2);
    expect(evaluate(old).light).toBe(light);
    const grove = rich(5);
    const before = evaluate(grove).light;
    expect(buyCare(grove, 'drystone-wall').ok).toBe(true);
    expect(evaluate(grove).slots.wall).toBe(2);
    expect(evaluate(grove).light).toBe(before + 2);
  });

  it('Käferjahr „Das Holz vermodern lassen“ öffnet den Totholzhaufen (1 Platz) ohne Pflege', () => {
    const state = rich(5, ['barkbeetle'], 2);
    state.pendingEncounters = [{ type: 'event', cards: ['beetle-year'], rerolls: 0 }];
    state.cycle.seen.push('beetle-year');
    expect(evaluate(state).slots.deadwood).toBe(0);
    expect(chooseEventOption(state, 0, 1).ok).toBe(true);
    expect(evaluate(state).slots.deadwood).toBe(1);
    expect(state.cycle.habitats).toContain('totholz');
    // Mit Pflege dazu: 2 + 1.
    state.cycle.care = { 'deadwood-pile': 1 };
    expect(evaluate(state).slots.deadwood).toBe(3);
  });

  it('Reptilien: Gattungsbonus ab 2 (+8 % 🌰), im Sommer +15 % Zufriedenheit, im Winter kein Abzug', () => {
    const state = stateAt(5, ['lizard', 'sandlizard'], 1);
    state.cycle.care = { meadow: 1, 'drystone-wall': 1 };
    const spring = evaluate(state);
    expect(spring.genusCounts.reptiles).toBe(2);
    expect(spring.traitTiers.reptiles).toBe(1);
    // Ohne Insekten als Futter: Zaunechse 50 %, Waldeidechse 43,75 % (sonnig in jeder Jahreszeit).
    const z = (season?: SeasonId) =>
      evaluateEcosystem({ stage: 5, niches: state.niches, forestMemory: 0, season, extraEffects: slotBonusEffects(state) }).animals;
    expect(z().sandlizard!.happiness).toBeCloseTo(0.5, 12);
    expect(z('summer').sandlizard!.happiness).toBeCloseTo(0.65, 12);
    expect(z('summer').lizard!.happiness).toBeCloseTo(z().lizard!.happiness + 0.15, 12);
    // Winterstarre ohne Abzug, Frühling und Herbst ohne Wirkung.
    for (const season of ['spring', 'autumn', 'winter'] as const) expect(z(season).sandlizard!.happiness, season).toBeCloseTo(0.5, 12);
  });

  it('Fuchs ↔ Kaninchen: der Fuchs frisst Kaninchen und hält ihren Fraß klein; ohne Fuchs sind sie ungejagt', () => {
    const alone = stateAt(4, ['rabbit'], 1);
    alone.cycle.care = { meadow: 1 };
    expect(appearsContext(alone).unhunted.has('hasen')).toBe(true);
    const evAlone = evaluate(alone);
    expect(evAlone.foodWeb.find((f) => f.tag === 'hasen')).toMatchObject({ prey: ['rabbit'], hunters: [], state: 'unhunted' });
    const withFox = stateAt(4, ['rabbit', 'fox'], 1);
    withFox.cycle.care = { meadow: 1 };
    withFox.plants = ['hazel', 'hazel'];
    const ev = evaluate(withFox);
    expect(appearsContext(withFox).unhunted.has('hasen')).toBe(false);
    expect(ev.foodWeb.find((f) => f.tag === 'hasen')).toMatchObject({ prey: ['rabbit'], hunters: ['fox'], state: 'balanced' });
    // Ein Fuchs überjagt ein Kaninchen nie (Futter ≥ 1).
    expect(ev.animals.rabbit!.overhunt).toBe(0);
    expect(ev.animals.fox!.food).toBeGreaterThan(0);
  });

  it('Ringelnatter ↔ Amphibien: satt mit einem Frosch, der nichts verliert; erst eine zweite Natter würde überjagen', () => {
    const state = stateAt(5, ['grasssnake', 'frog'], 1);
    state.cycle.care = { pond: 1, 'drystone-wall': 1 };
    const ev = evaluate(state);
    expect(ev.foodWeb.find((f) => f.tag === 'amphibien')).toMatchObject({ prey: ['frog'], hunters: ['grasssnake'], state: 'balanced' });
    expect(ev.animals.frog!.overhunt).toBe(0);
    expect(ev.animals.grasssnake!.food).toBe(1);
    // Ohne Amphibien hungert sie (kein Futter), ist aber keine Strafe für andere.
    const hungry = stateAt(5, ['grasssnake'], 1);
    hungry.cycle.care = { 'drystone-wall': 1 };
    expect(evaluate(hungry).animals.grasssnake!.food).toBe(0);
  });

  it('Lebensgemeinschaft „Natter am Ufer“: Jäger und Gejagte zusammen bringen +6 ⚖️', () => {
    const state = stateAt(5, ['grasssnake', 'frog', 'newt'], 1);
    state.cycle.care = { pond: 1, 'drystone-wall': 1 };
    expect(evaluate(state).communities.find((c) => c.id === 'snake-pond')).toMatchObject({ active: true, harmony: 6 });
  });

  it('Mäusejahr: auch die Feldmaus ruft Jäger; das Mauswiesel beendet „ungejagt“', () => {
    const mouse = stateAt(4, ['fieldmouse'], 1);
    mouse.cycle.care = { meadow: 1 };
    mouse.cycle.elapsed = 180 + 1; // Sommer
    expect(eligibleEvents(mouse).map((e) => e.id)).toContain('vole-year');
    const hunted = stateAt(4, ['fieldmouse', 'weasel'], 1);
    hunted.cycle.care = { meadow: 1, 'deadwood-pile': 1 };
    hunted.cycle.elapsed = 180 + 1;
    expect(eligibleEvents(hunted).map((e) => e.id)).not.toContain('vole-year');
    // Die Einladung lädt auch das Mauswiesel ein (seine Nische darf noch zu sein).
    mouse.pendingEncounters = [{ type: 'event', cards: ['vole-year'], rerolls: 0 }];
    mouse.cycle.seen.push('vole-year');
    expect(chooseEventOption(mouse, 0, 0).ok).toBe(true);
    expect(mouse.cycle.forced).toEqual({ type: 'animal', ids: ['owl', 'fox', 'weasel'] });
  });

  it('alle 51 Arten zugleich auf jeder Stufe: endliche Werte, Zufriedenheit 0 … 1', () => {
    const all = [...SPECIES_BY_ID.keys()];
    for (let stage = 0; stage < STAGES.length; stage++) {
      const state = stateAt(stage, all, 1);
      state.cycle.care = { meadow: 2, 'deadwood-pile': 2, 'drystone-wall': 2, pond: 2 };
      const ev = evaluate(state);
      for (const n of [ev.growth, ev.seeds, ev.harmony, ev.supply]) expect(Number.isFinite(n), `Stufe ${stage}`).toBe(true);
      for (const a of Object.values(ev.animals)) {
        expect(a.happiness).toBeGreaterThanOrEqual(0);
        expect(a.happiness).toBeLessThanOrEqual(1);
      }
    }
  });
});
