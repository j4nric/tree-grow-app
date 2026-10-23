/**
 * Erfolge in der Oberfläche (DESIGN_V2.md 18): Texte für den leisen Hinweis beim
 * Freischalten und die Kacheln im Naturtagebuch, Reiter „Erfolge“. Reine Funktionen über
 * Spielstand und Inhalte – kein DOM.
 *
 * Spoiler-Regel: Titel und Beschreibungen in content/achievements.ts sind neutral; der
 * Fortschritt nennt nur Zahlen, nie Namen von Unentdecktem.
 */
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, type Achievement } from '../content/achievements';
import { achievementProgress, isAchievementVisible } from '../core/achievements';
import type { GameState } from '../core/state';
import { formatDuration, formatNumber } from './format';
import type { JournalAchievementProgressView, JournalAchievementView } from './view-model';

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

/**
 * Einmal nach der Migration v8 → v9: „🏅 3 Erfolge nachgetragen“ (null bei 0). Kommen beim
 * Nachrechnen der Offline-Zeit gleich noch Erfolge dazu (`fresh`), steht alles in einem
 * Satz: „🏅 3 Erfolge nachgetragen, dazu neu: „Bunter Saum“ – zu finden unter Ziele › Erfolge.“
 */
export function achievementsBackfilledText(count: number, fresh: readonly string[] = []): string | null {
  const names = titles(fresh);
  if (!(count > 0)) return achievementUnlockedText(fresh);
  const n = Math.floor(count);
  const extra = names.length === 0 ? '' : names.length === 1 ? `, dazu neu: ${joinTitles(names)}` : `, dazu ${formatNumber(names.length)} neue: ${joinTitles(names)}`;
  return `🏅 ${formatNumber(n)} ${n === 1 ? 'Erfolg' : 'Erfolge'} nachgetragen${extra} – zu finden unter Ziele › Erfolge.`;
}

/** Läuft der Fortschritt mit der Spielzeit (ändert sich jede Sekunde)? */
function isTimed(achievement: Achievement): boolean {
  const c = achievement.condition;
  return c.kind === 'cycleTime' || (c.kind === 'stat' && c.key === 'playSeconds');
}

/** Fortschritt als Text, z. B. „3/5“, „2 Std./10 Std.“; null für Stufen (die Beschreibung genügt). */
export function progressText(state: GameState, achievement: Achievement): string | null {
  const c = achievement.condition;
  if (c.kind === 'stage') return null;
  const { value, target } = achievementProgress(state, achievement);
  if (isTimed(achievement)) {
    return `${formatDuration(value)}/${formatDuration(target)}`;
  }
  // Harmonie und Zähler: ganze Zahlen. Harmonie ist schon gerundet wie in der Seitenleiste
  // (core/achievements.ts); eine offene Kachel zeigt nie „60/60“ – die Prüfung läuft
  // gedrosselt und schaltet den Erfolg gleich frei.
  const shown = c.kind === 'stat' && c.key === 'bestHarmony' ? Math.min(value, target - 1) : Math.floor(value);
  return `${formatNumber(shown)}/${formatNumber(target)}`;
}

/**
 * Kacheln für den Reiter „Erfolge“: zuerst die freigeschalteten in Freischalt-Reihenfolge,
 * dann die offenen in Inhalts-Reihenfolge mit Fortschritt. Offene, noch verborgene Erfolge
 * (Landschaft vor der Freischaltung, 24.12) fehlen.
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
    if (unlocked.has(a.id) || !isAchievementVisible(state, a)) continue;
    const view: JournalAchievementView = { key: a.id, icon: a.icon, title: a.title, description: a.description, unlocked: false };
    const progress = progressText(state, a);
    if (progress) view.progress = progress;
    if (isTimed(a)) view.live = true;
    out.push(view);
  }
  return out;
}

/**
 * Nur der laufende Fortschritt der offenen Zeit-Erfolge (für das gedrosselte Nachführen im
 * offenen Tagebuch, ohne die Kacheln neu zu bauen).
 */
export function toAchievementTimeProgress(state: GameState): JournalAchievementProgressView[] {
  const unlocked = new Set(state.meta.achievements);
  const out: JournalAchievementProgressView[] = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id) || !isTimed(a)) continue;
    const progress = progressText(state, a);
    if (progress) out.push({ key: a.id, progress });
  }
  return out;
}

/**
 * Zähler am Reiter, z. B. „3/25“. Die Gesamtzahl zählt nur sichtbare Erfolge: vor der
 * Freischaltung der Landschaft ohne ihre (24.12), danach mit ihnen.
 */
export function achievementCountText(state: GameState): string {
  const known = new Set(state.meta.achievements.filter((id) => ACHIEVEMENTS_BY_ID.has(id))).size;
  const total = ACHIEVEMENTS.filter((a) => isAchievementVisible(state, a)).length;
  return `${formatNumber(known)}/${formatNumber(total)}`;
}
