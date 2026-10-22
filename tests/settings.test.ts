import { afterEach, describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { COMMUNITIES } from '../src/content/communities';
import { CARE } from '../src/content/care';
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
import { PLANT_COST_BASE, PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { TRAIT_THRESHOLDS } from '../src/content/traits';
import { VISITORS } from '../src/content/visitors';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { HARMONY_DIVISOR, memoryHarmonyBonus } from '../src/core/formulas';
import { LONG_NUMBER_LIMIT, formatNumber, getNumberStyle, setNumberStyle } from '../src/ui/format';
import { guideSections, span } from '../src/ui/guide-view';
import { SEASONS, SEASON_SECONDS } from '../src/content/seasons';
import {
  DEFAULT_SETTINGS,
  GUIDE_HINT_KEY,
  LONG_TOAST_MS,
  SETTINGS_KEY,
  TOAST_MS,
  effectiveReducedMotion,
  loadSettings,
  parseSettings,
  saveSettings,
  serializeSettings,
  takeFirstStartHint,
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

  it('18 Abschnitte, keine Platzhalter „kommt bald“ mehr', () => {
    expect(sections.map((s) => s.id)).toEqual([
      'growth',
      'encounters',
      'niches',
      'habitats',
      'predation',
      'plants',
      'communities',
      'harmony',
      'cycle',
      'seasons',
      'weather',
      'night',
      'seeds',
      'events',
      'visitors',
      'care',
      'achievements',
      'daily',
    ]);
    for (const s of sections) {
      expect(s.soon, s.id).toBeFalsy();
      expect(s.paragraphs.join(' '), s.id).not.toContain('kommt bald');
      expect(s.title.length, s.id).toBeGreaterThan(0);
      expect(s.paragraphs.length, s.id).toBeGreaterThan(0);
    }
  });

  it('Erfolge: Anzahl aus content, Fundort Naturtagebuch, keine Eile', () => {
    const t = text('achievements');
    expect(t).toContain(`${formatNumber(ACHIEVEMENTS.length)} leise Erfolge`);
    expect(t).toContain('Naturtagebuch');
    expect(t).toContain('Reiter „Erfolge“');
    expect(t).toContain('keine Eile');
    expect(t).toContain('keine Zeitlimits');
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

  it('Pflege: Anzahl, Ränge, Stufe und die sich ausschließenden Kronen aus content', () => {
    const t = text('care');
    expect(t).toContain(`${formatNumber(CARE.length)} Pflegemaßnahmen`);
    expect(t).toContain(`${span(CARE.map((c) => c.ranks.length))} Ränge`);
    expect(t).toContain(`Ab „${STAGES[Math.min(...CARE.map((c) => c.ranks[0]!.minStage))]!.name}“`);
    expect(t).toContain('bis zum Neuen Zyklus');
    expect(t).toContain('„Lichte Krone“ und „Dichte Krone“ schließen sich aus');
    // Jedes Ausschluss-Paar genau einmal.
    expect(t.match(/schließen sich aus/g)).toHaveLength(CARE.filter((c) => c.excludes?.length).length / 2);
  });

  it('Zahlen stammen aus content und core', () => {
    expect(text('growth')).toContain(`${formatNumber(WAYPOINT_COUNT)} Wegpunkte`);
    expect(text('growth')).toContain(STAGES[STAGES.length - 1]!.name);
    expect(text('encounters')).toContain(`höchstens ${formatNumber(MAX_PENDING_ENCOUNTERS)}`);
    expect(text('encounters')).toContain(`Ablehnen bringt die Samen von ${formatNumber(DECLINE_SEED_SECONDS)} Sekunden, mindestens 5 🌰`);
    expect(text('encounters')).toContain(`${formatNumber(REROLL_BASE_COST)} 🌰`);
    expect(text('niches')).toContain(`${formatNumber(NICHES.length)} Nischen`);
    expect(text('plants')).toContain(`${formatNumber(PLANTS.length)} verschiedene`);
    expect(text('plants')).toContain(`${formatNumber(PLANT_COST_BASE)} 🌰`);
    expect(text('communities')).toContain(`${formatNumber(SPECIES.length)} Arten`);
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
