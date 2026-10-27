/**
 * Inhalt der Spielanleitung („❓ Spielanleitung“). Reine Funktion ohne DOM: Alle Zahlen
 * kommen aus content/ bzw. core/ – ändert sich das Balancing, stimmt die Anleitung
 * trotzdem. Getestet in tests/settings.test.ts (Abschnitt „Spielanleitung“).
 */
import { ACHIEVEMENTS } from '../content/achievements';
import { RESEARCH, RESEARCH_BRANCHES, RESEARCH_ONCE, RESEARCH_REPEATABLE, RESEARCH_BY_ID, RESEARCH_FORKS } from '../content/research';
import { COMMUNITIES } from '../content/communities';
import {
  CARDS_PER_ENCOUNTER,
  DECLINE_SEED_SECONDS,
  INTERLUDE_CHANCE,
  INTERLUDE_STAGE,
  MAX_PENDING_ENCOUNTERS,
  REROLL_BASE_COST,
  REROLL_COST_GROWTH,
} from '../content/encounters';
import {
  FOREST_MEMORY_BONUS,
  MEMORY_PER_HARMONY_POINT,
  MEMORY_PER_NEW_SPECIES,
  MEMORY_PER_REGULAR_SLOT,
  NEW_CYCLE_MIN_STAGE,
} from '../content/memory';
import { NICHES } from '../content/niches';
import { PLANTS, PLANTS_BY_ID } from '../content/plants';
import { SOWING_BASE, SOWING_GROWTH } from '../content/sowing';
import { EVENTS, SEED_SECONDS_MIN_SEEDS } from '../content/events';
import { COMMON_SPECIES, GENUS_INFO, SPECIES, isKennart } from '../content/species';
import { SEASONS, SEASON_SECONDS } from '../content/seasons';
import { STAGES } from '../content/stages';
import { MAIN_TREES } from '../content/trees';
import { TRAIT_THRESHOLDS } from '../content/traits';
import { VISITORS, VISITOR_FAREWELL_LABEL, VISITOR_HOST_LABEL } from '../content/visitors';
import { GENERA } from '../content/types';
import { WAYPOINT_COUNT } from '../content/waypoints';
import { OFFLINE_FULL_SECONDS, OFFLINE_YIELD } from '../content/offline';
import {
  BADGE_NAMES,
  MILESTONE_NAMES,
  NICHE_MILESTONES,
  NICHE_UPGRADE_BASE,
  NICHE_UPGRADE_PCT,
  TREE_PARTS,
  TREE_UPGRADE_BASE,
  UPGRADE_GROWTH,
} from '../content/upgrades';
import { DIVERSITY_DAMPING_MAX, DIVERSITY_DAMPING_PER_GENUS, GENTLE_DAYS, OFFLINE_AVERAGE_MIN_SECONDS, WEATHERS } from '../content/weather';
import { NOCTURNAL } from '../content/daytime';
import { CHRONICLE_CHAPTERS, CHRONICLE_HARMONY } from '../content/chronicle';
import { REPTILE_SUMMER_HAPPINESS } from '../content/habitats';
import { OVERHUNT_MAX_UNITS, OVERHUNT_PENALTY, PREDATION_EVENTS, STOCK_BASE, STOCK_RANGE } from '../content/predation';
import { isAchievementVisibleIn } from '../core/achievements';
import { HARMONY_DIVISOR, memoryHarmonyBonus } from '../core/formulas';
import {
  CORRIDORS,
  CORRIDOR_INFLOW,
  CORRIDOR_INFLOW_CAP,
  FOUNDING_COSTS,
  JAY_SEEDS_FIRST_ANCIENT,
  JAY_SEEDS_MEMORY_STEP,
  HOME_SITE,
  LANDSCAPE_SITES,
  LANDSCAPE_SITES_BY_ID,
  LANDSCAPE_UNLOCK_MEMORY,
  WILDWECHSEL_CHANCE,
  WILDWECHSEL_MAX_CHANCE,
} from '../content/landscape';
import { MAX_FOREST_MEMORY } from '../core/state';
import { MAX_OFFLINE_SECONDS } from '../core/tick';
import { HARMONY_TIERS, bonusEffectLabel, isHabitatNiche, listNames } from './adapters';
import { researchSlotNodes } from './regular-wait';
import { fruitPhrase } from './cycle-view';
import { siteEventText, siteWeatherText } from './landscape-view';
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

export interface GuideOptions {
  /**
   * Die Waldlandschaft ist sichtbar (freigeschaltet). Vorher steht im Abschnitt nur eine
   * Andeutung – keine Namen, keine Zahlen (Spoiler-Regel, DESIGN_V2.md 24.1). Auch die Zahl
   * der Erfolge zählt deren Erfolge erst danach mit (24.12, wie der Zähler im Naturtagebuch).
   */
  landscape?: boolean;
}

export function guideSections(options: GuideOptions = {}): GuideSection[] {
  const firstStage = STAGES[0]!.name;
  const lastStage = STAGES[STAGES.length - 1]!.name;
  const ringStage = STAGES.find((s) => s.plantSlots > 0)?.name ?? STAGES[1]?.name ?? '';
  const cycleStage = STAGES[NEW_CYCLE_MIN_STAGE]?.name ?? lastStage;
  // Saatzeit (27.5): Jahreszeit mit Rabatt auf die Aussaat.
  const sowingSeason = SEASONS.find((x) => (x.sowingCostFactor ?? 1) < 1);
  const springSowing = sowingSeason
    ? `Im ${sowingSeason.name} ist Saatzeit: Säen kostet ${formatNumber(Math.round((1 - sowingSeason.sowingCostFactor!) * 100))} % weniger.`
    : '';
  // Forschungsast „Saat“: Knoten mit Aussaat-Wirkung (mehr Karten, Rabatt, Neu würfeln).
  const sowingNodes = RESEARCH.filter((n) => n.effects.some((e) => e.kind === 'sowCards' || e.kind === 'sowCost' || e.kind === 'sowFreeReroll')).map(
    (n) => `„${n.name}“`,
  );
  // Harmoniestufen aufsteigend, ohne die unterste (sie beginnt bei −∞).
  const tiers = [...HARMONY_TIERS]
    .filter((t) => Number.isFinite(t.min))
    .sort((a, b) => a.min - b.min)
    .map((t) => `ab ${formatNumber(t.min)} „${t.label}“`);
  const lowestTier = HARMONY_TIERS.find((t) => !Number.isFinite(t.min))?.label ?? '';
  // Hauptbaum-Arten: die erste ist immer wählbar, die übrigen über ihre Begleitpflanze.
  // Arten der Landschaft (unlockSite) nennt die Anleitung hier nicht (DESIGN_V2.md 25.2, kein Spoiler).
  const [firstTree, ...laterTrees] = MAIN_TREES.filter((t) => t.unlockSite === undefined);
  const laterFruits = laterTrees.map((t) => fruitPhrase(t.id)).join(' oder ');
  const laterPlants = laterTrees.map((t) => PLANTS_BY_ID.get(t.unlockPlant ?? '')?.name ?? t.name).join(' bzw. ');
  // Erst mit sichtbarer Landschaft (wie isTreeVisible): die Arten der Standorte in einem Satz.
  const siteTrees = MAIN_TREES.filter((t) => t.unlockSite !== undefined)
    .map((t) => `${t.icon} ${t.name} (${LANDSCAPE_SITES_BY_ID.get(t.unlockSite!)?.name ?? t.unlockSite})`);
  const siteTreesText =
    options.landscape === true && siteTrees.length > 0
      ? ` In der Waldlandschaft keimen außerdem ${all(siteTrees)} – jede, sobald ihr Wald gegründet ist; dort ist sie Leitbaum.`
      : '';
  const seasonMinutes = formatNumber(SEASON_SECONDS / 60);
  // Harmonie-Bonus beim Neuen Zyklus an den Stufen ab Hain (Schritt 2.11b, dazwischen gleitend), z. B. „im Hain ab 101 (bis 115)“.
  const memoryThresholds = STAGES.slice(NEW_CYCLE_MIN_STAGE).map((stage) => {
    const bonus = memoryHarmonyBonus(stage.waypoint);
    return `im ${stage.name} ab ${formatNumber(bonus.bonusFrom)} (bis ${formatNumber(bonus.fullAt)})`;
  });
  // Sockel: 1 Punkt je D Punkte höchster Harmonie, D gleitet ab dem Hain (z. B. „im Wald je 6, im Urwald je 7“).
  const memoryDivisor = memoryHarmonyBonus(STAGES[NEW_CYCLE_MIN_STAGE]?.waypoint ?? 0).divisor;
  const laterDivisors = STAGES.slice(NEW_CYCLE_MIN_STAGE + 1)
    .map((stage) => ({ name: stage.name, divisor: memoryHarmonyBonus(stage.waypoint).divisor }))
    .filter((d) => d.divisor !== memoryDivisor)
    .map((d) => `im ${d.name} je ${formatNumber(d.divisor)}`);

  const eventStage = stageName(Math.min(...EVENTS.map((e) => e.minStage)));
  const visitorStage = stageName(Math.min(...VISITORS.map((v) => v.minStage)));
  const careStage = stageName(Math.min(...RESEARCH.map((n) => n.minStage)));
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

  // Gabeln der Forschung (27.7): je Gabel die ersten Knoten beider Wege.
  const forks = RESEARCH_FORKS.map((f) => f.paths.map((p) => RESEARCH_BY_ID.get(p[0]!)?.name ?? p[0]!));

  // Wetter und Nacht (DESIGN_V2.md 21): alles aus den Daten.
  const roughWeathers = WEATHERS.filter((w) => w.rough);
  const protections = roughWeathers
    .filter((w) => w.protection && RESEARCH_BY_ID.has(w.protection))
    .map((w) => `„${RESEARCH_BY_ID.get(w.protection!)!.name}“ bei ${w.name}`);
  const immune = roughWeathers.flatMap((w) =>
    (w.immuneTrees ?? []).map((t) => `Die ${MAIN_TREES.find((x) => x.id === t)?.name ?? t} ist gegen ${w.name} gefeit`),
  );
  // Kennarten (26.3) erst mit der Landschaft nennen – vorher sind sie unsichtbar (Spoiler-Regel).
  const shownNocturnal = NOCTURNAL.filter((n) => options.landscape === true || !isKennart(n.species));
  const nocturnal = shownNocturnal.map((n) => `${SPECIES.find((x) => x.id === n.species)?.name ?? n.species} (${n.summary.replace(/ \(.*\)$/, '')})`);
  const restingNames = shownNocturnal.filter((n) => n.seasons && !n.seasons.includes('winter')).map(
    (n) => SPECIES.find((x) => x.id === n.species)?.name ?? n.species,
  );

  // Lebensräume (DESIGN_V2.md 23, 5.5): Nischen ohne Plätze aus der Stufe, geöffnet durch Forschung.
  const habitats = NICHES.filter((n) => isHabitatNiche(n.id))
    .map((n) => {
      const opener = researchSlotNodes(n.id)[0];
      return { niche: n, opener, at: opener?.minStage ?? STAGES.length };
    })
    .sort((a, b) => a.at - b.at);
  const habitatList = habitats.map(({ niche, opener, at }) =>
    opener ? `${niche.icon} ${niche.name} (Forschung „${opener.name}“ ab „${stageName(at)}“)` : `${niche.icon} ${niche.name}`,
  );
  // Ereignisse, die einen Lebensraum öffnen – als Beispiel eines der neuen (Käferjahr), sonst der Tümpel.
  const opensHabitat = (e: (typeof EVENTS)[number], other: boolean) =>
    e.options.some((o) =>
      o.effects.some((x) => x.kind === 'cycle' && x.effect.kind === 'slot' && x.effect.amount > 0 && isHabitatNiche(x.effect.niche) && (!other || x.effect.niche !== 'pond')),
    );
  const habitatEvent = EVENTS.find((e) => opensHabitat(e, true)) ?? EVENTS.find((e) => opensHabitat(e, false));
  const reptiles = SPECIES.filter((x) => x.genus === 'reptiles');
  const reptileHomes = habitats.filter(({ niche }) => reptiles.some((x) => x.niche === niche.id)).map(({ niche }) => niche.name);

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
        `An jedem Wegpunkt wartet eine Begegnung mit bis zu ${formatNumber(CARDS_PER_ENCOUNTER)} Karten: Tiere, die einziehen möchten. Ab „${eventStage}“ kommen auch Ereignisse, ab „${visitorStage}“ Gäste auf der Durchreise. Die Vorschau auf jeder Karte zeigt, was sich ändert.`,
        'Pflanzen kommen nicht über Begegnungen – du säst sie selbst (Kapitel „Säen“).',
        `Begegnungen warten ruhig im Zettelstapel – höchstens ${formatNumber(MAX_PENDING_ENCOUNTERS)}. Ablehnen bringt die Samen von ${formatNumber(DECLINE_SEED_SECONDS)} Sekunden, mindestens ${formatNumber(SEED_SECONDS_MIN_SEEDS)} 🌰, Neu würfeln kostet ${formatNumber(REROLL_BASE_COST)} 🌰, jedes weitere Mal ×${formatNumber(REROLL_COST_GROWTH)} in derselben Begegnung.`,
      ],
    },
    {
      id: 'niches',
      icon: '🏡',
      title: 'Nischen und Zufriedenheit',
      paragraphs: [
        `Tiere wohnen in ${formatNumber(NICHES.length)} Nischen: ${all(NICHES.map((n) => n.name))}. Mit jeder Stufe öffnen sich mehr Plätze, Lebensräume öffnest du selbst. Ist eine Nische voll, kannst du ein Tier gegen ein neues tauschen.`,
        `Jedes Tier braucht Futter und hat Wünsche (z. B. Totholz oder Feuchte). Je mehr davon erfüllt ist, desto zufriedener ist es. Störer in der Nähe senken seine Zufriedenheit, Jäger nur, wenn sie mehr fressen, als da ist.`,
      ],
    },
    {
      id: 'habitats',
      icon: '🌾',
      title: 'Lebensräume',
      paragraphs: [
        `${formatNumber(habitats.length)} Nischen wachsen nicht mit dem Baum – du legst sie als Lebensräume mit Pflege selbst an: ${all(habitatList)}. Jeder hat eigene Bewohner, die erst als Karten kommen, wenn er offen ist.`,
        'Im Reiter „Nischen“ steht ein verschlossener Lebensraum mit einem Hinweis. Sobald seine Pflege in der Liste steht, führt „Zur Pflege“ direkt dorthin – bei der Maßnahme steht dann „Öffnet Lebensraum …“.',
        'Die Plätze bleiben bis zum Neuen Zyklus. Danach legst du den Lebensraum neu an; Stammgäste, die dort wohnen, ziehen ein, sobald er wieder offen ist.',
        `${GENUS_INFO.reptiles.icon} ${GENUS_INFO.reptiles.name} – ${formatNumber(reptiles.length)} Arten – leben nur in Lebensräumen: ${all(reptileHomes)}. Sie sind wechselwarm: Im Sommer sonnen sie sich (+${formatNumber(REPTILE_SUMMER_HAPPINESS)} Prozentpunkte Zufriedenheit), im Winter halten sie Winterstarre, ganz ohne Nachteil.`,
      ],
    },
    {
      id: 'predation',
      icon: '🦉',
      title: 'Räuber und Beute',
      paragraphs: [
        'Manche Tiere leben von anderen: der Waldkauz von Kleinsäugern, Spechte von Käfern, der Igel von Schnecken. Das ist gut so – Jäger halten Schädlinge klein und machen die Nahrungspyramide stimmig. Nichts stirbt, und nichts schwankt von selbst.',
        `Jede Beute hat einen Bestand: knapp, gut oder reichlich. Je zufriedener sie ist, desto größer ihr Bestand – eine rundum zufriedene Art ernährt bis zu ${formatNumber(STOCK_BASE + STOCK_RANGE)} Jäger. Passendes Futter, erfüllte Wünsche, keine Störer und eine zweite Beute-Art helfen.`,
        `Leben mehr Jäger als Futter da ist, ist die Beute überjagt: Sie wird scheu und verliert bis zu ${formatNumber(Math.round(OVERHUNT_PENALTY * OVERHUNT_MAX_UNITS * 100))} Prozentpunkte Zufriedenheit. Dann hilft zufriedenere Beute oder eine weitere Art, die dasselbe Futter bietet.`,
        `Lebt Beute ganz ohne Jäger, kann ab „${stageName(Math.min(...PREDATION_EVENTS.map((e) => e.minStage)))}“ ein Massenjahr kommen – ${all(PREDATION_EVENTS.map((e) => e.name))}. Du lädst die passenden Jäger ein oder nimmst das Massenjahr als Geschenk.`,
        'Wer wen jagt, zeigt das Nahrungsnetz im Reiter „Nischen“. Bestand und Futter stehen auch auf den Karten und auf der Seite jeder Art.',
      ],
    },
    {
      id: 'sowing',
      icon: '🌱',
      title: 'Säen',
      paragraphs: [
        `Ab „${ringStage}“ wachsen Begleitpflanzen im Pflanzring – ${formatNumber(PLANTS.length)} verschiedene. Du bekommst sie durch Säen: „🌱 Säen“ im Reiter „Nischen“ zieht meist ${formatNumber(CARDS_PER_ENCOUNTER)} Pflanzenkarten, und du wählst eine davon.`,
        `Die erste Aussaat jedes Zyklus ist ein Geschenk – der Wind bringt sie am zweiten Wegpunkt. Danach kostet Säen ${formatNumber(SOWING_BASE)} 🌰, jede weitere Aussaat im Zyklus ×${formatNumber(SOWING_GROWTH)}. ${springSowing}`,
        `Ist der Pflanzring voll, ersetzt die neue Pflanze eine andere – das zählt wie jede Aussaat. Passt keine Karte, legst du sie zurück: Das bringt die Samen von ${formatNumber(DECLINE_SEED_SECONDS)} Sekunden, der Preis der nächsten Aussaat bleibt aber gestiegen. Neu würfeln kostet wie bei Tieren. Es ist immer höchstens eine Aussaat offen.`,
        `In der Forschung ${sowingNodes.length === 1 ? 'bringt' : 'bringen'} ${all(sowingNodes)} mehr aus jeder Aussaat.`,
      ],
    },
    {
      id: 'plants',
      icon: '🌿',
      title: 'Pflanzen, Licht und Wasser',
      paragraphs: [
        'Jede Pflanze bringt Wachstum und Samen und bietet Tieren Futter oder einen Lebensraum. Dieselbe Pflanze darf mehrfach wachsen, Pflanzen sterben nicht.',
        `Pflanzen brauchen Licht ☀️ und Wasser 💧. Reicht es nicht, wachsen sie langsamer. Moos speichert Wasser, Schattenpflanzen kommen mit wenig Licht aus.`,
      ],
    },
    {
      id: 'communities',
      icon: '🐝',
      title: 'Gattungen und Lebensgemeinschaften',
      paragraphs: [
        `Es gibt ${formatNumber((options.landscape === true ? SPECIES : COMMON_SPECIES).length)} Arten in ${formatNumber(GENERA.length)} Gattungen: ${all(GENERA.map((g) => GENUS_INFO[g].name))}. Ab ${all(TRAIT_THRESHOLDS.map((t) => formatNumber(t)))} Arten einer Gattung gibt es jeweils einen Bonus.`,
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
        `Ab der Stufe „${cycleStage}“ kannst du einen Neuen Zyklus beginnen: Aus ${fruitPhrase(firstTree?.id)} wächst ein neuer Baum – später auch aus ${laterFruits}, sobald einmal eine ${laterPlants} in deinem Pflanzring gewachsen ist. Jede Art hat eine kleine Eigenheit.${siteTreesText} Tiere, Pflanzen und Samen beginnen von vorn; Naturtagebuch, Waldgedächtnis und Stammgäste bleiben.`,
        `Du bekommst Waldgedächtnis: ${MEMORY_PER_NEW_SPECIES === 1 ? '1 Punkt' : `${formatNumber(MEMORY_PER_NEW_SPECIES)} Punkte`} je neu entdeckter Art und 1 Punkt je ${formatNumber(memoryDivisor)} Punkte deiner höchsten Harmonie in diesem Zyklus${laterDivisors.length ? ` (${all(laterDivisors)} – später zählt mehr, was über der Schwelle liegt)` : ''}. Höchste Harmonie über einer Schwelle zählt extra: Jeder Punkt darüber bringt etwa ${formatNumber(MEMORY_PER_HARMONY_POINT)} Punkte mehr. Die Schwelle steigt mit jedem Wegpunkt – Bonus gibt es ${all(memoryThresholds)}. Wer länger wächst, braucht für neuen Bonus also mehr Harmonie – was du schon erreicht hast, bleibt dir aber: Die Vorschau sinkt nie. Die aktuelle Schwelle steht bei „Neuer Zyklus“. Jeder Punkt gibt dauerhaft +${pct(FOREST_MEMORY_BONUS)} Wachstum und Samen.`,
        `Je ${formatNumber(MEMORY_PER_REGULAR_SLOT)} Punkte Waldgedächtnis darfst du einen Stammgast wählen – eine entdeckte Art, die in jedem Zyklus von selbst einzieht.`,
      ],
    },
    landscapeSection(options.landscape === true),
    // Chroniken und Kennarten (26.7): erst mit der Landschaft – vorher schreibt der Heimatwald still mit.
    ...(options.landscape === true ? [chronicleSection()] : []),
    {
      id: 'seasons',
      icon: '🍂',
      title: 'Jahreszeiten',
      paragraphs: [
        `Jeder Zyklus beginnt im Frühling; alle ${seasonMinutes} Minuten Spielzeit wechselt die Jahreszeit – auch, während das Spiel geschlossen ist. Keine ist ein Hindernis, jede bringt etwas Eigenes:`,
        ...SEASONS.map((x) => `${x.icon} ${x.name}: ${x.summary}.`),
        'Manche Ereignisse und Gäste kommen nur zu ihrer Jahreszeit. Nur das Säen ist im Frühling günstiger – sonst kostet alles zu jeder Jahreszeit gleich viel.',
        'Wer mag, hört die Jahreszeiten auch – leiser Wind, Vogelrufe im Frühling und Sommer, Stille im Winter: unter ⚙️ Einstellungen → Klang (anfangs aus).',
      ],
    },
    {
      id: 'weather',
      icon: '🌦️',
      title: 'Wetter',
      paragraphs: [
        `Mit jeder Jahreszeit beginnt ein neuer Tag, und mit ihm zieht ein neues Wetter auf – es gilt den ganzen Tag. Die Wirkungen sind klein, und kein Wetter ist nur schlecht:`,
        ...WEATHERS.map((w) => `${w.icon} ${w.name}: ${w.summary}.`),
        `Raue Lagen (${all(roughWeathers.map((w) => w.name))}) bremsen das Wachstum, bringen dafür mehr Samen. Jede Gattung mit Tieren dämpft den Abzug um ${pct(DIVERSITY_DAMPING_PER_GENUS)}, höchstens um ${pct(DIVERSITY_DAMPING_MAX)}. Die passende Pflege halbiert ihn: ${all(protections)}.${immune.length > 0 ? ` ${all(immune)}.` : ''}`,
        `Zwei raue Tage folgen nie aufeinander, und in den ersten ${formatNumber(GENTLE_DAYS)} Tagen eines Zyklus bleibt es ruhig. Das Wetter neben der Jahreszeit unter dem Bild zeigt das Wetter von heute – antippen verrät, was den Abzug dämpft, und das Wetter von morgen. Warten lohnt sich nicht: Nichts wird billiger oder teurer.`,
        // Wetter je Waldtyp (24.14) – erst mit der Landschaft (Spoiler-Regel).
        ...(options.landscape === true ? siteWeatherParagraphs() : []),
      ],
    },
    {
      id: 'night',
      icon: '🌙',
      title: 'Tag, Nacht und Nachtarten',
      paragraphs: [
        `Jede Jahreszeit erlebt einen ganzen Tag mit Morgen, Abend und Nacht; die Hälfte der Spielzeit ist Nacht. Nachts werden ${formatNumber(shownNocturnal.length)} Arten aktiv: ${all(nocturnal)}.${restingNames.length > 0 ? ` ${all(restingNames)} ruhen im Winter.` : ''}`,
        'Ohne Nachtarten bleibt die Nacht ohne Wirkung – du verpasst nichts, wenn du nachts nicht spielst. Solange ein Nachtbonus wirkt, leuchtet ein 🌙 am Sticker der Art und am Etikett der Rate.',
        `Bist du länger als ein paar Minuten weg (ab ${formatNumber(OFFLINE_AVERAGE_MIN_SECONDS / 60)} Minuten), rechnet das Spiel mit dem Mittel aus Wetter und Nacht; die Begrüßung sagt dann „Wetter gemittelt“. Die Einstellung „Tageszeit: Immer Tag“ ändert nur das Bild – Nacht und Wetter wirken weiter.`,
      ],
    },
    {
      id: 'seeds',
      icon: '🌰',
      title: 'Samen',
      paragraphs: [
        `Samen sammelst du nebenbei – mehr Pflanzen und Harmonie bringen mehr. Du gibst sie für neue Pflanzen, fürs Neu würfeln und für den Ausbau aus; Ablehnen bringt welche zurück. Nichts verfällt.`,
      ],
    },
    upgradeSection(),
    {
      id: 'events',
      icon: '⛈️',
      title: 'Ereignisse',
      paragraphs: [
        `Ab „${eventStage}“ kann statt eines Tiers oder einer Pflanze ein Ereignis kommen – ${formatNumber(EVENTS.length)} gibt es: ${listNames(EVENTS.map((e) => e.name), 3)}. Jedes kommt höchstens einmal pro Zyklus.`,
        `Du wählst eine von ${span(EVENTS.map((e) => e.options.length))} Möglichkeiten, keine ist eine Strafe: Manche Wirkungen (mehr Licht, Wasser, Plätze oder ein Lebensraum wie Totholz) gelten bis zum Neuen Zyklus${habitatEvent ? ` – manche Lebensräume öffnen auch durch Ereignisse wie „${habitatEvent.name}“, ebenfalls bis zum Neuen Zyklus` : ''}, Zeit-Boni wie „${timedExample}“ laufen ${span(timedSeconds.map(minutes))} Minuten Spielzeit – auch offline. Die Samen-Option bringt sofort so viele Samen, wie du in ${span(seedSeconds)} Sekunden sammelst, mindestens ${formatNumber(SEED_SECONDS_MIN_SEEDS)} 🌰.`,
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
      title: 'Forschung',
      paragraphs: [
        `Deine Harmonie ist eine Produktion: Sie füllt jede Minute einen Vorrat ⚖️ – so viele Punkte, wie die Harmonie gerade beträgt, mit dem Waldgedächtnis mehr. Der Harmonie-Bonus auf 🌿 und 🌰 hängt an der Produktion, Ausgeben senkt ihn nie.`,
        `Ab „${careStage}“ erforschst du mit dem Vorrat ${formatNumber(RESEARCH_ONCE.length)} Knoten in ${formatNumber(RESEARCH_BRANCHES.length)} Ästen: ${listNames(RESEARCH_BRANCHES.map((b) => b.name), RESEARCH_BRANCHES.length)}. Manche brauchen erst andere Knoten, spätere eine höhere Stufe.`,
        `Am Ende jedes Asts wartet ab „${stageName(Math.min(...RESEARCH_REPEATABLE.map((n) => n.minStage)))}“ ein endloser Knoten (∞): Du erforschst ihn Rang für Rang, jeder Rang wirkt ein wenig mehr und kostet mehr.`,
        `Erforschte Knoten wirken bis zum Neuen Zyklus; dann beginnen Vorrat und Forschung neu. Verkaufen geht nicht – überlege, was dein Wald gerade braucht.`,
        ...forks.map((pair) => `${all(pair.map((n) => `„${n}“`))} schließen sich aus: Du wählst einen der beiden Wege.`),
      ],
    },
    {
      id: 'achievements',
      icon: '🏅',
      title: 'Erfolge',
      paragraphs: [
        `${formatNumber(ACHIEVEMENTS.filter((a) => isAchievementVisibleIn(a, options.landscape === true)).length)} leise Erfolge begleiten dich durch das ganze Spiel: Stufen, Einträge im Naturtagebuch, Harmonie, Gäste, Ausbau, Tagesziele, Zyklen und Spielzeit. Du findest sie im Reiter „Ziele“ unter „Erfolge“ – offene mit ihrem Fortschritt.`,
        'Es gibt keine Eile: Erfolge haben keine Zeitlimits, bringen keine Belohnung in Zahlen und gehen nie verloren, auch nicht beim Neuen Zyklus. Sie kommen ganz von selbst, Schritt für Schritt.',
      ],
    },
    {
      id: 'daily',
      icon: '📅',
      title: 'Tagesziele',
      paragraphs: [
        'Jeden Tag schlägt dir das Naturtagebuch zwei bis drei kleine Aufgaben vor, die zu deinem Wald passen und in einem kurzen Besuch zu schaffen sind. Erfüllte Ziele belohnen sich sofort mit ein paar Samen, manchmal mit einer Begegnung seltener Arten.',
        'Ziele zum Beobachten, Entscheiden oder Harmonie-Halten zählen nur, während du spielst; Zufriedenheit und Lebensgemeinschaften auch, wenn du weg warst. Die Ziele eines Tages bleiben beim Neuen Zyklus erhalten. Wer an aufeinanderfolgenden Tagen ein Ziel erfüllt, baut eine Serie auf – ein verpasster Tag setzt nur sie zurück.',
      ],
    },
    {
      // Offline 10 % (DESIGN_V2.md 28.3): ein Absatz mit der Regel.
      id: 'offline',
      icon: '💤',
      title: 'Offline',
      paragraphs: [
        `Dein Wald wächst am schnellsten, während du zusiehst. Bist du weg – Spiel geschlossen, Tab im Hintergrund oder Rechner im Ruhezustand –, zählen die ersten ${formatNumber(OFFLINE_FULL_SECONDS)} Sekunden voll, danach wächst er mit ${pct(OFFLINE_YIELD)} der Kraft weiter: Wachstum, Samen und Harmonie-Vorrat. Die Zeit selbst läuft voll – Jahreszeiten, Wetter, Zeit-Boni und Gäste ziehen weiter wie sonst. Nachgerechnet werden höchstens ${formatDuration(MAX_OFFLINE_SECONDS)}.`,
      ],
    },
  ];
}

/**
 * Kapitel „Ausbau“ (DESIGN_V2.md 28.4/28.9): Nischen- und Baum-Ausbau, Preise, Kaufmenge,
 * Meilensteine und Abzeichen – alle Zahlen und Namen aus content/upgrades.ts.
 */
function upgradeSection(): GuideSection {
  const bases = Object.values(NICHE_UPGRADE_BASE);
  const effects = NICHE_MILESTONES.filter((m) => m.kind !== 'badge');
  const milestones = effects.map((m) => `Stufe ${formatNumber(m.level)} „${MILESTONE_NAMES[m.level] ?? m.summary}“: ${m.summary}`);
  const parts = TREE_PARTS.map((p) => `${p.icon} ${p.name} (${p.summary} je Stufe)`);
  const partMilestones = TREE_PARTS.flatMap((p) => p.milestones.filter((m) => m.kind !== 'badge').map((m) => `${p.name} ${formatNumber(m.level)}: ${m.summary}`));
  const badges = NICHE_MILESTONES.filter((m) => m.kind === 'badge').map((m) => `${m.kind === 'badge' ? BADGE_NAMES[m.badge] : ''} ab Stufe ${formatNumber(m.level)}`);
  return {
    id: 'upgrades',
    icon: '🪺',
    title: 'Ausbau',
    paragraphs: [
      `Wohin mit den Samen? In den Ausbau – er hat kein Ende. Im Reiter „Nischen“ baust du jede offene Nische aus: Je Stufe bekommt jedes Tier dort +${formatNumber(NICHE_UPGRADE_PCT)} % Wachstum und Samen, mal seiner Zufriedenheit. Ganz oben unter „🌳 Dein Baum“ wachsen ${all(parts)}.`,
      `Die erste Stufe kostet je nach Nische ${span(bases)} 🌰, an deinem Baum ${formatNumber(TREE_UPGRADE_BASE)} 🌰; jede weitere ${formatNumber(Math.round((UPGRADE_GROWTH - 1) * 100))} % mehr als die vorige. Oben rechts im Reiter wählst du, wie viel ein Knopf kauft: ×1, ×10 oder Max – so viele Stufen, wie die Samen reichen. Reicht es noch nicht, steht am Knopf, wie lange es dauert.`,
      `Meilensteine jeder Nische: ${all(milestones)}. Am Baum: ${all(partMilestones)}. Ein Platz aus dem Ausbau zählt nur in einer Nische, die schon offen ist – verschlossene Nischen lassen sich erst ausbauen, wenn sie sich öffnen.`,
      `Mit dem Neuen Zyklus beginnt der Ausbau von vorn. Was bleibt, sind die Abzeichen – ${all(badges)} –, am Etikett der Nische und in der Statistik unter „Höchste Ausbaustufen“.`,
    ],
  };
}

/** Standorte mit eigenem Wetter (ohne Heimatwald), in der Reihenfolge der Daten. */
function weatherSites() {
  return LANDSCAPE_SITES.filter((s) => s.weatherSummary);
}

/**
 * Wetter je Waldtyp für das Kapitel „Wetter“ (DESIGN_V2.md 24.14): ein Satz zur Regel, dann je
 * Wald eine Zeile mit dem Zeichen der häufigsten Lage („🌨️ Viel Neuschnee …“).
 */
function siteWeatherParagraphs(): string[] {
  const home = LANDSCAPE_SITES.find((s) => s.id === HOME_SITE);
  return [
    `Jeder Waldtyp der Landschaft hat sein eigenes Wetter – es gilt, solange dort dein Zyklus wächst. Der ${home?.name ?? 'Heimatwald'} hat das gewohnte Wetter; die Notiz „Wetter heute“ nennt das Wetter des Waldes, in dem du gerade wächst:`,
    ...weatherSites().map((s) => `${s.icon} ${s.name}: ${siteWeatherText(s.id) ?? s.weatherSummary}`),
  ];
}

/**
 * Abschnitt „Chroniken und Kennarten“ (DESIGN_V2.md 26.3, 26.4, 26.7) – nur mit der Landschaft.
 * Nennt Kapitel und Regeln mit Zahlen aus content/, aber keine Kennart beim Namen (die Reihe
 * „Kennarten“ zeigt sie als Silhouette mit ihrem Wald).
 */
function chronicleSection(): GuideSection {
  const ancient = STAGES[STAGES.length - 1]!.name;
  const titles = CHRONICLE_CHAPTERS.map((c) => `${c.icon} „${c.title}“`);
  const sites = LANDSCAPE_SITES.length;
  return {
    id: 'chronicle',
    icon: '📜',
    title: 'Chroniken und Kennarten',
    paragraphs: [
      `Jeder Wald der Landschaft schreibt eine Chronik in ${formatNumber(CHRONICLE_CHAPTERS.length)} Kapiteln: ${all(titles)}. Ein Kapitel schreibt nur der Wald, in dem du gerade wächst – einmal und für immer, auch während das Spiel geschlossen ist. Keines kostet etwas, keines verfällt.`,
      `„Erster Schnee“ verlangt Geduld: Bleib nach dem ${ancient} noch, bis der Winter kommt, statt gleich neu zu beginnen. „Voller Einklang“ heißt eine höchste Harmonie von ${formatNumber(CHRONICLE_HARMONY)} in einem Zyklus, „Ein Wald erinnert sich“ das volle eigene Gedächtnis von ${formatNumber(MAX_FOREST_MEMORY)}. Das Ereignis des Waldes entscheidest du, wenn es dort als Begegnung kommt – gleich wie.`,
      `Jeder neue Eintrag kommt als Stempel „📜 Neues Kapitel“ mit Zyklus und Jahreszeit. Der Standort zeigt die Chronik als sechs Zettel – offene mit einem Hinweis. Die Karte zählt alle ${formatNumber(sites * CHRONICLE_CHAPTERS.length)} Kapitel; eine vollständige Chronik bekommt ein Wachssiegel und schenkt dir ein Andenken (Reiter „Arten“ → Andenken).`,
      `🔎 Kennarten: Jeder der ${formatNumber(sites)} Wälder hat eine seltene Art, die nur dort lebt – und nur, wenn der Wald alt ist: Er war schon einmal ${ancient}, oder dein Zyklus steht dort gerade im ${ancient}. Im Reiter „Arten“ stehen sie in einer eigenen Reihe, unentdeckt als Silhouette mit ihrem Wald. Wandert eine Kennart über einen Korridor in einen anderen Wald, zählt ihr Kapitel trotzdem nur in ihrem eigenen.`,
    ],
  };
}

/**
 * Abschnitt „Waldlandschaft“ (DESIGN_V2.md 24): vor der Freischaltung nur eine Andeutung,
 * danach die Regeln mit Zahlen aus content/.
 */
function landscapeSection(unlocked: boolean): GuideSection {
  const ancient = STAGES[STAGES.length - 1]!.name;
  const cycleStage = STAGES[NEW_CYCLE_MIN_STAGE]?.name ?? ancient;
  if (!unlocked) {
    return {
      id: 'landscape',
      icon: '🪶',
      title: 'Ein Wald bleibt nicht allein',
      paragraphs: [
        `Ein alter Wald mit viel Waldgedächtnis lockt Besucher an, die weit herumkommen. Wer einen ${ancient} wachsen lässt und sich gut an seine Zyklen erinnert, wird eines Tages sehen, wohin sie fliegen.`,
      ],
    };
  }
  const others = LANDSCAPE_SITES.filter((s) => s.id !== 'home');
  const home = LANDSCAPE_SITES.find((s) => s.id === 'home');
  const spokes = CORRIDORS.filter((c) => c.sites.includes('home'));
  const ring = CORRIDORS.filter((c) => !c.sites.includes('home'));
  // Beispiel fürs Wetter je Waldtyp: der Bergmischwald (Neuschnee), sonst der erste mit eigenem Wetter.
  const weatherExample = weatherSites().find((s) => s.id === 'mountain') ?? weatherSites()[0];
  // Beispiel für die häufigeren Ereignisse (Phase 9, 1c): der erste Wald mit einem Faktor.
  const eventExample = others.find((s) => siteEventText(s) !== null);
  return {
    id: 'landscape',
    icon: '🪶',
    title: 'Waldlandschaft und Hähersaat',
    paragraphs: [
      `Nach deinem ersten ${ancient} und ab ${formatNumber(LANDSCAPE_UNLOCK_MEMORY)} Waldgedächtnis im ${home?.name ?? 'Heimatwald'} öffnet sich der Reiter „Landschaft“ mit der Karte: Um deinen ${home?.name ?? 'Heimatwald'} liegen ${formatNumber(others.length)} weitere Standorte – ${all(others.map((s) => `${s.icon} ${s.name}`))}. Jeder ist ein eigener Wald mit eigenem Waldgedächtnis (höchstens ${formatNumber(MAX_FOREST_MEMORY)}), eigenen Stammgästen und einem Waldtyp.`,
      `🪶 Hähersaat verdienst du, statt sie zu sammeln: ${formatNumber(1)} je volle ${formatNumber(JAY_SEEDS_MEMORY_STEP)} Punkte eigenes Waldgedächtnis eines Waldes und ${formatNumber(JAY_SEEDS_FIRST_ANCIENT)} für den ersten ${ancient} dort. Einen neuen Wald gründest du nur aus dem ${ancient} und nur gleich neben dem Wald, in dem du gerade wächst. Er kostet ${all(FOUNDING_COSTS.map((c) => formatNumber(c)))} 🪶 (der 2. bis ${formatNumber(FOUNDING_COSTS.length + 1)}. Wald); der Korridor dorthin entsteht gratis.`,
      `Wechseln kannst du ab der Stufe „${cycleStage}“: Der Gewinn des Zyklus geht noch an den alten Wald, danach gelten Gedächtnis, Stammgäste und Eigenheit des neuen. Nichts geht verloren – ein Wald, den du verlässt, ruht und wartet auf dich.`,
      `Jeder Waldtyp hat eine Eigenheit mit Gewinn und Verzicht, die nur dort wirkt, und eine Gabe, die in allen Wäldern gilt, sobald er gegründet ist. Die Karte zeigt beides.`,
      ...(weatherExample
        ? [`Auch das Wetter hängt am Waldtyp, etwa ${weatherExample.icon} ${weatherExample.name}: ${siteWeatherText(weatherExample.id) ?? weatherExample.weatherSummary} Das kleine Zeichen an jedem Standort der Karte zeigt seine häufigste Lage, das Kapitel „Wetter“ alle Wälder.`]
        : []),
      ...(eventExample
        ? [`Jeder Wald erlebt außerdem eigene Ereignisse öfter, etwa ${eventExample.icon} ${eventExample.name}: ${siteEventText(eventExample)}. Der Standort und die Karte nennen sie unter „Hier öfter“.`]
        : []),
      `Korridore verbinden zwei gegründete Wälder und lassen sich jederzeit bauen: ${formatNumber(spokes.length)} am ${home?.name ?? 'Heimatwald'} (je ${span(spokes.map((c) => c.cost))} 🪶) und ${formatNumber(ring.length)} im Ring (${span(ring.map((c) => c.cost))} 🪶). Über sie hilft das Gedächtnis der Nachbarn: ${pct(CORRIDOR_INFLOW)} ihres eigenen Gedächtnisses zählt mit, zusammen höchstens ${formatNumber(CORRIDOR_INFLOW_CAP)} – das wirksame Gedächtnis gibt Bonus und Stammgast-Plätze.`,
      `🦌 Wildwechsel: Jeder Korridor am Wald, in dem du gerade wächst, gibt ${pct(WILDWECHSEL_CHANCE)} Chance (zusammen höchstens ${pct(WILDWECHSEL_MAX_CHANCE)}), dass eine Tierbegegnung eine Art aus dem Nachbarwald zeigt – aus den Tieren, die dort lebten, als du ihn zuletzt verlassen hast. Es kommen nur Arten, die zu Stufe und Nischen passen und noch nicht bei dir leben, höchstens eine je Begegnung. Die Karte nennt den Weg, z. B. „kommt über die Schlehenhecke aus den Buchenhallen“; die Karte der Landschaft zeigt die Chance. Außerdem zeigt sich jeder Waldtyp öfter mit seinen typischen Gattungen, der Auwald etwa mit Amphibien und Vögeln.`,
    ],
  };
}
