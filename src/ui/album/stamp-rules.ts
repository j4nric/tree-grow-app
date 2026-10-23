/**
 * Regeln der Meldungsschicht (docs/ALBUM_UI.md, C.5) – rein, ohne DOM (Vitest):
 * Stempel oder Zettel, Farbe, Standzeit und wer weichen muss.
 */

/** Ab so vielen Zeichen wird aus dem Stempel ein Zettel (G-23: etwa zwei Zeilen bei 360 px). */
export const SLIP_MIN_CHARS = 90;
/** Höchstens so viele Meldungen gleichzeitig; die älteste weicht. */
export const MAX_STAMPS = 2;

export type StampKind = 'stamp' | 'slip';

/** Wie eine Meldung erscheinen soll (`album.notify(text, options)`). */
export interface NotifyOptions {
  /** Fehlermeldung einer Aktion: roter Rahmen. */
  error?: boolean;
  /** Zettel, der bis zum Schließen bleibt (Landschaft frei, v1-Hinweis, angehaltener Tab). */
  keep?: boolean;
  /** Kurzfassung: höchstens drei Zeilen (Rückkehr). */
  brief?: boolean;
  /** Nur für Screenreader angehängt (der Rest steht sichtbar woanders, z. B. im Rückkehr-Zettel). */
  spoken?: string;
}

export function stampKind(text: string, options: NotifyOptions = {}): StampKind {
  return options.keep || [...text].length > SLIP_MIN_CHARS ? 'slip' : 'stamp';
}

/**
 * Standzeit in ms: Stempel so lange wie früher der Toast (`base` aus `toastDurationFor`),
 * Zettel doppelt so lange, bleibende Zettel ohne Ablauf (null).
 */
export function stampDuration(kind: StampKind, base: number, options: NotifyOptions = {}): number | null {
  if (options.keep) return null;
  return kind === 'slip' ? base * 2 : base;
}

export interface ShownStamp {
  /** Laufende Nummer (älter = kleiner). */
  serial: number;
  keep: boolean;
}

/**
 * Welche Meldungen müssen weichen, damit eine neue dazukommt? Zuerst die ältesten, die von
 * selbst gingen; bleibende Zettel erst, wenn nur noch sie da sind.
 */
export function stampsToDrop(shown: readonly ShownStamp[], max = MAX_STAMPS): number[] {
  const excess = shown.length + 1 - max;
  if (excess <= 0) return [];
  const byAge = [...shown].sort((a, b) => a.serial - b.serial);
  const order = [...byAge.filter((s) => !s.keep), ...byAge.filter((s) => s.keep)];
  return order.slice(0, excess).map((s) => s.serial);
}

// ---------- Lage der Schicht (Playtest Schritt 14: M2, S2) ----------

/** Abstand zwischen Meldung und dem, was frei bleiben muss (px). */
export const STAMP_GAP = 8;

/** Rechteck im Bildschirm (wie DOMRect, ohne DOM). */
export interface StampBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const crosses = (a: StampBox, b: StampBox, gap: number): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom + gap && b.top - gap < a.bottom;

/**
 * Wie weit muss die unten verankerte Schicht (`layer`, ohne Verschiebung) nach oben rücken,
 * damit sie keinen der Bereiche in `avoid` verdeckt (Bestätigung, „Schließen“, fokussierter
 * Knopf)? Sie rückt über den überdeckten Bereich; liegt dort der nächste, auch über ihn.
 * Höchstens so weit, dass ihre Oberkante bei `minTop` bleibt (oben liegt die Navigation).
 */
export function stampLift(layer: StampBox, avoid: readonly StampBox[], minTop: number, gap = STAMP_GAP): number {
  let lift = 0;
  // Jeder Durchgang rückt weiter nach oben, über mindestens einen Bereich – endet also.
  for (let i = 0; i <= avoid.length; i++) {
    // Felder einzeln: Ein DOMRect hat keine eigenen Eigenschaften (Spread ergäbe {}).
    const box = { left: layer.left, right: layer.right, top: layer.top - lift, bottom: layer.bottom - lift };
    const hit = avoid.filter((a) => crosses(box, a, gap));
    if (hit.length === 0) break;
    const above = Math.min(...hit.map((a) => a.top)) - gap;
    lift = Math.max(lift, layer.bottom - above);
  }
  const most = Math.max(0, layer.top - minTop);
  return Math.round(Math.min(Math.max(0, lift), most));
}

/**
 * Mobil auf der Hauptansicht: Steht die Schicht oben über dem Bild? Entschieden wird, wenn eine
 * Meldung erscheint (`fresh`): oben, wenn sie über der Bildunterschrift (`limit`, Oberkante
 * der ersten Knöpfe unter dem Bild) Platz hat. Danach bleibt sie, wo sie ist – nur wenn die
 * Knöpfe beim Scrollen an die obere Meldung heranrücken, muss sie nach unten (nie zurück, solange
 * sie zu sehen ist). Kein Hin- und Herspringen beim langsamen Scrollen.
 */
export function stampsOnTop(fresh: boolean, wasTop: boolean, limit: number, layerBottomOnTop: number, gap = STAMP_GAP): boolean {
  const fits = limit >= layerBottomOnTop + gap;
  return fresh ? fits : wasTop && fits;
}
