const small = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 2 });

/**
 * Zahlenformat (Einstellung „Zahlenformat“): `short` kürzt ab einer Million („3,45 Mio.“),
 * `long` schreibt aus („3.450.000“) – bis unter LONG_NUMBER_LIMIT, darüber wird auch dann
 * gekürzt, damit riesige Zahlen die Seitenleiste nicht sprengen.
 */
export type NumberStyle = 'short' | 'long';

/** Ab hier kürzt auch das ausgeschriebene Format (1 Billion). */
export const LONG_NUMBER_LIMIT = 1e12;

let numberStyle: NumberStyle = 'short';

/** Setzt das Zahlenformat für alle folgenden Aufrufe (aus den Einstellungen). */
export function setNumberStyle(style: NumberStyle): void {
  numberStyle = style;
}

export function getNumberStyle(): NumberStyle {
  return numberStyle;
}

/**
 * Zahlen deutsch formatiert: 12,5 · 1.234 · 119.900 · 3,45 Mio. (bzw. 3.450.000).
 * `style` überschreibt das eingestellte Zahlenformat (z. B. für Beispiele).
 */
export function formatNumber(value: number, style: NumberStyle = numberStyle): string {
  if (!Number.isFinite(value)) return '∞';
  const abs = Math.abs(value);
  if (abs < 10_000) return small.format(value);
  // Deutsch kürzt Tausender nicht ab („Tsd.“ ist unüblich) – dort ohne Nachkommastellen.
  if (abs < 1_000_000) return whole.format(value);
  if (style === 'long' && abs < LONG_NUMBER_LIMIT) return whole.format(value);
  return compact.format(value);
}

export function formatRate(value: number): string {
  return `${formatNumber(value)}/s`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} Std. ${m} Min.` : `${h} Std.`;
  if (m > 0) return `${m} Min.`;
  return `${Math.floor(seconds)} Sek.`;
}
