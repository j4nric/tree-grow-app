/**
 * Ausbau und Zielzeile als reine Ansicht (docs/DESIGN_V2.md 28.4, 28.7, 28.9; ROADMAP
 * Phase 11, 1c).
 *
 * Diese Datei kennt kein DOM und keine Spielinhalte: Sie bildet einen übergebenen Zustand
 * (Stufe, beste Stufe, Meilensteine, Preis der gewählten Kaufmenge, Samen und Samenrate) auf
 * Texte, Balken, Abzeichen und aria-Angaben ab. Den Zustand liefert ab Phase 11, 2a/2c der
 * Spielstand (`upgradeCost`, `upgradeBlocker`, `nextGoal`); bis dahin Beispielzustände aus
 * `upgrade-fixtures.ts`. Das DOM baut `album/upgrade-panel.ts`.
 */
import { formatNumber, keepNumberWithIcon } from './format';

// ---------------------------------------------------------------------------------------
// Eingabe
// ---------------------------------------------------------------------------------------

/** Kaufmenge oben rechts in R:Nischen; gilt für alle Knöpfe (gemerkt in den Einstellungen). */
export type BuyAmount = 1 | 10 | 'max';
export const BUY_AMOUNTS: readonly BuyAmount[] = [1, 10, 'max'];

export type UpgradeBadge = 'bronze' | 'silver' | 'gold';

export const BADGE_LABELS: Readonly<Record<UpgradeBadge, string>> = {
  bronze: 'Bronze',
  silver: 'Silber',
  gold: 'Gold',
};

/**
 * Ein Meilenstein, wie ihn `content/upgrades.ts` (1a) beschreibt – hier nur, was die Ansicht
 * braucht: Stufe, Kurzform („+1 Platz“) und ob es nur ein Abzeichen ist.
 */
export interface UpgradeMilestoneInput {
  level: number;
  /** Kurzform für Balken und Zielzeile, z. B. „+1 Platz“. */
  summary: string;
  /** Nur ein Abzeichen (ohne Wirkung). */
  badge?: UpgradeBadge;
}

/**
 * Was der Knopf bei der gewählten Kaufmenge kauft (später `upgradeCost(state, target, count)`):
 * `count` Stufen für `cost` 🌰. Bei „Max“ so viele, wie die Samen reichen – reicht es für keine,
 * die nächste einzelne Stufe (dann ist `cost` > Samen).
 */
export interface UpgradePurchase {
  count: number;
  cost: number;
}

export interface UpgradeTargetInput {
  level: number;
  /** Höchste je erreichte Stufe (`meta.upgrades.best`) – für das Abzeichen. */
  best: number;
  /** Nach Stufe sortiert; an einer Stufe dürfen Wirkung und Abzeichen zusammenfallen. */
  milestones: readonly UpgradeMilestoneInput[];
  /** `null`: Ausbau gesperrt (Blocker `'closed'`) – dann gibt es keinen Knopf. */
  purchase: UpgradePurchase | null;
}

/** Vorrat, Rate und Kaufmenge – gemeinsam für alle Knöpfe. */
export interface UpgradeContext {
  seeds: number;
  /** 🌰/s (live aus `evaluate`); 0 = keine Zeitangabe. */
  seedsPerSecond: number;
  amount: BuyAmount;
}

// ---------------------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------------------

export function buyAmountLabel(amount: BuyAmount): string {
  return amount === 'max' ? 'Max' : `×${amount}`;
}

/** Ausführliche Fassung für Screenreader. */
export function buyAmountAria(amount: BuyAmount): string {
  if (amount === 'max') return 'so viele Stufen wie möglich';
  return amount === 1 ? 'eine Stufe' : `${amount} Stufen`;
}

/** Bis zu einer Nachkommastelle, ohne „-0“. */
function round1(value: number): number {
  const r = Math.round(value * 10) / 10;
  return r === 0 ? 0 : r;
}

/** „+2,4 %“. */
export function formatPlusPercent(value: number): string {
  return `+${formatNumber(round1(Math.max(0, value)))} %`;
}

/**
 * Countdown der Zielzeile und der blassen Knöpfe (28.7, Regel 4): auf 5 s aufgerundet als
 * „0:50“ bzw. „12:05“, ab einer Stunde „über 1 Std.“; leer ohne Rate.
 */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds >= 3600) return 'über 1 Std.';
  const s = Math.min(3600, Math.ceil(seconds / 5) * 5);
  if (s >= 3600) return 'über 1 Std.';
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

/** Sekunden, bis `cost` bezahlbar ist; 0 = jetzt; `Infinity` ohne Rate. */
export function secondsUntil(cost: number, seeds: number, perSecond: number): number {
  const missing = Math.max(0, cost - Math.max(0, seeds));
  if (missing <= 0) return 0;
  return perSecond > 0 ? missing / perSecond : Infinity;
}

/** „in 0:40“ – leer, wenn bezahlbar oder ohne Rate. */
export function waitText(cost: number, seeds: number, perSecond: number): string {
  const s = secondsUntil(cost, seeds, perSecond);
  if (s <= 0 || !Number.isFinite(s)) return '';
  return `in ${formatCountdown(s)}`;
}

/** Preis mit Symbol, Zahl und 🌰 bleiben zusammen: „1.240 🌰“. */
export function seedPrice(cost: number): string {
  return keepNumberWithIcon(`${formatNumber(Math.ceil(cost))} 🌰`);
}

// ---------------------------------------------------------------------------------------
// Abzeichen und Meilenstein-Balken
// ---------------------------------------------------------------------------------------

/** Höchstes Abzeichen, das `best` erreicht hat (Bronze 25, Silber 50, Gold 75), sonst `null`. */
export function badgeOf(best: number, milestones: readonly UpgradeMilestoneInput[]): UpgradeBadge | null {
  let tier: UpgradeBadge | null = null;
  for (const m of milestones) if (m.badge && best >= m.level) tier = m.badge;
  return tier;
}

export interface UpgradeBadgeView {
  tier: UpgradeBadge;
  /** „⭑ Bronze“. */
  text: string;
  /** „Abzeichen Bronze: Wurzelraum einmal auf Stufe 25“. */
  title: string;
}

export function badgeView(name: string, best: number, milestones: readonly UpgradeMilestoneInput[]): UpgradeBadgeView | null {
  const tier = badgeOf(best, milestones);
  if (!tier) return null;
  const level = milestones.find((m) => m.badge === tier)?.level ?? 0;
  return {
    tier,
    text: `⭑ ${BADGE_LABELS[tier]}`,
    title: `Abzeichen ${BADGE_LABELS[tier]}: ${name} einmal auf Stufe ${formatNumber(level)} – bleibt über den Zyklus.`,
  };
}

/** Text eines Meilensteins an einer Stufe: Wirkungen zuerst, Abzeichen nur ohne Wirkung. */
function milestoneSummary(at: readonly UpgradeMilestoneInput[]): string {
  const effects = at.filter((m) => !m.badge).map((m) => m.summary);
  return (effects.length > 0 ? effects : at.map((m) => m.summary)).join(' · ');
}

export interface MilestoneProgress {
  /** Stufe des nächsten Meilensteins; `null`, wenn alle erreicht sind. */
  next: number | null;
  /** Anteil des Wegs vom vorigen Meilenstein (oder 0) bis zum nächsten, 0–1. */
  fraction: number;
  /** „25: +1 Platz“ bzw. „alle Meilensteine“. */
  label: string;
  /** Kurzform des nächsten Meilensteins („+1 Platz“), leer ohne. */
  summary: string;
  /** Stufen bis dahin. */
  remaining: number;
}

/** Balken bis zum nächsten Meilenstein (10/25/50, danach das Gold-Abzeichen 75). */
export function milestoneProgress(level: number, milestones: readonly UpgradeMilestoneInput[]): MilestoneProgress {
  const lvl = Math.max(0, Math.floor(Number.isFinite(level) ? level : 0));
  const levels = [...new Set(milestones.map((m) => m.level))].sort((a, b) => a - b);
  const next = levels.find((l) => l > lvl);
  if (next === undefined) return { next: null, fraction: 1, label: 'alle Meilensteine', summary: '', remaining: 0 };
  const prev = levels.filter((l) => l <= lvl).pop() ?? 0;
  const summary = milestoneSummary(milestones.filter((m) => m.level === next));
  return {
    next,
    fraction: Math.min(1, Math.max(0, (lvl - prev) / (next - prev))),
    label: `${formatNumber(next)}: ${summary}`,
    summary,
    remaining: next - lvl,
  };
}

// ---------------------------------------------------------------------------------------
// Knopf „Ausbauen · Preis“
// ---------------------------------------------------------------------------------------

export interface UpgradeButtonView {
  /** „Ausbauen · 268 🌰“, „+10 · 4.100 🌰“ oder „+7 · Max“. */
  label: string;
  /** Genug Samen? Sonst blass mit Wartezeit (aria-disabled, nicht `disabled` – bleibt fokussierbar). */
  affordable: boolean;
  /** „in 0:40“ (nur wenn zu teuer und eine Rate läuft). */
  wait: string;
  /** Stufen, die der Knopf kauft. */
  count: number;
  cost: number;
  aria: string;
}

export function upgradeButtonView(name: string, purchase: UpgradePurchase, ctx: UpgradeContext): UpgradeButtonView {
  const count = Math.max(1, Math.floor(purchase.count));
  const affordable = purchase.cost <= ctx.seeds;
  const price = seedPrice(purchase.cost);
  let label: string;
  if (ctx.amount === 'max' && affordable) label = `+${formatNumber(count)} · Max`;
  else if (ctx.amount === 10) label = keepNumberWithIcon(`+${formatNumber(count)} · ${price}`);
  else label = keepNumberWithIcon(`Ausbauen · ${price}`);
  const wait = affordable ? '' : waitText(purchase.cost, ctx.seeds, ctx.seedsPerSecond);
  const steps = count === 1 ? 'eine Stufe' : `${formatNumber(count)} Stufen`;
  const aria = `${name} ausbauen: ${steps} für ${formatNumber(Math.ceil(purchase.cost))} Samen${
    affordable ? '' : `, noch zu teuer${wait ? ` – ${wait}` : ''}`
  }`;
  return { label, affordable, wait, count, cost: purchase.cost, aria };
}

// ---------------------------------------------------------------------------------------
// Fußzeile je Nische
// ---------------------------------------------------------------------------------------

export interface NicheUpgradeInput extends UpgradeTargetInput {
  id: string;
  icon: string;
  label: string;
  /** Prozentpunkte 🌿/🌰 je Tier und Stufe (`NICHE_UPGRADE_PCT`, 0,1). */
  pctPerLevel: number;
  /** Zufriedenheit z (0–1) der Tiere, die hier wohnen (Gäste nicht). */
  happiness: readonly number[];
}

export interface NicheFooterView {
  id: string;
  /** Ausbau gesperrt (verschlossene Nische): keine Fußzeile, kein Knopf. */
  closed: boolean;
  /** „St. 24“. */
  levelText: string;
  progress: MilestoneProgress;
  /** „je Tier +2,4 %“ (Stufe 0: „+0,1 % je Stufe“). */
  effectText: string;
  /** Haftnotiz zur Wirkung: 🌿/🌰 der Nische gesamt. */
  effectTitle: string;
  effectLines: string[];
  button: UpgradeButtonView | null;
  badge: UpgradeBadgeView | null;
}

export function nicheFooterView(input: NicheUpgradeInput, ctx: UpgradeContext): NicheFooterView {
  const level = Math.max(0, Math.floor(input.level));
  const perAnimal = input.pctPerLevel * level;
  const animals = input.happiness.length;
  const total = input.happiness.reduce((sum, z) => sum + perAnimal * Math.min(1, Math.max(0, z)), 0);
  const effectText = level > 0 ? `je Tier ${formatPlusPercent(perAnimal)}` : `${formatPlusPercent(input.pctPerLevel)} je Stufe`;
  const effectLines =
    animals === 0
      ? [`Je Stufe bekommt jedes Tier hier ${formatPlusPercent(input.pctPerLevel)} 🌿 und 🌰 – noch wohnt niemand hier.`]
      : [
          `${animals === 1 ? 'Ein Tier' : `${formatNumber(animals)} Tiere`}, zusammen ${formatPlusPercent(total)} 🌿 und ${formatPlusPercent(total)} 🌰.`,
          `Je Tier ${formatPlusPercent(perAnimal)}, mal seine Zufriedenheit.`,
        ];
  return {
    id: input.id,
    closed: input.purchase === null,
    levelText: `St. ${formatNumber(level)}`,
    progress: milestoneProgress(level, input.milestones),
    effectText,
    effectTitle: `${input.icon} ${input.label} · Stufe ${formatNumber(level)}`,
    effectLines,
    button: input.purchase ? upgradeButtonView(input.label, input.purchase, ctx) : null,
    badge: badgeView(input.label, input.best, input.milestones),
  };
}

// ---------------------------------------------------------------------------------------
// Abschnitt „🌳 Dein Baum“
// ---------------------------------------------------------------------------------------

export interface TreePartInput extends UpgradeTargetInput {
  id: string;
  icon: string;
  name: string;
  /** Wem es hilft: „Baum“ (Hauptbaum) oder „Pflanzen“ (Begleitpflanzen). */
  who: string;
  /** Prozent je Stufe (0,4 / 1 / 0,5). */
  pctPerLevel: number;
  /** Symbol hinter der Wirkung („🌿“, „🌰“), leer bei 🌿 und 🌰 zusammen (Platz). */
  icons: string;
  /** Stimmungstext (Haftnotiz/Titel). */
  text: string;
}

export interface TreePartView {
  id: string;
  /** „🪵 Jahresringe“. */
  title: string;
  levelText: string;
  /** „Baum +8,8 % 🌿“. */
  effectText: string;
  text: string;
  progress: MilestoneProgress;
  button: UpgradeButtonView | null;
  badge: UpgradeBadgeView | null;
}

export function treePartView(input: TreePartInput, ctx: UpgradeContext): TreePartView {
  const level = Math.max(0, Math.floor(input.level));
  const pct = level > 0 ? input.pctPerLevel * level : input.pctPerLevel;
  // Symbol bleibt an der Prozentzahl (geschütztes Leerzeichen).
  const effect = `${input.who} ${formatPlusPercent(pct)}${input.icons ? `\u00a0${input.icons}` : ''}${level > 0 ? '' : ' je Stufe'}`;
  return {
    id: input.id,
    title: `${input.icon} ${input.name}`,
    levelText: `St. ${formatNumber(level)}`,
    effectText: effect,
    text: input.text,
    progress: milestoneProgress(level, input.milestones),
    button: input.purchase ? upgradeButtonView(input.name, input.purchase, ctx) : null,
    badge: badgeView(input.name, input.best, input.milestones),
  };
}

/**
 * „nächster Meilenstein: Jahresringe 25 · +1 Platz Höhlen“ – der Baumteil, dem die wenigsten
 * Stufen fehlen (bei Gleichstand der erste); leer, wenn alle Meilensteine erreicht sind.
 */
export function treeMilestoneHint(parts: readonly TreePartInput[]): string {
  let best: { part: TreePartInput; p: MilestoneProgress } | null = null;
  for (const part of parts) {
    const p = milestoneProgress(part.level, part.milestones);
    if (p.next === null) continue;
    if (!best || p.remaining < best.p.remaining) best = { part, p };
  }
  if (!best) return '';
  return `nächster Meilenstein: ${best.part.name} ${formatNumber(best.p.next!)} · ${best.p.summary}`;
}

// ---------------------------------------------------------------------------------------
// Zielzeile im Polaroid-Kopf (28.7)
// ---------------------------------------------------------------------------------------

/** Das nächste Ziel, wie es später `nextGoal(state)` liefert. */
export interface GoalInput {
  kind: 'niche' | 'tree' | 'sow';
  /** Nischen-ID, Baumteil oder `'sow'`. */
  id: string;
  icon: string;
  name: string;
  /** Zielstufe (Stufe nach dem Kauf); `null` beim Säen. */
  level: number | null;
  cost: number;
  /** Kurzform, wenn die Zielstufe ein Meilenstein ist („+1 Platz“). */
  milestone?: string;
}

export interface GoalLineView {
  /** Wechselt nur, wenn ein anderes Ziel gewählt ist (für `aria-live`, nicht beim Countdown). */
  key: string;
  ready: boolean;
  /** „Nächstes: 🌳 Krone St. 14 · 1.240 🌰 · in 0:50“ bzw. „Jetzt: … ›“. */
  text: string;
  /** Ansage bei Zielwechsel (ohne Countdown). */
  announce: string;
  /** „🔍 2 erforschbar ›“, leer ohne bezahlbaren Knoten. */
  research: string;
  researchAria: string;
}

export function goalKey(goal: GoalInput): string {
  return `${goal.kind}:${goal.id}:${goal.level ?? ''}`;
}

/** Zielzeile; `null`, wenn es kein Ziel gibt (dann ist die Zeile ausgeblendet). */
export function goalLineView(goal: GoalInput | null, ctx: Pick<UpgradeContext, 'seeds' | 'seedsPerSecond'>, researchAvailable = 0): GoalLineView | null {
  if (!goal) return null;
  const level = goal.level !== null ? ` St. ${formatNumber(goal.level)}` : '';
  const milestone = goal.milestone ? ` (${goal.milestone})` : '';
  const what = `${goal.icon} ${goal.name}${level}${milestone}`;
  const price = seedPrice(goal.cost);
  const ready = goal.cost <= ctx.seeds;
  const wait = ready ? '' : waitText(goal.cost, ctx.seeds, ctx.seedsPerSecond);
  const text = ready ? `Jetzt: ${what} · ${price} ›` : `Nächstes: ${what} · ${price}${wait ? ` · ${wait}` : ''}`;
  const n = Math.max(0, Math.floor(researchAvailable));
  return {
    key: goalKey(goal),
    ready,
    text: keepNumberWithIcon(text),
    announce: `${ready ? 'Jetzt möglich' : 'Nächstes Ziel'}: ${goal.name}${level}${milestone}, ${formatNumber(Math.ceil(goal.cost))} Samen`,
    research: n > 0 ? `🔍 ${formatNumber(n)} erforschbar ›` : '',
    researchAria: n > 0 ? `Zur Forschung: ${n === 1 ? 'ein Knoten' : `${formatNumber(n)} Knoten`} erforschbar` : '',
  };
}
