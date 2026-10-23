/**
 * Reine Formatierungshilfen für die v2-Komponenten (kein DOM, keine Spielregeln).
 * Getestet in tests/ui-view.test.ts.
 */
import { formatNumber } from './format';
import type { EncounterView, PreviewView, Rarity, ReplaceOptionView, Tone } from './view-model';

export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'gewöhnlich',
  rare: 'selten',
  special: 'besonders',
  legendary: 'legendär',
};

/**
 * Ab diesem Anteil gilt Futter in der Anzeige als ausreichend gedeckt (✓, kein „knapp“, kein
 * Futtergrund in der Stimmung). Nur Darstellung – die Zufriedenheit rechnet der Kern stetig.
 */
export const FOOD_ENOUGH = 0.9;

/** Futter da, aber unter `FOOD_ENOUGH` gedeckt. */
export function isScarceFood(food: number): boolean {
  return food > 0 && food < FOOD_ENOUGH;
}

/** Zufriedenheit, die gerundet als „100 %“ erscheint (wie `formatPercent`). */
export function isFullHappiness(happiness: number): boolean {
  return Math.round(Math.min(1, Math.max(0, happiness)) * 100) >= 100;
}

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

/**
 * Ab dieser relativen Änderung (+200 %) zeigt die Vorschau die absolute Rate („+0,8/s“):
 * Bei kleiner Basis (erste Pflanze) sagt „+551,9 %“ wenig (Playtest Schritt 14, K10).
 */
export const PREVIEW_ABSOLUTE_FROM = 2;

/** Vorzeichenbehaftete Rate: 0,8 → „+0,8/s“, −2 → „−2/s“. */
export function formatSignedRate(value: number): string {
  return `${formatSigned(value)}/s`;
}

/** Wert eines Raten-Chips: Prozent, bei sehr großer Änderung mit bekannter Rate absolut. */
function rateChipValue(fraction: number, perSec: number | undefined): string {
  if (perSec !== undefined && Number.isFinite(perSec) && Math.abs(fraction) >= PREVIEW_ABSOLUTE_FROM && roundDisplay(perSec) !== 0) {
    return formatSignedRate(perSec);
  }
  return formatSignedPercent(fraction);
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
 * Vorschau einer Karte als Liste von Zeilen. Einheitliche Regel für alle Karten (Tiere,
 * Pflanzen, Ereignis-Optionen, Gäste): Änderungen (Harmonie, Wachstum, Samen) erscheinen
 * nur, wenn sie in der Anzeige ≠ 0 sind – kein „±0“-Chip. Zustände (Zufriedenheit bei
 * Tieren, Versorgung bei Pflanzen) stehen immer da. Ohne Änderung → Chip „keine Änderung“
 * (siehe `previewChips`) bzw. bei Ereignis-Optionen und Gästen keine Vorschau.
 */
export function previewParts(preview: PreviewView): PreviewPart[] {
  const parts: PreviewPart[] = [];
  if (toneOf(preview.harmonyDelta) !== 'neutral') {
    parts.push({
      key: 'harmony',
      icon: '⚖️',
      value: formatSigned(preview.harmonyDelta),
      text: `Harmonie ${formatSigned(preview.harmonyDelta)}`,
      tone: toneOf(preview.harmonyDelta),
    });
  }
  if (percentToneOf(preview.growthDelta) !== 'neutral') {
    parts.push({
      key: 'growth',
      icon: '🌿',
      value: rateChipValue(preview.growthDelta, preview.growthPerSec),
      text: `Wachstum ${rateChipValue(preview.growthDelta, preview.growthPerSec)}`,
      tone: percentToneOf(preview.growthDelta),
    });
  }
  if (preview.seedDelta !== undefined && percentToneOf(preview.seedDelta) !== 'neutral') {
    parts.push({
      key: 'seeds',
      icon: '🌰',
      value: rateChipValue(preview.seedDelta, preview.seedsPerSec),
      text: `Samen ${rateChipValue(preview.seedDelta, preview.seedsPerSec)}`,
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

/** Vorschau ohne jede Änderung an Harmonie, Wachstum und Samen. */
export const NO_CHANGE_TEXT = 'keine Änderung an Harmonie, Wachstum und Samen';

/** Teile, die eine Änderung beschreiben (im Gegensatz zu Zuständen wie Zufriedenheit). */
const CHANGE_KEYS: ReadonlySet<PreviewPart['key']> = new Set(['harmony', 'growth', 'seeds']);

/** Ändert die Wahl etwas an Harmonie, Wachstum oder Samen (gerundet ≠ 0)? */
export function hasPreviewChanges(parts: readonly PreviewPart[]): boolean {
  return parts.some((p) => CHANGE_KEYS.has(p.key));
}

/**
 * Chips einer Tier-/Pflanzenkarte. Einheitliche Regel: Fehlt jede Änderung, steht vorn
 * ein Chip „keine Änderung“ – auch wenn Zustands-Chips (Zufriedenheit, Versorgung) folgen,
 * damit „ändert nichts“ nie mit „Vorschau fehlt“ verwechselt wird. 'none' = dieser Chip.
 */
export function previewChips(preview: PreviewView): Array<PreviewPart | 'none'> {
  const parts = previewParts(preview);
  return hasPreviewChanges(parts) ? parts : ['none', ...parts];
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

/** „1 Begegnung wartet“ / „3 Begegnungen warten“. */
export function waitingText(count: number): string {
  return count === 1 ? '1 Begegnung wartet' : `${formatNumber(count)} Begegnungen warten`;
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

/**
 * Samen für Knöpfe, Karten, Meldungen und schwebende Zahlen: ab 10 ganze Zahlen, darunter
 * eine Nachkommastelle – so zeigen Knopf („+144 🌰“) und schwebende Zahl dasselbe.
 */
export function seedsLabel(seeds: number): string {
  return formatNumber(seeds >= 10 ? Math.round(seeds) : Math.round(seeds * 10) / 10);
}

/** „Ablehnen (+N 🌰)“, gerundet wie seedsLabel. */
export function declineLabel(reward: number): string {
  return `Ablehnen (+${seedsLabel(reward)} 🌰)`;
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

// ---------------------------------------------------------------------------
// Legende der Symbole im Kartenwahl-Dialog
// ---------------------------------------------------------------------------

export type LegendKey = 'harmony' | 'growth' | 'seeds' | 'happiness' | 'supply' | 'conditions' | 'tone';

export interface LegendEntry {
  key: LegendKey;
  icon: string;
  text: string;
}

/** Alle Einträge der Legende in fester Reihenfolge (Vorschau-Symbole, Haken/Kreuze, ▲/▼). */
export const PREVIEW_LEGEND: readonly LegendEntry[] = [
  { key: 'harmony', icon: '⚖️', text: 'Harmonie – mehr Harmonie lässt alles schneller wachsen' },
  { key: 'growth', icon: '🌿', text: 'Wachstum pro Sekunde' },
  { key: 'seeds', icon: '🌰', text: 'Samen pro Sekunde' },
  { key: 'happiness', icon: '😊', text: 'erwartete Zufriedenheit des Tiers' },
  { key: 'supply', icon: '☀️💧', text: 'Versorgung der Pflanzen mit Licht und Wasser' },
  { key: 'conditions', icon: '✓ ~ ✗', text: 'Futter und Wünsche erfüllt, knapp oder nicht' },
  { key: 'tone', icon: '▲ ▼', text: 'Wirkung: Vorteil oder Nachteil' },
];

/**
 * Nur die Legenden-Einträge, deren Symbole in dieser Begegnung wirklich vorkommen – in
 * Vorschau-Chips, Kennzahlen, Wirkungszeilen oder Bedingungen. So erklärt die Legende bei
 * einem Ereignis keine Zufriedenheit und keine Haken. Leer → Legende ausblenden.
 */
export function legendEntries(view: EncounterView): LegendEntry[] {
  const found = new Set<LegendKey>();
  const scan = (text: string) => {
    if (text.includes('⚖️')) found.add('harmony');
    if (text.includes('🌿')) found.add('growth');
    // „+480 🌰 sofort“ ist ein Vorrat, keine Rate – nur Prozente zählen als „pro Sekunde“.
    if (/%\s*🌰/.test(text)) found.add('seeds');
    if (text.includes('☀️') || text.includes('💧')) found.add('supply');
  };
  for (const card of view.cards) {
    const previews = [card.preview, ...(card.replaceOptions ?? []).map((o) => o.preview)];
    for (const preview of previews) {
      if (preview) for (const part of previewParts(preview)) found.add(part.key);
    }
    for (const fact of card.facts ?? []) scan(fact.icon);
    for (const effect of card.effects) scan(effect.label);
    if ((card.conditions?.length ?? 0) > 0 || (card.replaceOptions ?? []).some((o) => (o.conditions?.length ?? 0) > 0)) {
      found.add('conditions');
    }
    // Ereignis-Optionen und Gäste markieren ihre Wirkungszeilen mit ▲/•/▼.
    if ((view.kind === 'event' || view.kind === 'visitor') && card.effects.length > 0) found.add('tone');
  }
  return PREVIEW_LEGEND.filter((entry) => found.has(entry.key));
}
