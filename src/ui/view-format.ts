/**
 * Reine Formatierungshilfen für die v2-Komponenten (kein DOM, keine Spielregeln).
 * Getestet in tests/ui-view.test.ts.
 */
import { formatNumber } from './format';
import type { PreviewView, Rarity, ReplaceOptionView, Tone } from './view-model';

export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'gewöhnlich',
  rare: 'selten',
  special: 'besonders',
  legendary: 'legendär',
};

/** Typografisches Minus statt Bindestrich. */
const MINUS = '−';

/** Auf eine Nachkommastelle runden – wie in der Anzeige. */
function roundDisplay(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Vorzeichenbehaftete Zahl: „+6“, „−7“, „±0“. */
export function formatSigned(value: number): string {
  const rounded = roundDisplay(value);
  if (rounded === 0) return '±0';
  const text = formatNumber(Math.abs(rounded));
  return rounded > 0 ? `+${text}` : `${MINUS}${text}`;
}

/** Bruchteil als vorzeichenbehaftete Prozentangabe: 0,05 → „+5 %“, −0,075 → „−7,5 %“. */
export function formatSignedPercent(fraction: number): string {
  return `${formatSigned(fraction * 100)} %`;
}

/** Anteil als Prozent ohne Vorzeichen: 0,754 → „75 %“. */
export function formatPercent(fraction: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  return `${Math.round(clamped * 100)} %`;
}

/** Bewertung passend zur Anzeige von `formatSigned`: was als „±0“ erscheint, ist neutral. */
export function toneOf(value: number): Tone {
  const rounded = roundDisplay(value);
  if (rounded > 0) return 'good';
  if (rounded < 0) return 'bad';
  return 'neutral';
}

/** Bewertung eines Bruchteils passend zu `formatSignedPercent` (0,0003 → „±0 %“ → neutral). */
export function percentToneOf(fraction: number): Tone {
  return toneOf(fraction * 100);
}

/** Symbol zur Bewertung – damit gut/schlecht nicht nur über Farbe erkennbar ist. */
export function toneSymbol(tone: Tone): string {
  return tone === 'good' ? '▲' : tone === 'bad' ? '▼' : '•';
}

export interface PreviewPart {
  key: 'harmony' | 'growth' | 'seeds' | 'happiness' | 'supply';
  icon: string;
  /** Vollständiger Text für Screenreader, z. B. „Harmonie +6“. */
  text: string;
  /** Kurzer Wert für die Anzeige, z. B. „+6“. */
  value: string;
  tone: Tone;
}

/**
 * Vorschau einer Karte als Liste von Zeilen.
 * Harmonie und Wachstum erscheinen immer, Samen nur wenn angegeben und ≠ 0,
 * Zufriedenheit nur bei Tieren.
 */
export function previewParts(preview: PreviewView): PreviewPart[] {
  const parts: PreviewPart[] = [
    {
      key: 'harmony',
      icon: '⚖️',
      value: formatSigned(preview.harmonyDelta),
      text: `Harmonie ${formatSigned(preview.harmonyDelta)}`,
      tone: toneOf(preview.harmonyDelta),
    },
    {
      key: 'growth',
      icon: '🌿',
      value: formatSignedPercent(preview.growthDelta),
      text: `Wachstum ${formatSignedPercent(preview.growthDelta)}`,
      tone: percentToneOf(preview.growthDelta),
    },
  ];
  if (preview.seedDelta !== undefined && percentToneOf(preview.seedDelta) !== 'neutral') {
    parts.push({
      key: 'seeds',
      icon: '🌰',
      value: formatSignedPercent(preview.seedDelta),
      text: `Samen ${formatSignedPercent(preview.seedDelta)}`,
      tone: percentToneOf(preview.seedDelta),
    });
  }
  if (preview.happiness !== undefined) {
    parts.push({
      key: 'happiness',
      icon: '😊',
      value: formatPercent(preview.happiness),
      text: `Zufriedenheit ${formatPercent(preview.happiness)}`,
      tone: 'neutral',
    });
  }
  if (preview.supply !== undefined) {
    const delta = preview.supplyDelta ?? 0;
    parts.push({
      key: 'supply',
      icon: '☀️💧',
      value: `${formatPercent(preview.supply)} versorgt`,
      text: `Versorgung mit Licht und Wasser ${formatPercent(preview.supply)}`,
      // Nur ein Rückgang (oder Anstieg) zählt – volle Versorgung bleibt neutral.
      tone: delta < -0.005 ? 'bad' : delta > 0.005 ? 'good' : 'neutral',
    });
  }
  return parts;
}

/** Stufe der Zufriedenheit für die Farbe des Rings. */
export function happinessLevel(happiness: number): 'high' | 'mid' | 'low' {
  if (happiness >= 0.75) return 'high';
  if (happiness >= 0.4) return 'mid';
  return 'low';
}

export interface FamilyProgress {
  /** Index der höchsten erreichten Schwelle, −1 = keine. */
  activeTier: number;
  /** Nächste Schwelle oder null, wenn alle erreicht sind. */
  next: number | null;
}

export function familyProgress(count: number, thresholds: readonly number[]): FamilyProgress {
  let activeTier = -1;
  thresholds.forEach((t, i) => {
    if (count >= t) activeTier = i;
  });
  return { activeTier, next: thresholds[activeTier + 1] ?? null };
}

/** Kurzer Zähler für die Gattungsleiste: „1/2“, „3/5“, „5 ✓“. */
export function familyCountLabel(count: number, thresholds: readonly number[]): string {
  const { next } = familyProgress(count, thresholds);
  return next === null ? `${count} ✓` : `${count}/${next}`;
}

/** Beschreibung der Gattung für Hinweise/Screenreader. */
export function familyDescription(
  label: string,
  count: number,
  thresholds: readonly number[],
  bonuses: readonly string[],
): string {
  const { activeTier, next } = familyProgress(count, thresholds);
  const parts = [`${label}: ${count}`];
  if (activeTier >= 0) parts.push(`aktiv: ${bonuses[activeTier] ?? ''}`.trim());
  if (next !== null) {
    const nextBonus = bonuses[activeTier + 1];
    parts.push(`ab ${next}: ${nextBonus ?? ''}`.trim());
  }
  return parts.join(' · ');
}

/** „noch 2 weitere Begegnungen warten“ – leer, wenn keine wartet. */
export function queuedText(queued: number): string {
  if (queued <= 0) return '';
  if (queued === 1) return 'noch 1 weitere Begegnung wartet';
  return `noch ${formatNumber(queued)} weitere Begegnungen warten`;
}

export function rerollLabel(cost: number): string {
  return `Neu würfeln (${MINUS}${formatNumber(cost)} 🌰)`;
}

export function declineLabel(reward: number): string {
  return `Ablehnen (+${formatNumber(reward)} 🌰)`;
}

/** Hinweis bei voller Nische: „Nische Krone voll – ersetzt Rotkehlchen“. */
export function replaceHint(nicheLabel: string, replacedName: string | undefined): string {
  const full = `Nische ${nicheLabel} voll`;
  return replacedName ? `${full} – ersetzt ${replacedName}` : full;
}

/**
 * Samenvorrat im Kopf der Auswahl „Pflanze setzen“. `cost` ist exakt: Ob es reicht,
 * entscheidet derselbe Vergleich wie im Kern; die fehlende Menge wird aufgerundet.
 */
export function seedsLine(seeds: number, cost: number): string {
  const have = `Du hast ${formatNumber(Math.floor(Math.max(0, seeds)))} 🌰`;
  if (!(cost > 0) || seeds >= cost) return have;
  return `${have} – noch ${formatNumber(Math.ceil(cost - seeds))} 🌰 bis zur nächsten Pflanze`;
}

/** Hinweis bei vollem Platz mit gewähltem Ersatz: „Pflanzring voll – ersetzt Hasel“. */
export function swapHint(fullText: string, replacedName: string | undefined): string {
  return replacedName ? `${fullText} – ersetzt ${replacedName}` : fullText;
}

/** Plätze einer Nische: „2/3 belegt“ oder „verschlossen“. */
export function nicheSlotsLabel(used: number, capacity: number): string {
  if (capacity <= 0) return 'verschlossen';
  return `${used}/${capacity} belegt`;
}

const multiplier = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Multiplikator: 1,384 → „×1,38“. */
export function formatMultiplier(value: number): string {
  return `×${multiplier.format(value)}`;
}

/** Harmonie-Baustein mit Vorzeichen; Abzüge mit typografischem Minus. */
export function formatHarmonyPart(value: number): string {
  return formatSigned(value);
}

/**
 * Vorauswahl beim Ersetzen: die erste wählbare Option, die keine Lebensgemeinschaft
 * auflöst – gibt es keine, die erste wählbare.
 */
export function preferredReplaceOption(options: readonly ReplaceOptionView[]): ReplaceOptionView | undefined {
  const usable = options.filter((o) => !o.disabledReason);
  return usable.find((o) => !o.preview?.communities?.some((c) => c.tone === 'bad')) ?? usable[0];
}
