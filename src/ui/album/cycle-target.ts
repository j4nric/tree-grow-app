/**
 * Gemeinsames Ziel des nächsten Zyklus (docs/ALBUM_UI.md, D.2 `albumTarget`): Welcher Wald
 * der Landschaft beim Neuen Zyklus keimt. Die Karte der Landschaft (landscape-map.ts) wählt
 * es; U:Neuer Zyklus liest es für Knopf und Baumwahl.
 *
 * Bis Schritt 10 hängt die bisherige Karte im Reiter „Landschaft“ (legacy.ts); sie gehört
 * hierher, damit beide Seiten denselben Wert sehen. Wie bisher fällt das Ziel beim Neuen
 * Zyklus, beim Wechsel des Waldes und beim Import zurück auf „hier“.
 */
import type { SiteId } from '../../content/landscape';
import type { GameState } from '../../core/state';
import { previewNewCycle } from '../../core/tick';
import { activeSite, landscapeOf } from '../../core/landscape';
import { createLandscapeMap, type LandscapeMap } from '../landscape-map';
import { toLandscapeMapView } from '../landscape-view';

export interface AlbumTarget {
  /** Karte der Landschaft (bis Schritt 10 im Reiter „Landschaft“). */
  readonly map: LandscapeMap;
  /** Ziel-Wald des nächsten Zyklus (aktiver Wald, wenn nichts anderes gewählt ist). */
  target(): SiteId | null;
  /** Ziel hat sich geändert (auch beim Zurückfallen auf „hier“). */
  onChange(listener: (target: SiteId) => void): void;
  /** Karte aus dem Spielstand nachziehen (nach Änderungen am Ökosystem). */
  update(state: GameState): void;
  /** Offene Bestätigung eines Korridor-Kaufs zurücknehmen. */
  disarm(): void;
}

export function createAlbumTarget(onBuildCorridor: (id: string) => void): AlbumTarget {
  const listeners: ((target: SiteId) => void)[] = [];
  const map = createLandscapeMap({
    onTargetChange: (target) => {
      for (const listener of listeners) listener(target);
    },
    onBuildCorridor,
  });
  /** Zyklus und Wald der letzten Ansicht – ändert sich eins, gilt wieder „hier“. */
  let shownCycle = '';

  return {
    map,
    target: () => map.target(),
    onChange: (listener) => void listeners.push(listener),
    update(state) {
      const cycle = `${state.cycle.number}|${activeSite(landscapeOf(state))}`;
      if (cycle !== shownCycle) map.reset();
      shownCycle = cycle;
      map.update(toLandscapeMapView(state, previewNewCycle(state)));
    },
    disarm: () => map.disarm(),
  };
}
