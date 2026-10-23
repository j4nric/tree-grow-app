/**
 * Tagebuch der Wälder im Album-Reiter „Landschaft“ (DESIGN_V2.md 24.3, 24.11): je gegründetem Wald Name,
 * Waldtyp, Gedächtnis eigen/wirksam, Urwald ja/nein, Leitbaum, Wetter, Stammgäste und Tiere; dazu die
 * gebauten Korridore und die Hähersaat-Bilanz.
 *
 * Reine Funktionen ohne DOM – getestet in tests/journal-landscape.test.ts. Alle Werte kommen
 * lesend aus core/ (landscape.ts); hier stehen nur Texte und Reihenfolge. Vor der
 * Freischaltung gibt es keine Ansicht (null) – der Reiter bleibt verborgen (Spoiler-Regel).
 */
import {
  CORRIDORS,
  CORRIDORS_BY_ID,
  JAY_SEEDS_FIRST_ANCIENT,
  JAY_SEEDS_MEMORY_STEP,
  LANDSCAPE_SITES,
  LANDSCAPE_SITES_BY_ID,
  type SiteId,
} from '../content/landscape';
import { SPECIES, SPECIES_BY_ID } from '../content/species';
import { STAGES } from '../content/stages';
import { MAIN_TREES, MAIN_TREES_BY_ID, type MainTreeId } from '../content/trees';
import {
  activeSite,
  effectiveMemoryOf,
  isSiteAncient,
  jaySeeds,
  landscapeOf,
  landscapeUnlocked,
  ownMemory,
} from '../core/landscape';
import { allAnimals, type GameState, type LandscapeSite } from '../core/state';
import { formatNumber } from './format';
import { CORRIDOR_ICONS, siteWeatherText } from './landscape-view';
import { RARITY_LABELS } from './view-format';
import type {
  JournalCorridorView,
  JournalLandscapeRowView,
  JournalLandscapeView,
  JournalSiteView,
  Rarity,
} from './view-model';

/** Höchstens so viele Tiere nennt der Reiter je Wald – der Rest als „und N weitere“. */
export const FAUNA_HIGHLIGHTS = 4;

const ANCIENT_NAME = STAGES[STAGES.length - 1]?.name ?? 'Urwald';
const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'special', 'legendary'];
const SPECIES_ORDER = new Map(SPECIES.map((s, i) => [s.id, i]));

const siteName = (id: SiteId) => LANDSCAPE_SITES_BY_ID.get(id)?.name ?? id;

/** Symbol und Name einer Hauptbaum-Art (unbekannt: Eiche). */
function treeName(id: MainTreeId | null | undefined): string {
  const tree = (id && MAIN_TREES_BY_ID.get(id)) || MAIN_TREES[0]!;
  return `${tree.icon} ${tree.name}`;
}

/** „Rotkehlchen, Igel und Dachs“ – nur bekannte Namen. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/**
 * Tier-Höhepunkte eines Waldes: entdeckte Arten (Spoiler-Regel), je einmal, die seltensten
 * zuerst (bei gleicher Seltenheit in Tagebuch-Reihenfolge), höchstens FAUNA_HIGHLIGHTS mit
 * Seltenheit in Klammern (außer „gewöhnlich“), der Rest als „und N weitere“. null = keine.
 */
export function faunaHighlightsText(ids: readonly string[], discovered: readonly string[]): string | null {
  const known = new Set(discovered);
  const species = [...new Set(ids)]
    .filter((id) => known.has(id))
    .map((id) => SPECIES_BY_ID.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
  if (species.length === 0) return null;
  species.sort((a, b) => b.rarity - a.rarity || (SPECIES_ORDER.get(a.id) ?? 0) - (SPECIES_ORDER.get(b.id) ?? 0));
  const shown = species.slice(0, FAUNA_HIGHLIGHTS).map((s) => {
    const rarity = RARITY_ORDER[s.rarity] ?? 'common';
    return rarity === 'common' ? s.name : `${s.name} (${RARITY_LABELS[rarity]})`;
  });
  const rest = species.length - shown.length;
  if (rest <= 0) return joinNames(shown);
  return `${shown.join(', ')} und ${formatNumber(rest)} ${rest === 1 ? 'weitere Art' : 'weitere Arten'}`;
}

/** Stammgäste als Namensliste (nur bekannte Arten); „keine“, wenn leer. */
export function regularsText(ids: readonly string[]): string {
  const names = [...new Set(ids)].map((id) => SPECIES_BY_ID.get(id)?.name).filter((n): n is string => !!n);
  return names.length > 0 ? joinNames(names) : 'keine';
}

/** Gedächtnis eigen/wirksam, z. B. „120 eigen · 270 wirksam“. */
export function memoryText(own: number, effective: number): string {
  return `${formatNumber(own)} eigen · ${formatNumber(effective)} wirksam`;
}

function siteView(state: GameState, entry: LandscapeSite, active: SiteId): JournalSiteView {
  const data = LANDSCAPE_SITES_BY_ID.get(entry.id);
  const isActive = entry.id === active;
  const ancient = isSiteAncient(state, entry.id);
  const weather = siteWeatherText(entry.id);
  const rows: JournalLandscapeRowView[] = [
    { key: 'memory', label: 'Waldgedächtnis', value: memoryText(ownMemory(state, entry.id), effectiveMemoryOf(state, entry.id)) },
    {
      key: 'ancient',
      label: ANCIENT_NAME,
      value: ancient
        ? 'ja – hier war schon Urwald'
        : `noch nicht – der erste bringt ${formatNumber(JAY_SEEDS_FIRST_ANCIENT)} 🪶`,
    },
    { key: 'lead', label: 'Leitbaum', value: treeName(data?.leadTree) },
    // Wetter des Waldtyps (24.14) – der Heimatwald hat kein eigenes.
    ...(weather ? [{ key: 'weather', label: 'Wetter', value: weather }] : []),
    isActive
      ? { key: 'tree', label: 'Hauptbaum jetzt', value: treeName(state.cycle.mainTree) }
      : { key: 'tree', label: 'Zuletzt gewachsen', value: treeName(entry.mainTree) },
    // Stammgäste des aktiven Waldes stehen in meta.regulars, die ruhender im Eintrag (24.8).
    { key: 'regulars', label: 'Stammgäste', value: regularsText(isActive ? state.meta.regulars : entry.regulars) },
  ];
  // Tiere: im aktiven Wald der laufende Bestand, sonst der beim letzten Verlassen.
  const fauna = faunaHighlightsText(isActive ? allAnimals(state) : entry.fauna, state.meta.journal.species);
  if (fauna) rows.push({ key: 'fauna', label: isActive ? 'Lebt gerade hier' : 'Zuletzt gesehen', value: fauna });
  return {
    id: entry.id,
    icon: data?.icon ?? '🌳',
    name: data?.name ?? entry.id,
    forestType: data?.forestType ?? '',
    active: isActive,
    ancient,
    rows,
  };
}

function corridorView(id: string, free: ReadonlySet<string>): JournalCorridorView | null {
  const c = CORRIDORS_BY_ID.get(id);
  if (!c) return null;
  return {
    id: c.id,
    icon: CORRIDOR_ICONS[c.kind],
    name: c.name,
    ends: `${siteName(c.sites[0])} – ${siteName(c.sites[1])}`,
    note: free.has(c.id) ? 'mit der Gründung, gratis' : `gebaut für ${formatNumber(c.cost)} 🪶`,
  };
}

/**
 * Reiter „Landschaft“ – null, solange die Landschaft nicht freigeschaltet ist (24.3). Die
 * Freischaltung wird nie zurückgenommen, der Reiter verschwindet also nicht wieder.
 */
export function toJournalLandscapeView(state: GameState): JournalLandscapeView | null {
  if (!landscapeUnlocked(state)) return null;
  const landscape = landscapeOf(state);
  const active = activeSite(landscape);
  const seen = new Set<SiteId>();
  const sites = landscape.sites
    .filter((s) => LANDSCAPE_SITES_BY_ID.has(s.id) && !seen.has(s.id) && (seen.add(s.id), true))
    .map((s) => siteView(state, s, active));
  const free = new Set(landscape.freeCorridors);
  const corridors = [...new Set(landscape.corridors)]
    .map((id) => corridorView(id, free))
    .filter((c): c is JournalCorridorView => c !== null);
  const seeds = jaySeeds(state);
  const missing = LANDSCAPE_SITES.length - sites.length;
  return {
    summary:
      `${formatNumber(sites.length)} von ${formatNumber(LANDSCAPE_SITES.length)} Wäldern gegründet · ` +
      `${formatNumber(corridors.length)} von ${formatNumber(CORRIDORS.length)} Korridoren`,
    jaySeeds: [
      { key: 'earned', label: 'Verdient', value: `${formatNumber(seeds.earned)} 🪶` },
      { key: 'spent', label: 'Ausgegeben', value: `${formatNumber(seeds.spent)} 🪶` },
      { key: 'available', label: 'Verfügbar', value: `${formatNumber(seeds.available)} 🪶` },
    ],
    jaySeedsNote:
      `Jeder Wald bringt 1 🪶 je ${formatNumber(JAY_SEEDS_MEMORY_STEP)} eigenes Waldgedächtnis und ` +
      `${formatNumber(JAY_SEEDS_FIRST_ANCIENT)} 🪶 für seinen ersten ${ANCIENT_NAME}. Gründen und Korridore kosten Hähersaat.`,
    sites,
    corridors,
    sitesHint:
      missing > 0
        ? `${missing === 1 ? 'Ein Wald wartet' : `${formatNumber(missing)} Wälder warten`} noch – tippe auf der Karte auf einen Standort und wähle ihn als Ziel des nächsten Zyklus.`
        : null,
  };
}
