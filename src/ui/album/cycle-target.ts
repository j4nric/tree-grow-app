/**
 * Gemeinsames Ziel des nächsten Zyklus (docs/ALBUM_UI.md, D.2 `albumTarget`): Welcher Wald
 * der Landschaft beim Neuen Zyklus keimt. U:Standort wählt es („Als Ziel wählen“), die Karte
 * im Reiter „Landschaft“ zeigt es, U:Neuer Zyklus liest es für Knopf und Baumwahl.
 *
 * Hält dazu die Ansicht der Karte (`toLandscapeMapView`), damit alle drei Seiten dieselbe
 * sehen; sie wird nur nach Änderungen am Ökosystem neu gerechnet (eco-refresh.ts). Wie bisher
 * fällt das Ziel beim Neuen Zyklus, beim Wechsel des Waldes und beim Import zurück auf „hier“;
 * dabei verfallen auch offene Bestätigungen („Bauen“, `onDisarm`).
 */
import type { SiteId } from '../../content/landscape';
import type { GameState } from '../../core/state';
import { previewNewCycle } from '../../core/tick';
import { activeSite, landscapeOf } from '../../core/landscape';
import { toLandscapeMapView, type LandscapeMapView, type LandscapeSiteView } from '../landscape-view';

/**
 * Ziel des nächsten Zyklus (D.2 `albumTarget`): der gewählte Standort, solange er wählbar ist,
 * sonst der aktive Wald („hier“). Ohne Ansicht (Landschaft verborgen) gibt es keins.
 */
export function resolveTarget(view: Pick<LandscapeMapView, 'active' | 'sites'> | null, chosen: SiteId | null): SiteId | null {
  if (!view) return null;
  const pick = view.sites.find((s) => s.id === chosen);
  return pick && pick.action !== null ? pick.id : view.active;
}

/** Ist dieser Standort ein anderes Ziel als „hier“ (und darf der Zyklus beginnen)? */
export function isOtherTarget(view: Pick<LandscapeMapView, 'allowed'>, site: Pick<LandscapeSiteView, 'id' | 'active'>, target: SiteId | null): boolean {
  return view.allowed && !site.active && site.id === target;
}

/** Zusatz im Knopf auf der Karte nur für Screenreader: „, Ziel des nächsten Zyklus“. */
export function siteButtonExtra(view: Pick<LandscapeMapView, 'allowed'>, site: Pick<LandscapeSiteView, 'id' | 'active'>, target: SiteId | null): string {
  return isOtherTarget(view, site, target) ? ', Ziel des nächsten Zyklus' : '';
}

export interface AlbumTarget {
  /** Ansicht der Karte (null, solange die Landschaft verborgen ist). Neues Objekt je Änderung. */
  view(): LandscapeMapView | null;
  /** Ziel-Wald des nächsten Zyklus (aktiver Wald, wenn nichts anderes gewählt ist). */
  target(): SiteId | null;
  /** Standort als Ziel wählen; null bzw. nicht wählbar: zurück auf „hier“. */
  choose(id: SiteId | null): void;
  /** Ziel hat sich geändert (auch beim Zurückfallen auf „hier“). */
  onChange(listener: (target: SiteId) => void): void;
  /** Ansicht aus dem Spielstand nachziehen (nach Änderungen am Ökosystem). */
  update(state: GameState): void;
  /** Spielstand ersetzt: offene Bestätigungen (Korridor bauen) zurücknehmen. */
  disarm(): void;
  onDisarm(listener: () => void): void;
}

export function createAlbumTarget(): AlbumTarget {
  const listeners: ((target: SiteId) => void)[] = [];
  const disarmers: (() => void)[] = [];
  let view: LandscapeMapView | null = null;
  let chosen: SiteId | null = null;
  /** Zyklus und Wald der letzten Ansicht – ändert sich eins, gilt wieder „hier“. */
  let shownCycle = '';

  const target = () => resolveTarget(view, chosen);

  /** Ändert `change` das Ziel, erfahren es alle Zuhörer. */
  function track(change: () => void): void {
    const before = target();
    change();
    const after = target();
    if (after && after !== before) for (const listener of listeners) listener(after);
  }

  return {
    view: () => view,
    target,
    choose(id) {
      track(() => {
        const site = view?.sites.find((s) => s.id === id);
        chosen = site && site.action !== null && view?.allowed ? site.id : null;
      });
    },
    onChange: (listener) => void listeners.push(listener),
    update(state) {
      track(() => {
        const cycle = `${state.cycle.number}|${activeSite(landscapeOf(state))}`;
        if (cycle !== shownCycle) {
          // Neuer Zyklus bzw. anderer Wald: Ziel zurück auf „hier“, offene Bau-Bestätigung zurück.
          chosen = null;
          if (shownCycle !== '') for (const listener of disarmers) listener();
        }
        shownCycle = cycle;
        view = toLandscapeMapView(state, previewNewCycle(state));
      });
    },
    disarm() {
      for (const listener of disarmers) listener();
    },
    onDisarm: (listener) => void disarmers.push(listener),
  };
}
