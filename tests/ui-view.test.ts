import { describe, expect, it } from 'vitest';
import {
  RARITY_LABELS,
  declineLabel,
  familyCountLabel,
  familyDescription,
  familyProgress,
  formatMultiplier,
  formatPercent,
  formatSigned,
  formatSignedPercent,
  happinessLevel,
  nicheSlotsLabel,
  percentToneOf,
  hasPreviewChanges,
  previewChips,
  previewParts,
  queuedText,
  replaceHint,
  rerollLabel,
  seedsLine,
  swapHint,
  toneOf,
  toneSymbol,
} from '../src/ui/view-format';

const NBSP = ' ';
const MINUS = '−';

describe('Vorzeichen und Prozent', () => {
  it('formatiert Zahlen mit Vorzeichen und typografischem Minus', () => {
    expect(formatSigned(6)).toBe('+6');
    expect(formatSigned(-7)).toBe(`${MINUS}7`);
    expect(formatSigned(0)).toBe('±0');
    expect(formatSigned(0.04)).toBe('±0');
    expect(formatSigned(14.5)).toBe('+14,5');
  });

  it('formatiert Bruchteile als Prozent', () => {
    expect(formatSignedPercent(0.05)).toBe(`+5${NBSP}%`);
    expect(formatSignedPercent(-0.075)).toBe(`${MINUS}7,5${NBSP}%`);
    expect(formatSignedPercent(0)).toBe(`±0${NBSP}%`);
    expect(formatPercent(0.754)).toBe(`75${NBSP}%`);
    expect(formatPercent(1.3)).toBe(`100${NBSP}%`);
    expect(formatPercent(-1)).toBe(`0${NBSP}%`);
  });

  it('formatiert Multiplikatoren mit zwei Nachkommastellen', () => {
    expect(formatMultiplier(1.384)).toBe('×1,38');
    expect(formatMultiplier(1)).toBe('×1,00');
  });
});

describe('Bewertung', () => {
  it('ordnet Werte gut/schlecht/neutral zu und zeigt ein Symbol', () => {
    expect(toneOf(0.1)).toBe('good');
    expect(toneOf(-2)).toBe('bad');
    expect(toneOf(0)).toBe('neutral');
    expect(toneOf(0.04)).toBe('neutral'); // erscheint als „±0“
    expect(percentToneOf(0.0003)).toBe('neutral'); // erscheint als „±0 %“
    expect(percentToneOf(-0.002)).toBe('bad');
    expect(new Set([toneSymbol('good'), toneSymbol('bad'), toneSymbol('neutral')]).size).toBe(3);
  });

  it('hat deutsche Namen für alle Seltenheiten', () => {
    expect(RARITY_LABELS).toEqual({
      common: 'gewöhnlich',
      rare: 'selten',
      special: 'besonders',
      legendary: 'legendär',
    });
  });
});

describe('Vorschau', () => {
  it('zeigt Harmonie und Wachstum, wenn sie sich ändern', () => {
    const parts = previewParts({ harmonyDelta: 6, growthDelta: -0.07 });
    expect(parts.map((p) => p.key)).toEqual(['harmony', 'growth']);
    expect(parts[0]).toMatchObject({ text: 'Harmonie +6', value: '+6', tone: 'good' });
    expect(parts[1]).toMatchObject({ text: `Wachstum ${MINUS}7${NBSP}%`, tone: 'bad' });
  });

  it('einheitliche Regel: Änderungen nur, wenn sie gerundet ≠ 0 sind (kein „±0“-Chip)', () => {
    // Was als „±0“ erschiene, fällt weg – bei allen Kartenarten gleich.
    expect(previewParts({ harmonyDelta: 0.02, growthDelta: 0.0003, seedDelta: 0.0002 })).toEqual([]);
    // Mittsommer-Fall: Option mit Harmonie, aber ohne Wachstum → nur der Harmonie-Chip.
    expect(previewParts({ harmonyDelta: 4, growthDelta: 0, seedDelta: 0.1 }).map((p) => p.key)).toEqual(['harmony', 'seeds']);
    expect(previewParts({ harmonyDelta: 0, growthDelta: 0.05, seedDelta: 0 }).map((p) => p.key)).toEqual(['growth']);
    expect(previewParts({ harmonyDelta: 0, growthDelta: 0, seedDelta: 0 }).some((p) => p.value.includes('±0'))).toBe(false);
  });

  it('zeigt Samen nur, wenn sie sich ändern, und Zufriedenheit immer (neutral)', () => {
    expect(previewParts({ harmonyDelta: 1, growthDelta: 0, seedDelta: 0 }).map((p) => p.key)).toEqual(['harmony']);
    const parts = previewParts({ harmonyDelta: 1, growthDelta: 0.06, seedDelta: 0.12, happiness: 0.55 });
    expect(parts.map((p) => p.key)).toEqual(['harmony', 'growth', 'seeds', 'happiness']);
    expect(parts[2]!.text).toBe(`Samen +12${NBSP}%`);
    expect(parts[3]).toMatchObject({ text: `Zufriedenheit 55${NBSP}%`, tone: 'neutral' });
    expect(previewParts({ harmonyDelta: 0, growthDelta: 0, happiness: 0.3 }).map((p) => p.key)).toEqual(['happiness']);
  });

  it('ab +200 % mit bekannter Rate absolut („+0,8/s“ statt „+551,9 %“), sonst Prozent', () => {
    const big = previewParts({ harmonyDelta: 0, growthDelta: 0.275, seedDelta: 5.519, growthPerSec: 0.55, seedsPerSec: 0.8 });
    expect(big.find((p) => p.key === 'growth')!.value).toBe(`+27,5${NBSP}%`);
    expect(big.find((p) => p.key === 'seeds')).toMatchObject({ value: '+0,8/s', text: 'Samen +0,8/s', tone: 'good' });
    // Genau +200 % zählt schon als groß; Rückgänge mit typografischem Minus.
    expect(previewParts({ harmonyDelta: 0, growthDelta: 2, growthPerSec: 3 })[0]!.value).toBe('+3/s');
    expect(previewParts({ harmonyDelta: 0, growthDelta: -0.75, growthPerSec: -3 })[0]!.value).toBe(`${MINUS}75${NBSP}%`);
    // Ohne Rate (Ereignis-Optionen) oder bei gerundet 0/s bleibt es bei Prozent.
    expect(previewParts({ harmonyDelta: 0, growthDelta: 0, seedDelta: 3 })[0]!.value).toBe(`+300${NBSP}%`);
    expect(previewParts({ harmonyDelta: 0, growthDelta: 0, seedDelta: 3, seedsPerSec: 0.02 })[0]!.value).toBe(`+300${NBSP}%`);
  });
});

describe('„keine Änderung“-Chip', () => {
  it('steht vorn, wenn nichts an Harmonie, Wachstum und Samen sich ändert – auch vor Zustands-Chips', () => {
    expect(previewChips({ harmonyDelta: 0, growthDelta: 0 })).toEqual(['none']);
    const chips = previewChips({ harmonyDelta: 0.01, growthDelta: 0, happiness: 0.3 });
    expect(chips.map((c) => (c === 'none' ? c : c.key))).toEqual(['none', 'happiness']);
    const plant = previewChips({ harmonyDelta: 0, growthDelta: 0, supply: 1, supplyDelta: 0 });
    expect(plant.map((c) => (c === 'none' ? c : c.key))).toEqual(['none', 'supply']);
  });

  it('fehlt, sobald sich etwas ändert', () => {
    const chips = previewChips({ harmonyDelta: 2, growthDelta: 0, happiness: 0.8 });
    expect(chips).not.toContain('none');
    expect(hasPreviewChanges(previewParts({ harmonyDelta: 0, growthDelta: 0, happiness: 0.8 }))).toBe(false);
    expect(hasPreviewChanges(previewParts({ harmonyDelta: 0, growthDelta: 0.05 }))).toBe(true);
  });
});

describe('Zufriedenheit', () => {
  it('teilt in drei Stufen', () => {
    expect(happinessLevel(1)).toBe('high');
    expect(happinessLevel(0.75)).toBe('high');
    expect(happinessLevel(0.5)).toBe('mid');
    expect(happinessLevel(0.39)).toBe('low');
  });
});

describe('Gattungsleiste', () => {
  const thresholds = [2, 3, 5];
  const bonuses = ['Insektenschaden −25 %', '+15 % Samen', '+20 % Wachstum, +20 % Samen'];

  it('findet aktive Stufe und nächste Schwelle', () => {
    expect(familyProgress(0, thresholds)).toEqual({ activeTier: -1, next: 2 });
    expect(familyProgress(2, thresholds)).toEqual({ activeTier: 0, next: 3 });
    expect(familyProgress(4, thresholds)).toEqual({ activeTier: 1, next: 5 });
    expect(familyProgress(6, thresholds)).toEqual({ activeTier: 2, next: null });
  });

  it('zeigt einen kurzen Zähler', () => {
    expect(familyCountLabel(1, thresholds)).toBe('1/2');
    expect(familyCountLabel(3, thresholds)).toBe('3/5');
    expect(familyCountLabel(5, thresholds)).toBe(`5${NBSP}✓`);
  });

  it('beschreibt aktiven und nächsten Bonus', () => {
    expect(familyDescription('Vögel', 1, thresholds, bonuses)).toBe('Vögel: 1 · ab 2: Insektenschaden −25 %');
    expect(familyDescription('Vögel', 3, thresholds, bonuses)).toBe(
      'Vögel: 3 · aktiv: +15 % Samen · ab 5: +20 % Wachstum, +20 % Samen',
    );
    expect(familyDescription('Vögel', 5, thresholds, bonuses)).toBe(
      'Vögel: 5 · aktiv: +20 % Wachstum, +20 % Samen',
    );
  });
});

describe('Texte im Dialog und in den Nischen', () => {
  it('nennt wartende Begegnungen', () => {
    expect(queuedText(0)).toBe('');
    expect(queuedText(1)).toBe('noch 1 weitere Begegnung wartet');
    expect(queuedText(2)).toBe('noch 2 weitere Begegnungen warten');
  });

  it('beschriftet Neu würfeln und Ablehnen mit Samen', () => {
    expect(rerollLabel(36)).toBe(`Neu würfeln (${MINUS}36${NBSP}🌰)`);
    expect(declineLabel(1234)).toBe(`Ablehnen (+1.234${NBSP}🌰)`);
    // Samen-Sekunden: ab 10 ganze Samen, darunter eine Nachkommastelle.
    expect(declineLabel(143.6)).toBe(`Ablehnen (+144${NBSP}🌰)`);
    expect(declineLabel(7.25)).toBe(`Ablehnen (+7,3${NBSP}🌰)`);
    expect(declineLabel(5)).toBe(`Ablehnen (+5${NBSP}🌰)`);
  });

  it('weist auf volle Nischen hin', () => {
    expect(replaceHint('Krone', 'Rotkehlchen')).toBe('Nische Krone voll – ersetzt Rotkehlchen');
    expect(replaceHint('Krone', undefined)).toBe('Nische Krone voll');
  });

  it('zeigt belegte Plätze', () => {
    expect(nicheSlotsLabel(2, 3)).toBe('2/3 belegt');
    expect(nicheSlotsLabel(0, 0)).toBe('verschlossen');
  });
});

describe('Pflanzen', () => {
  it('Vorschau zeigt die Versorgung – schlechter nur bei Rückgang', () => {
    const parts = previewParts({ harmonyDelta: 2, growthDelta: 0.1, supply: 0.75, supplyDelta: -0.25 });
    expect(parts.map((p) => p.key)).toEqual(['harmony', 'growth', 'supply']);
    expect(parts[2]).toMatchObject({
      value: `75${NBSP}% versorgt`,
      text: `Versorgung mit Licht und Wasser 75${NBSP}%`,
      tone: 'bad',
    });
    expect(previewParts({ harmonyDelta: 0, growthDelta: 0, supply: 1, supplyDelta: 0 })[0]).toMatchObject({ key: 'supply', tone: 'neutral' });
    expect(previewParts({ harmonyDelta: 0, growthDelta: 0, supply: 0.8, supplyDelta: 0.1 })[0]).toMatchObject({ key: 'supply', tone: 'good' });
  });

  it('Ersetzen-Hinweis für den Pflanzring', () => {
    expect(swapHint('Pflanzring voll', 'Hasel')).toBe('Pflanzring voll – ersetzt Hasel');
    expect(swapHint('Pflanzring voll', undefined)).toBe('Pflanzring voll');
  });

  it('Samenzeile der Auswahl: exakter Vergleich, fehlende Menge aufgerundet', () => {
    expect(seedsLine(137.5, 137.18)).toBe('Du hast 137 🌰');
    expect(seedsLine(137.1, 137.18)).toBe('Du hast 137 🌰 – noch 1 🌰 bis zur nächsten Pflanze');
    expect(seedsLine(10.9, 72.2)).toBe('Du hast 10 🌰 – noch 62 🌰 bis zur nächsten Pflanze');
    expect(seedsLine(-3, 20)).toBe('Du hast 0 🌰 – noch 23 🌰 bis zur nächsten Pflanze');
  });
});
