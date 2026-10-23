import { NOON_PHASE } from './content/daytime';
import { checkAchievements } from './core/achievements';
import { dayKeyOf, updateDaily, type DailyUpdateOptions } from './core/daily';
import { dayPhaseAt, growth, nextPlantCost, type Evaluation } from './core/formulas';
import { SAVE_KEY, clearStorage, codeFromJson, exportCode, importCode, isNewerSave, loadFromStorage, saveToStorage, storedSaveIsNewer } from './core/save';
import { sceneSeason } from './core/season';
import { sceneWeather } from './core/weather';
import { createInitialState, type GameState } from './core/state';
import type { PendingEncounterType } from './core/state';
import {
  chooseCard,
  chooseEventOption,
  declineEncounter,
  farewellVisitor,
  hostVisitor,
  plantSeed,
  rerollEncounter,
  research,
  newCycleBlocker,
  simulateOffline,
  startNewCycle,
  buildCorridor,
  markLandscapeAnnounced,
  tick,
  toggleRegular,
  type ActionError,
  type ActionResult,
  type TickReport,
} from './core/tick';
import { drawScene, hitTestAnimal, siteParam, weatherParam, type AnimalHit, type HitScene, type SceneInput } from './render/tree';
import { IdleQueue } from './render/idle';
import { CanvasSizer } from './render/canvas-size';
import type { CanvasSize } from './render/resize';
import { Camera } from './render/camera';
import { attachCameraInput, createCameraControls, loadCameraView } from './ui/camera-input';
import {
  harmonyTierIndex,
  tickDeclineText,
  catchUpNotice,
  WELCOME_MIN_SECONDS,
  discoveryText,
  toSceneAnimals,
  scenePond,
  toSceneVisitors,
  toScenePlants,
  stageBannerView,
} from './ui/adapters';
import { achievementUnlockedText, achievementsBackfilledText } from './ui/achievement-view';
import { toReturnReportView } from './ui/return-report-view';
import { joinSentences } from './ui/format';
import { dailyCompletedText } from './ui/daily-view';
import { CYCLE_LOCKED_TEXT, newCycleBlockerText, newCycleToast, regularsArrivedText } from './ui/cycle-view';
import { createWildwechselMarks, wildwechselMarkOf } from './ui/wildwechsel-view';
import {
  chapterNewsCount,
  chapterNewsText,
  chapterNotes,
  chaptersSince,
  chronicleMark,
  chronicleUnlockText,
  type ChapterNote,
  type ChronicleMark,
} from './ui/chronicle-view';
import { initPreferences } from './ui/preferences';
import { createSound } from './ui/sound';
import { IMPORT_ERROR_TEXTS, NEWER_STORED_SAVE_TEXT, type SaveTransferCallbacks } from './ui/save-transfer';
import { setupServiceWorker } from './ui/pwa';
import { seasonWeatherChangeText } from './ui/weather-view';
import type { MainTreeId } from './content/trees';
import type { SiteId } from './content/landscape';
import { LANDSCAPE_UNLOCK_TEXT, corridorBuiltText, landscapeErrorText, siteChangeText } from './ui/landscape-view';
import { activeSite, landscapeAnnouncementDue } from './core/landscape';
import { createAlbum, type AlbumPart } from './ui/album';
import { adoptedLastTick, codeCheck, progressOfState, readSyncUrl } from './sync/config';
import type { AccountController } from './sync/account';

/*
 * Verdrahtung: Game Loop, Speichern, Offline-Fortschritt und Spieleraktionen. Die
 * Oberfläche (Album) steuert ui/album/index.ts – hier nur `album.refresh(now)`,
 * `invalidate(...)` und `album.notify(text)` (docs/ALBUM_UI.md, D.2).
 * Reihenfolge: erst alle Konstanten und Variablen, dann die Funktionen, ganz unten der
 * Start. So greift beim Modul-Laden nichts auf noch nicht deklarierte Variablen zu.
 */

// --- Konstanten und DOM ------------------------------------------------------------

const AUTOSAVE_MS = 10_000;
/** Größere Frame-Sprünge werden auf diese Dauer begrenzt; längere Pausen holt catchUp() nach. */
const MAX_FRAME_SECONDS = 1;
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
  'unknown-node': 'Diesen Forschungsknoten gibt es nicht.',
  owned: 'Das ist schon erforscht.',
  stage: 'Das lässt sich erst auf einer späteren Stufe erforschen.',
  excluded: 'Du hast an dieser Gabel den anderen Weg gewählt.',
  requires: 'Dafür fehlt noch ein anderer Forschungsknoten.',
  condition: 'Dafür fehlt noch etwas im Ökosystem.',
  'already-active': 'Dieser Gast rastet schon hier.',
};

/** Abweichende Texte, wenn die Aktion eine Pflanzenbegegnung („Etwas keimt“) betraf. */
const PLANT_ERROR_TEXTS: Partial<Record<ActionError, string>> = {
  'no-cards': 'Keine passenden Pflanzen.',
  'no-alternatives': 'Keine anderen Pflanzen verfügbar.',
  'invalid-replace': 'Diese Pflanze kann gerade nicht weichen.',
  closed: 'Der Pflanzring ist noch verschlossen.',
};

/** Abweichende Texte für die Forschung (bezahlt mit ⚖️ statt 🌰). */
const RESEARCH_ERROR_TEXTS: Partial<Record<ActionError, string>> = {
  'too-expensive': 'Nicht genug Harmonie im Vorrat.',
};

function errorText(error: ActionError, type: PendingEncounterType | 'research' | undefined): string {
  const special = type === 'plant' ? PLANT_ERROR_TEXTS[error] : type === 'research' ? RESEARCH_ERROR_TEXTS[error] : undefined;
  return special ?? ERROR_TEXTS[error];
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const ctx = canvas.getContext('2d')!;
const canvasSizer = new CanvasSizer(canvas);
/** Einstellungen (Bewegung, Zahlenformat, Hinweisdauer, Klang) – vor der ersten Anzeige angewendet. */
const preferences = initPreferences();
/** Klangkulisse (Standard aus; der AudioContext entsteht erst bei einer Nutzerinteraktion). */
const sound = createSound(preferences.settings.sound);

// --- Zustand -------------------------------------------------------------------------

/** Neues Spiel: Der Zufallsgenerator bekommt einmalig die Uhrzeit als Startwert. */
const newGame = (): GameState => createInitialState(Date.now(), Date.now());

/**
 * Im Speicher liegt ein Stand aus einer neueren Spielversion (z. B. ein veralteter Tab nach
 * einem Update): nicht laden, nie überschreiben, keinen Abgleich starten – sonst gingen
 * Nischen, Arten und Ereignisse verloren, die dieses Spiel nicht kennt (DESIGN_V2.md 23.6).
 */
const storedNewer = storedSaveIsNewer();
const loaded = storedNewer ? null : loadFromStorage(Date.now());
let state = loaded?.state ?? newGame();

let shownStage = state.stage;
let lastFrame = performance.now();
let lastSave = performance.now();
/**
 * Gesperrt, wenn ein anderer Tab mit einem anderen Konto spielt (Konto-Abgleich): Dann darf
 * dieser Tab den gemeinsamen Spielstand im localStorage nie mehr schreiben – auch nicht beim
 * Verlassen der Seite –, sonst landete sein Spiel nach dem Neuladen im anderen Konto.
 */
let storageFrozen = storedNewer;

/** Text für Aktionen, die im gesperrten Tab nicht gehen (Import, Löschen, Sicherung laden). */
const FROZEN_TEXT = 'Dieser Tab ist angehalten. Bitte lade die Seite neu.';
/** Der gespeicherte Stand stammt aus einer neueren Spielversion (beim Start oder später, z. B. aus einem anderen Tab). */
let newerFrozen = false;

/**
 * Ein neuerer Stand liegt im Speicher (DESIGN_V2.md 23.6): ab jetzt nie mehr schreiben und
 * dauerhaft darauf hinweisen. Der Export liefert ab dann den gespeicherten neueren Stand.
 */
function freezeForNewerSave(): void {
  storageFrozen = true;
  if (newerFrozen) return;
  newerFrozen = true;
  album.showNewerSaveBanner(`${NEWER_STORED_SAVE_TEXT} Auch ein Export enthält den neueren Stand.`);
}

/** Spielstand speichern (außer gesperrt). */
function persist(): void {
  if (storageFrozen) return;
  // Ein anderer Tab (neuere Version) hat inzwischen geschrieben: nie darüber speichern.
  if (storedSaveIsNewer()) {
    freezeForNewerSave();
    return;
  }
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

/**
 * Wildwechsel-Karten offener Begegnungen (DESIGN_V2.md 24.6) – nur in der Oberfläche, nicht im
 * Spielstand: nach dem Neuladen kein Hinweis statt eines womöglich falschen.
 */
const wildwechselMarks = createWildwechselMarks();

/**
 * Stand der Waldchroniken beim letzten Stempel (DESIGN_V2.md 26.4/26.7): Aktionen melden neue
 * Kapitel nicht eigens – `takeChapterNews` vergleicht vorher/nachher. Beim Ersetzen des
 * Spielstands (Import, anderes Gerät) neu gesetzt, damit fremde Kapitel nicht als neu gelten.
 */
let chapterMark: ChronicleMark = chronicleMark(state);

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
  // Neue Jahreszeit-Stufe, Tönung und Zoom-Details in Leerlaufzeit statt in einem langen Frame.
  idle: new IdleQueue(),
};

/** Demo/Tests: `?weather=<id>` zeigt dieses Wetter statt des Tageswetters (nur das Bild). */
const weatherOverride = weatherParam(location.search);
/** Demo/Tests: `?site=<id>` zeigt die Kulisse dieses Waldtyps (nur das Bild, DESIGN_V2.md 24.11). */
const siteOverride = siteParam(location.search);

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
  hitScene.dayPhase = scene.dayPhase;
  hitScene.weather = scene.weather;
  hitScene.weatherPrevious = scene.weatherPrevious;
  hitScene.weatherBlend = scene.weatherBlend;
  return hitTestAnimal(hitScene, camera.view, x, y);
}

/**
 * Tippen oder Klicken auf ein Tier in der Szene (nur im Vollbild) öffnet eine Haftnotiz zum
 * Tier mit „Im Album ansehen“ (`hit.index` = Platz in `state.niches`). Per Tastatur sind
 * dieselben Tiere über die Kacheln der Reiter erreichbar.
 */
function onAnimalTap(hit: AnimalHit): void {
  album.showSceneAnimal({ niche: hit.nicheId, index: hit.index });
}

// --- Oberfläche (Album) ---------------------------------------------------------------

/**
 * Das Album baut die ganze Oberfläche einmal auf und hängt das Canvas ins Polaroid. Es ruft
 * nur die Aktionen hier auf (act → core/tick.ts); Spielregeln stehen nicht in der UI.
 */
const album = createAlbum({
  canvas,
  preferences,
  state: () => state,
  newGame: !loaded && !storedNewer,
  today,
  encounterMark: currentWildwechselMark,
  takeLandscapeAnnouncement,
  ecosystemChanged: refreshSceneEcosystem,
  saveTransfer: saveTransferCallbacks(),
  actions: {
    encounter: {
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
        if (act(result, true, type) && result.ok && result.seeds) album.floatSeeds(result.seeds);
      },
      onDecline: () => {
        const before = state.seeds;
        if (act(declineEncounter(state, 0), true)) album.floatSeeds(state.seeds - before);
      },
      onReroll: () => {
        const type = state.pendingEncounters[0]?.type;
        act(rerollEncounter(state, 0), false, type);
      },
    },
    plant,
    // Reiter „Pflege“ (Notliste der Forschung bis Phase 10, 4a): erforscht einen Knoten.
    buyCare: (id) => act(research(state, id), false, 'research'),
    newCycle,
    buildCorridor: (id) => {
      // Korridor (DESIGN_V2.md 24.6): jederzeit, ändert das wirksame Gedächtnis.
      const result = buildCorridor(state, id);
      if (!result.ok) {
        album.notify(landscapeErrorText(result.error), { error: true });
        return;
      }
      act(result, false, undefined, corridorBuiltText(id));
    },
    toggleRegular: (speciesId) => act(toggleRegular(state, speciesId), false),
    resetGame,
  },
});
// Kamera und Tier-Tipp nur im Vollbild; im Polaroid öffnet ein Tipp das Vollbild (Album).
const cameraInput = attachCameraInput(canvas, { camera, hitTest: hitTestScene, onAnimalTap, active: () => album.fullscreen });
const cameraControls = createCameraControls(album.sceneFrame, camera);

/**
 * Wildwechsel-Weg der vordersten Begegnung (24.6): aus der Oberfläche (wie die Karte kam)
 * oder aus dem Spielstand.
 */
function currentWildwechselMark() {
  return wildwechselMarks.lookup(state.pendingEncounters[0]) ?? wildwechselMarkOf(state, state.pendingEncounters[0]);
}

/** Ansichten neu aufbauen (Album; bei „eco“ auch Tiere und Pflanzen der Szene). */
function invalidate(...parts: AlbumPart[]): void {
  album.invalidate(parts);
}

/** Tiere und Pflanzen für die Szene nur bei Änderungen am Ökosystem neu bauen (vom Album gemeldet). */
function refreshSceneEcosystem(ev: Readonly<Evaluation>, rebuilt: boolean): void {
  scene.forestMemory = state.meta.forestMemory;
  if (!rebuilt) return;
  scene.animals = toSceneAnimals(state, ev);
  scene.pond = scenePond(ev);
  // Lebensräume (DESIGN_V2.md 23.8): offen, sobald die Nische Plätze hat.
  scene.meadow = (ev.slots.meadow ?? 0) > 0;
  scene.deadwood = (ev.slots.deadwood ?? 0) > 0;
  scene.wall = (ev.slots.wall ?? 0) > 0;
  scene.plants = toScenePlants(state, ev);
  scene.visitors = toSceneVisitors(state);
  scene.harmonyTier = harmonyTierIndex(ev.harmony);
}

// --- Aktionen ------------------------------------------------------------------------

/**
 * Führt das Ergebnis einer Spieleraktion nach: Erfolge prüfen, sofort speichern
 * (Entscheidungen sollen ein Neuladen sicher überstehen), Ansichten aktualisieren, Fehler
 * kurz anzeigen. Neu entdeckte Lebensgemeinschaften und Erfolge in einem ruhigen Hinweis
 * (Stempel bzw. im offenen Dialog), damit sich nichts gegenseitig verdrängt.
 * `resolves`: Die Begegnung an der Spitze ist bei Erfolg erledigt.
 */
/** `lead`: eigener Hinweis der Aktion (z. B. Korridor gebaut), vor den übrigen im selben Text. */
function act(result: ActionResult, resolves: boolean, type?: PendingEncounterType | 'research', lead = ''): boolean {
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
    if (resolves) album.encounterResolved();
  }
  invalidate('encounter', 'eco', 'picker');
  album.refresh(performance.now());
  if (!result.ok) {
    album.notify(errorText(result.error, type), { error: true });
    return false;
  }
  // Neue Kapitel der Waldchronik (Karte gewählt, Ereignis entschieden …): eigener Stempel (F4).
  const chapters = takeChapterNews();
  if (unlocked.length > 0 || chapters.length > 0) sound.cue('achievement');
  const regulars = result.regulars && result.regulars.length > 0 ? regularsArrivedText(result.regulars) : '';
  const text = joinNotes(lead, discoveryText(result.discovered), regulars, achievementUnlockedText(unlocked), dailyText);
  if (text) album.notify(text);
  showChapterNotes(chapters);
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
  // Erfolge der Tagesziele (DESIGN_V2.md 26.5) gleich nach dem Zählen – im selben Hinweis.
  const unlocked = result.completed.length > 0 ? checkAchievements(state) : [];
  persist();
  invalidate('eco');
  if (result.completed.length === 0) return '';
  if (state.pendingEncounters.length !== queued) invalidate('encounter');
  invalidate('picker');
  sound.cue('achievement');
  if (float) album.floatSeeds(state.seeds - seedsBefore);
  return joinNotes(dailyCompletedText(result.completed, result.perfect, state.meta.daily.streak), achievementUnlockedText(unlocked));
}

/**
 * Meldung zur Freischaltung der Landschaft (DESIGN_V2.md 24.3): einmal, gemerkt im
 * Spielstand. Liefert den Text (und merkt ihn als gezeigt) oder ''.
 */
function takeLandscapeAnnouncement(): string {
  if (!landscapeAnnouncementDue(state)) return '';
  markLandscapeAnnounced(state);
  persist();
  // Die Chronik des Heimatwalds lief still mit (26.4): jetzt einmal zeigen, was schon drinsteht –
  // dafür keine Stempel für dieselben Kapitel.
  chapterMark = chronicleMark(state);
  return joinNotes(LANDSCAPE_UNLOCK_TEXT, chronicleUnlockText(state));
}

/**
 * Neue Kapitel der Waldchroniken seit dem letzten Aufruf als Meldungen („📜 Neues Kapitel im …“);
 * leer ohne neue Kapitel. Vor der Landschaft still (26.4) – der Stand rückt trotzdem nach.
 */
function takeChapterNews(): ChapterNote[] {
  const news = chaptersSince(state, chapterMark);
  chapterMark = chronicleMark(state);
  if (news.length === 0) return [];
  invalidate('eco');
  return chapterNotes(state, news);
}

/**
 * Kapitel als eigene Stempel nach dem übrigen Hinweis (Playtest Phase 9, F4) – so stehen sie
 * zuletzt und ganz. Eine vollständige Chronik ist ein hervorgehobener Zettel mit dem Andenken,
 * der bis zum Schließen bleibt.
 */
function showChapterNotes(notes: readonly ChapterNote[]): void {
  for (const note of notes) album.notify(note.text, note.keepsake ? { keepsake: note.keepsake.icon, keep: true } : undefined);
}

/** Mehrere Hinweise als ein Text (leere weglassen); '' wenn nichts bleibt. */
/** Meldungen verbinden – jeder Teil mit Satzzeichen (ui/format.ts, `joinSentences`). */
function joinNotes(...parts: (string | null | undefined)[]): string {
  return joinSentences(...parts);
}

/** „Pflanze setzen“: Samen ausgeben, Auswahl schließen, kurz zeigen, was passiert ist. */
function plant(plantId: string): void {
  const cost = nextPlantCost(state);
  const result = plantSeed(state, plantId);
  // Bei Erfolg schließt die Auswahl – vorher, damit act() sie nicht neu aufbaut.
  if (result.ok) album.closePlantPicker();
  if (!act(result, false)) return;
  album.plantFeedback(cost, plantId);
}

/**
 * „Neuen Zyklus beginnen“ (schon bestätigt): Waldgedächtnis gutschreiben, Baum beginnt neu
 * – aus der Frucht der gewählten Art.
 */
function newCycle(mainTree: MainTreeId, site?: SiteId): void {
  // Alter Baum für die Übergangs-Sequenz der Szene (vor dem Reset festhalten).
  const fromGrowth = growth(state);
  const fromPlants = scene.plants;
  const fromTree = state.cycle.mainTree;
  const fromSite = activeSite(state.meta.landscape);
  const result = startNewCycle(state, Date.now(), mainTree, site);
  if (!result.ok) {
    const blocker = newCycleBlocker(state);
    const error = result.error;
    album.notify(blocker ? newCycleBlockerText(blocker) : error in ERROR_TEXTS ? ERROR_TEXTS[error as ActionError] : landscapeErrorText(error as Parameters<typeof landscapeErrorText>[0]), { error: true });
    return;
  }
  shownStage = state.stage;
  // Gleicher Takt wie scene.time (rAF-Zeitstempel / 1000); das Feld darf stehen bleiben.
  scene.cycleTransition = { startedAt: performance.now() / 1000, fromGrowth, fromPlants, fromTree };
  // Neuer Wald gegründet: ein Eichelhäher trägt die Eichel durchs Bild (Hähersaat, 24.11).
  if (result.founded) scene.jayFlight = { startedAt: performance.now() / 1000 };
  album.closeEncounters();
  album.closePlantPicker();
  album.encounterResolved();
  // Freischaltung zuerst (sie fasst die Kapitel des Heimatwalds zusammen), dann neue Kapitel
  // des alten Waldes („Uralt geworden“) – beide im Hinweis des Zyklus statt als eigener Stempel.
  const landscapeText = takeLandscapeAnnouncement();
  const chapters = takeChapterNews();
  act(result, false);
  // Der Knopf ist jetzt ausgeblendet – Fokus auf die Überschrift des Bereichs statt auf body.
  album.focusCycle();
  // Erfolge prüft startNewCycle selbst (vor dem Zurücksetzen) – im selben Hinweis melden.
  album.notify(
    joinNotes(
      newCycleToast(result.preview.memoryGain, state.cycle.number, result.regulars, state.cycle.mainTree),
      result.site !== fromSite ? siteChangeText(result.site, result.founded) : '',
      achievementUnlockedText(result.achievements),
      landscapeText,
    ),
  );
  showChapterNotes(chapters);
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
  return parts.length > 0 ? joinSentences(...parts) : null;
}

// --- Spielstand löschen (die Bestätigung per zweitem Klick macht die Oberfläche) --------

function resetGame(): void {
  // Gesperrter Tab: nichts löschen, nichts ersetzen (wie beim Laden einer Sicherung).
  if (storageFrozen) {
    album.notify(FROZEN_TEXT, { keep: true });
    return;
  }
  // Der bisherige Wald kommt vorher in die Sicherungen des Kontos (falls aktiv).
  account?.backupCurrent();
  clearStorage();
  replaceState(newGame());
  account?.markAction();
}

/** Ersetzt den ganzen Spielstand (Löschen, Import): Dialoge zu, alles neu aufbauen, speichern. */
function replaceState(next: GameState): void {
  state = next;
  chapterMark = chronicleMark(state);
  // Laufende Übergangs-Sequenz und offene Bestätigungen gehören zum alten Stand.
  scene.cycleTransition = undefined;
  scene.jayFlight = undefined;
  shownStage = state.stage;
  album.replaced();
  // Tagesziele des neuen Stands (Tageswechsel; Import zählt nicht als aktives Spiel).
  runDaily({ offline: true });
  persist();
  album.refresh(performance.now());
}

/**
 * Übernimmt den Stand eines anderen Geräts (Konto-Abgleich): wie replaceState, rechnet aber
 * die Zeit seit dem dortigen Speichern nach. Offene Dialoge bleiben, wo es geht – die
 * Begegnungs-Karten nur, wenn oben noch dieselbe Begegnung liegt.
 */
function adoptState(next: GameState): void {
  const head = JSON.stringify(state.pendingEncounters[0] ?? null);
  state = next;
  chapterMark = chronicleMark(state);
  scene.cycleTransition = undefined;
  scene.jayFlight = undefined;
  shownStage = state.stage;
  album.adopted(JSON.stringify(state.pendingEncounters[0] ?? null) !== head);
  catchUp();
  persist();
  album.refresh(performance.now());
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
        mount: (section) => album.mountAccount(section),
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
          notify: (text) => album.notify(text),
          freeze: () => {
            storageFrozen = true;
          },
          save: () => persist(),
          // Sicherung von vor dem Abgleich laden – wie „Importieren“.
          restore: (code) => {
            if (storageFrozen) return FROZEN_TEXT;
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

/** Bereich „Spielstand exportieren oder importieren“ (Umschlag → Spielstand). */
function saveTransferCallbacks(): SaveTransferCallbacks {
  return {
    getCode: () => {
      // Gesperrt wegen eines neueren Stands: diesen exportieren (für die neuere Spielversion).
      const raw = newerFrozen ? storedRaw() : null;
      return raw !== null && isNewerSave(raw) ? codeFromJson(raw) : exportCode(state);
    },
    validate: (code) => {
      if (storageFrozen) return { ok: false, message: FROZEN_TEXT };
      const result = importCode(code, Date.now());
      if (!result.ok) return { ok: false, message: IMPORT_ERROR_TEXTS[result.error] };
      return result.result.migratedFromV1 ? { ok: true, note: V1_IMPORT_NOTE } : { ok: true };
    },
    onImport: (code) => {
      if (storageFrozen) return FROZEN_TEXT;
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
      if (text) album.notify(text);
      return null;
    },
  };
}

/** Der gespeicherte Stand als Text (null, wenn keiner da oder der Speicher blockiert ist). */
function storedRaw(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
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
  // Wildwechsel-Karten gleich merken – die Indizes gelten nur direkt nach dem Tick.
  wildwechselMarks.record(state.pendingEncounters, report.wildwechsel);
  // Tagesziele: tatsächlich gutgeschriebenes Wachstum und erzeugte Samen (ohne automatisches Ablehnen).
  dailyGrowth += Math.max(0, state.totalGrowth - growthBefore);
  dailyProduced += Math.max(0, state.seeds - seedsBefore - report.declinedSeeds);
  if (report.waypoints > 0 || report.encounters > 0 || report.interludesReached > 0 || report.expired.length > 0) {
    // Neue Begegnung, Zwischenhalt (auch ohne Ergebnis – der Zufall ist verbraucht) oder
    // abgelaufener Bonus: gleich speichern, damit Neuladen nichts neu würfelt, und
    // Ansichten neu bauen.
    persist();
    invalidate('encounter', 'eco');
  }
  // Neue Begegnung wartet: ein weiches „Pling“.
  if (report.encounters > 0) sound.cue('encounter');
  // Neue Kapitel der Chronik (Erster Schnee, Kennart, Voller Einklang): sofort speichern, Stempel.
  let chapters: ChapterNote[] = [];
  if (report.chapters.length > 0) {
    persist();
    chapters = takeChapterNews();
    if (chapters.length > 0) sound.cue('achievement');
  }
  const tickNote = tickNoteText(report);
  // Automatisch abgelehnte Begegnungen: ihre Samen schweben am Vorrat hoch (wie von Hand).
  if (report.declinedSeeds > 0) album.floatSeeds(report.declinedSeeds);
  let seasonText: string | null = null;
  if (report.seasons.length > 0) {
    // Neue Jahreszeit: Raten ändern sich – Ansichten neu bauen, kurz Bescheid geben.
    invalidate('encounter', 'eco', 'picker');
    // Jahreszeit und Wetter wechseln an derselben Grenze: ein Hinweis für beides.
    seasonText = seasonWeatherChangeText(report.seasons, report.weather);
  }
  // Erfolge: gedrosselt, bei Wegpunkten und Jahreszeiten sofort (Bedingungen wachsen nur –
  // seltener prüfen verschiebt höchstens den Hinweis, nie das Ergebnis).
  let achievementText: string | null = null;
  if (report.waypoints > 0 || report.seasons.length > 0 || report.chapters.length > 0 || now - lastAchievementCheck >= ACHIEVEMENT_CHECK_MS) {
    lastAchievementCheck = now;
    achievementText = achievementUnlockedText(checkAchievements(state));
    // Urwald erreicht (Erfolg) mit genug Gedächtnis: die Landschaft öffnet sich.
    if (achievementText) achievementText = joinNotes(achievementText, takeLandscapeAnnouncement()) || null;
    if (achievementText) {
      persist();
      invalidate('eco');
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
  // Neue Stufe ohne offenen Dialog: Der Erfolg steht im Stufen-Banner, nicht zusätzlich als Stempel.
  const bannerAchievement = stageChanged && !album.overlayOpen() ? achievementText : null;
  if (album.overlayOpen()) {
    // Ein Hinweisfeld im Dialog: alles in einem Text, sonst verdrängt der letzte die übrigen.
    const text = joinNotes(tickNote, seasonText, achievementText, dailyText);
    if (text) album.notify(text);
  } else {
    if (tickNote) album.noteText(tickNote);
    const tickText = joinNotes(seasonText, bannerAchievement ? null : achievementText, dailyText);
    if (tickText) album.notify(tickText);
  }
  // Kapitel als eigener Stempel nach dem übrigen Hinweis (F4).
  showChapterNotes(chapters);

  if (stageChanged) {
    shownStage = state.stage;
    invalidate('encounter', 'eco', 'picker');
    album.showBanner(stageBannerView(state.stage, bannerAchievement));
    sound.cue('stage');
  }

  album.refresh(now);
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
  // Kulisse des aktiven Waldes der Landschaft (DESIGN_V2.md 24.11).
  scene.site = siteOverride ?? activeSite(state.meta.landscape);
  // Wetter des Tages im gezeigten Wald mit Überblendung am Tageswechsel (DESIGN_V2.md 21.8, 24.14).
  const weather = sceneWeather(state.cycle, scene.site as SiteId);
  scene.weather = weatherOverride ?? weather.weather;
  scene.weatherPrevious = weatherOverride ?? weather.previous;
  scene.weatherBlend = weatherOverride ? 1 : weather.blend;
  // Kamera-Ansicht nur im Vollbild; das Polaroid zeigt immer die ganze Szene.
  scene.camera = album.fullscreen ? camera.view : undefined;
  // Szene nicht zu sehen (Polaroid weggescrollt, mobil unter einer Unterseite): nicht
  // zeichnen. Spiel, Kamera und Klang laufen weiter.
  if (album.sceneVisible) drawScene(ctx, size.width, size.height, scene);
  // Klang folgt der Szene (Jahreszeit, Harmoniestufe); gedrosselt, still ohne Web Audio.
  sound.update({ season: scene.season ?? 0, harmonyTier: scene.harmonyTier ?? 0 }, scene.time);

  if (now - lastSave > AUTOSAVE_MS) {
    persist();
    lastSave = now;
  }
  requestAnimationFrame(frame);
}

/**
 * Rechnet die Zeit seit dem letzten Tick nach – beim Start, wenn ein Tab aus dem
 * Hintergrund zurückkehrt (dort pausiert requestAnimationFrame) und nach Ruhezustand.
 */
function catchUp(extraNotice = '', achievementsBackfilled = 0): void {
  const away = (Date.now() - state.lastTick) / 1000;
  const stageBefore = state.stage;
  const report = away > MAX_FRAME_SECONDS ? simulateOffline(state, away) : null;
  if (report) wildwechselMarks.record(state.pendingEncounters, report.wildwechsel);
  // Erfolge aus der Offline-Zeit (dieselben wie online, nur auf einmal): ein Hinweis
  // zusammen mit der Begrüßung bzw. dem Zusatzhinweis – nach der Migration v8 → v9 in
  // einem Satz mit den nachgetragenen.
  const unlocked = checkAchievements(state);
  if (unlocked.length > 0) {
    persist();
    invalidate('eco');
  }
  // Einzeln gesammelt, damit der Rückkehr-Bericht sie als eigene Punkte zeigt.
  // Landschaft freigeschaltet (beim Laden oder offline erreicht, 24.3): im selben Hinweis – sie
  // nennt die Kapitel des Heimatwalds selbst, darum vor den neuen Kapiteln.
  const landscapeText = takeLandscapeAnnouncement();
  // Offline geschriebene Kapitel (OfflineReport.chapters, 26.4): ein Punkt im Rückkehr-Bericht.
  // Öffnet sich die Landschaft gerade, nennt ihr Hinweis die Kapitel schon.
  const chapterText = report && report.chapters.length > 0 && !landscapeText ? chapterNewsText(state, report.chapters) : '';
  // Kurzfassung des Berichts nennt sie gezählt (F7).
  const chapterCount = chapterText && report ? chapterNewsCount(state, report.chapters) : 0;
  // Stand nachziehen – was der Bericht nennt (oder vor der Landschaft still blieb), ist gemeldet.
  chapterMark = chronicleMark(state);
  if (chapterText) {
    persist();
    invalidate('eco');
  }
  const notes = [
    extraNotice,
    achievementsBackfilledText(achievementsBackfilled, unlocked),
    landscapeText,
    chapterText,
    // Tagesziele: Tageswechsel und nur Ziele, die offline zählen dürfen (Zustände des Waldes).
    runDaily({ offline: true }),
  ];
  extraNotice = joinNotes(...notes);
  dailySeconds = 0;
  dailyGrowth = 0;
  dailyProduced = 0;
  if (report) {
    const notice = catchUpNotice(away, report, state.pendingEncounters.length, { from: stageBefore, to: state.stage });
    if (notice?.kind === 'welcome') {
      // Eine Meldung für beides, damit der Begrüßungstext den Zusatzhinweis nicht verdrängt –
      // Desktop wie mobil nur die Kurzfassung, alles Weitere im Rückkehr-Bericht (ui/album/return-report.ts).
      const stages = { from: stageBefore, to: state.stage };
      const site = activeSite(state.meta.landscape);
      const view = toReturnReportView({ away, report, waiting: state.pendingEncounters.length, stages, notes, site, chapters: chapterCount });
      album.showReturnReport(view);
      extraNotice = '';
      // Die Begrüßung nennt die neue Stufe schon: kein zweites Stufen-Banner im nächsten Frame.
      if (notice.namesStage) {
        shownStage = state.stage;
        invalidate('encounter', 'eco', 'picker');
      }
    } else {
      // Längere Rückkehr ohne Willkommen (nichts gewachsen): Der alte Bericht gehört zu einer
      // früheren Rückkehr. Kurze Tab-Wechsel (ab 1 s) lassen ihn stehen – sonst wäre er weg,
      // bevor er gelesen ist.
      if (away > WELCOME_MIN_SECONDS) album.hideReturnReport();
      // Ein gemeinsamer Hinweis, damit sich zwei schwebende Texte nicht überdecken.
      const text = joinSentences(notice?.text, regularsArrivedText(report.regulars));
      // Im offenen Dialog teilen sich beide Hinweise ein Feld: zusammenfassen.
      if (text && extraNotice && album.overlayOpen()) extraNotice = joinNotes(text, extraNotice);
      else if (text) album.noteText(text);
    }
    if (report.waypoints > 0 || report.encounters > 0 || report.interludesReached > 0 || report.expired.length > 0) {
      persist();
      invalidate('encounter', 'eco');
    }
    // Offline vergangene Jahreszeiten: still nachführen (kein Hinweis je Wechsel).
    if (report.seasons.length > 0) invalidate('encounter', 'eco', 'picker');
  }
  if (extraNotice) album.notify(extraNotice);
  state.lastTick = Date.now();
  lastFrame = performance.now();
}

// --- Start ---------------------------------------------------------------------------

function start(): void {
  if (loaded?.migratedFromV1) {
    // Alter v1-Stand: Neustart, sofort als v2 speichern, damit die Meldung nur einmal kommt.
    persist();
    album.notify(v1NoticeText(loaded.keepsake), { keep: true });
  }
  const backfilled = loaded?.achievementsBackfilled ?? 0;
  if (loaded?.memoryReweighted || backfilled > 0) {
    // v2–v6-Stand mit Waldgedächtnis bzw. v8-Stand mit nachgetragenen Erfolgen: sofort im
    // aktuellen Format speichern, damit der Hinweis nur einmal kommt.
    persist();
  }
  catchUp(loaded?.memoryReweighted ? MEMORY_REWEIGHTED_TEXT : '', backfilled);

  if (storedNewer) freezeForNewerSave();
  // Ein anderer Tab (z. B. schon aktualisiert) schreibt einen neueren Stand: sofort sperren.
  window.addEventListener('storage', (event) => {
    if (event.key === SAVE_KEY && event.newValue !== null && isNewerSave(event.newValue)) freezeForNewerSave();
  });
  if (!storedNewer) setupAccount();
  preferences.onChange(() => {
    scene.reducedMotion = preferences.reducedMotion;
    camera.reducedMotion = preferences.reducedMotion;
    sound.setLevel(preferences.settings.sound);
    // Zahlenformat und Abzeichen baut das Album selbst neu (ui/album/legacy.ts).
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
    mount: album.banners,
    beforeReload: () => {
      persist();
      return account?.flush();
    },
  });

  album.refresh(performance.now());
  requestAnimationFrame(frame);
}

start();
