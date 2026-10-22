import { describe, expect, it } from 'vitest';
import { EVENTS, EVENTS_BY_ID } from '../src/content/events';
import { OVERHUNT_MAX_UNITS, OVERHUNT_PENALTY, PREDATION_EVENTS, STOCK_BASE, STOCK_HIGH, STOCK_LOW, STOCK_RANGE } from '../src/content/predation';
import { SPECIES, TAG_NAMES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { evaluate } from '../src/core/formulas';
import { conditionName, toEcosystemView, toEncounterView, toEventView } from '../src/ui/adapters';
import { toAnimalDetailView } from '../src/ui/animal-detail-view';
import {
  FOOD_WEB_EMPTY,
  PREY_ICON_TAGS,
  animalStock,
  foodWebSummary,
  foodWebView,
  huntFoodText,
  overhuntHint,
  stockLevel,
  stockView,
  unhuntedHint,
} from '../src/ui/food-web-view';
import { formatNumber } from '../src/ui/format';
import { guideSections } from '../src/ui/guide-view';
import { stateAt } from './helpers';

/** Alter Baum (ab hier gibt es Massenjahre). */
const OLD_TREE = Math.min(...PREDATION_EVENTS.map((e) => e.minStage));

describe('Räuber und Beute: Bestand in Worten', () => {
  it('Schwellen aus content: knapp < STOCK_LOW ≤ gut < STOCK_HIGH ≤ reichlich', () => {
    expect(stockLevel(STOCK_BASE)).toBe('low');
    expect(stockLevel(STOCK_LOW - 0.001)).toBe('low');
    expect(stockLevel(STOCK_LOW)).toBe('good');
    expect(stockLevel(STOCK_HIGH - 0.001)).toBe('good');
    expect(stockLevel(STOCK_HIGH)).toBe('high');
    expect(stockLevel(STOCK_BASE + STOCK_RANGE)).toBe('high');
    expect(stockLevel(Number.NaN)).toBe('low');
    expect(stockView(1.5)).toEqual({ level: 'high', label: 'reichlich' });
    expect(stockView(1)).toEqual({ level: 'good', label: 'gut' });
    expect(stockView(0.6)).toEqual({ level: 'low', label: 'knapp' });
  });

  it('jedes Beute-Merkmal (Räuber fressen es oder halten es klein) hat ein eigenes Symbol', () => {
    const prey = (Object.keys(TAG_NAMES) as (keyof typeof TAG_NAMES)[]).filter((t) =>
      SPECIES.some((s) => (s.level === 'predator' && s.food.includes(t)) || s.effects.some((e) => e.kind === 'control' && e.tag === t)),
    );
    for (const tag of prey) expect(PREY_ICON_TAGS, tag).toContain(tag);
  });
});

describe('Nahrungsnetz der Übersicht', () => {
  it('eine Zeile je Eintrag des Kerns, Zustand und Namen aus der Auswertung', () => {
    const state = stateAt(OLD_TREE, ['vole', 'owl', 'fox', 'earthworm', 'hedgehog']);
    const ev = evaluate(state);
    const view = foodWebView(ev, state);
    expect(view.rows.map((r) => r.tag)).toEqual(ev.foodWeb.map((e) => e.tag));
    expect(view.rows.map((r) => r.state)).toEqual(ev.foodWeb.map((e) => e.state));
    const mice = view.rows.find((r) => r.tag === 'kleinsaeuger')!;
    expect(mice).toMatchObject({ icon: '🐭', name: 'Kleinsäuger', prey: 'Wühlmaus', hunterCount: 2 });
    expect(mice.hunters.split(' und ').sort()).toEqual(['Rotfuchs', 'Waldkauz']);
    expect([...mice.hunterIds!].sort()).toEqual(['fox', 'owl']);
    // Zwei Jäger, eine Wühlmaus (Bestand ≤ 1,5) → überjagt, mit freundlichem Hinweis.
    expect(mice.state).toBe('overhunted');
    expect(mice.stateLabel).toBe('überjagt');
    // Bestand am Maximum: Zwei Jäger brauchen mehr, als eine Wühlmaus je bieten kann (1,5) –
    // zufriedenere Beute hilft nicht, nur eine weitere Art.
    expect(mice.hint).toBe('Mehr Jäger als Futter – eine weitere Art, die Kleinsäuger bietet, hilft.');
    expect(mice.stock).toEqual(stockView(ev.animals.vole!.stock!));
    // Würmer: der Igel frisst sie → im Gleichgewicht.
    const worms = view.rows.find((r) => r.tag === 'wuermer')!;
    expect(worms).toMatchObject({ state: 'balanced', stateLabel: 'im Gleichgewicht', hunters: 'Igel', prey: 'Regenwurm' });
    expect(worms.hint).toContain('Die Jäger werden satt');
    // Kurzfassung: überjagt zuerst, ohne Zahlenwust.
    expect(view.summary).toBe(foodWebSummary(ev.foodWeb));
    expect(view.summary).toMatch(/^1 überjagt · \d+ im Gleichgewicht$/);
  });

  it('Überjagung: „zufriedenere Beute“ nur, solange der Bestand noch wachsen kann', () => {
    const max = STOCK_BASE + STOCK_RANGE;
    const base = { tag: 'kleinsaeuger' as const, prey: ['vole'] };
    // Bestand kann noch wachsen und reichte dann für alle Jäger.
    expect(overhuntHint({ ...base, hunters: ['owl'], stock: 0.6 })).toBe(
      'Mehr Jäger als Futter – zufriedenere Beute oder eine weitere Art, die Kleinsäuger bietet, hilft.',
    );
    // Bestand schon am Maximum.
    expect(overhuntHint({ ...base, hunters: ['owl'], stock: max })).toBe('Mehr Jäger als Futter – eine weitere Art, die Kleinsäuger bietet, hilft.');
    // Mehr Jäger, als die Beute rundum zufrieden ernähren könnte.
    expect(overhuntHint({ ...base, hunters: ['owl', 'fox'], stock: 0.6 })).toBe('Mehr Jäger als Futter – eine weitere Art, die Kleinsäuger bietet, hilft.');
  });

  it('Arten, die sich selbst fressen (Rote Waldameise): „frisst Artgenossen“, kein Jäger von außen', () => {
    const state = stateAt(OLD_TREE, ['woodant']);
    const ev = evaluate(state);
    const insects = foodWebView(ev, state).rows.find((r) => r.tag === 'insekten')!;
    expect(insects.prey).toBe('Rote Waldameise');
    expect(insects.hunters).toBe('Rote Waldameise (frisst Artgenossen)');
    expect(insects.state).toBe('balanced');
    expect(insects.hint).toBe('Nur Artgenossen fressen hier – kein Nachteil, ein weiterer Jäger fände Futter.');
    const detail = toAnimalDetailView(state, 'woodant', ev)!;
    expect(detail.predation.find((p) => p.key === 'prey-insekten')!.label).toBe('Insekten: nur von ihr selbst gefressen');
    expect(detail.predation.find((p) => p.key === 'hunt-insekten')!.hint).toBe('Frisst Artgenossen – im Gleichgewicht.');
    // Mit anderer Beute bleibt sie Jägerin – gekennzeichnet, und die Beute nennt sie.
    const mixed = stateAt(OLD_TREE, ['woodant', 'bee']);
    const mixedEv = evaluate(mixed);
    const row = foodWebView(mixedEv, mixed).rows.find((r) => r.tag === 'insekten')!;
    expect(row.hunters).toBe('Rote Waldameise (frisst Artgenossen)');
    expect(toAnimalDetailView(mixed, 'bee', mixedEv)!.predation.find((p) => p.key === 'prey-insekten')!.label).toBe(
      'Insekten: ernährt Rote Waldameise',
    );
  });

  it('ohne Beute: leere Liste mit Erklärung', () => {
    const state = stateAt(OLD_TREE, ['owl']);
    const view = foodWebView(evaluate(state), state);
    expect(view.rows).toEqual([]);
    expect(view.summary).toBe('noch keine Beute');
    expect(view.emptyText).toBe(FOOD_WEB_EMPTY);
  });

  it('ungejagt: Hinweis auf das passende Massenjahr – mit Jahreszeit, Stufe oder „war schon“', () => {
    const state = stateAt(OLD_TREE, ['oakmoth']);
    const ev = evaluate(state);
    const raupen = foodWebView(ev, state).rows.find((r) => r.tag === 'raupen')!;
    expect(raupen.state).toBe('unhunted');
    expect(raupen.stateLabel).toBe('ungejagt');
    expect(raupen.hunters).toBe('');
    expect(raupen.hint).toBe('Ein Raupenjahr (Frühling oder Sommer) kann Jäger einladen – oder du nimmst es als Geschenk.');
    // Vor dem Alten Baum: ab wann es kommen kann.
    const young = stateAt(OLD_TREE - 1, ['oakmoth']);
    expect(unhuntedHint('raupen', young)).toBe(`Ab „${STAGES[OLD_TREE]!.name}“ kann ein Raupenjahr Jäger einladen.`);
    // Schon gewesen in diesem Zyklus.
    state.cycle.seen.push('caterpillar-year');
    expect(unhuntedHint('raupen', state)).toBe('Das Raupenjahr war schon – ein Jäger fände hier Futter.');
    // Gezogen, aber noch im Stapel (steht schon in `seen`): Die Wahl ist noch offen.
    state.pendingEncounters = [{ type: 'event', cards: ['caterpillar-year'], rerolls: 0 }];
    expect(unhuntedHint('raupen', state)).toBe('Das Raupenjahr wartet unter deinen Begegnungen – dort kannst du Jäger einladen.');
    expect(foodWebView(evaluate(state), state).rows.find((r) => r.tag === 'raupen')!.hint).toBe(unhuntedHint('raupen', state));
    // Ein anderes wartendes Ereignis ändert nichts.
    state.pendingEncounters = [{ type: 'event', cards: ['vole-year'], rerolls: 0 }];
    expect(unhuntedHint('raupen', state)).toBe('Das Raupenjahr war schon – ein Jäger fände hier Futter.');
    state.pendingEncounters = [];
    // Merkmal ohne Massenjahr: kein Nachteil.
    expect(unhuntedHint('wuermer', state)).toBe('Kein Nachteil – ein Jäger fände hier Futter.');
  });

  it('Massenjahre der Hinweise sind die Ereignisse mit Bedingung „ungejagt“ aus content', () => {
    for (const e of PREDATION_EVENTS) {
      const cond = e.appears!.find((c) => c.kind === 'unhunted')!;
      const tag = cond.kind === 'unhunted' ? cond.tag : 'raupen';
      expect(EVENTS.filter((x) => x.appears?.some((c) => c.kind === 'unhunted' && c.tag === tag)).map((x) => x.id)).toEqual([e.id]);
      expect(unhuntedHint(tag, { stage: e.minStage, cycle: stateAt(e.minStage).cycle })).toContain(e.name);
    }
  });

  it('Arten, die nur klein halten, stehen getrennt von den Jägern', () => {
    const state = stateAt(OLD_TREE, ['oakmoth', 'woodant']);
    const raupen = foodWebView(evaluate(state), state).rows.find((r) => r.tag === 'raupen')!;
    expect(raupen.controllers).toBe('Rote Waldameise');
    expect(raupen.hunters).toBe('');
    expect(raupen.state).toBe('balanced');
    expect(raupen.hint).toBe('Wird klein gehalten, ohne gejagt zu werden.');
  });

  it('Spoiler-Regel: Unentdeckte heißen „???“', () => {
    const state = stateAt(OLD_TREE, ['vole', 'owl']);
    state.meta.journal.species = state.meta.journal.species.filter((id) => id !== 'owl');
    const mice = foodWebView(evaluate(state), state).rows.find((r) => r.tag === 'kleinsaeuger')!;
    expect(mice.hunters).toBe('???');
    expect(mice.prey).toBe('Wühlmaus');
    // Kein Sticker für unentdeckte Jäger (Album, U:Nahrungsnetz).
    expect(mice.hunterIds).toEqual([]);
  });

  it('steht in der Ökosystem-Übersicht', () => {
    const state = stateAt(OLD_TREE, ['vole', 'owl']);
    const ev = evaluate(state);
    expect(toEcosystemView(state, ev).foodWeb).toEqual(foodWebView(ev, state));
  });
});

describe('Bestand an Kacheln und Karten', () => {
  it('Kachel: nur Beute zeigt ihren Bestand (nicht Totholz-Lieferanten oder Jäger)', () => {
    const state = stateAt(OLD_TREE, ['vole', 'owl', 'tinder']);
    const ev = evaluate(state);
    const animals = toEcosystemView(state, ev).niches.flatMap((n) => n.animals);
    expect(animals.find((a) => a.id === 'vole')!.stock).toEqual(stockView(ev.animals.vole!.stock!));
    expect(animals.find((a) => a.id === 'owl')!.stock).toBeUndefined();
    // Zunderschwamm bietet Totholz – das frisst niemand, also kein „Bestand“.
    expect(ev.animals.tinder!.stock).toBeDefined();
    expect(animals.find((a) => a.id === 'tinder')!.stock).toBeUndefined();
    expect(animalStock('tinder', ev)).toBeUndefined();
  });

  it('Beute-Karte: Bestand nach dem Einzug und wen sie ernährt', () => {
    const state = stateAt(OLD_TREE, ['owl']);
    state.pendingEncounters.push({ type: 'animal', cards: ['vole'], rerolls: 0 });
    const card = toEncounterView(state, 0)!.cards[0]!;
    expect(card.effects.map((e) => e.label)).toContainEqual(expect.stringMatching(/^Bestand: (knapp|gut|reichlich) – ernährt Waldkauz$/));
    const alone = stateAt(OLD_TREE);
    alone.pendingEncounters.push({ type: 'animal', cards: ['vole'], rerolls: 0 });
    const lonely = toEncounterView(alone, 0)!.cards[0]!;
    expect(lonely.effects.map((e) => e.label)).toContainEqual(expect.stringMatching(/^Bestand: \S+ – noch kein Jäger$/));
  });

  it('Jäger-Karte: Futter aus dem Nahrungsnetz und freundlicher Hinweis bei Überjagung', () => {
    const state = stateAt(OLD_TREE, ['vole', 'owl']);
    state.pendingEncounters.push({ type: 'animal', cards: ['fox'], rerolls: 0 });
    const card = toEncounterView(state, 0)!.cards[0]!;
    expect(card.conditions![0]!.hint).toContain('Kleinsäuger: zu knapp für 2 Jäger');
    const note = card.effects.find((e) => e.label.startsWith('👀'))!;
    expect(note).toEqual({ label: '👀 Mehr Jäger als Kleinsäuger – die Beute würde scheu', tone: 'neutral' });
    // Ohne Konkurrenz reicht es – kein Hinweis.
    const calm = stateAt(OLD_TREE, ['vole']);
    calm.pendingEncounters.push({ type: 'animal', cards: ['owl'], rerolls: 0 });
    const owl = toEncounterView(calm, 0)!.cards[0]!;
    expect(owl.conditions![0]!.hint).toContain('Kleinsäuger: reicht für 1 Jäger');
    expect(owl.effects.some((e) => e.label.startsWith('👀'))).toBe(false);
  });

  it('huntFoodText: leer für Arten, die nichts jagen', () => {
    const state = stateAt(OLD_TREE, ['vole', 'owl']);
    expect(huntFoodText('vole', evaluate(state).foodWeb)).toBe('');
  });
});

describe('Tierdetails: Räuber und Beute', () => {
  it('Beute: Bestand, wen sie ernährt; bei Überjagung mit Namen und Hinweis', () => {
    const state = stateAt(OLD_TREE, ['vole', 'owl', 'fox']);
    const ev = evaluate(state);
    const view = toAnimalDetailView(state, 'vole', ev)!;
    expect(view.predation.map((p) => p.key)).toEqual(['stock', 'prey-kleinsaeuger']);
    expect(view.predation[0]!.label).toBe(`Bestand: ${stockView(ev.animals.vole!.stock!).label}`);
    const prey = view.predation[1]!;
    expect(prey.label).toMatch(/^Kleinsäuger: überjagt von (Waldkauz und Rotfuchs|Rotfuchs und Waldkauz)$/);
    expect(prey.hint).toBe('Mehr Jäger als Futter – eine weitere Art, die Kleinsäuger bietet, hilft.');
    // Freundlich: kein Warnton.
    expect(prey.tone).toBe('neutral');
  });

  it('Beute im Gleichgewicht und ungejagt', () => {
    const fed = stateAt(OLD_TREE, ['vole', 'owl']);
    const view = toAnimalDetailView(fed, 'vole')!;
    expect(view.predation.find((p) => p.key === 'prey-kleinsaeuger')).toMatchObject({ label: 'Kleinsäuger: ernährt Waldkauz', tone: 'good' });
    const alone = stateAt(OLD_TREE, ['vole']);
    const lonely = toAnimalDetailView(alone, 'vole')!.predation.find((p) => p.key === 'prey-kleinsaeuger')!;
    expect(lonely.label).toBe('Kleinsäuger: noch kein Jäger');
    expect(lonely.hint).toContain('Mäusejahr');
  });

  it('Jäger: wie es um das Futter steht', () => {
    const state = stateAt(OLD_TREE, ['vole', 'owl', 'fox']);
    const owl = toAnimalDetailView(state, 'owl')!;
    expect(owl.predation).toEqual([
      { key: 'hunt-kleinsaeuger', icon: '🐭', label: 'Futter Kleinsäuger: zu knapp für 2 Jäger', hint: 'Mehr Jäger als Futter – eine weitere Art, die Kleinsäuger bietet, hilft.', tone: 'neutral' },
    ]);
    const calm = stateAt(OLD_TREE, ['vole', 'owl']);
    const fed = toAnimalDetailView(calm, 'owl')!.predation[0]!;
    expect(fed.label).toBe('Futter Kleinsäuger: reicht für 1 Jäger');
    expect(fed.tone).toBe('good');
    expect(fed.hint).toMatch(/^Im Gleichgewicht – Bestand (knapp|gut|reichlich)\.$/);
  });

  it('Arten ohne Rolle im Nahrungsnetz: kein Abschnitt', () => {
    const state = stateAt(OLD_TREE, ['jay', 'tinder']);
    expect(toAnimalDetailView(state, 'jay')!.predation).toEqual([]);
    expect(toAnimalDetailView(state, 'tinder')!.predation).toEqual([]);
  });
});

describe('Massenjahre in der Oberfläche', () => {
  it('Texte und Optionen kommen aus content, Einladungen mit Namen bzw. Spoiler-Regel', () => {
    for (const event of PREDATION_EVENTS) {
      const state = stateAt(event.minStage, ['oakmoth', 'vole', 'barkbeetle', 'slug']);
      state.pendingEncounters = [{ type: 'event', cards: [event.id], rerolls: 0 }];
      const view = toEventView(state, 0)!;
      expect(view.title).toBe(event.name);
      expect(view.icon).toBe(event.icon);
      expect(view.subtitle).toBe(event.text);
      expect(view.cards.map((c) => c.chooseLabel)).toEqual(event.options.map((o) => o.label));
      expect(view.cards.every((c) => c.familyLabel === event.name && c.effects.length > 0)).toBe(true);
    }
  });

  it('Mäusejahr: entdeckte Jäger mit Namen, unbekannte als Silhouette', () => {
    const state = stateAt(OLD_TREE, ['vole']);
    state.pendingEncounters = [{ type: 'event', cards: ['vole-year'], rerolls: 0 }];
    const hidden = toEventView(state, 0)!.cards[0]!.effects[0]!.label;
    expect(hidden).toMatch(/^nächste Begegnung: 3 unbekannte Arten/);
    state.meta.journal.species.push('owl', 'fox', 'weasel');
    const named = toEventView(state, 0)!.cards[0]!.effects[0]!.label;
    expect(named).toMatch(/^nächste Begegnung: Waldkauz, Rotfuchs oder Mauswiesel$/);
  });

  it('Käferjahr: Totholz und Platz bis zum Neuen Zyklus; Bedingungsname „… ohne Jäger“', () => {
    const state = stateAt(EVENTS_BY_ID.get('beetle-year')!.minStage, ['barkbeetle']);
    state.pendingEncounters = [{ type: 'event', cards: ['beetle-year'], rerolls: 0 }];
    expect(toEventView(state, 0)!.cards[1]!.effects[0]!.label).toBe('Totholz, +1 Platz Totholzhaufen – bis zum Neuen Zyklus');
    expect(conditionName({ kind: 'unhunted', tag: 'raupen' })).toBe('Raupen ohne Jäger');
  });
});

describe('Spielanleitung: Räuber und Beute', () => {
  const text = guideSections()
    .find((s) => s.id === 'predation')!
    .paragraphs.join(' ');

  it('Bestand, Überjagung und Massenjahre aus content', () => {
    expect(text).toContain('knapp, gut oder reichlich');
    expect(text).toContain(`bis zu ${formatNumber(STOCK_BASE + STOCK_RANGE)} Jäger`);
    expect(text).toContain(`bis zu ${formatNumber(Math.round(OVERHUNT_PENALTY * OVERHUNT_MAX_UNITS * 100))} Prozentpunkte`);
    for (const e of PREDATION_EVENTS) expect(text).toContain(e.name);
    expect(text).toContain(`ab „${STAGES[OLD_TREE]!.name}“`);
    expect(text).toContain('Nahrungsnetz');
  });

  it('Nischen-Abschnitt: Jäger stören nur bei Überjagung', () => {
    const niches = guideSections().find((s) => s.id === 'niches')!.paragraphs.join(' ');
    expect(niches).not.toContain('Räuber und Störer');
    expect(niches).toContain('Jäger nur, wenn sie mehr fressen, als da ist');
  });
});
