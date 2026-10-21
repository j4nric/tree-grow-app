/**
 * Warum ein Stammgast (noch) nicht einzieht (DESIGN_V2.md 10, 5.5; Playtest Amphibien,
 * offener Punkt 2). Reine Funktionen ohne DOM – die Regel selbst steht in
 * `moveInRegulars` (core/tick.ts): Einzug ab der Freischalt-Stufe, nur bei freiem Platz in
 * der Nische. Hier wird nur nachgelesen, woran es gerade hängt, und daraus ein kurzer Satz.
 *
 * Spoiler-Regel: Es geht nur um entdeckte Arten. Genannt werden Nische, Stufe und die
 * Pflege, die Plätze schafft (steht ohnehin am verschlossenen Waldtümpel); Ereignisse,
 * die ebenfalls Plätze bringen, bleiben eine Überraschung.
 */
import { CARE, type CareMeasure } from '../content/care';
import { NICHES_BY_ID } from '../content/niches';
import { SPECIES_BY_ID } from '../content/species';
import { STAGES } from '../content/stages';
import type { NicheId } from '../content/types';
import { nicheSlots, slotBonuses } from '../core/formulas';
import { allAnimals, type GameState } from '../core/state';

/** Grund, warum ein gewählter Stammgast gerade wartet. */
export type RegularWait =
  /** Die Nische hat keinen Platz und öffnet nicht mit dem Wachstum (Waldtümpel ohne Pflege). */
  | { kind: 'niche-closed'; niche: NicheId }
  /** Erst ab dieser Stufe (Freischalt-Stufe der Art oder Öffnung der Nische). */
  | { kind: 'stage'; stage: number }
  /** Nische offen, aber alle Plätze belegt. */
  | { kind: 'niche-full'; niche: NicheId }
  /** Alles frei – zieht am nächsten Wegpunkt ein (gerade erst gewählt). */
  | { kind: 'next-waypoint' };

/** Pflegemaßnahmen, deren erster Rang Plätze in der Nische schafft (z. B. „Waldtümpel“). */
function careOpeners(niche: NicheId): CareMeasure[] {
  return CARE.filter((m) =>
    m.ranks[0]?.effects.some((e) => e.kind === 'cycle' && e.effect.kind === 'slot' && e.effect.niche === niche && e.effect.amount > 0),
  );
}

/** Nischen ohne Plätze aus der Stufe: Sie öffnen in jedem Zyklus erst durch Pflege oder Ereignisse. */
export function nicheNeverOpensByStage(niche: NicheId): boolean {
  const n = NICHES_BY_ID.get(niche);
  return !!n && n.slots.every((s) => s <= 0);
}

/**
 * Warum der gewählte Stammgast `speciesId` gerade nicht im Ökosystem lebt. null, wenn er
 * nicht gewählt ist, schon hier lebt oder unbekannt ist. Prüft in der Reihenfolge, in der
 * der Spieler etwas tun kann: verschlossene Nische, Stufe, belegte Plätze.
 */
export function regularWaitReason(state: GameState, speciesId: string): RegularWait | null {
  const sp = SPECIES_BY_ID.get(speciesId);
  if (!sp || !state.meta.regulars.includes(speciesId)) return null;
  if (allAnimals(state).includes(speciesId)) return null;
  const slots = nicheSlots(state.stage, state.niches, slotBonuses(state))[sp.niche] ?? 0;
  if (slots <= 0) {
    // Öffnet die Nische später mit dem Wachstum, ist es ein Warten auf die Stufe.
    const levels = NICHES_BY_ID.get(sp.niche)?.slots ?? [];
    const opensAt = levels.findIndex((s, i) => i > state.stage && s > 0);
    if (opensAt >= 0) return { kind: 'stage', stage: Math.max(opensAt, sp.unlock) };
    return { kind: 'niche-closed', niche: sp.niche };
  }
  if (sp.unlock > state.stage) return { kind: 'stage', stage: sp.unlock };
  if ((state.niches[sp.niche]?.length ?? 0) >= slots) return { kind: 'niche-full', niche: sp.niche };
  return { kind: 'next-waypoint' };
}

/** „den Waldtümpel“ / „der Waldtümpel“ – sonst die Nische mit Namen. */
const NICHE_PHRASE: Partial<Record<NicheId, { acc: string; nom: string }>> = {
  pond: { acc: 'den Waldtümpel', nom: 'der Waldtümpel' },
};

function stageName(stage: number): string {
  return STAGES[stage]?.name ?? '?';
}

/**
 * Pflege, die die Nische öffnet, in Klammern, z. B. „(Pflege ab „Alter Baum“)“ – der Name
 * der Maßnahme nur, wenn er nicht schon der Name der Nische ist. Leer ohne Pflege.
 */
function careHint(niche: NicheId): string {
  const measure = careOpeners(niche)[0];
  if (!measure) return '';
  const at = stageName(measure.ranks[0]!.minStage);
  const name = NICHES_BY_ID.get(niche)?.name;
  return measure.name === name ? ` (Pflege ab „${at}“)` : ` (Pflege „${measure.name}“ ab „${at}“)`;
}

/**
 * Kurzer Satz zum Warten, z. B. „wartet auf den Waldtümpel“, „wartet auf „Alter Baum““.
 * Beim Waldtümpel vor der Stufe der Pflege mit Hinweis, ab wann sie geht.
 */
export function regularWaitText(state: GameState, wait: RegularWait): string {
  switch (wait.kind) {
    case 'niche-closed': {
      const phrase = NICHE_PHRASE[wait.niche];
      const measure = careOpeners(wait.niche)[0];
      const early = measure !== undefined && measure.ranks[0]!.minStage > state.stage;
      const hint = early ? careHint(wait.niche) : '';
      if (phrase) return `wartet auf ${phrase.acc}${hint}`;
      return `wartet, bis „${NICHES_BY_ID.get(wait.niche)?.name ?? wait.niche}“ Plätze hat${hint}`;
    }
    case 'stage':
      return `wartet auf „${stageName(wait.stage)}“`;
    case 'niche-full':
      return 'wartet auf einen freien Platz';
    case 'next-waypoint':
      return 'zieht am nächsten Wegpunkt ein';
  }
}

/**
 * Hinweis für die Wahl fürs nächste Mal: Arten, deren Nische in jedem Zyklus erst wieder
 * angelegt werden muss, z. B. „zieht erst ein, wenn der Waldtümpel wieder angelegt ist
 * (Pflege ab „Alter Baum“)“. null für alle anderen Arten.
 */
export function regularNextCycleHint(speciesId: string): string | null {
  const sp = SPECIES_BY_ID.get(speciesId);
  if (!sp || !nicheNeverOpensByStage(sp.niche)) return null;
  const phrase = NICHE_PHRASE[sp.niche];
  const hint = careHint(sp.niche);
  if (phrase) return `zieht erst ein, wenn ${phrase.nom} wieder angelegt ist${hint}`;
  return `zieht erst ein, wenn „${NICHES_BY_ID.get(sp.niche)?.name ?? sp.niche}“ wieder Plätze hat${hint}`;
}
