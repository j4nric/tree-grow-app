/**
 * View-Model für den Bereich „Neuer Zyklus“ und die Stammgäste-Auswahl
 * (DESIGN_V2.md, Abschnitt 10). Reine Funktionen ohne DOM – testbar mit Vitest.
 * Die Seite dazu steht in album/pages/cycle-page.ts.
 */
import { treeWeatherText } from './weather-view';
import {
  FOREST_MEMORY_BONUS,
  MEMORY_PER_HARMONY_POINT,
  MEMORY_PER_NEW_SPECIES,
  NEW_CYCLE_MIN_STAGE,
} from '../content/memory';
import { NICHES_BY_ID } from '../content/niches';
import { GENUS_INFO, SPECIES_BY_ID } from '../content/species';
import { STAGES } from '../content/stages';
import { MAIN_TREES, MAIN_TREES_BY_ID, type MainTreeId } from '../content/trees';
import { memoryHarmonyBonus, regularSlotsOf, type MemoryHarmonyBonus } from '../core/formulas';
import { effectiveForestMemory } from '../core/landscape';
import { allAnimals, type GameState } from '../core/state';
import { previewNewCycle, regularBlocker, type NewCycleBlocker } from '../core/tick';
import { formatNumber } from './format';
import { regularNextCycleHint, regularWaitReason, regularWaitText } from './regular-wait';
import { activeSiteLabel, toLandscapeMapView, type LandscapeMapView, type LandscapeSiteView } from './landscape-view';

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
  /**
   * Kurzer Hinweis unter dem Knopf: als gewählter Stammgast, der noch nicht hier lebt,
   * warum er wartet („wartet auf den Waldtümpel“); sonst für Arten, deren Nische in jedem
   * Zyklus neu angelegt werden muss, wann sie einziehen. null ohne Hinweis.
   */
  note: string | null;
  /** `note` ist ein Warte-Status im laufenden Zyklus. */
  waiting: boolean;
}

/** Eine Hauptbaum-Art in der Auswahl beim Neuen Zyklus (DESIGN_V2.md 17.2). */
export interface TreeOptionView {
  id: MainTreeId;
  /** z. B. „Rotbuche“. */
  name: string;
  icon: string;
  /** Eigenheit in Kurzform (trees.ts `summary`, dazu z. B. „trotzt Frost 🧊“). */
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
  /** Regel für das Waldgedächtnis mit der Schwelle des erreichten Wegpunkts (immer sichtbar), siehe memoryRuleText. */
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
  /** Karte der Landschaft (DESIGN_V2.md 24.5); null, solange sie verborgen ist. */
  landscape: LandscapeMapView | null;
}

/**
 * Baumwahl für ein Ziel in der Landschaft (DESIGN_V2.md 25.2): Ohne Ziel (hier weiter) gelten
 * `view.trees` und `view.defaultTree`. Mit Ziel (gründen oder wechseln) gelten die dort
 * wählbaren Arten (`site.unlockedTrees` – eine Gründung schaltet ihren Leitbaum frei); die
 * Vorauswahl ist die des Waldes (Leitbaum bzw. zuletzt dort), wenn wählbar, sonst wie ohne Ziel.
 */
export function treeChoiceFor(
  view: Pick<CyclePanelView, 'trees' | 'defaultTree'>,
  site: Pick<LandscapeSiteView, 'mainTree' | 'unlockedTrees'> | undefined,
): { trees: TreeOptionView[]; current: MainTreeId } {
  if (!site) return { trees: view.trees, current: view.defaultTree };
  const open = new Set(site.unlockedTrees);
  const trees = view.trees.map((t) => {
    const unlocked = open.has(t.id);
    return unlocked === t.unlocked ? t : { ...t, unlocked, hint: unlocked ? null : (MAIN_TREES_BY_ID.get(t.id)?.unlockHint ?? null) };
  });
  const usable = (id: MainTreeId) => trees.some((t) => t.id === id && t.unlocked);
  const current = usable(site.mainTree) ? site.mainTree : usable(view.defaultTree) ? view.defaultTree : (trees.find((t) => t.unlocked)?.id ?? view.defaultTree);
  return { trees, current };
}

/** „einer Eichel“, „einer Buchecker“, „einem Kiefernsamen“ (Dativ der Frucht). */
const FRUIT_ARTICLE: Record<MainTreeId, string> = { oak: 'einer', beech: 'einer', pine: 'einem', fir: 'einem', alder: 'einem' };

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
  // Plätze aus dem wirksamen Gedächtnis (mit Korridor-Zufluss, 24.6).
  const slots = regularSlotsOf(state);
  const landscape = toLandscapeMapView(state, preview);
  const newSlots = preview.regularSlotsAfter - preview.regularSlotsBefore;
  const species = preview.newSpecies === 1 ? '1 neue Art' : `${formatNumber(preview.newSpecies)} neue Arten`;
  const present = new Set(allAnimals(state));
  const regulars: RegularOptionView[] = [];
  for (const id of state.meta.journal.species) {
    const sp = SPECIES_BY_ID.get(id);
    if (!sp) continue;
    const selected = state.meta.regulars.includes(id);
    const wait = regularWaitReason(state, id);
    regulars.push({
      id,
      name: sp.name,
      icon: GENUS_INFO[sp.genus].icon,
      niche: NICHES_BY_ID.get(sp.niche)?.name ?? '',
      selected,
      disabled: !selected && regularBlocker(state, id) !== null,
      present: present.has(id),
      note: wait ? regularWaitText(state, wait) : regularNextCycleHint(id),
      waiting: wait !== null,
    });
  }
  return {
    // Mit offener Landschaft: in welchem Wald der Zyklus wächst.
    title: landscape ? `Zyklus ${formatNumber(state.cycle.number)} · ${activeSiteLabel(state)}` : `Zyklus ${formatNumber(state.cycle.number)}`,
    allowed,
    blocker: preview.blocker ? newCycleBlockerText(preview.blocker) : null,
    gain: allowed ? `+${formatNumber(preview.memoryGain)} Waldgedächtnis (${memoryBonusLabel(preview.memoryGain)})` : null,
    gainDetail: allowed ? `Höchste Harmonie ${formatNumber(Math.round(preview.maxHarmony))} · ${species}` : null,
    memoryRule: memoryRuleText(preview.harmonyBonus),
    slotsGain: allowed && newSlots > 0 ? (newSlots === 1 ? '+1 Platz für Stammgäste' : `+${newSlots} Plätze für Stammgäste`) : null,
    memory: memoryLineText(state),
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
        // Raue Lagen, gegen die die Art gefeit ist (Kiefer: Frost, DESIGN_V2.md 21.3).
        summary: [t.summary, treeWeatherText(t.id)].filter(Boolean).join(' · '),
        unlocked,
        hint: unlocked ? null : t.unlockHint,
        current: id === preview.mainTree,
      };
    }),
    landscape,
  };
}

/**
 * Bestand des Waldgedächtnisses mit Bonus aus dem **wirksamen** Gedächtnis (24.6), z. B.
 * „Waldgedächtnis 30 · +60 % Wachstum und Samen“ bzw. mit Korridoren „Waldgedächtnis 300
 * (+150 über Korridore) · +900 % Wachstum und Samen“.
 */
export function memoryLineText(state: Pick<GameState, 'meta'>): string {
  const own = state.meta.forestMemory;
  const effective = effectiveForestMemory(state);
  const inflow = effective > own ? ` (+${formatNumber(effective - own)} über Korridore)` : '';
  return `Waldgedächtnis ${formatNumber(own)}${inflow} · ${memoryBonusLabel(effective)} Wachstum und Samen`;
}

/** Schlüssel, der sich nur ändert, wenn die Ansicht neu gebaut werden muss (spart DOM-Arbeit). */
export function cycleViewKey(view: CyclePanelView): string {
  return JSON.stringify(view);
}

/**
 * Regel für das Waldgedächtnis (Schritt 2.11, gleitende Schwelle seit 2.11b, gleitender
 * Sockel-Teiler seit dem Abgleich mit der Sperrklinke, content/memory.ts) mit Teiler,
 * Schwelle und Obergrenze des erreichten Wegpunkts (vor dem Hain: die des Hains), z. B.
 * „Waldgedächtnis: 1 Punkt je 5,4 Punkte höchster Harmonie und je neue Art. Höchste Harmonie
 * ab 119 zählt extra: etwa +3 je Punkt (bis 134). Die Schwelle steigt mit dem Wachstum bis
 * 164 im Urwald, dort 1 Punkt je 7 – Erreichtes bleibt.“ (Wegpunkt 23; der Teiler 5,375 wird
 * auf eine Stelle gerundet.) Sperrklinke seit v10: die Vorschau sinkt nie, auch wenn die
 * Schwelle steigt; ein eigener Hinweis „bester Wert“ wäre eher verwirrend. Genannt wird die
 * erste ganze Harmonie, die wirklich mehr als den Sockel bringt (bonusFrom; an krummen
 * Schwellen kann das ⌈T⌉ + 1 sein). Der letzte Satz fehlt, sobald die Schwelle oben
 * angekommen ist.
 */
export function memoryRuleText(bonus: MemoryHarmonyBonus): string {
  const top = memoryHarmonyBonus(Infinity);
  const last = STAGES[STAGES.length - 1]?.name ?? 'Urwald';
  const later = top.divisor !== bonus.divisor ? `, dort 1 Punkt je ${formatNumber(top.divisor)}` : '';
  return (
    `Waldgedächtnis: 1 Punkt je ${formatNumber(bonus.divisor)} Punkte höchster Harmonie` +
    (MEMORY_PER_NEW_SPECIES === 1 ? ' und je neue Art. ' : ` und ${formatNumber(MEMORY_PER_NEW_SPECIES)} je neue Art. `) +
    `Höchste Harmonie ab ${formatNumber(bonus.bonusFrom)} zählt extra: etwa +${formatNumber(MEMORY_PER_HARMONY_POINT)} je Punkt (bis ${formatNumber(bonus.fullAt)}).` +
    (bonus.threshold < top.threshold ? ` Die Schwelle steigt mit dem Wachstum bis ${formatNumber(Math.floor(top.threshold))} im ${last}${later} – Erreichtes bleibt.` : '')
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
