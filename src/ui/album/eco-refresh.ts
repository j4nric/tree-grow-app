/**
 * Auffrischen der Ökosystem-Ansicht (docs/ALBUM_UI.md, D.1): rechnet die Ansicht nur nach
 * Änderungen am Ökosystem neu (sonst gedrosselt nur die Zahlen), zieht Jahreszeit und Wetter
 * in der Bildunterschrift je neuer Spielsekunde nach und meldet das Ergebnis an das Album
 * (Etiketten, Stufenleiste, Seiten). Keine Spielregeln: nur Auswertung und Ansichten aus
 * core/ bzw. adapters.ts.
 */
import { evaluate, type Evaluation } from '../../core/formulas';
import { landscapeUnlocked } from '../../core/landscape';
import { isNight } from '../../core/weather';
import { refreshEcosystemView, toEcosystemView } from '../adapters';
import { toSeasonBadgeView } from '../season-view';
import type { EcosystemView } from '../view-model';
import { toWeatherBadgeView } from '../weather-view';
import type { AlbumTarget } from './cycle-target';
import type { SeasonWeather } from './season-weather';
import type { AlbumDeps, AlbumPart } from './types';

/** Ohne Änderungen am Ökosystem höchstens so oft aktualisieren (Samen, Fortschritt). */
export const ECO_REFRESH_MS = 200;

export interface EcoRefreshHooks {
  /** Ziel des nächsten Zyklus: Ansicht der Landschaft nach Änderungen nachziehen. */
  albumTarget: AlbumTarget;
  /** Jahreszeit und Wetter in der Bildunterschrift des Polaroids. */
  seasonWeather: SeasonWeather;
  /** Neue bzw. aufgefrischte Ökosystem-Ansicht: Etiketten, Stufenleiste, Bildunterschrift. */
  onEcosystem(view: EcosystemView): void;
  /** Landschaft freigeschaltet (Reiter zeigen) bzw. wieder gesperrt (Import). */
  onLandscape(unlocked: boolean): void;
  /** Meldung „Landschaft freigeschaltet“ als bleibender Zettel (C.5). */
  announce(text: string): void;
}

export interface EcoRefresh {
  refresh(now: number): void;
  invalidate(parts: readonly AlbumPart[]): void;
  /** Spielstand ersetzt oder übernommen: alles beim nächsten Auffrischen neu. */
  reset(): void;
}

export function createEcoRefresh(deps: AlbumDeps, hooks: EcoRefreshHooks): EcoRefresh {
  const state = () => deps.state();
  let ecoDirty = true;
  let ecoView: EcosystemView | null = null;
  let ecoEvaluation: Readonly<Evaluation> | null = null;
  let ecoSeen = '';
  const ecoSeenKey = (): string => `${state().cycle.seen.length}/${state().pendingEncounters.length}`;
  let lastRefresh = -Infinity;
  let seasonShownSecond = -1;
  let shownNight: boolean | null = null;
  let shownLandscape: boolean | null = null;

  deps.preferences.onChange(() => {
    // Zahlenformat kann sich geändert haben: Ansichten vollständig neu aufbauen.
    ecoView = null;
    ecoDirty = true;
    seasonShownSecond = -1;
  });

  /** Jahreszeit und Wetter: nur neu, wenn eine neue ganze Sekunde Spielzeit beginnt. */
  function refreshSeason(): void {
    const s = state();
    const second = Math.floor(s.cycle.elapsed);
    if (second === seasonShownSecond) return;
    seasonShownSecond = second;
    hooks.seasonWeather.update(toSeasonBadgeView(s.cycle.elapsed), toWeatherBadgeView(s, deps.preferences.settings.daytime === 'day'));
    // Sonnenunter- und -aufgang: Nachtwirkungen ändern die Raten – Ansichten neu bauen.
    const night = isNight(s.cycle.elapsed);
    if (night !== shownNight) {
      shownNight = night;
      ecoDirty = true;
    }
  }

  /** Struktur nur bei Änderungen am Ökosystem, Zahlen gedrosselt. */
  function refreshEcosystem(now: number): void {
    const s = state();
    if (ecoDirty || !ecoView) {
      ecoDirty = false;
      hooks.albumTarget.update(s);
      const unlocked = landscapeUnlocked(s);
      if (unlocked !== shownLandscape) {
        shownLandscape = unlocked;
        hooks.onLandscape(unlocked);
      }
      // Sonst nirgends gemeldet (z. B. nach einem Import): hier nachholen.
      const announcement = deps.takeLandscapeAnnouncement();
      if (announcement) hooks.announce(announcement);
      const ev = evaluate(s);
      if (!ecoView || ev !== ecoEvaluation || ecoSeenKey() !== ecoSeen) {
        ecoEvaluation = ev;
        ecoSeen = ecoSeenKey();
        ecoView = toEcosystemView(s, ev);
        deps.ecosystemChanged(ev, true);
      } else {
        refreshEcosystemView(ecoView, s);
        deps.ecosystemChanged(ev, false);
      }
    } else if (now - lastRefresh >= ECO_REFRESH_MS) {
      refreshEcosystemView(ecoView, s);
    } else {
      return;
    }
    lastRefresh = now;
    hooks.onEcosystem(ecoView);
  }

  function invalidate(parts: readonly AlbumPart[]): void {
    for (const part of parts) {
      if (part === 'eco') ecoDirty = true;
      else if (part === 'season') seasonShownSecond = -1;
      // 'encounter' und 'picker' gehören den Unterseiten (album/index.ts).
    }
  }

  return {
    refresh(now) {
      // Ökosystem geändert (Aktion, Wegpunkt …): Dämpfung im Wetter gleich mitziehen.
      if (ecoDirty) seasonShownSecond = -1;
      refreshSeason();
      refreshEcosystem(now);
    },
    invalidate,
    reset() {
      seasonShownSecond = -1;
      ecoDirty = true;
    },
  };
}
