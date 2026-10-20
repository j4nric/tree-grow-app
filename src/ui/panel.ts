import { NICHES, NICHES_BY_ID } from '../content/niches';
import { GENUS_INFO, RARITY_NAMES, SPECIES_BY_ID } from '../content/species';
import { STAGES } from '../content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../content/traits';
import { GENERA } from '../content/types';
import {
  cardStatus,
  declineReward,
  evaluate,
  previewChoice,
  rerollCost,
  secondsToNextWaypoint,
  stageProgress,
  waypointProgress,
} from '../core/formulas';
import type { GameState } from '../core/state';
import { allWaypointsReached } from '../core/tick';
import { createFloatLayer, restartAnimation } from './feedback';
import { formatDuration, formatNumber, formatRate } from './format';

export interface PanelActions {
  /** Gibt true zurück, wenn die Wahl geklappt hat. */
  onChoose(encounterIndex: number, cardIndex: number, replaceSpeciesId?: string): boolean;
  onDecline(encounterIndex: number): boolean;
  onReroll(encounterIndex: number): boolean;
  onReset(): void;
}

/**
 * Schlichte, funktionale Seitenleiste des v2-Prototyps: Stufe, Wachstum, Samen,
 * Harmonie, offene Begegnungen mit ihren Karten und die Nischen mit ihren Tieren.
 * Zahlen werden pro Frame gesetzt; Begegnungen und Nischen nur neu aufgebaut, wenn
 * sich das Ökosystem oder die Warteschlange ändert.
 */
export function createPanel(container: HTMLElement, actions: PanelActions) {
  container.innerHTML = `
    <header class="panel-header">
      <h1>Vom Samen zum Wald</h1>
      <p class="stage-name" data-ref="stage"></p>
      <div class="progress" title="Fortschritt zur nächsten Stufe"><div class="progress-bar" data-ref="progress"></div></div>
      <p class="hint" data-ref="next"></p>
    </header>
    <ul class="resources">
      <li><span>🌿 Wachstum</span><b data-ref="growth-rate"></b><small data-ref="growth-total"></small></li>
      <li><span>🌰 Samen</span><b data-ref="seeds"></b><small data-ref="seeds-rate"></small></li>
      <li><span>⚖️ Harmonie</span><b data-ref="harmony"></b><small data-ref="multiplier"></small></li>
    </ul>
    <div class="waypoint">
      <div class="progress small" title="Fortschritt zur nächsten Begegnung"><div class="progress-bar" data-ref="waypoint-bar"></div></div>
      <p class="hint" data-ref="waypoint"></p>
    </div>
    <h2>Begegnungen <span class="count" data-ref="encounter-count"></span></h2>
    <div class="encounters" data-ref="encounters"></div>
    <h2>Ökosystem</h2>
    <p class="hint" data-ref="traits"></p>
    <div class="niches" data-ref="niches"></div>
    <footer><button class="link-button" data-ref="reset">Spielstand löschen</button></footer>
  `;
  const ref = (name: string) => container.querySelector<HTMLElement>(`[data-ref="${name}"]`)!;
  const encountersEl = ref('encounters');
  const nichesEl = ref('niches');
  const floats = createFloatLayer(document.body);

  let current: GameState | null = null;
  let encounterKey = '';
  let nicheKey = '';

  // --- Begegnungen: ein Listener für alle Buttons (Event-Delegation) -------------
  encountersEl.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button || button.disabled || !current) return;
    const section = button.closest<HTMLElement>('[data-encounter]');
    if (!section) return;
    const e = Number(section.dataset.encounter);
    const action = button.dataset.action;
    if (action === 'choose') {
      const card = button.closest<HTMLElement>('[data-card]')!;
      const c = Number(card.dataset.card);
      const replace = card.querySelector<HTMLSelectElement>('select')?.value || undefined;
      const speciesId = current.pendingEncounters[e]?.cards[c];
      if (actions.onChoose(e, c, replace) && speciesId) {
        const niche = SPECIES_BY_ID.get(speciesId)?.niche;
        renderNow();
        const row = niche ? nichesEl.querySelector<HTMLElement>(`[data-niche="${niche}"]`) : null;
        if (row) restartAnimation(row, 'arrived');
      }
    } else if (action === 'decline') {
      const reward = declineReward();
      if (actions.onDecline(e)) {
        spawnAt(button, `+${formatNumber(reward)} 🌰`);
        renderNow();
        restartAnimation(ref('seeds'), 'pop');
      }
    } else if (action === 'reroll') {
      if (actions.onReroll(e)) {
        renderNow();
        const section = encountersEl.querySelector<HTMLElement>(`[data-encounter="${e}"]`);
        if (section) restartAnimation(section, 'rerolled');
      }
    }
  });
  // Vorschau neu rechnen, wenn bei voller Nische ein anderes Tier zum Entlassen gewählt wird.
  encountersEl.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    const card = select.closest<HTMLElement>('[data-card]');
    const section = select.closest<HTMLElement>('[data-encounter]');
    if (!card || !section || !current) return;
    const preview = card.querySelector<HTMLElement>('.preview');
    if (preview) preview.innerHTML = previewText(current, Number(section.dataset.encounter), Number(card.dataset.card), select.value);
  });

  function spawnAt(el: HTMLElement, text: string): void {
    const rect = el.getBoundingClientRect();
    floats.spawn(text, rect.left + rect.width / 2, rect.top);
  }

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

  function renderNow(): void {
    if (current) update(current);
  }

  function update(state: GameState): void {
    current = state;
    const ev = evaluate(state);
    const stage = STAGES[state.stage]!;
    const next = STAGES[state.stage + 1];

    ref('stage').textContent = `Stufe: ${stage.name}`;
    ref('progress').style.width = `${(stageProgress(state) * 100).toFixed(1)}%`;
    ref('next').textContent = next ? `Nächste Stufe: „${next.name}“` : 'Höchste Stufe erreicht.';

    ref('growth-rate').textContent = formatRate(ev.growth);
    ref('growth-total').textContent = formatNumber(Math.floor(state.totalGrowth));
    ref('seeds').textContent = formatNumber(state.seeds);
    ref('seeds-rate').textContent = formatRate(ev.seeds);
    ref('harmony').textContent = formatNumber(Math.round(ev.harmony));
    ref('multiplier').textContent = `×${formatNumber(Math.round(ev.multiplier * 100) / 100)}`;

    ref('waypoint-bar').style.width = `${(waypointProgress(state) * 100).toFixed(1)}%`;
    const toNext = secondsToNextWaypoint(state);
    ref('waypoint').textContent =
      allWaypointsReached(state) || !Number.isFinite(toNext)
        ? 'Alle Wegpunkte erreicht.'
        : `Nächste Begegnung in ${formatDuration(Math.ceil(toNext))}`;

    const pending = state.pendingEncounters;
    ref('encounter-count').textContent = pending.length > 0 ? `(${pending.length})` : '';

    // Begegnungen hängen auch von den Nischen ab (voll/frei, Vorschau).
    const eKey = `${state.stage}|${JSON.stringify(state.niches)}|${JSON.stringify(pending)}`;
    if (eKey !== encounterKey) {
      encounterKey = eKey;
      encountersEl.innerHTML = pending.length
        ? pending.map((_, i) => encounterHtml(state, i)).join('')
        : '<p class="hint empty">Gerade wartet keine Begegnung. Dein Baum wächst weiter …</p>';
    }
    // Neu-würfeln-Buttons hängen an den Samen, die sich jeden Frame ändern.
    encountersEl.querySelectorAll<HTMLButtonElement>('button[data-action="reroll"]').forEach((button) => {
      const e = Number(button.closest<HTMLElement>('[data-encounter]')!.dataset.encounter);
      button.disabled = state.seeds < rerollCost(state, e);
    });

    const nKey = `${state.stage}|${JSON.stringify(state.niches)}`;
    if (nKey !== nicheKey) {
      nicheKey = nKey;
      nichesEl.innerHTML = nichesHtml(state);
      ref('traits').innerHTML = traitsHtml(state);
    }
  }

  return { update };
}

function encounterHtml(state: GameState, e: number): string {
  const encounter = state.pendingEncounters[e]!;
  const cards = encounter.cards.map((_, c) => cardHtml(state, e, c)).join('');
  return `
    <section class="encounter" data-encounter="${e}" aria-label="Begegnung ${e + 1}">
      <p class="encounter-title">Etwas regt sich am Baum … wer darf einziehen?</p>
      <div class="cards">${cards}</div>
      <div class="encounter-actions">
        <button class="secondary" data-action="decline">Ablehnen (+${formatNumber(declineReward())} 🌰)</button>
        <button class="secondary" data-action="reroll">Neu würfeln (−${formatNumber(rerollCost(state, e))} 🌰)</button>
      </div>
    </section>`;
}

function cardHtml(state: GameState, e: number, c: number): string {
  const id = state.pendingEncounters[e]!.cards[c]!;
  const sp = SPECIES_BY_ID.get(id)!;
  const niche = NICHES_BY_ID.get(sp.niche)!;
  const genus = GENUS_INFO[sp.genus];
  const status = cardStatus(state, e, c);
  const occupants = state.niches[sp.niche];
  const slots = niche.slots[state.stage] ?? 0;
  let control = '';
  if (status === 'free') {
    control = `<button class="choose" data-action="choose">Wählen</button>`;
  } else if (status === 'full') {
    const options = occupants
      .map((o) => `<option value="${o}">${SPECIES_BY_ID.get(o)?.name ?? o}</option>`)
      .join('');
    control = `
      <label class="replace">${niche.name} ist voll – entlassen:
        <select>${options}</select>
      </label>
      <button class="choose" data-action="choose">Tauschen</button>`;
  } else {
    const reason = status === 'present' ? 'lebt schon hier' : 'Nische noch geschlossen';
    control = `<button class="choose" data-action="choose" disabled>${reason}</button>`;
  }
  const replace = status === 'full' ? occupants[0] : undefined;
  return `
    <article class="card rarity-${sp.rarity}" data-card="${c}" data-species="${sp.id}">
      <p class="card-meta"><span>${genus.icon} ${genus.name}</span><span>${RARITY_NAMES[sp.rarity]}</span></p>
      <strong class="card-name">${sp.name}</strong>
      <p class="card-niche">${niche.icon} ${niche.name} · ${occupants.length}/${slots} belegt</p>
      <p class="card-effect">${sp.summary}</p>
      <p class="preview">${previewText(state, e, c, replace)}</p>
      ${control}
    </article>`;
}

/** „😊 75 % · ⚖️ +12 · 🌿 +0,4/s“ – was die Wahl bewirken würde. */
function previewText(state: GameState, e: number, c: number, replace?: string): string {
  const preview = previewChoice(state, e, c, replace);
  const id = state.pendingEncounters[e]?.cards[c];
  if (!preview || !id) return '';
  const now = evaluate(state);
  const happiness = preview.animals[id]?.happiness ?? 0;
  const dH = preview.harmony - now.harmony;
  const dG = preview.growth - now.growth;
  return `😊 ${Math.round(happiness * 100)} % · ⚖️ ${signed(dH, 0)} · 🌿 ${signed(dG, 1)}/s`;
}

function signed(value: number, digits: number): string {
  const factor = Math.pow(10, digits);
  const rounded = Math.round(value * factor) / factor;
  return `${rounded >= 0 ? '+' : '−'}${formatNumber(Math.abs(rounded))}`;
}

function nichesHtml(state: GameState): string {
  const ev = evaluate(state);
  return NICHES.map((niche) => {
    const slots = niche.slots[state.stage] ?? 0;
    const opensAt = niche.slots.findIndex((n) => n > 0);
    if (slots <= 0) {
      const at = STAGES[opensAt]?.name ?? '';
      return `<div class="niche closed" data-niche="${niche.id}"><span>${niche.icon} ${niche.name}</span><small>öffnet bei „${at}“</small></div>`;
    }
    const animals = state.niches[niche.id]
      .map((id) => {
        const sp = SPECIES_BY_ID.get(id);
        const z = ev.animals[id]?.happiness ?? 0;
        return `<li><span>${sp ? GENUS_INFO[sp.genus].icon : ''} ${sp?.name ?? id}</span><small>😊 ${Math.round(z * 100)} %</small></li>`;
      })
      .join('');
    const free = slots - state.niches[niche.id].length;
    const freeText = free > 0 ? `<li class="free"><span>${free} ${free === 1 ? 'Platz' : 'Plätze'} frei</span></li>` : '';
    return `
      <div class="niche" data-niche="${niche.id}">
        <div class="niche-head"><span>${niche.icon} ${niche.name}</span><small>${state.niches[niche.id].length}/${slots}</small></div>
        <ul>${animals}${freeText}</ul>
      </div>`;
  }).join('');
}

function traitsHtml(state: GameState): string {
  const ev = evaluate(state);
  const parts = GENERA.filter((g) => ev.genusCounts[g] > 0).map((g) => {
    const tier = ev.traitTiers[g];
    const bonus = tier > 0 ? ` – ${TRAITS[g].slice(0, tier).map((t) => t.text).join(', ')}` : ` (Bonus ab ${TRAIT_THRESHOLDS[0]})`;
    return `${GENUS_INFO[g].icon} ${ev.genusCounts[g]}${bonus}`;
  });
  return parts.length ? `Gattungen: ${parts.join(' · ')}` : 'Noch lebt niemand an deinem Baum.';
}
