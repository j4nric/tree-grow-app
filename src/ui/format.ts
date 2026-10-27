const small = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const mantissa = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/**
 * Deutsche Kürzel der langen Skala. `Intl` kürzt höchstens auf „Bio.“ („1234 Bio.“) – darum
 * eigene Stufen bis zur Trilliarde, darüber wissenschaftlich („1,23·10²⁴“).
 */
const SCALES: readonly { readonly value: number; readonly suffix: string }[] = [
  { value: 1e6, suffix: 'Mio.' },
  { value: 1e9, suffix: 'Mrd.' },
  { value: 1e12, suffix: 'Bio.' },
  { value: 1e15, suffix: 'Brd.' },
  { value: 1e18, suffix: 'Trio.' },
  { value: 1e21, suffix: 'Trd.' },
];

/** Ab hier wissenschaftlich: 1.000 Trilliarden. */
export const SCIENTIFIC_LIMIT = 1e24;

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => (d === '-' ? '⁻' : SUPERSCRIPT[Number(d)]))
    .join('');
}

/** Kurzform ab einer Million: „1,23 Mio.“ … „5,6 Trio.“, ab 1e24 „1,23·10²⁴“. */
function formatCompact(value: number): string {
  const sign = value < 0 ? '-' : ''; // wie Intl bei kleinen Zahlen
  const abs = Math.abs(value);
  if (abs < SCIENTIFIC_LIMIT) {
    for (let i = SCALES.length - 1; i >= 0; i--) {
      const scale = SCALES[i]!;
      if (abs < scale.value) continue;
      const m = Math.round((abs / scale.value) * 100) / 100;
      // 999,996 Mio. rundet auf 1000 – dann gleich die nächste Stufe („1 Mrd.“).
      if (m >= 1000) {
        const next = SCALES[i + 1];
        if (next) return `${sign}${mantissa.format(m / 1000)}\u00a0${next.suffix}`;
        break;
      }
      return `${sign}${mantissa.format(m)}\u00a0${scale.suffix}`;
    }
  }
  let exp = Math.floor(Math.log10(abs));
  let m = Math.round((abs / 10 ** exp) * 100) / 100;
  if (m >= 10) {
    m /= 10;
    exp += 1;
  }
  return `${sign}${mantissa.format(m)}·10${superscript(exp)}`;
}

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
 * Zahlen deutsch formatiert: 12,5 · 1.234 · 119.900 · 3,45 Mio. (bzw. 3.450.000) · 1,23 Brd. ·
 * 1,23·10²⁴.
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
  return formatCompact(value);
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
 * Anzeige-Text: Zahl und folgendes Symbol bleiben zusammen („2 🪶“ bricht nicht vor 🪶 um,
 * „+11,5 %“ nicht vor „%“) – geschütztes Leerzeichen statt des normalen. Vorgelesen wird
 * derselbe Text.
 */
export function keepNumberWithIcon(text: string): string {
  return text.replace(/(\d) (?=%|\p{Extended_Pictographic})/gu, '$1\u00a0');
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
