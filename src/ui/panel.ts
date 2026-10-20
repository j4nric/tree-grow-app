import { STAGES } from '../content/stages';
import { UPGRADES } from '../content/upgrades';
import { getRates, stageProgress, steadyEnergyRate, upgradeCost, upgradeLevel } from '../core/formulas';
import type { GameState } from '../core/state';
import { createFloatLayer, restartAnimation } from './feedback';
import { formatNumber, formatRate } from './format';

export interface PanelActions {
  onGrow(): void;
  /** Gibt true zurück, wenn der Kauf geklappt hat (für die Bestätigungs-Animation). */
  onBuy(id: string): boolean;
  onReset(): void;
}

/** Ressourcen, die beim Klick auf „Wachsen“ als schwebende Zahl erscheinen. */
const CLICK_RESOURCES = [
  { id: 'water', icon: '💧' },
  { id: 'light', icon: '☀️' },
] as const;

interface UpgradeRow {
  root: HTMLElement;
  button: HTMLButtonElement;
  level: HTMLElement;
  cost: HTMLElement;
  /** Bezahlbarkeit im letzten Frame – null vor dem ersten Update. */
  affordable: boolean | null;
}

/**
 * Seitenleiste mit Ressourcen, Stufenfortschritt und Upgrades.
 * DOM wird einmal aufgebaut; `update()` setzt pro Frame nur Texte und Zustände.
 */
export function createPanel(container: HTMLElement, actions: PanelActions) {
  container.innerHTML = `
    <header class="panel-header">
      <h1>Vom Samen zum Wald</h1>
      <p class="stage-name" data-ref="stage"></p>
      <div class="progress"><div class="progress-bar" data-ref="progress"></div></div>
      <p class="hint" data-ref="next"></p>
    </header>
    <ul class="resources">
      <li><span>💧 Wasser</span><b data-ref="water"></b><small data-ref="water-rate"></small></li>
      <li><span>☀️ Licht</span><b data-ref="light"></b><small data-ref="light-rate"></small></li>
      <li><span>🍬 Energie</span><b data-ref="energy"></b><small data-ref="energy-rate"></small></li>
    </ul>
    <button class="grow-button" data-ref="grow">🌱 Wachsen</button>
    <p class="hint" data-ref="photo"></p>
    <h2>Wachstum</h2>
    <div class="upgrades" data-ref="upgrades"></div>
    <footer><button class="link-button" data-ref="reset">Spielstand löschen</button></footer>
  `;
  const ref = (name: string) => container.querySelector<HTMLElement>(`[data-ref="${name}"]`)!;

  const floats = createFloatLayer(document.body);
  /** Zuletzt angezeigter Spielstand – nur gelesen, um Zuwächse durch Klicks zu erkennen. */
  let current: GameState | null = null;

  const grow = ref('grow');
  grow.addEventListener('click', (event) => {
    const before = current ? { ...current.resources } : null;
    actions.onGrow();
    if (!current || !before) return;

    // Klickpunkt; bei Tastatur-Auslösung (detail 0) die Button-Mitte
    const rect = grow.getBoundingClientRect();
    const fromPointer = event.detail > 0 && (event.clientX !== 0 || event.clientY !== 0);
    const x = fromPointer ? event.clientX : rect.left + rect.width / 2;
    const y = fromPointer ? event.clientY : rect.top + rect.height / 2;

    CLICK_RESOURCES.forEach(({ id, icon }, i) => {
      const gained = current!.resources[id] - before[id];
      if (gained <= 0) return;
      // Leicht versetzt, damit sich die beiden Zahlen nicht überdecken
      floats.spawn(`+${formatNumber(gained)} ${icon}`, x + (i === 0 ? -30 : 30), y - 14);
      restartAnimation(ref(id), 'pop');
    });
  });
  // Löschen braucht einen zweiten Klick – ohne confirm(), das nicht überall angezeigt wird.
  const reset = ref('reset');
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const disarmReset = () => {
    clearTimeout(resetTimer);
    resetTimer = undefined;
    reset.textContent = 'Spielstand löschen';
    reset.classList.remove('armed');
  };
  reset.addEventListener('click', () => {
    if (resetTimer === undefined) {
      reset.textContent = 'Wirklich alles löschen? Zum Bestätigen erneut klicken';
      reset.classList.add('armed');
      resetTimer = setTimeout(disarmReset, 4000);
      return;
    }
    disarmReset();
    actions.onReset();
  });

  const rows = new Map<string, UpgradeRow>();
  const list = ref('upgrades');
  for (const upgrade of UPGRADES) {
    const root = document.createElement('div');
    root.className = 'upgrade';
    root.innerHTML = `
      <div class="upgrade-text">
        <strong>${upgrade.name} <span class="level"></span></strong>
        <small>${upgrade.description}</small>
      </div>
      <button class="buy"><span class="cost"></span> 🍬</button>
    `;
    const button = root.querySelector<HTMLButtonElement>('.buy')!;
    const row: UpgradeRow = {
      root,
      button,
      level: root.querySelector<HTMLElement>('.level')!,
      cost: root.querySelector<HTMLElement>('.cost')!,
      affordable: null,
    };
    button.addEventListener('click', () => {
      if (!actions.onBuy(upgrade.id)) return;
      restartAnimation(root, 'bought');
      restartAnimation(row.level, 'bump');
      restartAnimation(ref('energy'), 'pop');
    });
    list.append(root);
    rows.set(upgrade.id, row);
  }

  function update(state: GameState): void {
    current = state;
    const rates = getRates(state);
    const stage = STAGES[state.stage]!;
    const next = STAGES[state.stage + 1];

    ref('stage').textContent = `Stufe: ${stage.name}`;
    ref('progress').style.width = `${(stageProgress(state) * 100).toFixed(1)}%`;
    ref('next').textContent = next
      ? `Nächste Stufe „${next.name}“ bei ${formatNumber(next.threshold)} Energie insgesamt`
      : 'Höchste Stufe erreicht.';

    ref('water').textContent = formatNumber(state.resources.water);
    ref('light').textContent = formatNumber(state.resources.light);
    ref('energy').textContent = formatNumber(state.resources.energy);
    ref('water-rate').textContent = formatRate(rates.water);
    ref('light-rate').textContent = formatRate(rates.light);
    ref('energy-rate').textContent = formatRate(steadyEnergyRate(rates));
    ref('photo').textContent = `Photosynthese wandelt bis zu ${formatRate(rates.photosynthesis)} Wasser + Licht in Energie um.`;

    for (const upgrade of UPGRADES) {
      const row = rows.get(upgrade.id)!;
      const unlocked = upgrade.unlockStage <= state.stage;
      row.root.hidden = !unlocked;
      if (!unlocked) {
        row.affordable = null;
        continue;
      }
      const level = upgradeLevel(state, upgrade.id);
      const cost = upgradeCost(upgrade, level);
      row.level.textContent = level > 0 ? `(${level})` : '';
      row.cost.textContent = formatNumber(cost);
      const affordable = state.resources.energy >= cost;
      row.button.disabled = !affordable;
      // Kurz hervorheben, wenn das Upgrade gerade bezahlbar geworden ist
      if (affordable && row.affordable === false) restartAnimation(row.root, 'ready');
      row.affordable = affordable;
    }
  }

  return { update };
}
