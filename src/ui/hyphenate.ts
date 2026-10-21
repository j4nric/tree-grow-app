/**
 * Weiche Trennstellen (U+00AD) für lange deutsche Namen in der Anzeige, damit schmale
 * Kacheln „Busch-wind-rö-schen“ statt „Buschwindrösc|hen“ umbrechen.
 *
 * Nur für sichtbaren Text: Suchen, Vergleiche und aria-label bekommen den Namen ohne
 * Trennzeichen (die Inhaltsdaten bleiben unverändert). Die Regel ist eine einfache
 * Silbenheuristik – sie muss nicht perfekt sein, weil der Browser nur dann trennt, wenn
 * das Wort sonst nicht passt.
 */

export const SOFT_HYPHEN = '­';

/** Erst Wörter ab dieser Länge bekommen Trennstellen. */
const MIN_WORD = 12;
/** Mindestens so viele Buchstaben bleiben vor bzw. nach einer Trennstelle. */
const MIN_EDGE = 3;

const VOWEL = /^(?:ei|ai|au|eu|äu|ie|aa|ee|oo|[aeiouyäöü])/i;
/** Laute aus mehreren Buchstaben, die nie getrennt werden. */
const CONSONANT = /^(?:sch|ch|ck|ph|qu|th|[^aeiouyäöü])/i;
/** Silbenanfänge, die bei Häufungen ab drei Konsonanten zusammen auf die neue Zeile gehen. */
const ONSET_FROM_3 = new Set(['sp', 'st', 'pf', 'zw', 'schw', 'schl', 'schn', 'schm', 'schr']);
/** Verschluss- + Fließlaut: erst ab vier Konsonanten („Nacht-flie-ger“, aber „wind-rö“). */
const ONSET_FROM_4 = new Set(['tr', 'dr', 'br', 'bl', 'kr', 'kl', 'gr', 'gl', 'fr', 'fl', 'pl', 'pr']);
const ONSET3_FROM_4 = new Set(['str', 'spr', 'spl']);

interface Unit {
  text: string;
  vowel: boolean;
}

function units(word: string): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  while (i < word.length) {
    const rest = word.slice(i);
    const vowel = VOWEL.exec(rest);
    const match = vowel ?? CONSONANT.exec(rest);
    const text = match ? match[0] : rest[0]!;
    out.push({ text, vowel: vowel !== null });
    i += text.length;
  }
  return out;
}

/** Trennstellen (Zeichenindex, vor dem getrennt wird) eines einzelnen Worts. */
export function hyphenPoints(word: string): number[] {
  if (word.length < MIN_WORD) return [];
  const u = units(word);
  const starts: number[] = [];
  let pos = 0;
  for (const x of u) {
    starts.push(pos);
    pos += x.text.length;
  }
  const points: number[] = [];
  for (let i = 0; i < u.length; i++) {
    if (!u[i]!.vowel) continue;
    let j = i + 1;
    while (j < u.length && !u[j]!.vowel) j++;
    if (j >= u.length) break;
    const n = j - i - 1;
    // Zwei Vokale hintereinander: nicht trennen (sicher statt „Feu-er“-Sonderfälle).
    if (n > 0) {
      const tail = (from: number) =>
        u
          .slice(from, j)
          .map((x) => x.text)
          .join('')
          .toLowerCase();
      // Regel: Der letzte Konsonant kommt auf die neue Zeile – außer bei typischen
      // Silbenanfängen in Konsonanthäufungen (oft Wortfugen: „Schwarz-specht“).
      let k = j - 1;
      if (n >= 4 && ONSET3_FROM_4.has(tail(j - 3))) k = j - 3;
      else if ((n >= 3 && ONSET_FROM_3.has(tail(j - 2))) || (n >= 4 && ONSET_FROM_4.has(tail(j - 2)))) k = j - 2;
      points.push(starts[k]!);
    }
    i = j - 1;
  }
  return points.filter((p) => p >= MIN_EDGE && word.length - p >= MIN_EDGE);
}

/**
 * Setzt weiche Trennstellen in alle langen Wörter eines Anzeigetexts.
 * `hyphenate('Buschwindröschen')` → „Busch­wind­rö­schen“.
 */
export function hyphenate(text: string): string {
  return text.replace(/[A-Za-zÄÖÜäöüß]+/g, (word) => {
    const points = hyphenPoints(word);
    if (points.length === 0) return word;
    let out = '';
    let last = 0;
    for (const p of points) {
      out += word.slice(last, p) + SOFT_HYPHEN;
      last = p;
    }
    return out + word.slice(last);
  });
}

/** Entfernt weiche Trennstellen wieder (z. B. für Vergleiche). */
export function stripHyphens(text: string): string {
  return text.replaceAll(SOFT_HYPHEN, '');
}
