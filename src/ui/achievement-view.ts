/**
 * Erfolge in der Oberfläche (DESIGN_V2.md 18): Texte für den leisen Hinweis beim
 * Freischalten und die Kacheln im Naturtagebuch, Reiter „Erfolge“. Reine Funktionen über
 * Spielstand und Inhalte – kein DOM.
 *
 * Spoiler-Regel: Titel und Beschreibungen in content/achievements.ts sind neutral; der
 * Fortschritt nennt nur Zahlen, nie Namen von Unentdecktem.
 */
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, type Achievement } from '../content/achievements';
import { achievementProgress } from '../core/achievements';
import type { GameState } from '../core/state';
import { formatDuration, formatNumber } from './format';
import type { JournalAchievementView } from './view-model';

/** Höchstens so viele Titel nennt ein Sammel-Hinweis, danach „und N weitere“. */
const MAX_NAMED = 3;

function titles(ids: readonly string[]): string[] {
  return ids.map((id) => ACHIEVEMENTS_BY_ID.get(id)?.title).filter((t): t is string => !!t);
}

function joinTitles(names: readonly string[]): string {
  const quoted = names.map((n) => `„${n}“`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  if (quoted.length <= MAX_NAMED) return `${quoted.slice(0, -1).join(', ')} und ${quoted[quoted.length - 1]}`;
  return `${quoted.slice(0, MAX_NAMED).join(', ')} und ${formatNumber(quoted.length - MAX_NAMED)} weitere`;
}

/**
 * Leiser Hinweis beim Freischalten: „🏅 Erfolg: „Bunter Saum““ bzw. für mehrere auf einmal
 * ein gemeinsamer Satz. null, wenn nichts Bekanntes dabei ist.
 */
export function achievementUnlockedText(ids: readonly string[] | undefined): string | null {
  const names = titles(ids ?? []);
  if (names.length === 0) return null;
  if (names.length === 1) return `🏅 Erfolg: ${joinTitles(names)}`;
  return `🏅 ${formatNumber(names.length)} neue Erfolge: ${joinTitles(names)}`;
}

/** Einmal nach der Migration v8 → v9: „🏅 3 Erfolge nachgetragen“ (null bei 0). */
export function achievementsBackfilledText(count: number): string | null {
  if (!(count > 0)) return null;
  const n = Math.floor(count);
  return `🏅 ${formatNumber(n)} ${n === 1 ? 'Erfolg' : 'Erfolge'} nachgetragen – zu finden im Naturtagebuch.`;
}

/** Fortschritt als Text, z. B. „3/5“, „2 Std./10 Std.“; null für Stufen (die Beschreibung genügt). */
export function progressText(state: GameState, achievement: Achievement): string | null {
  const c = achievement.condition;
  if (c.kind === 'stage') return null;
  const { value, target } = achievementProgress(state, achievement);
  if (c.kind === 'cycleTime' || (c.kind === 'stat' && c.key === 'playSeconds')) {
    return `${formatDuration(value)}/${formatDuration(target)}`;
  }
  // Harmonie und Zähler: ganze Zahlen (Harmonie gerundet wie in der Seitenleiste, aber nie
  // über dem Ziel, solange es nicht erreicht ist).
  const shown = c.kind === 'stat' && c.key === 'bestHarmony' ? Math.min(Math.round(value), value < target ? target - 1 : target) : Math.floor(value);
  return `${formatNumber(shown)}/${formatNumber(target)}`;
}

/**
 * Kacheln für den Reiter „Erfolge“: zuerst die freigeschalteten in Freischalt-Reihenfolge,
 * dann die offenen in Inhalts-Reihenfolge mit Fortschritt.
 */
export function toJournalAchievements(state: GameState): JournalAchievementView[] {
  const unlocked = new Set<string>();
  const out: JournalAchievementView[] = [];
  for (const id of state.meta.achievements) {
    const a = ACHIEVEMENTS_BY_ID.get(id);
    if (!a || unlocked.has(id)) continue;
    unlocked.add(id);
    out.push({ key: a.id, icon: a.icon, title: a.title, description: a.description, unlocked: true });
  }
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    const view: JournalAchievementView = { key: a.id, icon: a.icon, title: a.title, description: a.description, unlocked: false };
    const progress = progressText(state, a);
    if (progress) view.progress = progress;
    out.push(view);
  }
  return out;
}

/** Zähler am Reiter, z. B. „3/25“. */
export function achievementCountText(state: GameState): string {
  const known = new Set(state.meta.achievements.filter((id) => ACHIEVEMENTS_BY_ID.has(id))).size;
  return `${formatNumber(known)}/${formatNumber(ACHIEVEMENTS.length)}`;
}
