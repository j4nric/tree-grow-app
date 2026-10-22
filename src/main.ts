import { CARE } from './content/care';
import { NOON_PHASE } from './content/daytime';
import { checkAchievements } from './core/achievements';
import { dayKeyOf, updateDaily, type DailyUpdateOptions } from './core/daily';
import { dayPhaseAt, evaluate, growth, nextPlantCost, type Evaluation } from './core/formulas';
import { clearStorage, exportCode, importCode, loadFromStorage, saveToStorage } from './core/save';
import { sceneSeason } from './core/season';
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
import { drawScene, hitTestAnimal, type AnimalHit, type HitScene, type SceneInput } from './render/tree';
import { CanvasSizer } from './render/canvas-size';
import type { CanvasSize } from './render/resize';
import { Camera } from './render/camera';
import { attachCameraInput, createCameraControls, loadCameraView } from './ui/camera-input';
import { PLANTS_BY_ID } from './content/plants';
import {
  harmonyTierIndex,
  tickDeclineText,
  catchUpNotice,
  discoveryText,
  refreshEcosystemView,
  toEcosystemView,
  toJournalStats,
  toJournalView,
  toEncounterView,
  toPlantPickerView,
  activeBonusViews,
  toCareViews,
  encounterActionKey,
  toSceneAnimals,
  scenePond,
  toSceneVisitors,
  toScenePlants,
  stageBannerView,
  type StageBannerView,
} from './ui/adapters';
import { seedsLabel } from './ui/view-format';
import { achievementUnlockedText, achievementsBackfilledText, toAchievementTimeProgress } from './ui/achievement-view';
import { createBonusPanel } from './ui/bonus-panel';
import { createDailyPanel } from './ui/daily-panel';
import { dailyCompletedText, toDailyView } from './ui/daily-view';
import { createCarePanel } from './ui/care-panel';
import { createCyclePanel } from './ui/cycle-panel';
import { CYCLE_LOCKED_TEXT, newCycleBlockerText, newCycleToast, regularsArrivedText, toCyclePanelView, withRegulars } from './ui/cycle-view';
import { createEcosystemPanel } from './ui/ecosystem-panel';
import { createAnimalDetailDialog } from './ui/animal-detail-dialog';
import { toAnimalDetailView, type AnimalDetailTarget } from './ui/animal-detail-view';
import { createEncounterDialog } from './ui/encounter-dialog';
import { createEncounterStack } from './ui/encounter-stack';
import { createFloatLayer } from './ui/feedback';
import { createPlantPicker } from './ui/plant-picker';
import { createJournalButton, createJournalDialog } from './ui/journal-dialog';
import { createHelp, initPreferences, type Help } from './ui/help';
import { createSound } from './ui/sound';
import { IMPORT_ERROR_TEXTS, createSaveTransfer, type SaveTransfer } from './ui/save-transfer';
import { isDeliberateConfirm } from './ui/confirm';
import { formatNumber } from './ui/format';
import { createSeasonBadge } from './ui/season-badge';
import { setupServiceWorker } from './ui/pwa';
import { toSeasonBadgeView } from './ui/season-view';
import { createWeatherBadge } from './ui/weather-badge';
import { toastDurationFor } from './ui/settings';
import { seasonWeatherChangeText, toWeatherBadgeView } from './ui/weather-view';
import { isNight } from './core/weather';
import type { MainTreeId } from './content/trees';
import type { EcosystemView } from './ui/view-model';
import { adoptedLastTick, codeCheck, progressOfState, readSyncUrl } from './sync/config';
import type { AccountController } from './sync/account';

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
/**
 * Erfolge nach Ticks höchstens so oft prüfen (Spielzeit, Jahreszeiten); bei Wegpunkten und
 * Jahreszeitwechseln sofort, nach Aktionen immer (act).
 */
const ACHIEVEMENT_CHECK_MS = 1000;
/** Tagesziele im Game Loop höchstens so oft nachführen (aktiv gespielte Zeit wird gesammelt). */
const DAILY_CHECK_MS = 1000;

/**
 * Konto (optional): nur mit der Build-Variable VITE_SYNC_URL (Adresse des Sync-Servers) –
 * oder in e2e-Tests über `window.__VSZW_SYNC_URL__` (vor dem Laden gesetzt). Sonst gibt es
 * keine Konto-Oberfläche und keine Netzaufrufe; der Konto-Code wird erst bei Bedarf geladen.
 */
const syncUrl =
  readSyncUrl((window as unknown as { __VSZW_SYNC_URL__?: unknown }).__VSZW_SYNC_URL__) ?? readSyncUrl(import.meta.env.VITE_SYNC_URL);

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
  'tree-locked': 'Diese Baumart kannst du noch nicht wählen.',
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
const canvasSizer = new CanvasSizer(canvas);
const banner = document.querySelector<HTMLElement>('#stage-banner')!;
const toast = document.querySelector<HTMLElement>('#toast')!;
/** Unsichtbare Statuszeile: schwebende Hinweise auch für Screenreader. */
const liveStatus = document.querySelector<HTMLElement>('#live-status')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const heading = document.querySelector<HTMLElement>('.panel h1')!;
/** Einstellungen (Bewegung, Zahlenformat, Hinweisdauer, Klang) – vor der ersten Anzeige angewendet. */
const preferences = initPreferences();
/** Klangkulisse (Standard aus; der AudioContext entsteht erst bei einer Nutzerinteraktion). */
const sound = createSound(preferences.settings.sound);

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
/**
 * Gesperrt, wenn ein anderer Tab mit einem anderen Konto spielt (Konto-Abgleich): Dann darf
 * dieser Tab den gemeinsamen Spielstand im localStorage nie mehr schreiben – auch nicht beim
 * Verlassen der Seite –, sonst landete sein Spiel nach dem Neuladen im anderen Konto.
 */
let storageFrozen = false;

/** Spielstand speichern (außer gesperrt). */
function persist(): void {
  if (storageFrozen) return;
  // Offene Aktion eines anderen Tabs im gespeicherten Stand: vorher sichern.
  account?.beforePersist();
  let raw = saveToStorage(state);
  // Speicher voll: Sicherungen des Konto-Abgleichs weichen lassen – der Spielstand geht vor.
  while (raw === null && account?.makeRoom()) raw = saveToStorage(state);
  // Abgleich-Angaben (wem der Stand gehört) im selben Takt dazu – nur, wenn er gespeichert ist.
  if (raw !== null) account?.persisted(raw);
}

/** Konto-Abgleich (nur wenn konfiguriert, nach dem Nachladen). */
let account: AccountController | undefined;
/** Hinweis vor dem Import eines v1-Codes. */
/** Einmal nach dem Laden eines v2–v6-Stands mit Waldgedächtnis (Balancing 2.10, LoadResult.memoryReweighted). */
const MEMORY_REWEIGHTED_TEXT = 'Das Waldgedächtnis wurde neu gewichtet: +1 % je Punkt.';
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
/** Letzte gedrosselte Prüfung der Erfolge im Game Loop (performance.now). */
let lastAchievementCheck = -Infinity;
/** Letzte gedrosselte Prüfung der Tagesziele und seither aktiv gespielte Sekunden. */
let lastDailyCheck = -Infinity;
let dailySeconds = 0;
/** Seither aktiv gutgeschriebenes Wachstum bzw. erzeugte Samen (für Wachstums- und Samen-Ziele). */
let dailyGrowth = 0;
let dailyProduced = 0;
/** Zuletzt gesehener Abstand zur Serverzeit (null = noch keiner). */
let dailyOffset: number | null = null;

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
  // Die Größe kommt schon entprellt aus dem CanvasSizer: keine zweite Wartezeit im Renderer.
  sizeSettled: true,
};

// --- Kamera der Szene (nur Oberflächen-Zustand, nicht im Spielstand) ---------------------

/** Zoom und Ausschnitt; die Ansicht der Sitzung bleibt beim Neuladen erhalten. */
const camera = new Camera(loadCameraView());
camera.reducedMotion = preferences.reducedMotion;
scene.camera = camera.view;
/** Größe der Szene im letzten Frame (für den Treffer-Test). */
let sceneSize: CanvasSize | null = null;
/** Eingabe für den Treffer-Test – ein Objekt, bei Bedarf aus der Szene aufgefrischt. */
const hitScene: HitScene = { width: 0, height: 0, growth: 0, time: 0 };

function hitTestScene(x: number, y: number): AnimalHit | null {
  if (!sceneSize) return null;
  hitScene.width = sceneSize.width;
  hitScene.height = sceneSize.height;
  hitScene.growth = scene.growth;
  hitScene.time = performance.now() / 1000;
  hitScene.animals = scene.animals;
  hitScene.reducedMotion = scene.reducedMotion;
  hitScene.mainTree = scene.mainTree;
  hitScene.season = scene.season;
  return hitTestAnimal(hitScene, camera.view, x, y);
}

/**
 * Tippen oder Klicken auf ein Tier in der Szene öffnet seine Detailansicht (`hit.index` =
 * Platz in `state.niches`); beim Schließen geht der Fokus an die Szene zurück. Per
 * Tastatur sind dieselben Tiere über die Kacheln der Seitenleiste erreichbar.
 */
function onAnimalTap(hit: AnimalHit): void {
  openAnimalDetail({ niche: hit.nicheId, index: hit.index }, canvas);
}

const cameraInput = attachCameraInput(canvas, { camera, hitTest: hitTestScene, onAnimalTap });
const cameraControls = createCameraControls(document.querySelector<HTMLElement>('.scene')!, camera);

// --- Oberfläche ----------------------------------------------------------------------

const panel = createEcosystemPanel(document.querySelector<HTMLElement>('#ecosystem')!, {
  onOpenPlantPicker: openPlantPicker,
  onOpenEncounters: openEncounters,
  onOpenAnimal: (_niche, _index, speciesId, button) => openAnimalDetail(speciesId, button),
  onShowCare: (id) => carePanel.reveal(id),
});
const bonusPanel = createBonusPanel(document.querySelector<HTMLElement>('#bonuses')!);
const dailyPanel = createDailyPanel(document.querySelector<HTMLElement>('#daily')!);
const carePanel = createCarePanel(document.querySelector<HTMLElement>('#care')!, {
  onBuy: (id) => act(buyCare(state, id), false),
  onFeedback: (text, x, y) => floats.spawn(text, x, y, 'note'),
});
const seasonBadge = createSeasonBadge(document.querySelector<HTMLElement>('#season')!);
const weatherBadge = createWeatherBadge(document.querySelector<HTMLElement>('#season')!, seasonBadge.element);
/** Ganze Sekunde Spielzeit, zu der das Abzeichen zuletzt aktualisiert wurde. */
let seasonShownSecond = -1;
/** Zuletzt angezeigt: Nacht? (Wechsel → Raten und 🌙 neu, DESIGN_V2.md 21.8). */
let shownNight: boolean | null = null;
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
    if (act(result, true, type) && result.ok && result.seeds) floatSeeds(result.seeds);
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
const animalDetail = createAnimalDetailDialog(document.body);

// --- Aktionen ------------------------------------------------------------------------

/**
 * Tierdetails einer eingezogenen Art öffnen – aus der Seitenleiste und per Klick auf ein
 * Tier in der Szene (`onAnimalTap`). `target`: Art-ID oder `{ niche, index }` (Platz in
 * `state.niches`). `returnFocus`: bekommt beim Schließen den Fokus (Standard: aktives
 * Element). Gibt false zurück, wenn dort kein Tier lebt.
 */
function openAnimalDetail(target: AnimalDetailTarget, returnFocus?: HTMLElement | null): boolean {
  const view = toAnimalDetailView(state, target, evaluate(state));
  if (!view) return false;
  closeEncounters();
  closePlantPicker();
  journal.hide();
  animalDetail.show(view, returnFocus);
  return true;
}

/** „📖 Naturtagebuch“: andere Dialoge schließen, Tagebuch zeigen. */
function openJournal(): void {
  closeEncounters();
  closePlantPicker();
  animalDetail.hide();
  journal.show(toJournalView(state, evaluate(state)));
}

/**
 * Führt das Ergebnis einer Spieleraktion nach: Erfolge prüfen, sofort speichern
 * (Entscheidungen sollen ein Neuladen sicher überstehen), Ansichten aktualisieren, Fehler
 * kurz anzeigen. Neu entdeckte Lebensgemeinschaften und Erfolge in einem ruhigen Hinweis
 * (Toast bzw. im offenen Dialog), damit sich nichts gegenseitig verdrängt.
 * `resolves`: Die Begegnung an der Spitze ist bei Erfolg erledigt.
 */
function act(result: ActionResult, resolves: boolean, type?: PendingEncounterType): boolean {
  let unlocked: string[] = [];
  let dailyText = '';
  if (result.ok) {
    unlocked = checkAchievements(state);
    // Tagesziele: Aktionen zählen sofort (Begegnungen, Pflanze, Pflege, Zustände).
    // Ohne schwebende Zahl: Die Aktion zeigt ihre Samen schon (z. B. Ablehnen) – der Hinweis nennt die Belohnung.
    dailyText = runDaily({}, false);
    // Erst vormerken, dann speichern: so stehen Spielstand und „offen“ im selben Schreibvorgang.
    account?.markAction();
    persist();
    if (resolves) encounterSerial++;
  }
  encounterDirty = true;
  ecoDirty = true;
  pickerDirty = true;
  refreshViews(performance.now());
  if (!result.ok) {
    notify(errorText(result.error, type));
    return false;
  }
  if (unlocked.length > 0) sound.cue('achievement');
  const regulars = result.regulars && result.regulars.length > 0 ? regularsArrivedText(result.regulars) : '';
  const text = joinNotes(discoveryText(result.discovered), regulars, achievementUnlockedText(unlocked), dailyText);
  if (text) notify(text);
  return true;
}

/**
 * Heutiger Tag für die Tagesziele („JJJJ-MM-TT“, lokale Zeit). Mit angemeldetem Konto zählt
 * die Uhr des Servers, sobald der Abgleich ihre Antwort kennt (Abstand aus `serverTime`).
 * Davor – beim Start und beim Nachrechnen der Offline-Zeit, bevor das Konto geladen ist –
 * gilt die Geräteuhr; eine falsch gestellte Uhr kann also einen falschen Tag bringen. Der
 * Game Loop prüft nach der ersten Server-Antwort sofort erneut; ein Tag, der mehr als einen
 * Tag in der Zukunft liegt, setzt core/daily.ts auf heute zurück. Zeitzone: die des Geräts.
 */
function today(): string {
  // Nur in e2e-Builds (VITE_E2E): `window.__VSZW_DAILY__ = false` schaltet die Tagesziele ab.
  if (import.meta.env.VITE_E2E && (window as unknown as { __VSZW_DAILY__?: unknown }).__VSZW_DAILY__ === false) return '';
  const d = new Date(Date.now() + (account?.serverOffsetMs() ?? 0));
  return dayKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Tagesziele nachführen (Tageswechsel, Fortschritt, Belohnung). Speichert bei Änderungen,
 * markiert betroffene Ansichten und gibt den Hinweis zurück ('' wenn nichts erfüllt wurde).
 * `float`: gutgeschriebene Samen am Vorrat hochschweben lassen.
 */
function runDaily(options: DailyUpdateOptions, float = true): string {
  const seedsBefore = state.seeds;
  const queued = state.pendingEncounters.length;
  const result = updateDaily(state, today(), options);
  if (!result.rolled && result.completed.length === 0) return '';
  persist();
  ecoDirty = true;
  if (result.completed.length === 0) return '';
  if (state.pendingEncounters.length !== queued) encounterDirty = true;
  pickerDirty = true;
  sound.cue('achievement');
  if (float) floatSeeds(state.seeds - seedsBefore);
  return dailyCompletedText(result.completed, result.perfect, state.meta.daily.streak);
}

/** Mehrere Hinweise als ein Text (leere weglassen); '' wenn nichts bleibt. */
function joinNotes(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** „Pflanze setzen“: Samen ausgeben, Auswahl schließen, kurz zeigen, was passiert ist. */
function plant(plantId: string): void {
  const cost = nextPlantCost(state);
  const result = plantSeed(state, plantId);
  // Bei Erfolg schließt die Auswahl – vorher abmelden, damit act() sie nicht neu aufbaut.
  if (result.ok) pickerWanted = false;
  if (!act(result, false)) return;
  closePlantPicker();
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

/**
 * „Neuen Zyklus beginnen“ (schon bestätigt): Waldgedächtnis gutschreiben, Baum beginnt neu
 * – aus der Frucht der gewählten Art.
 */
function newCycle(mainTree: MainTreeId): void {
  // Alter Baum für die Übergangs-Sequenz der Szene (vor dem Reset festhalten).
  const fromGrowth = growth(state);
  const fromPlants = scene.plants;
  const fromTree = state.cycle.mainTree;
  const result = startNewCycle(state, Date.now(), mainTree);
  if (!result.ok) {
    const blocker = newCycleBlocker(state);
    notify(blocker ? newCycleBlockerText(blocker) : ERROR_TEXTS[result.error]);
    return;
  }
  shownStage = state.stage;
  // Gleicher Takt wie scene.time (rAF-Zeitstempel / 1000); das Feld darf stehen bleiben.
  scene.cycleTransition = { startedAt: performance.now() / 1000, fromGrowth, fromPlants, fromTree };
  closeEncounters();
  closePlantPicker();
  encounterSerial++;
  act(result, false);
  // Der Knopf ist jetzt ausgeblendet – Fokus auf die Überschrift des Bereichs statt auf body.
  cyclePanel.focus();
  // Erfolge prüft startNewCycle selbst (vor dem Zurücksetzen) – im selben Hinweis melden.
  showToast(
    joinNotes(
      newCycleToast(result.preview.memoryGain, state.cycle.number, result.regulars, state.cycle.mainTree),
      achievementUnlockedText(result.achievements),
    ),
  );
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
  else if (animalDetail.open) animalDetail.notice(text);
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
      scene.pond = scenePond(ev);
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
  // Statistik im Naturtagebuch: Samen, Spielzeit usw. laufen – nur Texte, gedrosselt.
  if (journal.open) {
    journal.updateStats(toJournalStats(state, evaluate(state)));
    // Zeit-Erfolge („Ein ganzes Jahr“, „Geduld der Bäume“): Fortschritt nur als Text.
    journal.updateAchievementProgress(toAchievementTimeProgress(state));
  }
  refreshAnimalDetail();
  // Restzeiten der Boni laufen – gedrosselt wie die Zahlen der Seitenleiste.
  bonusPanel.update(activeBonusViews(state));
  dailyPanel.update(toDailyView(state, today()));
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

/**
 * Offene Tierdetails nachziehen. Alles darin hängt an der (gecachten) Auswertung – auch
 * die Jahreszeit steckt in ihrem Schlüssel –, dazu Stammgäste und entdeckte
 * Gemeinschaften aus dem Spielstand. Nur neu bauen, wenn sich davon etwas ändert. Zieht
 * die Art aus, schließt der Dialog und der Fokus geht an die Überschrift ihrer Nische.
 */
function refreshAnimalDetail(): void {
  const detailId = animalDetail.speciesId;
  if (!detailId) {
    detailEvaluation = null;
    return;
  }
  const ev = evaluate(state);
  const extra = `${state.meta.regulars.join(',')}|${state.meta.journal.communities.join(',')}|${state.meta.forestMemory}`;
  if (ev === detailEvaluation && extra === detailExtra) return;
  detailEvaluation = ev;
  detailExtra = extra;
  const view = toAnimalDetailView(state, detailId, ev);
  const niche = animalDetail.nicheId;
  animalDetail.update(view, view ? null : niche ? panel.nicheFocusTarget(niche) : null);
}
/** Tierdetails: zuletzt genutzte Auswertung und Spielstand-Teile außerhalb davon. */
let detailEvaluation: Readonly<Evaluation> | null = null;
let detailExtra = '';

function refreshViews(now: number): void {
  // Ökosystem geändert (Aktion, Wegpunkt …): Dämpfung im Wetter-Abzeichen gleich mitziehen.
  if (ecoDirty) seasonShownSecond = -1;
  refreshSeasonBadge();
  refreshPanel(now);
  stack.update(state.pendingEncounters.length, state.pendingEncounters[0]?.type ?? 'animal');
  refreshEncounter();
  refreshPicker(now);
}

function floatSeeds(amount: number): void {
  const target = document.querySelector<HTMLElement>('[data-ref="seeds"]');
  if (!target || amount <= 0) return;
  const rect = target.getBoundingClientRect();
  // Gerundet wie der Knopf („Ablehnen (+144 🌰)“), damit beide dieselbe Zahl zeigen.
  floats.spawn(`+${seedsLabel(amount)} 🌰`, rect.left + rect.width / 2, rect.top);
}

/**
 * Dezenter Hinweis nach einem Tick: Wegpunkte ohne Begegnung (nichts Passendes oder Stapel
 * voll; die Samen dafür schweben am Vorrat hoch) und eingezogene Stammgäste – in einem
 * Text, damit sich nichts überdeckt. null, wenn es nichts zu sagen gibt.
 */
function tickNoteText(report: TickReport): string | null {
  const parts: string[] = [];
  if (report.autoDeclined > 0) {
    parts.push(tickDeclineText(report));
  }
  if (report.regulars.length > 0) parts.push(regularsArrivedText(report.regulars));
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Verdeckt gerade ein Dialog die Szene? Dann landen alle Hinweise über notify im selben
 * Hinweisfeld – mehrere Hinweise desselben Moments müssen dort zu **einem** Text
 * zusammengefasst werden, sonst ersetzt der letzte die früheren.
 */
function overlayOpen(): boolean {
  return picker.open || dialog.open || journal.open || animalDetail.open || !!help?.open;
}

/**
 * Kurzer schwebender Hinweis über der Szene. Ist der Kartenwahl-Dialog oder die
 * Pflanzenauswahl offen, verdeckt sie die Szene – dann steht der Hinweis dort (notify),
 * sichtbar und für Screenreader erreichbar.
 */
function noteText(text: string): void {
  if (overlayOpen()) {
    notify(text);
    return;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) floats.spawn(text, rect.left + rect.width / 2, rect.top + rect.height * 0.3, 'note');
  // Die schwebende Zahl ist für Screenreader verborgen – derselbe Text in der Statuszeile.
  liveStatus.textContent = '';
  requestAnimationFrame(() => (liveStatus.textContent = text));
}

function showBanner(view: StageBannerView): void {
  const strong = document.createElement('strong');
  strong.textContent = view.title;
  const span = document.createElement('span');
  span.textContent = view.text;
  banner.replaceChildren(strong, span);
  if (view.extra) {
    const extra = document.createElement('span');
    extra.className = 'stage-banner-extra';
    extra.textContent = view.extra;
    banner.append(extra);
  }
  // Mit Erfolgszeile etwas länger stehen lassen (mehr zu lesen).
  banner.classList.toggle('long', Boolean(view.extra));
  banner.classList.remove('visible');
  void banner.offsetWidth; // Animation neu starten
  banner.classList.add('visible');
}

function showToast(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), toastDurationFor(text, preferences.toastMs()));
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
  // Der bisherige Wald kommt vorher in die Sicherungen des Kontos (falls aktiv).
  account?.backupCurrent();
  if (!storageFrozen) clearStorage();
  replaceState(newGame());
  account?.markAction();
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
  seasonShownSecond = -1;
  closeEncounters();
  closePlantPicker();
  journal.hide();
  animalDetail.hide();
  encounterSerial++;
  encounterDirty = true;
  ecoDirty = true;
  pickerDirty = true;
  // Tagesziele des neuen Stands (Tageswechsel; Import zählt nicht als aktives Spiel).
  runDaily({ offline: true });
  persist();
  refreshViews(performance.now());
}

/**
 * Übernimmt den Stand eines anderen Geräts (Konto-Abgleich): wie replaceState, rechnet aber
 * die Zeit seit dem dortigen Speichern nach. Offene Dialoge bleiben, wo es geht – die
 * Begegnungs-Karten nur, wenn oben noch dieselbe Begegnung liegt.
 */
function adoptState(next: GameState): void {
  const head = JSON.stringify(state.pendingEncounters[0] ?? null);
  state = next;
  scene.cycleTransition = undefined;
  disarmReset();
  cyclePanel.disarm();
  shownStage = state.stage;
  seasonShownSecond = -1;
  if (JSON.stringify(state.pendingEncounters[0] ?? null) !== head) {
    closeEncounters();
    encounterSerial++;
  }
  encounterDirty = true;
  ecoDirty = true;
  pickerDirty = true;
  catchUp();
  persist();
  refreshViews(performance.now());
}

// --- Konto (optional) ----------------------------------------------------------------

/** Lädt Konto-Oberfläche und Abgleich nach (eigener Chunk). */
function setupAccount(): void {
  const url = syncUrl;
  if (!url) return;
  import('./sync/account')
    .then(({ startAccount }) => {
      account = startAccount({
        url,
        mount: (section) => help?.addSettingsSection(section),
        game: {
          snapshot: () => exportCode(state),
          localProgress: () => progressOfState(state),
          progressOf: (code) => {
            const result = importCode(code, Date.now());
            return result.ok ? progressOfState(result.result.state) : null;
          },
          // Nur senden bzw. übernehmen, was dieses Spiel selbst importieren kann.
          check: (code) => codeCheck(importCode(code, Date.now())),
          adopt: (code, ageMs) => {
            const now = Date.now();
            const result = importCode(code, now, { keepClock: true });
            if (!result.ok) return false;
            const next = result.result.state;
            next.lastTick = adoptedLastTick(next.lastTick, now, ageMs);
            adoptState(next);
            return true;
          },
          notify: (text) => notify(text),
          freeze: () => {
            storageFrozen = true;
          },
          save: () => persist(),
          // Sicherung von vor dem Abgleich laden – wie „Importieren“.
          restore: (code) => {
            if (storageFrozen) return 'Dieser Tab ist angehalten. Bitte lade die Seite neu.';
            const result = importCode(code, Date.now());
            if (!result.ok) return IMPORT_ERROR_TEXTS[result.error];
            replaceState(result.result.state);
            return null;
          },
        },
      });
    })
    .catch(() => {
      // Nachladen fehlgeschlagen (offline): Das Spiel läuft lokal weiter.
    });
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
      account?.backupCurrent();
      replaceState(result.result.state);
      account?.markAction();
      const imported = result.result;
      const text = imported.migratedFromV1
        ? v1NoticeText(imported.keepsake)
        : joinNotes(
            imported.memoryReweighted ? MEMORY_REWEIGHTED_TEXT : '',
            achievementsBackfilledText(imported.achievementsBackfilled),
          );
      if (text) showToast(text);
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
  const growthBefore = state.totalGrowth;
  const seedsBefore = state.seeds;
  const report = tick(state, dt);
  state.lastTick = Date.now();
  // Tagesziele: tatsächlich gutgeschriebenes Wachstum und erzeugte Samen (ohne automatisches Ablehnen).
  dailyGrowth += Math.max(0, state.totalGrowth - growthBefore);
  dailyProduced += Math.max(0, state.seeds - seedsBefore - report.declinedSeeds);
  if (report.waypoints > 0 || report.encounters > 0 || report.interludesReached > 0 || report.expired.length > 0) {
    // Neue Begegnung, Zwischenhalt (auch ohne Ergebnis – der Zufall ist verbraucht) oder
    // abgelaufener Bonus: gleich speichern, damit Neuladen nichts neu würfelt, und
    // Ansichten neu bauen.
    persist();
    encounterDirty = true;
    ecoDirty = true;
  }
  // Neue Begegnung wartet: ein weiches „Pling“.
  if (report.encounters > 0) sound.cue('encounter');
  const tickNote = tickNoteText(report);
  // Automatisch abgelehnte Begegnungen: ihre Samen schweben am Vorrat hoch (wie von Hand).
  if (report.declinedSeeds > 0) floatSeeds(report.declinedSeeds);
  let seasonText: string | null = null;
  if (report.seasons.length > 0) {
    // Neue Jahreszeit: Raten ändern sich – Ansichten neu bauen, kurz Bescheid geben.
    encounterDirty = true;
    ecoDirty = true;
    pickerDirty = true;
    // Jahreszeit und Wetter wechseln an derselben Grenze: ein Hinweis für beides.
    seasonText = seasonWeatherChangeText(report.seasons, report.weather);
  }
  // Erfolge: gedrosselt, bei Wegpunkten und Jahreszeiten sofort (Bedingungen wachsen nur –
  // seltener prüfen verschiebt höchstens den Hinweis, nie das Ergebnis).
  let achievementText: string | null = null;
  if (report.waypoints > 0 || report.seasons.length > 0 || now - lastAchievementCheck >= ACHIEVEMENT_CHECK_MS) {
    lastAchievementCheck = now;
    achievementText = achievementUnlockedText(checkAchievements(state));
    if (achievementText) {
      persist();
      ecoDirty = true;
      sound.cue('achievement');
    }
  }
  // Tagesziele: aktiv gespielte Zeit sammeln, gedrosselt auswerten (Tageswechsel um Mitternacht).
  dailySeconds += dt;
  // Erste Antwort des Servers (Abstand der Uhren bekannt bzw. geändert): Tag sofort neu prüfen.
  const offset = account?.serverOffsetMs() ?? null;
  if (offset !== dailyOffset) {
    dailyOffset = offset;
    lastDailyCheck = -Infinity;
  }
  let dailyText: string | null = null;
  if (now - lastDailyCheck >= DAILY_CHECK_MS) {
    lastDailyCheck = now;
    dailyText = runDaily({ activeSeconds: dailySeconds, produced: { growth: dailyGrowth, seeds: dailyProduced } }) || null;
    dailySeconds = 0;
    dailyGrowth = 0;
    dailyProduced = 0;
  }
  const stageChanged = state.stage !== shownStage;
  // Neue Stufe ohne offenen Dialog: Der Erfolg steht im Stufen-Banner, nicht zusätzlich als Toast.
  const bannerAchievement = stageChanged && !overlayOpen() ? achievementText : null;
  if (overlayOpen()) {
    // Ein Hinweisfeld im Dialog: alles in einem Text, sonst verdrängt der letzte die übrigen.
    const text = joinNotes(tickNote, seasonText, achievementText, dailyText);
    if (text) notify(text);
  } else {
    if (tickNote) noteText(tickNote);
    const tickText = joinNotes(seasonText, bannerAchievement ? null : achievementText, dailyText);
    if (tickText) notify(tickText);
  }

  if (stageChanged) {
    shownStage = state.stage;
    encounterDirty = true;
    ecoDirty = true;
    pickerDirty = true;
    showBanner(stageBannerView(state.stage, bannerAchievement));
    sound.cue('stage');
  }

  refreshViews(now);
  // Größe aus dem ResizeObserver, entprellt (kein erzwungenes Layout pro Frame).
  const size = canvasSizer.update(now);
  sceneSize = size;
  // Kamera gleitet in Echtzeit (auch wenn das Spiel kurz hängt, höchstens MAX_FRAME_SECONDS).
  camera.step(dt);
  cameraInput.update(now);
  cameraControls.update();
  scene.growth = growth(state);
  scene.time = now / 1000;
  // Jahreszeit stufenlos aus der Spielzeit (tick läuft jeden Frame), Art des Hauptbaums.
  scene.season = sceneSeason(state.cycle.elapsed);
  // Tageszeit aus derselben Spielzeit (DESIGN_V2.md 19); Einstellung „Immer Tag“ → Mittag.
  scene.dayPhase = preferences.settings.daytime === 'day' ? NOON_PHASE : dayPhaseAt(state.cycle.elapsed);
  scene.mainTree = state.cycle.mainTree;
  drawScene(ctx, size.width, size.height, scene);
  // Klang folgt der Szene (Jahreszeit, Harmoniestufe); gedrosselt, still ohne Web Audio.
  sound.update({ season: scene.season ?? 0, harmonyTier: scene.harmonyTier ?? 0 }, scene.time);

  if (now - lastSave > AUTOSAVE_MS) {
    persist();
    lastSave = now;
  }
  requestAnimationFrame(frame);
}

/** Abzeichen der Jahreszeit: nur neu, wenn eine neue ganze Sekunde Spielzeit beginnt. */
function refreshSeasonBadge(): void {
  const second = Math.floor(state.cycle.elapsed);
  if (second === seasonShownSecond) return;
  seasonShownSecond = second;
  seasonBadge.update(toSeasonBadgeView(state.cycle.elapsed));
  weatherBadge.update(toWeatherBadgeView(state, preferences.settings.daytime === 'day'));
  // Sonnenunter- und -aufgang: Nachtwirkungen ändern die Raten – Seitenleiste neu bauen.
  const night = isNight(state.cycle.elapsed);
  if (night !== shownNight) {
    shownNight = night;
    ecoDirty = true;
  }
}

/**
 * Rechnet die Zeit seit dem letzten Tick nach – beim Start, wenn ein Tab aus dem
 * Hintergrund zurückkehrt (dort pausiert requestAnimationFrame) und nach Ruhezustand.
 */
function catchUp(extraNotice = '', achievementsBackfilled = 0): void {
  const away = (Date.now() - state.lastTick) / 1000;
  const stageBefore = state.stage;
  const report = away > MAX_FRAME_SECONDS ? simulateOffline(state, away) : null;
  // Erfolge aus der Offline-Zeit (dieselben wie online, nur auf einmal): ein Hinweis
  // zusammen mit der Begrüßung bzw. dem Zusatzhinweis – nach der Migration v8 → v9 in
  // einem Satz mit den nachgetragenen.
  const unlocked = checkAchievements(state);
  if (unlocked.length > 0) {
    persist();
    ecoDirty = true;
  }
  extraNotice = joinNotes(extraNotice, achievementsBackfilledText(achievementsBackfilled, unlocked));
  // Tagesziele: Tageswechsel und nur Ziele, die offline zählen dürfen (Zustände des Waldes).
  extraNotice = joinNotes(extraNotice, runDaily({ offline: true }));
  dailySeconds = 0;
  dailyGrowth = 0;
  dailyProduced = 0;
  if (report) {
    const notice = catchUpNotice(away, report, state.pendingEncounters.length, { from: stageBefore, to: state.stage });
    if (notice?.kind === 'welcome') {
      // Ein Toast für beides, damit der Begrüßungstext den Zusatzhinweis nicht verdrängt.
      notify([withRegulars(notice.text, report.regulars), extraNotice].filter(Boolean).join(' '));
      extraNotice = '';
      // Die Begrüßung nennt die neue Stufe schon: kein zweites Stufen-Banner im nächsten Frame.
      if (notice.namesStage) {
        shownStage = state.stage;
        encounterDirty = true;
        ecoDirty = true;
        pickerDirty = true;
      }
    } else {
      // Ein gemeinsamer Hinweis, damit sich zwei schwebende Texte nicht überdecken.
      const text = [notice?.text ?? '', regularsArrivedText(report.regulars)].filter(Boolean).join(' ');
      // Im offenen Dialog teilen sich beide Hinweise ein Feld: zusammenfassen.
      if (text && extraNotice && overlayOpen()) extraNotice = joinNotes(text, extraNotice);
      else if (text) noteText(text);
    }
    if (report.waypoints > 0 || report.encounters > 0 || report.interludesReached > 0 || report.expired.length > 0) {
      persist();
      encounterDirty = true;
      ecoDirty = true;
    }
    // Offline vergangene Jahreszeiten: still nachführen (kein Hinweis je Wechsel).
    if (report.seasons.length > 0) {
      encounterDirty = true;
      ecoDirty = true;
      pickerDirty = true;
    }
  }
  if (extraNotice) notify(extraNotice);
  state.lastTick = Date.now();
  lastFrame = performance.now();
}

// --- Start ---------------------------------------------------------------------------

function start(): void {
  if (loaded?.migratedFromV1) {
    // Alter v1-Stand: Neustart, sofort als v2 speichern, damit die Meldung nur einmal kommt.
    persist();
    showToast(v1NoticeText(loaded.keepsake));
  }
  const backfilled = loaded?.achievementsBackfilled ?? 0;
  if (loaded?.memoryReweighted || backfilled > 0) {
    // v2–v6-Stand mit Waldgedächtnis bzw. v8-Stand mit nachgetragenen Erfolgen: sofort im
    // aktuellen Format speichern, damit der Hinweis nur einmal kommt.
    persist();
  }
  catchUp(loaded?.memoryReweighted ? MEMORY_REWEIGHTED_TEXT : '', backfilled);

  resetButton.addEventListener('click', onReset);
  setupSaveTransfer();
  help = createHelp(document.querySelector<HTMLElement>('#help')!, preferences, { newGame: !loaded });
  setupAccount();
  preferences.onChange(() => {
    scene.reducedMotion = preferences.reducedMotion;
    camera.reducedMotion = preferences.reducedMotion;
    sound.setLevel(preferences.settings.sound);
    // Zahlenformat kann sich geändert haben: Ansichten vollständig neu aufbauen.
    ecoView = null;
    ecoDirty = true;
    // Abzeichen (Zahlen, Hinweis zu „Immer Tag“) gleich neu.
    seasonShownSecond = -1;
    encounterDirty = true;
    pickerDirty = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persist();
      account?.flush();
    } else catchUp();
  });
  window.addEventListener('beforeunload', () => {
    persist();
    account?.flush();
  });
  // Installierbare App: Offline-Start und Hinweis auf neue Versionen (nur im Build).
  setupServiceWorker({
    beforeReload: () => {
      persist();
      return account?.flush();
    },
  });

  refreshViews(performance.now());
  requestAnimationFrame(frame);
}

start();
