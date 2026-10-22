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
import { evaluate, nextPlantCost, type Evaluation } from '../../core/formulas';
import { landscapeUnlocked } from '../../core/landscape';
import { isNight } from '../../core/weather';
import {
  encounterActionKey,
  refreshEcosystemView,
  toEcosystemView,
  toEncounterView,
  toJournalStats,
  toJournalView,
  toPlantPickerView,
  type StageBannerView,
} from '../adapters';
import { toAchievementTimeProgress } from '../achievement-view';
import { createCyclePanel } from '../cycle-panel';
import { toCyclePanelView } from '../cycle-view';
import { createDailyPanel } from '../daily-panel';
import { toDailyView } from '../daily-view';
import { createEncounterDialog } from '../encounter-dialog';
import { createEncounterStack } from '../encounter-stack';
import { createFloatLayer } from '../feedback';
import { formatNumber } from '../format';
import { createJournalButton, createJournalDialog } from '../journal-dialog';
import { createPlantPicker } from '../plant-picker';
import { toSeasonBadgeView } from '../season-view';
import { seedsLabel } from '../view-format';
import type { EcosystemView } from '../view-model';
import { toWeatherBadgeView } from '../weather-view';
import { applyWildwechselMark } from '../wildwechsel-view';
import type { CarePage } from './pages/care-page';
import type { GoalsPage } from './pages/goals-page';
import type { LandscapePage } from './pages/landscape-page';
import type { NichesPage } from './pages/niches-page';
import type { SpeciesPage } from './pages/species-page';
import { createSeasonWeather } from './season-weather';
import type { NotifyOptions } from './stamp-rules';
import type { AlbumDeps, AlbumPart } from './types';

/** Seitenleiste ohne Änderungen am Ökosystem höchstens so oft aktualisieren (Samen, Fortschritt). */
const PANEL_REFRESH_MS = 200;

export interface LegacyMounts {
  niches: NichesPage;
  species: SpeciesPage;
  care: CarePage;
  goals: GoalsPage;
  landscape: LandscapePage;
  /** Platz in der Bildunterschrift des Polaroids (Jahreszeit, Wetter). */
  season: HTMLElement;
  /** Bildfläche des Polaroids (Stufen-Banner). */
  photo: HTMLElement;
  /** Kopf rechts (Begegnungs-Stapel). */
  dock: HTMLElement;
}

export interface LegacyHooks {
  /** Neue bzw. aufgefrischte Ökosystem-Ansicht: Etiketten, Stufenleiste, Bildunterschrift. */
  onEcosystem(view: EcosystemView): void;
  /** Landschaft freigeschaltet (Reiter zeigen) bzw. wieder gesperrt (Import). */
  onLandscape(unlocked: boolean): void;
  /** Pflegemaßnahme zeigen: zuerst in den Reiter „Pflege“ wechseln. */
  showCareTab(): void;
  /** Fokusziel, wenn der Fokus sonst im Nichts landete (Überschrift der aktuellen Seite). */
  focusTarget(): HTMLElement | null;
  /** Meldung in die Stempelschicht (stamps.ts). */
  stamp(text: string, options?: NotifyOptions): void;
}

export interface LegacyUi {
  refresh(now: number): void;
  invalidate(parts: readonly AlbumPart[]): void;
  /** Die vorderste Begegnung ist erledigt (neue Karten, auch wenn sie gleich aussehen). */
  encounterResolved(): void;
  /**
   * Meldung (C.5): Stempel, ab 90 Zeichen Zettel. Solange noch ein alter Dialog mit eigenem
   * Hinweisfeld offen ist (Kartenwahl, Pflanzenwahl, Tagebuch, Tierdetails), steht sie
   * dort – außer mit `direct`. Leerer Text: nichts.
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
  closeEncounters(): void;
  closePlantPicker(): void;
  focusCycle(): void;
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
  /** Der Spieler hat den Stapel geöffnet; bleibt offen, bis „Später“ oder keine Begegnung mehr wartet. */
  let dialogWanted = false;
  let encounterDirty = true;
  let shownActionKey: string | null = null;
  let shownQueued = -1;
  /** Zählt erledigte Begegnungen – zwei gleich aussehende nacheinander gelten als verschieden. */
  let encounterSerial = 0;
  let ecoDirty = true;
  let ecoView: EcosystemView | null = null;
  let ecoEvaluation: Readonly<Evaluation> | null = null;
  let ecoSeen = '';
  const ecoSeenKey = (): string => `${state().cycle.seen.length}/${state().pendingEncounters.length}`;
  let lastPanelRefresh = -Infinity;
  let pickerWanted = false;
  let pickerDirty = true;
  let shownPickerAffordable: boolean | null = null;
  let pickerSeedsShown = -1;
  let pickerSeedsAt = -Infinity;
  let seasonShownSecond = -1;
  let shownNight: boolean | null = null;
  let shownLandscape: boolean | null = null;

  const focusFallback = () => {
    if (document.activeElement === document.body || document.activeElement === null) {
      hooks.focusTarget()?.focus({ preventScroll: true });
    }
  };

  // --- Bauteile -----------------------------------------------------------------------
  // Reiter Nischen (Schritt 5): Pflanzenwahl bis Schritt 6 hier, „Zur Pflege“ über den Reiter Pflege.
  mounts.niches.connect({
    openPlantPicker,
    showCare(id) {
      hooks.showCareTab();
      mounts.care.reveal(id);
    },
  });
  const dailyPanel = createDailyPanel(mounts.goals.daily);
  const cyclePanel = createCyclePanel(mounts.goals.cycle, {
    onNewCycle: (tree, site) => deps.actions.newCycle(tree, site),
    onBuildCorridor: (id) => deps.actions.buildCorridor(id),
    onToggleRegular: (speciesId) => deps.actions.toggleRegular(speciesId),
  });
  // Die Karte der Landschaft steht im eigenen Reiter; cycle-panel.ts steuert sie weiter.
  mounts.landscape.landscape.append(cyclePanel.landscapeElement);
  const seasonWeather = createSeasonWeather(mounts.season);
  const stack = createEncounterStack(mounts.dock, openEncounters, { float: false });
  const dialog = createEncounterDialog(document.body, { ...deps.actions.encounter, onDefer: closeEncounters });
  const picker = createPlantPicker(document.body, {
    onPlant: (plantId) => deps.actions.plant(plantId),
    onClose: () => {
      pickerWanted = false;
      // Ist der Knopf jetzt weg (Ring voll), den Fokus nicht im Nichts lassen.
      focusFallback();
    },
  });
  const journal = createJournalDialog(document.body, {
    onToggleRegular: (speciesId) => deps.actions.toggleRegular(speciesId),
  });
  createJournalButton(mounts.species.journal, openJournal);

  preferences.onChange(() => {
    // Zahlenformat kann sich geändert haben: Ansichten vollständig neu aufbauen.
    ecoView = null;
    ecoDirty = true;
    seasonShownSecond = -1;
    encounterDirty = true;
    pickerDirty = true;
  });

  // --- Dialoge ------------------------------------------------------------------------

  function openJournal(): void {
    closeEncounters();
    closePlantPicker();
    journal.show(toJournalView(state(), evaluate(state())));
  }

  function openPlantPicker(): void {
    closeEncounters();
    pickerWanted = true;
    pickerDirty = true;
    refreshPicker();
  }

  function closePlantPicker(): void {
    pickerWanted = false;
    picker.hide();
  }

  function openEncounters(): void {
    if (state().pendingEncounters.length === 0) return;
    closePlantPicker();
    dialogWanted = true;
    encounterDirty = true;
    refreshEncounter();
  }

  function closeEncounters(): void {
    dialogWanted = false;
    dialog.hide();
  }

  function overlayOpen(): boolean {
    return picker.open || dialog.open || journal.open;
  }

  /** Meldung: im offenen alten Dialog dort (er würde den Stempel verdecken), sonst als Stempel. */
  function notify(text: string, options: NotifyOptions = {}): void {
    if (!text) return;
    if (!options.direct) {
      if (picker.open) return picker.notice(text);
      if (dialog.open) return dialog.notice(text);
      if (journal.open) return journal.notice(text);
    }
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

  /** Auswahl „Pflanze setzen“ nur bei Änderungen neu bauen; die Samen-Zeile gedrosselt. */
  function refreshPicker(now = performance.now()): void {
    if (!pickerWanted) {
      if (picker.open) picker.hide();
      return;
    }
    const s = state();
    const affordable = s.seeds >= nextPlantCost(s);
    if (!pickerDirty && picker.open && affordable === shownPickerAffordable) {
      const whole = Math.floor(s.seeds);
      if (whole !== pickerSeedsShown || now - pickerSeedsAt >= PANEL_REFRESH_MS) {
        pickerSeedsShown = whole;
        pickerSeedsAt = now;
        picker.updateSeeds(s.seeds);
      }
      return;
    }
    pickerDirty = false;
    pickerSeedsShown = Math.floor(s.seeds);
    pickerSeedsAt = now;
    shownPickerAffordable = affordable;
    picker.show(toPlantPickerView(s, evaluate(s)), s.seeds);
  }

  /** Zeigt die älteste wartende Begegnung, wenn der Spieler den Stapel geöffnet hat. */
  function refreshEncounter(): void {
    const s = state();
    const pending = s.pendingEncounters.length;
    if (!dialogWanted || pending === 0) {
      if (pending === 0) dialogWanted = false;
      if (dialog.open) {
        dialog.hide();
        // Der Stapel ist weg – Fokus nicht im Nichts (body) stranden lassen.
        if (stack.element.hidden) focusFallback();
      }
      return;
    }
    const queued = pending - 1;
    const actionKey = encounterActionKey(s, 0);
    if (!encounterDirty && dialog.open && actionKey === shownActionKey && queued === shownQueued) return;
    const view = toEncounterView(s, 0, evaluate(s));
    if (!view) return;
    // Wildwechsel (24.6): Weg der vordersten Begegnung (main.ts weiß, wie die Karte kam).
    applyWildwechselMark(view, deps.encounterMark());
    view.key = String(encounterSerial);
    encounterDirty = false;
    shownActionKey = actionKey;
    shownQueued = queued;
    dialog.show(view, queued);
  }

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
      cyclePanel.update(toCyclePanelView(s));
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
      if (journal.open) journal.update(toJournalView(s, ev));
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
    if (journal.open) {
      journal.updateStats(toJournalStats(s, evaluate(s)));
      journal.updateAchievementProgress(toAchievementTimeProgress(s));
    }
    dailyPanel.update(toDailyView(s, deps.today()));
  }

  function refresh(now: number): void {
    // Ökosystem geändert (Aktion, Wegpunkt …): Dämpfung im Wetter-Abzeichen gleich mitziehen.
    if (ecoDirty) seasonShownSecond = -1;
    refreshSeasonBadge();
    refreshPanel(now);
    const s = state();
    stack.update(s.pendingEncounters.length, s.pendingEncounters[0]);
    refreshEncounter();
    refreshPicker(now);
  }

  function invalidate(parts: readonly AlbumPart[]): void {
    for (const part of parts) {
      if (part === 'eco') ecoDirty = true;
      else if (part === 'encounter') encounterDirty = true;
      else if (part === 'picker') pickerDirty = true;
      else if (part === 'season') seasonShownSecond = -1;
    }
  }

  return {
    refresh,
    invalidate,
    encounterResolved() {
      encounterSerial++;
      encounterDirty = true;
    },
    notify,
    showBanner,
    overlayOpen,
    noteText,
    floatSeeds,
    float: (text, x, y) => floats.spawn(text, x, y, 'note'),
    plantFeedback,
    closeEncounters,
    closePlantPicker,
    focusCycle: () => cyclePanel.focus(),
    replaced() {
      cyclePanel.disarm();
      seasonShownSecond = -1;
      closeEncounters();
      closePlantPicker();
      journal.hide();
      encounterSerial++;
      invalidate(['eco', 'encounter', 'picker']);
    },
    adopted(headChanged) {
      cyclePanel.disarm();
      seasonShownSecond = -1;
      if (headChanged) {
        closeEncounters();
        encounterSerial++;
      }
      invalidate(['eco', 'encounter', 'picker']);
    },
  };
}
