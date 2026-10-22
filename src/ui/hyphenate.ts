/**
 * Weiche Trennstellen (U+00AD) für lange deutsche Namen in der Anzeige, damit schmale
 * Kacheln „Busch-wind-rös-chen“ statt „Buschwindrösc|hen“ umbrechen.
 *
 * Statt einer Silbenheuristik (die an Wortfugen vor Vokalen, bei ch/sch und beim
 * Fugen-s danebenlag) gibt es eine von Hand geprüfte Tabelle für alle Wörter ab
 * zwölf Buchstaben aus den Namen in `content/`. Ein Test stellt sicher, dass jedes
 * solche Wort einen Eintrag hat. Wörter ohne Eintrag bleiben ungetrennt – dann darf
 * der Browser mit `hyphens: auto` und `lang="de"` selbst trennen.
 *
 * Nur für sichtbaren Text: Suchen, Vergleiche und aria-label bekommen den Namen ohne
 * Trennzeichen (die Inhaltsdaten bleiben unverändert).
 */

export const SOFT_HYPHEN = '­';

/** Ab dieser Länge braucht ein Wort aus den Inhaltsnamen einen Tabelleneintrag. */
export const MIN_HYPHENATED_WORD = 12;

/**
 * Trennstellen nach deutscher Rechtschreibung, „|“ markiert eine Trennstelle.
 * Einzelne Vokale am Wortanfang bleiben dran („abend“, nicht „a-bend“), „ck“ und „ch“
 * werden nicht zerrissen.
 */
export const HYPHENATION: Readonly<Record<string, string>> = {
  Ameisenstraße: 'Amei|sen|stra|ße',
  Bienenschwarm: 'Bie|nen|schwarm',
  Buschwindröschen: 'Busch|wind|rös|chen',
  Eichenwickler: 'Ei|chen|wick|ler',
  Eichhörnchen: 'Eich|hörn|chen',
  Feuersalamander: 'Feu|er|sa|la|man|der',
  Frauenhaarmoos: 'Frau|en|haar|moos',
  Glühwürmchen: 'Glüh|würm|chen',
  Hochzeitsflug: 'Hoch|zeits|flug',
  Insektenhotel: 'In|sek|ten|ho|tel',
  Krötenwanderung: 'Krö|ten|wan|de|rung',
  Lichterabend: 'Lich|ter|abend',
  Nachtfalterjagd: 'Nacht|fal|ter|jagd',
  Nachtflieger: 'Nacht|flie|ger',
  Nachtschicht: 'Nacht|schicht',
  Nachtschmaus: 'Nacht|schmaus',
  Nacktschnecke: 'Nackt|schne|cke',
  Regenreicher: 'Re|gen|rei|cher',
  Schneckenwacht: 'Schne|cken|wacht',
  Schwalbenschwarm: 'Schwal|ben|schwarm',
  Schwarzspecht: 'Schwarz|specht',
  Seidenschwänze: 'Sei|den|schwän|ze',
  Sonnenschein: 'Son|nen|schein',
  Tagpfauenauge: 'Tag|pfau|en|au|ge',
  Taubenschwänzchen: 'Tau|ben|schwänz|chen',
  Totholzhaufen: 'Tot|holz|hau|fen',
  Weinbergschnecke: 'Wein|berg|schne|cke',
  Zunderschwamm: 'Zun|der|schwamm',
};

/**
 * Setzt weiche Trennstellen in alle Wörter eines Anzeigetexts, die in der Tabelle stehen.
 * `hyphenate('Buschwindröschen')` → „Busch­wind­rös­chen“.
 */
export function hyphenate(text: string): string {
  return text.replace(/[A-Za-zÄÖÜäöüß]+/g, (word) => {
    const entry = Object.hasOwn(HYPHENATION, word) ? HYPHENATION[word] : undefined;
    return entry ? entry.replaceAll('|', SOFT_HYPHEN) : word;
  });
}

/** Entfernt weiche Trennstellen wieder (z. B. für Vergleiche). */
export function stripHyphens(text: string): string {
  return text.replaceAll(SOFT_HYPHEN, '');
}
