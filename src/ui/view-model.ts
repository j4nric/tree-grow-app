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

/** 🌙 an einer Nachtart (Kachel, Karte, Details). */
export interface NightBadgeView {
  /** „🌙 nachts +10 % 🌿“ (Kurzform aus den Daten). */
  label: string;
  /** Name der Nachtwirkung, z. B. „Nachtjagd“. */
  name: string;
  /** Wirkt gerade (Nacht und passende Jahreszeit). */
  active: boolean;
  /** Ruht in dieser Jahreszeit (Winterschlaf). */
  resting: boolean;
  /** In der Jahreszeit aktiv, aber zu unzufrieden, als dass die Wirkung zählt. */
  tooUnhappy: boolean;
  /** Wirkung bei der aktuellen Zufriedenheit, z. B. „+6,8 % 🌿“. */
  scaled: string;
  /** Zufriedenheit 0–1, mit der `scaled` gerechnet ist. */
  happiness: number;
}

/** Nachtarten, deren Nachtwirkung gerade auf 🌿 bzw. 🌰 wirkt (Namen). */
export interface NightRateView {
  growth: string[];
  seeds: string[];
}

/** Seltenheit einer Art (Anzeige: gewöhnlich, selten, besonders, legendär). */
export type Rarity = 'common' | 'rare' | 'special' | 'legendary';

/** Art der Begegnung. */
export type EncounterKind = 'animal' | 'plant' | 'event' | 'visitor';

/** Bewertung einer Zeile: gut, schlecht oder neutral (wird auch als Symbol gezeigt, nicht nur farbig). */
export type Tone = 'good' | 'bad' | 'neutral';

/**
 * Gattung bzw. Gruppe als Schlüssel für Farbe/Symbol. Bekannte Werte haben eigene Farben
 * im CSS (`birds`, `insects`, `mammals`, `soil`, `fungi`, `amphibians`, `reptiles`, `plants`, `event`); andere
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
  /**
   * Lebensgemeinschaften, die diese Wahl vervollständigt (`tone: 'good'`) oder auflöst
   * (`tone: 'bad'`), z. B. ✨ + „vervollständigt Humusküche (+8 Harmonie)“.
   */
  communities?: CommunityHintView[];
}

/**
 * Hinweis auf einer Karte, dass die Wahl eine Lebensgemeinschaft vervollständigt oder
 * auflöst. `icon` ist Schmuck (für Screenreader verborgen), `label` der Text ohne Emoji.
 */
export interface CommunityHintView {
  icon: string;
  label: string;
  tone: Tone;
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
  /** Text des Knopfs statt „Wählen“ (Ereignis-Optionen, „Bewirten (−40 🌰)“). */
  chooseLabel?: string;
  /** Kurze Erklärung unter der Vorschau, z. B. warum sie vom Nennwert abweicht (Gäste). */
  note?: string;
}

/** Ein aktiver Bonus aus einem Ereignis oder ein bewirteter Gast (Seitenleiste). */
export interface ActiveBonusView {
  id: string;
  icon: string;
  /** Herkunft, z. B. „Mittsommer“ oder „Kranichzug“. */
  name: string;
  /** Wirkung in Kurzform, z. B. „+30 % 🌿“. */
  effect: string;
  /** Restzeit, z. B. „4 Min.“; fehlt bei Boni bis zum Neuen Zyklus („bis zum Neuen Zyklus“). */
  remaining: string;
  /** Läuft ab (Zeit-Bonus, Gast) – sonst gilt er bis zum Neuen Zyklus. */
  timed: boolean;
  /** Anteil der Restzeit 0 … 1 für den Balken; null ohne Ablauf oder bei unbekannter Dauer. */
  progress: number | null;
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
  /** Großes Bild-Symbol neben dem Titel (Ereignisse und Gäste), z. B. 🦢. */
  icon?: string;
  /** Kurze Eckdaten unter dem Untertitel, z. B. „🐦 Vögel“, „rastet 8 Min.“. */
  facts?: string[];
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
  /** Nachtaktive Art: 🌙 mit Kurzform, leuchtet, solange die Nachtwirkung gilt. */
  night?: NightBadgeView;
  /** Nur Beute (Futter für Jäger im Wald, DESIGN_V2.md 22.3): Bestand knapp/gut/reichlich. */
  stock?: StockView;
}

/** Stufe eines Bestands (DESIGN_V2.md 22.3): knapp (< STOCK_LOW), gut, reichlich (≥ STOCK_HIGH). */
export type StockLevel = 'low' | 'good' | 'high';

/** Bestand in Worten, z. B. `{ level: 'high', label: 'reichlich' }` – keine Zahl. */
export interface StockView {
  level: StockLevel;
  label: string;
}

/** Zustand eines Merkmals im Nahrungsnetz (wie `FoodWebState` im Kern). */
export type FoodWebStateKey = 'balanced' | 'overhunted' | 'unhunted';

/**
 * Eine Zeile im Nahrungsnetz der Ökosystem-Übersicht (DESIGN_V2.md 22.7): ein Beute-Merkmal
 * mit Beute im Wald, wer davon lebt und was der Spieler tun kann.
 */
export interface FoodWebRowView {
  /** Merkmal (Tag-ID), z. B. `kleinsaeuger`. */
  tag: string;
  icon: string;
  /** z. B. „Kleinsäuger“. */
  name: string;
  state: FoodWebStateKey;
  /** „im Gleichgewicht“, „überjagt“ oder „ungejagt“. */
  stateLabel: string;
  /** Symbol zum Zustand (Schmuck – der Zustand steht immer auch als Text da). */
  stateIcon: string;
  /** Bestand aller Beute dieses Merkmals im Schnitt. */
  stock: StockView;
  /** „Wühlmaus“, „Eichenwickler und Tagpfauenauge“ (unentdeckte: „???“). */
  prey: string;
  /** „Waldkauz und Rotfuchs“ – leer, wenn keiner frisst; Beute, die sich selbst frisst: „… (frisst Artgenossen)“. */
  hunters: string;
  hunterCount: number;
  /** Arten, die es nur klein halten, z. B. „Rote Waldameise“ – leer, wenn keine. */
  controllers: string;
  /** Was das bedeutet bzw. was hilft, z. B. „Ein Raupenjahr kann Jäger einladen.“ */
  hint: string;
}

/** Das Nahrungsnetz für die Übersicht (aufklappbar wie die Lebensgemeinschaften). */
export interface FoodWebView {
  rows: FoodWebRowView[];
  /** Kurzfassung für die zugeklappte Zeile, z. B. „1 überjagt · 2 im Gleichgewicht“ (überjagt zuerst). */
  summary: string;
  /** Text, wenn noch keine Beute im Wald lebt (dann `rows` leer). */
  emptyText: string;
}

/**
 * Räuber und Beute in den Tierdetails: eine Zeile je Rolle der Art – als Beute (Bestand,
 * wen sie ernährt) und als Jäger (wie es um ihr Futter steht).
 */
export interface DetailPredationView {
  /** Schlüssel für Tests und DOM, z. B. `stock`, `prey-raupen`, `hunt-kleinsaeuger`. */
  key: string;
  icon: string;
  label: string;
  /** Freundlicher Hinweis, z. B. was bei Überjagung hilft. */
  hint?: string;
  tone: Tone;
}

/** Eine Nische mit Plätzen. */
export interface NicheView {
  id: string;
  icon: string;
  label: string;
  /** Anzahl der Plätze; 0 = noch verschlossen. */
  capacity: number;
  animals: AnimalView[];
  /**
   * Hinweis für verschlossene Nischen, z. B. „öffnet bei „Junger Baum““ – oder für offene,
   * in die noch niemand einziehen darf („Bewohner ab „Alter Baum““, Waldtümpel).
   */
  unlockHint?: string;
  /**
   * Pflegemaßnahme, die diese verschlossene Nische öffnet und schon gekauft werden kann
   * (Waldtümpel ab „Alter Baum“) – die Seitenleiste zeigt dann „Zur Pflege“.
   */
  careLink?: string;
}

/** Alles, was die Ökosystem-Übersicht in der Seitenleiste zeigt. */
export interface EcosystemView {
  stageName: string;
  /** Fortschritt zum nächsten Wegpunkt (0–1). */
  stageProgress: number;
  /**
   * Text unter dem Fortschrittsbalken, z. B. „Nächste Begegnung in 3 Min.“ – warten schon
   * Begegnungen, stattdessen „2 Begegnungen warten“ (kein Countdown daneben).
   */
  progressHint: string;
  /** Wartende Begegnungen auf dem Stapel (0 = keine) – die Seitenleiste zeigt dann einen Knopf. */
  pendingEncounters: number;
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
  communities: CommunityListView;
  /** Nahrungsnetz: wer jagt wen (DESIGN_V2.md 22.7). */
  foodWeb: FoodWebView;
  /** Nachtarten, deren Nachtwirkung gerade gilt (Namen je Rate) – leer: kein 🌙 an der Rate. */
  night: NightRateView;
}

/**
 * Zustand einer Lebensgemeinschaft in der Seitenleiste:
 * `active` besteht gerade, `near` fehlt nur noch wenig (≥ 50 % der Mitglieder da),
 * `open` alles andere.
 */
export type CommunityState = 'active' | 'near' | 'open';

/** Eine Lebensgemeinschaft in der Übersicht. */
export interface CommunityView {
  id: string;
  /** Symbol; bei noch nicht entdeckten Gemeinschaften „❔“. */
  icon: string;
  /** Name; bei noch nicht entdeckten Gemeinschaften „???“. */
  name: string;
  /** Schon einmal entdeckt (stand im Naturtagebuch)? */
  discovered: boolean;
  state: CommunityState;
  /** Erfüllte Mitglieder von `total`. */
  present: number;
  total: number;
  /** Fortschritt 0–1 (`present / total`). */
  progress: number;
  /** Harmonie-Beitrag, solange sie besteht (nur bei `active` > 0). */
  harmony: number;
  /** Extra-Wirkungen als Text, z. B. „+5 % 🌿“ (leer, wenn keine). */
  effects: string;
  /** „fehlt: Pfifferling oder Steinpilz“ – nur bei `near`. */
  missingText?: string;
  /** Rätselhinweis für noch nicht entdeckte Gemeinschaften. */
  hint?: string;
}

/** Alle Lebensgemeinschaften für die Seitenleiste (aktive zuerst, dann die nächsten). */
export interface CommunityListView {
  items: CommunityView[];
  activeCount: number;
  /** Summe der Harmonie aller aktiven Gemeinschaften. */
  harmony: number;
  /** Kurzfassung für die zugeklappte Zeile, z. B. „1 von 9 aktiv · +8 ⚖️“. */
  summary: string;
  /** Dieselbe Kurzfassung ohne Emojis für Screenreader, z. B. „1 von 9 aktiv, +8 Harmonie“. */
  summaryText: string;
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

/** Stammgast-Schalter an einer entdeckten Art im Naturtagebuch. */
export interface JournalRegularView {
  selected: boolean;
  /** Nicht wählbar (alle Plätze belegt) – abwählen geht immer. */
  disabled: boolean;
}

/**
 * Eine Art oder Pflanze im Naturtagebuch. Unentdeckte erscheinen als Silhouette mit
 * „???“: Gattungs- bzw. Gruppensymbol und Seltenheitsrahmen bleiben bewusst als Hinweis
 * sichtbar, Name und ID stehen dagegen nirgends in der Ansicht (DESIGN_V2.md 11.2).
 */
export interface JournalEntryView {
  /** Art- bzw. Pflanzen-ID; bei Unentdeckten ein neutraler Schlüssel („unknown-3“). */
  key: string;
  discovered: boolean;
  /** Gattungs- bzw. Gruppensymbol (bei Unentdeckten als Silhouette gezeigt). */
  icon: string;
  /** Name; bei Unentdeckten „???“. */
  name: string;
  /** Gattung bzw. Gruppe als Schlüssel für die Farbe. */
  family: FamilyKey;
  /** Seltenheit (nur Arten). */
  rarity?: Rarity;
  /**
   * Kurzangaben, z. B. ["Vögel", "selten", "Nische: Krone"] bzw. ["Sträucher", "ab „Setzling“"].
   * Unentdeckte Arten nur mit der Seltenheit (["selten"]), unentdeckte Pflanzen nur mit
   * der Stufe, ab der sie wachsen (["ab „Junger Baum“"]).
   */
  facts: string[];
  /** Naturtext (nur entdeckte). */
  text?: string;
  /** Lebt bzw. wächst gerade im Ökosystem. */
  present: boolean;
  /** Stammgast-Schalter (nur entdeckte Arten, sobald es Plätze gibt). */
  regular?: JournalRegularView;
}

/** Eine Lebensgemeinschaft im Naturtagebuch. */
export interface JournalCommunityView {
  /** ID; bei Unentdeckten ein neutraler Schlüssel. */
  key: string;
  discovered: boolean;
  icon: string;
  /** Name; bei Unentdeckten „???“. */
  name: string;
  /** Besteht gerade. */
  active: boolean;
  /**
   * Mitglieder, z. B. „Regenwurm, Rollassel, Pfifferling oder Steinpilz“ (nur entdeckte
   * Gemeinschaften). Nennt alle Mitglieder, auch noch unentdeckte Arten – gewollt, wie
   * „fehlt: …“ in der Seitenleiste.
   */
  members?: string;
  /** Wirkung, z. B. „+8 Harmonie · +5 % 🌿“ (nur entdeckte). */
  effect?: string;
  /** Rätselhinweis (nur unentdeckte). */
  hint?: string;
  /** Fortschritt, z. B. „2/3 Mitglieder“ – solange sie nicht besteht (auch bei unentdeckten). */
  progress?: string;
}

export interface JournalKeepsakeView {
  key: string;
  icon: string;
  name: string;
  text: string;
}

/**
 * Eine Hauptbaum-Art im Reiter „Andenken“ (DESIGN_V2.md 17.2). Gesperrte Arten zeigen
 * Name und Hinweis erst, wenn auch „Neuer Zyklus“ die Auswahl zeigt (ab Hain oder nach
 * dem ersten Zyklus) – vorher als Silhouette „???“ ohne Namen und ID.
 */
export interface JournalTreeView {
  /** Art-ID; bei verborgenen Arten ein neutraler Schlüssel („unknown-tree-0“). */
  key: string;
  icon: string;
  /** z. B. „Rotbuche“; verborgen „???“. */
  name: string;
  /** Verborgen (Spoiler-Regel): ohne Namen, ID und Eigenheit. */
  hidden: boolean;
  unlocked: boolean;
  /** Art des laufenden Zyklus. */
  current: boolean;
  /** War schon einmal Hauptbaum (`meta.stats.grownTrees`, die aktuelle Art immer). */
  grown: boolean;
  /** Eigenheit in Kurzform (nur, wenn sichtbar). */
  summary?: string;
  /** Stimmungstext (nur freigeschaltete). */
  text?: string;
  /** Hinweis, solange gesperrt. */
  hint?: string;
}

/** Ein Erfolg im Reiter „Erfolge“ (DESIGN_V2.md 18). */
export interface JournalAchievementView {
  /** Erfolgs-ID. */
  key: string;
  icon: string;
  title: string;
  /** Neutral formuliert – auch bei offenen Erfolgen sichtbar. */
  description: string;
  unlocked: boolean;
  /** Nur offene: Fortschritt, z. B. „3/5“ (fehlt bei Stufen). */
  progress?: string;
  /**
   * Nur offene: Der Fortschritt läuft mit der Spielzeit („Ein ganzes Jahr“, „Geduld der
   * Bäume“). Er zählt nicht zur Signatur des Tagebuchs; der Dialog tauscht nur den Text
   * (gedrosselt, `JournalDialog.updateAchievementProgress`).
   */
  live?: boolean;
}

/** Laufender Fortschritt eines offenen Zeit-Erfolgs (nur Text tauschen). */
export interface JournalAchievementProgressView {
  key: string;
  progress: string;
}

/** Eine Kennzahl im Reiter „Statistik“, z. B. Samen „1.234 🌰“. */
export interface JournalStatView {
  /** Fester Schlüssel (Reihenfolge und DOM-Zuordnung), z. B. „seeds“. */
  key: string;
  label: string;
  value: string;
  /** Zusatz in einer zweiten Zeile, z. B. „45 Min. Spielzeit · jetzt 🍂 Herbst“. */
  detail?: string;
  /** Abschnitt „Über alle Zyklen“ (Langzeit-Statistik); fehlt = laufender Zyklus und Tagebuch. */
  section?: 'total';
}

/** Eine Angabe zu einem Wald im Reiter „Landschaft“, z. B. „Waldgedächtnis“ – „120 eigen · 270 wirksam“. */
export interface JournalLandscapeRowView {
  /** Fester Schlüssel: memory, ancient, lead, tree, regulars, fauna. */
  key: string;
  label: string;
  value: string;
}

/** Ein gegründeter Wald im Reiter „Landschaft“ (DESIGN_V2.md 24.11). */
export interface JournalSiteView {
  id: string;
  icon: string;
  name: string;
  /** Waldtyp, z. B. „Hartholzaue“. */
  forestType: string;
  /** Hier wächst der laufende Zyklus. */
  active: boolean;
  /** Hier war schon einmal Urwald (beim aktiven Wald auch: Stufe Urwald jetzt erreicht). */
  ancient: boolean;
  rows: JournalLandscapeRowView[];
}

/** Ein gebauter Korridor im Reiter „Landschaft“. */
export interface JournalCorridorView {
  id: string;
  icon: string;
  name: string;
  /** „Heimatwald – Auwald am Fluss“ */
  ends: string;
  /** „mit der Gründung, gratis“ bzw. „gebaut für 3 🪶“ */
  note: string;
}

/** Reiter „Landschaft“ (DESIGN_V2.md 24.3, 24.11) – nur nach der Freischaltung. */
export interface JournalLandscapeView {
  /** z. B. „3 von 6 Wäldern gegründet · 2 von 10 Korridoren“. */
  summary: string;
  /** Hähersaat: verdient, ausgegeben, verfügbar (Zeilen wie im Reiter „Statistik“). */
  jaySeeds: JournalLandscapeRowView[];
  /** Wie man Hähersaat verdient (ein Satz). */
  jaySeedsNote: string;
  /** Gegründete Wälder in Gründungs-Reihenfolge (Heimatwald zuerst). */
  sites: JournalSiteView[];
  corridors: JournalCorridorView[];
  /** Hinweis auf noch nicht gegründete Wälder (ohne Namen) – null, wenn alle gegründet sind. */
  sitesHint: string | null;
}

/** Das Naturtagebuch (DESIGN_V2.md 10 und 11.2). */
export interface JournalView {
  /** z. B. „12/32 Arten · 5/14 Pflanzen · 2/9 Gemeinschaften“. */
  counts: string;
  /** z. B. „Zyklus 2 · Waldgedächtnis 30 (+60 % Wachstum und Samen)“. */
  meta: string;
  /** z. B. „Stammgäste 1/2 – wähle unten bei den Arten“; null, solange es keine Plätze gibt. */
  regulars: string | null;
  species: JournalEntryView[];
  plants: JournalEntryView[];
  communities: JournalCommunityView[];
  keepsakes: JournalKeepsakeView[];
  /** Hauptbaum-Arten im Reiter „Andenken“ (MAIN_TREES-Reihenfolge). */
  trees: JournalTreeView[];
  /**
   * Kennzahlen im Reiter „Statistik“. Ändern sich laufend (Samen, Spielzeit) – der Dialog
   * aktualisiert dafür nur Texte und baut nichts neu.
   */
  stats: JournalStatView[];
  /** Erfolge: freigeschaltete zuerst, dann offene mit Fortschritt. */
  achievements: JournalAchievementView[];
  /** Reiter „Landschaft“ – null, solange die Landschaft nicht freigeschaltet ist (Reiter verborgen). */
  landscape: JournalLandscapeView | null;
  /** Zähler je Reiter, z. B. „12/32“ (Statistik ohne Zähler: leer; Landschaft verborgen: leer). */
  tabCounts: {
    species: string;
    plants: string;
    communities: string;
    keepsakes: string;
    achievements: string;
    landscape: string;
    stats: string;
  };
}

/** Gruppen der Pflege-Liste in Anzeige-Reihenfolge. */
export type CareGroup = 'buyable' | 'saving' | 'locked' | 'maxed';

/** Eine Pflegemaßnahme in der Seitenleiste (Schritt 2.7). */
export interface CareView {
  id: string;
  icon: string;
  name: string;
  /** Bereits gekaufte Ränge, z. B. „Rang 0/3“ (noch nichts gekauft) bzw. „voll ausgebaut“. */
  rank: string;
  /** Wirkung des nächsten Rangs in Kurzform; null, wenn voll ausgebaut. */
  next: string | null;
  /** Kosten des nächsten Rangs, z. B. „600 🌰“; null, wenn voll ausgebaut. */
  cost: string | null;
  /** Dieselben Kosten als Zahl (zum Sortieren); null, wenn voll ausgebaut. */
  costSeeds: number | null;
  /** Warum Kaufen gerade nicht geht (deutscher Text); null, wenn es geht. */
  blocker: string | null;
  canBuy: boolean;
  /**
   * Gruppe für die Sortierung: kaufbar, nur noch zu wenig Samen („sparen“), anders
   * gesperrt (Stufe, Ausschluss, Bedingung) oder voll ausgebaut.
   */
  group: CareGroup;
  /** Bestätigung nach dem Kauf des nächsten Rangs, z. B. „Nistkästen angebracht“; null, wenn voll ausgebaut. */
  boughtText: string | null;
  /** Vorschau des nächsten Rangs (Harmonie in Punkten, 🌿/🌰 relativ); null, wenn voll ausgebaut. */
  preview: { harmonyDelta: number; growthDelta: number; seedDelta: number } | null;
  /** Schutz vor rauem Wetter, z. B. „🛡️ Schützt vor 🌬️ Sturm – halbiert den Abzug“; sonst null. */
  protects?: string | null;
  /** Erklärung dazu (Tooltip); sonst null. */
  protectsDetail?: string | null;
  /**
   * Der nächste Rang öffnet einen verschlossenen Lebensraum (DESIGN_V2.md 23.2), z. B.
   * „Öffnet Lebensraum 🌾 Waldwiese“; sonst null.
   */
  opens?: string | null;
}

/**
 * Ein Einfluss auf die Zufriedenheit, der kein Wunsch ist: Störer, Räuber, Jahreszeit,
 * Baumart oder Fähigkeiten, z. B. „wird gestört von Eichelhäher (−15 Prozentpunkte)“.
 */
export interface DetailFactorView {
  /** Schlüssel für Tests und DOM (z. B. `disturb`, `season`). */
  key: string;
  icon: string;
  label: string;
  tone: Tone;
}

/**
 * Eine Fähigkeit der Art in der Tierdetail-Ansicht. Fähigkeiten wirken, solange die Art
 * lebt – darum ohne „aktiv“-Kennzeichen.
 */
export interface DetailAbilityView {
  name: string;
  text: string;
}

/**
 * Eine Lebensgemeinschaft, zu der die Art gehört. Unentdeckte stehen zusammengefasst in
 * einem Eintrag (Schlüssel `unknown-communities`): nur ihre Anzahl, ohne Name, ID,
 * Rätselhinweis oder Fortschritt – „x/3“ an der Art verriete die übrigen Mitglieder.
 */
export interface DetailCommunityView {
  key: string;
  discovered: boolean;
  icon: string;
  /** Name; bei Unentdeckten der Satz „Gehört zu einer noch unentdeckten …“. */
  name: string;
  active: boolean;
  /** z. B. „2/3 Mitglieder – fehlt: …“ – nur entdeckte, solange sie nicht bestehen. */
  progress?: string;
  /** Wirkung, z. B. „+8 Harmonie · +5 % 🌿“ (nur entdeckte). */
  effect?: string;
  /** Zusatz für Unentdeckte, z. B. Verweis auf die Rätselhinweise im Tagebuch. */
  hint?: string;
}

/**
 * Tierdetails (Klick auf eine eingezogene Art): alles wie auf der Begegnungskarte, aber
 * mit den Werten von jetzt. Alle Zahlen stammen aus der Auswertung des Kerns.
 */
export interface AnimalDetailView {
  id: string;
  name: string;
  family: FamilyKey;
  familyLabel: string;
  familyIcon: string;
  rarity: Rarity;
  nicheId: string;
  /** z. B. „🌳 Krone“. */
  nicheLabel: string;
  /** Zufriedenheit 0–1 (`evaluate(state).animals[id].happiness`). */
  happiness: number;
  /** Stimmung wie auf der Kachel. */
  mood: string;
  /**
   * Beitrag zum Ökosystem: jetzt gegenüber „ohne diese Art“ – Harmonie in Punkten, 🌿/🌰
   * relativ; `happiness` = aktuelle Zufriedenheit (für den 😊-Chip).
   */
  contribution: PreviewView;
  /**
   * Erklärung unter den Beitrags-Chips; bei Platz-Schaffern (Schwarzspecht, Borkenkäfer …)
   * mit dem Hinweis, dass ohne sie Plätze wegfielen – das zeigen die Chips nicht.
   */
  contributionNote: string;
  /** Futter und Wünsche mit ✓/✗ (Futter mit Anteil und Konkurrenz). */
  conditions: ConditionView[];
  /** Weitere Einflüsse: Störer, Räuber, Jahreszeit, Baumart, Fähigkeiten. */
  factors: DetailFactorView[];
  /** Räuber und Beute: Bestand, wen sie ernährt, wie es um ihr Futter steht (leer: keine Rolle). */
  predation: DetailPredationView[];
  /** Wirkungen der Art (ohne Fähigkeiten). */
  effects: EffectView[];
  abilities: DetailAbilityView[];
  communities: DetailCommunityView[];
  /** Stammgast-Status als Text; null, solange es keine Stammgast-Plätze gibt. */
  regular: string | null;
  /** Naturtext aus dem Tagebuch. */
  text?: string;
}
