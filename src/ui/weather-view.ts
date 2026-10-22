/**
 * View-Model für Wetter und Nacht (DESIGN_V2.md 21.8): Abzeichen neben der Jahreszeit
 * („🌬️ Sturm · −8 % 🌿 · +25 % 🌰“) mit aufklappbaren Details (Text, Dämpfung, Vorhersage,
 * Tag/Nacht), gemeinsamer Hinweis für Jahreszeiten- und Wetterwechsel, 🌙 an Nachtarten,
 * Schutz-Hinweise der Pflege und „Wetter gemittelt“ in der Rückkehr-Meldung.
 * Reine Funktionen ohne DOM – alle Werte kommen aus core/weather.ts; getestet in
 * tests/weather-view.test.ts.
 */
import { CARE_BY_ID } from '../content/care';
import { NOCTURNAL_BY_SPECIES, type Nocturnal } from '../content/daytime';
import type { TimedEffect } from '../content/events';
import { PLANT_GROUP_INFO } from '../content/plants';
import { SEASONS_BY_ID, type SeasonId } from '../content/seasons';
import { SPECIES_BY_ID } from '../content/species';
import { MAIN_TREES_BY_ID, type MainTreeId } from '../content/trees';
import {
  DIVERSITY_DAMPING_MAX,
  DIVERSITY_DAMPING_PER_GENUS,
  PROTECTION_FACTOR,
  WEATHERS,
  WEATHERS_BY_ID,
  type Weather,
  type WeatherId,
} from '../content/weather';
import { seasonIdAt } from '../core/season';
import type { GameState } from '../core/state';
import {
  isNight,
  nocturnalInSeason,
  nocturnalSpecies,
  secondsToNightChange,
  weatherAt,
  weatherDamping,
  weatherEffects,
  weatherForecast,
  type WeatherDamping,
} from '../core/weather';
import { formatNumber } from './format';
import { seasonTimeLeft } from './season-view';
import type { NightBadgeView, NightRateView } from './view-model';

export type { NightBadgeView, NightRateView };

/** Typografisches Minus (wie view-format.ts). */
const MINUS = '−';

/** Abzeichen und Details des Wetters von heute. */
export interface WeatherBadgeView {
  id: WeatherId;
  /** Raue Lage (Dürre, Sturm, Frost) – das Abzeichen bekommt einen dezenten Rahmen. */
  rough: boolean;
  /** Sichtbarer Text, z. B. „🌬️ Sturm · −8 % 🌿 · +25 % 🌰“. */
  text: string;
  /** Vorlesbarer Name des Knopfs, z. B. „Wetter heute: Sturm, −8 % Wachstum, +25 % Samen“. */
  label: string;
  /** Tooltip (Maus): Text und Vorhersage in einer Zeile. */
  title: string;
  /** Stimmungstext des Wetters. */
  mood: string;
  /** Wirkungen heute, gedämpft, z. B. „Heute: −7,5 % 🌿 (statt −15 %) · +25 % 🌰“. */
  effects: string;
  /** Dämpfung rauer Lagen („Abzug gedämpft: Vielfalt −50 % …“); null bei ruhigem Wetter. */
  damping: string | null;
  /** Was den Abzug (weiter) dämpfen würde; null, wenn nichts mehr geht. */
  tip: string | null;
  /** „Morgen: 🌫️ Nebel · +5 % 🌿 · Moose & Farne +30 % 🌿“. */
  forecast: string;
  /** Tag oder Nacht, Restzeit und wirkende Nachtarten. */
  daytime: string;
  /** Hinweis zur Einstellung „Immer Tag“; null, wenn sie aus ist. */
  daytimeNote: string | null;
  /** Gerade Nacht (für das Abzeichen-Attribut, nicht für Regeln). */
  night: boolean;
}

/** Prozent mit Vorzeichen und typografischem Minus; `whole` rundet auf ganze Zahlen (betragsweise). */
export function signedPct(pct: number, whole = false): string {
  const abs = Math.abs(pct);
  const shown = whole ? Math.round(abs) : Math.round(abs * 10) / 10;
  if (shown === 0) return '±0 %';
  return `${pct < 0 ? MINUS : '+'}${formatNumber(shown)} %`;
}

/** Eine Wetterwirkung als Kurztext, z. B. „−8 % 🌿“ oder „Blumen +20 % 🌰“. */
export function weatherEffectLabel(effect: TimedEffect, whole = false): string {
  const value = signedPct(effect.pct, whole);
  switch (effect.kind) {
    case 'growth':
      return `${value} 🌿`;
    case 'seeds':
      return `${value} 🌰`;
    case 'groupGrowth':
      return `${PLANT_GROUP_INFO[effect.group]?.name ?? effect.group} ${value} 🌿`;
    case 'groupSeeds':
      return `${PLANT_GROUP_INFO[effect.group]?.name ?? effect.group} ${value} 🌰`;
  }
}

/** Kurzform für das Abzeichen: nur 🌿 und 🌰 (Gruppen stehen in den Details), ganze Prozent. */
export function weatherBadgeEffects(effects: readonly TimedEffect[]): string[] {
  return badgeEffects(effects).map((e) => weatherEffectLabel(e, true));
}

/** 🌿 und 🌰, die gerundet nicht verschwinden (Kiefer bei Frost: kein „±0 %“ im Abzeichen). */
function badgeEffects(effects: readonly TimedEffect[]): TimedEffect[] {
  return effects.filter((e) => (e.kind === 'growth' || e.kind === 'seeds') && Math.round(Math.abs(e.pct)) > 0);
}

/** Für Screenreader: „−8 % Wachstum, +25 % Samen“. */
function spokenEffects(effects: readonly TimedEffect[]): string {
  return badgeEffects(effects)
    .map((e) => `${signedPct(e.pct, true)} ${e.kind === 'growth' ? 'Wachstum' : 'Samen'}`)
    .join(', ');
}

/** Name einer Pflegemaßnahme (Fallback: ID). */
function careName(id: string): string {
  return CARE_BY_ID.get(id)?.name ?? id;
}

/** Name eines Hauptbaums (Fallback: ID). */
function treeName(id: string | undefined): string {
  return MAIN_TREES_BY_ID.get(id as MainTreeId)?.name ?? id ?? '';
}

/**
 * Dämpfung einer rauen Lage als Text, z. B. „Abzug gedämpft: Vielfalt −30 % (3 Gattungen),
 * Lichte Krone −50 %.“; Kiefer bei Frost: „Die Waldkiefer ist gegen Frost gefeit – kein Abzug.“
 * null bei ruhigem Wetter.
 */
export function weatherDampingText(weather: Weather, damping: WeatherDamping, mainTree?: string): string | null {
  if (!damping.rough) return null;
  if (damping.immune) return `Die ${treeName(mainTree)} ist gegen ${weather.name} gefeit – kein Abzug.`;
  const parts: string[] = [];
  if (damping.diversity > 0) {
    const genera = damping.genera === 1 ? '1 Gattung' : `${formatNumber(damping.genera)} Gattungen`;
    parts.push(`Vielfalt ${signedPct(-damping.diversity * 100)} (${genera})`);
  }
  if (damping.protectedBy) parts.push(`${careName(damping.protectedBy)} ${signedPct(-(1 - PROTECTION_FACTOR) * 100)}`);
  return parts.length > 0 ? `Abzug gedämpft: ${parts.join(', ')}.` : 'Abzug ungedämpft.';
}

/** Was den Abzug einer rauen Lage noch dämpfen würde; null, wenn nichts mehr geht. */
export function weatherTipText(weather: Weather, damping: WeatherDamping): string | null {
  if (!damping.rough || damping.immune) return null;
  const tips: string[] = [];
  if (weather.protection && !damping.protectedBy) tips.push(`Pflege „${careName(weather.protection)}“ halbiert den Abzug.`);
  if (damping.diversity < DIVERSITY_DAMPING_MAX) {
    tips.push(
      `Jede Gattung mit Tieren dämpft ihn um ${formatNumber(DIVERSITY_DAMPING_PER_GENUS * 100)} %, höchstens um ${formatNumber(DIVERSITY_DAMPING_MAX * 100)} %.`,
    );
  }
  return tips.length > 0 ? tips.join(' ') : null;
}

/** Wirkungen heute (gedämpft) mit dem ungedämpften Wert dahinter, wo gedämpft wurde. */
export function weatherEffectsText(weather: Weather, damped: readonly TimedEffect[]): string {
  if (damped.length === 0) return 'Heute: keine Wirkung.';
  const labels = damped.map((e, i) => {
    const raw = weather.effects[i];
    const label = weatherEffectLabel(e);
    return raw && raw.pct !== e.pct ? `${label} (statt ${signedPct(raw.pct)})` : label;
  });
  return `Heute: ${labels.join(' · ')}`;
}

/** Vorhersage: „Morgen: 🌫️ Nebel · +5 % 🌿 · Moose & Farne +30 % 🌿“ (ungedämpft, wie die Daten). */
export function forecastText(weather: Weather): string {
  const effects = weather.effects.map((e) => weatherEffectLabel(e));
  return `Morgen: ${[`${weather.icon} ${weather.name}`, ...effects].join(' · ')}`;
}

/** Namen von Nachtarten mit Wirkung, z. B. „Waldkauz (+10 % 🌿)“. */
function nocturnalNames(list: readonly Nocturnal[]): string {
  return list
    .map((n) => {
      const name = SPECIES_BY_ID.get(n.species)?.name ?? n.species;
      return `${name} (${n.effects.map((e) => weatherEffectLabel(e)).join(', ')})`;
    })
    .join(', ');
}

/** Tag oder Nacht mit Restzeit und Nachtarten, z. B. „🌙 Nacht · noch 1:20 min – nachtaktiv: Waldkauz (+10 % 🌿)“. */
export function daytimeText(state: Pick<GameState, 'cycle' | 'niches'>): string {
  const elapsed = state.cycle.elapsed;
  const night = isNight(elapsed);
  const left = secondsToNightChange(elapsed);
  const active = nocturnalSpecies(state, seasonIdAt(elapsed));
  if (night) {
    const head = `🌙 Nacht${Number.isFinite(left) ? ` · noch ${seasonTimeLeft(left)}` : ''}`;
    return active.length > 0
      ? `${head} – nachtaktiv: ${nocturnalNames(active)}.`
      : `${head} – ohne nachtaktive Arten bleibt die Nacht ohne Wirkung.`;
  }
  const head = `☀️ Tag${Number.isFinite(left) ? ` · Nacht in ${seasonTimeLeft(left)}` : ''}`;
  return active.length > 0 ? `${head} – dann wirken: ${nocturnalNames(active)}.` : `${head}.`;
}

/** Hinweis zur Einstellung „Tageszeit: Immer Tag“ (19.1): Sie betrifft nur das Bild. */
export const ALWAYS_DAY_NOTE = 'Einstellung „Immer Tag“: Nur das Bild bleibt hell – Nacht und Wetter wirken weiter.';

/** Abzeichen des Wetters zum Spielstand. `alwaysDay`: Einstellung „Tageszeit: Immer Tag“. */
export function toWeatherBadgeView(state: Pick<GameState, 'cycle' | 'niches'>, alwaysDay = false): WeatherBadgeView {
  const weather = weatherAt(state);
  const damping = weatherDamping(state, weather);
  const damped = weatherEffects(state, weather);
  const forecast = weatherForecast(state);
  const shortEffects = weatherBadgeEffects(damped);
  const spoken = spokenEffects(damped);
  const forecastLine = forecastText(forecast);
  return {
    id: weather.id,
    rough: !!weather.rough,
    text: [`${weather.icon} ${weather.name}`, ...shortEffects].join(' · '),
    label: `Wetter heute: ${weather.name}${spoken ? `, ${spoken}` : ''}. Details`,
    title: `${weather.text} ${forecastLine}`,
    mood: weather.text,
    effects: weatherEffectsText(weather, damped),
    damping: weatherDampingText(weather, damping, state.cycle.mainTree),
    tip: weatherTipText(weather, damping),
    forecast: forecastLine,
    daytime: daytimeText(state),
    daytimeNote: alwaysDay ? ALWAYS_DAY_NOTE : null,
    night: isNight(state.cycle.elapsed),
  };
}

/**
 * Ein Hinweis für Jahreszeiten- und Wetterwechsel (beide an derselben Grenze), z. B.
 * „🍂 Herbst · 🌬️ Sturm – Früchte reifen, … Böen zerren an der Krone – …“. Bei mehreren
 * Wechseln in einem Schritt zählt der letzte; leer, wenn es keinen gab. Der Text des
 * Wetters fehlt bei „Wechselhaft“ (ohne Wirkung – der Hinweis bleibt kurz).
 */
export function seasonWeatherChangeText(seasons: readonly SeasonId[], weathers: readonly WeatherId[]): string {
  const season = seasons.length > 0 ? SEASONS_BY_ID.get(seasons[seasons.length - 1]!) : undefined;
  if (!season) return '';
  const weather = weathers.length > 0 ? WEATHERS_BY_ID.get(weathers[weathers.length - 1]!) : undefined;
  if (!weather) return `${season.icon} ${season.name}: ${season.text}`;
  const head = `${season.icon} ${season.name} · ${weather.icon} ${weather.name}`;
  const texts = weather.effects.length > 0 ? `${season.text} ${weather.text}` : season.text;
  return `${head} – ${texts}`;
}

/**
 * Satz für die Rückkehr-Meldung, wenn offline mit dem Mittelwetter gerechnet wurde (21.5):
 * „Wetter gemittelt (4 × Landregen, 1 × Sturm).“ Ohne besondere Tage nur „Wetter gemittelt.“;
 * leer, wenn nicht gemittelt wurde. Höchstens drei Lagen, die häufigsten zuerst.
 */
export function averagedWeatherText(report: { averaged?: boolean; weather?: readonly WeatherId[] }): string {
  if (!report.averaged) return '';
  const counts = new Map<WeatherId, number>();
  for (const id of report.weather ?? []) {
    if (!WEATHERS_BY_ID.get(id)?.effects.length) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const order = WEATHERS.map((w) => w.id);
  const list = [...counts]
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
    .slice(0, 3)
    .map(([id, n]) => `${formatNumber(n)} × ${WEATHERS_BY_ID.get(id)!.name}`);
  return list.length > 0 ? `Wetter gemittelt (${list.join(', ')}).` : 'Wetter gemittelt.';
}

/**
 * 🌙-Anzeige einer Art; null für Arten ohne Nachtwirkung. `season` und `night` beschreiben
 * den Moment (für Karten im Tagebuch ohne laufenden Zyklus: weglassen).
 */
export function nightBadge(speciesId: string, season?: SeasonId, night = false): NightBadgeView | null {
  const n = NOCTURNAL_BY_SPECIES.get(speciesId);
  if (!n) return null;
  const inSeason = season === undefined || nocturnalInSeason(n, season);
  return { label: `🌙 ${n.summary}`, name: n.name, active: night && inSeason, resting: !inSeason };
}

/** Text der Nachtwirkung für die Tierdetails, z. B. „🌙 Nachtjagd: nachts +10 % 🌿 – wirkt gerade“. */
export function nightDetailText(badge: NightBadgeView): string {
  const state = badge.active ? ' – wirkt gerade' : badge.resting ? ' – ruht in dieser Jahreszeit' : '';
  return `🌙 ${badge.name}: ${badge.label.replace(/^🌙 /, '')}${state}`;
}

/**
 * 🌙 an der Raten-Anzeige: Namen der Nachtarten, deren Nachtwirkung gerade gilt, getrennt
 * nach 🌿 und 🌰 (leer = kein 🌙). Nur Anzeige; die Rechnung steckt längst in den Raten.
 */
export function activeNightSpecies(state: Pick<GameState, 'cycle' | 'niches'>): NightRateView {
  const out: NightRateView = { growth: [], seeds: [] };
  if (!isNight(state.cycle.elapsed)) return out;
  for (const n of nocturnalSpecies(state, seasonIdAt(state.cycle.elapsed))) {
    const name = SPECIES_BY_ID.get(n.species)?.name ?? n.species;
    if (n.effects.some((e) => e.kind === 'growth' || e.kind === 'groupGrowth')) out.growth.push(name);
    if (n.effects.some((e) => e.kind === 'seeds' || e.kind === 'groupSeeds')) out.seeds.push(name);
  }
  return out;
}

/** Text für das 🌙 an einer Rate (Tooltip und Screenreader), z. B. „Nachtbonus: Waldkauz und Igel“. */
export function nightRateText(names: readonly string[]): string {
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
  return `Nachtbonus: ${list}`;
}

/**
 * Schutz einer Pflegemaßnahme vor rauem Wetter, z. B. „🛡️ Schützt vor 🌬️ Sturm – halbiert
 * den Abzug“; null, wenn sie vor nichts schützt.
 */
export function careProtectionText(careId: string): string | null {
  const weathers = WEATHERS.filter((w) => w.protection === careId);
  if (weathers.length === 0) return null;
  const names = weathers.map((w) => `${w.icon} ${w.name}`).join(' und ');
  return `🛡️ Schützt vor ${names} – halbiert den Abzug`;
}

/** Erklärung zum Schutz (Tooltip), z. B. „Durch die lichte Krone pfeift der Wind hindurch.“ */
export function careProtectionDetail(careId: string): string | null {
  const texts = WEATHERS.filter((w) => w.protection === careId && w.protectionText).map((w) => w.protectionText!);
  return texts.length > 0 ? texts.join(' ') : null;
}

/** Raue Lagen, gegen die ein Hauptbaum gefeit ist, z. B. „trotzt Frost 🧊“; null, wenn keine. */
export function treeWeatherText(treeId: string): string | null {
  const weathers = WEATHERS.filter((w) => w.rough && (w.immuneTrees ?? []).some((t) => t === treeId));
  return weathers.length > 0 ? `trotzt ${weathers.map((w) => `${w.name} ${w.icon}`).join(' und ')}` : null;
}
