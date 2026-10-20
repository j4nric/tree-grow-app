/**
 * View-Model der v2-Oberfläche: beschreibt, was die UI anzeigt – unabhängig vom Kern.
 *
 * Der Kern (bzw. eine Übersetzungsfunktion in Welle B) erzeugt diese Objekte aus dem
 * Spielstand; die Komponenten lesen sie nur. Alle Werte sind fertig berechnet: Die UI
 * rechnet keine Spielregeln nach, sie formatiert nur.
 *
 * Konventionen:
 * - Anteile (Zufriedenheit, Fortschritt) liegen in 0–1.
 * - Prozent-Änderungen sind Bruchteile: 0,05 = +5 %.
 * - Harmonie-Änderungen sind Punkte: 6 = +6 Harmonie.
 * - Texte (Namen, Wirkungen, Stimmungen) kommen fertig auf Deutsch.
 */

/** Seltenheit einer Art (Anzeige: gewöhnlich, selten, besonders, legendär). */
export type Rarity = 'common' | 'rare' | 'special' | 'legendary';

/** Art der Begegnung. */
export type EncounterKind = 'animal' | 'plant' | 'event' | 'visitor';

/** Bewertung einer Zeile: gut, schlecht oder neutral (wird auch als Symbol gezeigt, nicht nur farbig). */
export type Tone = 'good' | 'bad' | 'neutral';

/**
 * Gattung bzw. Gruppe als Schlüssel für Farbe/Symbol. Bekannte Werte haben eigene Farben
 * im CSS (`birds`, `insects`, `mammals`, `soil`, `fungi`, `plants`, `event`); andere
 * Schlüssel erscheinen neutral.
 */
export type FamilyKey = string;

/** Eine Wirkung auf der Karte, z. B. „+8 % 🌿“ (gut) oder „Fraß −10 % 🌿“ (schlecht). */
export interface EffectView {
  label: string;
  tone: Tone;
}

/** Eine Bedingung für die Zufriedenheit, z. B. „🍽 Raupen“ – erfüllt oder nicht. */
export interface ConditionView {
  label: string;
  met: boolean;
}

/** Vorschau: Was ändert sich, wenn diese Karte gewählt wird? */
export interface PreviewView {
  /** Änderung der Harmonie in Punkten. */
  harmonyDelta: number;
  /** Relative Änderung von 🌿/s (0,05 = +5 %). */
  growthDelta: number;
  /** Relative Änderung von 🌰/s (optional). */
  seedDelta?: number;
  /** Erwartete Zufriedenheit des neuen Tiers (0–1, nur bei Tieren). */
  happiness?: number;
}

/** Ein Tier, das bei voller Nische ersetzt werden könnte – mit eigener Vorschau für den Tausch. */
export interface ReplaceOptionView {
  id: string;
  name: string;
  /** Vorschau inklusive Tausch; fehlt sie, gilt die Vorschau der Karte. */
  preview?: PreviewView;
}

/** Eine Karte in einer Begegnung (Tier, Pflanze, Ereignis-Option oder Gast). */
export interface CardView {
  id: string;
  name: string;
  family: FamilyKey;
  familyLabel: string;
  /** Symbol der Gattung, z. B. 🐦. */
  familyIcon: string;
  /** Fehlt bei Ereignis-Optionen. */
  rarity?: Rarity;
  /** Nische (Schlüssel + Anzeige), fehlt bei Ereignissen und Gästen. */
  niche?: string;
  nicheLabel?: string;
  /** Nische ist voll → Wählen ersetzt eines der `replaceOptions`. */
  nicheFull?: boolean;
  replaceOptions?: ReplaceOptionView[];
  /** Bedingungen mit Haken/Kreuz (Futter, Wünsche). */
  conditions?: ConditionView[];
  effects: EffectView[];
  preview: PreviewView;
  /** Kurzer Naturtext. */
  flavor?: string;
  /** Karte kann nicht gewählt werden (mit Begründung). */
  disabledReason?: string;
}

/** Eine wartende Begegnung, bereit zur Anzeige. */
export interface EncounterView {
  kind: EncounterKind;
  /** Überschrift, z. B. „Etwas regt sich in der Krone …“. */
  title: string;
  /** Optionaler Untertitel (z. B. Ereignistext). */
  subtitle?: string;
  cards: CardView[];
  /** Kosten fürs Neuwürfeln in 🌰; `null` = Neuwürfeln hier nicht möglich (Ereignisse). */
  rerollCost: number | null;
  /** Geht Neuwürfeln gerade (genug Samen, andere Arten verfügbar)? */
  canReroll: boolean;
  /** Grund, falls Neuwürfeln nicht geht, z. B. „Keine anderen Tiere verfügbar“. */
  rerollDisabledReason?: string;
  /** Samen fürs Ablehnen; `null` = Ablehnen nicht möglich. */
  declineReward: number | null;
}

/** Ein Baustein der Harmonie, z. B. „Vielfalt 27“. Negative Werte sind Abzüge. */
export interface HarmonyPartView {
  label: string;
  value: number;
}

/** Gattung in der Gattungsleiste (à la TFT). */
export interface FamilyView {
  id: FamilyKey;
  icon: string;
  label: string;
  /** Wie viele Arten dieser Gattung leben (inkl. Durchreisende). */
  count: number;
  /** Schwellen, aufsteigend, z. B. [2, 3, 5]. */
  thresholds: number[];
  /** Bonus-Text je Schwelle (gleiche Reihenfolge wie `thresholds`). */
  bonuses: string[];
}

/** Ein Tier in einer Nische. */
export interface AnimalView {
  id: string;
  name: string;
  family: FamilyKey;
  familyIcon: string;
  rarity: Rarity;
  /** Zufriedenheit 0–1. */
  happiness: number;
  /** Kurze, freundliche Stimmung, z. B. „sucht eine Baumhöhle“. */
  mood: string;
  /** Durchreisender Gast (braucht keinen Platz). */
  visitor?: boolean;
}

/** Eine Nische mit Plätzen. */
export interface NicheView {
  id: string;
  icon: string;
  label: string;
  /** Anzahl der Plätze; 0 = noch verschlossen. */
  capacity: number;
  animals: AnimalView[];
  /** Hinweis für verschlossene Nischen, z. B. „ab Junger Baum“. */
  unlockHint?: string;
}

/** Alles, was die Ökosystem-Übersicht in der Seitenleiste zeigt. */
export interface EcosystemView {
  stageName: string;
  /** Fortschritt zum nächsten Wegpunkt (0–1). */
  stageProgress: number;
  /** Text unter dem Fortschrittsbalken, z. B. „Nächste Begegnung bei 1.769 🌿“. */
  progressHint: string;
  growthPerSec: number;
  seeds: number;
  seedsPerSec: number;
  harmony: number;
  /** Harmoniestufe als Text, z. B. „Lebendiges Gefüge“. */
  harmonyTier: string;
  /** Multiplikator auf 🌿 und 🌰, z. B. 1,38. */
  harmonyMultiplier: number;
  harmonyParts: HarmonyPartView[];
  families: FamilyView[];
  niches: NicheView[];
}
