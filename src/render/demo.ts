/**
 * Testseite für den Renderer (nicht Teil des Spiels): zeigt die Szene mit Tieren in
 * ihren Nischen und Begleitpflanzen. Aufruf:
 *   /src/render/demo.html?g=3.5&h=0.8&ui=0&reduced=1&set=all&v=1&plants=stage
 *
 *  g        Wachstumswert (Standard 3.5)
 *  h        Zufriedenheit aller Tiere; ohne Angabe: gemischte Werte
 *  set      'all' = Plätze je Stufe mit Arten füllen (Standard), 'proto' = nur die
 *           9 Prototyp-Arten, 'none' = keine Tiere
 *  v        Variante 0, 1, 2 …: verschiebt die Artenauswahl je Nische – so sind über
 *           einige Varianten alle 32 Arten zu sehen
 *  plants   'stage' = Pflanzplätze je Stufe füllen (Standard), 'all' = alle 14 Pflanzen,
 *           'none' = leere Liste (Nachbarbäume als Kulisse), 'off' = keine Liste (wie bisher)
 *  vig      Versorgung aller Pflanzen 0–1; ohne Angabe: gemischte Werte
 *  gallery  1 = Übersicht aller Tier- und Pflanzenzeichnungen statt der Szene
 *  ui=0     Bedienelemente ausblenden (für Screenshots)
 *  reduced  1 = weniger Bewegung
 *  t        feste Zeit in Sekunden (für reproduzierbare Screenshots). Achtung: Mit t
 *           steht die Zeit – der Knopf „Zyklus-Übergang abspielen“ bleibt dann beim
 *           ersten Bild stehen; zum Abspielen ohne t aufrufen.
 *  mem      Waldgedächtnis (0–1000; ohne Angabe: kein Erinnerungsbaum)
 *  season   Jahreszeit 0–4 (0 Frühling, 1 Sommer, 2 Herbst, 3 Winter; ohne Angabe: wie bisher)
 *  cyc      Zyklus-Übergang aus dem Wachstum g: die Szene zeigt Wachstum 0 und die
 *           Sequenz bei cyc Sekunden (mit t für feste Bilder, sonst läuft sie weiter)
 *  rate     Wachstum pro Sekunde, z. B. 0.05 – misst die Kosten beim Neuaufbau der Ebenen
 *  ht       Harmoniestufe 0–4 (ohne Angabe: keine Stimmung, Look wie bisher)
 *  vis      Durchreisende, kommagetrennt: cranes,bramblings,hummingbird-moth
 *           (Platz = Reihenfolge); in der Übersicht (gallery=1) immer dabei
 */

import { animalKinds, SpriteCache } from './animals';
import { layoutFlora, LOW_SIZE, PLANT_SPECIES, type PlacedPlant } from './flora';
import { paintPlant } from './flora-paint';
import { drawScene, type SceneAnimal, type ScenePlant, type SceneVisitor } from './tree';
import { VISITOR_DEFS } from './visitor-sprites';

type Fam = SceneAnimal['family'];

/** Alle 32 Arten (scripts/v2/content.ts) je Nische; Reihenfolge = Platz. */
const BY_NICHE: Record<string, [string, Fam][]> = {
  roots: [
    ['earthworm', 'soil'],
    ['vole', 'mammals'],
    ['chanterelle', 'fungi'],
    ['mole', 'mammals'],
    ['flyagaric', 'fungi'],
    ['porcini', 'fungi'],
    ['honeyfungus', 'fungi'],
  ],
  litter: [
    ['robin', 'birds'],
    ['hedgehog', 'mammals'],
    ['woodant', 'insects'],
    ['snail', 'soil'],
    ['salamander', 'soil'],
    ['woodlouse', 'soil'],
    ['slug', 'soil'],
    ['centipede', 'soil'],
  ],
  edge: [
    ['bee', 'insects'],
    ['deer', 'mammals'],
    ['peacock', 'insects'],
    ['fox', 'mammals'],
    ['wolf', 'mammals'],
    ['glowworm', 'insects'],
  ],
  crown: [
    ['bluetit', 'birds'],
    ['squirrel', 'mammals'],
    ['jay', 'birds'],
    ['oakmoth', 'insects'],
  ],
  bark: [
    ['woodpecker', 'birds'],
    ['tinder', 'fungi'],
    ['blackwoodpecker', 'birds'],
    ['barkbeetle', 'insects'],
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

/** Pflanzring (Reihenfolge = Platz): gemischt, damit jede Stufe alle Gruppen zeigt. */
const PLANT_RING: [string, ScenePlant['group']][] = [
  ['hazel', 'shrubs'],
  ['anemone', 'flowers'],
  ['fern', 'mosses'],
  ['birch', 'trees'],
  ['foxglove', 'flowers'],
  ['moss', 'mosses'],
  ['bramble', 'shrubs'],
  ['beech', 'trees'],
  ['strawberry', 'flowers'],
  ['rowan', 'trees'],
  ['elder', 'shrubs'],
  ['nettle', 'flowers'],
  ['pine', 'trees'],
  ['hartstongue', 'mosses'],
];
/** Pflanzplätze je Stufe (scripts/v2/content.ts `PLANT_SLOTS`). */
const PLANT_SLOTS = [0, 1, 2, 3, 5, 7, 9, 12];

const MIXED_HAPPINESS = [0.95, 0.8, 0.6, 0.9, 0.25, 0.7, 0.1, 0.85, 0.5, 0.75, 0.4, 0.9];
const MIXED_VIGOR = [1, 0.85, 0.95, 0.7, 1, 0.4, 0.9, 1, 0.6, 0.95, 0.8, 1, 0.75, 0.9];

function animalsFor(g: number, set: string, happy: number | null, variant: number): SceneAnimal[] {
  const h = (i: number) => happy ?? MIXED_HAPPINESS[i % MIXED_HAPPINESS.length]!;
  if (set === 'none') return [];
  if (set === 'proto') {
    return PROTO.map(([id, family, niche, slot], i) => ({ id, family, niche, slot, happiness: h(i) }));
  }
  const stage = Math.max(0, Math.min(7, Math.floor(g)));
  const list: SceneAnimal[] = [];
  for (const [niche, species] of Object.entries(BY_NICHE)) {
    const n = SLOTS[niche]![stage]!;
    for (let slot = 0; slot < n; slot++) {
      const [id, family] = species[(slot + variant * n) % species.length]!;
      if (list.some((a) => a.id === id)) continue;
      list.push({ id, family, niche, slot, happiness: h(list.length) });
    }
  }
  return list;
}

function plantsFor(g: number, mode: string, vigor: number | null): ScenePlant[] | undefined {
  if (mode === 'off') return undefined;
  if (mode === 'none') return [];
  const stage = Math.max(0, Math.min(7, Math.floor(g)));
  const n = mode === 'all' ? PLANT_RING.length : PLANT_SLOTS[stage]!;
  return PLANT_RING.slice(0, n).map(([id, group], slot) => ({ id, group, slot, vigor: vigor ?? MIXED_VIGOR[slot]! }));
}

const params = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const ctx = canvas.getContext('2d')!;
const growthInput = document.querySelector<HTMLInputElement>('#growth')!;
const growthValue = document.querySelector<HTMLElement>('#growth-value')!;
const happyInput = document.querySelector<HTMLInputElement>('#happy')!;
const reducedInput = document.querySelector<HTMLInputElement>('#reduced')!;
const stats = document.querySelector<HTMLElement>('#stats')!;
const harmonyInput = document.querySelector<HTMLInputElement>('#harmony')!;
const harmonyValue = document.querySelector<HTMLElement>('#harmony-value')!;
const visitorInputs = [...document.querySelectorAll<HTMLInputElement>('input.visitor')];
const TIER_NAMES = ['Zarte Anfänge', 'Lebendiges Gefüge', 'Stimmiges Ökosystem', 'Blühender Mischwald', 'Urwald'];

let g = Number(params.get('g') ?? 3.5);
const set = params.get('set') ?? 'all';
const variant = Number(params.get('v') ?? 0) || 0;
const plantMode = params.get('plants') ?? 'stage';
const vigor = params.has('vig') ? Number(params.get('vig')) : null;
const gallery = params.get('gallery') === '1';
let happy: number | null = params.has('h') ? Number(params.get('h')) : null;
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
const cycleButton = document.querySelector<HTMLButtonElement>('#cycle')!;
const memoryInput = document.querySelector<HTMLInputElement>('#memory')!;
const seasonInput = document.querySelector<HTMLInputElement>('#season')!;
const seasonValue = document.querySelector<HTMLElement>('#season-value')!;
const SEASON_NAMES = ['Frühling', 'Sommer', 'Herbst', 'Winter'];
/** Jahreszeit (undefined = aus); ?season=abc gilt als „aus“. */
let season: number | undefined = params.has('season') && Number.isFinite(Number(params.get('season'))) ? Number(params.get('season')) : undefined;
const showSeason = () => {
  if (season === undefined) {
    seasonValue.textContent = 'aus';
    return;
  }
  const s = ((season % 4) + 4) % 4;
  seasonValue.textContent = `${SEASON_NAMES[Math.round(s) % 4]} (${s.toFixed(2)})`;
};
seasonInput.value = String(season ?? -0.05);
showSeason();
seasonInput.addEventListener('input', () => {
  const v = Number(seasonInput.value);
  season = v < 0 ? undefined : v;
  showSeason();
});
const memoryValue = document.querySelector<HTMLElement>('#memory-value')!;
/** Waldgedächtnis (undefined = aus). */
let forestMemory: number | undefined = params.has('mem') ? Number(params.get('mem')) || 0 : undefined;
memoryInput.value = String(forestMemory ?? 0);
const showMemory = () => (memoryValue.textContent = forestMemory === undefined ? 'aus' : String(forestMemory));
showMemory();
memoryInput.addEventListener('input', () => {
  forestMemory = Number(memoryInput.value);
  showMemory();
});
/** Laufender Zyklus-Übergang (Startzeit in Sekunden) – die Szene springt dabei auf Wachstum 0. */
let cycleTransition: { startedAt: number; fromGrowth: number; fromPlants?: readonly ScenePlant[] } | undefined;
/** ?cyc=: Sequenz nach einigen Frames mit dem alten Baum bei dieser Sekunde anhalten. */
const cycleAt = params.has('cyc') ? Number(params.get('cyc')) : null;
let pendingCycle = false;
cycleButton.addEventListener('click', () => (pendingCycle = true));
/** Wachstum pro Sekunde (0 = steht). */
const rate = Number(params.get('rate') ?? 0) || 0;
const startG = g;
let lastNow = 0;
reducedInput.checked =
  params.get('reduced') === '1' || (!params.has('reduced') && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
if (params.get('ui') === '0') document.querySelector('#controls')!.classList.add('hidden');
growthInput.value = String(g);
happyInput.value = String(happy ?? 0.7);
growthInput.addEventListener('input', () => (g = Number(growthInput.value)));
happyInput.addEventListener('input', () => (happy = Number(happyInput.value)));

/** Harmoniestufe (undefined = aus) und Gäste. */
/** ?ht= als Stufenindex 0–4; ungültige Angaben (z. B. ?ht=abc) gelten als „aus“. */
function parseTier(v: string | null): number | undefined {
  const n = v === null || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : undefined;
}
let harmonyTier: number | undefined = parseTier(params.get('ht'));
const showTier = () => (harmonyValue.textContent = harmonyTier === undefined ? 'aus' : TIER_NAMES[harmonyTier] ?? String(harmonyTier));
harmonyInput.value = String(harmonyTier ?? -1);
showTier();
harmonyInput.addEventListener('input', () => {
  const v = Number(harmonyInput.value);
  harmonyTier = v < 0 ? undefined : v;
  showTier();
});
let visitors: SceneVisitor[] = [];
const visitorIds = (params.get('vis') ?? '').split(',').filter(Boolean);
for (const box of visitorInputs) box.checked = visitorIds.includes(box.value);
const readVisitors = () => {
  // Reihenfolge der URL bleibt erhalten, neu angehakte Gäste kommen hinten dazu.
  const on = visitorInputs.filter((b) => b.checked).map((b) => b.value);
  const ids = [...visitorIds.filter((id) => on.includes(id) || !visitorInputs.some((b) => b.value === id)), ...on.filter((id) => !visitorIds.includes(id))];
  visitors = ids.map((id, slot) => ({ id, slot }));
};
readVisitors();
for (const box of visitorInputs) box.addEventListener('change', readVisitors);

/** Zeitmessung von drawScene (ms) für die letzten Frames – auch für Playwright. */
const samples: number[] = [];
declare global {
  interface Window {
    __demo: { frameTimes: number[]; frames: number; animals: number; plants: number };
  }
}
window.__demo = { frameTimes: samples, frames: 0, animals: 0, plants: 0 };

/** Übersicht: alle Tierzeichnungen und Pflanzen groß, mit Begrenzungsrahmen. */
function drawGallery(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#e9efe2';
  ctx.fillRect(0, 0, rect.width, rect.height);
  const sprites = new SpriteCache();
  const kinds = animalKinds();
  const sz = Number(params.get('gs') ?? 56);
  const cell = Math.round(sz * 2.15);
  const cols = Math.max(1, Math.floor(rect.width / cell));
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  kinds.forEach((kind, i) => {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell * 0.68;
    const s = sprites.get(kind, Number(params.get('frame') ?? 0), false, sz, dpr);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.strokeRect(cx - s.ox, cy - s.oy, s.w, s.h);
    ctx.drawImage(s.canvas, cx - s.ox, cy - s.oy, s.w, s.h);
    ctx.fillStyle = '#334';
    ctx.fillText(kind, cx, Math.floor(i / cols) * cell + cell - 6);
  });
  // Durchreisende: alle Bilder je Zeichnung (Wildschwein und Falke haben mehr als zwei)
  const vtop = Math.ceil(kinds.length / cols) * cell;
  const FRAMES: Record<string, number> = { 'visitor:boar': 4, 'visitor:piglet': 4, 'visitor:falcon': 3, 'visitor:waxwing': 1 };
  let vi = 0;
  for (const kind of Object.keys(VISITOR_DEFS)) {
    for (let fr = 0; fr < (FRAMES[kind] ?? 2); fr++, vi++) {
      const cx = (vi % cols) * cell + cell / 2;
      const row = vtop + Math.floor(vi / cols) * cell;
      const cy = row + cell * 0.55;
      const s = sprites.get(kind, fr, false, sz, dpr);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.strokeRect(cx - s.ox, cy - s.oy, s.w, s.h);
      ctx.drawImage(s.canvas, cx - s.ox, cy - s.oy, s.w, s.h);
      ctx.fillStyle = '#334';
      ctx.fillText(`${kind.replace('visitor:', '')} ${fr}`, cx, row + cell - 6);
    }
  }
  // Pflanzen in einer Reihe darunter
  const top = vtop + Math.ceil(vi / cols) * cell + 10;
  const ids = [...Object.keys(PLANT_SPECIES), 'shrub', 'flower'];
  const pcols = Math.max(1, Math.floor(rect.width / 130));
  ids.forEach((id, i) => {
    const group = PLANT_SPECIES[id] ?? (id === 'shrub' ? 'shrubs' : 'flowers');
    const x = (i % pcols) * 130 + 65;
    const y = top + Math.floor(i / pcols) * 170 + 150;
    const placed: PlacedPlant = {
      index: 0,
      id,
      kind: id,
      group,
      slot: 0,
      x,
      y,
      hw: 0,
      h: 0,
      depth: 0,
      haze: 0,
      vigor: vigor ?? 1,
      grow: 1,
      seed: 17 + i,
      tree: null,
    };
    if (group === 'trees') {
      const fake = layoutFlora(
        { width: 130, height: 330, groundY: 160, top: 8, avail: 152, soilH: 170, cx: 65 },
        7,
        [{ id, group, slot: 0, vigor: vigor ?? 1 }],
      )[0];
      if (fake?.tree) {
        placed.tree = fake.tree;
        placed.tree.x = x;
        placed.tree.y = y;
        placed.hw = fake.hw;
      }
    } else {
      const S = 30;
      const [h, w] = LOW_SIZE[id] ?? [1, 1];
      placed.h = h * S * 1.4;
      placed.hw = w * S * 1.4;
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.moveTo(x - 60, y);
    ctx.lineTo(x + 60, y);
    ctx.stroke();
    paintPlant(ctx, placed);
    ctx.fillStyle = '#334';
    ctx.fillText(id, x, y + 14);
  });
  window.__demo.frames = 999;
}

function frame(now: number): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (rate > 0) {
    // Wachstum laufen lassen (zum Messen der Neuaufbau-Kosten), zwischen Start und 8.
    g += rate * Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    if (g > 8) g = startG;
  }
  lastNow = now;
  const time = fixedTime ?? now / 1000;
  if (cycleAt !== null && !cycleTransition) {
    // Der alte Wald stammt aus dem Startwachstum – die Szene selbst zeigt schon Stufe 0.
    cycleTransition = { startedAt: time - cycleAt, fromGrowth: startG, fromPlants: plantsFor(startG, plantMode, vigor) };
    g = 0;
  }
  if (pendingCycle) {
    // Neuer Zyklus: Spielstand zurück auf den Samen, die Szene spielt den Übergang.
    pendingCycle = false;
    cycleTransition = { startedAt: time, fromGrowth: g, fromPlants: plantsFor(g, plantMode, vigor) };
    g = 0;
    growthInput.value = '0';
  }
  const animals = animalsFor(g, set, happy, variant);
  const plants = plantsFor(g, plantMode, vigor);
  const t0 = performance.now();
  drawScene(ctx, rect.width, rect.height, {
    growth: g,
    time,
    animals,
    plants,
    reducedMotion: reducedInput.checked,
    harmonyTier,
    visitors,
    cycleTransition,
    forestMemory,
    season,
  });
  const dt = performance.now() - t0;
  samples.push(dt);
  if (samples.length > 300) samples.shift();
  window.__demo.frames++;
  window.__demo.animals = animals.length;
  window.__demo.plants = plants?.length ?? 0;
  if (window.__demo.frames % 30 === 0) {
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    stats.textContent = `${animals.length} Tiere · ${plants?.length ?? 0} Pflanzen · drawScene Median ${median.toFixed(2)} ms`;
  }
  growthValue.textContent = g.toFixed(2);
  requestAnimationFrame(frame);
}
if (gallery) {
  document.querySelector('#controls')!.classList.add('hidden');
  drawGallery();
} else {
  requestAnimationFrame(frame);
}
