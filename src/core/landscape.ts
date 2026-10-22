import {
  CORRIDORS,
  CORRIDORS_BY_ID,
  CORRIDOR_INFLOW,
  CORRIDOR_INFLOW_CAP,
  FOUNDING_COSTS,
  HOME_SITE,
  JAY_SEEDS_FIRST_ANCIENT,
  JAY_SEEDS_MEMORY_STEP,
  LANDSCAPE_SITES_BY_ID,
  LANDSCAPE_UNLOCK_ACHIEVEMENT,
  LANDSCAPE_UNLOCK_MEMORY,
  WILDWECHSEL_CHANCE,
  WILDWECHSEL_MAX_CHANCE,
  type Corridor,
  type SiteId,
} from '../content/landscape';
import { STAGES } from '../content/stages';
import type { Genus, Tag } from '../content/types';
import type { TreeTrait } from '../content/trees';
import { MAX_FOREST_MEMORY, createLandscape, type GameState, type LandscapeSite, type LandscapeState } from './state';

/*
 * Waldlandschaft (DESIGN_V2.md 24): abgeleitete Werte über `meta.landscape` – reine
 * Funktionen ohne Zufall und Uhr. Die Aktionen (Gründen, Wechseln, Korridor bauen) stehen in
 * tick.ts (startNewCycle, buildCorridor), das Laden in save.ts.
 *
 * Eine Wahrheit je Wert: Gedächtnis und Stammgäste des aktiven Waldes stehen in
 * `meta.forestMemory` bzw. `meta.regulars`; ruhende Wälder halten ihre in `sites[]`.
 * Freischaltung, Hähersaat, wirksames Gedächtnis und Gaben sind abgeleitet (kein Feld).
 */

/** Index der Stufe „Urwald“ in STAGES (Hähersaat für den ersten Urwald, Gründen). */
export const ANCIENT_STAGE = STAGES.findIndex((s) => s.id === 'ancient-forest');

/** Was die Funktionen hier vom Spielstand brauchen. */
export type LandscapeHolder = Pick<GameState, 'stage'> & { meta: Pick<GameState['meta'], 'forestMemory' | 'achievements'> & { landscape?: LandscapeState } };

/** Die Landschaft eines Spielstands; fehlt sie (Teil-Stände in Vorschauen), nur der Heimatwald. */
export function landscapeOf(state: { meta: { landscape?: LandscapeState } }): LandscapeState {
  return state.meta.landscape ?? DEFAULT_LANDSCAPE;
}

const DEFAULT_LANDSCAPE: LandscapeState = createLandscape();

/** Zahl in [0, MAX_FOREST_MEMORY]; NaN, ±Infinity und Unsinn → 0 (wie evaluate vor v14). */
function clampMemory(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_FOREST_MEMORY, Math.max(0, value)) : 0;
}

/**
 * Der aktive Wald – steht `active` nicht unter den gegründeten Wäldern (nur bei kaputten
 * Ständen zur Laufzeit; das Laden repariert das), gilt der Heimatwald, wie beim Laden.
 */
export function activeSite(landscape: LandscapeState): SiteId {
  return siteEntry(landscape, landscape.active) ? landscape.active : HOME_SITE;
}

/** Die Meldung zur Freischaltung (24.3) steht noch aus: freigeschaltet, aber noch nicht gezeigt. */
export function landscapeAnnouncementDue(state: Pick<LandscapeHolder, 'meta'>): boolean {
  return landscapeUnlocked(state) && !landscapeOf(state).announced;
}

/** Eintrag eines gegründeten Waldes (undefined = nicht gegründet). */
export function siteEntry(landscape: LandscapeState, id: SiteId): LandscapeSite | undefined {
  return landscape.sites.find((s) => s.id === id);
}

/** Ist dieser Wald gegründet? */
export function isSiteFounded(state: { meta: { landscape?: LandscapeState } }, id: SiteId): boolean {
  return siteEntry(landscapeOf(state), id) !== undefined;
}

/** Eigenes Waldgedächtnis eines Waldes (aktiv: `meta.forestMemory`; nicht gegründet: 0). */
export function ownMemory(state: Pick<LandscapeHolder, 'meta'>, id: SiteId): number {
  const landscape = landscapeOf(state);
  if (id === activeSite(landscape)) return clampMemory(state.meta.forestMemory);
  return clampMemory(siteEntry(landscape, id)?.memory ?? 0);
}

/** Korridor zwischen zwei Standorten (falls es in CORRIDORS einen gibt). */
export function corridorBetween(a: SiteId, b: SiteId): Corridor | undefined {
  if (a === b) return undefined;
  return CORRIDORS.find((c) => c.sites.includes(a) && c.sites.includes(b));
}

/** Der andere Standort eines Korridors. */
function otherEnd(c: Corridor, id: SiteId): SiteId {
  return c.sites[0] === id ? c.sites[1] : c.sites[0];
}

/** Gebaute Korridore an einem Wald (bekannte IDs, je einmal). */
export function builtCorridorsAt(landscape: LandscapeState, id: SiteId): Corridor[] {
  const out: Corridor[] = [];
  for (const cid of new Set(landscape.corridors)) {
    const c = CORRIDORS_BY_ID.get(cid);
    if (c && c.sites.includes(id)) out.push(c);
  }
  return out;
}

/**
 * Wirksames Gedächtnis eines Waldes (24.6): eigenes + Zufluss über gebaute Korridore,
 * `min(MAX_FOREST_MEMORY, eigenes + ⌊min(CORRIDOR_INFLOW_CAP, CORRIDOR_INFLOW · Σ Nachbarn)⌋)`.
 * Nachbarn zählen mit ihrem **eigenen** Gedächtnis (kein Zufluss über zwei Ecken). Abgerundet
 * wird nur der Zufluss – ohne Korridor ist es genau das eigene Gedächtnis (wie vor v14).
 * `memoryOf` ersetzt das eigene Gedächtnis einzelner Wälder (Vorschau nach dem Neuen Zyklus).
 */
export function effectiveMemoryOf(
  state: Pick<LandscapeHolder, 'meta'>,
  id: SiteId,
  memoryOf: (site: SiteId) => number = (site) => ownMemory(state, site),
  corridors: readonly Corridor[] = builtCorridorsAt(landscapeOf(state), id),
): number {
  let flow = 0;
  for (const c of corridors) flow += CORRIDOR_INFLOW * memoryOf(otherEnd(c, id));
  const inflow = Math.floor(Math.min(CORRIDOR_INFLOW_CAP, Math.max(0, flow)));
  return Math.min(MAX_FOREST_MEMORY, memoryOf(id) + inflow);
}

/**
 * Wirksames Gedächtnis des aktiven Waldes – es ersetzt `meta.forestMemory` überall, wo das
 * Gedächtnis wirkt: Faktor auf 🌿 und 🌰 (ecosystemOf) und Stammgast-Plätze (regularSlotsOf).
 * Gewinn beim Neuen Zyklus und Hähersaat rechnen mit dem eigenen.
 */
export function effectiveForestMemory(state: Pick<LandscapeHolder, 'meta'>): number {
  return effectiveMemoryOf(state, activeSite(landscapeOf(state)));
}

/** Zählt der Wald als „schon einmal Urwald“? Beim aktiven auch, sobald die Stufe Urwald erreicht ist. */
export function isSiteAncient(state: LandscapeHolder, id: SiteId): boolean {
  const landscape = landscapeOf(state);
  const entry = siteEntry(landscape, id);
  if (!entry) return false;
  return entry.ancient || (id === activeSite(landscape) && state.stage >= ANCIENT_STAGE);
}

/** 🪶 Hähersaat (24.4): verdient, ausgegeben, verfügbar. */
export interface JaySeeds {
  earned: number;
  spent: number;
  /** verdient − ausgegeben, nie unter 0 (nur ein manipulierter Stand könnte darunter liegen). */
  available: number;
}

/** Hähersaat, die ein Wald einbringt: 1 je volle 100 eigenes Gedächtnis, +2 für den ersten Urwald. */
export function jaySeedsOfSite(memory: number, ancient: boolean): number {
  return Math.floor(clampMemory(memory) / JAY_SEEDS_MEMORY_STEP) + (ancient ? JAY_SEEDS_FIRST_ANCIENT : 0);
}

/** Kosten aller Gründungen und gekauften Korridore einer Landschaft (abgeleitet). */
export function jaySeedsSpent(landscape: LandscapeState): number {
  let spent = 0;
  for (let i = 1; i < landscape.sites.length; i++) spent += FOUNDING_COSTS[i - 1] ?? Infinity;
  const free = new Set(landscape.freeCorridors);
  for (const id of new Set(landscape.corridors)) {
    if (!free.has(id)) spent += CORRIDORS_BY_ID.get(id)?.cost ?? 0;
  }
  return spent;
}

/**
 * Hähersaat (24.4) – abgeleitet, kein Zähler: verdient = Σ über gegründete Wälder
 * (⌊eigenes Gedächtnis / 100⌋ + 2 für den ersten Urwald), ausgegeben = Gründungen + gekaufte
 * Korridore. `memoryOf` ersetzt das eigene Gedächtnis (Vorschau nach dem Neuen Zyklus),
 * `ancientOf` das Urwald-Merkmal.
 */
export function jaySeeds(
  state: LandscapeHolder,
  memoryOf: (site: SiteId) => number = (site) => ownMemory(state, site),
  ancientOf: (site: SiteId) => boolean = (site) => isSiteAncient(state, site),
): JaySeeds {
  const landscape = landscapeOf(state);
  let earned = 0;
  for (const s of landscape.sites) earned += jaySeedsOfSite(memoryOf(s.id), ancientOf(s.id));
  const spent = jaySeedsSpent(landscape);
  return { earned, spent, available: Math.max(0, earned - spent) };
}

/**
 * Freischaltung der Landschaft (24.3): Erfolg „Uralt und voller Leben“ und mindestens
 * LANDSCAPE_UNLOCK_MEMORY eigenes Gedächtnis im Heimatwald. Beides wird nie kleiner –
 * abgeleitet, kein Feld. `homeMemory` ersetzt das Gedächtnis des Heimatwalds (Vorschau),
 * `ancient` zählt den Erfolg als schon erreicht.
 */
export function landscapeUnlocked(
  state: Pick<LandscapeHolder, 'meta'>,
  homeMemory: number = ownMemory(state, HOME_SITE),
  ancient = false,
): boolean {
  return (ancient || state.meta.achievements.includes(LANDSCAPE_UNLOCK_ACHIEVEMENT)) && homeMemory >= LANDSCAPE_UNLOCK_MEMORY;
}

/** Kosten der nächsten Gründung (null = alle Wälder gegründet). */
export function nextFoundingCost(landscape: LandscapeState): number | null {
  if (landscape.sites.length >= LANDSCAPE_SITES_BY_ID.size) return null;
  return FOUNDING_COSTS[landscape.sites.length - 1] ?? null;
}

/** Gegründete Wälder, deren Gabe wirkt (alle gegründeten; der Heimatwald hat keine). */
export function giftSites(landscape: LandscapeState): SiteId[] {
  return landscape.sites.map((s) => s.id);
}

/**
 * Eigenheiten des Standorts `site` und Gaben der Wälder `gifts` – dieselben Typen wie die
 * Eigenheiten der Hauptbaum-Arten (24.2), darum rechnet formulas.ts sie an derselben Stelle.
 * Unbekannte IDs zählen nicht; jede Gabe höchstens einmal.
 */
export function landscapeTraits(site: SiteId | undefined, gifts: readonly SiteId[] = []): TreeTrait[] {
  const out: TreeTrait[] = [];
  if (site !== undefined) out.push(...(LANDSCAPE_SITES_BY_ID.get(site)?.traits ?? []));
  for (const id of new Set(gifts)) {
    const gift = LANDSCAPE_SITES_BY_ID.get(id)?.gift;
    if (gift) out.push(gift);
  }
  return out;
}

/** Merkmale, die der Standort immer bereitstellt (je 1 Einheit wie `cycle.habitats`). */
export function siteHabitats(site: SiteId | undefined): readonly Tag[] {
  return site !== undefined ? (LANDSCAPE_SITES_BY_ID.get(site)?.habitats ?? []) : [];
}

/** Gattungen, die im aktiven Wald häufiger als Karte kommen (`featured`, 24.6; Heimatwald: keine). */
export function featuredGenera(state: { meta: { landscape?: LandscapeState } }): readonly Genus[] {
  return LANDSCAPE_SITES_BY_ID.get(activeSite(landscapeOf(state)))?.featured ?? [];
}

/**
 * Chance, dass eine Tierbegegnung eine Wildwechsel-Karte zeigt (24.6):
 * `min(WILDWECHSEL_MAX_CHANCE, WILDWECHSEL_CHANCE · gebaute Korridore am aktiven Wald)`.
 * Ohne Korridor 0 – dann wird auch nicht gewürfelt (der Zufall läuft wie vor Schritt B).
 */
export function wildwechselChance(state: { meta: { landscape?: LandscapeState } }): number {
  const landscape = landscapeOf(state);
  const corridors = builtCorridorsAt(landscape, activeSite(landscape)).length;
  return Math.min(WILDWECHSEL_MAX_CHANCE, WILDWECHSEL_CHANCE * corridors);
}

/** Weg einer Art über einen Korridor: woher sie kommt und über welchen Korridor. */
export interface WildwechselRoute {
  species: string;
  /** Der ruhende Nachbarwald, in dessen Bestand (`fauna`) die Art lebt. */
  from: SiteId;
  /** ID des Korridors (CORRIDORS_BY_ID: Name und Art für „kommt über die Schlehenhecke“). */
  corridor: string;
}

/**
 * Alle Arten, die über gebaute Korridore aus dem Bestand (`fauna`) der Nachbarn kommen
 * können – je Art einmal, mit dem ersten Weg (Korridore in Bau-Reihenfolge, Bestand in
 * gespeicherter Reihenfolge). Ohne Regeln zu Stufe, Nische und Ökosystem (die prüft tick.ts
 * beim Ziehen). Reine Ableitung, kein Zufall.
 */
export function wildwechselRoutes(state: { meta: { landscape?: LandscapeState } }): WildwechselRoute[] {
  const landscape = landscapeOf(state);
  const active = activeSite(landscape);
  const out: WildwechselRoute[] = [];
  const seen = new Set<string>();
  for (const corridor of builtCorridorsAt(landscape, active)) {
    const from = otherEnd(corridor, active);
    for (const species of siteEntry(landscape, from)?.fauna ?? []) {
      if (seen.has(species)) continue;
      seen.add(species);
      out.push({ species, from, corridor: corridor.id });
    }
  }
  return out;
}

/**
 * Über welchen Korridor eine Art in den aktiven Wald kommen kann (null: über keinen) –
 * für die Anzeige einer Karte nach dem Neuladen. Achtung: Auch eine gewöhnlich gezogene
 * Karte einer Art aus dem Bestand eines Nachbarn hat einen Weg; welche Karte wirklich als
 * Wildwechsel kam, meldet nur `TickReport.wildwechsel`.
 */
export function wildwechselRoute(state: { meta: { landscape?: LandscapeState } }, species: string): WildwechselRoute | null {
  return wildwechselRoutes(state).find((r) => r.species === species) ?? null;
}
