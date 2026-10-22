/**
 * Demo der v2-Komponenten mit Beispieldaten (nicht im Spiel eingebunden).
 * Aufruf: npx vite → /src/ui/demo.html  (Parameter: ?enc=animal|plant|event|none)
 */
import './album/tokens.css';
import { createNichesPage } from './album/pages/niches-page';
import type { AlbumDeps } from './album/types';
import { createEncounterDialog } from './encounter-dialog';
import type { AnimalView, EcosystemView, EncounterView } from './view-model';

const FAMILY = {
  birds: { familyIcon: '🐦', familyLabel: 'Vögel' },
  insects: { familyIcon: '🐝', familyLabel: 'Insekten' },
  mammals: { familyIcon: '🦔', familyLabel: 'Säugetiere' },
  soil: { familyIcon: '🪱', familyLabel: 'Bodenleben' },
  fungi: { familyIcon: '🍄', familyLabel: 'Pilze' },
} as const;

const animal = (
  id: string,
  name: string,
  family: keyof typeof FAMILY,
  rarity: AnimalView['rarity'],
  happiness: number,
  mood: string,
): AnimalView => ({ id, name, family, familyIcon: FAMILY[family].familyIcon, rarity, happiness, mood });

const animals = {
  regenwurm: animal('regenwurm', 'Regenwurm', 'soil', 'common', 1, 'gräbt zufrieden'),
  rotkehlchen: animal('rotkehlchen', 'Rotkehlchen', 'birds', 'common', 0.82, 'singt im Gebüsch'),
  rollassel: animal('rollassel', 'Rollassel', 'soil', 'common', 0.6, 'wünscht sich Totholz'),
  wildbiene: animal('wildbiene', 'Wildbiene', 'insects', 'common', 0.7, 'sucht Blüten'),
  blaumeise: animal('blaumeise', 'Blaumeise', 'birds', 'common', 0.55, 'sucht eine Baumhöhle'),
  eichenwickler: animal('eichenwickler', 'Eichenwickler', 'insects', 'common', 1, 'frisst Laub'),
  buntspecht: animal('buntspecht', 'Buntspecht', 'birds', 'rare', 0.32, 'vermisst Totholz'),
  borkenkaefer: animal('borkenkaefer', 'Borkenkäfer', 'insects', 'common', 0.9, 'bohrt Gänge'),
};

function ecosystem(t: number): EcosystemView {
  // Kleine Schwankungen, damit das Frame-Update sichtbar arbeitet
  const wobble = (base: number, amp: number, speed: number) =>
    Math.min(1, Math.max(0, base + amp * Math.sin(t * speed)));
  return {
    stageName: 'Alter Baum',
    stageProgress: (t / 60) % 1,
    progressHint: 'Nächste Begegnung bei 26.400 🌿 Gesamt-Wachstum',
    pendingEncounters: 0,
    growthPerSec: 14.2 + Math.sin(t) * 0.3,
    seeds: 312 + t * 2.1,
    seedsPerSec: 2.1,
    harmony: 64 + Math.floor(t / 10),
    harmonyTier: 'Stimmiges Ökosystem',
    harmonyMultiplier: 1.64,
    harmonyParts: [
      { label: 'Vielfalt', value: 23 },
      { label: 'Zufriedenheit', value: 22 },
      { label: 'Pyramide', value: 14.5 },
      { label: 'Lebensgemeinschaften', value: 8 },
      { label: 'Unbewachte Schädlinge', value: -4 },
    ],
    families: [
      { id: 'birds', icon: '🐦', label: 'Vögel', count: 3, thresholds: [2, 3, 5], bonuses: ['Insektenschaden −25 %', '+15 % Samen', '+12 % Wachstum, +20 % Samen'] },
      { id: 'insects', icon: '🐝', label: 'Insekten', count: 3, thresholds: [2, 3, 5], bonuses: ['Blumen +30 % Samen', 'Sträucher und Bäume +30 % Samen', '+40 % Samen'] },
      { id: 'mammals', icon: '🦔', label: 'Säugetiere', count: 0, thresholds: [2, 3, 5], bonuses: ['+10 % Samen', '+7 % Wachstum', '+15 % Wachstum'] },
      { id: 'soil', icon: '🪱', label: 'Bodenleben', count: 2, thresholds: [2, 3, 5], bonuses: ['+2 Wasser', '+7 % Wachstum', '+15 % Wachstum, +3 Wasser'] },
      { id: 'fungi', icon: '🍄', label: 'Pilze', count: 1, thresholds: [2, 3, 5], bonuses: ['Bäume +6 % Wachstum', '+3 Wasser, +2 Licht', '+18 % Wachstum'] },
    ],
    niches: [
      { id: 'canopy', icon: '🌳', label: 'Krone', capacity: 2, animals: [{ ...animals.blaumeise, happiness: wobble(0.55, 0.1, 0.7) }, animals.eichenwickler] },
      { id: 'bark', icon: '🪵', label: 'Stamm & Rinde', capacity: 2, animals: [animals.buntspecht, animals.borkenkaefer] },
      { id: 'cavities', icon: '🕳️', label: 'Höhlen & Totholz', capacity: 1, animals: [] },
      { id: 'edge', icon: '🌼', label: 'Waldsaum', capacity: 3, animals: [{ ...animals.wildbiene, happiness: wobble(0.7, 0.15, 0.5) }] },
      { id: 'litter', icon: '🍂', label: 'Laubstreu', capacity: 2, animals: [animals.rotkehlchen, animals.rollassel] },
      { id: 'roots', icon: '🪱', label: 'Wurzelraum', capacity: 3, animals: [animals.regenwurm] },
      { id: 'meadow', icon: '🌾', label: 'Lichtung', capacity: 0, animals: [], unlockHint: 'öffnet sich bei Windwurf' },
    ],
    night: { growth: ['Waldkauz'], seeds: [] },
    foodWeb: {
      summary: '1 überjagt · 2 im Gleichgewicht',
      emptyText: '',
      rows: [
        { tag: 'raupen', icon: '🐛', name: 'Raupen', state: 'balanced', stateLabel: 'im Gleichgewicht', stateIcon: '✓', stock: { level: 'high', label: 'reichlich' }, prey: 'Eichenwickler', hunters: 'Blaumeise', hunterCount: 1, controllers: '', hint: 'Die Jäger werden satt, die Beute bleibt gelassen.' },
        { tag: 'kaefer', icon: '🪲', name: 'Käfer', state: 'overhunted', stateLabel: 'überjagt', stateIcon: '👀', stock: { level: 'low', label: 'knapp' }, prey: 'Borkenkäfer', hunters: 'Buntspecht und Schwarzspecht', hunterCount: 2, controllers: '', hint: 'Mehr Jäger als Futter – zufriedenere Beute oder eine weitere Art, die Käfer bietet, hilft.' },
        { tag: 'wuermer', icon: '🪱', name: 'Würmer', state: 'unhunted', stateLabel: 'ungejagt', stateIcon: '○', stock: { level: 'good', label: 'gut' }, prey: 'Regenwurm', hunters: '', hunterCount: 0, controllers: '', hint: 'Kein Nachteil – ein Jäger fände hier Futter.' },
      ],
    },
    communities: {
      activeCount: 1,
      harmony: 8,
      summary: '1 von 9 aktiv · +8 ⚖️',
      summaryText: '1 von 9 aktiv, +8 Harmonie',
      items: [
        { id: 'humus', icon: '🪱', name: 'Humusküche', discovered: true, state: 'active', present: 3, total: 3, progress: 1, harmony: 8, effects: '+5 % 🌿' },
        { id: 'caterpillar-watch', icon: '🐛', name: 'Raupenwacht', discovered: true, state: 'near', present: 2, total: 3, progress: 2 / 3, harmony: 0, effects: '', missingText: 'fehlt: Braunes Langohr oder Rote Waldameise' },
        { id: 'deadwood', icon: '❔', name: '???', discovered: false, state: 'open', present: 1, total: 4, progress: 0.25, harmony: 0, effects: '', hint: 'Was stirbt, schafft Wohnraum.' },
      ],
    },
    plantRing: {
      capacity: 5,
      plants: [
        { id: 'hazel', name: 'Hasel', group: 'shrubs', groupIcon: '🫐', groupLabel: 'Sträucher' },
        { id: 'birch', name: 'Hänge-Birke', group: 'trees', groupIcon: '🌳', groupLabel: 'Bäume' },
        { id: 'moss', name: 'Frauenhaarmoos', group: 'mosses', groupIcon: '🍃', groupLabel: 'Moose & Farne' },
      ],
      supply: 0.86,
      supplyText: '☀️ Licht 86 % · 💧 Wasser 100 %',
      meters: [
        { key: 'light', icon: '☀️', label: 'Licht', ratio: 0.86, detail: 'Bedarf 7 von 6' },
        { key: 'water', icon: '💧', label: 'Wasser', ratio: 1, detail: 'Bedarf 2 von 7' },
      ],
      shortageHint: 'Zu wenig Licht – Begleitpflanzen wachsen nur mit 86 %. Schattenpflanzen helfen.',
      groups: [
        { id: 'trees', icon: '🌳', label: 'Bäume', count: 2 },
        { id: 'shrubs', icon: '🫐', label: 'Sträucher', count: 1 },
        { id: 'flowers', icon: '🌸', label: 'Blumen & Kräuter', count: 0 },
        { id: 'mosses', icon: '🍃', label: 'Moose & Farne', count: 1 },
      ],
      plantCost: 137.18,
      plantCostLabel: '138',
      canOpenPicker: true,
      affordable: 312 + t * 2.1 >= 137,
      plantHint: '',
    },
  };
}

const animalEncounter: EncounterView = {
  kind: 'animal',
  title: 'Etwas regt sich zwischen Laub und Rinde …',
  rerollCost: 36,
  canReroll: true,
  declineReward: 18,
  cards: [
    {
      id: 'steinlaeufer',
      name: 'Steinläufer',
      ...FAMILY.soil,
      family: 'soil',
      rarity: 'rare',
      niche: 'litter',
      nicheLabel: '🍂 Laubstreu',
      nicheFull: true,
      replaceOptions: [
        { id: 'rollassel', name: 'Rollassel', preview: { harmonyDelta: 3, growthDelta: -0.02, happiness: 0.4 } },
        { id: 'rotkehlchen', name: 'Rotkehlchen', preview: { harmonyDelta: -2, growthDelta: 0.06, seedDelta: -0.08, happiness: 0.4 } },
      ],
      conditions: [
        { label: '🍽 Insekten', met: true },
        { label: '🪵 Totholz', met: false },
      ],
      effects: [
        { label: 'jagt Insekten (−30 % Schaden)', tone: 'good' },
        { label: '+6 % 🌿', tone: 'good' },
      ],
      preview: { harmonyDelta: 3, growthDelta: -0.02, happiness: 0.4 },
      flavor: 'Flink und lichtscheu – unter jedem Rindenstück wartet eine Mahlzeit.',
    },
    {
      id: 'schwarzspecht',
      name: 'Schwarzspecht',
      ...FAMILY.birds,
      family: 'birds',
      rarity: 'legendary',
      niche: 'bark',
      nicheLabel: '🪵 Stamm & Rinde',
      nicheFull: true,
      replaceOptions: [
        { id: 'borkenkaefer', name: 'Borkenkäfer', preview: { harmonyDelta: 12, growthDelta: 0.18, happiness: 0.62 } },
        { id: 'buntspecht', name: 'Buntspecht', preview: { harmonyDelta: 5, growthDelta: 0.07, happiness: 0.45 } },
      ],
      conditions: [
        { label: '🍽 Käfer', met: true },
        { label: '🐜 Rote Waldameise', met: false },
        { label: '🪵 Totholz', met: true },
        { label: '🌳 3× Bäume', met: true },
      ],
      effects: [
        { label: '+10 % 🌿', tone: 'good' },
        { label: 'Baumeister: +1 Platz Krone und Höhlen', tone: 'good' },
        { label: 'jagt Käfer (−40 % Schaden)', tone: 'good' },
      ],
      preview: { harmonyDelta: 12, growthDelta: 0.18, happiness: 0.62 },
      flavor: 'Der Baumeister des Waldes. In seine Höhlen ziehen später Kauz, Fledermaus und Hohltaube.',
      route: 'kommt über die Schlehenhecke aus den Buchenhallen',
    },
    {
      id: 'eichhoernchen',
      name: 'Eichhörnchen',
      ...FAMILY.mammals,
      family: 'mammals',
      rarity: 'common',
      niche: 'canopy',
      nicheLabel: '🌳 Krone',
      nicheFull: true,
      replaceOptions: [{ id: 'eichenwickler', name: 'Eichenwickler', preview: { harmonyDelta: 1, growthDelta: 0.16, seedDelta: 0.12, happiness: 1 } }],
      conditions: [
        { label: '🍽 Nüsse', met: true },
        { label: '🌳 2× Bäume', met: true },
      ],
      effects: [
        { label: '+12 % 🌰', tone: 'good' },
        { label: '+6 % 🌿', tone: 'good' },
        { label: 'stört Blaumeise', tone: 'bad' },
      ],
      preview: { harmonyDelta: 1, growthDelta: 0.16, seedDelta: 0.12, happiness: 1 },
      flavor: 'Vergisst die Hälfte seiner Verstecke – und pflanzt so neue Eichen.',
    },
  ],
};

const plantEncounter: EncounterView = {
  kind: 'plant',
  title: 'Etwas keimt.',
  rerollCost: 36,
  canReroll: false,
  declineReward: 18,
  cards: [
    {
      id: 'buschwindroeschen', name: 'Buschwindröschen', family: 'plants', familyIcon: '🌼', familyLabel: 'Blumen', rarity: 'common',
      effects: [{ label: '+0,6 🌰/s', tone: 'good' }, { label: 'braucht 1 ☀️', tone: 'neutral' }],
      preview: { harmonyDelta: 4, growthDelta: 0.01, seedDelta: 0.2 },
      flavor: 'Blüht, bevor die Buchen ihr Laub austreiben.',
    },
    {
      id: 'hasel', name: 'Hasel', family: 'plants', familyIcon: '🌿', familyLabel: 'Sträucher', rarity: 'common',
      effects: [{ label: '+1,2 🌿/s', tone: 'good' }, { label: 'Nüsse für Eichhörnchen', tone: 'good' }, { label: 'braucht 2 💧', tone: 'neutral' }],
      preview: { harmonyDelta: 5, growthDelta: 0.08, seedDelta: 0.05 },
    },
    {
      id: 'wurmfarn', name: 'Wurmfarn', family: 'plants', familyIcon: '🌱', familyLabel: 'Moose & Farne', rarity: 'rare',
      effects: [{ label: 'Feuchte', tone: 'good' }, { label: 'nimmt 1 ☀️ weg', tone: 'bad' }],
      preview: { harmonyDelta: 6, growthDelta: -0.01 },
      disabledReason: 'Kein Wasser frei',
    },
  ],
};

const eventEncounter: EncounterView = {
  kind: 'event',
  title: 'Sturmnacht',
  subtitle: '„Ein Ast ist abgebrochen und liegt im Laub.“',
  rerollCost: null,
  canReroll: false,
  declineReward: null,
  cards: [
    {
      id: 'totholz', name: 'Totholz liegen lassen', family: 'event', familyIcon: '🪵', familyLabel: 'dauerhaft',
      effects: [{ label: 'Totholz', tone: 'good' }, { label: '+1 Platz Höhlen & Totholz', tone: 'good' }],
      preview: { harmonyDelta: 7, growthDelta: 0.03 },
    },
    {
      id: 'holz', name: 'Holz verwerten', family: 'event', familyIcon: '🌰', familyLabel: 'sofort',
      effects: [{ label: '+137 🌰', tone: 'good' }],
      preview: { harmonyDelta: 0, growthDelta: 0 },
    },
  ],
};

const encounters: Record<string, EncounterView> = {
  animal: animalEncounter,
  plant: plantEncounter,
  event: eventEncounter,
};

const log = document.getElementById('demo-log')!;
// Reiter „Nischen“ des Albums mit Beispieldaten (Album-Demo folgt in Schritt 12).
const eco: { view: EcosystemView | null; serial: number } = { view: null, serial: 0 };
const niches = createNichesPage({
  deps: {} as AlbumDeps,
  back() {},
  float: (text) => note(text),
  open: (page) => note(`Umblättern: ${page.kind}${'id' in page ? ` ${page.id}` : ''}`),
  eco,
  // Die Nischen brauchen das Ziel des nächsten Zyklus nicht.
  albumTarget: {} as Parameters<typeof createNichesPage>[0]['albumTarget'],
});
niches.connect({ openPlantPicker: () => note('Pflanze setzen'), showCare: (id) => note(`Zur Pflege: ${id}`) });
document.getElementById('panel')!.append(niches.page.element);
let queued = 2;
let decisions = 0;
const order = ['animal', 'plant', 'event'] as const;
let shownKey: (typeof order)[number] = 'animal';

function note(text: string): void {
  decisions += 1;
  log.dataset.decisions = String(decisions);
  log.textContent = `${decisions}. ${text}`;
}

/** Wie im Spiel: Nach einer Entscheidung kommt sofort die nächste wartende Begegnung. */
function next(): void {
  if (queued <= 0) {
    dialog.hide();
    return;
  }
  queued -= 1;
  shownKey = order[(order.indexOf(shownKey) + 1) % order.length]!;
  dialog.show(encounters[shownKey]!, queued);
}

const dialog = createEncounterDialog(document.body, {
  onChoose(index, replaceId) {
    note(`Gewählt: Karte ${index + 1}${replaceId ? `, ersetzt ${replaceId}` : ''}`);
    next();
  },
  onDecline() {
    note('Abgelehnt');
    next();
  },
  onReroll() {
    note('Neu gewürfelt');
    // Gleiche Karten, aber jetzt reicht der Samen nicht mehr: Inhalt wird aktualisiert.
    const view = encounters[shownKey]!;
    dialog.show({ ...view, canReroll: false, rerollCost: (view.rerollCost ?? 0) * 2 }, queued);
  },
  onDefer() {
    note('Später');
    dialog.hide();
  },
});

// Für Playwright-Prüfungen der Demo
(window as unknown as { demo: unknown }).demo = { dialog, encounters };

const controls = document.getElementById('demo-controls')!;
for (const [key, label] of [
  ['animal', 'Tierbegegnung'],
  ['plant', 'Pflanzenbegegnung'],
  ['event', 'Ereignis'],
] as const) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'encounter-button secondary';
  button.textContent = label;
  button.addEventListener('click', () => {
    shownKey = key;
    dialog.show(encounters[key]!, queued);
  });
  controls.append(button);
}

const start = performance.now();
function frame(now: number) {
  eco.view = ecosystem((now - start) / 1000);
  eco.serial++;
  niches.update?.(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const params = new URLSearchParams(location.search);
// Ungültige Werte (z. B. ?queued=abc oder negativ) → 0
const queuedParam = Number(params.get('queued') ?? 2);
queued = Number.isFinite(queuedParam) && queuedParam > 0 ? Math.floor(queuedParam) : 0;
const initial = params.get('enc') ?? 'animal';
if (initial === 'animal' || initial === 'plant' || initial === 'event') {
  shownKey = initial;
  dialog.show(encounters[initial]!, queued);
}
