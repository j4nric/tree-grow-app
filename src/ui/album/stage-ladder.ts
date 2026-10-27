/**
 * StageLadder: Stufenleiste auf der linken Seite (docs/ALBUM_UI.md, A.2 #22–23): alle 8
 * Stufen (Desktop), Balken mit der Lage des Baums und darunter der Fortschrittshinweis
 * (`progress-hint`, z. B. „Nächste Begegnung in 1:20“), daneben die Zeit bis zur nächsten Stufe
 * (`stage-eta`, „Wald in ~22 Min.“). Mobil nur Balken und Hinweise.
 */
import { el, setAttr, setText } from '../dom';
import { ladderProgress, ladderSteps } from './stage-ladder-view';
import './stage-ladder.css';

export interface StageLadderInput {
  stage: number;
  waypoint: number;
  /** Anteil 0–1 bis zum nächsten Wegpunkt. */
  waypointProgress: number;
  hint: string;
  /** Mittelfristiges Ziel „Wald in ~22 Min.“ (Playtest Phase 11, F4); leer = ausgeblendet. */
  eta?: string;
}

export interface StageLadder {
  readonly element: HTMLElement;
  update(input: StageLadderInput): void;
}

export function createStageLadder(): StageLadder {
  const root = el('div', 'stage-ladder');
  const names = el('ol', 'stage-ladder-names');
  names.setAttribute('aria-label', 'Stufen');
  const items = ladderSteps(0).map((step) => {
    const li = el('li', 'stage-ladder-step', step.name);
    names.append(li);
    return li;
  });
  const track = el('div', 'stage-ladder-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', 'Weg vom Samen zum Urwald');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  const bar = el('div', 'stage-ladder-bar');
  track.append(bar);
  const hint = el('p', 'stage-ladder-hint');
  hint.dataset.ref = 'progress-hint';
  // Rechts daneben (bricht schmal darunter): die Zeit bis zur nächsten Stufe.
  const eta = el('p', 'stage-ladder-eta');
  eta.dataset.ref = 'stage-eta';
  eta.hidden = true;
  const hints = el('div', 'stage-ladder-hints');
  hints.append(hint, eta);
  root.append(names, track, hints);

  let shownStage = -1;

  return {
    element: root,
    update(input) {
      if (input.stage !== shownStage) {
        shownStage = input.stage;
        ladderSteps(input.stage).forEach((step, i) => {
          const li = items[i];
          if (!li) return;
          li.className = `stage-ladder-step ${step.state}`;
          if (step.state === 'current') setAttr(li, 'aria-current', 'step');
          else li.removeAttribute('aria-current');
        });
      }
      const pct = ladderProgress(input.stage, input.waypoint, input.waypointProgress) * 100;
      const width = `${pct.toFixed(1)}%`;
      if (bar.style.width !== width) bar.style.width = width;
      setAttr(track, 'aria-valuenow', String(Math.round(pct)));
      setText(hint, input.hint);
      hint.hidden = !input.hint;
      const etaText = input.eta ?? '';
      setText(eta, etaText);
      eta.hidden = !etaText;
    },
  };
}
