import { STAGES } from '../content/stages';
import { UPGRADES } from '../content/upgrades';
import { getRates, stageProgress, steadyEnergyRate, upgradeCost, upgradeLevel } from '../core/formulas';
import type { GameState } from '../core/state';
import { formatNumber, formatRate } from './format';

export interface PanelActions {
  onGrow(): void;
  onBuy(id: string): void;
  onReset(): void;
}

interface UpgradeRow {
  root: HTMLElement;
  button: HTMLButtonElement;
  level: HTMLElement;
  cost: HTMLElement;
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

  ref('grow').addEventListener('click', actions.onGrow);
  ref('reset').addEventListener('click', actions.onReset);

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
    button.addEventListener('click', () => actions.onBuy(upgrade.id));
    list.append(root);
    rows.set(upgrade.id, {
      root,
      button,
      level: root.querySelector<HTMLElement>('.level')!,
      cost: root.querySelector<HTMLElement>('.cost')!,
    });
  }

  function update(state: GameState): void {
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
      if (!unlocked) continue;
      const level = upgradeLevel(state, upgrade.id);
      const cost = upgradeCost(upgrade, level);
      row.level.textContent = level > 0 ? `(${level})` : '';
      row.cost.textContent = formatNumber(cost);
      row.button.disabled = state.resources.energy < cost;
    }
  }

  return { update };
}
