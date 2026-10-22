import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, type Achievement, type AchievementCondition, type AchievementTarget } from '../content/achievements';
import { COMMUNITIES, COMMUNITIES_BY_ID } from '../content/communities';
import { CORRIDORS, CORRIDORS_BY_ID, LANDSCAPE_SITES_BY_ID, SITE_IDS, type SiteId } from '../content/landscape';
import { PLANTS, PLANTS_BY_ID } from '../content/plants';
import { SPECIES, SPECIES_BY_ID } from '../content/species';
import { MAIN_TREES, MAIN_TREES_BY_ID, type MainTreeId } from '../content/trees';
import { GENERA } from '../content/types';
import { isSiteAncient, landscapeOf, landscapeUnlocked } from './landscape';
import type { GameState } from './state';

/*
 * Erfolge (DESIGN_V2.md 18): Auswertung der deklarativen Bedingungen aus
 * content/achievements.ts. Reine Funktionen über den Spielstand – kein Zufall, keine Uhr.
 *
 * Wann geprüft wird: `checkAchievements` ist billig (ein Durchlauf über ~25 Einträge, keine
 * Auswertung des Ökosystems) und darf beliebig oft laufen. main.ts ruft sie nach jeder
 * Aktion und gedrosselt nach Ticks auf; startNewCycle prüft selbst vor dem Zurücksetzen
 * (Stufe und Spielzeit des Zyklus beginnen neu), das Laden bei der Migration v8 → v9.
 * Weil alle Bedingungen während eines Zyklus nur wachsen können, ergeben viele kleine Ticks
 * mit Prüfungen dazwischen und ein großer Offline-Tick mit einer Prüfung danach dieselben
 * Erfolge (online = offline). Nur die Reihenfolge gleichzeitig freigeschalteter Erfolge
 * folgt ACHIEVEMENTS.
 */

/** Fortschritt eines Erfolgs: aktueller Wert (endlich, ≥ 0) und Ziel (> 0). */
export interface AchievementProgress {
  value: number;
  target: number;
}

/** Anzahl, auf die ein Ziel „alle“ hinausläuft (aktuelle Inhalte). */
export function targetOf(condition: AchievementCondition): number {
  const all = (target: AchievementTarget, total: number) => (target === 'all' ? total : target);
  switch (condition.kind) {
    case 'journal':
      return all(condition.atLeast, condition.what === 'species' ? SPECIES.length : condition.what === 'plants' ? PLANTS.length : COMMUNITIES.length);
    case 'genera':
      return all(condition.atLeast, GENERA.length);
    case 'trees':
      return all(condition.atLeast, MAIN_TREES.length);
    case 'forests':
    case 'ancientForests':
      return all(condition.atLeast, SITE_IDS.length);
    case 'corridors':
      return all(condition.atLeast, CORRIDORS.length);
    default:
      return condition.atLeast;
  }
}

/** Zahl ≥ 0 (NaN, negativ, keine Zahl → 0; +Infinity bleibt). */
const safe = (n: unknown): number => (typeof n === 'number' && n > 0 ? n : 0);

/** Wie viele IDs bekannt sind (je einmal) – kaputte Listen zählen nicht doppelt. */
function knownCount(ids: readonly string[] | undefined, known: ReadonlyMap<string, unknown>): number {
  return Array.isArray(ids) ? new Set(ids.filter((id) => known.has(id))).size : 0;
}

/** Zusätzliches Wissen für die Prüfung, ohne den Spielstand zu verfälschen. */
export interface AchievementCheckOptions {
  /**
   * Stufe, die nachweislich schon erreicht war (z. B. NEW_CYCLE_MIN_STAGE ab Zyklus 2 –
   * ein Neuer Zyklus setzt diese Stufe voraus). Zählt für `stage` wie die aktuelle Stufe.
   */
  minStage?: number;
}

/** Aktueller Wert einer Bedingung im Spielstand. */
export function valueOf(state: GameState, condition: AchievementCondition, options: AchievementCheckOptions = {}): number {
  const journal = state.meta.journal;
  switch (condition.kind) {
    case 'stage':
      return Math.max(safe(state.stage), safe(options.minStage));
    case 'journal':
      if (condition.what === 'species') return knownCount(journal.species, SPECIES_BY_ID);
      if (condition.what === 'plants') return knownCount(journal.plants, PLANTS_BY_ID);
      return knownCount(journal.communities, COMMUNITIES_BY_ID);
    case 'genera': {
      const genera = new Set<string>();
      for (const id of journal.species ?? []) {
        const genus = SPECIES_BY_ID.get(id)?.genus;
        if (genus) genera.add(genus);
      }
      return genera.size;
    }
    case 'stat': {
      const value = safe(state.meta.stats[condition.key]);
      // Harmonie gerundet wie in der Anzeige: „119,6“ steht dort als 120.
      return condition.key === 'bestHarmony' && Number.isFinite(value) ? Math.round(value) : value;
    }
    case 'cycles':
      return safe(state.cycle.number - 1);
    case 'trees':
      return knownCount(state.meta.stats.grownTrees as MainTreeId[], MAIN_TREES_BY_ID);
    case 'cycleTime':
      return safe(state.cycle.elapsed);
    case 'forests':
      return foundedSites(state).length;
    case 'corridors': {
      const corridors = landscapeOf(state).corridors;
      if (!condition.bought) return knownCount(corridors, CORRIDORS_BY_ID);
      const free = new Set(landscapeOf(state).freeCorridors);
      return knownCount(Array.isArray(corridors) ? corridors.filter((id) => !free.has(id)) : [], CORRIDORS_BY_ID);
    }
    case 'ancientForests':
      return foundedSites(state).filter((id) => isSiteAncient(state, id)).length;
  }
}

/** Gegründete Wälder der Landschaft: bekannte Standort-IDs, je einmal (fehlt sie: Heimatwald). */
function foundedSites(state: GameState): SiteId[] {
  const sites = landscapeOf(state).sites;
  if (!Array.isArray(sites)) return [];
  const ids = new Set<SiteId>();
  for (const s of sites) if (s && LANDSCAPE_SITES_BY_ID.has(s.id)) ids.add(s.id);
  return [...ids];
}

/** Fortschritt eines Erfolgs, Wert auf das Ziel begrenzt (für „3/5“ in der Anzeige). */
export function achievementProgress(state: GameState, achievement: Achievement): AchievementProgress {
  const target = targetOf(achievement.condition);
  return { value: Math.min(valueOf(state, achievement.condition), target), target };
}

/** Ist die Bedingung jetzt erfüllt? (Unabhängig davon, ob der Erfolg schon freigeschaltet ist.) */
export function isAchieved(state: GameState, achievement: Achievement, options: AchievementCheckOptions = {}): boolean {
  return valueOf(state, achievement.condition, options) >= targetOf(achievement.condition);
}

/** Ist dieser Erfolg schon freigeschaltet? */
export function hasAchievement(state: GameState, id: string): boolean {
  return state.meta.achievements.includes(id);
}

/**
 * Darf der Erfolg im Naturtagebuch erscheinen (24.12)? Erfolge mit `requires: 'landscape'`
 * bleiben bis zur Freischaltung der Landschaft verborgen – außer sie sind schon
 * freigeschaltet. Die Prüfung (checkAchievements) hängt nicht daran.
 */
export function isAchievementVisible(state: GameState, a: Achievement): boolean {
  return !a.requires || landscapeUnlocked(state) || hasAchievement(state, a.id);
}

/**
 * Schaltet alle Erfolge frei, deren Bedingung jetzt erfüllt ist, und gibt die neuen IDs
 * zurück (in ACHIEVEMENTS-Reihenfolge). Hängt sie an `meta.achievements` an; schon
 * freigeschaltete bleiben, auch wenn ihre Bedingung nicht mehr gilt (z. B. Stufe nach dem
 * Neuen Zyklus). Deterministisch und idempotent. `options.minStage` ergänzt eine schon
 * nachweislich erreichte Stufe (Nachtragen beim Laden), ohne den Spielstand zu ändern.
 */
export function checkAchievements(state: GameState, options: AchievementCheckOptions = {}): string[] {
  const unlocked = state.meta.achievements;
  if (unlocked.length >= ACHIEVEMENTS.length) return [];
  const have = new Set(unlocked);
  const fresh: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!have.has(a.id) && isAchieved(state, a, options)) fresh.push(a.id);
  }
  unlocked.push(...fresh);
  return fresh;
}

/** Freigeschaltete Erfolge als Inhalte (unbekannte IDs übersprungen), in Freischalt-Reihenfolge. */
export function unlockedAchievements(state: GameState): Achievement[] {
  return state.meta.achievements.map((id) => ACHIEVEMENTS_BY_ID.get(id)).filter((a): a is Achievement => !!a);
}
