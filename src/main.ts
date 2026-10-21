import { MAX_PENDING_ENCOUNTERS } from './content/encounters';
import { STAGES } from './content/stages';
import { evaluate, growth, nextPlantCost, rerollCost, type Evaluation } from './core/formulas';
import { clearStorage, loadFromStorage, saveToStorage } from './core/save';
import { createInitialState, type GameState } from './core/state';
import type { PendingEncounterType } from './core/state';
import {
  chooseCard,
  declineEncounter,
  plantSeed,
  rerollEncounter,
  simulateOffline,
  tick,
  type ActionError,
  type ActionResult,
} from './core/tick';
import { drawScene, type SceneInput } from './render/tree';
import { PLANTS_BY_ID } from './content/plants';
import {
  autoDeclineText,
  catchUpNotice,
  refreshEcosystemView,
  toEcosystemView,
  toEncounterView,
  toPlantPickerView,
  toSceneAnimals,
  toScenePlants,
} from './ui/adapters';
import { createEcosystemPanel } from './ui/ecosystem-panel';
import { createEncounterDialog } from './ui/encounter-dialog';
import { createEncounterStack } from './ui/encounter-stack';
import { createFloatLayer } from './ui/feedback';
import { createPlantPicker } from './ui/plant-picker';
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
const TOAST_MS = 6000;

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
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const heading = document.querySelector<HTMLElement>('.panel h1')!;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

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

/** Der Spieler hat den Stapel geöffnet; bleibt offen, bis „Später“ oder keine Begegnung mehr wartet. */
let dialogWanted = false;
/** Begegnung oder Ökosystem haben sich geändert → Dialog-Inhalt neu bauen. */
let encounterDirty = true;
let shownCanReroll: boolean | null = null;
let shownQueued = -1;
/**
 * Zählt erledigte Begegnungen an der Spitze der Warteschlange. Damit erkennt der Dialog
 * auch zwei gleich aussehende Begegnungen nacheinander als verschieden.
 */
let encounterSerial = 0;

/** Ökosystem (Auswertung) hat sich geändert → Seitenleiste und Szene-Tiere neu bauen. */
let ecoDirty = true;
let ecoView: EcosystemView | null = null;
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
  reducedMotion: reducedMotionQuery.matches,
};

// --- Oberfläche ----------------------------------------------------------------------

const panel = createEcosystemPanel(document.querySelector<HTMLElement>('#ecosystem')!, {
  onOpenPlantPicker: openPlantPicker,
});
const floats = createFloatLayer(document.body);
const stack = createEncounterStack(document.querySelector<HTMLElement>('#scene-dock')!, openEncounters);
const dialog = createEncounterDialog(document.body, {
  onChoose: (cardIndex, replaceId) => {
    const type = state.pendingEncounters[0]?.type;
    act(chooseCard(state, 0, cardIndex, replaceId), true, type);
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

// --- Aktionen ------------------------------------------------------------------------

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
  else showToast(text);
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
  const canReroll = state.seeds >= rerollCost(state, 0);
  if (!encounterDirty && dialog.open && canReroll === shownCanReroll && queued === shownQueued) return;
  const view = toEncounterView(state, 0, evaluate(state));
  if (!view) return;
  view.key = String(encounterSerial);
  encounterDirty = false;
  shownCanReroll = canReroll;
  shownQueued = queued;
  dialog.show(view, queued);
}

/** Seitenleiste: Struktur nur bei Änderungen am Ökosystem, Zahlen gedrosselt. */
function refreshPanel(now: number): void {
  if (ecoDirty || !ecoView) {
    ecoDirty = false;
    const ev = evaluate(state);
    if (!ecoView || ev !== ecoEvaluation) {
      ecoEvaluation = ev;
      ecoView = toEcosystemView(state, ev);
      // Tiere und Pflanzen für die Szene nur bei Änderungen am Ökosystem neu bauen.
      scene.animals = toSceneAnimals(state, ev);
      scene.plants = toScenePlants(state, ev);
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
}

function refreshViews(now: number): void {
  refreshPanel(now);
  stack.update(state.pendingEncounters.length, state.pendingEncounters[0]?.type === 'plant' ? 'plant' : 'animal');
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
 * Ein Wegpunkt ging ohne Begegnung vorbei (nichts Passendes oder Stapel voll): dezenter
 * Hinweis über der Szene, die Samen dafür schweben am Vorrat hoch.
 */
function noteAutoDeclined(count: number): void {
  noteText(autoDeclineText(count, state.pendingEncounters.length >= MAX_PENDING_ENCOUNTERS));
}

/** Kurzer schwebender Hinweis über der Szene. */
function noteText(text: string): void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) floats.spawn(text, rect.left + rect.width / 2, rect.top + rect.height * 0.3, 'note');
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
  toastTimer = setTimeout(() => (toast.hidden = true), TOAST_MS);
}

// --- Spielstand löschen (zweiter Klick bestätigt, ohne confirm()) --------------------

function disarmReset(): void {
  clearTimeout(resetTimer);
  resetTimer = undefined;
  resetButton.textContent = 'Spielstand löschen';
  resetButton.classList.remove('armed');
}

function onReset(): void {
  if (resetTimer === undefined) {
    resetButton.textContent = 'Wirklich alles löschen? Zum Bestätigen erneut klicken';
    resetButton.classList.add('armed');
    resetTimer = setTimeout(disarmReset, 4000);
    return;
  }
  disarmReset();
  clearStorage();
  state = newGame();
  shownStage = state.stage;
  closeEncounters();
  closePlantPicker();
  encounterSerial++;
  encounterDirty = true;
  ecoDirty = true;
  saveToStorage(state);
  refreshViews(performance.now());
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
  if (report.waypoints > 0) {
    // Neue Begegnung: gleich speichern, damit Neuladen dieselben Karten zeigt.
    saveToStorage(state);
    encounterDirty = true;
    ecoDirty = true;
  }
  if (report.autoDeclined > 0) noteAutoDeclined(report.autoDeclined);

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
    const stackFull = state.pendingEncounters.length >= MAX_PENDING_ENCOUNTERS;
    const notice = catchUpNotice(away, report, state.pendingEncounters.length, stackFull);
    if (notice?.kind === 'welcome') notify(notice.text);
    else if (notice) noteText(notice.text);
    if (report.waypoints > 0) {
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
    showToast(
      loaded.keepsake
        ? 'Dein Wald beginnt neu – mit Erinnerungen. Andenken „Die alte Eiche“: +5 Waldgedächtnis.'
        : 'Dein Wald beginnt neu – das Spiel hat sich verändert.',
    );
  }
  catchUp();

  resetButton.addEventListener('click', onReset);
  reducedMotionQuery.addEventListener('change', () => (scene.reducedMotion = reducedMotionQuery.matches));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveToStorage(state);
    else catchUp();
  });
  window.addEventListener('beforeunload', () => saveToStorage(state));

  refreshViews(performance.now());
  requestAnimationFrame(frame);
}

start();
