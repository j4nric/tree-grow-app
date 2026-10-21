/**
 * View-Model für die Jahreszeit (DESIGN_V2.md 16.6, Darstellung): Abzeichen in der
 * Kopfzeile („🍂 Herbst · noch 1:20 min“, Kurzform der Wirkungen als Tooltip) und der
 * kurze Hinweis beim Wechsel. Reine Funktionen ohne DOM – testbar mit Vitest.
 */
import { SEASONS_BY_ID, type SeasonId } from '../content/seasons';
import { seasonAt, secondsToNextSeason } from '../core/season';

export interface SeasonBadgeView {
  id: SeasonId;
  icon: string;
  name: string;
  /** z. B. „🍂 Herbst · noch 1:20 min“. */
  text: string;
  /** Wirkungen in Kurzform (Tooltip), z. B. „+20 % 🌰 · Pilze +15 % 😊“. */
  title: string;
}

/** Restzeit als „m:ss min“ (aufgerundet auf ganze Sekunden), z. B. 80 → „1:20 min“. */
export function seasonTimeLeft(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
}

/** Abzeichen zur Spielzeit des Zyklus. */
export function toSeasonBadgeView(elapsed: number): SeasonBadgeView {
  const season = seasonAt(elapsed);
  const left = secondsToNextSeason(elapsed);
  const rest = Number.isFinite(left) ? ` · noch ${seasonTimeLeft(left)}` : '';
  return {
    id: season.id,
    icon: season.icon,
    name: season.name,
    text: `${season.icon} ${season.name}${rest}`,
    title: `${season.name}: ${season.summary}`,
  };
}

/**
 * Hinweis beim Wechsel (online), z. B. „❄️ Winter: Der Baum ruht. …“. Bei mehreren
 * Wechseln in einem Schritt zählt der letzte; leer, wenn es keinen gab.
 */
export function seasonChangeText(seasons: readonly SeasonId[]): string {
  const last = seasons.length > 0 ? SEASONS_BY_ID.get(seasons[seasons.length - 1]!) : undefined;
  return last ? `${last.icon} ${last.name}: ${last.text}` : '';
}
