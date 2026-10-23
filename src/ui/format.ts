const small = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 2 });

/**
 * Zahlenformat (Einstellung „Zahlenformat“): `short` kürzt ab einer Million („3,45 Mio.“),
 * `long` schreibt aus („3.450.000“) – bis unter LONG_NUMBER_LIMIT, darüber wird auch dann
 * gekürzt, damit riesige Zahlen die Seitenleiste nicht sprengen.
 */
export type NumberStyle = 'short' | 'long';

/**
 * Ab hier kürzt auch das ausgeschriebene Format (100 Millionen): „99.999.999“ passt bei
 * 360 px gerade noch in eine Kachel der Seitenleiste, eine Stelle mehr nicht.
 */
export const LONG_NUMBER_LIMIT = 1e8;

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
  if (Number.isNaN(value)) return '–';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
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
  const total = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  // Ab einem Tag: Tage und Stunden (Minuten sind dann unwichtig), alle Zahlen deutsch formatiert.
  if (d > 0) {
    const days = `${formatNumber(d)} ${d === 1 ? 'Tag' : 'Tage'}`;
    return h > 0 ? `${days} ${formatNumber(h)} Std.` : days;
  }
  if (h > 0) return m > 0 ? `${formatNumber(h)} Std. ${formatNumber(m)} Min.` : `${formatNumber(h)} Std.`;
  if (m > 0) return `${formatNumber(m)} Min.`;
  return `${formatNumber(Math.floor(total))} Sek.`;
}

/**
 * Anzeige-Text: Zahl und folgendes Symbol bleiben zusammen („2 🪶“ bricht nicht vor 🪶 um) –
 * geschütztes Leerzeichen statt des normalen. Vorgelesen wird derselbe Text.
 */
export function keepNumberWithIcon(text: string): string {
  return text.replace(/(\d) (?=\p{Extended_Pictographic})/gu, '$1\u00a0');
}

/** Endet der Text schon mit einem Satzzeichen (auch vor schließenden Anführungszeichen oder Klammern)? */
const SENTENCE_END = /[.!?…:][“”"»)]*$/u;

/**
 * Mehrere Meldungen zu einer verbinden (Stempel, Rückkehr-Bericht): Jeder Teil endet mit einem
 * Satzzeichen – sonst liefe „… und 1 weitere“ direkt in „🪶 Ein Eichelhäher …“ hinein. Leere
 * Teile fallen weg. Ein einzelner Teil bleibt unverändert.
 */
export function joinSentences(...parts: readonly (string | null | undefined)[]): string {
  const list = parts.map((p) => (p ?? '').trim()).filter((p) => p.length > 0);
  if (list.length <= 1) return list[0] ?? '';
  return list.map((p) => (SENTENCE_END.test(p) ? p : `${p}.`)).join(' ');
}
