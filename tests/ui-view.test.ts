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
  previewParts,
  queuedText,
  replaceHint,
  rerollLabel,
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
  it('zeigt immer Harmonie und Wachstum', () => {
    const parts = previewParts({ harmonyDelta: 6, growthDelta: -0.07 });
    expect(parts.map((p) => p.key)).toEqual(['harmony', 'growth']);
    expect(parts[0]).toMatchObject({ text: 'Harmonie +6', value: '+6', tone: 'good' });
    expect(parts[1]).toMatchObject({ text: `Wachstum ${MINUS}7${NBSP}%`, tone: 'bad' });
  });

  it('leitet den Ton aus dem gerundeten Wert ab', () => {
    const parts = previewParts({ harmonyDelta: 0.02, growthDelta: 0.0003, seedDelta: 0.0002 });
    expect(parts.map((p) => p.key)).toEqual(['harmony', 'growth']);
    expect(parts[0]).toMatchObject({ value: '±0', tone: 'neutral' });
    expect(parts[1]).toMatchObject({ value: `±0${NBSP}%`, tone: 'neutral' });
  });

  it('zeigt Samen nur, wenn sie sich ändern, und Zufriedenheit neutral', () => {
    expect(previewParts({ harmonyDelta: 1, growthDelta: 0, seedDelta: 0 }).map((p) => p.key)).toEqual([
      'harmony',
      'growth',
    ]);
    const parts = previewParts({ harmonyDelta: 1, growthDelta: 0.06, seedDelta: 0.12, happiness: 0.55 });
    expect(parts.map((p) => p.key)).toEqual(['harmony', 'growth', 'seeds', 'happiness']);
    expect(parts[2]!.text).toBe(`Samen +12${NBSP}%`);
    expect(parts[3]).toMatchObject({ text: `Zufriedenheit 55${NBSP}%`, tone: 'neutral' });
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
