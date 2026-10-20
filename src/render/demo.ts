/**
 * Testseite für den Renderer (nicht Teil des Spiels): zeigt die Szene mit Tieren in
 * ihren Nischen. Aufruf: /src/render/demo.html?g=3.5&h=0.8&ui=0&reduced=1&set=all
 *
 *  g        Wachstumswert (Standard 3.5)
 *  h        Zufriedenheit aller Tiere; ohne Angabe: gemischte Werte
 *  set      'proto' = nur die 9 Prototyp-Arten, 'all' = Plätze je Stufe füllen (Standard), 'none' = keine Tiere
 *  ui=0     Bedienelemente ausblenden (für Screenshots)
 *  reduced  1 = weniger Bewegung
 *  t        feste Zeit in Sekunden (für reproduzierbare Screenshots)
 */

import { drawScene, type SceneAnimal } from './tree';

type Fam = SceneAnimal['family'];

/** Beispielarten je Nische (Reihenfolge = Platz). */
const BY_NICHE: Record<string, [string, Fam][]> = {
  roots: [
    ['earthworm', 'soil'],
    ['vole', 'mammals'],
    ['chanterelle', 'fungi'],
    ['mole', 'mammals'],
  ],
  litter: [
    ['robin', 'birds'],
    ['woodlouse', 'soil'],
    ['centipede', 'soil'],
    ['snail', 'soil'],
  ],
  edge: [
    ['bee', 'insects'],
    ['peacock', 'insects'],
    ['fox', 'mammals'],
    ['glowworm', 'insects'],
  ],
  crown: [
    ['bluetit', 'birds'],
    ['oakmoth', 'insects'],
    ['jay', 'birds'],
    ['squirrel', 'mammals'],
  ],
  bark: [
    ['woodpecker', 'birds'],
    ['barkbeetle', 'insects'],
    ['tinder', 'fungi'],
  ],
  hollows: [
    ['owl', 'birds'],
    ['bat', 'mammals'],
    ['stagbeetle', 'insects'],
  ],
};

/** Plätze je Nische und Stufe (wie DESIGN_V2.md, Abschnitt 3). */
const SLOTS: Record<string, number[]> = {
  roots: [0, 1, 2, 2, 3, 3, 4, 4],
  litter: [0, 0, 1, 2, 2, 3, 3, 4],
  edge: [0, 0, 1, 2, 3, 3, 4, 4],
  crown: [0, 0, 0, 2, 2, 3, 4, 4],
  bark: [0, 0, 0, 1, 2, 2, 3, 3],
  hollows: [0, 0, 0, 0, 1, 2, 2, 3],
};

const PROTO: [string, Fam, string, number][] = [
  ['robin', 'birds', 'litter', 0],
  ['bluetit', 'birds', 'crown', 0],
  ['woodpecker', 'birds', 'bark', 0],
  ['bee', 'insects', 'edge', 0],
  ['oakmoth', 'insects', 'crown', 1],
  ['barkbeetle', 'insects', 'bark', 1],
  ['earthworm', 'soil', 'roots', 0],
  ['woodlouse', 'soil', 'litter', 1],
  ['centipede', 'soil', 'litter', 2],
];

const MIXED_HAPPINESS = [0.95, 0.8, 0.6, 0.9, 0.25, 0.7, 0.1, 0.85, 0.5, 0.75, 0.4, 0.9];

function animalsFor(g: number, set: string, happy: number | null): SceneAnimal[] {
  const h = (i: number) => happy ?? MIXED_HAPPINESS[i % MIXED_HAPPINESS.length]!;
  if (set === 'none') return [];
  if (set === 'proto') {
    return PROTO.map(([id, family, niche, slot], i) => ({ id, family, niche, slot, happiness: h(i) }));
  }
  const stage = Math.max(0, Math.min(7, Math.floor(g)));
  const list: SceneAnimal[] = [];
  for (const [niche, species] of Object.entries(BY_NICHE)) {
    const n = SLOTS[niche]![stage]!;
    for (let slot = 0; slot < n && slot < species.length; slot++) {
      const [id, family] = species[slot]!;
      list.push({ id, family, niche, slot, happiness: h(list.length) });
    }
  }
  return list;
}

const params = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const ctx = canvas.getContext('2d')!;
const growthInput = document.querySelector<HTMLInputElement>('#growth')!;
const growthValue = document.querySelector<HTMLElement>('#growth-value')!;
const happyInput = document.querySelector<HTMLInputElement>('#happy')!;
const reducedInput = document.querySelector<HTMLInputElement>('#reduced')!;
const stats = document.querySelector<HTMLElement>('#stats')!;

let g = Number(params.get('g') ?? 3.5);
const set = params.get('set') ?? 'all';
let happy: number | null = params.has('h') ? Number(params.get('h')) : null;
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
reducedInput.checked =
  params.get('reduced') === '1' || (!params.has('reduced') && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
if (params.get('ui') === '0') document.querySelector('#controls')!.classList.add('hidden');
growthInput.value = String(g);
happyInput.value = String(happy ?? 0.7);
growthInput.addEventListener('input', () => (g = Number(growthInput.value)));
happyInput.addEventListener('input', () => (happy = Number(happyInput.value)));

/** Zeitmessung von drawScene (ms) für die letzten Frames – auch für Playwright. */
const samples: number[] = [];
declare global {
  interface Window {
    __demo: { frameTimes: number[]; frames: number; animals: number };
  }
}
window.__demo = { frameTimes: samples, frames: 0, animals: 0 };

function frame(now: number): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const animals = animalsFor(g, set, happy);
  const t0 = performance.now();
  drawScene(ctx, rect.width, rect.height, {
    growth: g,
    time: fixedTime ?? now / 1000,
    animals,
    reducedMotion: reducedInput.checked,
  });
  const dt = performance.now() - t0;
  samples.push(dt);
  if (samples.length > 300) samples.shift();
  window.__demo.frames++;
  window.__demo.animals = animals.length;
  if (window.__demo.frames % 30 === 0) {
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    stats.textContent = `${animals.length} Tiere · drawScene Median ${median.toFixed(2)} ms`;
  }
  growthValue.textContent = g.toFixed(2);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
