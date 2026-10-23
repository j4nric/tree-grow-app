/**
 * StageLadder: Stufenleiste auf der linken Seite (docs/ALBUM_UI.md, A.2 #22–23): alle 8
 * Stufen (Desktop), Balken mit der Lage des Baums und darunter der Fortschrittshinweis
 * (`progress-hint`, z. B. „Nächste Begegnung in 1:20“). Mobil nur Balken und Hinweis.
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
  root.append(names, track, hint);

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
    },
  };
}
