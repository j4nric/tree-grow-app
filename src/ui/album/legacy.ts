/**
 * Übergangssteuerung (docs/ALBUM_UI.md, F-1): die bisherigen Bauteile der Seitenleiste und
 * die Dialoge, wie sie bis Phase 7 in main.ts gesteuert wurden – jetzt eingehängt in die
 * Reiter des Albums. Jeder spätere Schritt (5–11) ersetzt hier sein Bauteil durch eine
 * Album-Seite und löscht den Teil; am Ende (F-12) entfällt die Datei.
 *
 * Regeln wie bisher: DOM einmal bauen, Strukturen nur bei Änderungen neu, Zahlen gedrosselt.
 * Spielregeln stehen nicht hier – Aktionen gehen über `deps.actions` an main.ts.
 */
import { PLANTS_BY_ID } from '../../content/plants';
import { evaluate, type Evaluation } from '../../core/formulas';
import { landscapeUnlocked } from '../../core/landscape';
import { isNight } from '../../core/weather';
import {
  refreshEcosystemView,
  toEcosystemView,
  type StageBannerView,
} from '../adapters';
import { createFloatLayer } from '../feedback';
import { formatNumber } from '../format';
import { toSeasonBadgeView } from '../season-view';
import { seedsLabel } from '../view-format';
import type { EcosystemView } from '../view-model';
import { toWeatherBadgeView } from '../weather-view';
import type { CarePage } from './pages/care-page';
import type { NichesPage } from './pages/niches-page';
import type { AlbumTarget } from './cycle-target';
import { createSeasonWeather } from './season-weather';
import type { NotifyOptions } from './stamp-rules';
import type { AlbumDeps, AlbumPart } from './types';

/** Seitenleiste ohne Änderungen am Ökosystem höchstens so oft aktualisieren (Samen, Fortschritt). */
const PANEL_REFRESH_MS = 200;

export interface LegacyMounts {
  niches: NichesPage;
  care: CarePage;
  /** Ziel des nächsten Zyklus mit der Ansicht der Landschaft (nach Änderungen nachziehen). */
  albumTarget: AlbumTarget;
  /** Platz in der Bildunterschrift des Polaroids (Jahreszeit, Wetter). */
  season: HTMLElement;
  /** Bildfläche des Polaroids (Stufen-Banner). */
  photo: HTMLElement;
}

export interface LegacyHooks {
  /** Neue bzw. aufgefrischte Ökosystem-Ansicht: Etiketten, Stufenleiste, Bildunterschrift. */
  onEcosystem(view: EcosystemView): void;
  /** Landschaft freigeschaltet (Reiter zeigen) bzw. wieder gesperrt (Import). */
  onLandscape(unlocked: boolean): void;
  /** Pflegemaßnahme zeigen: zuerst in den Reiter „Pflege“ wechseln. */
  showCareTab(): void;
  /** „🌱 Pflanze setzen“: zu U:Pflanze setzen umblättern. */
  openPlantPicker(): void;
  /** Fokusziel, wenn der Fokus sonst im Nichts landete (Überschrift der aktuellen Seite). */
  focusTarget(): HTMLElement | null;
  /** Meldung in die Stempelschicht (stamps.ts). */
  stamp(text: string, options?: NotifyOptions): void;
}

export interface LegacyUi {
  refresh(now: number): void;
  invalidate(parts: readonly AlbumPart[]): void;
  /**
   * Meldung (C.5): Stempel, ab 90 Zeichen Zettel (`direct` ist seit Schritt 7 ohne Wirkung –
   * es gibt keine alten Dialoge mit Hinweisfeld mehr). Leerer Text: nichts.
   */
  notify(text: string, options?: NotifyOptions): void;
  showBanner(view: StageBannerView): void;
  /** Verdeckt gerade ein Dialog die Szene? */
  overlayOpen(): boolean;
  noteText(text: string): void;
  floatSeeds(amount: number): void;
  /** Schwebender Hinweis an Bildschirm-Koordinaten (z. B. Bestätigung nach einem Kauf). */
  float(text: string, x: number, y: number): void;
  plantFeedback(cost: number, plantId: string): void;
  /** Spielstand ersetzt (Löschen, Import): Dialoge zu, Bestätigungen zurück, alles neu. */
  replaced(): void;
  /** Stand eines anderen Geräts übernommen; `headChanged`: andere vorderste Begegnung. */
  adopted(headChanged: boolean): void;
}

export function createLegacyUi(deps: AlbumDeps, mounts: LegacyMounts, hooks: LegacyHooks): LegacyUi {
  const preferences = deps.preferences;
  const state = () => deps.state();

  // --- Stufen-Banner ---------------------------------------------------------------------
  const banner = document.createElement('div');
  banner.className = 'stage-banner';
  banner.id = 'stage-banner';
  banner.setAttribute('aria-live', 'polite');
  mounts.photo.append(banner);
  banner.addEventListener('animationend', () => banner.classList.remove('visible'));
  /** Unsichtbare Statuszeile: schwebende Hinweise auch für Screenreader. */
  const liveStatus = document.querySelector<HTMLElement>('#live-status');
  const floats = createFloatLayer(document.body);
  const canvas = deps.canvas;

  // --- Zustand ------------------------------------------------------------------------
  let ecoDirty = true;
  let ecoView: EcosystemView | null = null;
  let ecoEvaluation: Readonly<Evaluation> | null = null;
  let ecoSeen = '';
  const ecoSeenKey = (): string => `${state().cycle.seen.length}/${state().pendingEncounters.length}`;
  let lastPanelRefresh = -Infinity;
  let seasonShownSecond = -1;
  let shownNight: boolean | null = null;
  let shownLandscape: boolean | null = null;

  // --- Bauteile -----------------------------------------------------------------------
  // Reiter Nischen (Schritt 5): „Pflanze setzen“ blättert um, „Zur Pflege“ über den Reiter Pflege.
  mounts.niches.connect({
    openPlantPicker: () => hooks.openPlantPicker(),
    showCare(id) {
      hooks.showCareTab();
      mounts.care.reveal(id);
    },
  });
  const seasonWeather = createSeasonWeather(mounts.season);

  preferences.onChange(() => {
    // Zahlenformat kann sich geändert haben: Ansichten vollständig neu aufbauen.
    ecoView = null;
    ecoDirty = true;
    seasonShownSecond = -1;
  });

  // --- Dialoge ------------------------------------------------------------------------

  /** Seit Schritt 7 gibt es keinen alten Dialog mehr; album/index.ts prüft das verdeckte Polaroid. */
  function overlayOpen(): boolean {
    return false;
  }

  /** Meldung als Stempel bzw. Zettel (C.5). */
  function notify(text: string, options: NotifyOptions = {}): void {
    if (!text) return;
    hooks.stamp(text, options);
  }

  function showBanner(view: StageBannerView): void {
    const strong = document.createElement('strong');
    strong.textContent = view.title;
    const span = document.createElement('span');
    span.textContent = view.text;
    banner.replaceChildren(strong, span);
    if (view.extra) {
      const extra = document.createElement('span');
      extra.className = 'stage-banner-extra';
      extra.textContent = view.extra;
      banner.append(extra);
    }
    banner.classList.toggle('long', Boolean(view.extra));
    banner.classList.remove('visible');
    void banner.offsetWidth; // Animation neu starten
    banner.classList.add('visible');
  }

  /** Schwebender Hinweis über der Szene; bei offenem Dialog dort (notify). */
  function noteText(text: string): void {
    if (overlayOpen()) {
      notify(text);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) floats.spawn(text, rect.left + rect.width / 2, rect.top + rect.height * 0.3, 'note');
    if (liveStatus) {
      liveStatus.textContent = '';
      requestAnimationFrame(() => (liveStatus.textContent = text));
    }
  }

  function floatSeeds(amount: number): void {
    const target = document.querySelector<HTMLElement>('[data-ref="seeds"]');
    if (!target || amount <= 0) return;
    const rect = target.getBoundingClientRect();
    // Gerundet wie der Knopf („Ablehnen (+144 🌰)“), damit beide dieselbe Zahl zeigen.
    floats.spawn(`+${seedsLabel(amount)} 🌰`, rect.left + rect.width / 2, rect.top);
  }

  function plantFeedback(cost: number, plantId: string): void {
    const ring = document.querySelector<HTMLElement>('[data-ref="plant-ring"]');
    const seedsEl = document.querySelector<HTMLElement>('[data-ref="seeds"]');
    if (seedsEl) {
      const rect = seedsEl.getBoundingClientRect();
      floats.spawn(`−${formatNumber(Math.ceil(cost))} 🌰`, rect.left + rect.width / 2, rect.top);
    }
    if (ring) {
      const rect = ring.getBoundingClientRect();
      if (rect.width > 0) floats.spawn(`🌱 ${PLANTS_BY_ID.get(plantId)?.name ?? ''}`, rect.left + rect.width / 2, rect.top + 24);
    }
  }

  // --- Ansichten ----------------------------------------------------------------------

  /** Jahreszeit und Wetter: nur neu, wenn eine neue ganze Sekunde Spielzeit beginnt. */
  function refreshSeasonBadge(): void {
    const s = state();
    const second = Math.floor(s.cycle.elapsed);
    if (second === seasonShownSecond) return;
    seasonShownSecond = second;
    seasonWeather.update(toSeasonBadgeView(s.cycle.elapsed), toWeatherBadgeView(s, preferences.settings.daytime === 'day'));
    // Sonnenunter- und -aufgang: Nachtwirkungen ändern die Raten – Ansichten neu bauen.
    const night = isNight(s.cycle.elapsed);
    if (night !== shownNight) {
      shownNight = night;
      ecoDirty = true;
    }
  }

  /** Struktur nur bei Änderungen am Ökosystem, Zahlen gedrosselt. */
  function refreshPanel(now: number): void {
    const s = state();
    if (ecoDirty || !ecoView) {
      ecoDirty = false;
      mounts.albumTarget.update(s);
      const unlocked = landscapeUnlocked(s);
      if (unlocked !== shownLandscape) {
        shownLandscape = unlocked;
        hooks.onLandscape(unlocked);
      }
      // Sonst nirgends gemeldet (z. B. nach einem Import): hier nachholen – als Zettel, der
      // bleibt (C.5); ein gleichzeitiger Stempel verdrängt ihn nicht.
      const announcement = deps.takeLandscapeAnnouncement();
      if (announcement) notify(announcement, { keep: true });
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
    } else if (now - lastPanelRefresh >= PANEL_REFRESH_MS) {
      refreshEcosystemView(ecoView, s);
    } else {
      return;
    }
    lastPanelRefresh = now;
    hooks.onEcosystem(ecoView);
  }

  function refresh(now: number): void {
    // Ökosystem geändert (Aktion, Wegpunkt …): Dämpfung im Wetter-Abzeichen gleich mitziehen.
    if (ecoDirty) seasonShownSecond = -1;
    refreshSeasonBadge();
    refreshPanel(now);
  }

  function invalidate(parts: readonly AlbumPart[]): void {
    for (const part of parts) {
      if (part === 'eco') ecoDirty = true;
      else if (part === 'season') seasonShownSecond = -1;
      // 'encounter' und 'picker' gehören den Unterseiten (album/index.ts).
    }
  }

  return {
    refresh,
    invalidate,
    notify,
    showBanner,
    overlayOpen,
    noteText,
    floatSeeds,
    float: (text, x, y) => floats.spawn(text, x, y, 'note'),
    plantFeedback,
    replaced() {
      seasonShownSecond = -1;
      invalidate(['eco']);
    },
    adopted() {
      seasonShownSecond = -1;
      invalidate(['eco']);
    },
  };
}
