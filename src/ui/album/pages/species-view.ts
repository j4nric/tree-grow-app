/**
 * Reine Zusammenstellungen für den Reiter „Arten“ (docs/ALBUM_UI.md, B.2) – ohne DOM,
 * getestet in tests/album-species.test.ts. Die Einträge selbst kommen aus `toJournalView`
 * (adapters.ts); hier stehen nur Gruppierung, Kennzahlen, Sticker-Variante und die Texte der
 * Haftnotizen. Zahlen über format.ts.
 *
 * Spoiler-Regel (DESIGN_V2.md 11.2): Unentdeckte Arten verraten Gattung und Seltenheit, nie
 * Namen oder ID. Die Zeichnung der Silhouette braucht die echte ID – sie bleibt im Skript
 * (`drawIds`) und landet nie im DOM.
 */
import { NICHES_BY_ID } from '../../../content/niches';
import { GENUS_INFO, SPECIES } from '../../../content/species';
import { STAGES } from '../../../content/stages';
import type { Genus, NicheId } from '../../../content/types';
import { regularSlotsOf } from '../../../core/formulas';
import type { GameState } from '../../../core/state';
import type { StickerVariant } from '../../../render/sticker';
import { formatNumber } from '../../format';
import type { JournalEntryView } from '../../view-model';

/** Gattungen in Anzeige-Reihenfolge (wie die Gattungsleiste im Reiter Nischen). */
export const GENUS_ORDER: readonly Genus[] = Object.keys(GENUS_INFO) as Genus[];

/** Kennzahl im Seitenkopf: „23 von 53 Arten“ (eine Art: „1 von 1 Art“). */
export function speciesPageHeader(found: number, total: number): string {
  return `${formatNumber(found)} von ${formatNumber(total)} ${total === 1 ? 'Art' : 'Arten'}`;
}

/** Zähler einer Gruppe: „3 von 8“. */
export function ofCount(found: number, total: number): string {
  return `${formatNumber(found)} von ${formatNumber(total)}`;
}

/** Eine Gattung im Sticker-Raster: Indizes in `JournalView.species` (= Reihenfolge von SPECIES). */
export interface SpeciesGroup {
  genus: Genus;
  icon: string;
  label: string;
  indices: number[];
}

/**
 * Arten nach Gattung gruppiert (GENUS_ORDER), innerhalb der Gattung in der Reihenfolge der
 * Spielinhalte. Fest für die ganze Sitzung – das Raster wird einmal gebaut.
 */
export function speciesGroups(species: readonly { genus: Genus }[] = SPECIES): SpeciesGroup[] {
  const groups: SpeciesGroup[] = [];
  for (const genus of GENUS_ORDER) {
    const indices: number[] = [];
    species.forEach((sp, i) => {
      if (sp.genus === genus) indices.push(i);
    });
    if (indices.length > 0) groups.push({ genus, icon: GENUS_INFO[genus].icon, label: GENUS_INFO[genus].name, indices });
  }
  return groups;
}

/**
 * Geschätzte Höhe eines Sticker-Rasters für `content-visibility: auto` (species-page.css),
 * bis der Browser sie einmal gemessen hat: fünf Spalten (mobil), je Zeile gut 80 px, dazu
 * die Überschrift. Nur für Bildlaufleiste und Sprungmarken wichtig, nicht fürs Aussehen.
 */
export function gridHeightEstimate(cells: number, header = 30): number {
  return header + Math.ceil(Math.max(0, cells) / 5) * 82;
}

/** Wie viele der Einträge an den Indizes entdeckt sind. */
export function discoveredIn(entries: readonly Pick<JournalEntryView, 'discovered'>[], indices: readonly number[]): number {
  let n = 0;
  for (const i of indices) if (entries[i]?.discovered) n++;
  return n;
}

/**
 * Bild des Stickers: farbig, wenn die Art gerade im Wald lebt; matt, wenn sie entdeckt, aber
 * nicht da ist; Silhouette, solange sie unentdeckt ist.
 */
export function speciesStickerVariant(entry: Pick<JournalEntryView, 'discovered' | 'present'>): StickerVariant {
  if (!entry.discovered) return 'silhouette';
  return entry.present ? 'color' : 'muted';
}

/** Inhalt einer Haftnotiz (Titel und Absätze). */
export interface SpeciesNoteText {
  title: string;
  lines: string[];
}

/**
 * Hinweis zu einer Silhouette (statt eines Spoilers): Gattung, Seltenheit, Lebensraum und
 * wann bzw. wie die Art auftauchen kann – nie Name oder ID.
 */
export function silhouetteHint(state: Pick<GameState, 'stage'>, speciesIndex: number): SpeciesNoteText {
  const sp = SPECIES[speciesIndex];
  if (!sp) return { title: 'Unentdeckte Art', lines: [] };
  const genus = GENUS_INFO[sp.genus];
  const rarity = ['gewöhnliche', 'seltene', 'besondere', 'legendäre'][sp.rarity] ?? '';
  const niche = NICHES_BY_ID.get(sp.niche as NicheId);
  const lines = [`Eine ${rarity} Art aus der Gattung ${genus.icon} ${genus.name}.`];
  if (niche) lines.push(`Sie sucht einen Platz in „${niche.icon} ${niche.name}“.`);
  const unlock = STAGES[sp.unlock];
  if (unlock && state.stage < sp.unlock) lines.push(`Sie zeigt sich frühestens ab der Stufe „${unlock.name}“.`);
  else if (sp.appears && sp.appears.length > 0) lines.push('Sie kommt erst, wenn der Wald ihr besondere Bedingungen bietet.');
  else lines.push('Sie kann schon jetzt als Begegnung auftauchen – halte die Augen offen.');
  return { title: '??? · noch unentdeckt', lines };
}

/** Haftnotiz zu einer Pflanze im Raster: Fakten und Naturtext bzw. der Hinweis „ab …“. */
export function plantNote(entry: Pick<JournalEntryView, 'discovered' | 'name' | 'facts' | 'text' | 'present'>): SpeciesNoteText {
  if (!entry.discovered) {
    return { title: '??? · noch unentdeckt', lines: [`Keimt ${entry.facts.join(' · ')}. Setze Pflanzen oder warte auf Begegnungen.`] };
  }
  const lines = [entry.facts.join(' · ')];
  if (entry.text) lines.push(entry.text);
  if (entry.present) lines.push('Wächst gerade hier.');
  return { title: entry.name, lines };
}

/**
 * Billiger Schlüssel: Ändert er sich nicht (und auch nicht die Auswertung), bleibt die ganze
 * Seite, wie sie ist – `toJournalView` läuft nur bei Entdeckungen, Stammgästen, Ein- und
 * Auszügen, Stufen- und Zykluswechsel.
 */
export function speciesPageKey(state: GameState): string {
  const j = state.meta.journal;
  return JSON.stringify([
    j.species,
    j.plants,
    j.communities,
    j.keepsakes,
    state.meta.regulars,
    regularSlotsOf(state),
    state.meta.forestMemory,
    state.meta.stats.grownTrees,
    state.meta.landscape.sites.map((s) => s.id),
    state.meta.landscape.active,
    state.meta.landscape.corridors,
    state.meta.achievements.length,
    state.cycle.number,
    state.cycle.mainTree,
    state.stage,
    state.plants,
  ]);
}
