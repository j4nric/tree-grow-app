import { STAGES } from './content/stages';
import { growth } from './core/formulas';
import { clearStorage, loadFromStorage, saveToStorage } from './core/save';
import { createInitialState } from './core/state';
import { buyUpgrade, clickGrow, simulateOffline, tick } from './core/tick';
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

let state = loadFromStorage(Date.now()) ?? createInitialState(Date.now());

const offlineSeconds = (Date.now() - state.lastTick) / 1000;
if (offlineSeconds > 60) {
  const gained = simulateOffline(state, offlineSeconds);
  if (gained > 0) {
    showToast(`Willkommen zurück! In ${formatDuration(offlineSeconds)} hast du ${formatNumber(gained)} Energie gesammelt.`);
  }
}
state.lastTick = Date.now();

let shownStage = state.stage;
let lastFrame = performance.now();
let lastSave = performance.now();

const panel = createPanel(document.querySelector<HTMLElement>('#panel')!, {
  onGrow: () => clickGrow(state),
  onBuy: (id) => buyUpgrade(state, id),
  onReset: () => {
    if (!confirm('Wirklich von vorne anfangen? Der gesamte Fortschritt geht verloren.')) return;
    clearStorage();
    state = createInitialState(Date.now());
    shownStage = state.stage;
  },
});

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS);
  lastFrame = now;
  tick(state, dt);
  state.lastTick = Date.now();

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

function showToast(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => (toast.hidden = true), 6000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveToStorage(state);
});
window.addEventListener('beforeunload', () => saveToStorage(state));

requestAnimationFrame(frame);
