/**
 * Album-Demo mit Beispieldaten (docs/ALBUM_UI.md, F-12) – nicht im Spiel eingebunden.
 * Aufruf: `npx vite` → /src/ui/demo.html (Hash wie im Spiel, z. B. `#arten`).
 *
 * Baut das echte Album (`createAlbum`) um einen festen Beispielstand: Hain mit Bewohnern,
 * Pflanzring, wartenden Begegnungen, freigeschalteter Landschaft und gefülltem Tagebuch. Die
 * Zeit steht (kein Game Loop, kein Speichern); Spieleraktionen melden sich nur als Stempel.
 * Die Leiste „Demo“ unten links löst Meldungen, Stufen-Stempel und den Rückkehr-Zettel aus.
 */
import { COMMUNITIES } from '../content/communities';
import { PLANTS } from '../content/plants';
import { SPECIES } from '../content/species';
import { STAGES } from '../content/stages';
import { WAYPOINT_THRESHOLDS } from '../content/waypoints';
import { createInitialState, createSite, type GameState } from '../core/state';
import { stageBannerView } from './adapters';
import { createAlbum, type AlbumDeps } from './album';
import { initPreferences } from './preferences';

/** Fester Beispielstand (Startwert des Zufalls fest, damit die Demo immer gleich aussieht). */
function sampleState(): GameState {
  const state = createInitialState(Date.now(), 4242);
  const grove = STAGES.findIndex((s) => s.id === 'grove');
  state.stage = grove;
  state.waypoint = STAGES[grove]!.waypoint;
  state.totalGrowth = WAYPOINT_THRESHOLDS[state.waypoint]! + 1;
  state.seeds = 2_480;
  state.cycle.number = 3;
  state.cycle.elapsed = 95;
  state.niches.roots = ['earthworm', 'vole'];
  state.niches.litter = ['woodlouse'];
  state.niches.crown = ['bluetit'];
  state.plants = ['hazel', 'anemone'];
  state.meta.forestMemory = 320;
  state.meta.achievements = ['ancient-forest'];
  state.meta.landscape = { active: 'home', sites: [{ ...createSite('home'), ancient: true }], corridors: [], freeCorridors: [], announced: true };
  state.meta.journal.species = SPECIES.slice(0, 24).map((s) => s.id);
  state.meta.journal.plants = PLANTS.slice(0, 6).map((p) => p.id);
  state.meta.journal.communities = COMMUNITIES.slice(0, 3).map((c) => c.id);
  state.pendingEncounters = [
    { type: 'animal', cards: ['robin', 'hedgehog', 'bluetit'], rerolls: 0 },
    { type: 'event', cards: ['storm'], rerolls: 0 },
  ];
  return state;
}

const state = sampleState();
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const preferences = initPreferences();

/** Platzhalter statt der Szene: Himmel, Wiese, Erde (der Renderer läuft in der Demo nicht). */
function paintScene(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const c = canvas.getContext('2d');
  if (!c) return;
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#bcdcf0');
  sky.addColorStop(0.7, '#e4efd9');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#9cc27f';
  c.fillRect(0, h * 0.7, w, h * 0.06);
  c.fillStyle = '#6b4e3a';
  c.fillRect(0, h * 0.76, w, h * 0.24);
  c.fillStyle = '#3b3a36';
  c.font = `${Math.round(14 * dpr)}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.fillText('Szene (Demo)', w / 2, h * 0.45);
}

const say = (text: string) => album.notify(`Demo: ${text}`);

const deps: AlbumDeps = {
  canvas,
  preferences,
  state: () => state,
  actions: {
    encounter: {
      onChoose: (index, replaceId) => say(`Karte ${index + 1} eingeklebt${replaceId ? ` (ersetzt ${replaceId})` : ''}`),
      onDecline: () => say('Begegnung abgelehnt'),
      onReroll: () => say('neu gewürfelt'),
    },
    sow: () => say('Gesät'),
    buyCare: (id) => say(`Pflege ${id} gekauft`),
    newCycle: (tree, site) => say(`Neuer Zyklus mit ${tree}${site ? ` in ${site}` : ''}`),
    buildCorridor: (id) => say(`Korridor ${id} gebaut`),
    toggleRegular: (id) => say(`Stammgast ${id} umgeschaltet`),
    resetGame: () => say('Spielstand gelöscht'),
  },
  saveTransfer: {
    getCode: () => 'DEMO-CODE',
    validate: () => ({ ok: false, message: 'In der Demo lässt sich nichts importieren.' }),
    onImport: () => 'In der Demo lässt sich nichts importieren.',
  },
  newGame: false,
  today: () => '',
  encounterMark: () => null,
  takeLandscapeAnnouncement: () => '',
  ecosystemChanged: () => {},
};

const album = createAlbum(deps);

// --- Leiste „Demo“ -------------------------------------------------------------------------
const bar = document.createElement('details');
bar.className = 'demo-bar';
const summary = document.createElement('summary');
summary.textContent = 'Demo';
bar.append(summary);
const actions: [string, () => void][] = [
  ['Stempel', () => album.notify('🌱 Hasel gepflanzt')],
  ['Zettel', () => album.notify('🏅 3 Erfolge nachgetragen, dazu neu: „Bunter Saum“ – zu finden unter Ziele › Erfolge.')],
  ['Fehler', () => album.notify('Nicht genug Samen.', { error: true })],
  ['Stufen-Stempel', () => album.showBanner(stageBannerView(state.stage, null))],
  ['Schwebende Samen', () => album.floatSeeds(144)],
  [
    'Rückkehr',
    () => {
      const headline = 'Willkommen zurück! 3 Std.: +242.310 🌿, +15.904 🌰 · 2 Begegnungen warten';
      album.showReturnReport({
        greeting: 'Willkommen zurück! 3 Std.',
        headline,
        summary: `${headline} · mehr im Rückkehr-Bericht`,
        full: `${headline}. Wetter gemittelt.`,
        details: ['Willkommen zurück! In 3 Std. wuchs dein Wald um 242.310 🌿.', 'Wetter gemittelt.', '2 Begegnungen warten.'],
        more: true,
      });
    },
  ],
];
for (const [label, run] of actions) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', run);
  bar.append(button);
}
document.body.append(bar);

// Kein Game Loop: nur die Seiten auffrischen (z. B. nach Reiterwechsel) und das Bild malen.
function frame(now: number): void {
  album.refresh(now);
  if (album.sceneVisible) paintScene();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Für Playwright-Prüfungen der Demo
(window as unknown as { demo: unknown }).demo = { album, state };
