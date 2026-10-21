import { CARE } from './content/care';
import { STAGES } from './content/stages';
import { evaluate, growth, nextPlantCost, type Evaluation } from './core/formulas';
import { clearStorage, exportCode, importCode, loadFromStorage, saveToStorage } from './core/save';
import { createInitialState, type GameState } from './core/state';
import type { PendingEncounterType } from './core/state';
import {
  chooseCard,
  buyCare,
  chooseEventOption,
  nextCareRank,
  declineEncounter,
  farewellVisitor,
  hostVisitor,
  plantSeed,
  rerollEncounter,
  newCycleBlocker,
  simulateOffline,
  startNewCycle,
  tick,
  toggleRegular,
  type ActionError,
  type ActionResult,
  type TickReport,
} from './core/tick';
import { drawScene, type SceneInput } from './render/tree';
import { PLANTS_BY_ID } from './content/plants';
import {
  harmonyTierIndex,
  tickDeclineText,
  catchUpNotice,
  discoveryText,
  refreshEcosystemView,
  toEcosystemView,
  toJournalView,
  toEncounterView,
  toPlantPickerView,
  activeBonusViews,
  toCareViews,
  encounterActionKey,
  toSceneAnimals,
  toSceneVisitors,
  toScenePlants,
} from './ui/adapters';
import { createBonusPanel } from './ui/bonus-panel';
import { createCarePanel } from './ui/care-panel';
import { createCyclePanel } from './ui/cycle-panel';
import { CYCLE_LOCKED_TEXT, newCycleBlockerText, newCycleToast, regularsArrivedText, toCyclePanelView, withRegulars } from './ui/cycle-view';
import { createEcosystemPanel } from './ui/ecosystem-panel';
import { createEncounterDialog } from './ui/encounter-dialog';
import { createEncounterStack } from './ui/encounter-stack';
import { createFloatLayer } from './ui/feedback';
import { createPlantPicker } from './ui/plant-picker';
import { createJournalButton, createJournalDialog } from './ui/journal-dialog';
import { createHelp, initPreferences, type Help } from './ui/help';
import { IMPORT_ERROR_TEXTS, createSaveTransfer, type SaveTransfer } from './ui/save-transfer';
import { isDeliberateConfirm } from './ui/confirm';
import { formatNumber } from './ui/format';
import type { EcosystemView } from './ui/view-model';

/*
 * Verdrahtung: Game Loop, Speichern, Offline-Fortschritt und die Oberfläche.
 * Reihenfolge: erst alle Konstanten und Variablen, dann die Funktionen, ganz unten der
 * Start. So greift beim Modul-Laden nichts auf noch nicht deklarierte Variablen zu.
 */

// --- Konstanten und DOM ------------------------------------------------------------

const AUTOSAVE_MS = 10_000;
/** Größere Frame-Sprünge werden auf diese Dauer begrenzt; längere Pausen holt catchUp() nach. */
const MAX_FRAME_SECONDS = 1;
/** Seitenleiste ohne Änderungen am Ökosystem höchstens so oft aktualisieren (Samen, Fortschritt). */
const PANEL_REFRESH_MS = 200;

const ERROR_TEXTS: Record<ActionError, string> = {
  'no-encounter': 'Diese Begegnung gibt es nicht mehr.',
  'no-card': 'Diese Karte gibt es nicht mehr.',
  present: 'Diese Art lebt schon in deinem Ökosystem.',
  closed: 'Diese Nische ist noch verschlossen.',
  'niche-full': 'Die Nische ist voll – wähle, wer weichen soll.',
  'invalid-replace': 'Dieses Tier kann gerade nicht weichen.',
  'too-expensive': 'Nicht genug Samen.',
  'no-cards': 'Keine passenden Tiere.',
  'no-alternatives': 'Keine anderen Tiere verfügbar.',
  'would-evict': 'Dann verlören Höhlenbewohner ihren Platz.',
  'ring-full': 'Kein Platz mehr für Pflanzen.',
  'unknown-plant': 'Diese Pflanze gibt es nicht.',
  locked: 'Diese Pflanze wächst hier noch nicht.',
  'cycle-locked': CYCLE_LOCKED_TEXT,
  'unknown-species': 'Diese Art gibt es nicht.',
  'not-discovered': 'Diese Art steht noch nicht in deinem Naturtagebuch.',
  'no-regular-slot': 'Alle Plätze für Stammgäste sind belegt.',
  'wrong-type': 'Das geht bei dieser Begegnung nicht.',
  'no-option': 'Diese Möglichkeit gibt es nicht.',
  'unknown-care': 'Diese Pflege gibt es nicht.',
  maxed: 'Diese Pflege ist schon voll ausgebaut.',
  stage: 'Diese Pflege gibt es erst auf einer späteren Stufe.',
  excluded: 'Das verträgt sich nicht mit einer anderen Pflege.',
  requires: 'Dafür fehlt noch etwas im Ökosystem.',
  'already-active': 'Dieser Gast rastet schon hier.',
};

/** Abweichende Texte, wenn die Aktion eine Pflanzenbegegnung („Etwas keimt“) betraf. */
const PLANT_ERROR_TEXTS: Partial<Record<ActionError, string>> = {
  'no-cards': 'Keine passenden Pflanzen.',
  'no-alternatives': 'Keine anderen Pflanzen verfügbar.',
  'invalid-replace': 'Diese Pflanze kann gerade nicht weichen.',
  closed: 'Der Pflanzring ist noch verschlossen.',
};

function errorText(error: ActionError, type: PendingEncounterType | undefined): string {
  return (type === 'plant' ? PLANT_ERROR_TEXTS[error] : undefined) ?? ERROR_TEXTS[error];
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const ctx = canvas.getContext('2d')!;
const banner = document.querySelector<HTMLElement>('#stage-banner')!;
const toast = document.querySelector<HTMLElement>('#toast')!;
/** Unsichtbare Statuszeile: schwebende Hinweise auch für Screenreader. */
const liveStatus = document.querySelector<HTMLElement>('#live-status')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const heading = document.querySelector<HTMLElement>('.panel h1')!;
/** Einstellungen (Bewegung, Zahlenformat, Hinweisdauer) – vor der ersten Anzeige angewendet. */
const preferences = initPreferences();

// --- Zustand -------------------------------------------------------------------------

/** Neues Spiel: Der Zufallsgenerator bekommt einmalig die Uhrzeit als Startwert. */
const newGame = (): GameState => createInitialState(Date.now(), Date.now());

const loaded = loadFromStorage(Date.now());
let state = loaded?.state ?? newGame();

let shownStage = state.stage;
let lastFrame = performance.now();
let lastSave = performance.now();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let resetTimer: ReturnType<typeof setTimeout> | undefined;
/** Wann „Spielstand löschen“ scharf geschaltet wurde (performance.now) – gegen Doppelklicks. */
let resetArmedAt = 0;
/** Bereich „Spielstand exportieren oder importieren“ (ab start()). */
let saveTransfer: SaveTransfer | undefined;
/** Hinweis vor dem Import eines v1-Codes. */
const V1_IMPORT_NOTE = 'Achtung: Das ist ein Spielstand der ersten Version – dein Wald beginnt damit neu.';

/** Der Spieler hat den Stapel geöffnet; bleibt offen, bis „Später“ oder keine Begegnung mehr wartet. */
let dialogWanted = false;
/** Begegnung oder Ökosystem haben sich geändert → Dialog-Inhalt neu bauen. */
let encounterDirty = true;
/** Bezahlbarkeit der Aktionen im Dialog (Neu würfeln, Bewirten) beim letzten Aufbau. */
let shownActionKey: string | null = null;
let shownQueued = -1;
/**
 * Zählt erledigte Begegnungen an der Spitze der Warteschlange. Damit erkennt der Dialog
 * auch zwei gleich aussehende Begegnungen nacheinander als verschieden.
 */
let encounterSerial = 0;

/** Ökosystem (Auswertung) hat sich geändert → Seitenleiste und Szene-Tiere neu bauen. */
let ecoDirty = true;
let ecoView: EcosystemView | null = null;
/** Spielanleitung und Einstellungen (ab start()). */
let help: Help | undefined;
let ecoEvaluation: Readonly<Evaluation> | null = null;
let lastPanelRefresh = -Infinity;

/** Der Spieler hat „Pflanze setzen“ geöffnet. */
let pickerWanted = false;
/** Ökosystem oder Samen-Lage geändert → Auswahl neu bauen. */
let pickerDirty = true;
let shownPickerAffordable: boolean | null = null;
/** Zuletzt in der Auswahl gezeigte Samen (ganze Zahl) und wann – drosselt die Kopfzeile. */
let pickerSeedsShown = -1;
let pickerSeedsAt = -Infinity;

/** Eingabe für den Renderer – ein Objekt für alle Frames, keine Allokationen pro Frame. */
const scene: SceneInput = {
  growth: 0,
  time: 0,
  animals: [],
  plants: [],
  reducedMotion: preferences.reducedMotion,
  // Stimmung der Szene (Harmoniestufe 0–4); gesetzt, sobald die Auswertung vorliegt.
  harmonyTier: undefined,
};

// --- Oberfläche ----------------------------------------------------------------------

const panel = createEcosystemPanel(document.querySelector<HTMLElement>('#ecosystem')!, {
  onOpenPlantPicker: openPlantPicker,
});
const bonusPanel = createBonusPanel(document.querySelector<HTMLElement>('#bonuses')!);
const carePanel = createCarePanel(document.querySelector<HTMLElement>('#care')!, {
  onBuy: (id) => {
    const result = buyCare(state, id);
    if (act(result, false)) announceDiscoveries(result);
  },
});
const cyclePanel = createCyclePanel(document.querySelector<HTMLElement>('#cycle')!, {
  onNewCycle: newCycle,
  onToggleRegular: (speciesId) => act(toggleRegular(state, speciesId), false),
});
const floats = createFloatLayer(document.body);
const stack = createEncounterStack(document.querySelector<HTMLElement>('#scene-dock')!, openEncounters);
const dialog = createEncounterDialog(document.body, {
  onChoose: (cardIndex, replaceId) => {
    const type = state.pendingEncounters[0]?.type;
    // Ereignis: Karte = Option; Gast: Karte 0 = bewirten, 1 = ziehen lassen.
    const result =
      type === 'event'
        ? chooseEventOption(state, 0, cardIndex)
        : type === 'visitor'
          ? cardIndex === 0
            ? hostVisitor(state, 0)
            : farewellVisitor(state, 0)
          : chooseCard(state, 0, cardIndex, replaceId);
    if (act(result, true, type)) {
      announceDiscoveries(result);
      if (result.ok && result.seeds) floatSeeds(result.seeds);
    }
  },
  onDecline: () => {
    const before = state.seeds;
    if (act(declineEncounter(state, 0), true)) floatSeeds(state.seeds - before);
  },
  onReroll: () => {
    const type = state.pendingEncounters[0]?.type;
    act(rerollEncounter(state, 0), false, type);
  },
  onDefer: closeEncounters,
});
const picker = createPlantPicker(document.body, {
  onPlant: plant,
  onClose: () => {
    pickerWanted = false;
    // Ist der Knopf jetzt weg (Ring voll), den Fokus nicht im Nichts lassen.
    if (document.activeElement === document.body || document.activeElement === null) {
      heading.focus({ preventScroll: true });
    }
  },
});

const journal = createJournalDialog(document.body, {
  onToggleRegular: (speciesId) => act(toggleRegular(state, speciesId), false),
});
createJournalButton(document.querySelector<HTMLElement>('#journal')!, openJournal);

// --- Aktionen ------------------------------------------------------------------------

/** „📖 Naturtagebuch“: andere Dialoge schließen, Tagebuch zeigen. */
function openJournal(): void {
  closeEncounters();
  closePlantPicker();
  journal.show(toJournalView(state, evaluate(state)));
}

/**
 * Führt das Ergebnis einer Spieleraktion nach: sofort speichern (Entscheidungen sollen
 * ein Neuladen sicher überstehen), Ansichten aktualisieren, Fehler kurz anzeigen.
 * `resolves`: Die Begegnung an der Spitze ist bei Erfolg erledigt.
 */
function act(result: ActionResult, resolves: boolean, type?: PendingEncounterType): boolean {
  if (result.ok) {
    saveToStorage(state);
    if (resolves) encounterSerial++;
  }
  encounterDirty = true;
  ecoDirty = true;
  pickerDirty = true;
  refreshViews(performance.now());
  if (!result.ok) notify(errorText(result.error, type));
  return result.ok;
}

/** „Pflanze setzen“: Samen ausgeben, Auswahl schließen, kurz zeigen, was passiert ist. */
function plant(plantId: string): void {
  const cost = nextPlantCost(state);
  const result = plantSeed(state, plantId);
  // Bei Erfolg schließt die Auswahl – vorher abmelden, damit act() sie nicht neu aufbaut.
  if (result.ok) pickerWanted = false;
  if (!act(result, false)) return;
  closePlantPicker();
  announceDiscoveries(result);
  const ring = document.querySelector<HTMLElement>('[data-ref="plant-ring"]');
  const seedsEl = document.querySelector<HTMLElement>('[data-ref="seeds"]');
  if (seedsEl) {
    const rect = seedsEl.getBoundingClientRect();
    floats.spawn(`−${formatNumber(Math.ceil(cost))} 🌰`, rect.left + rect.width / 2, rect.top);
  }
  if (ring) {
    const rect = ring.getBoundingClientRect();
    floats.spawn(`🌱 ${PLANTS_BY_ID.get(plantId)?.name ?? ''}`, rect.left + rect.width / 2, rect.top + 24);
  }
}

/** Neu entdeckte Lebensgemeinschaften ruhig melden (Toast bzw. Hinweis im offenen Dialog). */
function announceDiscoveries(result: ActionResult): void {
  const text = result.ok ? discoveryText(result.discovered) : null;
  if (text) notify(text);
}

/** „Neuen Zyklus beginnen“ (schon bestätigt): Waldgedächtnis gutschreiben, Baum beginnt neu. */
function newCycle(): void {
  // Alter Baum für die Übergangs-Sequenz der Szene (vor dem Reset festhalten).
  const fromGrowth = growth(state);
  const fromPlants = scene.plants;
  const result = startNewCycle(state, Date.now());
  if (!result.ok) {
    const blocker = newCycleBlocker(state);
    notify(blocker ? newCycleBlockerText(blocker) : ERROR_TEXTS[result.error]);
    return;
  }
  shownStage = state.stage;
  // Gleicher Takt wie scene.time (rAF-Zeitstempel / 1000); das Feld darf stehen bleiben.
  scene.cycleTransition = { startedAt: performance.now() / 1000, fromGrowth, fromPlants };
  closeEncounters();
  closePlantPicker();
  encounterSerial++;
  act(result, false);
  // Der Knopf ist jetzt ausgeblendet – Fokus auf die Überschrift des Bereichs statt auf body.
  cyclePanel.focus();
  showToast(newCycleToast(result.preview.memoryGain, state.cycle.number, result.regulars));
}

function openPlantPicker(): void {
  closeEncounters();
  pickerWanted = true;
  pickerDirty = true;
  refreshPicker();
}

function closePlantPicker(): void {
  pickerWanted = false;
  picker.hide();
}

/**
 * Auswahl „Pflanze setzen“ nur bei Änderungen neu bauen (Ökosystem, Samen reichen
 * (nicht mehr)); die Samen-Zeile nur bei neuer ganzer Zahl oder höchstens alle 200 ms.
 */
function refreshPicker(now = performance.now()): void {
  if (!pickerWanted) {
    if (picker.open) picker.hide();
    return;
  }
  const affordable = state.seeds >= nextPlantCost(state);
  if (!pickerDirty && picker.open && affordable === shownPickerAffordable) {
    const whole = Math.floor(state.seeds);
    if (whole !== pickerSeedsShown || now - pickerSeedsAt >= PANEL_REFRESH_MS) {
      pickerSeedsShown = whole;
      pickerSeedsAt = now;
      picker.updateSeeds(state.seeds);
    }
    return;
  }
  pickerDirty = false;
  pickerSeedsShown = Math.floor(state.seeds);
  pickerSeedsAt = now;
  shownPickerAffordable = affordable;
  picker.show(toPlantPickerView(state, evaluate(state)), state.seeds);
}

function openEncounters(): void {
  if (state.pendingEncounters.length === 0) return;
  closePlantPicker();
  dialogWanted = true;
  encounterDirty = true;
  refreshEncounter();
}

function closeEncounters(): void {
  dialogWanted = false;
  dialog.hide();
}

/** Kurzer Hinweis: im offenen Dialog dort, sonst als Toast (der Dialog würde ihn verdecken). */
function notify(text: string): void {
  if (picker.open) picker.notice(text);
  else if (dialog.open) dialog.notice(text);
  else if (journal.open) journal.notice(text);
  else if (!help?.notice(text)) showToast(text);
}

// --- Ansichten -----------------------------------------------------------------------

/**
 * Zeigt die älteste wartende Begegnung, wenn der Spieler den Stapel geöffnet hat.
 * `show` nur bei Änderungen: neue Begegnung/Ökosystem, Anzahl wartender, Samen reichen
 * (nicht mehr) fürs Neuwürfeln.
 */
function refreshEncounter(): void {
  const pending = state.pendingEncounters.length;
  if (!dialogWanted || pending === 0) {
    if (pending === 0) dialogWanted = false;
    if (dialog.open) {
      dialog.hide();
      // Der Stapel ist weg – Fokus nicht im Nichts (body) stranden lassen.
      if (stack.element.hidden && (document.activeElement === document.body || document.activeElement === null)) {
        heading.focus({ preventScroll: true });
      }
    }
    return;
  }
  const queued = pending - 1;
  // Ändert sich, ob Neu würfeln bzw. Bewirten bezahlbar ist, wird der Dialog neu gebaut.
  const actionKey = encounterActionKey(state, 0);
  if (!encounterDirty && dialog.open && actionKey === shownActionKey && queued === shownQueued) return;
  const view = toEncounterView(state, 0, evaluate(state));
  if (!view) return;
  view.key = String(encounterSerial);
  encounterDirty = false;
  shownActionKey = actionKey;
  shownQueued = queued;
  dialog.show(view, queued);
}

/** Seitenleiste: Struktur nur bei Änderungen am Ökosystem, Zahlen gedrosselt. */
function refreshPanel(now: number): void {
  if (ecoDirty || !ecoView) {
    ecoDirty = false;
    // Neuer Zyklus und Stammgäste ändern sich nur mit Ökosystem, Wegpunkt oder Aktionen.
    cyclePanel.update(toCyclePanelView(state));
    const ev = evaluate(state);
    if (journal.open) journal.update(toJournalView(state, ev));
    scene.forestMemory = state.meta.forestMemory;
    if (!ecoView || ev !== ecoEvaluation) {
      ecoEvaluation = ev;
      ecoView = toEcosystemView(state, ev);
      // Tiere und Pflanzen für die Szene nur bei Änderungen am Ökosystem neu bauen.
      scene.animals = toSceneAnimals(state, ev);
      scene.plants = toScenePlants(state, ev);
      scene.visitors = toSceneVisitors(state);
      scene.harmonyTier = harmonyTierIndex(ev.harmony);
    } else {
      refreshEcosystemView(ecoView, state);
    }
  } else if (now - lastPanelRefresh >= PANEL_REFRESH_MS) {
    refreshEcosystemView(ecoView, state);
  } else {
    return;
  }
  lastPanelRefresh = now;
  panel.update(ecoView);
  // Restzeiten der Boni laufen – gedrosselt wie die Zahlen der Seitenleiste.
  bonusPanel.update(activeBonusViews(state));
  refreshCare();
}

/**
 * Pflege-Liste: Vorschauen nur neu rechnen, wenn sich das Ökosystem, die Frage „reichen
 * die Samen?“ oder ein fehlender Betrag („Noch X 🌰“) ändert.
 */
let careKey = '';
function refreshCare(): void {
  const ev = evaluate(state);
  // Je Maßnahme: bezahlbar (1), fehlender Betrag (aufgerundet) oder voll ausgebaut (-).
  let key = '';
  for (const m of CARE) {
    const cost = nextCareRank(state, m.id)?.cost;
    key += (cost === undefined ? '-' : cost <= state.seeds ? '1' : Math.ceil(cost - state.seeds)) + ',';
  }
  if (ev === careEvaluation && key === careKey) return;
  careEvaluation = ev;
  careKey = key;
  carePanel.update(toCareViews(state, ev));
}
let careEvaluation: Readonly<Evaluation> | null = null;

function refreshViews(now: number): void {
  refreshPanel(now);
  stack.update(state.pendingEncounters.length, state.pendingEncounters[0]?.type ?? 'animal');
  refreshEncounter();
  refreshPicker(now);
}

function floatSeeds(amount: number): void {
  const target = document.querySelector<HTMLElement>('[data-ref="seeds"]');
  if (!target || amount <= 0) return;
  const rect = target.getBoundingClientRect();
  floats.spawn(`+${formatNumber(amount)} 🌰`, rect.left + rect.width / 2, rect.top);
}

/**
 * Dezenter Hinweis über der Szene nach einem Tick: Wegpunkte ohne Begegnung (nichts
 * Passendes oder Stapel voll; die Samen dafür schweben am Vorrat hoch) und eingezogene
 * Stammgäste – in einem Text, damit sich nichts überdeckt.
 */
function noteTick(report: TickReport): void {
  const parts: string[] = [];
  if (report.autoDeclined > 0) {
    parts.push(tickDeclineText(report));
  }
  if (report.regulars.length > 0) parts.push(regularsArrivedText(report.regulars));
  if (parts.length > 0) noteText(parts.join(' '));
}

/**
 * Kurzer schwebender Hinweis über der Szene. Ist der Kartenwahl-Dialog oder die
 * Pflanzenauswahl offen, verdeckt sie die Szene – dann steht der Hinweis dort (notify),
 * sichtbar und für Screenreader erreichbar.
 */
function noteText(text: string): void {
  if (picker.open || dialog.open || journal.open || help?.open) {
    notify(text);
    return;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) floats.spawn(text, rect.left + rect.width / 2, rect.top + rect.height * 0.3, 'note');
  // Die schwebende Zahl ist für Screenreader verborgen – derselbe Text in der Statuszeile.
  liveStatus.textContent = '';
  requestAnimationFrame(() => (liveStatus.textContent = text));
}

function showBanner(title: string, text: string): void {
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = text;
  banner.replaceChildren(strong, span);
  banner.classList.remove('visible');
  void banner.offsetWidth; // Animation neu starten
  banner.classList.add('visible');
}

function showToast(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), preferences.toastMs());
}

// --- Spielstand löschen (zweiter Klick bestätigt, ohne confirm()) --------------------

function disarmReset(): void {
  clearTimeout(resetTimer);
  resetTimer = undefined;
  resetButton.textContent = 'Spielstand löschen';
  resetButton.classList.remove('armed');
}

function onReset(event: MouseEvent): void {
  if (resetTimer === undefined) {
    if (event.detail > 1) return;
    resetButton.textContent = 'Wirklich alles löschen? Zum Bestätigen erneut klicken';
    resetButton.classList.add('armed');
    resetArmedAt = performance.now();
    resetTimer = setTimeout(disarmReset, 4000);
    return;
  }
  // Doppelklick oder gehaltene Enter-Taste bestätigen nicht.
  if (!isDeliberateConfirm(event, resetArmedAt, performance.now())) return;
  disarmReset();
  clearStorage();
  replaceState(newGame());
}

/** Ersetzt den ganzen Spielstand (Löschen, Import): Dialoge zu, alles neu aufbauen, speichern. */
function replaceState(next: GameState): void {
  state = next;
  // Laufende Übergangs-Sequenz und offene Bestätigungen gehören zum alten Stand.
  scene.cycleTransition = undefined;
  disarmReset();
  cyclePanel.disarm();
  saveTransfer?.reset();
  shownStage = state.stage;
  closeEncounters();
  closePlantPicker();
  journal.hide();
  encounterSerial++;
  encounterDirty = true;
  ecoDirty = true;
  pickerDirty = true;
  saveToStorage(state);
  refreshViews(performance.now());
}

// --- Spielstand exportieren / importieren (Text-Code) --------------------------------

/** Bereich „Spielstand exportieren oder importieren“ neben „Spielstand löschen“. */
function setupSaveTransfer(): void {
  saveTransfer = createSaveTransfer(resetButton.parentElement!, {
    getCode: () => exportCode(state),
    validate: (code) => {
      const result = importCode(code, Date.now());
      if (!result.ok) return { ok: false, message: IMPORT_ERROR_TEXTS[result.error] };
      return result.result.migratedFromV1 ? { ok: true, note: V1_IMPORT_NOTE } : { ok: true };
    },
    onImport: (code) => {
      const result = importCode(code, Date.now());
      if (!result.ok) return IMPORT_ERROR_TEXTS[result.error];
      replaceState(result.result.state);
      if (result.result.migratedFromV1) showToast(v1NoticeText(result.result.keepsake));
      return null;
    },
  });
}

/** Meldung nach dem Laden eines v1-Stands (beim Start oder per Import). */
function v1NoticeText(keepsake: boolean): string {
  return keepsake
    ? 'Dein Wald beginnt neu – mit Erinnerungen. Andenken „Die alte Eiche“: +5 Waldgedächtnis.'
    : 'Dein Wald beginnt neu – das Spiel hat sich verändert.';
}

// --- Game Loop -----------------------------------------------------------------------

function frame(now: number): void {
  // Nach Ruhezustand bei sichtbarem Tab: Die Wanduhr ist weit vorgelaufen → nachrechnen.
  if (Date.now() - state.lastTick > MAX_FRAME_SECONDS * 1000) {
    catchUp();
    lastFrame = now;
  }
  const dt = Math.min(Math.max(0, (now - lastFrame) / 1000), MAX_FRAME_SECONDS);
  lastFrame = now;
  const report = tick(state, dt);
  state.lastTick = Date.now();
  if (report.waypoints > 0 || report.encounters > 0 || report.interludesReached > 0 || report.expired.length > 0) {
    // Neue Begegnung, Zwischenhalt (auch ohne Ergebnis – der Zufall ist verbraucht) oder
    // abgelaufener Bonus: gleich speichern, damit Neuladen nichts neu würfelt, und
    // Ansichten neu bauen.
    saveToStorage(state);
    encounterDirty = true;
    ecoDirty = true;
  }
  noteTick(report);

  if (state.stage !== shownStage) {
    shownStage = state.stage;
    encounterDirty = true;
    ecoDirty = true;
    pickerDirty = true;
    showBanner(STAGES[state.stage]!.name, STAGES[state.stage]!.description);
  }

  refreshViews(now);
  resizeCanvas();
  const rect = canvas.getBoundingClientRect();
  scene.growth = growth(state);
  scene.time = now / 1000;
  drawScene(ctx, rect.width, rect.height, scene);

  if (now - lastSave > AUTOSAVE_MS) {
    saveToStorage(state);
    lastSave = now;
  }
  requestAnimationFrame(frame);
}

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Rechnet die Zeit seit dem letzten Tick nach – beim Start, wenn ein Tab aus dem
 * Hintergrund zurückkehrt (dort pausiert requestAnimationFrame) und nach Ruhezustand.
 */
function catchUp(): void {
  const away = (Date.now() - state.lastTick) / 1000;
  if (away > MAX_FRAME_SECONDS) {
    const report = simulateOffline(state, away);
    const notice = catchUpNotice(away, report, state.pendingEncounters.length);
    if (notice?.kind === 'welcome') notify(withRegulars(notice.text, report.regulars));
    else {
      // Ein gemeinsamer Hinweis, damit sich zwei schwebende Texte nicht überdecken.
      const text = [notice?.text ?? '', regularsArrivedText(report.regulars)].filter(Boolean).join(' ');
      if (text) noteText(text);
    }
    if (report.waypoints > 0 || report.encounters > 0 || report.interludesReached > 0 || report.expired.length > 0) {
      saveToStorage(state);
      encounterDirty = true;
      ecoDirty = true;
    }
  }
  state.lastTick = Date.now();
  lastFrame = performance.now();
}

// --- Start ---------------------------------------------------------------------------

function start(): void {
  if (loaded?.migratedFromV1) {
    // Alter v1-Stand: Neustart, sofort als v2 speichern, damit die Meldung nur einmal kommt.
    saveToStorage(state);
    showToast(v1NoticeText(loaded.keepsake));
  }
  catchUp();

  resetButton.addEventListener('click', onReset);
  setupSaveTransfer();
  help = createHelp(document.querySelector<HTMLElement>('#help')!, preferences, { newGame: !loaded });
  preferences.onChange(() => {
    scene.reducedMotion = preferences.reducedMotion;
    // Zahlenformat kann sich geändert haben: Ansichten vollständig neu aufbauen.
    ecoView = null;
    ecoDirty = true;
    encounterDirty = true;
    pickerDirty = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveToStorage(state);
    else catchUp();
  });
  window.addEventListener('beforeunload', () => saveToStorage(state));

  refreshViews(performance.now());
  requestAnimationFrame(frame);
}

start();
