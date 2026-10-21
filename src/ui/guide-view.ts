/**
 * Inhalt der Spielanleitung („❓ Spielanleitung“). Reine Funktion ohne DOM: Alle Zahlen
 * kommen aus content/ bzw. core/ – ändert sich das Balancing, stimmt die Anleitung
 * trotzdem. Getestet in tests/settings.test.ts (Abschnitt „Spielanleitung“).
 */
import { COMMUNITIES } from '../content/communities';
import {
  CARDS_PER_ENCOUNTER,
  DECLINE_SEEDS,
  MAX_PENDING_ENCOUNTERS,
  REROLL_BASE_COST,
  REROLL_COST_GROWTH,
} from '../content/encounters';
import {
  FOREST_MEMORY_BONUS,
  MEMORY_HARMONY_DIVISOR,
  MEMORY_PER_NEW_SPECIES,
  MEMORY_PER_REGULAR_SLOT,
  NEW_CYCLE_MIN_STAGE,
} from '../content/memory';
import { NICHES } from '../content/niches';
import { PLANT_COST_BASE, PLANT_COST_GROWTH, PLANTS } from '../content/plants';
import { GENUS_INFO, SPECIES } from '../content/species';
import { PLANTS_BY_ID } from '../content/plants';
import { SEASONS, SEASON_SECONDS } from '../content/seasons';
import { STAGES } from '../content/stages';
import { MAIN_TREES } from '../content/trees';
import { TRAIT_THRESHOLDS } from '../content/traits';
import { GENERA } from '../content/types';
import { WAYPOINT_COUNT } from '../content/waypoints';
import { HARMONY_DIVISOR } from '../core/formulas';
import { HARMONY_TIERS, listNames } from './adapters';
import { fruitPhrase } from './cycle-view';
import { formatNumber } from './format';

export interface GuideSection {
  id: string;
  icon: string;
  title: string;
  paragraphs: string[];
  /** Platzhalter für Inhalte, die noch entstehen („kommt bald“). */
  soon?: boolean;
}

/** Alle Namen aufzählen: „A, B und C“. */
const all = (names: readonly string[]) => listNames(names, names.length);
const pct = (fraction: number) => `${formatNumber(fraction * 100)} %`;

export function guideSections(): GuideSection[] {
  const firstStage = STAGES[0]!.name;
  const lastStage = STAGES[STAGES.length - 1]!.name;
  const ringStage = STAGES.find((s) => s.plantSlots > 0)?.name ?? STAGES[1]?.name ?? '';
  const cycleStage = STAGES[NEW_CYCLE_MIN_STAGE]?.name ?? lastStage;
  // Harmoniestufen aufsteigend, ohne die unterste (sie beginnt bei −∞).
  const tiers = [...HARMONY_TIERS]
    .filter((t) => Number.isFinite(t.min))
    .sort((a, b) => a.min - b.min)
    .map((t) => `ab ${formatNumber(t.min)} „${t.label}“`);
  const lowestTier = HARMONY_TIERS.find((t) => !Number.isFinite(t.min))?.label ?? '';
  // Hauptbaum-Arten: die erste ist immer wählbar, die übrigen über ihre Begleitpflanze.
  const [firstTree, ...laterTrees] = MAIN_TREES;
  const laterFruits = laterTrees.map((t) => fruitPhrase(t.id)).join(' oder ');
  const laterPlants = laterTrees.map((t) => PLANTS_BY_ID.get(t.unlockPlant ?? '')?.name ?? t.name).join(' bzw. ');
  const seasonMinutes = formatNumber(SEASON_SECONDS / 60);

  return [
    {
      id: 'growth',
      icon: '🌱',
      title: 'Wachstum und Wegpunkte',
      paragraphs: [
        `Dein Baum wächst ganz von selbst – du musst nichts anklicken. 🌿 zeigt, wie viel Wachstum pro Sekunde dazukommt.`,
        `Auf dem Weg vom ${firstStage} bis zum ${lastStage} liegen ${formatNumber(WAYPOINT_COUNT)} Wegpunkte. Unterwegs erreicht dein Baum die Stufen ${all(STAGES.map((s) => s.name))}.`,
      ],
    },
    {
      id: 'encounters',
      icon: '🃏',
      title: 'Begegnungen und Kartenwahl',
      paragraphs: [
        `An jedem Wegpunkt wartet eine Begegnung mit bis zu ${formatNumber(CARDS_PER_ENCOUNTER)} Karten: ein Tier, das einziehen möchte, oder eine Pflanze, die keimt. Die Vorschau auf jeder Karte zeigt, was sich ändert.`,
        `Begegnungen warten ruhig im Stapel am Bildrand – höchstens ${formatNumber(MAX_PENDING_ENCOUNTERS)}. Ablehnen bringt +${formatNumber(DECLINE_SEEDS)} 🌰, Neu würfeln kostet ${formatNumber(REROLL_BASE_COST)} 🌰, jedes weitere Mal ×${formatNumber(REROLL_COST_GROWTH)} in derselben Begegnung.`,
      ],
    },
    {
      id: 'niches',
      icon: '🏡',
      title: 'Nischen und Zufriedenheit',
      paragraphs: [
        `Tiere wohnen in ${formatNumber(NICHES.length)} Nischen: ${all(NICHES.map((n) => n.name))}. Mit jeder Stufe öffnen sich mehr Plätze. Ist eine Nische voll, kannst du ein Tier gegen ein neues tauschen.`,
        `Jedes Tier braucht Futter und hat Wünsche (z. B. Totholz oder Feuchte). Je mehr davon erfüllt ist, desto zufriedener ist es. Räuber und Störer in der Nähe senken seine Zufriedenheit.`,
      ],
    },
    {
      id: 'plants',
      icon: '🌿',
      title: 'Pflanzen, Licht und Wasser',
      paragraphs: [
        `Ab „${ringStage}“ wachsen Begleitpflanzen im Pflanzring – ${formatNumber(PLANTS.length)} verschiedene. Sie keimen über Begegnungen, oder du setzt sie für Samen: Eine Pflanze kostet ${formatNumber(PLANT_COST_BASE)} 🌰 bei leerem Ring, mit jeder wachsenden Pflanze ×${formatNumber(PLANT_COST_GROWTH)}.`,
        `Pflanzen brauchen Licht ☀️ und Wasser 💧. Reicht es nicht, wachsen sie langsamer. Moos speichert Wasser, Schattenpflanzen kommen mit wenig Licht aus.`,
      ],
    },
    {
      id: 'communities',
      icon: '🐝',
      title: 'Gattungen und Lebensgemeinschaften',
      paragraphs: [
        `Es gibt ${formatNumber(SPECIES.length)} Arten in ${formatNumber(GENERA.length)} Gattungen: ${all(GENERA.map((g) => GENUS_INFO[g].name))}. Ab ${all(TRAIT_THRESHOLDS.map((t) => formatNumber(t)))} Arten einer Gattung gibt es jeweils einen Bonus.`,
        `${formatNumber(COMMUNITIES.length)} Lebensgemeinschaften warten darauf, entdeckt zu werden: Leben bestimmte Arten und Pflanzen zusammen, bringen sie Harmonie. Anfangs kennst du nur einen Rätselhinweis.`,
      ],
    },
    {
      id: 'harmony',
      icon: '⚖️',
      title: 'Harmonie',
      paragraphs: [
        `Harmonie entsteht aus Vielfalt, zufriedenen Tieren, einer stimmigen Nahrungspyramide und Lebensgemeinschaften. Jeder Punkt gibt +${pct(1 / HARMONY_DIVISOR)} Wachstum und Samen.`,
        `Harmoniestufen: zuerst „${lowestTier}“, dann ${all(tiers)}. Je höher die Stufe, desto wärmer leuchtet dein Wald.`,
      ],
    },
    {
      id: 'cycle',
      icon: '🔄',
      title: 'Neuer Zyklus, Waldgedächtnis und Stammgäste',
      paragraphs: [
        `Ab der Stufe „${cycleStage}“ kannst du einen Neuen Zyklus beginnen: Aus ${fruitPhrase(firstTree?.id)} wächst ein neuer Baum – später auch aus ${laterFruits}, sobald einmal eine ${laterPlants} in deinem Pflanzring gewachsen ist. Jede Art hat eine kleine Eigenheit. Tiere, Pflanzen und Samen beginnen von vorn; Naturtagebuch, Waldgedächtnis und Stammgäste bleiben.`,
        `Du bekommst Waldgedächtnis: 1 Punkt je ${formatNumber(MEMORY_HARMONY_DIVISOR)} Punkte deiner höchsten Harmonie in diesem Zyklus und ${formatNumber(MEMORY_PER_NEW_SPECIES)} Punkte je neu entdeckter Art. Jeder Punkt gibt dauerhaft +${pct(FOREST_MEMORY_BONUS)} Wachstum und Samen.`,
        `Je ${formatNumber(MEMORY_PER_REGULAR_SLOT)} Punkte Waldgedächtnis darfst du einen Stammgast wählen – eine entdeckte Art, die in jedem Zyklus von selbst einzieht.`,
      ],
    },
    {
      id: 'seasons',
      icon: '🍂',
      title: 'Jahreszeiten',
      paragraphs: [
        `Jeder Zyklus beginnt im Frühling; alle ${seasonMinutes} Minuten Spielzeit wechselt die Jahreszeit – auch, während das Spiel geschlossen ist. Keine ist ein Hindernis, jede bringt etwas Eigenes:`,
        ...SEASONS.map((x) => `${x.icon} ${x.name}: ${x.summary}.`),
        'Manche Ereignisse und Gäste kommen nur zu ihrer Jahreszeit. Pflanzen kosten immer gleich viel – Warten lohnt sich nicht.',
      ],
    },
    {
      id: 'seeds',
      icon: '🌰',
      title: 'Samen',
      paragraphs: [
        `Samen sammelst du nebenbei – mehr Pflanzen und Harmonie bringen mehr. Du gibst sie für neue Pflanzen und fürs Neu würfeln aus; Ablehnen bringt welche zurück. Nichts verfällt.`,
      ],
    },
    {
      id: 'events',
      icon: '⛈️',
      title: 'Ereignisse',
      paragraphs: ['Sturm, Trockenheit und andere Ereignisse mit Wahl – kommt bald.'],
      soon: true,
    },
    {
      id: 'visitors',
      icon: '🦢',
      title: 'Durchreisende Gäste',
      paragraphs: ['Kraniche, Bergfinken und andere Gäste, die nur kurz bleiben – kommt bald.'],
      soon: true,
    },
    {
      id: 'care',
      icon: '🧺',
      title: 'Pflege',
      paragraphs: ['Pflegemaßnahmen für deinen Wald – kommt bald.'],
      soon: true,
    },
  ];
}
