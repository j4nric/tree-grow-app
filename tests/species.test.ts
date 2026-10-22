import { describe, expect, it } from 'vitest';
import { RARITY_WEIGHTS } from '../src/content/encounters';
import { SPECIES, SPECIES_BY_ID } from '../src/content/species';
import {
  DISTURB_PENALTY,
  appearsContext,
  evaluate,
  evaluateEcosystem,
  nicheSlots,
  rarityWeights,
  speciesAppears,
} from '../src/core/formulas';
import { chooseCard, drawAnimals } from '../src/core/tick';
import { stateAt } from './helpers';

/**
 * Schritt 2.2: alle 5 Gattungen und 32 Arten – neue Wünsche (schattig, bestimmte Art,
 * Gattung), Störung, Harmonie-Wirkungen, Fähigkeiten, Erscheinungsbedingungen und
 * Seltenheitsgewichte (DESIGN_V2.md 2.3, 5, 7.3).
 */

/** Stand auf Stufe `stage` mit Tieren und Begleitpflanzen (Plätze werden nicht geprüft). */
function eco(stage: number, animals: string[], plants: string[] = []) {
  const state = stateAt(stage, animals);
  state.plants = plants;
  return state;
}

describe('neue Wünsche', () => {
  it('schattig: ab 3 Bäumen inkl. Hauptbaum (Pfifferling)', () => {
    const one = evaluate(eco(4, ['chanterelle'], ['beech']));
    expect(one.shady).toBe(false);
    expect(one.animals.chanterelle!.needs).toEqual([false, false]); // Feuchte, schattig
    const two = evaluate(eco(4, ['chanterelle'], ['beech', 'beech', 'moss']));
    expect(two.shady).toBe(true);
    expect(two.animals.chanterelle!.needs).toEqual([true, true]);
    expect(two.animals.chanterelle!.happiness).toBe(1);
  });

  it('bestimmte Art: auch eine Pflanze erfüllt den Wunsch (Tagpfauenauge braucht Brennnessel)', () => {
    expect(evaluate(eco(3, ['peacock'])).animals.peacock!.needs[0]).toBe(false);
    expect(evaluate(eco(3, ['peacock'], ['nettle'])).animals.peacock!.needs[0]).toBe(true);
    // Schwarzspecht wünscht sich die Rote Waldameise (ein Tier).
    expect(evaluate(eco(5, ['blackwoodpecker', 'woodant'])).animals.blackwoodpecker!.needs[0]).toBe(true);
  });

  it('Gattung: Steinpilz braucht 1× Bodenleben', () => {
    expect(evaluate(eco(3, ['porcini'])).animals.porcini!.needs).toEqual([false, false]);
    expect(evaluate(eco(3, ['porcini', 'earthworm'], ['birch'])).animals.porcini!.needs).toEqual([true, true]);
  });
});

describe('Hirschkäfer: schattig und sonnig zugleich (lichter Altwald)', () => {
  it('ist voll zufrieden erreichbar: 3 Bäume, genug Licht frei, ein Pilz, Totholz', () => {
    // Hain: Licht 9. Rotbuche + Waldkiefer brauchen 6 → 3 frei (sonnig), 3 Bäume (schattig).
    const state = eco(5, ['stagbeetle', 'tinder'], ['beech', 'pine']);
    const ev = evaluate(state);
    expect(ev.shady).toBe(true);
    expect(ev.sunny).toBe(true);
    expect(ev.animals.stagbeetle!.needs).toEqual([true, true, true]);
    expect(ev.animals.stagbeetle!.food).toBe(1); // Totholz vom Zunderschwamm
    expect(ev.animals.stagbeetle!.happiness).toBe(1);
  });

  it('wird angeboten, sobald Totholz da ist', () => {
    const state = eco(5, ['tinder'], ['beech', 'pine']);
    expect(speciesAppears(state, SPECIES_BY_ID.get('stagbeetle')!)).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) for (const id of drawAnimals(state)) seen.add(id);
    expect(seen.has('stagbeetle')).toBe(true);
  });
});

describe('Störung und Harmonie-Wirkungen', () => {
  it('Eichhörnchen und Eichelhäher stören die Blaumeise (je −0,15)', () => {
    const alone = evaluate(eco(4, ['bluetit'])).animals.bluetit!;
    const one = evaluate(eco(4, ['bluetit', 'squirrel'])).animals.bluetit!;
    const two = evaluate(eco(4, ['bluetit', 'squirrel', 'jay'])).animals.bluetit!;
    expect(one.disturbers).toBe(1);
    expect(two.disturbers).toBe(2);
    expect(one.happiness).toBeCloseTo(alone.happiness - DISTURB_PENALTY, 12);
    expect(two.happiness).toBeCloseTo(Math.max(0, alone.happiness - 2 * DISTURB_PENALTY), 12);
    // Wer stört, ist selbst nicht gestört.
    expect(evaluate(eco(4, ['bluetit', 'squirrel'])).animals.squirrel!.disturbers).toBe(0);
  });

  it('Harmonie-Wirkung wird mit der Zufriedenheit skaliert (Glühwürmchen +4 ⚖️)', () => {
    const without = evaluate(eco(4, []));
    const ev = evaluate(eco(4, ['glowworm']));
    const z = ev.animals.glowworm!.happiness;
    expect(z).toBeGreaterThan(0);
    expect(ev.breakdown.extra).toBeCloseTo(4 * z, 12);
    expect(without.breakdown.extra).toBe(0);
    expect(ev.harmony).toBeCloseTo(ev.breakdown.variety + ev.breakdown.happiness + ev.breakdown.pyramid + ev.breakdown.extra, 9);
  });
});

describe('Fähigkeiten', () => {
  it('Nachtflieger: Braunes Langohr zählt auch als Vogel (Gattungsbonus)', () => {
    const ev = evaluate(eco(4, ['bat', 'robin']));
    expect(ev.genusCounts.birds).toBe(2);
    expect(ev.genusCounts.mammals).toBe(1);
    expect(ev.traitTiers.birds).toBe(1);
    expect(ev.abilities).toEqual(['countsAsBird']);
    // Vielfalt zählt die Gattung des Langohrs nur einmal (Säugetiere).
    expect(evaluate(eco(4, ['bat'])).breakdown.variety).toBe(3 + 1);
  });

  it('König des Totholzes: Zersetzer & Partner +0,2 Zufriedenheit', () => {
    // Regenwurm ohne Feuchte: 0,25 + 0,75 · 2/3 = 0,75 → mit Hirschkäfer 0,95
    expect(evaluate(eco(5, ['earthworm'])).animals.earthworm!.happiness).toBeCloseTo(0.75, 12);
    expect(evaluate(eco(5, ['earthworm', 'stagbeetle'])).animals.earthworm!.happiness).toBeCloseTo(0.95, 12);
    // Pflanzenfresser profitieren nicht.
    const vole = evaluate(eco(5, ['vole'])).animals.vole!.happiness;
    expect(evaluate(eco(5, ['vole', 'stagbeetle'])).animals.vole!.happiness).toBe(vole);
  });

  it('Baumeister: +1 Platz Krone und Höhlen, Höhlenbewohner +0,2', () => {
    const base = nicheSlots(5);
    const slots = nicheSlots(5, eco(5, ['blackwoodpecker']).niches);
    expect(slots.crown).toBe(base.crown + 1);
    expect(slots.hollows).toBe(base.hollows + 1);
    expect(slots.bark).toBe(base.bark);
    // Waldkauz ohne Futter und Bäume: 0,05 → mit Baumeister 0,25
    expect(evaluate(eco(5, ['owl'])).animals.owl!.happiness).toBeCloseTo(0.05, 12);
    expect(evaluate(eco(5, ['owl', 'blackwoodpecker'])).animals.owl!.happiness).toBeCloseTo(0.25, 12);
    // Krone bleibt vor dem Jungen Baum geschlossen; Höhlen öffnen früh (wie beim Borkenkäfer).
    const early = nicheSlots(2, eco(2, ['blackwoodpecker']).niches);
    expect(early.crown).toBe(0);
    expect(early.hollows).toBe(1);
  });

  it('Gelassen: Weinbergschnecke nie unter 50 % Zufriedenheit', () => {
    const hunted = evaluate(eco(5, ['snail', 'hedgehog', 'glowworm'])).animals.snail!;
    expect(hunted.hunters).toBe(2);
    expect(hunted.happiness).toBe(0.5);
    // Andere Arten werden nicht angehoben.
    expect(evaluate(eco(5, ['slug', 'hedgehog', 'glowworm'])).animals.slug!.happiness).toBeLessThan(0.5);
  });

  it('Nachtwache: Schaden aller Pflanzenfresser −20 %', () => {
    expect(evaluate(eco(4, ['oakmoth'])).damage).toBeCloseTo(0.1, 12);
    expect(evaluate(eco(4, ['oakmoth', 'owl'])).damage).toBeCloseTo(0.08, 12);
    // Zersetzer mit Fraß (Zunderschwamm) bleiben unberührt.
    expect(evaluate(eco(4, ['tinder', 'owl'])).damage).toBeCloseTo(0.03, 12);
  });

  it('Landschaft der Angst: Reh frisst nicht mehr und lichtet doppelt', () => {
    const deer = evaluate(eco(6, ['deer']));
    expect(deer.damage).toBeCloseTo(0.1, 12);
    expect(deer.unguarded).toBe(1);
    const both = evaluate(eco(6, ['deer', 'wolf']));
    const z = both.animals.deer!.happiness;
    expect(both.damage).toBe(0);
    expect(both.unguarded).toBe(0);
    expect(both.light).toBeCloseTo(12 + 2 * 3 * z, 12);
    expect(both.animals.deer!.hunters).toBe(1); // der Wolf jagt das Reh
  });

  it('Hüter der Feuchte: Moose & Farne brauchen kein Wasser (Moos speichert weiter)', () => {
    const dry = evaluate(eco(5, [], ['fern', 'fern', 'fern', 'fern', 'fern']));
    expect(dry.waterNeed).toBe(10);
    expect(dry.supply).toBeCloseTo(9 / 10, 12);
    const wet = evaluate(eco(5, ['salamander'], ['fern', 'fern', 'fern', 'fern', 'fern', 'moss', 'birch']));
    expect(wet.waterNeed).toBe(-2 + 2); // Moos −2, Birke +2, Farne 0
    expect(wet.supply).toBe(1);
  });

  it('Waldweites Netz: Versorgung mindestens 90 %, nie über 100 %', () => {
    const plants = ['birch', 'birch', 'birch'];
    expect(evaluate(eco(3, [], plants)).supply).toBeCloseTo(5 / 12, 12);
    expect(evaluate(eco(3, ['honeyfungus'], plants)).supply).toBe(0.9);
    expect(evaluate(eco(3, ['honeyfungus'], ['anemone'])).supply).toBe(1);
    // Auch auf Stufe 0 ohne Licht (Versorgung 0) greift das Netz.
    expect(evaluate(eco(0, ['honeyfungus'], ['birch'])).supply).toBe(0.9);
  });

  it('Fähigkeiten wirken unabhängig von der Zufriedenheit und je einmal', () => {
    // Hallimasch ohne jede erfüllte Bedingung (legendär: Grundzufriedenheit 0).
    const ev = evaluate(eco(3, ['honeyfungus'], ['birch', 'birch', 'birch']));
    expect(ev.animals.honeyfungus!.happiness).toBeLessThan(1);
    expect(ev.supply).toBe(0.9);
    expect(ev.abilities).toEqual(['minSupply']);
  });

  it('übersteht Grenzfälle: alle 51 Arten auf jeder Stufe, mit und ohne Pflanzen', () => {
    const all = SPECIES.map((s) => s.id);
    for (let stage = -1; stage <= 9; stage++) {
      for (const plants of [[], ['moss', 'birch', 'nettle', 'hazel', 'fern']]) {
        const ev = evaluateEcosystem({ stage, niches: eco(1, all).niches, plants, forestMemory: 0 });
        for (const n of [ev.growth, ev.seeds, ev.harmony, ev.supply, ev.avgHappiness, ev.light, ev.water]) {
          expect(Number.isFinite(n), `Stufe ${stage}`).toBe(true);
        }
        expect(ev.supply).toBeGreaterThanOrEqual(0.9);
        expect(ev.abilities).toHaveLength(10);
        for (const s of Object.values(ev.animals)) {
          expect(s.happiness).toBeGreaterThanOrEqual(0);
          expect(s.happiness).toBeLessThanOrEqual(1);
        }
        // Alle Arten zusammen: jede Gattung auf der höchsten Stufe (Amphibien seit dem Playtest mit 5 Arten,
        // Reptilien mit 5 Arten der Lebensräume).
        expect(ev.traitTiers).toEqual({ birds: 3, insects: 3, mammals: 3, soil: 3, fungi: 3, amphibians: 3, reptiles: 3 });
      }
    }
  });
});

describe('Erscheinungsbedingungen', () => {
  const appears = (id: string, stage: number, animals: string[], plants: string[] = []) =>
    speciesAppears(eco(stage, animals, plants), SPECIES_BY_ID.get(id)!);

  it('gewöhnliche und seltene Arten erscheinen immer', () => {
    for (const s of SPECIES.filter((x) => x.rarity < 2)) expect(speciesAppears(eco(0, []), s), s.id).toBe(true);
  });

  it('Waldkauz braucht Kleinsäuger, Wolf das Reh, Schwarzspecht den Buntspecht', () => {
    expect(appears('owl', 4, [])).toBe(false);
    expect(appears('owl', 4, ['vole'])).toBe(true);
    expect(appears('wolf', 6, ['fox'])).toBe(false);
    expect(appears('wolf', 6, ['deer'])).toBe(true);
    expect(appears('blackwoodpecker', 5, ['woodant'])).toBe(false);
    expect(appears('blackwoodpecker', 5, ['woodpecker'])).toBe(true);
  });

  it('Merkmale kommen von Hauptbaum, Pflanzen und Tieren', () => {
    expect(appears('snail', 4, [])).toBe(false);
    expect(appears('snail', 4, [], ['moss'])).toBe(true); // Feuchte aus dem Moos
    expect(appears('glowworm', 4, ['slug'])).toBe(true); // Schnecken aus der Nacktschnecke
    expect(appears('stagbeetle', 5, ['barkbeetle'])).toBe(true); // Totholz
    expect(appears('stagbeetle', 5, [])).toBe(false);
  });

  it('Pflanzengruppen und Pflanzen: Feuersalamander, Fliegenpilz', () => {
    expect(appears('salamander', 5, ['tinder'], ['moss'])).toBe(false);
    expect(appears('salamander', 5, ['tinder'], ['moss', 'fern'])).toBe(true);
    expect(appears('flyagaric', 4, [], ['beech'])).toBe(false);
    expect(appears('flyagaric', 4, [], ['birch'])).toBe(true);
  });

  it('Gattungen zählen ohne Fähigkeiten (Hallimasch, Braunes Langohr)', () => {
    expect(appears('honeyfungus', 5, ['chanterelle', 'barkbeetle'])).toBe(false);
    expect(appears('honeyfungus', 5, ['chanterelle', 'porcini', 'barkbeetle'])).toBe(true);
    expect(appears('bat', 4, ['oakmoth'])).toBe(false);
    expect(appears('bat', 4, ['oakmoth', 'bee'])).toBe(true);
  });

  it('Tierkarten: Arten ohne erfüllte Erscheinungsbedingung werden nie gezogen', () => {
    const state = eco(7, []);
    for (let i = 0; i < 300; i++) {
      for (const id of drawAnimals(state)) expect(SPECIES_BY_ID.get(id)!.rarity, id).toBeLessThan(2);
    }
    // Mit Wühlmaus kann der Waldkauz kommen.
    const withVole = eco(7, ['vole']);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) for (const id of drawAnimals(withVole)) seen.add(id);
    expect(seen.has('owl')).toBe(true);
    expect(seen.has('vole')).toBe(false);
  });
});

describe('Erscheinungsbedingung gilt nur fürs Anbieten', () => {
  it('eine offene Karte bleibt wählbar, auch wenn die Bedingung inzwischen fehlt', () => {
    // Waldkauz wurde angeboten, als die Wühlmaus noch lebte – jetzt ist sie weg.
    const state = eco(4, []);
    state.pendingEncounters.push({ type: 'animal', cards: ['owl'], rerolls: 0 });
    expect(speciesAppears(state, SPECIES_BY_ID.get('owl')!)).toBe(false);
    expect(chooseCard(state, 0, 0)).toEqual({ ok: true });
    expect(state.niches.hollows).toEqual(['owl']);
  });

  it('appearsContext einmal berechnen gibt dasselbe wie die Einzelprüfung', () => {
    const state = eco(6, ['vole', 'deer', 'barkbeetle', 'oakmoth', 'bee', 'chanterelle'], ['birch', 'moss', 'fern']);
    const ctx = appearsContext(state);
    for (const sp of SPECIES) expect(speciesAppears(ctx, sp), sp.id).toBe(speciesAppears(state, sp));
  });
});

describe('Seltenheitsgewichte', () => {
  it('je Stufe aus der Tabelle, ungültige Stufen begrenzt', () => {
    for (let s = 0; s < RARITY_WEIGHTS.length; s++) expect(rarityWeights(eco(s, []))).toEqual([...RARITY_WEIGHTS[s]!]);
    const empty = eco(0, []).niches;
    expect(rarityWeights({ stage: 99, niches: empty })).toEqual([...RARITY_WEIGHTS[RARITY_WEIGHTS.length - 1]!]);
    expect(rarityWeights({ stage: -3, niches: empty })).toEqual([...RARITY_WEIGHTS[0]!]);
    expect(rarityWeights({ stage: NaN, niches: empty })).toEqual([...RARITY_WEIGHTS[0]!]);
  });

  it('Glückspilz: selten/besonders/legendär +5, gewöhnlich −15', () => {
    expect(rarityWeights(eco(4, ['flyagaric']))).toEqual([45, 33, 15, 7]);
    expect(rarityWeights(eco(7, ['flyagaric']))).toEqual([25, 35, 25, 15]);
    // Nie negativ – auch wenn die Tabelle wenig Gewöhnliche hätte.
    for (let s = 0; s < RARITY_WEIGHTS.length; s++) {
      for (const w of rarityWeights(eco(s, ['flyagaric']))) expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  it('Seltene Arten kommen mit dem Glückspilz häufiger', () => {
    const count = (animals: string[]) => {
      const state = eco(5, animals, ['moss', 'birch']);
      let rare = 0;
      for (let i = 0; i < 2000; i++) rare += drawAnimals(state).filter((id) => SPECIES_BY_ID.get(id)!.rarity > 0).length;
      return rare;
    };
    expect(count(['flyagaric'])).toBeGreaterThan(count(['chanterelle']));
  });
});
