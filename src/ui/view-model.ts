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
  /** Kurze Erklärung darunter, z. B. bei knappem Futter „teilt sich das Futter mit Amsel“. */
  hint?: string;
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
  /** Versorgung der Begleitpflanzen mit Licht und Wasser danach (0–1, nur bei Pflanzen). */
  supply?: number;
  /** Änderung der Versorgung gegenüber jetzt (−0,2 = 20 Prozentpunkte weniger). */
  supplyDelta?: number;
}

/**
 * Eine Kennzahl auf einer Pflanzenkarte, z. B. Wachstum „🌿 1,5/s“ oder Lichtbedarf „☀️ 4“.
 * `label` steht sichtbar darüber, `text` ist die vollständige Fassung für Screenreader.
 */
export interface FactView {
  label: string;
  icon: string;
  value: string;
  text: string;
}

/** Ein Tier, das bei voller Nische ersetzt werden könnte – mit eigener Vorschau für den Tausch. */
export interface ReplaceOptionView {
  id: string;
  name: string;
  /** Vorschau inklusive Tausch; fehlt sie, gilt die Vorschau der Karte. */
  preview?: PreviewView;
  /** Dieses Tier kann nicht weichen (mit Begründung) – Option wird gesperrt angezeigt. */
  disabledReason?: string;
  /** Bedingungen inklusive Tausch (z. B. Futter nicht mehr knapp); fehlen sie, gelten die der Karte. */
  conditions?: ConditionView[];
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
  /** Nische bzw. Pflanzring ist voll → Wählen ersetzt eines der `replaceOptions`. */
  nicheFull?: boolean;
  replaceOptions?: ReplaceOptionView[];
  /** Hinweis, wenn voll – Standard „Nische … voll“, bei Pflanzen „Pflanzring voll“. */
  fullText?: string;
  /** Frage über der Ersetzen-Auswahl – Standard „Wen entlassen?“. */
  replacePrompt?: string;
  /** Kennzahlen (Pflanzen: Wachstum, Samen, Licht, Wasser). */
  facts?: FactView[];
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
  /**
   * Eindeutige Kennung der Begegnung (optional). Zwei gleich aussehende Begegnungen
   * (gleiche Karten) werden daran als verschieden erkannt – wichtig für die Eingabesperre.
   */
  key?: string;
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
  plantRing: PlantRingView;
}

/** Eine Begleitpflanze im Pflanzring. */
export interface PlantSlotView {
  id: string;
  name: string;
  /** Gruppe als Schlüssel (`trees`, `shrubs`, `flowers`, `mosses`). */
  group: string;
  groupIcon: string;
  groupLabel: string;
}

/** Licht oder Wasser: Angebot gegen Bedarf der Begleitpflanzen. */
export interface SupplyMeterView {
  key: 'light' | 'water';
  icon: string;
  label: string;
  /** Wie gut der Bedarf gedeckt ist (0–1). */
  ratio: number;
  /** Kurzer Text, z. B. „braucht 4 von 5“. */
  detail: string;
}

/** Pflanzen je Gruppe (Hauptbaum zählt als Baum). */
export interface PlantGroupCountView {
  id: string;
  icon: string;
  label: string;
  count: number;
}

/** Pflanzring in der Ökosystem-Übersicht. */
export interface PlantRingView {
  /** Pflanzplätze; 0 = noch verschlossen. */
  capacity: number;
  plants: PlantSlotView[];
  /** Versorgung V (0–1). */
  supply: number;
  /** Zusammenfassung, z. B. „☀️ Licht 80 % · 💧 Wasser 100 %“. */
  supplyText: string;
  meters: SupplyMeterView[];
  /** Erklärung bei Mangel, z. B. „Zu wenig Licht – Schattenpflanzen helfen“. */
  shortageHint?: string;
  groups: PlantGroupCountView[];
  /** Hinweis für den verschlossenen Ring, z. B. „öffnet bei „Keimling““. */
  unlockHint?: string;
  /** Exakte Kosten der nächsten Pflanze in 🌰 (für Vergleiche mit dem Samenvorrat). */
  plantCost: number;
  /** Kosten zur Anzeige, aufgerundet, z. B. „138“. */
  plantCostLabel: string;
  /** Knopf „Pflanze setzen“ anbieten (Ring offen und nicht voll, Pflanzen verfügbar)? */
  canOpenPicker: boolean;
  /** Reichen die Samen gerade für die nächste Pflanze? */
  affordable: boolean;
  /** Hinweis unter dem Knopf bzw. statt des Knopfs, z. B. „Noch 12 🌰“ oder „Alle Plätze belegt …“. */
  plantHint: string;
}

/** Eine Pflanze in der Auswahl „Pflanze setzen“. */
export interface PlantOfferView {
  card: CardView;
  /** Exakte Kosten in 🌰 (für alle Pflanzen gleich: nextPlantCost). */
  cost: number;
  /** Kosten zur Anzeige, aufgerundet. */
  costLabel: string;
}

/** Auswahl „Pflanze setzen“. */
export interface PlantPickerView {
  title: string;
  /** z. B. „Pflanzring 1/3 belegt · nächste Pflanze 38 🌰“. */
  subtitle: string;
  /** Exakte Kosten der nächsten Pflanze – der Kopf zeigt live, ob die Samen reichen. */
  cost: number;
  offers: PlantOfferView[];
}
