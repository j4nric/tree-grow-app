/**
 * Vorschau des Forschungsbaums (Phase 10, 1c) – nicht im Spiel eingebunden.
 * Aufruf: `npx vite` → /src/ui/research-preview.html
 *
 * Query-Parameter:
 * - `state=start|middle|late` – Beispielzustand (research-fixtures.ts)
 * - `frame=full|page` – volle Breite oder so schmal wie eine Album-Seite (~470 px)
 *
 * „Erforschen“ funktioniert hier mit dem Platzhalter-Zustand (Vorrat sinkt, Knoten wird
 * erforscht); im Spiel macht das ab 4a die Aktion `research` des Spielstands.
 */
import { RESEARCH_BY_ID } from '../content/research';
import { createResearchTree } from './album/research-tree';
import './album/tokens.css';
import { el } from './dom';
import { initPreferences } from './preferences';
import { fixtureState, RESEARCH_FIXTURES, type ResearchFixtureId, type ResearchFixtureInput } from './research-fixtures';

initPreferences();

const params = new URLSearchParams(location.search);
const fixtureIds = Object.keys(RESEARCH_FIXTURES) as ResearchFixtureId[];
let fixtureId: ResearchFixtureId = fixtureIds.includes(params.get('state') as ResearchFixtureId)
  ? (params.get('state') as ResearchFixtureId)
  : 'middle';
let frame: 'full' | 'page' = params.get('frame') === 'page' ? 'page' : 'full';
let input: ResearchFixtureInput = structuredClone(RESEARCH_FIXTURES[fixtureId].input) as ResearchFixtureInput;

const main = document.getElementById('preview')!;
main.dataset.frame = frame;
const page = el('div', 'preview-page');
const title = el('h1', 'preview-title', 'Forschung');
const bar = el('div', 'preview-bar');
bar.setAttribute('role', 'group');
bar.setAttribute('aria-label', 'Beispielzustand und Breite');
const log = el('p', 'preview-log');
log.setAttribute('role', 'status');

const tree = createResearchTree({
  onResearch(id) {
    const node = RESEARCH_BY_ID.get(id)!;
    input = { ...input, harmony: input.harmony - node.cost, researched: [...input.researched, id] };
    log.textContent = `${node.icon} ${node.boughtText}`;
    render();
  },
  onOpen(id) {
    log.textContent = `Unterseite „${RESEARCH_BY_ID.get(id)!.name}“ kommt mit Phase 10, 4a.`;
  },
});

const stateButtons = fixtureIds.map((id) => {
  const b = el('button', undefined, RESEARCH_FIXTURES[id].name);
  b.type = 'button';
  b.dataset.state = id;
  b.addEventListener('click', () => {
    fixtureId = id;
    input = structuredClone(RESEARCH_FIXTURES[id].input) as ResearchFixtureInput;
    log.textContent = '';
    syncUrl();
    render();
  });
  return b;
});
const frameButton = el('button');
frameButton.type = 'button';
frameButton.dataset.frame = 'toggle';
frameButton.addEventListener('click', () => {
  frame = frame === 'page' ? 'full' : 'page';
  main.dataset.frame = frame;
  syncUrl();
  render();
});
bar.append(...stateButtons, frameButton);

function syncUrl(): void {
  const url = new URL(location.href);
  url.searchParams.set('state', fixtureId);
  url.searchParams.set('frame', frame);
  history.replaceState(null, '', url);
}

function render(): void {
  for (const b of stateButtons) b.setAttribute('aria-pressed', String(b.dataset.state === fixtureId));
  frameButton.textContent = frame === 'page' ? 'Breite: Album-Seite' : 'Breite: voll';
  frameButton.setAttribute('aria-pressed', String(frame === 'page'));
  tree.update(fixtureState(input));
}

page.append(title, bar, log, tree.root);
main.append(page);
render();
