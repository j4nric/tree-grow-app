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
  Bachschlucht: 'Bach|schlucht',
  Bergmischwald: 'Berg|misch|wald',
  Bienenschwarm: 'Bie|nen|schwarm',
  Buchenhallen: 'Bu|chen|hal|len',
  Buschwindröschen: 'Busch|wind|rös|chen',
  Eichenwickler: 'Ei|chen|wick|ler',
  Eichhörnchen: 'Eich|hörn|chen',
  Feuersalamander: 'Feu|er|sa|la|man|der',
  Frauenhaarmoos: 'Frau|en|haar|moos',
  Glühwürmchen: 'Glüh|würm|chen',
  Hochzeitsflug: 'Hoch|zeits|flug',
  Insektenhotel: 'In|sek|ten|ho|tel',
  Kiefernheide: 'Kie|fern|hei|de',
  Krötenwanderung: 'Krö|ten|wan|de|rung',
  Lichterabend: 'Lich|ter|abend',
  Nachtfalterjagd: 'Nacht|fal|ter|jagd',
  Nachtflieger: 'Nacht|flie|ger',
  Nachtschicht: 'Nacht|schicht',
  Nachtschmaus: 'Nacht|schmaus',
  Nacktschnecke: 'Nackt|schne|cke',
  Regenreicher: 'Re|gen|rei|cher',
  Schlehenhecke: 'Schle|hen|he|cke',
  Schneckenwacht: 'Schne|cken|wacht',
  Schwalbenschwarm: 'Schwal|ben|schwarm',
  Schwarzspecht: 'Schwarz|specht',
  Seidenschwänze: 'Sei|den|schwän|ze',
  Sonnenschein: 'Son|nen|schein',
  Tagpfauenauge: 'Tag|pfau|en|au|ge',
  Taubenschwänzchen: 'Tau|ben|schwänz|chen',
  Totholzhaufen: 'Tot|holz|hau|fen',
  Weinbergschnecke: 'Wein|berg|schne|cke',
  Wiesengraben: 'Wie|sen|gra|ben',
  Zunderschwamm: 'Zun|der|schwamm',
  // Welle 3: Lebensräume und Räuber/Beute (DESIGN_V2.md 22, 23; content/habitats.ts, predation.ts)
  Blindschleiche: 'Blind|schlei|che',
  Ringelnatter: 'Rin|gel|nat|ter',
  Schlingnatter: 'Schling|nat|ter',
  Schmetterlingstramete: 'Schmet|ter|lings|tra|me|te',
  Schneckenjahr: 'Schne|cken|jahr',
  Trockenmauer: 'Tro|cken|mau|er',
  Waldeidechse: 'Wald|ei|dech|se',
  Wiesenkonzert: 'Wie|sen|kon|zert',
  Wildkaninchen: 'Wild|ka|nin|chen',
  Zauneidechse: 'Zaun|ei|dech|se',
  // Phase 10: Forschungsbaum (DESIGN_V2.md 27.7; content/research.ts)
  Blütenvorrat: 'Blü|ten|vor|rat',
  Humusschicht: 'Hu|mus|schicht',
  Wildbienenwand: 'Wild|bie|nen|wand',
  // Phase 9: Kennarten, Nachtwirkungen und Andenken der Chronik (DESIGN_V2.md 26.3, 26.4)
  Dämmerungsjagd: 'Däm|me|rungs|jagd',
  Erlenzäpfchen: 'Er|len|zäpf|chen',
  // Titel des Kapitels „Ereignis des Waldes“ (Zettel auf U:Standort, 26.7)
  Frühjahrshochwasser: 'Früh|jahrs|hoch|was|ser',
  Heidekrautzweig: 'Hei|de|kraut|zweig',
  Nachtklettern: 'Nacht|klet|tern',
  Tannenzapfen: 'Tan|nen|zap|fen',
  Ziegenmelker: 'Zie|gen|mel|ker',
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
