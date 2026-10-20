/**
 * Balancing-Simulator: spielt eine plausible Spielerstrategie mit der echten
 * Spiellogik (tick, clickGrow, buyUpgrade) durch und misst die Zeit bis zu jeder Stufe.
 *
 * Reines Modul ohne Seiteneffekte – wird von tests/balance.test.ts aufgerufen
 * (`npm run test` gibt die Tabelle aus).
 */
import { STAGES } from '../src/content/stages';
import { UPGRADES, type Upgrade } from '../src/content/upgrades';
import { clickYield, getRates, steadyEnergyRate, upgradeCost, upgradeLevel, type Rates } from '../src/core/formulas';
import { createInitialState, type GameState } from '../src/core/state';
import { buyUpgrade, clickGrow, tick } from '../src/core/tick';

/** Klickphase: bis `until` Sekunden Spielzeit klickt der Spieler `perSecond`-mal pro Sekunde. */
export interface ClickPhase {
  until: number;
  perSecond: number;
}

export interface SimOptions {
  /** Schrittweite in Sekunden. */
  dt: number;
  /** Abbruch nach dieser Spielzeit (Sekunden). */
  maxSeconds: number;
  /** Simulation endet, sobald dieser Stufen-Index erreicht ist. */
  targetStage: number;
  /** Klickverhalten; nach der letzten Phase wird nicht mehr geklickt. */
  clicks: readonly ClickPhase[];
}

/** Nicht-Klicker: kauft nur, klickt nie. Für ihn gelten die Zielzeiten. */
export const NO_CLICKS: readonly ClickPhase[] = [];

/** Aktiver Spieler: anfangs eifrig, dann ermüdet der Finger, später nur noch zuschauen. */
export const ACTIVE_CLICKS: readonly ClickPhase[] = [
  { until: 120, perSecond: 3 },
  { until: 600, perSecond: 1 },
];

/** Dauerklicker: 3×/s in den ersten 2 Minuten, danach das ganze Spiel 1×/s (Obergrenze). */
export const ALWAYS_CLICKS: readonly ClickPhase[] = [
  { until: 120, perSecond: 3 },
  { until: Infinity, perSecond: 1 },
];

export const DEFAULT_OPTIONS: SimOptions = {
  dt: 0.1,
  maxSeconds: 3 * 60 * 60,
  targetStage: 5,
  clicks: NO_CLICKS,
};

export interface Purchase {
  time: number;
  id: string;
  level: number;
  cost: number;
}

/** Takt innerhalb eines Abschnitts (von Erreichen der Stufe bis zur nächsten). */
export interface SectionStats {
  /** Stufen-Index, ab dem der Abschnitt läuft. */
  stage: number;
  /** Anzahl der Kaufmomente in diesem Abschnitt (Käufe im selben Schritt zählen einmal). */
  purchases: number;
  /** Median der Wartezeiten vor den Kaufmomenten dieses Abschnitts (Sekunden), null ohne Kauf. */
  medianGap: number | null;
  /** Längste Wartezeit vor einem Kauf dieses Abschnitts (Sekunden), null ohne Kauf. */
  maxGap: number | null;
}

export interface SimResult {
  /** Stufen-Index → Spielzeit in Sekunden, zu der die Stufe erreicht wurde. */
  stageTimes: (number | null)[];
  /** Stufen-Index → Energie/s im Gleichgewicht (ohne Klicks) beim Erreichen der Stufe. */
  stageRates: (number | null)[];
  purchases: Purchase[];
  /** Längste Wartezeit zwischen zwei Käufen (bzw. Start → erster Kauf), gesamt. */
  maxGap: number;
  /** Zeitpunkt (Ende) der längsten Wartezeit. */
  maxGapAt: number;
  /** Längste Wartezeit, die vor dem Erreichen von „Junger Baum“ (Index 3) begann. */
  maxGapEarly: number;
  /** Takt pro Abschnitt; ein Kauf zählt zum Abschnitt der Stufe, in der er stattfindet. */
  sections: SectionStats[];
  endTime: number;
  endState: GameState;
}

export function clickRateAt(time: number, clicks: readonly ClickPhase[]): number {
  for (const phase of clicks) if (time < phase.until) return phase.perSecond;
  return 0;
}

function withUpgrade(rates: Rates, upgrade: Upgrade): Rates {
  const next = { ...rates };
  const e = upgrade.effect;
  if (e.type === 'produce') next[e.resource] += e.perLevel;
  else next.photosynthesis += e.perLevel;
  return next;
}

function effectDimension(upgrade: Upgrade): keyof Rates {
  return upgrade.effect.type === 'produce' ? upgrade.effect.resource : 'photosynthesis';
}

/**
 * Strategie: Unter allen Upgrades, die min(Wasser/s, Licht/s, Photosynthese)
 * erhöhen (Klicks zählen als Wasser/Licht mit), wähle das mit der kürzesten
 * „Wartezeit bis bezahlbar + Amortisationszeit“. So kauft der Spieler auch mal
 * ein günstiges Upgrade, statt lange auf ein teures zu sparen. Hilft keins
 * direkt (z. B. Wasser und Licht gleichauf), wird das knappste Glied angegangen,
 * das sich mit einem freigeschalteten Upgrade verbessern lässt – dort das Upgrade
 * mit dem besten Effekt pro Kosten.
 */
export function chooseUpgrade(state: GameState, clicksPerSecond: number): Upgrade | null {
  const base = getRates(state);
  const perClick = clickYield(base);
  const rates: Rates = {
    ...base,
    water: base.water + clicksPerSecond * perClick.water,
    light: base.light + clicksPerSecond * perClick.light,
  };
  const current = steadyEnergyRate(rates);
  const unlocked = UPGRADES.filter((u) => u.unlockStage <= state.stage);
  if (unlocked.length === 0) return null;

  let best: Upgrade | null = null;
  let bestScore = Infinity;
  for (const u of unlocked) {
    const gain = steadyEnergyRate(withUpgrade(rates, u)) - current;
    if (gain <= 0) continue;
    const cost = upgradeCost(u, upgradeLevel(state, u.id));
    // Sekunden bis bezahlbar + Sekunden, bis sich der Kauf amortisiert hat.
    const waitFor = Math.max(0, cost - state.resources.energy) / Math.max(current, 1e-9);
    const score = waitFor + cost / gain;
    if (score < bestScore) {
      bestScore = score;
      best = u;
    }
  }
  if (best) return best;

  // Fallback: knappstes Glied, das sich mit einem freigeschalteten Upgrade verbessern lässt.
  const dims = [...new Set(unlocked.map(effectDimension))].sort((a, b) => rates[a] - rates[b]);
  const dim = dims[0]!;
  let fallback: Upgrade | null = null;
  let fallbackScore = -1;
  for (const u of unlocked) {
    if (effectDimension(u) !== dim) continue;
    const score = u.effect.perLevel / upgradeCost(u, upgradeLevel(state, u.id));
    if (score > fallbackScore) {
      fallbackScore = score;
      fallback = u;
    }
  }
  return fallback;
}

export function simulate(options: Partial<SimOptions> = {}): SimResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const state = createInitialState(0);
  const stageTimes: (number | null)[] = STAGES.map((_, i) => (i === 0 ? 0 : null));
  const stageRates: (number | null)[] = STAGES.map((_, i) => (i === 0 ? 0 : null));
  const purchases: Purchase[] = [];
  let time = 0;
  let clickCarry = 0;
  let lastBuy = 0;
  let maxGap = 0;
  let maxGapAt = 0;
  let maxGapEarly = 0;
  /** Stufen-Index → Wartezeiten vor den Käufen in diesem Abschnitt. */
  const gapsByStage: number[][] = STAGES.map(() => []);

  const steps = Math.ceil(opts.maxSeconds / opts.dt);
  for (let step = 0; step < steps; step++) {
    // Klicks gleichmäßig verteilen, Bruchteile werden übertragen.
    clickCarry += clickRateAt(time, opts.clicks) * opts.dt;
    while (clickCarry >= 1 - 1e-9) {
      clickGrow(state);
      clickCarry -= 1;
    }

    tick(state, opts.dt);
    time += opts.dt;

    for (let i = 1; i < STAGES.length; i++) {
      if (stageTimes[i] === null && state.stage >= i) {
        stageTimes[i] = time;
        stageRates[i] = steadyEnergyRate(getRates(state));
      }
    }

    // Kaufen, solange das gewünschte Upgrade bezahlbar ist.
    for (;;) {
      const choice = chooseUpgrade(state, clickRateAt(time, opts.clicks));
      if (!choice) break;
      const level = upgradeLevel(state, choice.id);
      const cost = upgradeCost(choice, level);
      if (!buyUpgrade(state, choice.id)) break;
      const gap = time - lastBuy;
      if (gap > maxGap) {
        maxGap = gap;
        maxGapAt = time;
      }
      if (lastBuy < (stageTimes[3] ?? Infinity) && gap > maxGapEarly) maxGapEarly = gap;
      // Mehrere Käufe im selben Schritt zählen als ein Kaufmoment.
      if (gap > opts.dt / 2) gapsByStage[state.stage]!.push(gap);
      lastBuy = time;
      purchases.push({ time, id: choice.id, level: level + 1, cost });
    }

    if (state.stage >= opts.targetStage) break;
  }

  const sections: SectionStats[] = gapsByStage.map((gaps, stage) => ({
    stage,
    purchases: gaps.length,
    medianGap: gaps.length > 0 ? median(gaps) : null,
    maxGap: gaps.length > 0 ? Math.max(...gaps) : null,
  }));

  return {
    stageTimes,
    stageRates,
    purchases,
    maxGap,
    maxGapAt,
    maxGapEarly,
    sections,
    endTime: time,
    endState: state,
  };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function formatTime(seconds: number | null): string {
  if (seconds === null) return '—';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')} min` : `${s} s`;
}

/**
 * Lesbare Tabelle: Stufe, Spielzeit, Energie/s beim Erreichen und der Takt im
 * Abschnitt *ab* dieser Stufe (Käufe, Median- und Maximal-Wartezeit).
 */
export function formatReport(result: SimResult): string {
  const lines: string[] = [
    'Stufe            | Schwelle   | Spielzeit  | Energie/s | Käufe | Takt Median | Takt max',
    '-----------------|------------|------------|-----------|-------|-------------|---------',
  ];
  STAGES.forEach((stage, i) => {
    const rate = result.stageRates[i];
    const section = result.sections[i]!;
    const reached = result.stageTimes[i] !== null;
    lines.push(
      `${stage.name.padEnd(16)} | ${String(stage.threshold).padStart(10)} | ${formatTime(result.stageTimes[i] ?? null).padStart(10)} | ` +
        `${(rate === null || rate === undefined ? '—' : rate.toFixed(1)).padStart(9)} | ` +
        `${(reached ? String(section.purchases) : '—').padStart(5)} | ` +
        `${formatTime(section.medianGap).padStart(11)} | ${formatTime(section.maxGap).padStart(8)}`,
    );
  });
  lines.push('');
  lines.push(`Käufe: ${result.purchases.length}`);
  lines.push(`Längste Wartezeit bis „Junger Baum“: ${formatTime(result.maxGapEarly)}`);
  lines.push(`Längste Wartezeit gesamt: ${formatTime(result.maxGap)} (endet bei ${formatTime(result.maxGapAt)})`);
  const levels = UPGRADES.map((u) => `${u.id}=${result.endState.upgrades[u.id] ?? 0}`).join(', ');
  lines.push(`Upgrade-Stufen am Ende: ${levels}`);
  return lines.join('\n');
}
