import type { DailyState, LifetimeStats } from '../core/state';
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
 *   des laufenden Zyklus (Tagebuch und Langzeit-Statistik wachsen nur). Nur `stage`,
 *   `cycleTime` und `upgrade` mit `inCycle` beginnen beim Neuen Zyklus neu – startNewCycle
 *   prüft darum vorher.
 * - Erfolge der Waldlandschaft tragen `requires: 'landscape'` und nennen auch keine
 *   Standorte, Korridore oder Baumarten.
 * - IDs sind Teil des Spielstands (`meta.achievements`): nie umbenennen, nur ergänzen.
 */

/** Zählbare Felder der Langzeit-Statistik (`meta.stats`). */
export type AchievementStat = Exclude<keyof LifetimeStats, 'grownTrees' | 'completedCyclesGrowth'>;

/** Zähler der Tagesziele (`meta.daily`, seit v12) – alle wachsen nur (DESIGN_V2.md 26.5). */
export type AchievementDailyKey = Extract<keyof DailyState, 'bestStreak' | 'goalsDone' | 'perfectDays'>;

/** Zielwert: eine Anzahl oder „alle“ (wächst mit neuen Inhalten mit). */
export type AchievementTarget = number | 'all';

export type AchievementCondition =
  /** Stufe des laufenden Zyklus (Index in STAGES). */
  | { kind: 'stage'; atLeast: number }
  /**
   * Einträge im Naturtagebuch. `species` zählt die Arten ohne Kennarten ('all' bleibt ohne
   * Landschaft erreichbar), `kennarten` nur die Kennarten (DESIGN_V2.md 26.3, 26.5).
   */
  | { kind: 'journal'; what: 'species' | 'kennarten' | 'plants' | 'communities'; atLeast: AchievementTarget }
  /** Gattungen mit mindestens einer Art im Naturtagebuch. */
  | { kind: 'genera'; atLeast: AchievementTarget }
  /** Wert der Langzeit-Statistik (Zähler, Spielzeit in Sekunden, beste Harmonie). */
  | { kind: 'stat'; key: AchievementStat; atLeast: number }
  /** Abgeschlossene Zyklen (`cycle.number − 1`). */
  | { kind: 'cycles'; atLeast: number }
  /** Hauptbaum-Arten, die schon einmal gewachsen sind (`meta.stats.grownTrees`). */
  | { kind: 'trees'; atLeast: AchievementTarget }
  /** Spielzeit des laufenden Zyklus in Sekunden (`cycle.elapsed`, Jahreszeiten). */
  | { kind: 'cycleTime'; atLeast: number }
  /** Gegründete Wälder der Landschaft (Heimatwald zählt mit; 'all' = SITE_IDS.length). */
  | { kind: 'forests'; atLeast: AchievementTarget }
  /**
   * Korridore der Landschaft ('all' = CORRIDORS.length). `bought`: nur gekaufte, ohne die
   * Gratis-Korridore der Gründungen – nie zusammen mit 'all' (hinge an der Gründungs-Reihenfolge).
   */
  | { kind: 'corridors'; atLeast: AchievementTarget; bought?: boolean }
  /** Wälder, in denen schon einmal der Urwald erreicht wurde ('all' = SITE_IDS.length). */
  | { kind: 'ancientForests'; atLeast: AchievementTarget }
  /** Zähler der Tagesziele (`meta.daily`): längste Serie, erfüllte Ziele, perfekte Tage. */
  | { kind: 'daily'; key: AchievementDailyKey; atLeast: number }
  /** Wälder mit vollständiger Chronik (6 / 6 Kapitel, 26.4; 'all' = SITE_IDS.length). */
  | { kind: 'chronicles'; atLeast: AchievementTarget }
  /**
   * Nischen mit Ausbaustufe ≥ `level` (DESIGN_V2.md 28.4; 'all' = NICHE_IDS.length). Ohne
   * `inCycle` zählt die Bestmarke `meta.upgrades.best` (bleibt über den Zyklus, darum auch beim
   * Laden nachgetragen), mit `inCycle` nur die Stufen des laufenden Zyklus (`cycle.upgrades`).
   */
  | { kind: 'upgrade'; level: number; atLeast: AchievementTarget; inCycle?: boolean };

export interface Achievement {
  /** Fest, Teil des Spielstands. */
  id: string;
  icon: string;
  /** Kurzer, naturnaher Titel. */
  title: string;
  /** Ein Satz, neutral formuliert (auch für offene Erfolge sichtbar). */
  description: string;
  condition: AchievementCondition;
  /**
   * Verborgen, bis die Voraussetzung erfüllt ist (DESIGN_V2.md 24.12): 'landscape' = erst nach
   * der Freischaltung der Waldlandschaft sichtbar (core/achievements.ts, isAchievementVisible).
   * Die Prüfung hängt nicht daran.
   */
  requires?: 'landscape';
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
  { id: 'harmony-30', icon: '🎶', title: 'Lebendiges Gefüge', description: 'Die Harmonie-Produktion erreicht 30 ⚖️/min.', condition: { kind: 'stat', key: 'bestHarmony', atLeast: 30 } },
  { id: 'harmony-60', icon: '⚖️', title: 'Im Gleichgewicht', description: 'Die Harmonie-Produktion erreicht 60 ⚖️/min.', condition: { kind: 'stat', key: 'bestHarmony', atLeast: 60 } },
  { id: 'harmony-150', icon: '✨', title: 'Vollkommener Einklang', description: 'Die Harmonie-Produktion erreicht 150 ⚖️/min.', condition: { kind: 'stat', key: 'bestHarmony', atLeast: 150 } },
  // --- Begegnungen und Pflege ------------------------------------------------
  { id: 'visitor-1', icon: '🫖', title: 'Gastfreundschaft', description: 'Ein Gast auf der Durchreise wurde bewirtet.', condition: { kind: 'stat', key: 'visitorsHosted', atLeast: 1 } },
  { id: 'visitor-10', icon: '🏡', title: 'Rastplatz für viele', description: 'Zehn Gäste wurden bewirtet.', condition: { kind: 'stat', key: 'visitorsHosted', atLeast: 10 } },
  { id: 'events-5', icon: '🌦️', title: 'Wind und Wetter', description: 'Fünf Ereignisse wurden entschieden.', condition: { kind: 'stat', key: 'eventsDecided', atLeast: 5 } },
  { id: 'care-10', icon: '🧤', title: 'Behutsame Hände', description: 'Zehnmal wurde geforscht – Knoten und Ränge zählen.', condition: { kind: 'stat', key: 'careRanksBought', atLeast: 10 } },
  // --- Ausbau (28.4) ---------------------------------------------------------
  // Ein Ziel über den Zyklus hinaus: die Bestmarke bleibt, „Rundum eingelebt“ gilt je Zyklus.
  { id: 'upgrade-25', icon: '🏠', title: 'Gut bewohnt', description: 'Eine Nische ist auf Stufe 25 ausgebaut.', condition: { kind: 'upgrade', level: 25, atLeast: 1 } },
  { id: 'upgrade-50', icon: '🏰', title: 'Prachtnische', description: 'Eine Nische ist auf Stufe 50 ausgebaut.', condition: { kind: 'upgrade', level: 50, atLeast: 1 } },
  { id: 'upgrades-all-10', icon: '🏘️', title: 'Rundum eingelebt', description: 'In einem Zyklus sind alle Nischen auf Stufe 10 ausgebaut.', condition: { kind: 'upgrade', level: 10, atLeast: 'all', inCycle: true } },
  // --- Zyklen und Zeit -------------------------------------------------------
  { id: 'cycle-1', icon: '🔄', title: 'Ein neuer Anfang', description: 'Der erste Zyklus ist abgeschlossen.', condition: { kind: 'cycles', atLeast: 1 } },
  { id: 'cycle-3', icon: '🌙', title: 'Im Kreislauf', description: 'Drei Zyklen sind abgeschlossen.', condition: { kind: 'cycles', atLeast: 3 } },
  { id: 'cycle-10', icon: '♾️', title: 'Ewiger Wald', description: 'Zehn Zyklen sind abgeschlossen.', condition: { kind: 'cycles', atLeast: 10 } },
  // Fest drei Arten (24.12, 25.7): mit neuen Arten aus der Landschaft hinge er sonst an ihr.
  { id: 'trees-all', icon: '🍂', title: 'Baumkundig', description: 'Drei Hauptbaum-Arten sind einmal gewachsen.', condition: { kind: 'trees', atLeast: 3 } },
  { id: 'full-year', icon: '🗓️', title: 'Ein ganzes Jahr', description: 'Ein Zyklus erlebt ein volles Jahr mit allen vier Jahreszeiten.', condition: { kind: 'cycleTime', atLeast: YEAR_SECONDS } },
  { id: 'patience', icon: '⏳', title: 'Geduld der Bäume', description: 'Zehn Stunden Spielzeit über alle Zyklen.', condition: { kind: 'stat', key: 'playSeconds', atLeast: PATIENCE_SECONDS } },
  // --- Tagesziele (26.5) -----------------------------------------------------
  // Sanftes Ritual: kein Andenken, keine Zahl. Die Zähler stehen seit v12 in `meta.daily`.
  { id: 'daily-streak-7', icon: '🌅', title: 'Sieben Morgen', description: 'Sieben Tage in Folge ein Tagesziel erfüllt.', condition: { kind: 'daily', key: 'bestStreak', atLeast: 7 } },
  { id: 'daily-50', icon: '🧺', title: 'Fünfzig Handgriffe', description: 'Fünfzig Tagesziele erfüllt.', condition: { kind: 'daily', key: 'goalsDone', atLeast: 50 } },
  // --- Landschaft ------------------------------------------------------------
  // Verborgen bis zur Freischaltung (24.12); Texte ohne Standorte, Korridore und Baumarten.
  { id: 'forest-2', icon: '🪶', title: 'Weite Wege', description: 'Ein zweiter Wald ist gegründet.', condition: { kind: 'forests', atLeast: 2 }, requires: 'landscape' },
  { id: 'ancient-2', icon: '🌄', title: 'Wo Eicheln keimten', description: 'Ein zweiter Wald ist zum Urwald geworden.', condition: { kind: 'ancientForests', atLeast: 2 }, requires: 'landscape' },
  { id: 'wildwechsel-1', icon: '🐾', title: 'Wildwechsel', description: 'Ein Tier ist über einen Korridor in deinen Wald gewechselt.', condition: { kind: 'stat', key: 'wildwechselChosen', atLeast: 1 }, requires: 'landscape' },
  { id: 'corridor-1', icon: '🌉', title: 'Grüne Bänder', description: 'Ein Korridor wurde mit Hähersaat angelegt.', condition: { kind: 'corridors', atLeast: 1, bought: true }, requires: 'landscape' },
  // Alle Arten (seit v15 fünf): zwei davon schaltet erst die Gründung ihres Standorts frei (25.7).
  { id: 'landscape-trees', icon: '🎄', title: 'Baumkundig im ganzen Land', description: 'Jede Hauptbaum-Art ist einmal gewachsen.', condition: { kind: 'trees', atLeast: 'all' }, requires: 'landscape' },
  { id: 'ancient-everywhere', icon: '🏞️', title: 'Uralt überall', description: 'Jeder Wald der Landschaft ist einmal zum Urwald geworden.', condition: { kind: 'ancientForests', atLeast: 'all' }, requires: 'landscape' },
  { id: 'corridors-all', icon: '🗺️', title: 'Alles verbunden', description: 'Jeder Korridor der Landschaft ist angelegt.', condition: { kind: 'corridors', atLeast: 'all' }, requires: 'landscape' },
  // Waldchronik und Kennarten (26.5): ohne Zahlen-Belohnung, Texte ohne Wälder und Arten.
  { id: 'chronicle-1', icon: '📜', title: 'Eine Waldgeschichte', description: 'Die Chronik eines Waldes ist vollständig.', condition: { kind: 'chronicles', atLeast: 1 }, requires: 'landscape' },
  { id: 'chronicle-all', icon: '📚', title: 'Sechs Geschichten', description: 'Jeder Wald der Landschaft hat seine Chronik.', condition: { kind: 'chronicles', atLeast: 'all' }, requires: 'landscape' },
  { id: 'kennarten-all', icon: '🔎', title: 'Kennerblick', description: 'Jede Kennart steht im Naturtagebuch.', condition: { kind: 'journal', what: 'kennarten', atLeast: 'all' }, requires: 'landscape' },
];

export const ACHIEVEMENTS_BY_ID: ReadonlyMap<string, Achievement> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
