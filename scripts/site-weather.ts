/**
 * Messung „Waldtyp und Wetter“ (docs/DESIGN_V2.md 24.14, Phase 7, 3b) – BEVOR die Logik in
 * src/core/weather.ts die Standort-Gewichte kennt (3c). Für einen Lauf in EINEM Wald werden die
 * Gewichte in WEATHER_WEIGHTS zur Laufzeit durch die Gewichte des Standorts ersetzt (dieselbe
 * Tabelle, die rawWeather und weatherProbabilities lesen) und danach wiederhergestellt. So
 * rechnet der Simulator mit der echten Logik – Wetter des Tages, Dämpfung, Ereignis-Gewichte
 * (Käferjahr bei Dürre, 22.6) –, ohne dass sich Spielstand oder Verhalten des Spiels ändern.
 *
 * Gilt nur für Läufe mit festem Standort (siteRun), nicht für die ganze Landschaft und nicht für
 * den Modus „Mittel“ (dessen Cache-Schlüssel kennt den Standort erst mit 3c).
 *
 * Seit 3c zieht core/weather.ts selbst mit den Gewichten des aktiven Waldes – `withSiteWeather`
 * wendet die Faktoren in Läufen mit aktivem Standort darum DOPPELT an. Nicht mehr für neue Zahlen
 * verwenden; 3d entfernt die Datei (wie scripts/site-trees.ts).
 *
 * Ausführen: SIM_SITE_WEATHER=1 npx vitest run tests/site-weather-balance.test.ts --silent=false
 */
import { LANDSCAPE_SITES_BY_ID, type SiteId } from '../src/content/landscape';
import type { SeasonId } from '../src/content/seasons';
import { SEASON_IDS } from '../src/content/seasons';
import { WEATHER_WEIGHTS, type WeatherId } from '../src/content/weather';

type Weights = Partial<Record<WeatherId, number>>;

/**
 * Gewichte einer Jahreszeit an einem Standort – die Formel für 3c:
 * Gewicht(w) = WEATHER_WEIGHTS[Jahreszeit][w] × (ForestSite.weather[w] ?? 1), Reihenfolge wie
 * in WEATHER_WEIGHTS. Lagen ohne Grundgewicht bleiben weg.
 */
export function siteWeatherWeights(season: SeasonId, site: SiteId, base = WEATHER_WEIGHTS): Weights {
  const factors = LANDSCAPE_SITES_BY_ID.get(site)?.weather ?? {};
  const out: Weights = {};
  for (const [id, w] of Object.entries(base[season]) as [WeatherId, number][]) out[id] = w * (factors[id] ?? 1);
  return out;
}

/** Führt `fn` mit dem Wetter des Standorts aus (nur Simulation; stellt die Daten danach wieder her). */
export function withSiteWeather<T>(site: SiteId, fn: () => T): T {
  const table = WEATHER_WEIGHTS as Record<SeasonId, Weights>;
  const saved = Object.fromEntries(SEASON_IDS.map((s) => [s, table[s]])) as Record<SeasonId, Weights>;
  for (const s of SEASON_IDS) table[s] = siteWeatherWeights(s, site, saved);
  try {
    return fn();
  } finally {
    for (const s of SEASON_IDS) table[s] = saved[s];
  }
}
