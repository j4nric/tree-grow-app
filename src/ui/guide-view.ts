/**
 * Inhalt der Spielanleitung („❓ Spielanleitung“). Reine Funktion ohne DOM: Alle Zahlen
 * kommen aus content/ bzw. core/ – ändert sich das Balancing, stimmt die Anleitung
 * trotzdem. Getestet in tests/settings.test.ts (Abschnitt „Spielanleitung“).
 */
import { ACHIEVEMENTS } from '../content/achievements';
import { CARE, CARE_BY_ID } from '../content/care';
import { COMMUNITIES } from '../content/communities';
import {
  CARDS_PER_ENCOUNTER,
  DECLINE_SEEDS,
  INTERLUDE_CHANCE,
  INTERLUDE_STAGE,
  MAX_PENDING_ENCOUNTERS,
  REROLL_BASE_COST,
  REROLL_COST_GROWTH,
} from '../content/encounters';
import {
  FOREST_MEMORY_BONUS,
  MEMORY_HARMONY_DIVISOR,
  MEMORY_PER_HARMONY_POINT,
  MEMORY_PER_NEW_SPECIES,
  MEMORY_PER_REGULAR_SLOT,
  NEW_CYCLE_MIN_STAGE,
} from '../content/memory';
import { NICHES } from '../content/niches';
import { PLANT_COST_BASE, PLANT_COST_GROWTH, PLANTS, PLANTS_BY_ID } from '../content/plants';
import { EVENTS, SEED_SECONDS_MIN_SEEDS } from '../content/events';
import { GENUS_INFO, SPECIES } from '../content/species';
import { SEASONS, SEASON_SECONDS } from '../content/seasons';
import { STAGES } from '../content/stages';
import { MAIN_TREES } from '../content/trees';
import { TRAIT_THRESHOLDS } from '../content/traits';
import { VISITORS, VISITOR_FAREWELL_LABEL, VISITOR_HOST_LABEL } from '../content/visitors';
import { GENERA } from '../content/types';
import { WAYPOINT_COUNT } from '../content/waypoints';
import { HARMONY_DIVISOR, memoryHarmonyBonus } from '../core/formulas';
import { HARMONY_TIERS, bonusEffectLabel, listNames } from './adapters';
import { fruitPhrase } from './cycle-view';
import { formatDuration, formatNumber } from './format';

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
/** Spanne „a–b“ (bzw. nur „a“, wenn alle gleich sind) im deutschen Zahlenformat. */
export function span(values: readonly number[]): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? formatNumber(lo) : `${formatNumber(lo)}–${formatNumber(hi)}`;
}
const minutes = (seconds: number) => Math.round((seconds / 60) * 10) / 10;
const stageName = (index: number) => STAGES[index]?.name ?? STAGES[STAGES.length - 1]!.name;

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
  // Harmonie-Bonus beim Neuen Zyklus an den Stufen ab Hain (Schritt 2.11b, dazwischen gleitend), z. B. „im Hain über 100 (bis 115)“.
  const memoryThresholds = STAGES.slice(NEW_CYCLE_MIN_STAGE).map((stage) => {
    const bonus = memoryHarmonyBonus(stage.waypoint);
    return `im ${stage.name} über ${formatNumber(bonus.shownThreshold)} (bis ${formatNumber(bonus.fullAt)})`;
  });

  const eventStage = stageName(Math.min(...EVENTS.map((e) => e.minStage)));
  const visitorStage = stageName(Math.min(...VISITORS.map((v) => v.minStage)));
  const careStage = stageName(Math.min(...CARE.map((c) => c.ranks[0]!.minStage)));
  const interludeStage = stageName(INTERLUDE_STAGE);
  const eventOptions = EVENTS.flatMap((e) => e.options);
  const timedEffects = eventOptions.flatMap((o) => o.effects.flatMap((x) => (x.kind === 'timed' ? [x] : [])));
  const timedSeconds = timedEffects.map((x) => x.seconds);
  // Nur reine Samen-Optionen (keine Mischungen wie Zeit-Bonus plus Samen).
  const seedSeconds = eventOptions.flatMap((o) =>
    o.effects.length > 0 && o.effects.every((x) => x.kind === 'seedsNow') ? o.effects.map((x) => x.seconds) : [],
  );
  const firstTimed = timedEffects[0];
  const timedExample = firstTimed ? `${bonusEffectLabel(firstTimed.effect)} für ${formatDuration(firstTimed.seconds)}` : '';

  // Sich ausschließende Maßnahmen als Paare (jedes Paar nur einmal).
  const exclusions: string[][] = [];
  for (const measure of CARE) {
    for (const other of measure.excludes ?? []) {
      const name = CARE_BY_ID.get(other)?.name;
      // In CARE-Reihenfolge: Das Paar zählt bei der zuerst genannten Maßnahme.
      if (name && CARE.findIndex((c) => c.id === other) > CARE.indexOf(measure)) exclusions.push([measure.name, name]);
    }
  }

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
        `Du bekommst Waldgedächtnis: ${MEMORY_PER_NEW_SPECIES === 1 ? '1 Punkt' : `${formatNumber(MEMORY_PER_NEW_SPECIES)} Punkte`} je neu entdeckter Art und 1 Punkt je ${formatNumber(MEMORY_HARMONY_DIVISOR)} Punkte deiner höchsten Harmonie in diesem Zyklus. Höchste Harmonie über einer Schwelle zählt extra: Jeder Punkt darüber bringt ${formatNumber(MEMORY_PER_HARMONY_POINT)} Punkte mehr. Die Schwelle steigt mit jedem Wegpunkt – ${all(memoryThresholds)}. Wer länger wächst, braucht für den Bonus also mehr Harmonie; die aktuelle Schwelle steht bei „Neuer Zyklus“. Jeder Punkt gibt dauerhaft +${pct(FOREST_MEMORY_BONUS)} Wachstum und Samen.`,
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
        'Wer mag, hört die Jahreszeiten auch – leiser Wind, Vogelrufe im Frühling und Sommer, Stille im Winter: unter ⚙️ Einstellungen → Klang (anfangs aus).',
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
      paragraphs: [
        `Ab „${eventStage}“ kann statt eines Tiers oder einer Pflanze ein Ereignis kommen – ${formatNumber(EVENTS.length)} gibt es: ${listNames(EVENTS.map((e) => e.name), 3)}. Jedes kommt höchstens einmal pro Zyklus.`,
        `Du wählst eine von ${span(EVENTS.map((e) => e.options.length))} Möglichkeiten, keine ist eine Strafe: Manche Wirkungen (mehr Licht, Wasser, Plätze oder ein Lebensraum wie Totholz) gelten bis zum Neuen Zyklus, Zeit-Boni wie „${timedExample}“ laufen ${span(timedSeconds.map(minutes))} Minuten Spielzeit – auch offline. Die Samen-Option bringt sofort so viele Samen, wie du in ${span(seedSeconds)} Sekunden sammelst, mindestens ${formatNumber(SEED_SECONDS_MIN_SEEDS)} 🌰.`,
        `Ab „${interludeStage}“ gibt es zwischen zwei Wegpunkten einen Zwischenhalt: Mit ${pct(INTERLUDE_CHANCE)} Wahrscheinlichkeit wartet dort zusätzlich ein Ereignis oder ein Gast, sofern etwas passt.`,
      ],
    },
    {
      id: 'visitors',
      icon: '🦢',
      title: 'Durchreisende Gäste',
      paragraphs: [
        `Ab „${visitorStage}“ ziehen Gäste vorbei – ${formatNumber(VISITORS.length)} verschiedene: ${listNames(VISITORS.map((v) => v.name), 3)}. Jeder kommt höchstens einmal pro Zyklus und belegt keine Nische.`,
        `${VISITOR_HOST_LABEL} kostet Samen-Sekunden: so viele Samen, wie du in ${span(VISITORS.map((v) => v.hostCost))} Sekunden sammelst. Dann rastet der Gast ${span(VISITORS.map((v) => minutes(v.stay)))} Minuten, bringt seine Wirkung und zählt für die Gattungsboni.`,
        `${VISITOR_FAREWELL_LABEL} bringt als Dank sofort die Samen von ${span(VISITORS.map((v) => v.farewellSeeds))} Sekunden, mindestens ${formatNumber(SEED_SECONDS_MIN_SEEDS)} 🌰. Reichen deine Samen nicht zum Bewirten, bleibt nur das.`,
      ],
    },
    {
      id: 'care',
      icon: '🧺',
      title: 'Pflege',
      paragraphs: [
        `Ab „${careStage}“ steckst du Samen in ${formatNumber(CARE.length)} Pflegemaßnahmen: ${listNames(CARE.map((c) => c.name), 3)}. Jede hat ${span(CARE.map((c) => c.ranks.length))} Ränge, die du nacheinander kaufst – jeder teurer als der vorige, spätere oft erst auf einer höheren Stufe.`,
        `Gekaufte Ränge wirken bis zum Neuen Zyklus und addieren sich. Verkaufen geht nicht – überlege, was dein Wald gerade braucht.`,
        ...exclusions.map((pair) => `${all(pair.map((n) => `„${n}“`))} schließen sich aus: Du kannst nur eine davon pflegen.`),
      ],
    },
    {
      id: 'achievements',
      icon: '🏅',
      title: 'Erfolge',
      paragraphs: [
        `${formatNumber(ACHIEVEMENTS.length)} leise Erfolge begleiten dich durch das ganze Spiel: Stufen, Einträge im Naturtagebuch, Harmonie, Gäste, Zyklen und Spielzeit. Du findest sie im Naturtagebuch im Reiter „Erfolge“ – offene mit ihrem Fortschritt.`,
        'Es gibt keine Eile: Erfolge haben keine Zeitlimits, bringen keine Belohnung in Zahlen und gehen nie verloren, auch nicht beim Neuen Zyklus. Sie kommen ganz von selbst, Schritt für Schritt.',
      ],
    },
  ];
}
