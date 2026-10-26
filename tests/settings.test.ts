import { afterEach, describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { COMMUNITIES } from '../src/content/communities';
import { RESEARCH, RESEARCH_BRANCHES, RESEARCH_FORKS } from '../src/content/research';
import {
  DECLINE_SEED_SECONDS,
  INTERLUDE_CHANCE,
  INTERLUDE_STAGE,
  MAX_PENDING_ENCOUNTERS,
  REROLL_BASE_COST,
} from '../src/content/encounters';
import { EVENTS, SEED_SECONDS_MIN_SEEDS } from '../src/content/events';
import { FOREST_MEMORY_BONUS, MEMORY_PER_REGULAR_SLOT, NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { NICHES } from '../src/content/niches';
import { PLANTS } from '../src/content/plants';
import { SOWING_BASE, SOWING_GROWTH } from '../src/content/sowing';
import { COMMON_SPECIES, SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { TRAIT_THRESHOLDS } from '../src/content/traits';
import { VISITORS } from '../src/content/visitors';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { OFFLINE_FULL_SECONDS, OFFLINE_YIELD } from '../src/content/offline';
import { HARMONY_DIVISOR, memoryHarmonyBonus } from '../src/core/formulas';
import { LONG_NUMBER_LIMIT, formatNumber, getNumberStyle, setNumberStyle } from '../src/ui/format';
import { guideSections, span } from '../src/ui/guide-view';
import { SEASONS, SEASON_SECONDS } from '../src/content/seasons';
import {
  DEFAULT_SETTINGS,
  GUIDE_HINT_KEY,
  LONG_TOAST_MS,
  OFFLINE_HINT_KEY,
  SETTINGS_KEY,
  TOAST_MS,
  effectiveReducedMotion,
  loadSettings,
  parseSettings,
  saveSettings,
  serializeSettings,
  takeFirstStartHint,
  takeOfflineHint,
  toastDuration,
  toastDurationFor,
  TOAST_BASE_CHARS,
  TOAST_MS_PER_CHAR,
} from '../src/ui/settings';

/** Kleiner Speicher für Tests (wie localStorage). */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const throwing = {
  getItem: () => {
    throw new Error('gesperrt');
  },
  setItem: () => {
    throw new Error('voll');
  },
};

describe('Einstellungen', () => {
  it('Standard: Automatisch, kurz, normale Hinweisdauer, Klang aus, Tag und Nacht wechseln', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ motion: 'auto', numbers: 'short', longToasts: false, sound: 'off', daytime: 'cycle' });
  });

  it('robust: kaputtes JSON und unbekannte Werte → Standard (feldweise)', () => {
    expect(parseSettings('{kaputt')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('"on"')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ motion: 'turbo', numbers: 'long', longToasts: 'ja', sound: 'laut', daytime: 'dunkel' }))).toEqual({
      motion: 'auto',
      numbers: 'long',
      longToasts: false,
      sound: 'off',
      daytime: 'cycle',
    });
    // Ältere Einstellungen ohne Klang und Tageszeit: Klang bleibt aus, Tag und Nacht wechseln.
    expect(parseSettings(JSON.stringify({ motion: 'on', numbers: 'short', longToasts: true }))).toEqual({
      motion: 'on',
      numbers: 'short',
      longToasts: true,
      sound: 'off',
      daytime: 'cycle',
    });
  });

  it('Roundtrip über serializeSettings', () => {
    for (const sound of ['off', 'quiet', 'normal'] as const) {
      for (const daytime of ['cycle', 'day'] as const) {
        const s = { motion: 'on' as const, numbers: 'long' as const, longToasts: true, sound, daytime };
        expect(parseSettings(serializeSettings(s))).toEqual(s);
      }
    }
  });

  it('Bewegung reduzieren: An/Aus überschreiben das System, Automatisch folgt ihm', () => {
    expect(effectiveReducedMotion('on', false)).toBe(true);
    expect(effectiveReducedMotion('off', true)).toBe(false);
    expect(effectiveReducedMotion('auto', true)).toBe(true);
    expect(effectiveReducedMotion('auto', false)).toBe(false);
  });

  it('Hinweise länger anzeigen', () => {
    expect(toastDuration({ longToasts: false })).toBe(TOAST_MS);
    expect(toastDuration({ longToasts: true })).toBe(LONG_TOAST_MS);
    expect(LONG_TOAST_MS).toBeGreaterThan(TOAST_MS);
  });

  it('Laden und Speichern, auch ohne funktionierenden Speicher', () => {
    const storage = memoryStorage();
    saveSettings({ motion: 'off', numbers: 'long', longToasts: true, sound: 'quiet', daytime: 'day' }, storage);
    expect(storage.data.get(SETTINGS_KEY)).toBeTruthy();
    expect(loadSettings(storage)).toEqual({ motion: 'off', numbers: 'long', longToasts: true, sound: 'quiet', daytime: 'day' });
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, throwing)).not.toThrow();
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('Hinweis „Neu hier?“ nur beim allerersten Start', () => {
    const storage = memoryStorage();
    expect(takeFirstStartHint(storage)).toBe(true);
    expect(storage.data.get(GUIDE_HINT_KEY)).toBe('1');
    expect(takeFirstStartHint(storage)).toBe(false);
    // Ohne Speicher lieber gar nicht (sonst käme er bei jedem Laden).
    expect(takeFirstStartHint(throwing)).toBe(false);
    expect(takeFirstStartHint(null)).toBe(false);
  });

  it('Hinweis zur Offline-Regel (28.3) nur einmal, eigener Merker', () => {
    const storage = memoryStorage();
    expect(takeFirstStartHint(storage)).toBe(true);
    expect(takeOfflineHint(storage)).toBe(true);
    expect(storage.data.get(OFFLINE_HINT_KEY)).toBe('1');
    expect(takeOfflineHint(storage)).toBe(false);
    expect(takeOfflineHint(throwing)).toBe(false);
    expect(takeOfflineHint(null)).toBe(false);
  });
});

describe('Zahlenformat', () => {
  afterEach(() => setNumberStyle('short'));

  it('kurz kürzt ab einer Million, ausgeschrieben schreibt aus', () => {
    expect(getNumberStyle()).toBe('short');
    expect(formatNumber(1_234_567)).toMatch(/^1,23\s+Mio\.$/);
    expect(formatNumber(1_234_567, 'long')).toBe('1.234.567');
    setNumberStyle('long');
    expect(formatNumber(1_234_567)).toBe('1.234.567');
    expect(formatNumber(12.34)).toBe('12,3');
    expect(formatNumber(119_899.69)).toBe('119.900');
  });

  it('ausgeschrieben kürzt trotzdem ab LONG_NUMBER_LIMIT (Platz in der Seitenleiste)', () => {
    setNumberStyle('long');
    expect(LONG_NUMBER_LIMIT).toBe(1e8);
    expect(formatNumber(LONG_NUMBER_LIMIT - 1)).toBe('99.999.999');
    expect(formatNumber(LONG_NUMBER_LIMIT)).toMatch(/^100\s+Mio\.$/);
    expect(formatNumber(3e12)).toMatch(/Bio\./);
  });

  it('Sonderwerte: NaN → „–“, ±Infinity → „∞“ bzw. „−∞“', () => {
    for (const style of ['short', 'long'] as const) {
      expect(formatNumber(Number.NaN, style)).toBe('–');
      expect(formatNumber(Infinity, style)).toBe('∞');
      expect(formatNumber(-Infinity, style)).toBe('−∞');
    }
  });
});

describe('Spielanleitung', () => {
  const sections = guideSections();
  const text = (id: string) => sections.find((s) => s.id === id)!.paragraphs.join(' ');

  it('21 Abschnitte, keine Platzhalter „kommt bald“ mehr', () => {
    expect(sections.map((s) => s.id)).toEqual([
      'growth',
      'encounters',
      'niches',
      'habitats',
      'predation',
      'sowing',
      'plants',
      'communities',
      'harmony',
      'cycle',
      'landscape',
      'seasons',
      'weather',
      'night',
      'seeds',
      'events',
      'visitors',
      'care',
      'achievements',
      'daily',
      'offline',
    ]);
    for (const s of sections) {
      expect(s.soon, s.id).toBeFalsy();
      expect(s.paragraphs.join(' '), s.id).not.toContain('kommt bald');
      expect(s.title.length, s.id).toBeGreaterThan(0);
      expect(s.paragraphs.length, s.id).toBeGreaterThan(0);
    }
  });

  it('Offline (28.3): 60 s voll, danach 10 %, die Zeit läuft voll', () => {
    const t = text('offline');
    expect(t).toContain(`ersten ${formatNumber(OFFLINE_FULL_SECONDS)} Sekunden voll`);
    expect(t).toContain('mit 10 % der Kraft');
    expect(t).toContain('Tab im Hintergrund');
    expect(t).toContain('Die Zeit selbst läuft voll');
    expect(OFFLINE_YIELD).toBe(0.1);
  });

  it('Erfolge: Anzahl aus content, Fundort Naturtagebuch, keine Eile', () => {
    const t = text('achievements');
    // Vor der Freischaltung der Landschaft nur die sichtbaren (24.12): 27.
    const visible = ACHIEVEMENTS.filter((a) => !a.requires).length;
    expect(visible).toBe(27);
    expect(t).toContain(`${formatNumber(visible)} leise Erfolge`);
    expect(t).toContain('Naturtagebuch');
    expect(t).toContain('Reiter „Ziele“ unter „Erfolge“');
    expect(t).toContain('keine Eile');
    expect(t).toContain('keine Zeitlimits');
  });

  it('Erfolge nach der Freischaltung der Landschaft: alle (37)', () => {
    const after = guideSections({ landscape: true }).find((s) => s.id === 'achievements')!.paragraphs.join(' ');
    expect(ACHIEVEMENTS.length).toBe(37);
    expect(after).toContain(`${formatNumber(ACHIEVEMENTS.length)} leise Erfolge`);
    expect(guideSections({ landscape: false }).find((s) => s.id === 'achievements')!.paragraphs.join(' ')).toContain('27 leise Erfolge');
  });

  it('Hauptbäume der Landschaft: erst nach der Freischaltung genannt, mit ihrem Wald (25.2)', () => {
    const cycle = (landscape: boolean) => guideSections({ landscape }).find((s) => s.id === 'cycle')!.paragraphs.join(' ');
    for (const word of ['Weißtanne', 'Schwarzerle', 'Bergmischwald', 'Erlenbruch', 'Tannensamen']) expect(cycle(false)).not.toContain(word);
    expect(cycle(true)).toContain('In der Waldlandschaft keimen außerdem 🎄 Weißtanne (Bergmischwald) und 🌿 Schwarzerle (Erlenbruch)');
    // Die Begleitpflanzen-Regel nennt weiter nur Buche und Kiefer.
    expect(cycle(true)).toContain('sobald einmal eine Rotbuche bzw. Waldkiefer in deinem Pflanzring gewachsen ist');
  });

  it('span: Spanne „a–b“ oder ein Wert, deutsches Zahlenformat', () => {
    expect(span([30, 60, 45])).toBe('30–60');
    expect(span([15, 15])).toBe('15');
    expect(span([1.5, 2000])).toBe(`${formatNumber(1.5)}–${formatNumber(2000)}`);
  });

  it('Ereignisse: Anzahl, einmal pro Zyklus, Stufe, Samen-Option und Zwischenhalt aus content', () => {
    const t = text('events');
    expect(t).toContain(`${formatNumber(EVENTS.length)} gibt es`);
    expect(t).toContain('höchstens einmal pro Zyklus');
    expect(t).toContain(`Ab „${STAGES[Math.min(...EVENTS.map((e) => e.minStage))]!.name}“`);
    // Spanne nur aus reinen Samen-Optionen (90–150 s), Ameisenstraße (Zeit-Bonus + 60 s) zählt nicht.
    const pure = EVENTS.flatMap((e) => e.options).filter((o) => o.effects.every((x) => x.kind === 'seedsNow'));
    const seedSeconds = pure.flatMap((o) => o.effects.map((x) => (x.kind === 'seedsNow' ? x.seconds : 0)));
    expect(span(seedSeconds)).toBe('90–150');
    expect(t).toContain(`in ${span(seedSeconds)} Sekunden sammelst, mindestens ${formatNumber(SEED_SECONDS_MIN_SEEDS)} 🌰`);
    expect(t).toContain('„+25 % 🌿 für 5 Min.“');
    expect(t).toContain('sofern etwas passt');
    expect(t).not.toContain('z. B.');
    expect(t).toContain(`Ab „${STAGES[INTERLUDE_STAGE]!.name}“ gibt es zwischen zwei Wegpunkten einen Zwischenhalt`);
    expect(t).toContain(`${formatNumber(INTERLUDE_CHANCE * 100)} %`);
  });

  it('Gäste: Anzahl, Bewirten in Samen-Sekunden, Dank und Aufenthalt aus content', () => {
    const t = text('visitors');
    expect(t).toContain(`${formatNumber(VISITORS.length)} verschiedene`);
    expect(t).toContain('höchstens einmal pro Zyklus');
    expect(t).toContain(`Samen-Sekunden: so viele Samen, wie du in ${span(VISITORS.map((v) => v.hostCost))} Sekunden sammelst`);
    expect(t).toContain(`die Samen von ${span(VISITORS.map((v) => v.farewellSeeds))} Sekunden`);
    expect(t).toContain(`mindestens ${formatNumber(SEED_SECONDS_MIN_SEEDS)} 🌰`);
    expect(t).toContain(`${span(VISITORS.map((v) => v.stay / 60))} Minuten`);
  });

  it('Forschung: Vorrat, Anzahl, Äste, Stufe und die Gabeln aus content (27.7)', () => {
    const t = text('care');
    expect(t).toContain(`${formatNumber(RESEARCH.length)} Knoten in ${formatNumber(RESEARCH_BRANCHES.length)} Ästen`);
    expect(t).toContain(`Ab „${STAGES[Math.min(...RESEARCH.map((n) => n.minStage))]!.name}“`);
    expect(t).toContain('Vorrat ⚖️');
    expect(t).toContain('Ausgeben senkt ihn nie');
    expect(t).toContain('bis zum Neuen Zyklus');
    expect(t).toContain('„Lichte Krone“ und „Dichte Krone“ schließen sich aus');
    // Jede Gabel genau einmal.
    expect(t.match(/schließen sich aus/g)).toHaveLength(RESEARCH_FORKS.length);
  });

  it('Kennarten (26.3) erst mit der Landschaft beim Namen – auch nicht unter den Nachtaktiven', () => {
    const all = (landscape: boolean) => JSON.stringify(guideSections({ landscape }));
    for (const name of ['Haselmaus', 'Ziegenmelker', 'Biber', 'Moorfrosch', 'Luchs', 'Stachelbart']) expect(all(false), name).not.toContain(name);
    expect(all(true)).toContain('Haselmaus');
    expect(all(true)).toContain('Ziegenmelker');
  });

  it('Zahlen stammen aus content und core', () => {
    expect(text('growth')).toContain(`${formatNumber(WAYPOINT_COUNT)} Wegpunkte`);
    expect(text('growth')).toContain(STAGES[STAGES.length - 1]!.name);
    expect(text('encounters')).toContain(`höchstens ${formatNumber(MAX_PENDING_ENCOUNTERS)}`);
    expect(text('encounters')).toContain(`Ablehnen bringt die Samen von ${formatNumber(DECLINE_SEED_SECONDS)} Sekunden, mindestens 5 🌰`);
    expect(text('encounters')).toContain(`${formatNumber(REROLL_BASE_COST)} 🌰`);
    expect(text('niches')).toContain(`${formatNumber(NICHES.length)} Nischen`);
    expect(text('sowing')).toContain(`${formatNumber(PLANTS.length)} verschiedene`);
    expect(text('sowing')).toContain(`Danach kostet Säen ${formatNumber(SOWING_BASE)} 🌰, jede weitere Aussaat im Zyklus ×${formatNumber(SOWING_GROWTH)}`);
    expect(text('sowing')).toContain('Im Frühling ist Saatzeit: Säen kostet 20 % weniger.');
    expect(text('sowing')).toContain('„Saatgut sortieren“, „Samenbank“ und „Anzuchtbeet“');
    expect(text('encounters')).toContain('Pflanzen kommen nicht über Begegnungen');
    expect(JSON.stringify(sections)).not.toContain('keimt');
    // Vor der Landschaft ohne die Kennarten (26.3), danach alle.
    expect(text('communities')).toContain(`${formatNumber(COMMON_SPECIES.length)} Arten`);
    expect(guideSections({ landscape: true }).find((s) => s.id === 'communities')!.paragraphs.join(' ')).toContain(`${formatNumber(SPECIES.length)} Arten`);
    expect(text('communities')).toContain(`${formatNumber(COMMUNITIES.length)} Lebensgemeinschaften`);
    for (const t of TRAIT_THRESHOLDS) expect(text('communities')).toContain(formatNumber(t));
    expect(text('harmony')).toContain(`+${formatNumber(100 / HARMONY_DIVISOR)} %`);
    expect(text('cycle')).toContain(`„${STAGES[NEW_CYCLE_MIN_STAGE]!.name}“`);
    expect(text('cycle')).toContain(`+${formatNumber(FOREST_MEMORY_BONUS * 100)} %`);
    expect(text('cycle')).toContain(`Je ${formatNumber(MEMORY_PER_REGULAR_SLOT)} Punkte`);
    // Waldgedächtnis-Regel (Schritt 2.11): Einzahl bei 1 Punkt je Art; Schwelle gleitet mit dem
    // Wegpunkt (Schritt 2.11b), genannt für Hain, Wald und Urwald – im Hain wie in 2.11. Der
    // Sockel-Teiler gleitet mit (Abgleich mit der Sperrklinke): im Hain 5, im Wald 6, im Urwald 7.
    expect(text('cycle')).toContain('1 Punkt je neu entdeckter Art');
    expect(text('cycle')).toContain('1 Punkt je 5 Punkte deiner höchsten Harmonie in diesem Zyklus (im Wald je 6 und im Urwald je 7 – später zählt mehr, was über der Schwelle liegt).');
    expect(text('cycle')).toContain('Bonus gibt es im Hain ab 101 (bis 115), im Wald ab 149 (bis 164) und im Urwald ab 165 (bis 180)');
    for (let stage = NEW_CYCLE_MIN_STAGE + 1; stage < STAGES.length; stage++) {
      expect(text('cycle')).toContain(`im ${STAGES[stage]!.name} je ${formatNumber(memoryHarmonyBonus(STAGES[stage]!.waypoint).divisor)}`);
    }
    for (let stage = NEW_CYCLE_MIN_STAGE; stage < STAGES.length; stage++) {
      const b = memoryHarmonyBonus(STAGES[stage]!.waypoint);
      expect(text('cycle')).toContain(`im ${STAGES[stage]!.name} ab ${formatNumber(b.bonusFrom)} (bis ${formatNumber(b.fullAt)})`);
    }
    // Früchte aller Hauptbaum-Arten (DESIGN_V2.md 17).
    for (const fruit of ['Eichel', 'Buchecker', 'Kiefernsamen']) expect(text('cycle')).toContain(fruit);
    expect(text('seasons')).toContain(`${formatNumber(SEASON_SECONDS / 60)} Minuten`);
    expect(text('seasons')).toContain('⚙️ Einstellungen → Klang');
    for (const season of SEASONS) expect(text('seasons')).toContain(season.summary);
  });
});

describe('Anzeigedauer der Hinweise nach Textlänge', () => {
  it('kurze Texte: Grunddauer; lange länger, höchstens doppelt', () => {
    expect(toastDurationFor('Kurz.', TOAST_MS)).toBe(TOAST_MS);
    expect(toastDurationFor('x'.repeat(TOAST_BASE_CHARS), TOAST_MS)).toBe(TOAST_MS);
    expect(toastDurationFor('x'.repeat(TOAST_BASE_CHARS + 20), TOAST_MS)).toBe(TOAST_MS + 20 * TOAST_MS_PER_CHAR);
    expect(toastDurationFor('x'.repeat(5000), TOAST_MS)).toBe(2 * TOAST_MS);
    // Emojis zählen als ein Zeichen.
    expect(toastDurationFor('🌙'.repeat(TOAST_BASE_CHARS), TOAST_MS)).toBe(TOAST_MS);
  });
});
