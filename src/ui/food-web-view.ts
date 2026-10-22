/**
 * Räuber und Beute in der Oberfläche (DESIGN_V2.md 22.7): Nahrungsnetz der Übersicht,
 * Bestand und Futter in Tierdetails, Kacheln und Karten. Reine Funktionen ohne DOM,
 * getestet in tests/food-web-view.test.ts.
 *
 * Alle Zahlen kommen aus der Auswertung des Kerns (`Evaluation.foodWeb`,
 * `AnimalStatus.stock`); hier stehen nur Worte, Symbole und Hinweise. Bestand erscheint
 * nie als Zahl, sondern als „knapp“, „gut“ oder „reichlich“ (`STOCK_LOW`/`STOCK_HIGH`).
 */
import { EVENTS, type GameEvent } from '../content/events';
import { STOCK_BASE, STOCK_HIGH, STOCK_LOW, STOCK_RANGE } from '../content/predation';
import { EVENT_SEASONS, SEASONS_BY_ID } from '../content/seasons';
import { SPECIES_BY_ID, TAG_NAMES, type Species } from '../content/species';
import { STAGES } from '../content/stages';
import type { AnimalStatus, Evaluation, FoodWebEntry } from '../core/formulas';
import type { GameState } from '../core/state';
import { formatNumber } from './format';
import type {
  DetailPredationView,
  EffectView,
  FoodWebRowView,
  FoodWebStateKey,
  FoodWebView,
  StockLevel,
  StockView,
} from './view-model';

/** Was das Spiel schon kennt – unentdeckte Arten heißen „???“ (Spoiler-Regel, DESIGN_V2 9.2). */
export type FoodWebJournal = Pick<GameState['meta']['journal'], 'species'>;

/** Symbol je Beute-Merkmal (unbekannte Merkmale: 🐾). */
const PREY_ICONS: Readonly<Record<string, string>> = {
  insekten: '🐞',
  raupen: '🐛',
  kaefer: '🪲',
  wuermer: '🪱',
  schnecken: '🐌',
  kleinsaeuger: '🐭',
  rehe: '🦌',
  // Futter, das bisher nur Pflanzen bieten – falls einmal ein Tier es bereitstellt.
  nuesse: '🥜',
  beeren: '🍒',
  // Lebensräume (Schritt B, 23.7) – schon vorbereitet, falls die Merkmale kommen.
  amphibien: '🐸',
  echsen: '🦎',
  hasen: '🐇',
};

export const STOCK_LABELS: Readonly<Record<StockLevel, string>> = { low: 'knapp', good: 'gut', high: 'reichlich' };

export const FOOD_WEB_STATE_LABELS: Readonly<Record<FoodWebStateKey, string>> = {
  balanced: 'im Gleichgewicht',
  overhunted: 'überjagt',
  unhunted: 'ungejagt',
};

/** Symbole zum Zustand – Schmuck, der Zustand steht immer auch als Text daneben. */
export const FOOD_WEB_STATE_ICONS: Readonly<Record<FoodWebStateKey, string>> = {
  balanced: '✓',
  overhunted: '👀',
  unhunted: '○',
};

export const FOOD_WEB_EMPTY =
  'Noch keine Beute im Wald. Sobald Tiere einziehen, von denen andere leben, zeigt sich hier, wer wen jagt.';

export function preyIcon(tag: string): string {
  return PREY_ICONS[tag] ?? '🐾';
}

function tagName(tag: string): string {
  return (TAG_NAMES as Readonly<Record<string, string>>)[tag] ?? tag;
}

/** Bestand (0,5 … 1,5) in Worten; NaN gilt als knapp. */
export function stockLevel(stock: number): StockLevel {
  if (!(stock >= STOCK_LOW)) return 'low';
  return stock >= STOCK_HIGH ? 'high' : 'good';
}

export function stockView(stock: number): StockView {
  const level = stockLevel(stock);
  return { level, label: STOCK_LABELS[level] };
}

/** „A“, „A und B“, „A, B und 2 weitere“ (wie `listNames` in adapters.ts). */
function names(list: readonly string[], max = 3): string {
  if (list.length <= 1) return list[0] ?? '';
  if (list.length <= max) return `${list.slice(0, -1).join(', ')} und ${list[list.length - 1]}`;
  return `${list.slice(0, max).join(', ')} und ${formatNumber(list.length - max)} weitere`;
}

/** Name einer Art – unentdeckte heißen „???“. */
function speciesName(id: string, journal: FoodWebJournal): string {
  const sp = SPECIES_BY_ID.get(id);
  if (!sp) return '???';
  return journal.species.includes(id) ? sp.name : '???';
}

const namesOf = (ids: readonly string[], journal: FoodWebJournal, max = 3) => names(ids.map((id) => speciesName(id, journal)), max);

/** Massenjahr, das Jäger für dieses Merkmal einlädt (Bedingung `unhunted`, 22.5). */
export function massYearFor(tag: string): GameEvent | undefined {
  return EVENTS.find((e) => e.appears?.some((c) => c.kind === 'unhunted' && c.tag === tag));
}

/** Jahreszeiten eines Ereignisses als Text, z. B. „Frühling oder Sommer“. */
function eventSeasons(id: string): string {
  const seasons = (EVENT_SEASONS[id] ?? []).map((s) => SEASONS_BY_ID.get(s)?.name ?? s);
  if (seasons.length <= 1) return seasons[0] ?? '';
  return `${seasons.slice(0, -1).join(', ')} oder ${seasons[seasons.length - 1]}`;
}

/** Größter Bestand einer Beute-Art (rundum zufrieden). */
const STOCK_MAX = STOCK_BASE + STOCK_RANGE;

/**
 * Was bei Überjagung hilft – freundlich, ohne Warnton. Zufriedenere Beute hilft nur, solange
 * ihr Bestand noch wachsen kann: Sind mehr Jäger da, als die Beute selbst rundum zufrieden
 * ernähren könnte (Arten × höchster Bestand), oder ist der Bestand schon am Maximum, hilft
 * nur eine weitere Art, die das Merkmal bietet („Art, die Würmer bietet“ – kein Dativ nötig).
 */
export function overhuntHint(entry: Pick<FoodWebEntry, 'tag' | 'prey' | 'hunters' | 'stock'>): string {
  const name = tagName(entry.tag);
  // Wer sich selbst frisst (Rote Waldameise), zählt nicht als Jäger seiner eigenen Art.
  const hunters = entry.hunters.filter((h) => !entry.prey.includes(h)).length;
  const most = entry.prey.length * STOCK_MAX;
  const atMax = entry.stock >= most - 1e-9;
  if (hunters > most + 1e-9 || atMax) return `Mehr Jäger als Futter – eine weitere Art, die ${name} bietet, hilft.`;
  return `Mehr Jäger als Futter – zufriedenere Beute oder eine weitere Art, die ${name} bietet, hilft.`;
}

/** Fressen nur Arten, die selbst die Beute sind (Rote Waldameise allein bei den Insekten)? */
export function onlyCannibals(entry: Pick<FoodWebEntry, 'prey' | 'hunters'>): boolean {
  return entry.hunters.length > 0 && entry.hunters.every((h) => entry.prey.includes(h)) && entry.prey.every((p) => entry.hunters.includes(p));
}

/** Zustand für die Hinweise: wartende Begegnungen optional (ältere Aufrufer, Tests). */
type HintState = Pick<GameState, 'stage' | 'cycle'> & Partial<Pick<GameState, 'pendingEncounters'>>;

/**
 * Hinweis für ungejagte Beute: Kann ein Massenjahr Jäger einladen (mit Stufe bzw.
 * Jahreszeit), wartet es noch im Stapel, oder ist es in diesem Zyklus schon vorbei?
 * Ungejagt ist nie ein Nachteil.
 */
export function unhuntedHint(tag: string, state: HintState): string {
  const event = massYearFor(tag);
  if (!event) return 'Kein Nachteil – ein Jäger fände hier Futter.';
  if (state.stage < event.minStage) {
    return `Ab „${STAGES[event.minStage]?.name ?? '?'}“ kann ein ${event.name} Jäger einladen.`;
  }
  // Gezogen (steht schon in `seen`), aber noch nicht entschieden: Die Wahl ist noch offen.
  if (state.pendingEncounters?.some((p) => p.type === 'event' && p.cards[0] === event.id)) {
    return `Das ${event.name} wartet unter deinen Begegnungen – dort kannst du Jäger einladen.`;
  }
  if (state.cycle.seen.includes(event.id)) return `Das ${event.name} war schon – ein Jäger fände hier Futter.`;
  const seasons = eventSeasons(event.id);
  return `Ein ${event.name}${seasons ? ` (${seasons})` : ''} kann Jäger einladen – oder du nimmst es als Geschenk.`;
}

function rowHint(entry: FoodWebEntry, state: HintState): string {
  if (entry.state === 'overhunted') return overhuntHint(entry);
  if (entry.state === 'unhunted') return unhuntedHint(entry.tag, state);
  if (entry.hunters.length === 0) return 'Wird klein gehalten, ohne gejagt zu werden.';
  if (onlyCannibals(entry)) return 'Nur Artgenossen fressen hier – kein Nachteil, ein weiterer Jäger fände Futter.';
  // Futterangebot (≥ 1 je Beute) reicht noch für einen ganzen Jäger mehr?
  if (entry.supply - entry.hunters.length >= 1 - 1e-9) return 'Die Jäger werden satt – es reicht noch für einen weiteren.';
  return 'Die Jäger werden satt, die Beute bleibt gelassen.';
}

/** Bestand je Merkmal: Durchschnitt der Beute (so heißt „reichlich“ dasselbe wie am Tier). */
function entryStock(entry: FoodWebEntry): StockView {
  return stockView(entry.prey.length > 0 ? entry.stock / entry.prey.length : 0);
}

/** Jäger mit Namen; wer selbst Beute dieses Merkmals ist, „frisst Artgenossen“. */
function hunterNames(entry: FoodWebEntry, journal: FoodWebJournal): string {
  return names(
    entry.hunters.map((id) => {
      const name = speciesName(id, journal);
      return entry.prey.includes(id) && name !== '???' ? `${name} (frisst Artgenossen)` : name;
    }),
  );
}

export function foodWebRow(entry: FoodWebEntry, state: HintState, journal: FoodWebJournal): FoodWebRowView {
  return {
    tag: entry.tag,
    icon: preyIcon(entry.tag),
    name: tagName(entry.tag),
    state: entry.state,
    stateLabel: FOOD_WEB_STATE_LABELS[entry.state],
    stateIcon: FOOD_WEB_STATE_ICONS[entry.state],
    stock: entryStock(entry),
    prey: namesOf(entry.prey, journal),
    hunters: hunterNames(entry, journal),
    hunterCount: entry.hunters.length,
    hunterIds: entry.hunters.filter((id) => journal.species.includes(id) && SPECIES_BY_ID.has(id)),
    controllers: namesOf(entry.controllers, journal),
    hint: rowHint(entry, state),
  };
}

/** Kurzfassung, z. B. „2 im Gleichgewicht · 1 überjagt“ (Reihenfolge: überjagt zuerst). */
export function foodWebSummary(entries: readonly Pick<FoodWebEntry, 'state'>[]): string {
  if (entries.length === 0) return 'noch keine Beute';
  const order: FoodWebStateKey[] = ['overhunted', 'unhunted', 'balanced'];
  return order
    .map((s) => ({ s, n: entries.filter((e) => e.state === s).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${formatNumber(x.n)} ${FOOD_WEB_STATE_LABELS[x.s]}`)
    .join(' · ');
}

/** Das Nahrungsnetz der Übersicht: eine Zeile je Beute-Merkmal mit Beute im Wald. */
export function foodWebView(
  evaluation: Readonly<Pick<Evaluation, 'foodWeb'>>,
  state: HintState & Pick<GameState, 'meta'>,
): FoodWebView {
  const entries = evaluation.foodWeb ?? [];
  return {
    rows: entries.map((e) => foodWebRow(e, state, state.meta.journal)),
    summary: foodWebSummary(entries),
    emptyText: FOOD_WEB_EMPTY,
  };
}

/** Einträge, in denen die Art Beute ist bzw. jagt (Kern-Reihenfolge). */
function preyEntries(id: string, web: readonly FoodWebEntry[]): FoodWebEntry[] {
  return web.filter((e) => e.prey.includes(id));
}
function huntEntries(id: string, web: readonly FoodWebEntry[]): FoodWebEntry[] {
  return web.filter((e) => e.hunters.includes(id));
}

/** Bestand einer Art, falls sie im Wald Beute ist (sonst undefined – etwa Zunderschwamm mit „Totholz“). */
export function animalStock(id: string, evaluation: Readonly<Pick<Evaluation, 'foodWeb' | 'animals'>>): StockView | undefined {
  const stock = evaluation.animals[id]?.stock;
  if (stock === undefined || preyEntries(id, evaluation.foodWeb ?? []).length === 0) return undefined;
  return stockView(stock);
}

/** „1 Jäger“ / „3 Jäger“. */
const hunterCount = (n: number) => `${formatNumber(n)} Jäger`;

/** Wer frisst diese Beute (ohne sie selbst) – „ernährt Waldkauz und Rotfuchs“. */
function feeds(sp: Species, entries: readonly FoodWebEntry[], journal: FoodWebJournal): string[] {
  const ids: string[] = [];
  for (const e of entries) for (const h of e.hunters) if (h !== sp.id && !ids.includes(h)) ids.push(h);
  return ids.map((id) => speciesName(id, journal));
}

/**
 * Zeile „Bestand“ für Karten: „Bestand: reichlich – ernährt Waldkauz und Rotfuchs“ bzw.
 * „Bestand: gut – noch kein Jäger“. null, wenn die Art hier keine Beute ist.
 */
export function stockEffectView(sp: Species, evaluation: Readonly<Pick<Evaluation, 'foodWeb' | 'animals'>>, journal: FoodWebJournal): EffectView | null {
  const stock = animalStock(sp.id, evaluation);
  if (!stock) return null;
  const eaters = feeds(sp, preyEntries(sp.id, evaluation.foodWeb), journal);
  const who = eaters.length > 0 ? `ernährt ${names(eaters, 2)}` : 'noch kein Jäger';
  return { label: `Bestand: ${stock.label} – ${who}`, tone: 'neutral' };
}

/** Futter eines Merkmals für seine Jäger: „Kleinsäuger: reicht für 2 Jäger“ bzw. „… zu knapp für 3 Jäger“. */
function huntEntryText(e: FoodWebEntry): string {
  const verdict = e.state === 'overhunted' ? 'zu knapp' : 'reicht';
  return `${tagName(e.tag)}: ${verdict} für ${hunterCount(e.hunters.length)}`;
}

/**
 * Futter eines Jägers aus dem Nahrungsnetz, z. B. „Kleinsäuger: reicht für 2 Jäger“ (je
 * gejagtem Merkmal, mehrere mit „ · “). Leer, wenn die Art nichts jagt.
 */
export function huntFoodText(id: string, web: readonly FoodWebEntry[]): string {
  // Reihenfolge wie die Futterzeile („🍽 Raupen / Insekten“).
  const food: readonly string[] = SPECIES_BY_ID.get(id)?.food ?? [];
  return huntEntries(id, web)
    .sort((a, b) => food.indexOf(a.tag) - food.indexOf(b.tag))
    .map(huntEntryText)
    .join(' · ');
}

/**
 * Hinweis auf einer Jäger-Karte, wenn sein Einzug eine Beute überjagt, die es vorher nicht
 * war – freundlich (neutral), die Vorschau-Chips rechnen den Abzug ehrlich mit.
 */
export function overhuntNotes(id: string, now: Readonly<Pick<Evaluation, 'foodWeb'>>, after: Readonly<Pick<Evaluation, 'foodWeb'>>): EffectView[] {
  const before = new Map((now.foodWeb ?? []).map((e) => [e.tag, e.state]));
  return huntEntries(id, after.foodWeb ?? [])
    .filter((e) => e.state === 'overhunted' && before.get(e.tag) !== 'overhunted')
    .map((e) => ({ label: `👀 Mehr Jäger als ${tagName(e.tag)} – die Beute würde scheu`, tone: 'neutral' as const }));
}

/** Räuber und Beute in den Tierdetails. Leer, wenn die Art weder Beute ist noch jagt. */
export function detailPredationViews(
  sp: Species,
  status: AnimalStatus | undefined,
  evaluation: Readonly<Pick<Evaluation, 'foodWeb'>>,
  state: HintState & Pick<GameState, 'meta'>,
): DetailPredationView[] {
  const web = evaluation.foodWeb ?? [];
  const journal = state.meta.journal;
  const out: DetailPredationView[] = [];
  const asPrey = preyEntries(sp.id, web);
  if (asPrey.length > 0 && status?.stock !== undefined) {
    const stock = stockView(status.stock);
    out.push({
      key: 'stock',
      icon: preyIcon(asPrey[0]!.tag),
      label: `Bestand: ${stock.label}`,
      hint: 'So viel Futter bietet sie Jägern – je zufriedener, desto mehr.',
      tone: stock.level === 'high' ? 'good' : 'neutral',
    });
    for (const e of asPrey) {
      const hunters = e.hunters.filter((h) => h !== sp.id);
      const name = tagName(e.tag);
      const row: DetailPredationView = { key: `prey-${e.tag}`, icon: preyIcon(e.tag), label: '', tone: 'neutral' };
      if (hunters.length > 0) {
        row.label = `${name}: ernährt ${namesOf(hunters, journal)}`;
        row.tone = 'good';
      } else if (e.hunters.includes(sp.id)) {
        row.label = `${name}: nur von ihr selbst gefressen`;
      } else if (e.controllers.length > 0) {
        row.label = `${name}: klein gehalten von ${namesOf(e.controllers, journal)}`;
      } else {
        row.label = `${name}: noch kein Jäger`;
      }
      if (e.state === 'overhunted') {
        row.label = `${name}: überjagt von ${namesOf(hunters, journal)}`;
        row.tone = 'neutral';
        row.hint = overhuntHint(e);
      } else if (e.state === 'unhunted') {
        row.hint = unhuntedHint(e.tag, state);
      }
      out.push(row);
    }
  }
  for (const e of huntEntries(sp.id, web)) {
    out.push({
      key: `hunt-${e.tag}`,
      icon: preyIcon(e.tag),
      label: `Futter ${huntEntryText(e)}`,
      hint:
        e.state === 'overhunted'
          ? overhuntHint(e)
          : onlyCannibals(e)
            ? 'Frisst Artgenossen – im Gleichgewicht.'
            : `Im Gleichgewicht – Bestand ${entryStock(e).label}.`,
      tone: e.state === 'overhunted' ? 'neutral' : 'good',
    });
  }
  return out;
}

/** Merkmale mit eigenem Symbol (Test: jedes Beute-Merkmal hat eines). */
export const PREY_ICON_TAGS: readonly string[] = Object.keys(PREY_ICONS);
