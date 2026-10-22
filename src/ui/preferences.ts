/**
 * Einstellungen dieses Geräts (docs/ALBUM_UI.md, A.1 #18): `initPreferences()` lädt und
 * wendet sie an (Zahlenformat, `data-motion` am body für Szene und CSS) und meldet jede
 * wirksame Änderung. Die Oberfläche dazu ist die Unterseite „Einstellungen“ im Umschlag
 * (album/pages/settings-page.ts).
 */
import { setNumberStyle } from './format';
import { effectiveReducedMotion, loadSettings, saveSettings, toastDuration, type Settings } from './settings';

export interface Preferences {
  readonly settings: Readonly<Settings>;
  /** Wirksam: Bewegung reduzieren (Einstellung oder System). */
  readonly reducedMotion: boolean;
  /** Grund-Anzeigedauer der Meldungen (Stempel) in ms. */
  toastMs(): number;
  update(patch: Partial<Settings>): void;
  /** Wird nach jeder wirksamen Änderung gerufen (Einstellung oder System). */
  onChange(listener: () => void): void;
}

/** Lädt und wendet die Einstellungen an. Einmal beim Start aufrufen (vor der ersten Anzeige). */
export function initPreferences(): Preferences {
  let settings = loadSettings();
  let reduced = false;
  const listeners: (() => void)[] = [];
  const query =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function apply(): void {
    setNumberStyle(settings.numbers);
    reduced = effectiveReducedMotion(settings.motion, query?.matches ?? false);
    // CSS-Animationen und feedback.ts lesen dieses Attribut (Vorrang vor der Media-Query).
    document.body.dataset.motion = reduced ? 'reduce' : 'full';
  }
  const changed = () => {
    apply();
    for (const listener of listeners) listener();
  };
  apply();
  query?.addEventListener('change', changed);

  return {
    get settings() {
      return settings;
    },
    get reducedMotion() {
      return reduced;
    },
    toastMs: () => toastDuration(settings),
    update(patch) {
      settings = { ...settings, ...patch };
      saveSettings(settings);
      changed();
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
