import { describe, expect, it } from 'vitest';
import { JAY_SEEDS_FIRST_ANCIENT, LANDSCAPE_SITES, LANDSCAPE_UNLOCK_MEMORY, type SiteId } from '../src/content/landscape';
import { STAGES } from '../src/content/stages';
import { regularSlots } from '../src/core/formulas';
import { ANCIENT_STAGE } from '../src/core/landscape';
import { createSite, type GameState, type LandscapeSite } from '../src/core/state';
import { previewNewCycle } from '../src/core/tick';
import { toAnimalDetailView } from '../src/ui/animal-detail-view';
import { toJournalStats, toJournalView } from '../src/ui/adapters';
import { toJournalLandscapeView } from '../src/ui/journal-landscape-view';
import { memoryLineText, toCyclePanelView } from '../src/ui/cycle-view';
import { guideSections } from '../src/ui/guide-view';
import {
  corridorBuiltText,
  jaySeedsText,
  landscapeErrorText,
  newCycleButtonText,
  siteChangeText,
  siteEventHints,
  siteEventText,
  splitSiteSummary,
  targetText,
  toLandscapeMapView,
} from '../src/ui/landscape-view';
import { evaluate } from '../src/core/formulas';
import { stateAt } from './helpers';

/**
 * Karte der Landschaft (DESIGN_V2.md 24.5, 24.6) – View-Model ohne DOM: Sichtbarkeit,
 * Zustände der Standorte, Sperrgründe, Korridore, Hähersaat, Texte. Dazu die Umstellung
 * der übrigen Ansichten auf das wirksame Gedächtnis und die Spielanleitung.
 */

const GROVE = STAGES.findIndex((s) => s.id === 'grove');

function withLandscape(
  stage: number,
  opts: { own?: number; active?: SiteId; sites?: LandscapeSite[]; corridors?: string[]; free?: string[]; achievement?: boolean } = {},
): GameState {
  const state = stateAt(stage, [], 3);
  state.meta.forestMemory = opts.own ?? 300;
  if (opts.achievement ?? true) state.meta.achievements.push('ancient-forest');
  state.meta.landscape = {
    active: opts.active ?? 'home',
    sites: opts.sites ?? [{ ...createSite('home'), ancient: true }],
    corridors: opts.corridors ?? [],
    freeCorridors: opts.free ?? [],
    announced: true,
  };
  return state;
}

const mapOf = (state: GameState) => toLandscapeMapView(state, previewNewCycle(state));

describe('Karte der Landschaft: Sichtbarkeit (Spoiler-Regel)', () => {
  it('vor der Freischaltung: keine Karte, kein Standort-Name im Bereich „Neuer Zyklus“', () => {
    const state = withLandscape(ANCIENT_STAGE, { own: 100 });
    expect(mapOf(state)).toBeNull();
    const json = JSON.stringify(toCyclePanelView(state));
    for (const s of LANDSCAPE_SITES.filter((x) => x.id !== 'home')) expect(json).not.toContain(s.name);
    expect(json).not.toContain('🪶');
  });

  it('im Hain, erst nach diesem Zyklus frei: noch keine Karte (Spoiler), im Urwald schon', () => {
    const grove = withLandscape(GROVE, { own: LANDSCAPE_UNLOCK_MEMORY - 1 });
    grove.cycle.maxHarmony = 200;
    expect(previewNewCycle(grove).landscape.unlocked).toBe(false);
    expect(previewNewCycle(grove).landscape.unlockedAfter).toBe(true);
    expect(mapOf(grove)).toBeNull();
    const ancient = withLandscape(ANCIENT_STAGE, { own: LANDSCAPE_UNLOCK_MEMORY - 1, achievement: false });
    ancient.cycle.maxHarmony = 200;
    expect(previewNewCycle(ancient).landscape.unlockedAfter).toBe(true);
    expect(mapOf(ancient)).not.toBeNull();
  });

  it('ohne Urwald-Erfolg auch mit viel Gedächtnis keine Karte', () => {
    expect(mapOf(withLandscape(GROVE, { own: 600, achievement: false }))).toBeNull();
  });

  it('frei ab Urwald-Erfolg und Gedächtnis im Heimatwald', () => {
    const map = mapOf(withLandscape(GROVE, { own: LANDSCAPE_UNLOCK_MEMORY }))!;
    expect(map).not.toBeNull();
    expect(map.question).toBe('Wo keimt der nächste Baum?');
    expect(map.sites.map((s) => s.id)).toEqual(['home', 'floodplain', 'carr', 'beechwood', 'mountain', 'heath']);
    expect(toCyclePanelView(withLandscape(GROVE)).title).toBe('Zyklus 1 · 🌳 Heimatwald');
  });
});

describe('Karte der Landschaft: Standorte', () => {
  it('aus dem Urwald: gründen mit Kosten, Gewinn und Verzicht getrennt', () => {
    const map = mapOf(withLandscape(ANCIENT_STAGE))!;
    const home = map.sites[0]!;
    expect(home.active).toBe(true);
    expect(home.action).toBe('stay');
    expect(home.status).toBe('hier · Urwald');
    expect(home.gains).toBeNull();
    expect(home.gift).toBeNull();
    const flood = map.sites.find((s) => s.id === 'floodplain')!;
    expect(flood.action).toBe('found');
    expect(flood.status).toBe('gründen · 3 🪶');
    expect(flood.costs).toBe('Pilze −15 % 😊');
    expect(flood.gains).toBe('Feuchte · +2 💧 · ab Junger Baum +2 Plätze Waldtümpel');
    expect(flood.giftActive).toBe(false);
    expect(flood.memory).toMatch(/^Beginnt mit 0 eigenem Gedächtnis · \d+ wirksam über Mühlbach$/);
    expect(flood.ancientText).toBeNull();
    // Wetter des Waldtyps (24.14): Zeichen der häufigsten Lage + Kurztext; Heimatwald ohne.
    expect(home.weather).toBeNull();
    expect(flood.weather).toBe('🌧️ Oft Landregen, selten Dürre – im Frühjahr steigt der Fluss.');
    expect(map.sites.find((s) => s.id === 'heath')!.weather).toBe('🌡️ Viel Sonne, im Sommer oft Dürre – dann schwärmen die Borkenkäfer.');
    expect(map.sites.find((s) => s.id === 'carr')!.weather).toBe('🌫️ Oft Nebel über dem Wasser, selten Dürre.');
    // Ereignisse des Waldtyps (Phase 9, 1c): eigene Zeile „Hier öfter“, nicht im Wetter-Text.
    expect(flood.events).toBe('🌧️ Regenreicher Frühling, 🐌 Schneckenjahr');
    expect(flood.eventIcons).toBe('🌧️🐌');
    expect(home.events).toBeNull();
    expect(home.eventIcons).toBeNull();
    expect(map.sites.find((s) => s.id === 'heath')!.events).toBe('🪲 Käferjahr');
    expect(map.sites.find((s) => s.id === 'mountain')!.events).toBeNull();
    for (const s of map.sites) expect(s.weather ?? '', s.id).not.toContain('öfter');
    expect(newCycleButtonText(flood)).toBe('Auwald am Fluss gründen (3 🪶)');
    expect(targetText(flood, '🌳 Heimatwald')).toContain('Der Gewinn dieses Zyklus geht noch an 🌳 Heimatwald.');
    // Leitbaum gesperrt: die Eiche wächst, der Grund steht dabei.
    expect(map.sites.find((s) => s.id === 'heath')!.tree).toContain('noch nicht freigeschaltet');
  });

  it('Hier öfter: Ereignisse mit Faktor > 1 aus eventFactors, Symbol und Name aus den Ereignis-Daten (Phase 9, 1c)', () => {
    const byId = (id: SiteId) => LANDSCAPE_SITES.find((s) => s.id === id)!;
    const texts = Object.fromEntries(LANDSCAPE_SITES.map((s) => [s.id, siteEventText(s)]));
    expect(texts).toEqual({
      home: null,
      floodplain: '🌧️ Regenreicher Frühling, 🐌 Schneckenjahr',
      carr: '🐸 Krötenwanderung',
      beechwood: '🌰 Mastjahr, 🐭 Mäusejahr',
      mountain: null,
      heath: '🪲 Käferjahr',
    });
    expect(siteEventHints(byId('heath'))).toEqual([{ id: 'beetle-year', icon: '🪲', name: 'Käferjahr' }]);
    // Aus den Daten, nicht hart kodiert: jedes Ereignis mit Faktor > 1 genau einmal.
    for (const site of LANDSCAPE_SITES) {
      const ids = Object.entries(site.eventFactors).filter(([, f]) => f > 1).map(([id]) => id);
      expect(siteEventHints(site).map((h) => h.id), site.id).toEqual(ids);
    }
    // Faktor ≤ 1, ungültig oder unbekannt: übergangen; ohne Wald leer.
    expect(siteEventHints({ eventFactors: { rain: 1, storm: 0.5, 'mast-year': Number.NaN, 'gibt-es-nicht': 3 } })).toEqual([]);
    expect(siteEventText({ eventFactors: {} })).toBeNull();
    expect(siteEventHints(undefined)).toEqual([]);
  });

  it('Sperrgründe als deutsche Sätze', () => {
    // Vor dem Hain: Wechseln ab Hain, Gründen nur aus dem Urwald.
    const early = withLandscape(GROVE - 1, {
      sites: [{ ...createSite('home'), ancient: true }, { ...createSite('carr'), memory: 120 }],
      corridors: ['home-carr'],
      free: ['home-carr'],
    });
    const m1 = mapOf(early)!;
    expect(m1.allowed).toBe(false);
    expect(m1.sites.find((s) => s.id === 'carr')!.blocker).toBe('Wechseln geht ab der Stufe „Hain“.');
    expect(m1.sites.find((s) => s.id === 'heath')!.blocker).toMatch(/^Nur aus dem Urwald/);
    // Im Hain: Wechseln geht, Gründen nicht.
    const m2 = mapOf(withLandscape(GROVE, { sites: early.meta.landscape.sites, corridors: ['home-carr'], free: ['home-carr'] }))!;
    const carr = m2.sites.find((s) => s.id === 'carr')!;
    expect(carr.action).toBe('switch');
    expect(carr.blocker).toBeNull();
    expect(carr.memory).toBe('Gedächtnis 120 eigen · 270 wirksam dort');
    expect(carr.giftActive).toBe(true);
    expect(newCycleButtonText(carr)).toBe('Neuen Zyklus beginnen: Erlenbruch');
    // Aus einem Ring-Wald: nicht benachbarte Standorte.
    const ring = withLandscape(ANCIENT_STAGE, {
      own: 300,
      active: 'carr',
      sites: [{ ...createSite('home'), memory: 300, ancient: true }, createSite('carr')],
      corridors: ['home-carr'],
      free: ['home-carr'],
    });
    const m3 = mapOf(ring)!;
    expect(m3.sites.find((s) => s.id === 'mountain')!.blocker).toBe('Liegt nicht neben Erlenbruch – gründen kannst du nur gleich nebenan.');
    // Zu wenig Hähersaat.
    const poor = withLandscape(ANCIENT_STAGE, {
      own: 0,
      sites: [{ ...createSite('home'), ancient: true }, { ...createSite('carr'), memory: 0 }],
      corridors: ['home-carr'],
      free: ['home-carr'],
    });
    poor.meta.forestMemory = 260;
    const m4 = mapOf(poor)!;
    expect(m4.sites.find((s) => s.id === 'heath')!.blocker).toMatch(/^Gründen kostet 5 🪶 – nach diesem Zyklus hast du \d+ 🪶\.$/);
  });

  it('wirksames Gedächtnis gegründeter Wälder: heute wie im Tagebuch, Zyklus-Gewinn benannt', () => {
    const state = withLandscape(GROVE, {
      own: 300,
      sites: [{ ...createSite('home'), ancient: true }, { ...createSite('carr'), memory: 120 }],
      corridors: ['home-carr'],
      free: ['home-carr'],
    });
    const today = mapOf(state)!.sites.find((s) => s.id === 'carr')!;
    expect(today.memory).toBe('Gedächtnis 120 eigen · 270 wirksam dort');
    // Mit Gewinn in diesem Zyklus wächst der Zufluss vom Heimatwald – erst danach.
    state.cycle.maxHarmony = 200;
    const preview = previewNewCycle(state);
    const after = preview.landscape.sites.find((s) => s.id === 'carr')!.effectiveMemory;
    expect(after).toBeGreaterThan(270);
    const carr = toLandscapeMapView(state, preview)!.sites.find((s) => s.id === 'carr')!;
    expect(carr.memory).toBe(`Gedächtnis 120 eigen · 270 wirksam dort (nach diesem Zyklus ${after})`);
    // Der aktive Wald: heute zuerst, der Gewinn danach benannt.
    const home = toLandscapeMapView(state, preview)!.sites.find((s) => s.id === 'home')!;
    const homeAfter = preview.landscape.sites.find((s) => s.id === 'home')!;
    expect(home.memory).toMatch(new RegExp(`^Gedächtnis 300 eigen · \\d+ wirksam \\(nach diesem Zyklus ${homeAfter.memory} eigen · ${homeAfter.effectiveMemory} wirksam\\)$`));
    // Das Tagebuch zeigt denselben Wert von heute.
    const journalRow = toJournalLandscapeView(state)!.sites.find((f) => f.id === 'carr')!.rows.find((r) => r.key === 'memory')!;
    expect(journalRow.value).toBe('120 eigen · 270 wirksam');
  });

  it('Hähersaat-Zeile', () => {
    expect(jaySeedsText(5, 6, true)).toBe('🪶 5 Hähersaat – nach diesem Zyklus 6');
    expect(jaySeedsText(5, 6, false)).toBe('🪶 5 Hähersaat');
    expect(jaySeedsText(5, 5, true)).toBe('🪶 5 Hähersaat');
    expect(mapOf(withLandscape(ANCIENT_STAGE))!.jaySeeds).toMatch(/^🪶 5 Hähersaat/);
  });

  it('splitSiteSummary trennt am Minuszeichen', () => {
    expect(splitSiteSummary('+2 ☀️ · Blumen +10 % 🌰 · −3 💧, Bodenleben −10 % 😊')).toEqual({
      gains: '+2 ☀️ · Blumen +10 % 🌰',
      costs: '−3 💧, Bodenleben −10 % 😊',
    });
    expect(splitSiteSummary('Ausgewogen – der Wald, den du kennst.')).toEqual({ gains: 'Ausgewogen – der Wald, den du kennst.', costs: null });
  });
});

describe('Karte der Landschaft: Korridore', () => {
  const state = () =>
    withLandscape(GROVE, {
      own: 600,
      sites: [{ ...createSite('home'), ancient: true }, { ...createSite('floodplain'), memory: 300 }, { ...createSite('carr'), memory: 200, ancient: true }],
      corridors: ['home-floodplain', 'home-carr'],
      free: ['home-floodplain', 'home-carr'],
    });

  it('gebaut, baubar, gesperrt – nur zwischen gegründeten Wäldern in der Liste', () => {
    const map = mapOf(state())!;
    expect(map.available).toBe(7);
    const byId = new Map(map.corridors.map((c) => [c.id, c]));
    expect(byId.get('home-floodplain')!.state).toBe('built');
    expect(byId.get('home-floodplain')!.note).toBe('verbunden – Weg der Häher, gratis');
    expect(byId.get('floodplain-carr')!.state).toBe('buildable');
    expect(byId.get('floodplain-carr')!.ends).toBe('Auwald am Fluss – Erlenbruch');
    expect(byId.get('home-heath')!.state).toBe('locked');
    expect(byId.get('home-heath')!.listed).toBe(false);
    expect(map.corridorHint).toBe('7 weitere Korridore, sobald die Wälder an ihren Enden gegründet sind.');
  });

  it('zu teuer: Kosten und Bestand im Text', () => {
    const s = state();
    s.meta.landscape.sites[1]!.memory = 0;
    s.meta.landscape.sites[2]!.memory = 0;
    s.meta.forestMemory = 300;
    // verdient 3 + 2 + 2 = 7, ausgegeben 8 → 0
    const c = mapOf(s)!.corridors.find((x) => x.id === 'floodplain-carr')!;
    expect(c.state).toBe('unaffordable');
    expect(c.note).toBe('Kostet 3 🪶 – du hast 0 🪶.');
  });

  it('Meldungen', () => {
    expect(corridorBuiltText('floodplain-carr')).toBe('💧 Altwasser gebaut: Auwald am Fluss und Erlenbruch sind verbunden.');
    expect(siteChangeText('floodplain', true)).toBe('🪶 Neuer Wald gegründet: 🌊 Auwald am Fluss.');
    expect(siteChangeText('home', false)).toBe('Du wächst jetzt in: 🌳 Heimatwald.');
    for (const e of ['site-locked', 'not-enough-jay-seeds', 'not-adjacent', 'needs-ancient-forest', 'unknown-corridor', 'corridor-built', 'cycle-locked'] as const) {
      expect(landscapeErrorText(e).length, e).toBeGreaterThan(10);
    }
  });
});

describe('wirksames Gedächtnis in den übrigen Ansichten', () => {
  const linked = () =>
    withLandscape(GROVE, {
      own: 100,
      sites: [{ ...createSite('home'), ancient: true }, { ...createSite('floodplain'), memory: 400 }],
      corridors: ['home-floodplain'],
      free: ['home-floodplain'],
    });

  it('Bonus und Stammgast-Plätze aus eigenem + Zufluss', () => {
    const state = linked();
    // 100 eigen + 0,5 · 400 = 300 wirksam
    expect(memoryLineText(state)).toBe('Waldgedächtnis 100 (+200 über Korridore) · +300 % Wachstum und Samen');
    const view = toCyclePanelView(state);
    expect(view.regularSlots).toBe(regularSlots(300));
    expect(view.regularsTitle).toBe(`Stammgäste 0/${regularSlots(300)}`);
    const journal = toJournalView(state, evaluate(state));
    expect(journal.meta).toBe('Zyklus 1 · Waldgedächtnis 100, wirksam 300 (+300 % Wachstum und Samen)');
    expect(journal.regulars).toContain(`0/${regularSlots(300)}`);
    const stat = toJournalStats(state, evaluate(state)).find((s) => s.key === 'memory')!;
    expect(stat.value).toBe('100');
    expect(stat.detail).toBe('300 wirksam (+200 über Korridore) · +300 % Wachstum und Samen');
  });

  it('ohne Korridor unverändert', () => {
    const state = withLandscape(GROVE, { own: 30 });
    expect(memoryLineText(state)).toBe('Waldgedächtnis 30 · +30 % Wachstum und Samen');
  });

  it('Tierdetails nennen Eigenheit des Standorts und Gaben', () => {
    const state = withLandscape(GROVE, {
      own: 0,
      active: 'heath',
      sites: [{ ...createSite('home'), memory: 300, ancient: true }, createSite('heath'), createSite('carr')],
      corridors: ['home-heath', 'home-carr'],
      free: ['home-heath', 'home-carr'],
    });
    state.niches.edge.push('bee');
    state.niches.pond = ['frog'];
    state.meta.journal.species.push('bee', 'frog');
    const bee = toAnimalDetailView(state, 'bee', evaluate(state))!;
    expect(bee.factors.find((f) => f.key === 'site')?.label).toMatch(/^Kiefernheide: \+/);
    const frog = toAnimalDetailView(state, 'frog', evaluate(state))!;
    expect(frog.factors.find((f) => f.key === 'gifts')?.label).toMatch(/^Gaben der Landschaft: \+/);
  });
});

describe('Spielanleitung: Waldlandschaft', () => {
  it('vor der Freischaltung nur eine Andeutung ohne Namen und Zahlen', () => {
    const s = guideSections().find((x) => x.id === 'landscape')!;
    const text = s.title + s.paragraphs.join(' ');
    for (const site of LANDSCAPE_SITES.filter((x) => x.id !== 'home')) expect(text).not.toContain(site.name);
    expect(text).not.toContain('Hähersaat');
    expect(text).not.toMatch(/\d/);
  });

  it('danach Regeln mit Zahlen aus content', () => {
    const s = guideSections({ landscape: true }).find((x) => x.id === 'landscape')!;
    const text = s.paragraphs.join(' ');
    expect(s.title).toBe('Waldlandschaft und Hähersaat');
    for (const site of LANDSCAPE_SITES) expect(text).toContain(site.name);
    expect(text).toContain('ab 250 Waldgedächtnis');
    expect(text).toContain('3, 5, 7, 9 und 11 🪶');
    expect(text).toContain('50 %');
    expect(text).toContain('höchstens 500');
    // Phase 9, 1c: jeder Wald erlebt eigene Ereignisse öfter – Beispiel aus den Daten.
    expect(text).toContain('Jeder Wald erlebt außerdem eigene Ereignisse öfter, etwa 🌊 Auwald am Fluss: 🌧️ Regenreicher Frühling, 🐌 Schneckenjahr.');
    expect(text).toContain('„Hier öfter“');
  });

  it('Urwald-Text nennt die Hähersaat aus content', () => {
    const map = mapOf(withLandscape(GROVE, { sites: [{ ...createSite('home'), ancient: true }, createSite('carr')], corridors: ['home-carr'], free: ['home-carr'] }))!;
    expect(map.sites.find((s) => s.id === 'carr')!.ancientText).toBe(`Hier war noch kein Urwald – der erste bringt ${JAY_SEEDS_FIRST_ANCIENT} 🪶.`);
  });
});
