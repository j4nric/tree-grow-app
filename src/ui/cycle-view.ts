/**
 * View-Model für den Bereich „Neuer Zyklus“ und die Stammgäste-Auswahl
 * (DESIGN_V2.md, Abschnitt 10). Reine Funktionen ohne DOM – testbar mit Vitest.
 * Die Komponente dazu steht in cycle-panel.ts.
 */
import {
  FOREST_MEMORY_BONUS,
  MEMORY_HARMONY_DIVISOR,
  MEMORY_PER_HARMONY_POINT,
  MEMORY_PER_NEW_SPECIES,
  NEW_CYCLE_MIN_STAGE,
} from '../content/memory';
import { NICHES_BY_ID } from '../content/niches';
import { GENUS_INFO, SPECIES_BY_ID } from '../content/species';
import { STAGES } from '../content/stages';
import { MAIN_TREES, MAIN_TREES_BY_ID, type MainTreeId } from '../content/trees';
import { regularSlots, type MemoryHarmonyBonus } from '../core/formulas';
import { allAnimals, type GameState } from '../core/state';
import { previewNewCycle, regularBlocker, type NewCycleBlocker } from '../core/tick';
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

/** Eine Hauptbaum-Art in der Auswahl beim Neuen Zyklus (DESIGN_V2.md 17.2). */
export interface TreeOptionView {
  id: MainTreeId;
  /** z. B. „Rotbuche“. */
  name: string;
  icon: string;
  /** Eigenheit in Kurzform (trees.ts `summary`). */
  summary: string;
  /** Wählbar (freigeschaltet über das Naturtagebuch). */
  unlocked: boolean;
  /** Hinweis, solange gesperrt, z. B. „Lass einmal eine Rotbuche im Pflanzring wachsen.“; sonst null. */
  hint: string | null;
  /** Art des laufenden Zyklus (vorausgewählt). */
  current: boolean;
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
  /** Regel für das Waldgedächtnis mit der Schwelle der erreichten Stufe (immer sichtbar), siehe memoryRuleText. */
  memoryRule: string;
  /** Neue Stammgast-Plätze durch diesen Zyklus, z. B. „+1 Platz für Stammgäste“; sonst null. */
  slotsGain: string | null;
  /** Bestand, z. B. „Waldgedächtnis 30 · +60 % Wachstum und Samen“. */
  memory: string;
  /** Stammgäste: Plätze gesamt (0 → Auswahl ausgeblendet). */
  regularSlots: number;
  /** z. B. „Stammgäste 1/2“. */
  regularsTitle: string;
  regulars: RegularOptionView[];
  /** Art des laufenden Zyklus, z. B. „🌳 Stieleiche“. */
  tree: string;
  /** Alle Arten für die Wahl beim Neuen Zyklus (MAIN_TREES-Reihenfolge). */
  trees: TreeOptionView[];
  /** Vorauswahl: die laufende Art, ist sie gesperrt (z. B. nach einem Import), die erste freie. */
  defaultTree: MainTreeId;
}

/** „einer Eichel“, „einer Buchecker“, „einem Kiefernsamen“ (Dativ der Frucht). */
const FRUIT_ARTICLE: Record<MainTreeId, string> = { oak: 'einer', beech: 'einer', pine: 'einem' };

/** Frucht der Art mit Artikel im Dativ, z. B. „einer Buchecker“ (unbekannt: Eiche). */
export function fruitPhrase(id: MainTreeId | string | undefined): string {
  const tree = MAIN_TREES_BY_ID.get(id as MainTreeId) ?? MAIN_TREES[0]!;
  return `${FRUIT_ARTICLE[tree.id] ?? 'einer'} ${tree.fruit}`;
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
    blocker: preview.blocker ? newCycleBlockerText(preview.blocker) : null,
    gain: allowed ? `+${formatNumber(preview.memoryGain)} Waldgedächtnis (${memoryBonusLabel(preview.memoryGain)})` : null,
    gainDetail: allowed ? `Höchste Harmonie ${formatNumber(Math.round(preview.maxHarmony))} · ${species}` : null,
    memoryRule: memoryRuleText(preview.harmonyBonus),
    slotsGain: allowed && newSlots > 0 ? (newSlots === 1 ? '+1 Platz für Stammgäste' : `+${newSlots} Plätze für Stammgäste`) : null,
    memory: `Waldgedächtnis ${formatNumber(state.meta.forestMemory)} · ${memoryBonusLabel(state.meta.forestMemory)} Wachstum und Samen`,
    regularSlots: slots,
    regularsTitle: `Stammgäste ${state.meta.regulars.length}/${slots}`,
    regulars,
    tree: treeLabel(state.cycle.mainTree),
    defaultTree: preview.trees.find((t) => t.id === preview.mainTree && t.unlocked)?.id ?? preview.trees.find((t) => t.unlocked)?.id ?? 'oak',
    trees: preview.trees.map(({ id, unlocked }) => {
      const t = MAIN_TREES_BY_ID.get(id)!;
      return {
        id,
        name: t.name,
        icon: t.icon,
        summary: t.summary,
        unlocked,
        hint: unlocked ? null : t.unlockHint,
        current: id === preview.mainTree,
      };
    }),
  };
}

/** Schlüssel, der sich nur ändert, wenn die Ansicht neu gebaut werden muss (spart DOM-Arbeit). */
export function cycleViewKey(view: CyclePanelView): string {
  return JSON.stringify(view);
}

/**
 * Regel für das Waldgedächtnis (Schritt 2.11, Schwelle je Stufe seit 2.11b, content/memory.ts)
 * mit Schwelle und Obergrenze der erreichten Stufe (vor dem Hain: die des Hains), z. B.
 * „Waldgedächtnis: 1 Punkt je 5 Punkte höchster Harmonie und je neue Art. Höchste Harmonie
 * über 100 zählt im Hain extra: +3 je Punkt (bis 115).“
 */
export function memoryRuleText(bonus: MemoryHarmonyBonus): string {
  const stage = STAGES[bonus.stage]?.name ?? 'Hain';
  return (
    `Waldgedächtnis: 1 Punkt je ${formatNumber(MEMORY_HARMONY_DIVISOR)} Punkte höchster Harmonie` +
    (MEMORY_PER_NEW_SPECIES === 1 ? ' und je neue Art. ' : ` und ${formatNumber(MEMORY_PER_NEW_SPECIES)} je neue Art. `) +
    `Höchste Harmonie über ${formatNumber(bonus.threshold)} zählt im ${stage} extra: +${formatNumber(MEMORY_PER_HARMONY_POINT)} je Punkt (bis ${formatNumber(bonus.fullAt)}).`
  );
}

/** Kurze Meldung, wenn „Neuer Zyklus“ gesperrt ist und der genaue Grund fehlt. */
export const CYCLE_LOCKED_TEXT = `Ein neuer Zyklus ist erst ab der Stufe „${STAGES[NEW_CYCLE_MIN_STAGE]?.name ?? 'Hain'}“ möglich.`;

/** Grund als Satz, z. B. „Ein neuer Zyklus ist ab der Stufe „Hain“ möglich (noch 14 Wegpunkte).“ */
export function newCycleBlockerText(blocker: NewCycleBlocker): string {
  const name = STAGES[blocker.stage]?.name ?? 'Hain';
  const left = blocker.waypointsLeft;
  const rest = left === 1 ? 'noch 1 Wegpunkt' : `noch ${formatNumber(left)} Wegpunkte`;
  return `Ein neuer Zyklus ist ab der Stufe „${name}“ möglich (${rest}).`;
}

/** Namen deutsch aufzählen: „A“, „A und B“, „A, B und C“. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/**
 * Meldung, wenn Stammgäste eingezogen sind, z. B. „Stammgast Maulwurf ist eingezogen.“;
 * leer, wenn niemand kam. Unbekannte IDs werden übersprungen.
 */
export function regularsArrivedText(ids: readonly string[]): string {
  const names = ids.map((id) => SPECIES_BY_ID.get(id)?.name).filter((n): n is string => !!n);
  if (names.length === 0) return '';
  return names.length === 1
    ? `Stammgast ${names[0]} ist eingezogen.`
    : `Stammgäste ${joinNames(names)} sind eingezogen.`;
}

/** Symbol und Name einer Art, z. B. „🌳 Stieleiche“ (unbekannt: Eiche). */
export function treeLabel(id: MainTreeId | string | undefined): string {
  const tree = MAIN_TREES_BY_ID.get(id as MainTreeId) ?? MAIN_TREES[0]!;
  return `${tree.icon} ${tree.name}`;
}

/**
 * Kurze Meldung nach dem Zyklusstart (Toast), mit eingezogenen Stammgästen. `mainTree`:
 * Art des neuen Zyklus – ihre Frucht keimt („Aus einer Buchecker wächst …“).
 */
export function newCycleToast(
  gain: number,
  cycleNumber: number,
  regulars: readonly string[] = [],
  mainTree: MainTreeId = 'oak',
): string {
  const text = `Zyklus ${formatNumber(cycleNumber)} beginnt: Aus ${fruitPhrase(mainTree)} wächst ein neuer Baum. +${formatNumber(gain)} Waldgedächtnis.`;
  return withRegulars(text, regulars);
}

/** Willkommens-Meldung um eingezogene Stammgäste ergänzen. */
export function withRegulars(text: string, regulars: readonly string[]): string {
  const arrived = regularsArrivedText(regulars);
  return arrived ? `${text} ${arrived}` : text;
}
