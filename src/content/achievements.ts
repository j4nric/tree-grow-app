import type { LifetimeStats } from '../core/state';
import { YEAR_SECONDS } from './seasons';

/**
 * Erfolge (docs/DESIGN_V2.md, Abschnitt 18): leise Meilensteine über das ganze Spiel –
 * kein Druck, keine Zeitlimits. Reine Daten; die Auswertung steht in
 * src/core/achievements.ts (`checkAchievements`, `achievementProgress`).
 *
 * Regeln für neue Einträge:
 * - Titel und Beschreibung nennen nie Namen von Arten, Pflanzen, Lebensgemeinschaften
 *   oder Gästen – offene Erfolge sind im Naturtagebuch sichtbar und dürfen nichts verraten.
 * - Bedingungen sind deklarativ und **monoton**: Was einmal erfüllt ist, bleibt es während
 *   des laufenden Zyklus (Tagebuch und Langzeit-Statistik wachsen nur). Nur `stage` und
 *   `cycleTime` beginnen beim Neuen Zyklus neu – startNewCycle prüft darum vorher.
 * - IDs sind Teil des Spielstands (`meta.achievements`): nie umbenennen, nur ergänzen.
 */

/** Zählbare Felder der Langzeit-Statistik (`meta.stats`). */
export type AchievementStat = Exclude<keyof LifetimeStats, 'grownTrees' | 'completedCyclesGrowth'>;

/** Zielwert: eine Anzahl oder „alle“ (wächst mit neuen Inhalten mit). */
export type AchievementTarget = number | 'all';

export type AchievementCondition =
  /** Stufe des laufenden Zyklus (Index in STAGES). */
  | { kind: 'stage'; atLeast: number }
  /** Einträge im Naturtagebuch. */
  | { kind: 'journal'; what: 'species' | 'plants' | 'communities'; atLeast: AchievementTarget }
  /** Gattungen mit mindestens einer Art im Naturtagebuch. */
  | { kind: 'genera'; atLeast: AchievementTarget }
  /** Wert der Langzeit-Statistik (Zähler, Spielzeit in Sekunden, beste Harmonie). */
  | { kind: 'stat'; key: AchievementStat; atLeast: number }
  /** Abgeschlossene Zyklen (`cycle.number − 1`). */
  | { kind: 'cycles'; atLeast: number }
  /** Hauptbaum-Arten, die schon einmal gewachsen sind (`meta.stats.grownTrees`). */
  | { kind: 'trees'; atLeast: AchievementTarget }
  /** Spielzeit des laufenden Zyklus in Sekunden (`cycle.elapsed`, Jahreszeiten). */
  | { kind: 'cycleTime'; atLeast: number };

export interface Achievement {
  /** Fest, Teil des Spielstands. */
  id: string;
  icon: string;
  /** Kurzer, naturnaher Titel. */
  title: string;
  /** Ein Satz, neutral formuliert (auch für offene Erfolge sichtbar). */
  description: string;
  condition: AchievementCondition;
}

/** Spielzeit-Erfolg „Geduld der Bäume“: 10 Stunden über alle Zyklen. */
export const PATIENCE_SECONDS = 10 * 60 * 60;

/** Reihenfolge = Anzeige im Naturtagebuch und Reihenfolge bei gleichzeitigem Freischalten. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  // --- Wachsen ---------------------------------------------------------------
  { id: 'sapling', icon: '🌱', title: 'Ein dünner Stamm', description: 'Dein Baum wächst zum Setzling heran.', condition: { kind: 'stage', atLeast: 2 } },
  { id: 'grove', icon: '🌳', title: 'Nicht mehr allein', description: 'Dein Baum erreicht die Stufe Hain.', condition: { kind: 'stage', atLeast: 5 } },
  { id: 'ancient-forest', icon: '🌲', title: 'Uralt und voller Leben', description: 'Dein Baum wird zum Urwald.', condition: { kind: 'stage', atLeast: 7 } },
  // --- Naturtagebuch ---------------------------------------------------------
  { id: 'species-5', icon: '🐞', title: 'Erste Nachbarn', description: 'Fünf Arten stehen im Naturtagebuch.', condition: { kind: 'journal', what: 'species', atLeast: 5 } },
  { id: 'species-16', icon: '🦔', title: 'Ein belebter Baum', description: 'Sechzehn Arten stehen im Naturtagebuch.', condition: { kind: 'journal', what: 'species', atLeast: 16 } },
  { id: 'species-all', icon: '📖', title: 'Alle Bewohner', description: 'Jede Art steht im Naturtagebuch.', condition: { kind: 'journal', what: 'species', atLeast: 'all' } },
  { id: 'all-genera', icon: '🧭', title: 'Von allem etwas', description: 'Aus jeder Gattung steht mindestens eine Art im Naturtagebuch – auch Amphibien und Reptilien.', condition: { kind: 'genera', atLeast: 'all' } },
  { id: 'plants-5', icon: '🌼', title: 'Bunter Saum', description: 'Fünf verschiedene Pflanzen sind im Pflanzring gewachsen.', condition: { kind: 'journal', what: 'plants', atLeast: 5 } },
  { id: 'plants-all', icon: '💐', title: 'Garten des Waldes', description: 'Jede Pflanze ist einmal im Pflanzring gewachsen.', condition: { kind: 'journal', what: 'plants', atLeast: 'all' } },
  { id: 'community-1', icon: '🤝', title: 'Gemeinsam stark', description: 'Die erste Lebensgemeinschaft ist entdeckt.', condition: { kind: 'journal', what: 'communities', atLeast: 1 } },
  { id: 'community-5', icon: '🕸️', title: 'Geflecht des Lebens', description: 'Fünf Lebensgemeinschaften sind entdeckt.', condition: { kind: 'journal', what: 'communities', atLeast: 5 } },
  { id: 'community-all', icon: '🍄', title: 'Alles hängt zusammen', description: 'Jede Lebensgemeinschaft ist entdeckt.', condition: { kind: 'journal', what: 'communities', atLeast: 'all' } },
  // --- Harmonie --------------------------------------------------------------
  { id: 'harmony-30', icon: '🎶', title: 'Lebendiges Gefüge', description: 'Die Harmonie erreicht 30.', condition: { kind: 'stat', key: 'bestHarmony', atLeast: 30 } },
  { id: 'harmony-60', icon: '⚖️', title: 'Im Gleichgewicht', description: 'Die Harmonie erreicht 60.', condition: { kind: 'stat', key: 'bestHarmony', atLeast: 60 } },
  { id: 'harmony-150', icon: '✨', title: 'Vollkommener Einklang', description: 'Die Harmonie erreicht 150.', condition: { kind: 'stat', key: 'bestHarmony', atLeast: 150 } },
  // --- Begegnungen und Pflege ------------------------------------------------
  { id: 'visitor-1', icon: '🫖', title: 'Gastfreundschaft', description: 'Ein Gast auf der Durchreise wurde bewirtet.', condition: { kind: 'stat', key: 'visitorsHosted', atLeast: 1 } },
  { id: 'visitor-10', icon: '🏡', title: 'Rastplatz für viele', description: 'Zehn Gäste wurden bewirtet.', condition: { kind: 'stat', key: 'visitorsHosted', atLeast: 10 } },
  { id: 'events-5', icon: '🌦️', title: 'Wind und Wetter', description: 'Fünf Ereignisse wurden entschieden.', condition: { kind: 'stat', key: 'eventsDecided', atLeast: 5 } },
  { id: 'care-10', icon: '🧤', title: 'Behutsame Hände', description: 'Zehn Ränge Pflege wurden gekauft.', condition: { kind: 'stat', key: 'careRanksBought', atLeast: 10 } },
  // --- Zyklen und Zeit -------------------------------------------------------
  { id: 'cycle-1', icon: '🔄', title: 'Ein neuer Anfang', description: 'Der erste Zyklus ist abgeschlossen.', condition: { kind: 'cycles', atLeast: 1 } },
  { id: 'cycle-3', icon: '🌙', title: 'Im Kreislauf', description: 'Drei Zyklen sind abgeschlossen.', condition: { kind: 'cycles', atLeast: 3 } },
  { id: 'cycle-10', icon: '♾️', title: 'Ewiger Wald', description: 'Zehn Zyklen sind abgeschlossen.', condition: { kind: 'cycles', atLeast: 10 } },
  { id: 'trees-all', icon: '🍂', title: 'Baumkundig', description: 'Jede Hauptbaum-Art ist einmal gewachsen.', condition: { kind: 'trees', atLeast: 'all' } },
  { id: 'full-year', icon: '🗓️', title: 'Ein ganzes Jahr', description: 'Ein Zyklus erlebt ein volles Jahr mit allen vier Jahreszeiten.', condition: { kind: 'cycleTime', atLeast: YEAR_SECONDS } },
  { id: 'patience', icon: '⏳', title: 'Geduld der Bäume', description: 'Zehn Stunden Spielzeit über alle Zyklen.', condition: { kind: 'stat', key: 'playSeconds', atLeast: PATIENCE_SECONDS } },
];

export const ACHIEVEMENTS_BY_ID: ReadonlyMap<string, Achievement> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
