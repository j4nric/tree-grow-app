/**
 * Forschungsbaum als reine Ansicht (docs/DESIGN_V2.md 27.7 und 27.12, ROADMAP Phase 10, 1c).
 *
 * Diese Datei kennt kein DOM: Sie ordnet die Daten aus `content/research.ts` in Äste, Ebenen
 * und Gabeln und bildet einen übergebenen Zustand je Knoten auf Texte, Klassen und
 * aria-Angaben ab. Den Zustand liefert im Spiel der Spielstand (`research-state.ts`: Blocker aus
 * `researchBlocker`, Rang, Kosten, Plan); die Vorschau nimmt Beispielzustände aus
 * `research-fixtures.ts`. Das DOM baut `album/research-tree.ts`.
 *
 * Die wiederholbaren Knoten (28.6) stehen je Ast in einer eigenen Zeile „∞ immer weiter“ unter
 * der Wald-Ebene (Phase 11, 4a): Stempel „Rang 3“, Knopf mit den Kosten des nächsten Rangs.
 */
import {
  RESEARCH,
  RESEARCH_ONCE,
  RESEARCH_BRANCHES,
  RESEARCH_BY_ID,
  RESEARCH_FORKS,
  type ResearchBranch,
  type ResearchBranchId,
  type ResearchFork,
  type ResearchNode,
} from '../content/research';
import { STAGES } from '../content/stages';
import { MAX_HARMONY_POINTS } from '../core/state';
import { conditionName } from './adapters';
import { formatDuration, formatNumber, keepNumberWithIcon } from './format';

// ---------------------------------------------------------------------------------------
// Zustand (Eingabe)
// ---------------------------------------------------------------------------------------

/**
 * Zustand eines Knotens:
 * - `researched` erforscht (Stempel)
 * - `available` erforschbar (Knopf aktiv)
 * - `saving` alles erfüllt, nur zu wenig ⚖️
 * - `locked` gesperrt (Stufe, Voraussetzung oder Bedingung → `lock`)
 * - `excluded` durch eine Gabel ausgeschlossen (anderer Weg gewählt)
 */
export type ResearchStatus = 'researched' | 'available' | 'saving' | 'locked' | 'excluded';

/** Sperrgrund, Reihenfolge wie die Blocker in 27.7. */
export type ResearchLock = 'stage' | 'requires' | 'condition';

export interface ResearchNodeState {
  status: ResearchStatus;
  /** Nur bei `locked`: der erste Grund. */
  lock?: ResearchLock;
  /** Kosten des nächsten Kaufs (wiederholbare: nächster Rang); fehlt → `cost` aus den Daten. */
  cost?: number;
  /** Rang eines wiederholbaren Knotens (28.6); fehlt → 0. */
  rank?: number;
  /** Offene Einträge des Forschungsplans für diesen Knoten (Plan-Nummern ab 1, aufsteigend). */
  plan?: readonly number[];
  /** Der nächste offene Eintrag des Plans gehört zu diesem Knoten. */
  planNext?: boolean;
}

export interface ResearchTreeState {
  /** Vorrat ⚖️. */
  harmony: number;
  /** Produktion ⚖️/min (für „Noch 120 ⚖️ · 2 Min.“). */
  perMinute: number;
  /** Aktuelle Stufe (Index in STAGES). */
  stage: number;
  /** Zustand je Knoten-ID; fehlende Knoten gelten als gesperrt (Stufe). */
  nodes: Readonly<Record<string, ResearchNodeState>>;
  /** „Plan folgen“ an (Plan-Nummern kräftig) bzw. aus (blass). Fehlt → aus. */
  planActive?: boolean;
}

/** Blocker des Spielstands (27.7) → Zustand der Ansicht – für das Einhängen in 4a. */
export type ResearchBlocker =
  | 'unknown-node'
  | 'owned'
  | 'stage'
  | 'excluded'
  | 'requires'
  | 'condition'
  | 'too-expensive';

export function researchStatusFromBlocker(blocker: ResearchBlocker | null): ResearchNodeState {
  switch (blocker) {
    case null:
      return { status: 'available' };
    case 'owned':
      return { status: 'researched' };
    case 'too-expensive':
      return { status: 'saving' };
    case 'excluded':
      return { status: 'excluded' };
    case 'stage':
    case 'requires':
    case 'condition':
      return { status: 'locked', lock: blocker };
    case 'unknown-node':
      return { status: 'locked', lock: 'stage' };
  }
}

// ---------------------------------------------------------------------------------------
// Aufbau: Äste, Ebenen, Gabeln (fest, aus den Daten)
// ---------------------------------------------------------------------------------------

/** Ein Platz in einer Ebene: ein Knoten oder ein Gabel-Paar (zwei halbe Karten mit „oder“). */
export type ResearchSlot =
  | { kind: 'node'; id: string }
  | {
      kind: 'fork';
      forkId: string;
      /** Weg A, Weg B – derselbe Abschnitt beider Wege (bei der Krone Ebene I, II oder III). */
      ids: readonly [string, string];
      /** Erste Ebene der Gabel: Hier steht die Frage. */
      first: boolean;
    };

export interface ResearchTier {
  /** Stufe (Index in STAGES). */
  stage: number;
  /** Zeile im Desktop-Raster (0 = oberste Ebene; die Zeile „∞“ ist die letzte). */
  row: number;
  slots: readonly ResearchSlot[];
  /** Zeile „∞ immer weiter“ mit dem wiederholbaren Knoten des Asts (28.6, 28.9). */
  repeat?: boolean;
}

export interface ResearchBranchLayout {
  branch: ResearchBranch;
  /** Nur Ebenen mit Knoten. */
  tiers: readonly ResearchTier[];
  nodeIds: readonly string[];
}

/** Verbindung im Desktop-Raster (nur innerhalb eines Asts; andere Äste → „braucht …“). */
export interface ResearchEdge {
  from: string;
  to: string;
  /** Aus `requiresAny` („oder“): gestrichelt. */
  any: boolean;
}

export interface ResearchLayout {
  /** Alle Ebenen (Stufen) der einmaligen Knoten aufsteigend – die Zeilen des Rasters. */
  stages: readonly number[];
  /** Zeilen des Rasters: die Ebenen und darunter die Zeile „∞“. */
  rows: number;
  branches: readonly ResearchBranchLayout[];
  edges: readonly ResearchEdge[];
}

const FORK_OF = new Map<string, { fork: ResearchFork; path: 0 | 1; index: number }>();
for (const fork of RESEARCH_FORKS) {
  fork.paths.forEach((path, p) => path.forEach((id, index) => FORK_OF.set(id, { fork, path: p as 0 | 1, index })));
}

const BRANCH_BY_ID = new Map(RESEARCH_BRANCHES.map((b) => [b.id, b]));

/** Gabel und Weg eines Knotens (undefined: kein Gabel-Knoten). */
export function forkOf(id: string): { fork: ResearchFork; path: 0 | 1; index: number } | undefined {
  return FORK_OF.get(id);
}

let cachedLayout: ResearchLayout | null = null;

/** Der feste Aufbau des Baums – einmal berechnet. */
export function researchLayout(): ResearchLayout {
  if (cachedLayout) return cachedLayout;
  const stages = [...new Set(RESEARCH_ONCE.map((n) => n.minStage))].sort((a, b) => a - b);
  const branches = RESEARCH_BRANCHES.map((branch): ResearchBranchLayout => {
    const nodes = RESEARCH_ONCE.filter((n) => n.branch === branch.id);
    const tiers: ResearchTier[] = [];
    for (const stage of stages) {
      const slots: ResearchSlot[] = [];
      const placed = new Set<string>();
      for (const node of nodes) {
        if (node.minStage !== stage || placed.has(node.id)) continue;
        const f = FORK_OF.get(node.id);
        if (!f) {
          slots.push({ kind: 'node', id: node.id });
          placed.add(node.id);
          continue;
        }
        const a = f.fork.paths[0][f.index]!;
        const b = f.fork.paths[1][f.index]!;
        slots.push({ kind: 'fork', forkId: f.fork.id, ids: [a, b], first: f.index === 0 });
        placed.add(a).add(b);
      }
      if (slots.length > 0) tiers.push({ stage, row: stages.indexOf(stage), slots });
    }
    // Zeile „∞“: der endlose Knoten des Asts unter der Wald-Ebene.
    const repeat = RESEARCH.filter((n) => n.repeatable && n.branch === branch.id);
    if (repeat.length > 0) {
      tiers.push({ stage: repeat[0]!.minStage, row: stages.length, slots: repeat.map((n) => ({ kind: 'node', id: n.id })), repeat: true });
    }
    return { branch, tiers, nodeIds: [...nodes, ...repeat].map((n) => n.id) };
  });
  const edges: ResearchEdge[] = [];
  for (const node of RESEARCH) {
    for (const from of node.requires ?? []) {
      if (RESEARCH_BY_ID.get(from)?.branch === node.branch) edges.push({ from, to: node.id, any: false });
    }
    for (const from of node.requiresAny ?? []) {
      if (RESEARCH_BY_ID.get(from)?.branch === node.branch) edges.push({ from, to: node.id, any: true });
    }
  }
  cachedLayout = { stages, rows: stages.length + 1, branches, edges };
  return cachedLayout;
}

/** Stufen-Etikett einer Ebene: „ab Alter Baum“. */
export function tierLabel(stage: number): string {
  return `ab ${STAGES[stage]?.name ?? '?'}`;
}

/** Etikett der Zeile „∞“ (28.9). */
export const REPEAT_TIER_LABEL = '∞ immer weiter';

// ---------------------------------------------------------------------------------------
// Abbildung Zustand → Ansicht
// ---------------------------------------------------------------------------------------

const STATUS_SR: Record<ResearchStatus, string> = {
  researched: 'erforscht',
  available: 'erforschbar',
  saving: 'zu wenig Harmonie',
  locked: 'gesperrt',
  excluded: 'ausgeschlossen',
};

/** Querverweis auf einen Knoten eines anderen Asts: „braucht 🌳 Nistkästen ›“. */
export interface ResearchCrossRef {
  id: string;
  branch: ResearchBranchId;
  /** Sichtbar: „🌳 Nistkästen“. */
  text: string;
  /** Vorlesbar: „Zu Nistkästen im Ast Krone springen“. */
  label: string;
  /** Voraussetzung schon erforscht (Etikett blass, Haken). */
  done: boolean;
}

export interface ResearchNodeView {
  id: string;
  status: ResearchStatus;
  /** Klassen der Karte (ohne Basisklasse). */
  classes: readonly string[];
  /** Der Knopf ist nicht bedienbar (`aria-disabled="true"`). */
  disabled: boolean;
  /** Knopf sichtbar (nicht bei „erforscht“ bzw. beim höchsten Rang). */
  showAction: boolean;
  /** Sichtbarer Knopftext. */
  actionText: string;
  /** Vorlesbarer Knopftext (aria-label). */
  actionLabel: string;
  /** Sperr- bzw. Zustandsgrund als ganzer Satz (vorlesbar, sichtbar klein) – null bei erforschbar. */
  reason: string | null;
  /** Kurzer Zustand für Screenreader („erforscht“, „gesperrt“, „Rang 3“ …). */
  statusText: string;
  /** Stempel: „erforscht“ bzw. bei wiederholbaren „Rang 3“. */
  stampText: string;
  showStamp: boolean;
  /** Wiederholbarer Knoten (Zeile „∞“). */
  repeatable: boolean;
  /** Plan-Nummer(n) als kleines Etikett („3“, „7 · 12 · 15“, „7 · 12 · 15 +4“); null ohne Plan. */
  plan: { text: string; label: string; next: boolean } | null;
  /** Voraussetzungen aus anderen Ästen. */
  crossRefs: readonly ResearchCrossRef[];
}

const rawStatusOf = (state: ResearchTreeState, id: string): ResearchNodeState =>
  state.nodes[id] ?? { status: 'locked', lock: 'stage' };

const isResearched = (state: ResearchTreeState, id: string): boolean => rawStatusOf(state, id).status === 'researched';

/**
 * Zustand für die Anzeige: Ist an der Gabel der andere Weg schon gewählt, zeigt die Karte
 * „anderer Weg gewählt“, auch wenn der Blocker zuerst die Stufe meldet (Dichte Krone III im
 * Hain) – die Stufe ist dann ohne Belang.
 */
function statusOf(state: ResearchTreeState, id: string): ResearchNodeState {
  const s = rawStatusOf(state, id);
  if (s.status !== 'locked') return s;
  const node = RESEARCH_BY_ID.get(id);
  return node && (node.excludes ?? []).some((x) => isResearched(state, x)) ? { ...s, status: 'excluded' } : s;
}

const nameOf = (id: string): string => RESEARCH_BY_ID.get(id)?.name ?? id;

/** „Kompost und Laub liegen lassen“, „Blütenvorrat oder Wildbienenwand“. */
function joinNames(names: readonly string[], word: 'und' | 'oder'): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`;
}

/** Fehlende Voraussetzungen als Text („Waldtümpel“, „Blütenvorrat oder Wildbienenwand“). */
export function missingText(node: ResearchNode, state: ResearchTreeState): string {
  const all = (node.requires ?? []).filter((id) => !isResearched(state, id)).map(nameOf);
  const anyList = node.requiresAny ?? [];
  const anyMissing = anyList.length > 0 && !anyList.some((id) => isResearched(state, id));
  const parts = [...all];
  if (anyMissing) parts.push(joinNames(anyList.map(nameOf), 'oder'));
  return joinNames(parts, 'und');
}

/** Gewählter Partner, der diesen Knoten ausschließt (erforschter Knoten aus `excludes`). */
export function chosenPartner(node: ResearchNode, state: ResearchTreeState): ResearchNode | undefined {
  for (const id of node.excludes ?? []) {
    if (isResearched(state, id)) return RESEARCH_BY_ID.get(id);
  }
  return undefined;
}

/** „⚖️ 550“ – Symbol und Zahl bleiben zusammen (geschütztes Leerzeichen). */
export function costText(cost: number): string {
  return `⚖️\u00a0${formatNumber(cost)}`;
}

/** Wartezeit aus der Produktion: „~2 Min.“; ohne Produktion leer. */
export function waitText(shortfall: number, perMinute: number): string {
  if (!(perMinute > 0) || !(shortfall > 0)) return '';
  return `~${formatDuration(Math.max(1, Math.ceil((shortfall / perMinute) * 60)))}`;
}

/** Höchstens so viele Plan-Nummern stehen an einer Karte, der Rest als „+4“. */
export const PLAN_NUMBERS_SHOWN = 3;

/**
 * Plan-Etikett einer Karte: die offenen Plan-Nummern („3“; wiederholbare je Rang eine:
 * „7 · 12 · 15 +4“). null ohne offene Einträge.
 */
export function planBadge(plan: readonly number[] | undefined, next: boolean, name: string): ResearchNodeView['plan'] {
  if (!plan || plan.length === 0) return null;
  const shown = plan.slice(0, PLAN_NUMBERS_SHOWN).map((n) => formatNumber(n));
  const rest = plan.length - shown.length;
  const text = `${shown.join(' · ')}${rest > 0 ? ` +${formatNumber(rest)}` : ''}`;
  const where =
    plan.length === 1
      ? `an Stelle ${shown[0]}`
      : `an den Stellen ${joinNames(plan.map((n) => formatNumber(n)), 'und')}`;
  return { text, label: `${name} steht im Plan ${where}${next ? ' – als Nächstes' : ''}.`, next };
}

/** Ist der nächste Rang nie bezahlbar (Kosten über dem größten Vorrat, 28.6/MAX_HARMONY_POINTS)? */
export function researchUnaffordable(cost: number): boolean {
  return !(cost <= MAX_HARMONY_POINTS);
}

export function researchNodeView(id: string, state: ResearchTreeState): ResearchNodeView {
  const node = RESEARCH_BY_ID.get(id);
  if (!node) throw new Error(`Unbekannter Forschungsknoten: ${id}`);
  const s = statusOf(state, id);
  const name = node.name;
  const repeatable = !!node.repeatable;
  const rank = repeatable ? Math.max(0, Math.floor(s.rank ?? 0)) : 0;
  const nextCost = s.cost ?? node.cost;
  const cost = costText(nextCost);
  const classes: string[] = [`is-${s.status}`];
  const fork = FORK_OF.get(id);
  if (fork) classes.push('is-fork');
  if (repeatable) classes.push('is-repeatable');

  const crossRefs: ResearchCrossRef[] = [...(node.requires ?? []), ...(node.requiresAny ?? [])]
    .map((rid) => RESEARCH_BY_ID.get(rid)!)
    .filter((r) => r && r.branch !== node.branch)
    .map((r) => {
      const branch = BRANCH_BY_ID.get(r.branch)!;
      return {
        id: r.id,
        branch: r.branch,
        text: `${branch.icon} ${r.name}`,
        label: `Zu ${r.name} im Ast ${branch.name} springen`,
        done: isResearched(state, r.id),
      };
    });

  // Wiederholbare: „Rang 4 erforschen“ – der Rang, den der Kauf bringt.
  const what = repeatable ? `${name}: Rang ${formatNumber(rank + 1)} erforschen` : `${name} erforschen`;
  let actionText = `Erforschen · ${cost}`;
  let actionLabel = `${what}, ${formatNumber(nextCost)} Harmonie`;
  let reason: string | null = null;
  let disabled = true;
  let statusText = STATUS_SR[s.status];

  switch (s.status) {
    case 'researched':
      actionText = 'erforscht';
      actionLabel = repeatable ? `${name}: höchster Rang erreicht` : `${name}: erforscht`;
      if (repeatable) statusText = `höchster Rang ${formatNumber(rank)}`;
      break;
    case 'available':
      disabled = false;
      break;
    case 'saving': {
      if (researchUnaffordable(nextCost)) {
        // Rang über dem größten Vorrat: kein ewiges „Noch …“, das nie kommt.
        actionText = 'unerreichbar';
        reason = `Unerreichbar: Rang ${formatNumber(rank + 1)} kostet mehr Harmonie, als der Vorrat je fassen kann.`;
        actionLabel = `${name}: ${reason}`;
        classes.push('is-unreachable');
        statusText = 'unerreichbar';
        break;
      }
      const shortfall = Math.max(0, Math.ceil(nextCost - state.harmony));
      const wait = waitText(shortfall, state.perMinute);
      actionText = keepNumberWithIcon(`Noch ${formatNumber(shortfall)} ⚖️${wait ? ` · ${wait}` : ''}`);
      reason = `Es fehlen noch ${formatNumber(shortfall)} Harmonie${wait ? ` (${wait.replace('~', 'etwa ')})` : ''}.`;
      actionLabel = `${what}, ${formatNumber(nextCost)} Harmonie – ${reason}`;
      break;
    }
    case 'locked': {
      const lock = s.lock ?? 'stage';
      if (lock === 'stage') {
        actionText = tierLabel(node.minStage);
        reason = `Gesperrt: erst ${tierLabel(node.minStage)}.`;
      } else if (lock === 'requires') {
        const missing = missingText(node, state);
        actionText = `braucht ${missing}`;
        reason = `Gesperrt: braucht ${missing}.`;
      } else {
        const cond = (node.condition ?? []).map(conditionName).join(', ');
        actionText = `braucht ${cond}`;
        reason = `Gesperrt: braucht ${cond} im Wald.`;
      }
      actionLabel = `${name}: ${reason}`;
      classes.push(`lock-${lock}`);
      break;
    }
    case 'excluded': {
      const partner = chosenPartner(node, state);
      actionText = 'anderer Weg gewählt';
      reason = partner
        ? `Ausgeschlossen: An dieser Gabel ist ${partner.name} gewählt.`
        : 'Ausgeschlossen: An dieser Gabel ist der andere Weg gewählt.';
      actionLabel = `${name}: ${reason}`;
      break;
    }
  }

  // Rang-Stempel ab Rang 1 – neben dem Knopf für den nächsten Rang.
  const showStamp = repeatable ? rank >= 1 : s.status === 'researched';
  const stampText = repeatable ? `Rang ${formatNumber(rank)}` : 'erforscht';
  if (repeatable && rank >= 1 && s.status !== 'researched') statusText = `Rang ${formatNumber(rank)}, ${statusText}`;
  const plan = planBadge(s.plan, s.planNext === true, name);
  if (plan) classes.push('has-plan');
  if (plan?.next) classes.push('is-plan-next');

  return {
    id,
    status: s.status,
    classes,
    disabled,
    showAction: s.status !== 'researched',
    actionText,
    actionLabel,
    reason,
    statusText,
    stampText,
    showStamp,
    repeatable,
    plan,
    crossRefs,
  };
}

export interface ResearchForkView {
  id: string;
  /** Gewählter Weg (0 = A, 1 = B) oder null, solange offen. */
  chosen: 0 | 1 | null;
  /** Sichtbarer Hinweis über dem Paar (nur an der ersten Ebene der Gabel). */
  hint: string;
  /** Name der Gruppe für Screenreader. */
  label: string;
}

/** Gabel: offen („Gabel – wähle einen Weg“) oder entschieden („Gewählt: Lichte Krone“). */
export function researchForkView(forkId: string, state: ResearchTreeState): ResearchForkView {
  const fork = RESEARCH_FORKS.find((f) => f.id === forkId);
  if (!fork) throw new Error(`Unbekannte Gabel: ${forkId}`);
  const chosen = fork.paths[0].some((id) => isResearched(state, id))
    ? 0
    : fork.paths[1].some((id) => isResearched(state, id))
      ? 1
      : null;
  const [a, b] = [nameOf(fork.paths[0][0]!), nameOf(fork.paths[1][0]!)];
  const span = fork.paths[0].length > 1 ? ' – die Wahl gilt für alle Ebenen' : '';
  const hint =
    chosen === null ? `Gabel: ${fork.question}` : `Gabel entschieden: ${chosen === 0 ? a : b}${span}.`;
  const label =
    chosen === null
      ? `Gabel ${fork.name}: ${a} oder ${b}, nur ein Weg ist möglich${span}`
      : `Gabel ${fork.name}: ${chosen === 0 ? a : b} gewählt`;
  return { id: fork.id, chosen, hint, label };
}

/**
 * Kopf eines Asts: „2 / 6 erforscht · 1 erforschbar“, mit Rang des endlosen Knotens
 * „· ∞ Rang 3“. Gezählt (erforscht / gesamt) werden die einmaligen Knoten; „erforschbar“
 * zählt auch den nächsten Rang.
 */
export function branchSummary(branch: ResearchBranchId, state: ResearchTreeState): {
  text: string;
  available: number;
  researched: number;
  total: number;
} {
  const ids = RESEARCH_ONCE.filter((n) => n.branch === branch).map((n) => n.id);
  const researched = ids.filter((id) => statusOf(state, id).status === 'researched').length;
  const repeat = RESEARCH.filter((n) => n.repeatable && n.branch === branch).map((n) => n.id);
  const available = [...ids, ...repeat].filter((id) => statusOf(state, id).status === 'available').length;
  // Ausgeschlossene Knoten zählen nicht mit – sie sind in diesem Zyklus nicht erreichbar.
  const total = ids.filter((id) => statusOf(state, id).status !== 'excluded').length;
  const rank = repeat.reduce((sum, id) => sum + Math.max(0, Math.floor(rawStatusOf(state, id).rank ?? 0)), 0);
  const text =
    `${researched} / ${total} erforscht` +
    (rank > 0 ? ` · ∞ Rang ${formatNumber(rank)}` : '') +
    (available > 0 ? ` · ${available} erforschbar` : '');
  return { text, available, researched, total };
}

/** Kopf des Reiters: „⚖️ 1.234“, „+110/min“, „3 erforschbar“ (auch nächste Ränge). */
export function researchHeader(state: ResearchTreeState): { supply: string; rate: string; available: string; count: number } {
  const count = RESEARCH.filter((n) => statusOf(state, n.id).status === 'available').length;
  return {
    supply: costText(Math.floor(state.harmony)),
    rate: `+${formatNumber(Math.floor(state.perMinute))}/min`,
    available: count === 0 ? 'nichts erforschbar' : `${count} erforschbar`,
    count,
  };
}

// ---------------------------------------------------------------------------------------
// Linien im Raster: Leitungen in den Spalten-Zwischenräumen
// ---------------------------------------------------------------------------------------

/**
 * Seite, an der eine Verbindung im Raster läuft: Weg B einer Gabel rechts, alles andere links.
 * Gabeln stehen im Raster untereinander – so laufen Weg A und Weg B getrennt und keine Linie
 * verschwindet hinter einer Karte.
 */
export function edgeSide(edge: ResearchEdge): 'left' | 'right' {
  const to = FORK_OF.get(edge.to);
  if (to) return to.path === 0 ? 'left' : 'right';
  const from = FORK_OF.get(edge.from);
  return from?.path === 1 ? 'right' : 'left';
}

/**
 * Spuren je Spalte und Seite: Verbindungen, deren senkrechte Strecken sich überlappen,
 * bekommen verschiedene Spuren (0 = dicht an der Karte). Gierig nach oberer Kante.
 */
export function assignLanes(spans: readonly { key: string; group: string; top: number; bottom: number }[]): Map<string, number> {
  const lanes = new Map<string, number>();
  const ends = new Map<string, number[]>();
  for (const span of [...spans].sort((a, b) => a.top - b.top || a.bottom - b.bottom)) {
    const laneEnds = ends.get(span.group) ?? [];
    let lane = laneEnds.findIndex((end) => end <= span.top);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = span.bottom;
    ends.set(span.group, laneEnds);
    lanes.set(span.key, lane);
  }
  return lanes;
}
