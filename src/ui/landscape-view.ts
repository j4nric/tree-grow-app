/**
 * View-Model der Karte der Landschaft (Reiter „Landschaft“, U:Standort, U:Neuer Zyklus; DESIGN_V2.md 24.5, 24.6).
 * Reine Funktionen ohne DOM – getestet in tests/landscape-view.test.ts. Alle Regeln (was
 * wählbar ist, was es kostet) kommen aus core/ (`previewNewCycle(state).landscape`,
 * `landscapeCorridors`); hier stehen nur Texte, Symbole und Reihenfolge. Die Komponente dazu
 * steht in album/landscape-map.ts.
 */
import {
  CORRIDORS_BY_ID,
  JAY_SEEDS_FIRST_ANCIENT,
  LANDSCAPE_SITES_BY_ID,
  type CorridorKind,
  type ForestSite,
  type SiteId,
} from '../content/landscape';
import { EVENTS_BY_ID } from '../content/events';
import type { Tag } from '../content/types';
import { STAGES } from '../content/stages';
import { WEATHERS_BY_ID, type WeatherId } from '../content/weather';
import { MAIN_TREES, MAIN_TREES_BY_ID, type MainTreeId } from '../content/trees';
import { ANCIENT_STAGE, activeSite, effectiveForestMemory, effectiveMemoryOf, ownMemory } from '../core/landscape';
import { corridorWildwechselText, wildwechselChanceText } from './wildwechsel-view';
import type { GameState } from '../core/state';
import {
  landscapeCorridors,
  type CorridorChoice,
  type LandscapeError,
  type NewCyclePreview,
  type SiteChoice,
} from '../core/tick';
import { formatNumber } from './format';
import { chronicleShortText, chronicleTotalText, siteChronicleView } from './chronicle-view';

/** Meldung beim ersten Öffnen der Landschaft (24.3) – einmal, auch nach dem Laden. */
export const LANDSCAPE_UNLOCK_TEXT =
  '🪶 Ein Eichelhäher trägt Eicheln aus deinem Urwald davon – irgendwo in der Landschaft werden sie keimen.';

/** Was der nächste Zyklus an diesem Standort wäre. */
export type SiteAction = 'stay' | 'switch' | 'found';

export interface LandscapeSiteView {
  id: SiteId;
  icon: string;
  name: string;
  /** Waldtyp, z. B. „Hartholzaue“. */
  forestType: string;
  /** Lage auf der Karte (0–1). */
  x: number;
  y: number;
  founded: boolean;
  /** Hier wächst der laufende Zyklus. */
  active: boolean;
  /** Hier war schon einmal Urwald (nach diesem Zyklus). */
  ancient: boolean;
  /** Kurzer Zustand im Knopf, z. B. „hier“, „gegründet · Urwald“, „gründen · 3 🪶“. */
  status: string;
  /** Stimmungstext. */
  text: string;
  /**
   * Gedächtnis eigen/wirksam heute, z. B. „Gedächtnis 120 eigen · 270 wirksam dort“; ändert der
   * laufende Zyklus den Wert, mit „(nach diesem Zyklus 275)“.
   */
  memory: string;
  /** Hauptbaum bzw. Leitbaum, z. B. „Leitbaum: 🌲 Waldkiefer“. */
  tree: string;
  /** Vorausgewählte Art, wenn der nächste Zyklus hier wächst. */
  mainTree: MainTreeId;
  /** Wählbare Arten, wenn der nächste Zyklus hier wächst (eine Gründung schaltet ihren Leitbaum frei). */
  unlockedTrees: readonly MainTreeId[];
  /** Eigenheit: was der Wald bringt (nur dort) – null beim Heimatwald. */
  gains: string | null;
  /** Eigenheit: worauf man dort verzichtet – null, wenn nichts. */
  costs: string | null;
  /** Gabe (in allen Wäldern) – null beim Heimatwald. */
  gift: string | null;
  /** Die Gabe wirkt schon (Wald gegründet). */
  giftActive: boolean;
  /**
   * Wetter des Waldtyps (DESIGN_V2.md 24.14) mit dem Zeichen der häufigsten Lage, z. B.
   * „🌫️ Oft Nebel über dem Wasser, selten Dürre.“ – null beim Heimatwald.
   */
  weather: string | null;
  /** Zeichen der häufigsten Wetterlage (für die Karte, z. B. „🌨️“) – null beim Heimatwald. */
  weatherIcon: string | null;
  /**
   * Ereignisse, die dieser Waldtyp öfter erlebt (`eventFactors` > 1, Phase 9, 1c), z. B.
   * „🌧️ Regenreicher Frühling, 🐌 Schneckenjahr“ – null ohne Faktor.
   */
  events: string | null;
  /** Nur die Zeichen dieser Ereignisse (für die Karte, z. B. „🌧️🐌“) – null ohne Faktor. */
  eventIcons: string | null;
  /**
   * Erklärung zu Merkmalen, die der Wald immer bietet (Eigenheit „Feuchte“), z. B. „💧 Feuchte: …“;
   * null, wenn er keine bietet.
   */
  habitatNote: string | null;
  /** Urwald-Zustand als Satz, z. B. „Hier war schon Urwald (+2 🪶).“; null, solange nicht gegründet. */
  ancientText: string | null;
  /** null = nicht wählbar (siehe blocker). */
  action: SiteAction | null;
  /** Warum nicht wählbar (deutscher Satz); null, wenn wählbar. */
  blocker: string | null;
  /** Kosten der Gründung (nur nicht gegründete Wälder). */
  cost: number | null;
  /**
   * Waldchronik (DESIGN_V2.md 26.7), z. B. „Chronik 4 / 6 – offen: Erster Schnee, Kennart“ –
   * null vor der Landschaft und für nicht gegründete Wälder.
   */
  chronicle: string | null;
  /** Wachssiegel: Die Chronik ist vollständig – Symbol des Andenkens, sonst null. */
  seal: string | null;
}

export type CorridorState = 'built' | 'buildable' | 'unaffordable' | 'locked';

export interface LandscapeCorridorView {
  id: string;
  name: string;
  kind: CorridorKind;
  icon: string;
  /** „Heimatwald – Auwald am Fluss“ */
  ends: string;
  text: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  state: CorridorState;
  /** Kam mit einer Gründung (gratis). */
  free: boolean;
  cost: number;
  /** Zustand als kurzer Text, z. B. „verbunden“, „Weg der Häher – gratis“, „Kostet 3 🪶 – du hast 1.“ */
  note: string;
  /** In der Liste unter der Karte zeigen (beide Wälder gegründet). */
  listed: boolean;
  /**
   * Wildwechsel (24.6): gebaut, am aktiven Wald und der Nachbar hat Tiere im Bestand –
   * „🦌 Wildwechsel aus den Buchenhallen (7 Arten im Bestand)“; sonst null.
   */
  wildwechsel: string | null;
}

export interface LandscapeMapView {
  /** „Wo keimt der nächste Baum?“ */
  question: string;
  /** „🪶 5 Hähersaat – nach diesem Zyklus 6“ */
  jaySeeds: string;
  /** Verfügbare Hähersaat jetzt (für Tests und Ansage). */
  available: number;
  active: SiteId;
  /** Neuer Zyklus erlaubt (sonst sind nur Korridore baubar). */
  allowed: boolean;
  sites: LandscapeSiteView[];
  corridors: LandscapeCorridorView[];
  /**
   * Wildwechsel am aktiven Wald, z. B. „🦌 Wildwechsel im Heimatwald: 20 % je Tierbegegnung“;
   * ohne Korridor dort ein Hinweis, solange einer baubar wäre; sonst null.
   */
  wildwechsel: string | null;
  /** Hinweis unter der Korridor-Liste, z. B. „7 weitere Korridore, sobald die Wälder an ihren Enden gegründet sind.“; sonst null. */
  corridorHint: string | null;
  /** Kennzahl der Waldchronik (26.7), z. B. „📜 9 / 36 Kapitel“ – null vor der Landschaft. */
  chronicle: string | null;
}

export const CORRIDOR_ICONS: Record<CorridorKind, string> = {
  hedge: '🌿',
  stream: '💧',
  path: '🥾',
  ravine: '🏞️',
  bridge: '🌉',
};

const siteName = (id: SiteId) => LANDSCAPE_SITES_BY_ID.get(id)?.name ?? id;
const ANCIENT_NAME = STAGES[STAGES.length - 1]?.name ?? 'Urwald';
const CYCLE_STAGE_NAME = STAGES.find((s) => s.id === 'grove')?.name ?? 'Hain';

/** Symbol und Name einer Hauptbaum-Art (unbekannt: Eiche). */
function treeName(id: MainTreeId | null | undefined): string {
  const tree = (id && MAIN_TREES_BY_ID.get(id)) || MAIN_TREES[0]!;
  return `${tree.icon} ${tree.name}`;
}

/**
 * Eigenheit aus der Kurzfassung der Daten in Gewinn und Verzicht teilen: Teile mit
 * Minuszeichen (−) sind der Verzicht, die übrigen der Gewinn.
 */
export function splitSiteSummary(summary: string): { gains: string | null; costs: string | null } {
  const parts = summary.split(' · ').map((p) => p.trim()).filter(Boolean);
  const gains = parts.filter((p) => !p.includes('−'));
  const costs = parts.filter((p) => p.includes('−'));
  return { gains: gains.length ? gains.join(' · ') : null, costs: costs.length ? costs.join(' · ') : null };
}

/** Grund, warum ein Standort nicht wählbar ist, als deutscher Satz. */
export function siteBlockerText(choice: SiteChoice, activeName: string, availableAfter: number): string | null {
  switch (choice.blocker) {
    case null:
      return null;
    case 'site-locked':
      return 'Noch nicht erreichbar.';
    case 'cycle-locked':
      // Gründen geht nur aus dem Urwald – vor dem Hain erst recht nicht.
      return choice.founded
        ? `Wechseln geht ab der Stufe „${CYCLE_STAGE_NAME}“.`
        : `Nur aus dem ${ANCIENT_NAME}: Ein neuer Wald entsteht, wenn der Häher Eicheln aus einem alten Wald trägt.`;
    case 'needs-ancient-forest':
      return `Nur aus dem ${ANCIENT_NAME}: Ein neuer Wald entsteht, wenn der Häher Eicheln aus einem alten Wald trägt.`;
    case 'not-adjacent':
      return `Liegt nicht neben ${activeName} – gründen kannst du nur gleich nebenan.`;
    case 'not-enough-jay-seeds':
      return `Gründen kostet ${formatNumber(choice.cost ?? 0)} 🪶 – nach diesem Zyklus hast du ${formatNumber(availableAfter)} 🪶.`;
    default:
      return landscapeErrorText(choice.blocker);
  }
}

/** Fehler der Landschaft (startNewCycle mit Standort, buildCorridor) als Meldung. */
export function landscapeErrorText(error: LandscapeError | 'cycle-locked'): string {
  switch (error) {
    case 'site-locked':
      return 'Dieser Wald ist noch nicht erreichbar.';
    case 'not-enough-jay-seeds':
      return 'Dafür reicht die Hähersaat 🪶 noch nicht.';
    case 'not-adjacent':
      return 'Ein neuer Wald muss neben dem Wald liegen, in dem du gerade wächst.';
    case 'needs-ancient-forest':
      return `Einen neuen Wald gründen kannst du nur aus dem ${ANCIENT_NAME}.`;
    case 'unknown-corridor':
      return 'Diesen Korridor gibt es nicht.';
    case 'corridor-built':
      return 'Dieser Korridor steht schon.';
    case 'cycle-locked':
      return `Wechseln geht ab der Stufe „${CYCLE_STAGE_NAME}“.`;
  }
}

/** Kurzer Zustand im Knopf auf der Karte. */
export function siteStatus(choice: SiteChoice): string {
  // Kurz (eine Zeile im Knopf); alles Weitere steht in den Angaben darunter. Gesperrt mit dem
  // Grund in zwei, drei Worten (Playtest Phase 7, K3) – der ganze Satz steht auf U:Standort.
  if (choice.active) return choice.ancient ? `hier · ${ANCIENT_NAME}` : 'hier';
  if (choice.founded) return choice.ancient ? `schon ${ANCIENT_NAME}` : 'gegründet';
  const cost = choice.cost !== null ? ` · ${formatNumber(choice.cost)} 🪶` : '';
  switch (choice.blocker) {
    case null:
      return `gründen · ${formatNumber(choice.cost ?? 0)} 🪶`;
    case 'cycle-locked':
    case 'needs-ancient-forest':
      return `erst im ${ANCIENT_NAME}${cost}`;
    case 'not-adjacent':
      return `nicht nebenan${cost}`;
    case 'not-enough-jay-seeds':
      return `zu wenig 🪶${cost}`;
    default:
      return `gesperrt${cost}`;
  }
}

function siteMemoryText(state: GameState, choice: SiteChoice, allowed: boolean): string {
  if (choice.active) {
    // Erst der Stand heute (wie im Tagebuch), dann benannt der Stand nach diesem Zyklus
    // (ganzzahlig wie oben – exakte Vergleiche).
    const own = ownMemory(state, choice.id);
    const effective = effectiveForestMemory(state);
    const inflow = effective > own ? ` · ${formatNumber(effective)} wirksam` : '';
    const later: string[] = [];
    if (allowed && choice.memory > own) later.push(`${formatNumber(choice.memory)} eigen`);
    if (allowed && choice.effectiveMemory > choice.memory && choice.effectiveMemory !== effective) {
      later.push(`${formatNumber(choice.effectiveMemory)} wirksam`);
    }
    const after = later.length > 0 ? ` (nach diesem Zyklus ${later.join(' · ')})` : '';
    return `Gedächtnis ${formatNumber(own)} eigen${inflow}${after}`;
  }
  if (choice.founded) {
    // `choice.effectiveMemory` rechnet schon mit dem Gewinn dieses Zyklus (Zufluss vom aktiven
    // Wald) – das Tagebuch zeigt den Stand heute. Weichen beide ab, stehen beide benannt da.
    // Gedächtnis ist ganzzahlig (der Zufluss wird abgerundet, core/landscape.ts) – der
    // Vergleich ist exakt, gleiche Anzeige heißt gleicher Wert.
    const today = effectiveMemoryOf(state, choice.id);
    const after = choice.effectiveMemory !== today ? ` (nach diesem Zyklus ${formatNumber(choice.effectiveMemory)})` : '';
    return `Gedächtnis ${formatNumber(choice.memory)} eigen · ${formatNumber(today)} wirksam dort${after}`;
  }
  const corridor = choice.freeCorridor ? CORRIDORS_BY_ID.get(choice.freeCorridor) : undefined;
  return corridor
    ? `Beginnt mit 0 eigenem Gedächtnis · ${formatNumber(choice.effectiveMemory)} wirksam über ${corridor.name}`
    : 'Beginnt mit 0 eigenem Gedächtnis';
}

function siteTreeText(choice: SiteChoice): string {
  if (choice.active) return `Hauptbaum: ${treeName(choice.mainTree)}`;
  if (choice.founded) return `Zuletzt gewachsen: ${treeName(choice.mainTree)}`;
  const lead = LANDSCAPE_SITES_BY_ID.get(choice.id)?.leadTree ?? null;
  const leadId = lead ?? MAIN_TREES[0]!.id;
  return leadId === choice.mainTree
    ? `Leitbaum: ${treeName(leadId)}`
    : `Leitbaum: ${treeName(leadId)} (noch nicht freigeschaltet – es wächst ${treeName(choice.mainTree)})`;
}

function siteAction(choice: SiteChoice): SiteAction | null {
  if (choice.active) return 'stay';
  if (choice.blocker !== null) return null;
  return choice.founded ? 'switch' : 'found';
}

/** Hähersaat-Zeile, z. B. „🪶 5 Hähersaat – nach diesem Zyklus 6“. */
export function jaySeedsText(now: number, after: number, allowed: boolean): string {
  const base = `🪶 ${formatNumber(now)} Hähersaat`;
  return allowed && after !== now ? `${base} – nach diesem Zyklus ${formatNumber(after)}` : base;
}

/** Zusatz für einen gebauten Korridor: nur am aktiven Wald und mit Tieren im Bestand des Nachbarn. */
function corridorWildwechsel(game: GameState, ends: readonly [SiteId, SiteId]): string | null {
  const landscape = game.meta.landscape;
  if (!landscape) return null;
  const active = activeSite(landscape);
  if (!ends.includes(active)) return null;
  const from = ends[0] === active ? ends[1] : ends[0];
  const fauna = landscape.sites.find((s) => s.id === from)?.fauna.length ?? 0;
  return corridorWildwechselText(from, fauna);
}

function corridorView(game: GameState, choice: CorridorChoice, available: number): LandscapeCorridorView | null {
  const c = CORRIDORS_BY_ID.get(choice.id);
  if (!c) return null;
  const [a, b] = c.sites;
  const pa = LANDSCAPE_SITES_BY_ID.get(a)?.position ?? { x: 0.5, y: 0.5 };
  const pb = LANDSCAPE_SITES_BY_ID.get(b)?.position ?? { x: 0.5, y: 0.5 };
  let state: CorridorState;
  let note: string;
  if (choice.built) {
    state = 'built';
    note = choice.free ? 'verbunden – Weg der Häher, gratis' : 'verbunden';
  } else if (choice.blocker === null) {
    state = 'buildable';
    note = `${formatNumber(choice.cost)} 🪶`;
  } else if (choice.blocker === 'not-enough-jay-seeds') {
    state = 'unaffordable';
    note = `Kostet ${formatNumber(choice.cost)} 🪶 – du hast ${formatNumber(available)} 🪶.`;
  } else {
    state = 'locked';
    note = `Erst beide Wälder gründen (${formatNumber(choice.cost)} 🪶).`;
  }
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    icon: CORRIDOR_ICONS[c.kind],
    ends: `${siteName(a)} – ${siteName(b)}`,
    text: c.text,
    from: { x: pa.x, y: pa.y },
    to: { x: pb.x, y: pb.y },
    state,
    free: choice.free,
    cost: choice.cost,
    note,
    listed: state !== 'locked',
    wildwechsel: state === 'built' ? corridorWildwechsel(game, c.sites) : null,
  };
}

/** Chronik und Siegel eines Standorts (26.7). */
function siteChronicleFields(state: GameState, id: SiteId): Pick<LandscapeSiteView, 'chronicle' | 'seal'> {
  const view = siteChronicleView(state, id);
  return { chronicle: view ? `Chronik ${chronicleShortText(view)}` : null, seal: view?.keepsake?.icon ?? null };
}

/**
 * Karte der Landschaft – null, solange sie verborgen bleibt (vor der Freischaltung zeigt
 * die Oberfläche nichts davon, 24.1). Sichtbar, sobald sie frei ist oder – im Urwald – nach
 * diesem Neuen Zyklus frei wäre (`unlockedAfter`): dann kann man schon aus diesem Urwald gründen.
 */
export function toLandscapeMapView(state: GameState, preview: NewCyclePreview): LandscapeMapView | null {
  const landscape = preview.landscape;
  // Vorab (nach diesem Zyklus frei) nur aus dem Urwald – dort kann man schon gründen. Im Hain
  // verriete die Karte sonst die Landschaft, bevor der Urwald erreicht ist (Spoiler).
  if (!landscape.unlocked && !(landscape.unlockedAfter && state.stage >= ANCIENT_STAGE)) return null;
  const allowed = preview.blocker === null;
  const activeName = siteName(landscape.active);
  const available = landscape.jaySeeds.available;
  const sites = landscape.sites.map((choice): LandscapeSiteView => {
    const data = LANDSCAPE_SITES_BY_ID.get(choice.id);
    const { gains, costs } = choice.id === 'home' || !data ? { gains: null, costs: null } : splitSiteSummary(data.summary);
    const gift = data?.gift ? data.giftSummary : null;
    return {
      id: choice.id,
      icon: data?.icon ?? '🌳',
      name: data?.name ?? choice.id,
      forestType: data?.forestType ?? '',
      x: data?.position.x ?? 0.5,
      y: data?.position.y ?? 0.5,
      founded: choice.founded,
      active: choice.active,
      ancient: choice.ancient,
      status: siteStatus(choice),
      text: data?.text ?? '',
      memory: siteMemoryText(state, choice, allowed),
      tree: siteTreeText(choice),
      mainTree: choice.mainTree,
      unlockedTrees: choice.unlockedTrees,
      gains,
      costs,
      gift,
      giftActive: gift !== null && choice.founded,
      weather: siteWeatherText(choice.id),
      weatherIcon: siteWeatherIcon(choice.id),
      ...siteEventFields(data),
      habitatNote: siteHabitatNote(choice.id),
      ancientText: choice.founded
        ? choice.ancient
          ? `Hier war schon ${ANCIENT_NAME}.`
          : `Hier war noch kein ${ANCIENT_NAME} – der erste bringt ${formatNumber(JAY_SEEDS_FIRST_ANCIENT)} 🪶.`
        : null,
      action: siteAction(choice),
      blocker: siteBlockerText(choice, activeName, landscape.jaySeedsAfter.available),
      cost: choice.cost,
      ...siteChronicleFields(state, choice.id),
    };
  });
  const corridors = landscapeCorridors(state)
    .map((c) => corridorView(state, c, available))
    .filter((c): c is LandscapeCorridorView => c !== null);
  const hidden = corridors.filter((c) => !c.listed).length;
  return {
    question: 'Wo keimt der nächste Baum?',
    jaySeeds: jaySeedsText(available, landscape.jaySeedsAfter.available, allowed),
    available,
    active: landscape.active,
    allowed,
    sites,
    corridors,
    // Hinweis ohne Korridor nur, wenn am aktiven Wald einer gebaut werden könnte.
    wildwechsel: wildwechselChanceText(
      state,
      corridors.some((c) => c.listed && CORRIDORS_BY_ID.get(c.id)?.sites.includes(landscape.active)),
    ),
    corridorHint:
      hidden > 0
        ? hidden === 1
          ? '1 weiterer Korridor, sobald die Wälder an seinen Enden gegründet sind.'
          : `${formatNumber(hidden)} weitere Korridore, sobald die Wälder an ihren Enden gegründet sind.`
        : null,
    chronicle: chronicleTotalText(state) || null,
  };
}

/** Beschriftung des Knopfs „Neuer Zyklus“ je nach Ziel. */
export function newCycleButtonText(site: LandscapeSiteView | undefined): string {
  if (!site || site.action === 'stay' || site.action === null) return 'Neuen Zyklus beginnen';
  if (site.action === 'found') return `${site.name} gründen (${formatNumber(site.cost ?? 0)} 🪶)`;
  return `Neuen Zyklus beginnen: ${site.name}`;
}

/** Was mit dem Ziel passiert, als Satz unter der Karte. */
export function targetText(site: LandscapeSiteView | undefined, activeName: string): string {
  if (!site || site.action === 'stay' || site.action === null) return `Ziel: ${activeName} – der nächste Baum keimt hier.`;
  if (site.action === 'found')
    return `Ziel: ${site.icon} ${site.name} – neuer Wald für ${formatNumber(site.cost ?? 0)} 🪶. Der Gewinn dieses Zyklus geht noch an ${activeName}.`;
  return `Ziel: ${site.icon} ${site.name} – Wechsel. Der Gewinn dieses Zyklus geht noch an ${activeName}.`;
}

/** Meldung nach dem Bau eines Korridors. */
export function corridorBuiltText(id: string): string {
  const c = CORRIDORS_BY_ID.get(id);
  if (!c) return 'Korridor gebaut.';
  return `${CORRIDOR_ICONS[c.kind]} ${c.name} gebaut: ${siteName(c.sites[0])} und ${siteName(c.sites[1])} sind verbunden.`;
}

/** Meldung nach einer Gründung bzw. einem Wechsel (Zusatz zum Toast des Neuen Zyklus). */
export function siteChangeText(site: SiteId, founded: boolean): string {
  const data = LANDSCAPE_SITES_BY_ID.get(site);
  const name = data ? `${data.icon} ${data.name}` : site;
  return founded ? `🪶 Neuer Wald gegründet: ${name}.` : `Du wächst jetzt in: ${name}.`;
}

/** Name des aktiven Waldes mit Symbol (für Überschriften), z. B. „🌳 Heimatwald“. */
export function activeSiteLabel(state: Pick<GameState, 'meta'>): string {
  const id = state.meta.landscape ? activeSite(state.meta.landscape) : 'home';
  const data = LANDSCAPE_SITES_BY_ID.get(id);
  return data ? `${data.icon} ${data.name}` : id;
}

/**
 * Wetter-Zeile eines Standorts (24.14): Zeichen der Lage mit dem größten Faktor, dann der
 * Kurztext. null ohne Kurztext (Heimatwald).
 */
export function siteWeatherText(id: SiteId): string | null {
  const data = LANDSCAPE_SITES_BY_ID.get(id);
  if (!data?.weatherSummary) return null;
  const icon = siteWeatherIcon(id);
  return icon ? `${icon} ${data.weatherSummary}` : data.weatherSummary;
}

/** Zeichen der Wetterlage mit dem größten Faktor (> 1) eines Standorts; null ohne Kurztext (Heimatwald). */
export function siteWeatherIcon(id: SiteId): string | null {
  const data = LANDSCAPE_SITES_BY_ID.get(id);
  if (!data?.weatherSummary) return null;
  let top: WeatherId | null = null;
  for (const [w, f] of Object.entries(data.weather) as [WeatherId, number][]) {
    if (f > 1 && (top === null || f > data.weather[top]!)) top = w;
  }
  return (top !== null ? WEATHERS_BY_ID.get(top)?.icon : undefined) ?? null;
}

/** Ein Ereignis, das ein Waldtyp öfter erlebt. */
export interface SiteEventHint {
  id: string;
  icon: string;
  name: string;
  /**
   * Schreibt dieses Ereignis das Kapitel „Ereignis des Waldes“ (Playtest Phase 9, F6)? Dann der
   * Titel des Kapitels, wenn er mehr als nur der Name mit Artikel ist („Frühjahrshochwasser“),
   * sonst '' („Das Käferjahr“ ↔ Käferjahr). Fehlt bei allen anderen.
   */
  chapter?: string;
}

/** „Das Käferjahr“ → „käferjahr“: Titel ohne Artikel, zum Vergleich mit dem Namen des Ereignisses. */
const bareTitle = (title: string) => title.replace(/^(der|die|das)\s+/i, '').trim().toLowerCase();

/**
 * Ereignisse, die ein Waldtyp öfter erlebt (Phase 9, 1c; DESIGN_V2.md 26.2): alle mit Faktor > 1 in
 * `eventFactors`, in der Reihenfolge der Daten. Symbol und Name aus den Ereignis-Daten; unbekannte
 * IDs und ungültige Faktoren werden übergangen. Leer ohne Faktor (Heimatwald, Bergmischwald).
 */
type EventSite = Pick<ForestSite, 'eventFactors'> & Partial<Pick<ForestSite, 'chronicleEvent' | 'chronicleEventTitle'>>;

export function siteEventHints(site: EventSite | undefined): SiteEventHint[] {
  const hints: SiteEventHint[] = [];
  for (const [id, factor] of Object.entries(site?.eventFactors ?? {})) {
    const event = EVENTS_BY_ID.get(id);
    if (!event || !Number.isFinite(factor) || factor <= 1) continue;
    const hint: SiteEventHint = { id, icon: event.icon, name: event.name };
    if (site?.chronicleEvent === id) {
      const title = site.chronicleEventTitle ?? '';
      hint.chapter = title && bareTitle(title) !== bareTitle(event.name) ? title : '';
    }
    hints.push(hint);
  }
  return hints;
}

/** Ein Ereignis als Text; das Ereignis des Waldes mit „(📜 Kapitel „Frühjahrshochwasser“)“ (F6). */
function eventHintText(h: SiteEventHint): string {
  const base = `${h.icon} ${h.name}`;
  if (h.chapter === undefined) return base;
  return h.chapter ? `${base} (📜 Kapitel „${h.chapter}“)` : `${base} (📜 Kapitel)`;
}

/**
 * „🌧️ Regenreicher Frühling (📜 Kapitel „Frühjahrshochwasser“), 🐌 Schneckenjahr“ – null ohne
 * häufigere Ereignisse.
 */
export function siteEventText(site: EventSite | undefined): string | null {
  const hints = siteEventHints(site);
  return hints.length > 0 ? hints.map(eventHintText).join(', ') : null;
}

function siteEventFields(site: ForestSite | undefined): Pick<LandscapeSiteView, 'events' | 'eventIcons'> {
  const hints = siteEventHints(site);
  return hints.length > 0
    ? { events: siteEventText(site), eventIcons: hints.map((h) => h.icon).join('') }
    : { events: null, eventIcons: null };
}

/** Was ein Merkmal bedeutet, das ein Standort immer bietet (nur bekannte; Playtest Phase 7, K7). */
const HABITAT_NOTES: Partial<Record<Tag, string>> = {
  feucht:
    '💧 Feuchte heißt: Der Boden ist hier immer nass – Tiere, die sich Feuchte wünschen, finden sie auch ohne Moos, Farn oder Waldtümpel.',
};

/** Erklärung zu den Merkmalen eines Standorts (z. B. „Feuchte“ im Auwald); null, wenn keine. */
export function siteHabitatNote(id: SiteId): string | null {
  const data = LANDSCAPE_SITES_BY_ID.get(id);
  const notes = (data?.habitats ?? []).map((t) => HABITAT_NOTES[t]).filter((n): n is string => !!n);
  return notes.length > 0 ? notes.join(' ') : null;
}
