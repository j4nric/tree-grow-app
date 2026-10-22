/**
 * Ansichten für den Reiter „Ziele“ (docs/ALBUM_UI.md, B.4): Kurzkarte „Neuer Zyklus“, Punkt
 * am Reiter, Kennzahl im Seitenkopf und die Link-Karten zu Erfolgen und Statistik. Reine
 * Funktionen ohne DOM – getestet in tests/goals-view.test.ts.
 */
import { ACHIEVEMENTS_BY_ID } from '../../../content/achievements';
import { landscapeUnlocked } from '../../../core/landscape';
import type { GameState } from '../../../core/state';
import { newCycleBlocker, previewNewCycle } from '../../../core/tick';
import { achievementCountText } from '../../achievement-view';
import { memoryBonusLabel, memoryLineText, newCycleBlockerText, treeLabel } from '../../cycle-view';
import type { DailyView } from '../../daily-view';
import { formatDuration, formatNumber } from '../../format';
import { activeSiteLabel } from '../../landscape-view';

/** Punkt am Reiter „Ziele“: Ein Neuer Zyklus ist möglich (G-13). */
export function goalsTabDot(state: GameState): boolean {
  return newCycleBlocker(state) === null;
}

/** Kennzahl rechts im Seitenkopf: Serie der Tagesziele („🌞 4 Tage“), sonst der Zyklus. */
export function goalsPageMeta(daily: Pick<DailyView, 'streak'> | null, cycleNumber: number): string {
  const streak = daily?.streak ?? 0;
  if (streak > 0) return `🌞 ${formatNumber(streak)} ${streak === 1 ? 'Tag' : 'Tage'}`;
  return `Zyklus ${formatNumber(cycleNumber)}`;
}

/** Kurzkarte „Neuer Zyklus“ auf der Reiterseite. */
export interface CycleCardView {
  /** „Zyklus 2“ bzw. mit Landschaft „Zyklus 2 · 🌳 Heimatwald“. */
  title: string;
  /** Hauptbaum des laufenden Zyklus, z. B. „🌳 Stieleiche“. */
  tree: string;
  /** „Waldgedächtnis 30 · +60 % Wachstum und Samen“. */
  memory: string;
  /** Neuer Zyklus möglich. */
  ready: boolean;
  /** Gewinn („+33 Waldgedächtnis (+66 %)“) bzw. Grund, solange gesperrt. */
  line: string;
  /** Beschriftung des Knopfs zur Unterseite. */
  button: string;
}

export function toCycleCardView(state: GameState): CycleCardView {
  const blocker = newCycleBlocker(state);
  const cycle = `Zyklus ${formatNumber(state.cycle.number)}`;
  let line: string;
  if (blocker) line = newCycleBlockerText(blocker);
  else {
    const gain = previewNewCycle(state).memoryGain;
    line = `+${formatNumber(gain)} Waldgedächtnis (${memoryBonusLabel(gain)})`;
  }
  return {
    title: landscapeUnlocked(state) ? `${cycle} · ${activeSiteLabel(state)}` : cycle,
    tree: treeLabel(state.cycle.mainTree),
    memory: memoryLineText(state),
    ready: blocker === null,
    line,
    button: blocker ? 'Mehr dazu ›' : 'Vorbereiten ›',
  };
}

/** Link-Karte „Erfolge“: Zähler und die Symbole der zuletzt erreichten (neueste zuerst). */
export function achievementsLinkView(state: GameState, recent = 4): { count: string; icons: string[] } {
  const icons: string[] = [];
  const seen = new Set<string>();
  for (let i = state.meta.achievements.length - 1; i >= 0 && icons.length < recent; i--) {
    const id = state.meta.achievements[i]!;
    const a = ACHIEVEMENTS_BY_ID.get(id);
    if (!a || seen.has(id)) continue;
    seen.add(id);
    icons.push(a.icon);
  }
  return { count: achievementCountText(state), icons };
}

/** Link-Karte „Statistik“: „Zyklus 2 · 1 Std. 5 Min. gespielt“. */
export function statsLinkText(state: GameState): string {
  const played = state.meta.stats?.playSeconds ?? 0;
  return `Zyklus ${formatNumber(state.cycle.number)} · ${formatDuration(played)} gespielt`;
}

/** Balkenbreite in Prozent mit einer Nachkommastelle (CSS-Variable). */
export function shareWidth(share: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));
  return `${Math.round(clamped * 1000) / 10}%`;
}

/** Feste, leichte Schräglage je Kachel (−4° … +4°) aus der Erfolgs-ID – liegt immer gleich. */
export function tileTilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 9) - 4;
}
