/**
 * Warum ein Stammgast (noch) nicht einzieht (DESIGN_V2.md 10, 5.5; Playtest Amphibien,
 * offener Punkt 2). Reine Funktionen ohne DOM – die Regel selbst steht in
 * `moveInRegulars` (core/tick.ts): Einzug ab der Freischalt-Stufe, nur bei freiem Platz in
 * der Nische. Hier wird nur nachgelesen, woran es gerade hängt, und daraus ein kurzer Satz.
 *
 * Spoiler-Regel: Es geht nur um entdeckte Arten. Genannt werden Nische, Stufe und die
 * Forschung, die Plätze schafft (steht ohnehin am verschlossenen Waldtümpel); Ereignisse,
 * die ebenfalls Plätze bringen, bleiben eine Überraschung.
 */
import { RESEARCH, RESEARCH_BY_ID, type ResearchNode } from '../content/research';
import { NICHES_BY_ID } from '../content/niches';
import { SPECIES_BY_ID } from '../content/species';
import { STAGES } from '../content/stages';
import type { NicheId } from '../content/types';
import { nicheSlots, slotBonuses } from '../core/formulas';
import { allAnimals, type GameState } from '../core/state';

/** Grund, warum ein gewählter Stammgast gerade wartet. */
export type RegularWait =
  /** Die Nische hat keinen Platz und öffnet nicht mit dem Wachstum (Waldtümpel ohne Forschung). */
  | { kind: 'niche-closed'; niche: NicheId }
  /** Erst ab dieser Stufe (Freischalt-Stufe der Art oder Öffnung der Nische). */
  | { kind: 'stage'; stage: number }
  /** Nische offen, aber alle Plätze belegt. */
  | { kind: 'niche-full'; niche: NicheId }
  /** Alles frei – zieht am nächsten Wegpunkt ein (gerade erst gewählt). */
  | { kind: 'next-waypoint' };

/** Schafft der Knoten Plätze in dieser Nische? */
function opensNiche(node: ResearchNode, nicheId: NicheId): boolean {
  return node.effects.some((e) => e.kind === 'cycle' && e.effect.kind === 'slot' && e.effect.niche === nicheId && e.effect.amount > 0);
}

/**
 * Forschungsknoten, die als erste Plätze in der Nische schaffen (z. B. „Waldtümpel“, nicht
 * „Tümpel vertiefen“, das am Waldtümpel hängt), in RESEARCH-Reihenfolge. Bis v16 der erste
 * Rang einer Pflegemaßnahme.
 */
export function researchSlotNodes(nicheId: NicheId): ResearchNode[] {
  return RESEARCH.filter(
    (n) =>
      opensNiche(n, nicheId) &&
      ![...(n.requires ?? []), ...(n.requiresAny ?? [])].some((id) => {
        const req = RESEARCH_BY_ID.get(id);
        return !!req && opensNiche(req, nicheId);
      }),
  );
}

/** Nischen ohne Plätze aus der Stufe: Sie öffnen in jedem Zyklus erst durch Forschung oder Ereignisse. */
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
  // Lebensräume (DESIGN_V2.md 23): wie der Tümpel in jedem Zyklus neu angelegt.
  meadow: { acc: 'die Waldwiese', nom: 'die Waldwiese' },
  deadwood: { acc: 'den Totholzhaufen', nom: 'der Totholzhaufen' },
  wall: { acc: 'die Trockenmauer', nom: 'die Trockenmauer' },
};

function stageName(stage: number): string {
  return STAGES[stage]?.name ?? '?';
}

/**
 * Forschung, die die Nische öffnet, in Klammern, z. B. „(Forschung ab „Alter Baum“)“ – der
 * Name des Knotens nur, wenn er nicht schon der Name der Nische ist. Leer ohne Forschung.
 */
function careHint(niche: NicheId): string {
  const measure = researchSlotNodes(niche)[0];
  if (!measure) return '';
  const at = stageName(measure.minStage);
  const name = NICHES_BY_ID.get(niche)?.name;
  return measure.name === name ? ` (Forschung ab „${at}“)` : ` (Forschung „${measure.name}“ ab „${at}“)`;
}

/**
 * Kurzer Satz zum Warten, z. B. „wartet auf den Waldtümpel“, „wartet auf „Alter Baum““.
 * Beim Waldtümpel vor der Stufe der Forschung mit Hinweis, ab wann sie geht.
 */
export function regularWaitText(state: GameState, wait: RegularWait): string {
  switch (wait.kind) {
    case 'niche-closed': {
      const phrase = NICHE_PHRASE[wait.niche];
      const measure = researchSlotNodes(wait.niche)[0];
      const early = measure !== undefined && measure.minStage > state.stage;
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
 * angelegt werden muss, z. B. „zieht im nächsten Zyklus erst ein, wenn der Waldtümpel wieder angelegt ist
 * (Forschung ab „Alter Baum“)“. null für alle anderen Arten.
 */
export function regularNextCycleHint(speciesId: string): string | null {
  const sp = SPECIES_BY_ID.get(speciesId);
  if (!sp || !nicheNeverOpensByStage(sp.niche)) return null;
  const phrase = NICHE_PHRASE[sp.niche];
  const hint = careHint(sp.niche);
  if (phrase) return `zieht im nächsten Zyklus erst ein, wenn ${phrase.nom} wieder angelegt ist${hint}`;
  return `zieht im nächsten Zyklus erst ein, wenn „${NICHES_BY_ID.get(sp.niche)?.name ?? sp.niche}“ wieder Plätze hat${hint}`;
}
