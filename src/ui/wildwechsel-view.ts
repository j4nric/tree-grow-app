/**
 * Wildwechsel in der Oberfläche (DESIGN_V2.md 24.6, Roadmap Phase 7 → 1c): Texte für die
 * Begegnungskarte („🦌 kommt über die Schlehenhecke aus den Buchenhallen“), die Chance am
 * aktiven Wald und den Rückkehr-Bericht – dazu die Markierung, welche Karte einer offenen
 * Begegnung als Wildwechsel kam.
 *
 * Reine Ansichtslogik ohne DOM (Tests: tests/wildwechsel-view.test.ts). Die Regeln (Chance,
 * Wege, Bestand) kommen aus core/landscape.ts.
 *
 * Markierung: Seit Spielstand v15 steht an der Begegnung, welche Karte per Wildwechsel kam
 * (`PendingEncounter.via`, auch nach dem Neuladen; Neu würfeln löscht es) – `wildwechselMarkOf`
 * liest sie. Die Markierung aus dem TickReport (WeakMap am Objekt der Begegnung) nennt dazu den
 * Herkunftswald direkt; beide ergeben dieselbe Karte. Nie `wildwechselRoute` raten – das nennt
 * auch gewöhnlich gezogene Arten eines Nachbarn.
 */
import { CORRIDORS_BY_ID, LANDSCAPE_SITES_BY_ID, WILDWECHSEL_CHANCE, WILDWECHSEL_MAX_CHANCE, type SiteId } from '../content/landscape';
import { activeSite, landscapeOf, wildwechselChance } from '../core/landscape';
import type { GameState, LandscapeState, PendingEncounter } from '../core/state';
import type { WildwechselCard } from '../core/tick';
import { formatNumber } from './format';
import type { EncounterView } from './view-model';

/** Symbol des Wildwechsels (immer mit Text, nie allein). */
export const WILDWECHSEL_ICON = '🦌';

/**
 * Weg mit Präposition und Artikel im Akkusativ, z. B. „über die Schlehenhecke“. Fehlt ein
 * Korridor hier (neue Daten), gilt „über den Korridor „Name““ – nie ein falscher Artikel.
 */
const CORRIDOR_VIA: Readonly<Record<string, string>> = {
  'home-floodplain': 'über den Mühlbach',
  'home-carr': 'über den Wiesengraben',
  'home-beechwood': 'über die Schlehenhecke',
  'home-mountain': 'durch den Hohlweg',
  'home-heath': 'über die Feldhecke',
  'floodplain-carr': 'über das Altwasser',
  'carr-heath': 'über die Grünbrücke',
  'heath-beechwood': 'über die Wallhecke',
  'beechwood-mountain': 'über den Wildpfad',
  'mountain-floodplain': 'durch die Bachschlucht',
};

/** Herkunft mit Artikel im Dativ, z. B. „aus den Buchenhallen“. */
const SITE_FROM: Readonly<Record<SiteId, string>> = {
  home: 'aus dem Heimatwald',
  floodplain: 'aus dem Auwald am Fluss',
  carr: 'aus dem Erlenbruch',
  beechwood: 'aus den Buchenhallen',
  mountain: 'aus dem Bergmischwald',
  heath: 'aus der Kiefernheide',
};

/** Ort mit Artikel im Dativ, z. B. „in der Kiefernheide“. */
const SITE_IN: Readonly<Record<SiteId, string>> = {
  home: 'im Heimatwald',
  floodplain: 'im Auwald am Fluss',
  carr: 'im Erlenbruch',
  beechwood: 'in den Buchenhallen',
  mountain: 'im Bergmischwald',
  heath: 'in der Kiefernheide',
};

const siteName = (id: SiteId): string => LANDSCAPE_SITES_BY_ID.get(id)?.name ?? id;

/** „über die Schlehenhecke“ (unbekannt: „über den Korridor …“). */
export function corridorViaText(corridor: string): string {
  const known = CORRIDOR_VIA[corridor];
  if (known) return known;
  const name = CORRIDORS_BY_ID.get(corridor)?.name;
  return name ? `über den Korridor „${name}“` : 'über einen Korridor';
}

/** „aus den Buchenhallen“ (unbekannt: „aus „Name““). */
export function siteFromText(site: SiteId): string {
  return SITE_FROM[site] ?? `aus „${siteName(site)}“`;
}

/** „in der Kiefernheide“ (unbekannt: „in „Name““). */
export function siteInText(site: SiteId): string {
  return SITE_IN[site] ?? `in „${siteName(site)}“`;
}

/** Was auf der Karte steht – ohne Symbol: „kommt über die Schlehenhecke aus den Buchenhallen“. */
export function wildwechselCardText(route: { corridor: string; from: SiteId }): string {
  return `kommt ${corridorViaText(route.corridor)} ${siteFromText(route.from)}`;
}

/** Prozent deutsch, z. B. „20 %“. */
const pct = (fraction: number) => `${formatNumber(Math.round(fraction * 1000) / 10)} %`;

/**
 * Wildwechsel am aktiven Wald für Karte und Korridor-Liste: mit Korridor „🦌 Wildwechsel
 * im Heimatwald: 20 % je Tierbegegnung“; ohne Korridor am aktiven Wald, aber mit einem
 * baubaren (`corridorPossible`), ein Hinweis; sonst null.
 */
export function wildwechselChanceText(state: { meta: { landscape?: LandscapeState } }, corridorPossible: boolean): string | null {
  const chance = wildwechselChance(state);
  const where = siteInText(activeSite(landscapeOf(state)));
  if (chance > 0) return `${WILDWECHSEL_ICON} Wildwechsel ${where}: ${pct(chance)} je Tierbegegnung`;
  if (!corridorPossible) return null;
  return `${WILDWECHSEL_ICON} Wildwechsel: Baue einen Korridor zu einem Nachbarwald, dann wechseln von dort Tiere zu dir – ${pct(WILDWECHSEL_CHANCE)} je Korridor, höchstens ${pct(WILDWECHSEL_MAX_CHANCE)}.`;
}

/**
 * Zusatz für einen gebauten Korridor am aktiven Wald, dessen Nachbar Tiere im Bestand hat:
 * „🦌 Wildwechsel aus den Buchenhallen (7 Arten im Bestand)“. Sonst null.
 */
export function corridorWildwechselText(from: SiteId, fauna: number): string | null {
  if (!(fauna > 0)) return null;
  const count = fauna === 1 ? '1 Art' : `${formatNumber(fauna)} Arten`;
  return `${WILDWECHSEL_ICON} Wildwechsel ${siteFromText(from)} (${count} im Bestand)`;
}

/** Rückkehr-Bericht: wie viele wartende Begegnungen ein Tier über einen Korridor bringen (0: null). */
export function wildwechselReturnText(count: number): string | null {
  if (!(count > 0)) return null;
  return count === 1
    ? `${WILDWECHSEL_ICON} Wildwechsel: Eine Begegnung bringt ein Tier über einen Korridor aus dem Nachbarwald.`
    : `${WILDWECHSEL_ICON} Wildwechsel: ${formatNumber(count)} Begegnungen bringen Tiere über Korridore aus Nachbarwäldern.`;
}

// ---------------------------------------------------------------------------
// Markierung der Wildwechsel-Karten offener Begegnungen (nur in der Oberfläche)
// ---------------------------------------------------------------------------

/** Welche Karte einer offenen Begegnung als Wildwechsel kam. */
export interface WildwechselMark {
  species: string;
  from: SiteId;
  corridor: string;
  /** Index in `cards` der Begegnung. */
  card: number;
}

export interface WildwechselMarks {
  /**
   * Merkt sich die Karten aus `TickReport.wildwechsel` bzw. `OfflineReport.wildwechsel` –
   * direkt nach dem Tick aufrufen (dann gelten die Indizes). Gibt die Zahl der gemerkten zurück.
   */
  record(encounters: readonly PendingEncounter[], cards: readonly WildwechselCard[]): number;
  /** Markierung einer Begegnung – null, wenn keine (mehr) gilt. */
  lookup(encounter: PendingEncounter | undefined): WildwechselMark | null;
}

export function createWildwechselMarks(): WildwechselMarks {
  /** Je Begegnungs-Objekt die Markierung und das `cards`-Feld, zu dem sie gehört. */
  const marks = new WeakMap<PendingEncounter, { mark: WildwechselMark; cards: readonly string[] }>();
  return {
    record(encounters, cards) {
      let n = 0;
      for (const c of cards) {
        const encounter = encounters[c.encounter];
        // Nur, wenn Begegnung und Karte zum Bericht passen (sonst lieber keine Markierung).
        if (!encounter || encounter.type !== 'animal' || encounter.cards[c.card] !== c.species) continue;
        marks.set(encounter, { mark: { species: c.species, from: c.from, corridor: c.corridor, card: c.card }, cards: encounter.cards });
        n++;
      }
      return n;
    },
    lookup(encounter) {
      if (!encounter) return null;
      const entry = marks.get(encounter);
      if (!entry) return null;
      // Neu gewürfelt (neues Feld) oder Karte verändert: Die Markierung gilt nicht mehr.
      if (encounter.cards !== entry.cards || encounter.cards[entry.mark.card] !== entry.mark.species) {
        marks.delete(encounter);
        return null;
      }
      return entry.mark;
    },
  };
}

/**
 * Markierung aus dem Spielstand (`PendingEncounter.via`, seit v15): Art = Karte am Index, Herkunft =
 * das andere Ende des Korridors (er liegt am aktiven Wald – das prüft das Laden). Sonst null.
 */
export function wildwechselMarkOf(state: Pick<GameState, 'meta'>, encounter: PendingEncounter | undefined): WildwechselMark | null {
  const via = encounter?.type === 'animal' ? encounter.via : undefined;
  if (!encounter || !via) return null;
  const species = encounter.cards[via.card];
  const active = activeSite(landscapeOf(state));
  const corridor = CORRIDORS_BY_ID.get(via.corridor);
  const from = corridor?.sites.includes(active) ? corridor.sites.find((s) => s !== active) : undefined;
  if (species === undefined || from === undefined) return null;
  return { species, from, corridor: via.corridor, card: via.card };
}

/** Hängt den Weg an die passende Karte der Ansicht (über die Art – leere Karten fallen dort weg). */
export function applyWildwechselMark(view: EncounterView, mark: WildwechselMark | null): void {
  if (!mark || view.kind !== 'animal') return;
  const card = view.cards.find((c) => c.id === mark.species);
  if (card) card.route = wildwechselCardText(mark);
}
