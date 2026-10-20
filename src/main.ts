import { STAGES } from './content/stages';
import { growth } from './core/formulas';
import { clearStorage, loadFromStorage, saveToStorage } from './core/save';
import { createInitialState, type GameState } from './core/state';
import { chooseCard, declineEncounter, rerollEncounter, simulateOffline, tick } from './core/tick';
import { drawScene } from './render/tree';
import { formatDuration, formatNumber } from './ui/format';
import { createPanel } from './ui/panel';

const AUTOSAVE_MS = 10_000;
/** Größere Frame-Sprünge (Tab im Hintergrund) werden auf diese Dauer begrenzt. */
const MAX_FRAME_SECONDS = 1;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const ctx = canvas.getContext('2d')!;
const banner = document.querySelector<HTMLElement>('#stage-banner')!;
const toast = document.querySelector<HTMLElement>('#toast')!;

/** Neues Spiel: Der Zufallsgenerator bekommt einmalig die Uhrzeit als Startwert. */
const newGame = (): GameState => createInitialState(Date.now(), Date.now());

const loaded = loadFromStorage(Date.now());
let state = loaded?.state ?? newGame();

let shownStage = state.stage;
let lastFrame = performance.now();
let lastSave = performance.now();

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

const panel = createPanel(document.querySelector<HTMLElement>('#panel')!, {
  onChoose: (e, c, replace) => afterAction(chooseCard(state, e, c, replace).ok),
  onDecline: (e) => afterAction(declineEncounter(state, e).ok),
  onReroll: (e) => afterAction(rerollEncounter(state, e).ok),
  onReset: () => {
    clearStorage();
    state = newGame();
    shownStage = state.stage;
    saveToStorage(state);
  },
});

/** Entscheidungen sofort speichern – sie sollen ein Neuladen sicher überstehen. */
function afterAction(ok: boolean): boolean {
  if (ok) saveToStorage(state);
  return ok;
}

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS);
  lastFrame = now;
  const report = tick(state, dt);
  state.lastTick = Date.now();
  // Neue Begegnung: gleich speichern, damit Neuladen dieselben Karten zeigt.
  if (report.waypoints > 0) saveToStorage(state);

  if (state.stage !== shownStage) {
    shownStage = state.stage;
    showBanner(STAGES[state.stage]!.name, STAGES[state.stage]!.description);
  }

  resizeCanvas();
  const rect = canvas.getBoundingClientRect();
  drawScene(ctx, rect.width, rect.height, { growth: growth(state), time: now / 1000 });
  panel.update(state);

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

function showBanner(title: string, text: string): void {
  banner.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
  banner.classList.remove('visible');
  void banner.offsetWidth; // Animation neu starten
  banner.classList.add('visible');
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 6000);
}

/**
 * Rechnet die Zeit seit dem letzten Tick nach – beim Start und wenn ein Tab aus dem
 * Hintergrund zurückkehrt (dort pausiert requestAnimationFrame).
 */
function catchUp(): void {
  const seconds = (Date.now() - state.lastTick) / 1000;
  if (seconds > MAX_FRAME_SECONDS) {
    const report = simulateOffline(state, seconds);
    if (seconds > 60 && report.growth > 0) {
      const waiting = state.pendingEncounters.length;
      const encounters = waiting === 1 ? '1 Begegnung wartet' : `${waiting} Begegnungen warten`;
      showToast(
        `Willkommen zurück! In ${formatDuration(seconds)}: +${formatNumber(report.growth)} 🌿, ` +
          `+${formatNumber(report.seeds)} 🌰, ${encounters}.`,
      );
    }
    if (report.waypoints > 0) saveToStorage(state);
  }
  state.lastTick = Date.now();
  lastFrame = performance.now();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveToStorage(state);
  else catchUp();
});
window.addEventListener('beforeunload', () => saveToStorage(state));

requestAnimationFrame(frame);
