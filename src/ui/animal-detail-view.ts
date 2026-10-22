/**
 * View-Model der Tierdetails (Klick auf eine eingezogene Art in der Seitenleiste oder –
 * später – in der Szene). Reine Funktionen ohne DOM, getestet in tests/animal-detail.test.ts.
 *
 * Alle Zahlen kommen aus der Auswertung des Kerns (`evaluate`, `evaluateEcosystem`,
 * `environmentEffects`); hier stehen nur Texte, Symbole und Reihenfolge. Der Beitrag einer
 * Art ist der Unterschied zwischen dem Ökosystem jetzt und demselben Ökosystem ohne sie –
 * genau wie die Vorschau auf der Begegnungskarte (`previewView`).
 */
import { isNight } from '../core/weather';
import { nightBadge, nightDetailText } from './weather-view';
import { ABILITY_INFO, ARCHITECT, CALM_MIN_HAPPINESS, DECOMPOSER_BOOST } from '../content/abilities';
import { COMMUNITIES } from '../content/communities';
import { NICHES_BY_ID } from '../content/niches';
import { OVERHUNT_PENALTY } from '../content/predation';
import { SEASONS_BY_ID } from '../content/seasons';
import { BASE_HAPPINESS, GENUS_INFO, RARITY_NAMES, SPECIES_BY_ID, TAG_NAMES, type Species } from '../content/species';
import type { NicheId } from '../content/types';
import {
  DISTURB_PENALTY,
  ecosystemOf,
  environmentEffects,
  evaluate,
  evaluateEcosystem,
  mainTreeOf,
  memberOptions,
  nicheOverflow,
  regularSlotsOf,
  slotBonuses,
  slotEffects,
  type AnimalStatus,
  type Evaluation,
} from '../core/formulas';
import { seasonIdAt } from '../core/season';
import { activeSite, giftSites } from '../core/landscape';
import { LANDSCAPE_SITES_BY_ID } from '../content/landscape';
import { allAnimals, type GameState } from '../core/state';
import { regularNextCycleHint } from './regular-wait';
import {
  conditionViews,
  disturbersOf,
  effectView,
  foodCompetitors,
  foodLabel,
  huntersOf,
  listNames,
  missingMembersText,
  moodText,
  previewView,
  rarityKey,
} from './adapters';
import { formatNumber } from './format';
import { detailPredationViews } from './food-web-view';
import { formatPercent, isScarceFood } from './view-format';
import type {
  AnimalDetailView,
  ConditionView,
  DetailAbilityView,
  DetailCommunityView,
  DetailFactorView,
  EffectView,
} from './view-model';

/** Wen zeigen? Art-ID oder Platz in einer Nische (Index wie in `state.niches[niche]`). */
export type AnimalDetailTarget = string | { niche: NicheId | string; index: number };

/** Art-ID eines eingezogenen Tiers – null, wenn dort (bzw. überhaupt) keines lebt. */
export function resolveAnimal(state: Pick<GameState, 'niches'>, target: AnimalDetailTarget): string | null {
  if (typeof target === 'string') return allAnimals(state as GameState).includes(target) ? target : null;
  const list = (state.niches as Record<string, readonly string[] | undefined>)[target.niche] ?? [];
  const id = list[target.index];
  return id !== undefined && SPECIES_BY_ID.has(id) ? id : null;
}

/** Prozentpunkte, z. B. „+15 Prozentpunkte“ bzw. „−10 Prozentpunkte“. */
function points(fraction: number): string {
  const value = Math.round(fraction * 100);
  return `${value < 0 ? '−' : '+'}${formatNumber(Math.abs(value))} Prozentpunkte`;
}

/** Futterzeile: wie viel gedeckt ist und mit wem die Art es teilt (Beute der Jäger: Abschnitt „Räuber und Beute“). */
function foodCondition(sp: Species, status: AnimalStatus | undefined, present: readonly string[]): ConditionView {
  const food = status?.food ?? 0;
  const row: ConditionView = { label: foodLabel(sp), met: food > 0 };
  if (food <= 0) {
    row.hint = 'kein passendes Futter da';
    return row;
  }
  const rivals = foodCompetitors(sp, present)
    .map((id) => SPECIES_BY_ID.get(id)?.name)
    .filter((n): n is string => n !== undefined);
  // ✓ nur bei ausreichender Deckung, sonst neutral ◐ (nicht wie erfüllt).
  if (isScarceFood(food)) row.partial = true;
  const share = `${formatPercent(Math.min(1, food))} gedeckt`;
  row.hint = rivals.length > 0 ? `${share} · teilt sich das Futter mit ${listNames(rivals, 3)}` : share;
  return row;
}

/** Einflüsse jenseits von Futter und Wünschen – in der Reihenfolge der Formel. */
function factorViews(state: GameState, sp: Species, status: AnimalStatus | undefined, ev: Readonly<Evaluation>): DetailFactorView[] {
  const present = allAnimals(state);
  const factors: DetailFactorView[] = [];
  const base = BASE_HAPPINESS[sp.rarity] ?? 0;
  factors.push({
    key: 'base',
    icon: '◆',
    label: `Grundzufriedenheit (${RARITY_NAMES[sp.rarity] ?? ''}): ${formatPercent(base)}`,
    tone: 'neutral',
  });
  if (status && status.disturbers > 0) {
    const names = disturbersOf(sp, present).map((id) => SPECIES_BY_ID.get(id)!.name);
    factors.push({
      key: 'disturb',
      icon: '😣',
      label: `wird gestört von ${listNames(names, 3)} (${points(-DISTURB_PENALTY * status.disturbers)})`,
      tone: 'bad',
    });
  }
  // Überjagung (DESIGN_V2.md 22.4): Abzug nur, wenn mehr Jäger als Bestand da sind.
  if (status && status.overhunt > 0) {
    const names = (status.overhuntedBy ?? huntersOf(sp, present)).map((id) => SPECIES_BY_ID.get(id)?.name ?? id);
    const loss = OVERHUNT_PENALTY * status.overhunt;
    factors.push({ key: 'hunters', icon: '👀', label: `ist auf der Hut vor ${listNames(names, 3)} (${points(-loss)})`, tone: 'bad' });
  }
  // Jahreszeit und Baumart: Zufriedenheit der Gattung (Wirkung `happiness`, Kern).
  const genusName = GENUS_INFO[sp.genus].name;
  const sum = (list: readonly { genus: string; points: number }[]) =>
    list.filter((e) => e.genus === sp.genus).reduce((s, e) => s + e.points, 0) / 100;
  const treeId = state.cycle?.mainTree !== undefined ? mainTreeOf(state.cycle.mainTree).id : undefined;
  if (state.cycle?.elapsed !== undefined) {
    const seasonId = seasonIdAt(state.cycle.elapsed);
    const season = SEASONS_BY_ID.get(seasonId);
    // Anteil der Jahreszeit mit Baum gerechnet: Ein winterfester Hauptbaum (Kiefer)
    // streicht Abzüge der Jahreszeit – die zählen hier dann auch nicht.
    const value =
      sum(environmentEffects(state.stage, seasonId, treeId).happiness) -
      sum(environmentEffects(state.stage, undefined, treeId).happiness);
    if (season) {
      factors.push({
        key: 'season',
        icon: season.icon,
        label: value !== 0 ? `${season.name}: ${points(value)}` : `${season.name}: keine Wirkung auf ${genusName}`,
        tone: value > 0 ? 'good' : value < 0 ? 'bad' : 'neutral',
      });
    }
  }
  if (treeId !== undefined) {
    const tree = mainTreeOf(treeId);
    const value = sum(environmentEffects(state.stage, undefined, tree.id).happiness);
    if (value !== 0) factors.push({ key: 'tree', icon: tree.icon, label: `${tree.name}: ${points(value)}`, tone: value > 0 ? 'good' : 'bad' });
  }
  // Waldlandschaft (DESIGN_V2.md 24.2): Eigenheit des Standorts (nur dort) und Gaben aller
  // gegründeten Wälder – gerechnet wie die Eigenheiten der Baumarten.
  const landscape = state.meta?.landscape;
  if (landscape) {
    const active = activeSite(landscape);
    const site = LANDSCAPE_SITES_BY_ID.get(active);
    const siteValue = sum(environmentEffects(state.stage, undefined, undefined, active).happiness);
    if (site && siteValue !== 0) {
      factors.push({ key: 'site', icon: site.icon, label: `${site.name}: ${points(siteValue)}`, tone: siteValue > 0 ? 'good' : 'bad' });
    }
    const giftValue = sum(environmentEffects(state.stage, undefined, undefined, undefined, giftSites(landscape)).happiness);
    if (giftValue !== 0) {
      factors.push({ key: 'gifts', icon: '🪶', label: `Gaben der Landschaft: ${points(giftValue)}`, tone: giftValue > 0 ? 'good' : 'bad' });
    }
  }
  if (ev.abilities.includes('decomposerBoost') && sp.level === DECOMPOSER_BOOST.level) {
    factors.push({ key: 'decomposerBoost', icon: '✨', label: `${ABILITY_INFO.decomposerBoost.name}: ${points(DECOMPOSER_BOOST.happiness)}`, tone: 'good' });
  }
  if (ev.abilities.includes('architect') && sp.niche === ARCHITECT.niche) {
    factors.push({ key: 'architect', icon: '✨', label: `${ABILITY_INFO.architect.name}: ${points(ARCHITECT.happiness)}`, tone: 'good' });
  }
  if (sp.effects.some((e) => e.kind === 'ability' && e.id === 'calm')) {
    factors.push({ key: 'calm', icon: '✨', label: `${ABILITY_INFO.calm.name}: nie unter ${formatPercent(CALM_MIN_HAPPINESS)}`, tone: 'good' });
  }
  return factors;
}

/**
 * Lebensgemeinschaften mit dieser Art. Unentdeckte nur als Anzahl in einem Eintrag – ohne
 * Name, ID, Rätselhinweis und Fortschritt: „2/3 Mitglieder“ an einer bestimmten Art
 * verriete, dass die übrigen Mitglieder schon da sind (Spoiler-Regel, DESIGN_V2 9.2).
 */
function communityViews(state: GameState, sp: Species, ev: Readonly<Evaluation>): DetailCommunityView[] {
  const discovered = state.meta.journal.communities;
  const status = new Map(ev.communities.map((c) => [c.id, c]));
  let hidden = 0;
  const out: DetailCommunityView[] = [];
  for (const c of COMMUNITIES) {
    if (!c.members.some((m) => memberOptions(m).includes(sp.id))) continue;
    const s = status.get(c.id);
    const active = s?.active ?? false;
    // Wie in der Seitenleiste: Was gerade besteht, gilt als entdeckt.
    if (!active && !discovered.includes(c.id)) {
      hidden++;
      continue;
    }
    const view: DetailCommunityView = {
      key: c.id,
      discovered: true,
      icon: c.icon,
      name: c.name,
      active,
      effect: [`+${formatNumber(s?.harmony || c.harmony)} Harmonie`, ...c.effects.map((e) => effectView(e).label)].join(' · '),
    };
    if (s && !active) {
      view.progress = `${formatNumber(s.present)}/${formatNumber(s.total)} Mitglieder – fehlt: ${missingMembersText(s.missing)}`;
    }
    out.push(view);
  }
  if (hidden > 0) {
    out.push({
      key: 'unknown-communities',
      discovered: false,
      icon: '❔',
      name:
        hidden === 1
          ? 'Gehört zu einer noch unentdeckten Lebensgemeinschaft'
          : `Gehört zu ${formatNumber(hidden)} noch unentdeckten Lebensgemeinschaften`,
      active: false,
      hint: 'Rätselhinweise stehen im Naturtagebuch.',
    });
  }
  return out;
}

const CONTRIBUTION_NOTE = 'Unterschied zu deinem Ökosystem ohne diese Art.';

/**
 * Erklärung zum Beitrag. Platz-Schaffer (Wirkung `slot`, Baumeister): Ohne sie fielen
 * Plätze weg und Bewohner müssten ausziehen – die Chips rechnen mit allen Bewohnern.
 */
function contributionNote(state: GameState, sp: Species, nichesWithout: GameState['niches']): string {
  const made = new Map<string, number>();
  for (const e of slotEffects(sp)) made.set(e.niche, (made.get(e.niche) ?? 0) + e.amount);
  if (made.size === 0) return CONTRIBUTION_NOTE;
  const list = [...made]
    .map(([id, n]) => {
      const niche = NICHES_BY_ID.get(id as NicheId);
      return `${niche ? `${niche.icon} ${niche.name}` : id} +${formatNumber(n)}`;
    })
    .join(', ');
  const overflow = nicheOverflow(state.stage, nichesWithout, slotBonuses(state));
  const leaving = [...made.keys()].reduce((sum, id) => sum + (overflow[id as NicheId] ?? 0), 0);
  const consequence =
    leaving > 0
      ? `Ohne sie fielen diese Plätze weg und ${leaving === 1 ? 'ein Bewohner müsste' : `${formatNumber(leaving)} Bewohner müssten`} ausziehen – das zeigt der Beitrag nicht.`
      : 'Ohne sie fielen diese Plätze weg – gerade müsste deswegen niemand ausziehen.';
  return `${CONTRIBUTION_NOTE} Schafft Plätze (${list}). ${consequence}`;
}

/**
 * Tierdetails einer eingezogenen Art; null, wenn sie nicht (mehr) im Ökosystem lebt.
 * `now` = `evaluate(state)` (aus main.ts übergeben, damit sie nur einmal gerechnet wird).
 */
export function toAnimalDetailView(
  state: GameState,
  target: AnimalDetailTarget,
  now: Readonly<Evaluation> = evaluate(state),
): AnimalDetailView | null {
  const id = resolveAnimal(state, target);
  const sp = id === null ? undefined : SPECIES_BY_ID.get(id);
  if (!sp) return null;
  const status = now.animals[sp.id];
  const present = allAnimals(state);
  const others = present.filter((x) => x !== sp.id);

  // Beitrag: jetzt gegenüber dem Ökosystem ohne diese Art (Kern rechnet beide Seiten).
  const niches = { ...state.niches, [sp.niche]: (state.niches[sp.niche] ?? []).filter((x) => x !== sp.id) };
  const without = evaluateEcosystem(ecosystemOf(state, { niches }));
  const contribution = previewView(without, now, sp.id);
  // Gemeinschaften stehen unten mit Spoiler-Regel – nicht als Vorschau-Hinweis.
  delete contribution.communities;

  const conditions = conditionViews(sp, status, others);
  conditions[0] = foodCondition(sp, status, others);

  const effects: EffectView[] = [];
  const abilities: DetailAbilityView[] = [];
  for (const e of sp.effects) {
    if (e.kind === 'ability') {
      const info = ABILITY_INFO[e.id];
      abilities.push({ name: info.name, text: info.text });
    } else {
      effects.push(effectView(e));
    }
  }
  // Nachtaktive Arten (DESIGN_V2.md 21.6): Nachtwirkung mit Zustand (wirkt gerade, ruht).
  const night = nightBadge(sp.id, seasonIdAt(state.cycle.elapsed), isNight(state.cycle.elapsed), status?.happiness ?? 0);
  if (night) effects.push({ label: nightDetailText(night), tone: night.resting || night.tooUnhappy ? 'neutral' : 'good' });
  if (sp.provides.length > 0) {
    // „bietet …“ wie auf der Karte (letzte Zeile von effectViews).
    effects.push({ label: `bietet ${sp.provides.map((t) => TAG_NAMES[t]).join(', ')}`, tone: 'neutral' });
  }

  let regular: string | null = null;
  if (regularSlotsOf(state) > 0) {
    // Amphibien: Der Waldtümpel muss in jedem Zyklus erst wieder angelegt werden.
    const later = regularNextCycleHint(sp.id);
    regular = state.meta.regulars.includes(sp.id)
      ? later
        ? `★ Stammgast – ${later}`
        : '★ Stammgast – zieht im nächsten Zyklus gleich wieder ein'
      : '☆ Kein Stammgast – im Naturtagebuch wählbar';
  }

  const niche = NICHES_BY_ID.get(sp.niche);
  const view: AnimalDetailView = {
    id: sp.id,
    name: sp.name,
    family: sp.genus,
    familyLabel: GENUS_INFO[sp.genus].name,
    familyIcon: GENUS_INFO[sp.genus].icon,
    rarity: rarityKey(sp.rarity),
    nicheId: sp.niche,
    nicheLabel: niche ? `${niche.icon} ${niche.name}` : sp.niche,
    happiness: status?.happiness ?? 0,
    mood: moodText(sp, status, present),
    contribution,
    contributionNote: contributionNote(state, sp, niches),
    conditions,
    factors: factorViews(state, sp, status, now),
    predation: detailPredationViews(sp, status, now, state),
    effects,
    abilities,
    communities: communityViews(state, sp, now),
    regular,
    text: sp.text,
  };
  return view;
}
