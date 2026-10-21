import { describe, expect, it } from 'vitest';
import { SEASON_SECONDS } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { evaluate, evaluateEcosystem, nicheSlots, slotBonuses } from '../src/core/formulas';
import type { GameState } from '../src/core/state';
import { buyCare, chooseEventOption, drawAnimals, eligibleEvents } from '../src/core/tick';
import { scenePond, toEcosystemView, toSceneAnimals } from '../src/ui/adapters';
import { stateAt } from './helpers';

/**
 * Erweiterung Amphibien mit Waldtümpel (DESIGN_V2.md 5.5): reine Daten – geprüft wird,
 * dass die bestehende Logik (Platz-Wirkungen mit `opensEarly`, Jahreszeit `happiness`,
 * Lebensgemeinschaften, Gattungsboni, Ereignisse) sie so umsetzt wie beschrieben.
 */

/** Alter Baum im Frühling, optional mit Pflege-Rängen „Waldtümpel“ und viel Samen. */
function oldTree(animals: string[] = [], pondRanks = 0, plants: string[] = []): GameState {
  const state = stateAt(4, animals, 7);
  state.plants = [...plants];
  if (pondRanks > 0) state.cycle.care = { pond: pondRanks };
  return state;
}

describe('Waldtümpel (Nische ohne Plätze aus der Stufe)', () => {
  it('bleibt ohne Pflege oder Ereignis auf jeder Stufe zu – Amphibien werden nicht angeboten', () => {
    for (let stage = 0; stage < STAGES.length; stage++) expect(nicheSlots(stage).pond, `Stufe ${stage}`).toBe(0);
    const state = oldTree();
    for (let i = 0; i < 30; i++) {
      const cards = drawAnimals(state);
      expect(cards.some((id) => ['toad', 'frog', 'newt'].includes(id))).toBe(false);
    }
  });

  it('Pflege mit Plätzen: Stammgäste ziehen sofort ein, nicht erst am nächsten Wegpunkt', () => {
    const state = oldTree();
    state.seeds = 1e6;
    state.meta.regulars = ['toad'];
    state.meta.journal.species.push('toad');
    const result = buyCare(state, 'pond');
    expect(result).toMatchObject({ ok: true, regulars: ['toad'] });
    expect(state.niches.pond).toEqual(['toad']);
    // Ohne neue Plätze: kein Feld `regulars`.
    expect(buyCare(state, 'compost')).not.toHaveProperty('regulars');
  });

  it('Regen-Tümpel im Jungen Baum: offen, aber leer – Hinweis, ab wann Bewohner kommen', () => {
    const state = stateAt(3, [], 3);
    state.cycle.seen.push('rain');
    state.cycle.bonuses.push({ source: 'rain', effect: { kind: 'slot', niche: 'pond', amount: 1 } });
    const pond = toEcosystemView(state, evaluate(state)).niches.find((n) => n.id === 'pond')!;
    expect(pond).toMatchObject({ capacity: 1, animals: [], unlockHint: 'Bewohner ab „Alter Baum“' });
    state.stage = 4;
    expect(toEcosystemView(state, evaluate(state)).niches.find((n) => n.id === 'pond')!.unlockHint).toBeUndefined();
  });

  it('Pflege „Waldtümpel“: Rang 1 öffnet 2 Plätze, Rang 2 (Hain) zwei weitere', () => {
    const state = oldTree();
    state.seeds = 1e6;
    expect(buyCare(state, 'pond').ok).toBe(true);
    expect(evaluate(state).slots.pond).toBe(2);
    // Rang 2 erst ab dem Hain.
    expect(buyCare(state, 'pond').ok).toBe(false);
    state.stage = 5;
    expect(buyCare(state, 'pond').ok).toBe(true);
    expect(nicheSlots(state.stage, state.niches, slotBonuses(state)).pond).toBe(4);
  });

  it('Seitenleiste und Szene: Tümpel mit Plätzen und Bewohnern, sonst verschlossen mit Hinweis', () => {
    const closed = oldTree();
    expect(scenePond(evaluate(closed))).toBe(false);
    const closedView = toEcosystemView(closed, evaluate(closed)).niches.find((n) => n.id === 'pond')!;
    expect(closedView).toMatchObject({ label: 'Waldtümpel', capacity: 0, unlockHint: 'öffnet durch Pflege „Waldtümpel“ (ab „Alter Baum“)' });
    // Playtest: Ab „Alter Baum“ führt „Zur Pflege“ direkt zur Maßnahme – davor (Junger Baum) nicht.
    expect(closedView.careLink).toBe('pond');
    const young = stateAt(3, [], 3);
    expect(toEcosystemView(young, evaluate(young)).niches.find((n) => n.id === 'pond')!.careLink).toBeUndefined();
    const open = oldTree(['toad'], 1);
    expect(scenePond(evaluate(open))).toBe(true);
    const view = toEcosystemView(open, evaluate(open));
    expect(view.niches.find((n) => n.id === 'pond')!.careLink).toBeUndefined();
    expect(view.niches.find((n) => n.id === 'pond')).toMatchObject({ capacity: 2, animals: [{ id: 'toad', family: 'amphibians' }] });
    expect(view.families.find((f) => f.id === 'amphibians')).toMatchObject({ icon: '🐸', label: 'Amphibien', count: 1 });
    expect(toSceneAnimals(open, evaluate(open))).toContainEqual(expect.objectContaining({ id: 'toad', niche: 'pond', family: 'amphibians' }));
  });

  it('mit Tümpel kommen Erdkröte, Grasfrosch, Bergmolch und Laubfrosch als Karten, der Kammmolch erst im Hain', () => {
    const state = oldTree([], 1);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) for (const id of drawAnimals(state)) seen.add(id);
    for (const id of ['toad', 'frog', 'newt', 'treefrog']) expect(seen.has(id), id).toBe(true);
    expect(seen.has('crestednewt')).toBe(false);
    state.stage = 5;
    for (let i = 0; i < 300; i++) for (const id of drawAnimals(state)) seen.add(id);
    expect(seen.has('crestednewt')).toBe(true);
  });

  it('Gattungsstufe 5: alle fünf Amphibien mit voller Pflege und einem Ereignis-Platz → +12 % Wachstum', () => {
    const state = oldTree(['toad', 'frog', 'newt', 'treefrog'], 2);
    state.stage = 5;
    expect(evaluate(state).slots.pond).toBe(4);
    expect(evaluate(state).traitTiers.amphibians).toBe(2);
    const four = evaluate(state).growthBonus;
    state.cycle.bonuses.push({ source: 'rain', effect: { kind: 'slot', niche: 'pond', amount: 1 } });
    state.niches.pond.push('crestednewt');
    const five = evaluate(state);
    expect(five.genusCounts.amphibians).toBe(5);
    expect(five.traitTiers.amphibians).toBe(3);
    const z = five.animals.crestednewt!.happiness;
    expect(five.growthBonus).toBeCloseTo(four + 0.12 + 0.06 * z, 9);
  });

  it('Regenreicher Frühling: „Waldtümpel entstehen lassen“ öffnet einen Platz (Zyklus)', () => {
    const state = stateAt(3, [], 3);
    state.pendingEncounters.push({ type: 'event', cards: ['rain'], rerolls: 0 });
    state.cycle.seen.push('rain');
    expect(chooseEventOption(state, 0, 0).ok).toBe(true);
    expect(evaluate(state).slots.pond).toBe(1);
  });
});

describe('Amphibien im Ökosystem', () => {
  it('Feuchte und Schatten machen Erdkröte und Bergmolch zufrieden, der Grasfrosch mag es sonnig', () => {
    const bare = evaluate(oldTree(['toad', 'frog', 'newt'], 2));
    // Tümpel (Pflege) bringt Feuchte; ohne weitere Bäume kein Schatten, aber Sonne.
    expect(bare.animals.toad!.needs).toEqual([true, false]);
    expect(bare.animals.frog!.needs).toEqual([true, true]);
    expect(bare.animals.newt!.needs).toEqual([true, false, false]);
    const shady = evaluate(oldTree(['toad', 'frog', 'newt'], 2, ['beech', 'birch', 'fern']));
    expect(shady.animals.toad!.needs).toEqual([true, true]);
    expect(shady.animals.newt!.needs).toEqual([true, true, true]);
    expect(shady.animals.newt!.happiness).toBeGreaterThan(bare.animals.newt!.happiness);
  });

  it('Erdkröte jagt Schnecken: Nacktschnecke wird gejagt, ihr Fraß sinkt', () => {
    const without = evaluate(oldTree(['slug'], 1));
    const withToad = evaluate(oldTree(['slug', 'toad'], 1));
    expect(withToad.animals.slug!.hunters).toBe(1);
    expect(withToad.damage).toBeLessThan(without.damage);
  });

  it('Gattungsbonus: 2 Amphibien → Schneckenschaden −25 %, 3 → +2 Wasser, +5 % Wachstum', () => {
    const two = evaluate(oldTree(['toad', 'frog'], 2));
    expect(two.genusCounts.amphibians).toBe(2);
    expect(two.traitTiers.amphibians).toBe(1);
    const state = oldTree(['toad', 'frog'], 2);
    state.stage = 5;
    state.cycle.care = { pond: 2 };
    state.niches.pond.push('newt');
    const three = evaluate(state);
    expect(three.traitTiers.amphibians).toBe(2);

    // Wirkung Stufe 1: Schneckenschaden −25 % (nach der Jagd der Kröte, multiplikativ).
    const slugs = evaluate(oldTree(['toad', 'frog', 'slug'], 2));
    expect(slugs.traitTiers.amphibians).toBe(1);
    const zToad = slugs.animals.toad!.happiness;
    expect(slugs.damage).toBeCloseTo(0.06 * (1 - 0.4 * zToad) * (1 - 0.25), 9);
    // Wirkung Stufe 2: +2 Wasser und +5 % Wachstum (Pflege Tümpel 2 Ränge: +3 +3 💧;
    // Frühling +10 % 🌿; Kröte +4 %, Molch +5 % mal Zufriedenheit).
    expect(three.water).toBeCloseTo(STAGES[5]!.water + 3 + 3 + 2, 9);
    const z = three.animals;
    expect(three.growthBonus).toBeCloseTo(0.1 + 0.04 * z.toad!.happiness + 0.05 * z.newt!.happiness + 0.05, 9);
    // Ohne den dritten Amphib (nur Stufe 1) fehlen genau diese +2 Wasser.
    const twoAtGrove = oldTree(['toad', 'frog'], 2);
    twoAtGrove.stage = 5;
    expect(evaluate(twoAtGrove).water).toBeCloseTo(STAGES[5]!.water + 3 + 3, 9);
  });

  it('Frühling (Laichzeit): Amphibien +15 % Zufriedenheit, im Sommer nicht', () => {
    const spring = oldTree(['toad'], 1);
    spring.cycle.elapsed = 0;
    const summer = oldTree(['toad'], 1);
    summer.cycle.elapsed = SEASON_SECONDS;
    const zSpring = evaluate(spring).animals.toad!.happiness;
    const zSummer = evaluate(summer).animals.toad!.happiness;
    expect(zSpring - zSummer).toBeCloseTo(0.15, 9);
  });

  it('Lebensgemeinschaften: Tümpelleben (+6 ⚖️, +2 💧) und Schneckenwacht (+6 ⚖️)', () => {
    const niches = { roots: [], litter: ['hedgehog'], edge: [], crown: [], bark: [], hollows: [], pond: ['toad', 'newt'] };
    const ev = evaluateEcosystem({ stage: 4, niches, plants: ['fern'], forestMemory: 0 });
    const pond = ev.communities.find((c) => c.id === 'pond-life')!;
    expect(pond).toMatchObject({ active: true, harmony: 6 });
    const watch = ev.communities.find((c) => c.id === 'slug-watch')!;
    expect(watch).toMatchObject({ active: false, missing: [['glowworm', 'salamander']] });
    const without = evaluateEcosystem({ stage: 4, niches, plants: ['moss'], forestMemory: 0 });
    expect(without.communities.find((c) => c.id === 'pond-life')!.missing).toEqual([['fern', 'hartstongue']]);
    // +2 💧 aus der Gemeinschaft (Farn braucht 2, Moos speichert 2 – Unterschied 4 ohne Gemeinschaft).
    expect(ev.water - without.water).toBe(2);
  });

  it('Krötenwanderung: nur im Frühling und nur, wenn die Erdkröte lebt', () => {
    const withToad = oldTree(['toad'], 1);
    withToad.cycle.elapsed = 0;
    expect(eligibleEvents(withToad).map((e) => e.id)).toContain('toad-migration');
    withToad.cycle.elapsed = SEASON_SECONDS;
    expect(eligibleEvents(withToad).map((e) => e.id)).not.toContain('toad-migration');
    const noToad = oldTree([], 1);
    expect(eligibleEvents(noToad).map((e) => e.id)).not.toContain('toad-migration');
  });

  it('Krötenwanderung „Laichplätze schaffen“: +1 Platz und die nächste Begegnung bietet Amphibien an', () => {
    const state = oldTree(['toad'], 1);
    state.pendingEncounters.push({ type: 'event', cards: ['toad-migration'], rerolls: 0 });
    state.cycle.seen.push('toad-migration');
    expect(chooseEventOption(state, 0, 1).ok).toBe(true);
    expect(evaluate(state).slots.pond).toBe(3);
    expect(state.cycle.forced).toMatchObject({ type: 'animal', ids: ['frog', 'newt', 'treefrog', 'crestednewt'] });
  });
});
