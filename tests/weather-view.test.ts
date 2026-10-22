import { describe, expect, it } from 'vitest';
import { SEASONS_BY_ID, SEASON_SECONDS } from '../src/content/seasons';
import { SPECIES_BY_ID } from '../src/content/species';
import { GENTLE_DAYS, WEATHERS, WEATHERS_BY_ID, type WeatherId } from '../src/content/weather';
import { evaluate } from '../src/core/formulas';
import type { GameState } from '../src/core/state';
import { weatherAt, weatherForecast, weatherOfDay } from '../src/core/weather';
import { effectViews, nicheViews, toCareViews, toEcosystemView, welcomeText } from '../src/ui/adapters';
import { toAnimalDetailView } from '../src/ui/animal-detail-view';
import { toCyclePanelView } from '../src/ui/cycle-view';
import { guideSections } from '../src/ui/guide-view';
import {
  ALWAYS_DAY_NOTE,
  activeNightSpecies,
  averagedWeatherText,
  careProtectionDetail,
  careProtectionText,
  daytimeText,
  happinessFrom,
  NIGHT_VISIBLE_MIN_HAPPINESS,
  forecastText,
  nightBadge,
  nightDetailText,
  nightRateText,
  seasonWeatherChangeText,
  signedPct,
  toWeatherBadgeView,
  treeWeatherText,
  weatherBadgeEffects,
  weatherEffectLabel,
} from '../src/ui/weather-view';
import { stateAt } from './helpers';

/** Fünf Gattungen (Säugetiere, Vögel, Insekten, Bodenleben, Pilze): Vielfalt dämpft −50 %. */
const GROVE = ['vole', 'robin', 'bee', 'earthworm', 'chanterelle'];

function dayWith(cycle: { number: number; startedAt?: number }, id: WeatherId, from = GENTLE_DAYS + 1): number {
  for (let d = from; d < 100_000; d++) if (weatherOfDay(cycle, d) === id) return d;
  throw new Error(`kein Tag mit ${id}`);
}

/** Stand an einem Tag mit diesem Wetter; `second` = Sekunde im Tag (≥ 81: Nacht). */
function stateOnWeather(id: WeatherId, animals: string[] = [], second = 10): GameState {
  const state = stateAt(5, animals, 7);
  state.cycle.startedAt = 1_700_000_000_000;
  state.cycle.elapsed = dayWith(state.cycle, id) * SEASON_SECONDS + second;
  expect(weatherAt(state).id).toBe(id);
  return state;
}

/** Stand in einer bestimmten Jahreszeit (Tag n mod 4) zu einer Sekunde im Tag. */
function stateInSeason(seasonIndex: number, animals: string[], second: number): GameState {
  const state = stateAt(5, animals, 7);
  state.cycle.elapsed = (8 + seasonIndex) * SEASON_SECONDS + second;
  return state;
}

describe('Formatierung', () => {
  it('Prozent mit Vorzeichen, typografischem Minus und deutschem Komma', () => {
    expect(signedPct(-7.5)).toBe('−7,5 %');
    expect(signedPct(-7.5, true)).toBe('−8 %');
    expect(signedPct(-3.75, true)).toBe('−4 %');
    expect(signedPct(25)).toBe('+25 %');
    expect(signedPct(0)).toBe('±0 %');
    expect(signedPct(-0.04)).toBe('±0 %');
  });

  it('Wirkungen als Kurztext, Gruppen mit Namen', () => {
    expect(weatherEffectLabel({ kind: 'growth', pct: -13.5 })).toBe('−13,5 % 🌿');
    expect(weatherEffectLabel({ kind: 'seeds', pct: 10 })).toBe('+10 % 🌰');
    expect(weatherEffectLabel({ kind: 'groupSeeds', group: 'flowers', pct: 20 })).toMatch(/^\S.* \+20 % 🌰$/);
    expect(weatherEffectLabel({ kind: 'groupGrowth', group: 'mosses', pct: 30 })).toMatch(/\+30 % 🌿$/);
  });

  it('Abzeichen zeigt nur 🌿 und 🌰, gerundet wie die Details, ohne „±0 %“', () => {
    expect(weatherBadgeEffects([{ kind: 'growth', pct: -7.5 }, { kind: 'seeds', pct: 25 }])).toEqual(['−7,5 % 🌿', '+25 % 🌰']);
    expect(weatherBadgeEffects([{ kind: 'growth', pct: -0.3 }])).toEqual(['−0,3 % 🌿']);
    expect(weatherBadgeEffects([{ kind: 'growth', pct: -0.04 }])).toEqual([]);
    const sun = WEATHERS_BY_ID.get('sun')!;
    expect(weatherBadgeEffects(sun.effects)).toEqual(['+10 % 🌰']);
    expect(weatherBadgeEffects([{ kind: 'growth', pct: -0 }, { kind: 'seeds', pct: 15 }])).toEqual(['+15 % 🌰']);
  });

  it('Vorhersage mit allen Wirkungen', () => {
    const fog = WEATHERS_BY_ID.get('fog')!;
    expect(forecastText(fog)).toMatch(/^Morgen: 🌫️ Nebel · \+5 % 🌿 · .+ \+30 % 🌿$/);
    expect(forecastText(WEATHERS_BY_ID.get('mild')!)).toBe('Morgen: ⛅ Wechselhaft');
  });
});

describe('Wetter-Abzeichen', () => {
  it('Sturm im Hain mit fünf Gattungen: gedämpfter Abzug, Samen voll', () => {
    const state = stateOnWeather('storm', GROVE);
    const view = toWeatherBadgeView(state);
    expect(view.id).toBe('storm');
    expect(view.rough).toBe(true);
    expect(view.text).toBe('🌬️ Sturm · −7,5 % 🌿 · +25 % 🌰');
    expect(view.label).toBe('Wetter heute: Sturm, −7,5 % Wachstum, +25 % Samen. Details');
    expect(view.effects).toBe('Heute: −7,5 % 🌿 (statt −15 %) · +25 % 🌰');
    expect(view.damping).toBe('Abzug gedämpft: Vielfalt −50 % (5 Gattungen).');
    // Vielfalt ist ausgeschöpft – nur die Pflege hilft noch.
    expect(view.tip).toBe('Pflege „Lichte Krone“ halbiert den Abzug.');
    expect(view.forecast).toBe(forecastText(weatherForecast(state)));
    expect(view.title).toContain(WEATHERS_BY_ID.get('storm')!.text);
    expect(view.title).toContain('Morgen:');
    expect(view.daytimeNote).toBeNull();
  });

  it('mit Lichter Krone: Schutz im Text, kein Tipp mehr', () => {
    const state = stateOnWeather('storm', GROVE);
    state.cycle.care = { 'light-crown': 1 };
    const view = toWeatherBadgeView(state);
    expect(view.text).toBe('🌬️ Sturm · −4 % 🌿 · +25 % 🌰');
    expect(view.damping).toBe('Abzug gedämpft: Vielfalt −50 % (5 Gattungen), Lichte Krone −50 %.');
    expect(view.tip).toBeNull();
  });

  it('ohne Tiere und Pflege: ungedämpft, beide Tipps', () => {
    const view = toWeatherBadgeView(stateOnWeather('drought'));
    expect(view.text).toBe('🌡️ Dürre · −15 % 🌿 · +20 % 🌰');
    expect(view.damping).toBe('Abzug ungedämpft.');
    expect(view.tip).toContain('„Waldtümpel“');
    expect(view.tip).toContain('Jede Gattung mit Tieren dämpft ihn um 10 %, höchstens um 50 %.');
  });

  it('eine Gattung: Einzahl', () => {
    expect(toWeatherBadgeView(stateOnWeather('storm', ['vole'])).damping).toBe('Abzug gedämpft: Vielfalt −10 % (1 Gattung).');
  });

  it('Waldkiefer bei Frost: kein Abzug, kein Tipp', () => {
    const state = stateOnWeather('frost');
    state.cycle.mainTree = 'pine';
    const view = toWeatherBadgeView(state);
    expect(view.text).toBe('🧊 Frost · +15 % 🌰');
    expect(view.damping).toBe('Die Waldkiefer ist gegen Frost gefeit – kein Abzug.');
    expect(view.tip).toBeNull();
  });

  it('erster Tag: Wechselhaft ohne Wirkung und ohne Dämpfung', () => {
    const state = stateAt(0);
    const view = toWeatherBadgeView(state);
    expect(view.text).toBe('⛅ Wechselhaft');
    expect(view.rough).toBe(false);
    expect(view.effects).toBe('Heute: keine Wirkung.');
    expect(view.damping).toBeNull();
    expect(view.tip).toBeNull();
    expect(view.label).toBe('Wetter heute: Wechselhaft. Details');
  });

  it('ruhiges Wetter mit Gruppenwirkung: Gruppe nur in den Details', () => {
    const view = toWeatherBadgeView(stateOnWeather('sun'));
    expect(view.text).toBe('☀️ Sonnenschein · +10 % 🌰');
    expect(view.effects).toMatch(/^Heute: \+10 % 🌰 · .+ \+20 % 🌰$/);
  });

  it('Einstellung „Immer Tag“: Hinweis, dass die Wirkung weiterläuft', () => {
    expect(toWeatherBadgeView(stateAt(0), true).daytimeNote).toBe(ALWAYS_DAY_NOTE);
    expect(ALWAYS_DAY_NOTE).toContain('Nacht und Wetter wirken weiter');
  });
});

/** Feste Zufriedenheit für alle Arten (statt der Auswertung). */
const happy = (z: number) => () => z;

describe('Tag und Nacht im Abzeichen', () => {
  it('nachts mit Waldkauz: Restzeit und Nachtart mit skalierter Wirkung', () => {
    const state = stateInSeason(0, ['owl'], 100);
    expect(toWeatherBadgeView(state).night).toBe(true);
    expect(daytimeText(state, happy(1))).toBe('🌙 Nacht · noch 1:11 min – nachtaktiv: Waldkauz (+10 % 🌿).');
    expect(daytimeText(state, happy(0.68))).toBe('🌙 Nacht · noch 1:11 min – nachtaktiv: Waldkauz (+6,8 % 🌿).');
    // Standard: Zufriedenheit aus der Auswertung (wie evaluate).
    const z = evaluate(state).animals.owl!.happiness;
    expect(daytimeText(state)).toBe(daytimeText(state, happy(z)));
  });

  it('tagsüber: Zeit bis zur Nacht und wer dann wirkt', () => {
    const state = stateInSeason(0, ['owl'], 21);
    expect(daytimeText(state, happy(1))).toBe('☀️ Tag · Nacht in 1:00 min – dann wirken: Waldkauz (+10 % 🌿).');
    expect(daytimeText(stateInSeason(0, [], 21))).toBe('☀️ Tag · Nacht in 1:00 min.');
  });

  it('nachts ohne Nachtarten oder mit sehr unzufriedenen: keine Wirkung genannt', () => {
    expect(daytimeText(stateInSeason(0, [], 100))).toContain('ohne nachtaktive Arten bleibt die Nacht ohne Wirkung');
    const state = stateInSeason(0, ['owl'], 100);
    expect(daytimeText(state, happy(NIGHT_VISIBLE_MIN_HAPPINESS / 2))).toContain('wirken erst, wenn sie zufriedener sind');
    expect(daytimeText(state, happy(NIGHT_VISIBLE_MIN_HAPPINESS))).toContain('nachtaktiv: Waldkauz');
  });

  it('Winter: Langohr schläft, Kauz jagt', () => {
    const state = stateInSeason(3, ['owl', 'bat'], 100);
    expect(daytimeText(state, happy(1))).toContain('Waldkauz');
    expect(daytimeText(state, happy(1))).not.toContain('Langohr');
  });
});

describe('Gemeinsamer Hinweis beim Wechsel', () => {
  it('Jahreszeit und Wetter in einem Text', () => {
    const autumn = SEASONS_BY_ID.get('autumn')!;
    const storm = WEATHERS_BY_ID.get('storm')!;
    expect(seasonWeatherChangeText(['autumn'], ['storm'])).toBe(`🍂 Herbst · 🌬️ Sturm – ${autumn.text} ${storm.text}`);
  });

  it('Wechselhaft: nur der Name, der Text bleibt kurz', () => {
    const summer = SEASONS_BY_ID.get('summer')!;
    expect(seasonWeatherChangeText(['summer'], ['mild'])).toBe(`☀️ Sommer · ⛅ Wechselhaft – ${summer.text}`);
  });

  it('mehrere Wechsel: der letzte zählt; ohne Wechsel leer; ohne Wetter wie bisher', () => {
    expect(seasonWeatherChangeText(['summer', 'autumn'], ['sun', 'fog'])).toMatch(/^🍂 Herbst · 🌫️ Nebel – /);
    expect(seasonWeatherChangeText([], [])).toBe('');
    expect(seasonWeatherChangeText(['winter'], [])).toBe(`❄️ Winter: ${SEASONS_BY_ID.get('winter')!.text}`);
  });
});

describe('Rückkehr-Meldung', () => {
  it('„Wetter gemittelt“ nur, wenn gemittelt gerechnet wurde', () => {
    expect(averagedWeatherText({ averaged: false, weather: ['storm'] })).toBe('');
    expect(averagedWeatherText({})).toBe('');
    expect(averagedWeatherText({ averaged: true, weather: [] })).toBe('Wetter gemittelt.');
    expect(averagedWeatherText({ averaged: true, weather: ['mild', 'mild'] })).toBe('Wetter gemittelt.');
  });

  it('nennt die häufigsten Lagen (höchstens drei), Wechselhaft nicht', () => {
    expect(averagedWeatherText({ averaged: true, weather: ['rain', 'storm', 'rain', 'mild'] })).toBe(
      'Wetter gemittelt (2 × Landregen, 1 × Sturm).',
    );
    const many: WeatherId[] = ['fog', 'snow', 'frost', 'rain', 'rain', 'sun'];
    expect(averagedWeatherText({ averaged: true, weather: many })).toBe('Wetter gemittelt (2 × Landregen, 1 × Sonnenschein, 1 × Nebel).');
  });

  it('steht am Ende der Willkommens-Meldung', () => {
    const report = { seconds: 3600, growth: 500, seeds: 50, autoDeclined: 0, declinedSeeds: 0 };
    expect(welcomeText(3600, { ...report, averaged: true, weather: ['storm'] }, 0)).toMatch(/\. Wetter gemittelt \(1 × Sturm\)\.$/);
    expect(welcomeText(3600, { ...report, averaged: false, weather: [] }, 0)).not.toContain('Wetter');
    expect(welcomeText(3600, report, 0)).not.toContain('Wetter');
  });
});

describe('Nachtarten', () => {
  it('🌙 an Nachtarten, aktiv nur nachts in ihrer Jahreszeit und wenn zufrieden genug', () => {
    expect(nightBadge('vole')).toBeNull();
    expect(nightBadge('owl')).toEqual({
      label: '🌙 nachts +10 % 🌿',
      name: 'Nachtjagd',
      active: false,
      resting: false,
      tooUnhappy: false,
      scaled: '+10 % 🌿',
      happiness: 1,
    });
    expect(nightBadge('owl', 'winter', true)!.active).toBe(true);
    expect(nightBadge('owl', 'winter', true, 0.5)).toMatchObject({ active: true, scaled: '+5 % 🌿' });
    expect(nightBadge('owl', 'winter', true, 0.01)).toMatchObject({ active: false, tooUnhappy: true });
    expect(nightBadge('owl', 'winter', true, NaN)).toMatchObject({ active: false, happiness: 0 });
    expect(nightBadge('bat', 'winter', true)).toMatchObject({ active: false, resting: true, tooUnhappy: false });
    expect(nightBadge('bat', 'summer', false)).toMatchObject({ active: false, resting: false });
  });

  it('Text für die Tierdetails mit skaliertem Wert', () => {
    expect(nightDetailText(nightBadge('owl', 'spring', true, 0.68)!)).toBe(
      '🌙 Nachtjagd: nachts +10 % 🌿 – wirkt gerade: +6,8 % 🌿 bei 68 % Zufriedenheit',
    );
    expect(nightDetailText(nightBadge('owl', 'spring', false, 1)!)).toBe(
      '🌙 Nachtjagd: nachts +10 % 🌿 – nachts +10 % 🌿 bei 100 % Zufriedenheit',
    );
    // Winterschlaf: kein doppeltes „(nicht im Winter)“.
    expect(nightDetailText(nightBadge('hedgehog', 'winter', true)!)).toBe('🌙 Nachtschmaus: nachts +6 % 🌿 – ruht in dieser Jahreszeit');
    expect(nightDetailText(nightBadge('hedgehog', 'summer', true, 0.01)!)).toBe(
      '🌙 Nachtschmaus: nachts +6 % 🌿 (nicht im Winter) – wirkt erst, wenn sie zufriedener ist',
    );
  });

  it('🌙 an der Rate: getrennt nach 🌿 und 🌰, nur nachts und nur zufrieden genug', () => {
    const night = stateInSeason(1, ['owl', 'bat', 'vole'], 100);
    expect(activeNightSpecies(night, happy(1))).toEqual({ growth: ['Waldkauz'], seeds: ['Braunes Langohr'] });
    expect(activeNightSpecies(night, (id) => (id === 'bat' ? 0 : 1))).toEqual({ growth: ['Waldkauz'], seeds: [] });
    expect(activeNightSpecies(stateInSeason(1, ['owl', 'bat'], 10), happy(1))).toEqual({ growth: [], seeds: [] });
    expect(activeNightSpecies(stateInSeason(3, ['bat'], 100), happy(1))).toEqual({ growth: [], seeds: [] });
    expect(nightRateText([])).toBe('');
    expect(nightRateText(['Waldkauz'])).toBe('Nachtbonus: Waldkauz');
    expect(nightRateText(['Waldkauz', 'Igel', 'Glühwürmchen'])).toBe('Nachtbonus: Waldkauz, Igel und Glühwürmchen');
  });

  it('Kauz ohne Beute (Grundzufriedenheit 5 %): kein leuchtendes 🌙, kein Nachtbonus an der Rate', () => {
    const state = stateInSeason(1, ['owl'], 100);
    const ev = evaluate(state);
    expect(ev.animals.owl!.happiness).toBeLessThan(NIGHT_VISIBLE_MIN_HAPPINESS);
    const owl = nicheViews(state, ev).flatMap((n) => n.animals).find((a) => a.id === 'owl')!;
    expect(owl.night).toMatchObject({ active: false, tooUnhappy: true });
    expect(toEcosystemView(state, ev).night.growth).toEqual([]);
    expect(daytimeText(state)).toContain('wirken erst, wenn sie zufriedener sind');
    expect(toAnimalDetailView(state, 'owl')!.effects.find((e) => e.label.startsWith('🌙'))).toMatchObject({
      label: '🌙 Nachtjagd: nachts +10 % 🌿 – wirkt erst, wenn sie zufriedener ist',
      tone: 'neutral',
    });
  });

  it('Zufriedenheit aus der Auswertung (begrenzt auf 0–1)', () => {
    const of = happinessFrom({ animals: { owl: { happiness: 0.4 } as never, bat: { happiness: 2 } as never } });
    expect(of('owl')).toBe(0.4);
    expect(of('bat')).toBe(1);
    expect(of('hedgehog')).toBe(0);
  });

  it('Seitenleiste: Kachel und Rate bekommen den Zustand', () => {
    const state = stateInSeason(1, ['owl', 'vole'], 100);
    const ev = evaluate(state);
    expect(ev.animals.owl!.happiness).toBeGreaterThanOrEqual(NIGHT_VISIBLE_MIN_HAPPINESS);
    const owl = nicheViews(state, ev).flatMap((n) => n.animals).find((a) => a.id === 'owl')!;
    expect(owl.night).toMatchObject({ label: '🌙 nachts +10 % 🌿', active: true, happiness: ev.animals.owl!.happiness });
    const vole = nicheViews(state, ev).flatMap((n) => n.animals).find((a) => a.id === 'vole')!;
    expect(vole.night).toBeUndefined();
    expect(toEcosystemView(state, ev).night.growth).toEqual(['Waldkauz']);
    const day = stateInSeason(1, ['owl'], 10);
    expect(toEcosystemView(day, evaluate(day)).night.growth).toEqual([]);
  });

  it('Karte (effectViews) und Tierdetails nennen die Nachtwirkung', () => {
    expect(effectViews(SPECIES_BY_ID.get('owl')!).map((e) => e.label)).toContain('🌙 nachts +10 % 🌿');
    expect(effectViews(SPECIES_BY_ID.get('vole')!).some((e) => e.label.includes('🌙'))).toBe(false);
    const state = stateInSeason(1, ['owl', 'vole'], 100);
    const detail = toAnimalDetailView(state, 'owl')!;
    const z = evaluate(state).animals.owl!.happiness;
    expect(detail.effects.map((e) => e.label)).toContain(nightDetailText(nightBadge('owl', 'summer', true, z)!));
    expect(detail.effects.find((e) => e.label.startsWith('🌙'))!.label).toMatch(/Zufriedenheit$/);
  });
});

describe('Schutz durch Pflege und Baumart', () => {
  it('Waldtümpel → Dürre, Lichte Krone → Sturm, Laub liegen lassen → Frost', () => {
    expect(careProtectionText('pond')).toBe('🛡️ Schützt vor 🌡️ Dürre – halbiert den Abzug');
    expect(careProtectionText('light-crown')).toBe('🛡️ Schützt vor 🌬️ Sturm – halbiert den Abzug');
    expect(careProtectionText('leaf-litter')).toBe('🛡️ Schützt vor 🧊 Frost – halbiert den Abzug');
    expect(careProtectionText('nest-boxes')).toBeNull();
    expect(careProtectionDetail('light-crown')).toBe(WEATHERS_BY_ID.get('storm')!.protectionText);
    expect(careProtectionDetail('nest-boxes')).toBeNull();
  });

  it('Pflege-Liste trägt den Hinweis', () => {
    const state = stateAt(5);
    const views = toCareViews(state);
    for (const v of views) expect(v.protects ?? null).toBe(careProtectionText(v.id));
    expect(views.some((v) => v.protects)).toBe(true);
  });

  it('Waldkiefer trotzt Frost – auch in der Baumwahl', () => {
    expect(treeWeatherText('pine')).toBe('trotzt Frost 🧊');
    expect(treeWeatherText('oak')).toBeNull();
    const trees = toCyclePanelView(stateAt(5)).trees;
    expect(trees.find((t) => t.id === 'pine')!.summary).toMatch(/ · trotzt Frost 🧊$/);
    expect(trees.find((t) => t.id === 'oak')!.summary).not.toContain('Frost');
  });
});

describe('Spielanleitung: Wetter und Nacht', () => {
  const sections = guideSections();
  const text = (id: string) => sections.find((s) => s.id === id)!.paragraphs.join(' ');

  it('alle Wetterlagen, Dämpfung, Schutz und Kiefer aus den Daten', () => {
    for (const w of WEATHERS) expect(text('weather')).toContain(`${w.icon} ${w.name}: ${w.summary}.`);
    expect(text('weather')).toContain('um 10 %, höchstens um 50 %');
    expect(text('weather')).toContain('„Waldtümpel“ bei Dürre');
    expect(text('weather')).toContain('„Lichte Krone“ bei Sturm');
    expect(text('weather')).toContain('„Laub liegen lassen“ bei Frost');
    expect(text('weather')).toContain('Die Waldkiefer ist gegen Frost gefeit');
    expect(text('weather')).toContain(`ersten ${GENTLE_DAYS} Tagen`);
  });

  it('Nachtarten, Winterruhe, Mittel offline und „Immer Tag“', () => {
    expect(text('night')).toContain('Waldkauz (nachts +10 % 🌿)');
    expect(text('night')).toContain('Braunes Langohr (nachts +12 % 🌰)');
    expect(text('night')).toContain('ruhen im Winter');
    expect(text('night')).toContain('Wetter gemittelt');
    expect(text('night')).toContain('Immer Tag');
  });
});
