/**
 * View-Model für den Bereich „Neuer Zyklus“ und die Stammgäste-Auswahl
 * (DESIGN_V2.md, Abschnitt 10). Reine Funktionen ohne DOM – testbar mit Vitest.
 * Die Komponente dazu steht in cycle-panel.ts.
 */
import { FOREST_MEMORY_BONUS } from '../content/memory';
import { NICHES_BY_ID } from '../content/niches';
import { GENUS_INFO, SPECIES_BY_ID } from '../content/species';
import { regularSlots } from '../core/formulas';
import { allAnimals, type GameState } from '../core/state';
import { previewNewCycle, regularBlocker } from '../core/tick';
import { formatNumber } from './format';

/** Eine entdeckte Art in der Stammgäste-Auswahl. */
export interface RegularOptionView {
  id: string;
  name: string;
  /** Gattungs-Symbol. */
  icon: string;
  /** Nische, in die die Art einzieht. */
  niche: string;
  selected: boolean;
  /** Nicht wählbar (alle Plätze belegt) – abwählen geht immer. */
  disabled: boolean;
  /** Lebt gerade im Ökosystem. */
  present: boolean;
}

export interface CyclePanelView {
  /** z. B. „Zyklus 2“. */
  title: string;
  /** Neuer Zyklus ist erlaubt (ab Hain). */
  allowed: boolean;
  /** Grund, solange gesperrt; sonst null. */
  blocker: string | null;
  /** Vorschau, z. B. „+33 Waldgedächtnis (+66 %)“; null, solange gesperrt. */
  gain: string | null;
  /** Woraus sich der Gewinn zusammensetzt, z. B. „Höchste Harmonie 96 · 12 neue Arten“. */
  gainDetail: string | null;
  /** Neue Stammgast-Plätze durch diesen Zyklus, z. B. „+1 Platz für Stammgäste“; sonst null. */
  slotsGain: string | null;
  /** Bestand, z. B. „Waldgedächtnis 30 · +60 % Wachstum und Samen“. */
  memory: string;
  /** Stammgäste: Plätze gesamt (0 → Auswahl ausgeblendet). */
  regularSlots: number;
  /** z. B. „Stammgäste 1/2“. */
  regularsTitle: string;
  regulars: RegularOptionView[];
}

/** Prozent-Bonus eines Waldgedächtnis-Werts, z. B. 33 → „+66 %“. */
export function memoryBonusLabel(points: number): string {
  return `+${formatNumber(Math.round(points * FOREST_MEMORY_BONUS * 100))} %`;
}

export function toCyclePanelView(state: GameState): CyclePanelView {
  const preview = previewNewCycle(state);
  const allowed = preview.blocker === null;
  const slots = regularSlots(state.meta.forestMemory);
  const newSlots = preview.regularSlotsAfter - preview.regularSlotsBefore;
  const species = preview.newSpecies === 1 ? '1 neue Art' : `${formatNumber(preview.newSpecies)} neue Arten`;
  const present = new Set(allAnimals(state));
  const regulars: RegularOptionView[] = [];
  for (const id of state.meta.journal.species) {
    const sp = SPECIES_BY_ID.get(id);
    if (!sp) continue;
    const selected = state.meta.regulars.includes(id);
    regulars.push({
      id,
      name: sp.name,
      icon: GENUS_INFO[sp.genus].icon,
      niche: NICHES_BY_ID.get(sp.niche)?.name ?? '',
      selected,
      disabled: !selected && regularBlocker(state, id) !== null,
      present: present.has(id),
    });
  }
  return {
    title: `Zyklus ${formatNumber(state.cycle.number)}`,
    allowed,
    blocker: preview.blocker,
    gain: allowed ? `+${formatNumber(preview.memoryGain)} Waldgedächtnis (${memoryBonusLabel(preview.memoryGain)})` : null,
    gainDetail: allowed ? `Höchste Harmonie ${formatNumber(Math.floor(preview.maxHarmony))} · ${species}` : null,
    slotsGain: allowed && newSlots > 0 ? (newSlots === 1 ? '+1 Platz für Stammgäste' : `+${newSlots} Plätze für Stammgäste`) : null,
    memory: `Waldgedächtnis ${formatNumber(state.meta.forestMemory)} · ${memoryBonusLabel(state.meta.forestMemory)} Wachstum und Samen`,
    regularSlots: slots,
    regularsTitle: `Stammgäste ${state.meta.regulars.length}/${slots}`,
    regulars,
  };
}

/** Schlüssel, der sich nur ändert, wenn die Ansicht neu gebaut werden muss (spart DOM-Arbeit). */
export function cycleViewKey(view: CyclePanelView): string {
  return JSON.stringify(view);
}

/** Kurze Meldung nach dem Zyklusstart (Toast). */
export function newCycleToast(gain: number, cycleNumber: number): string {
  return `Zyklus ${formatNumber(cycleNumber)} beginnt: Aus einer Eichel wächst ein neuer Baum. +${formatNumber(gain)} Waldgedächtnis.`;
}
