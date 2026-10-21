import { afterEach, describe, expect, it } from 'vitest';
import { COMMUNITIES } from '../src/content/communities';
import { DECLINE_SEEDS, MAX_PENDING_ENCOUNTERS, REROLL_BASE_COST } from '../src/content/encounters';
import { FOREST_MEMORY_BONUS, MEMORY_PER_REGULAR_SLOT, NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { NICHES } from '../src/content/niches';
import { PLANT_COST_BASE, PLANTS } from '../src/content/plants';
import { SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { TRAIT_THRESHOLDS } from '../src/content/traits';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { HARMONY_DIVISOR } from '../src/core/formulas';
import { LONG_NUMBER_LIMIT, formatNumber, getNumberStyle, setNumberStyle } from '../src/ui/format';
import { guideSections } from '../src/ui/guide-view';
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
  it('Standard: Automatisch, kurz, normale Hinweisdauer', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ motion: 'auto', numbers: 'short', longToasts: false });
  });

  it('robust: kaputtes JSON und unbekannte Werte → Standard (feldweise)', () => {
    expect(parseSettings('{kaputt')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('"on"')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ motion: 'turbo', numbers: 'long', longToasts: 'ja' }))).toEqual({
      motion: 'auto',
      numbers: 'long',
      longToasts: false,
    });
  });

  it('Roundtrip über serializeSettings', () => {
    const s = { motion: 'on' as const, numbers: 'long' as const, longToasts: true };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
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
    saveSettings({ motion: 'off', numbers: 'long', longToasts: true }, storage);
    expect(storage.data.get(SETTINGS_KEY)).toBeTruthy();
    expect(loadSettings(storage)).toEqual({ motion: 'off', numbers: 'long', longToasts: true });
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
    expect(formatNumber(LONG_NUMBER_LIMIT - 1)).toBe('999.999.999.999');
    expect(formatNumber(LONG_NUMBER_LIMIT * 3)).toMatch(/Bio\./);
    expect(formatNumber(Infinity)).toBe('∞');
  });
});

describe('Spielanleitung', () => {
  const sections = guideSections();
  const text = (id: string) => sections.find((s) => s.id === id)!.paragraphs.join(' ');

  it('8 Abschnitte zum Spielablauf und 3 Platzhalter „kommt bald“', () => {
    const main = sections.filter((s) => !s.soon);
    expect(main.map((s) => s.id)).toEqual([
      'growth',
      'encounters',
      'niches',
      'plants',
      'communities',
      'harmony',
      'cycle',
      'seeds',
    ]);
    const soon = sections.filter((s) => s.soon);
    expect(soon.map((s) => s.id)).toEqual(['events', 'visitors', 'care']);
    for (const s of soon) expect(s.paragraphs.join(' ')).toContain('kommt bald');
    for (const s of sections) {
      expect(s.title.length, s.id).toBeGreaterThan(0);
      expect(s.paragraphs.length, s.id).toBeGreaterThan(0);
    }
  });

  it('Zahlen stammen aus content und core', () => {
    expect(text('growth')).toContain(`${formatNumber(WAYPOINT_COUNT)} Wegpunkte`);
    expect(text('growth')).toContain(STAGES[STAGES.length - 1]!.name);
    expect(text('encounters')).toContain(`höchstens ${formatNumber(MAX_PENDING_ENCOUNTERS)}`);
    expect(text('encounters')).toContain(`+${formatNumber(DECLINE_SEEDS)} 🌰`);
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
  });
});
