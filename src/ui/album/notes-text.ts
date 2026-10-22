/**
 * Inhalte der Haftnotizen an den Etiketten (docs/ALBUM_UI.md, C.4) – reine Funktionen ohne
 * DOM (Vitest). Die Texte folgen der Spielanleitung (guide-view.ts) und den bisherigen
 * Tooltips; Zahlen über format.ts bzw. view-format.ts.
 */
import { formatRate } from '../format';
import { formatMultiplier } from '../view-format';
import { nightRateText } from '../weather-view';

export interface LabelNoteView {
  title: string;
  text: string;
  /** Kernzahl in Grün („jetzt: Wachstum ×1,32“). */
  emphasis: string;
  /** Nachtwirkung („🌙 Nachtbonus: Waldkauz“), leer = keine. */
  night: string;
}

/** Was die Etiketten-Notizen aus der Ökosystem-Ansicht brauchen. */
export interface LabelNoteInput {
  growthPerSec: number;
  seedsPerSec: number;
  harmony: number;
  harmonyTier: string;
  harmonyMultiplier: number;
  night: { growth: readonly string[]; seeds: readonly string[] };
}

export const GROWTH_NOTE_TEXT =
  'Dein Wald wächst ganz von selbst – 🌿 zeigt, wie viel Wachstum pro Sekunde dazukommt. Daraus werden Wegpunkte, Begegnungen und neue Stufen.';
export const SEEDS_NOTE_TEXT =
  'Samen sammelst du nebenbei – mehr Pflanzen und Harmonie bringen mehr. Du gibst sie für Pflanzen, Pflege und fürs Neu würfeln aus. Nichts verfällt.';
export const HARMONY_NOTE_TEXT =
  'Wie gut dein Wald zusammenpasst. Jede zufriedene Art und jede Lebensgemeinschaft hebt sie – und mehr Harmonie lässt dich schneller wachsen.';

const nightLine = (names: readonly string[]): string => {
  const text = nightRateText(names);
  return text ? `🌙 ${text}` : '';
};

export function growthNoteView(view: LabelNoteInput): LabelNoteView {
  return {
    title: 'Wachstum',
    text: GROWTH_NOTE_TEXT,
    emphasis: `jetzt: ${formatRate(view.growthPerSec)} 🌿 · mit ⚖️ ${formatMultiplier(view.harmonyMultiplier)}`,
    night: nightLine(view.night.growth),
  };
}

export function seedsNoteView(view: LabelNoteInput): LabelNoteView {
  return {
    title: 'Samen',
    text: SEEDS_NOTE_TEXT,
    emphasis: `jetzt: +${formatRate(view.seedsPerSec)} 🌰`,
    night: nightLine(view.night.seeds),
  };
}

export function harmonyNoteView(view: LabelNoteInput): LabelNoteView {
  return {
    title: `Harmonie · ${view.harmonyTier}`,
    text: HARMONY_NOTE_TEXT,
    emphasis: `jetzt: Wachstum ${formatMultiplier(view.harmonyMultiplier)}`,
    night: '',
  };
}
