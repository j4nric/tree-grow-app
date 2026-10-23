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
 * Verlauf selbst zurück; die dabei kommenden `popstate` sind still. Genauso beim Neuladen auf
 * einer Unterseite: zurück auf den Grundeintrag (die Seite selbst wird nicht wiederhergestellt).
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

/** So lange wartet das Album höchstens auf das `popstate` eines eigenen Rücksprungs. */
export const HISTORY_SETTLE_MS = 1000;

export function createAlbumHistory(options: AlbumHistoryOptions): AlbumHistory {
  // Ein Neuladen auf einer Unterseite stellt sie nicht wieder her (C.2): Tiefe 0.
  let depth = 0;
  const staleDepth = stateDepth(history.state);
  /** Eigenes `history.go(-n)` läuft: die kommenden `popstate` sind still. */
  let rewinding = false;
  /** Ziel-Tiefe des laufenden Zurückspulens. */
  let expected = 0;
  /** Hash, der nach dem Zurückspulen auf den Grundeintrag gehört. */
  let pendingHash: string | null = null;
  /** Tiefe, die während des Zurückspulens gewünscht wurde (danach nachholen). */
  let deferred: number | null = null;
  /**
   * `back()` wartet auf sein `popstate`: Ein zweiter Klick (Doppelklick aufs Lesezeichen)
   * darf nicht noch einen Schritt zurück – der verließe auf Tiefe 0 die App.
   */
  let backPending = false;
  /** Sicherheitsnetz, falls ein erwartetes `popstate` ausbleibt. */
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const replaceHash = (hash: string) => {
    const url = `${location.pathname}${location.search}${hash}`;
    if (location.hash !== hash) history.replaceState({ album: depth }, '', url);
  };

  /** Zurückspulen beendet (am Ziel oder nach dem Sicherheitsnetz): Vorgemerktes nachholen. */
  function finishRewind(): void {
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

  function armSafety(): void {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      // Kein `popstate` gekommen: Tiefe aus dem Verlauf neu lesen und weitermachen.
      backPending = false;
      if (!rewinding) return;
      depth = stateDepth(history.state);
      finishRewind();
    }, HISTORY_SETTLE_MS);
  }

  window.addEventListener('popstate', (event) => {
    const target = stateDepth(event.state);
    backPending = false;
    if (rewinding) {
      depth = target;
      // Erst am Ziel angekommen ist der Rücksprung erledigt.
      if (depth <= expected) {
        clearTimeout(settleTimer);
        finishRewind();
      }
      return;
    }
    clearTimeout(settleTimer);
    if (target >= depth) {
      // Vorwärts in einen alten Eintrag (oder ein Hash-Sprung): nichts wiederherstellen.
      depth = target;
      return;
    }
    depth = target;
    options.onBack(target);
  });

  if (staleDepth > 0) {
    if (history.length > staleDepth) {
      // Unter dem aktuellen Eintrag liegen noch die Einträge der alten Ebenen (KANN 5): auf den
      // Grundeintrag zurückspulen, sonst blieben die ersten Zurück-Drücke ohne Wirkung. Der
      // Hash des Reiters, mit dem neu geladen wurde, kommt danach auf den Grundeintrag.
      depth = staleDepth;
      rewinding = true;
      expected = 0;
      pendingHash = location.hash;
      armSafety();
      history.go(-staleDepth);
    } else {
      // Verlauf kürzer als erwartet (wiederhergestellte Sitzung o. Ä.): nicht über den Anfang hinaus.
      history.replaceState({ ...(history.state as object), album: 0 }, '');
    }
  }

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
        armSafety();
        history.go(next - depth);
      }
    },
    back() {
      if (depth === 0 || rewinding || backPending) return;
      backPending = true;
      armSafety();
      history.back();
    },
    setHash(hash) {
      if (rewinding) pendingHash = hash;
      else replaceHash(hash);
    },
  };
  return api;
}
