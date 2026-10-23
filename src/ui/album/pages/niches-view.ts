/**
 * Reine Zusammenstellungen für den Reiter „Nischen“ und seine Unterseiten (docs/ALBUM_UI.md,
 * B.1) – ohne DOM, getestet in tests/album-niches.test.ts. Zahlen über format.ts.
 */
import { HABITAT_NICHES } from '../../../content/habitats';
import { NICHES_BY_ID } from '../../../content/niches';
import { SEASONS_BY_ID } from '../../../content/seasons';
import { GENUS_INFO, SPECIES_BY_ID } from '../../../content/species';
import type { NicheId } from '../../../content/types';
import { regularSlotsOf } from '../../../core/formulas';
import type { GameState } from '../../../core/state';
import { regularBlocker } from '../../../core/tick';
import { HARMONY_TIERS, rarityKey } from '../../adapters';
import { formatNumber } from '../../format';
import type { AnimalDetailView, AnimalView, NicheView } from '../../view-model';

/** Lebensräume (eigener Abschnitt unter den Baum-Nischen): Waldtümpel und die Lebensräume aus 23.2. */
export const HABITAT_NICHE_IDS: ReadonlySet<string> = new Set(['pond', ...HABITAT_NICHES.map((n) => n.id)]);

/**
 * Blättert der Sticker zu U:Tier um? Nur bei eingezogenen Tieren (nicht bei freien Plätzen oder
 * durchreisenden Gästen – die zeigen eine Haftnotiz) und nur, wenn jemand umblättern kann.
 */
export function slotOpensDetails(animal: Pick<AnimalView, 'visitor'> | undefined, canOpen: boolean): boolean {
  return canOpen && animal !== undefined && !animal.visitor;
}

/** Nischen am Baum und Lebensräume getrennt, jeweils in der Reihenfolge der Ansicht. */
export function splitNiches<T extends Pick<NicheView, 'id'>>(niches: readonly T[]): { tree: T[]; habitats: T[] } {
  const tree: T[] = [];
  const habitats: T[] = [];
  for (const niche of niches) (HABITAT_NICHE_IDS.has(niche.id) ? habitats : tree).push(niche);
  return { tree, habitats };
}

/**
 * Verschlossen und (noch) nichts zu tun: kein Platz, kein Tier und kein „Zur Pflege ›“. Solche
 * Nischen fasst der Reiter in einer Zeile zusammen (Playtest Schritt 14, S10) – beim ersten
 * Start sonst eine Wand aus zehn grauen Zeilen. Verschlossene Lebensräume mit Pflege-Knopf
 * bleiben einzeln stehen, weil man dort etwas tun kann.
 */
export function isQuietLocked(niche: Pick<NicheView, 'capacity' | 'animals' | 'careLink'>): boolean {
  return niche.capacity <= 0 && niche.animals.length === 0 && !niche.careLink;
}

/**
 * Zeile über den zusammengefassten verschlossenen Nischen, z. B. „Noch 10 Nischen und der
 * Pflanzring verschlossen“; leer, wenn nichts verschlossen ist.
 */
export function lockedSummary(niches: number, ringLocked: boolean): string {
  const ring = ringLocked ? 'der Pflanzring' : '';
  if (niches <= 0) return ring ? 'Noch verschlossen: der Pflanzring' : '';
  const count = niches === 1 ? 'eine Nische' : `${formatNumber(niches)} Nischen`;
  return `Noch ${count}${ring ? ` und ${ring}` : ''} verschlossen`;
}

/** Zusatz unter der Zeile: Wann sich das Verschlossene öffnet. */
export const LOCKED_SUMMARY_HINT = 'Sie öffnen sich, während der Baum wächst.';

/**
 * Lesezeichen-Links „Lebensgemeinschaften“ und „Nahrungsnetz“ erst, wenn es dort etwas zu
 * sehen gibt: sobald ein Tier eingezogen ist oder eine Gemeinschaft entdeckt wurde (S10).
 */
export function ecosystemLinksVisible(niches: readonly Pick<NicheView, 'animals'>[], discoveredCommunities: number): boolean {
  return discoveredCommunities > 0 || niches.some((n) => n.animals.length > 0);
}

/**
 * Kennzahl im Seitenkopf: belegte von allen offenen Plätzen, z. B. „9 von 14 Plätzen“.
 * Durchreisende Gäste brauchen keinen Platz und zählen nicht mit.
 */
export function nichesPageHeader(niches: readonly Pick<NicheView, 'capacity' | 'animals'>[]): string {
  let used = 0;
  let total = 0;
  for (const niche of niches) {
    const capacity = Math.max(0, niche.capacity);
    total += capacity;
    used += Math.min(capacity, niche.animals.filter((a) => !a.visitor).length);
  }
  if (total <= 0) return 'noch keine Plätze';
  return `${formatNumber(used)} von ${formatNumber(total)} ${total === 1 ? 'Platz' : 'Plätzen'}`;
}

/** Eine Harmoniestufe für die Erklärung auf U:Harmonie. */
export interface HarmonyTierRow {
  label: string;
  /** „ab 30“ bzw. „unter 30“ für die unterste Stufe. */
  range: string;
  current: boolean;
}

/** Harmoniestufen von unten nach oben, die aktuelle markiert (DESIGN_V2.md 9.1). */
export function harmonyTierRows(harmony: number): HarmonyTierRow[] {
  const h = Number.isFinite(harmony) ? harmony : 0;
  const tiers = [...HARMONY_TIERS].reverse();
  const current = tiers.reduce((at, tier, i) => (h >= tier.min ? i : at), 0);
  return tiers.map((tier, i) => ({
    label: tier.label,
    range: Number.isFinite(tier.min) ? `ab ${formatNumber(tier.min)}` : `unter ${formatNumber(tiers[i + 1]?.min ?? 0)}`,
    current: i === current,
  }));
}

/**
 * „Zuerst gesehen: Zyklus 2, Sommer“ aus `meta.journal.firstSeen` (seit v15). Leer, wenn der
 * Stand den Wert nicht kennt (ältere Entdeckungen bekommen keinen erfundenen Wert).
 */
export function firstSeenText(state: Pick<GameState, 'meta'>, speciesId: string): string {
  const entry = state.meta.journal.firstSeen?.species?.[speciesId];
  if (!entry) return '';
  const season = SEASONS_BY_ID.get(entry.season)?.name;
  return `Zuerst gesehen: Zyklus ${formatNumber(entry.cycle)}${season ? `, ${season}` : ''}`;
}

/** Stammgast-Schalter auf U:Tier: wie im Tagebuch (null, solange es keine Stammgast-Plätze gibt). */
export function regularToggleView(state: GameState, speciesId: string): { selected: boolean; disabled: boolean } | null {
  if (regularSlotsOf(state) <= 0) return null;
  if (!state.meta.journal.species.includes(speciesId)) return null;
  const selected = state.meta.regulars.includes(speciesId);
  return { selected, disabled: !selected && regularBlocker(state, speciesId) !== null };
}

/** Was U:Tier auch ohne lebende Art zeigt (ausgezogen bzw. nur im Tagebuch): Kopf und Notiz. */
export type AnimalBasics = Pick<AnimalDetailView, 'id' | 'name' | 'family' | 'familyLabel' | 'familyIcon' | 'rarity' | 'nicheId' | 'nicheLabel' | 'text'>;

/** Grunddaten einer Art aus den Spielinhalten; null bei unbekannter ID. */
export function animalBasics(speciesId: string): AnimalBasics | null {
  const sp = SPECIES_BY_ID.get(speciesId);
  if (!sp) return null;
  const niche = NICHES_BY_ID.get(sp.niche as NicheId);
  return {
    id: sp.id,
    name: sp.name,
    family: sp.genus,
    familyLabel: GENUS_INFO[sp.genus].name,
    familyIcon: GENUS_INFO[sp.genus].icon,
    rarity: rarityKey(sp.rarity),
    nicheId: sp.niche,
    nicheLabel: niche ? `${niche.icon} ${niche.name}` : sp.niche,
    text: sp.text,
  };
}
