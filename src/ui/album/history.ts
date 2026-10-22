/**
 * Browser-Verlauf ↔ Album-Navigation (docs/ALBUM_UI.md, C.2).
 *
 * - Umschlag, jede Unterseite und das Vollbild legen per `pushState` einen Eintrag an
 *   (gleiche Adresse, `state.album = Tiefe`). So schließt die Zurück-Taste von Android bzw.
 *   die Wischgeste von iOS die oberste Ebene, statt die App zu verlassen.
 * - `popstate` meldet die neue Tiefe; das Album blättert so weit zurück.
 * - Zurück-Knöpfe der Oberfläche rufen `back()` (= `history.back()`), damit Verlauf und
 *   Stapel nie auseinanderlaufen.
 * - Der Hash nennt nur den Reiter und wird ersetzt, nicht angehängt (`replaceState`).
 *
 * Schließt das Album mehrere Ebenen auf einmal (Reiterwechsel, Umschlag zu), spult es den
 * Verlauf selbst zurück; die dabei kommenden `popstate` sind still.
 */

export interface AlbumHistory {
  /** Tiefe des Albums nach einer Navigation, die nicht aus dem Verlauf kam. */
  sync(depth: number): void;
  /** Eine Ebene zurück über den Verlauf (das `popstate` erledigt den Rest). */
  back(): void;
  /** Hash des Reiters setzen, ohne neuen Verlaufseintrag. */
  setHash(hash: string): void;
  /** Aktuelle Tiefe laut Verlauf. */
  readonly depth: number;
}

export interface AlbumHistoryOptions {
  /** Der Verlauf ist auf `depth` zurückgegangen (Browser-Zurück, `back()`). */
  onBack(depth: number): void;
}

interface AlbumState {
  album?: number;
}

function stateDepth(state: unknown): number {
  const depth = (state as AlbumState | null)?.album;
  return typeof depth === 'number' && Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0;
}

export function createAlbumHistory(options: AlbumHistoryOptions): AlbumHistory {
  // Ein Neuladen auf einer Unterseite stellt sie nicht wieder her (C.2): Tiefe 0.
  let depth = 0;
  if (stateDepth(history.state) !== 0) history.replaceState({ ...(history.state as object), album: 0 }, '');
  /** Noch erwartete stille Rücksprünge (eigenes `history.go(-n)`). */
  let rewinding = false;
  /** Ziel-Tiefe des laufenden Zurückspulens. */
  let expected = 0;
  /** Hash, der nach dem Zurückspulen auf den Grundeintrag gehört. */
  let pendingHash: string | null = null;
  /** Tiefe, die während des Zurückspulens gewünscht wurde (danach nachholen). */
  let deferred: number | null = null;

  const replaceHash = (hash: string) => {
    const url = `${location.pathname}${location.search}${hash}`;
    if (location.hash !== hash) history.replaceState({ album: depth }, '', url);
  };

  window.addEventListener('popstate', (event) => {
    const target = stateDepth(event.state);
    if (rewinding) {
      depth = target;
      // Erst am Ziel angekommen ist der Rücksprung erledigt.
      if (depth === 0 || depth <= expected) {
        rewinding = false;
        if (pendingHash !== null) {
          replaceHash(pendingHash);
          pendingHash = null;
        }
        if (deferred !== null) {
          const next = deferred;
          deferred = null;
          api.sync(next);
        }
      }
      return;
    }
    if (target >= depth) {
      // Vorwärts in einen alten Eintrag (oder ein Hash-Sprung): nichts wiederherstellen.
      depth = target;
      return;
    }
    depth = target;
    options.onBack(target);
  });

  const api: AlbumHistory = {
    get depth() {
      return depth;
    },
    sync(next) {
      if (rewinding) {
        deferred = next;
        return;
      }
      if (next > depth) {
        // Je neue Ebene ein Eintrag mit gleicher Adresse.
        for (let d = depth + 1; d <= next; d++) history.pushState({ album: d }, '');
        depth = next;
      } else if (next < depth) {
        rewinding = true;
        expected = next;
        history.go(next - depth);
      }
    },
    back() {
      if (depth > 0 && !rewinding) history.back();
    },
    setHash(hash) {
      if (rewinding) pendingHash = hash;
      else replaceHash(hash);
    },
  };
  return api;
}
