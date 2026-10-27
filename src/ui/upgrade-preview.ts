/**
 * Vorschau Ausbau und Zielzeile (Phase 11, 1c; seit 4b auf echten Daten) – nicht im Spiel
 * eingebunden; im Spiel steht der Ausbau in R:Nischen (`album/pages/niches-page.ts`).
 * Aufruf: `npx vite` → /src/ui/upgrade-preview.html
 *
 * Query-Parameter:
 * - `state=start|middle|late` – Beispielzustand (upgrade-fixtures.ts)
 * - `amount=1|10|max` – Kaufmenge
 * - `frame=full|page` – volle Breite (ab 900 px Polaroid links, Seite rechts) oder so schmal
 *   wie eine Album-Seite (~470 px)
 * - `live=1` – Samen wachsen jede Sekunde um die Rate (Countdown sichtbar)
 *
 * „Ausbauen“ funktioniert hier mit dem Beispielzustand (Samen sinken, Stufe steigt, ein
 * Platz-Meilenstein klebt einen leeren Platz ein); im Spiel macht das die Aktion
 * `upgradeNiche`/`upgradeTree` des Spielstands.
 */
import { SPECIES_BY_ID } from '../content/species';
import { rarityKey } from './adapters';
import { createGoalLine, createBuyAmountSwitch, createNicheFooter, createTreeUpgrades, createUpgradeBadge, type NicheFooter, type UpgradeBadgeEl } from './album/upgrade-panel';
import { HABITAT_NICHE_IDS } from './album/pages/niches-view';
import { createPolaroid } from './album/polaroid';
import { createStickerSlot, type StickerSlot } from './album/sticker';
import { createTapeLabel } from './album/tape-label';
import './album/tokens.css';
import './album/pages/niches-page.css';
import { el, setText } from './dom';
import { createFloatLayer, restartAnimation } from './feedback';
import { formatNumber, formatRate } from './format';
import { initPreferences } from './preferences';
import { MILESTONE_NAMES, type TreePartId } from '../content/upgrades';
import { NICHES } from '../content/niches';
import {
  fixtureUpgradeState,
  NICHE_MILESTONE_INPUTS,
  TREE_PART_INPUTS,
  UPGRADE_FIXTURES,
  type UpgradeFixtureId,
  type UpgradeFixtureInput,
  type UpgradePageState,
} from './upgrade-fixtures';
import { goalLineView, nicheFooterView, treeMilestoneHint, treePartView, type BuyAmount, type GoalInput } from './upgrade-view';
import { nicheSlotsLabel } from './view-format';
import type { AnimalView } from './view-model';

initPreferences();


const params = new URLSearchParams(location.search);
const fixtureIds = Object.keys(UPGRADE_FIXTURES) as UpgradeFixtureId[];
let fixtureId: UpgradeFixtureId = fixtureIds.includes(params.get('state') as UpgradeFixtureId) ? (params.get('state') as UpgradeFixtureId) : 'middle';
const amountParam = params.get('amount');
let amount: BuyAmount = amountParam === '10' ? 10 : amountParam === 'max' ? 'max' : 1;
let frame: 'full' | 'page' = params.get('frame') === 'page' ? 'page' : 'full';
let live = params.get('live') === '1';
let input: UpgradeFixtureInput = structuredClone(UPGRADE_FIXTURES[fixtureId].input) as UpgradeFixtureInput;
let state: UpgradePageState = fixtureUpgradeState(input, amount);
/** Ziel bleibt stabil zwischen Käufen (28.7, Regel 5) – neu nur nach Kauf oder Zustandswechsel. */
let goal: GoalInput | null = state.goal;

const floats = createFloatLayer(document.body);

// --- Rahmen -------------------------------------------------------------------------------
const main = document.getElementById('preview')!;
main.dataset.frame = frame;
const bar = el('div', 'preview-bar');
bar.setAttribute('role', 'group');
bar.setAttribute('aria-label', 'Beispielzustand und Breite');
const log = el('p', 'preview-log');
log.setAttribute('role', 'status');
const book = el('div', 'preview-book');

// --- Polaroid-Kopf mit Zielzeile -------------------------------------------------------------
const head = el('div', 'preview-head');
const canvas = document.createElement('canvas');
canvas.id = 'scene';
canvas.width = 342;
canvas.height = 230;
drawScene(canvas);
const polaroid = createPolaroid(canvas, () => (log.textContent = 'Vollbild gibt es nur im Spiel.'));
const labels = el('div', 'tape-labels');
const growthLabel = createTapeLabel('growth', 'Wachstum', 'growth-rate');
const seedsLabel = createTapeLabel('seeds', 'Samen', 'seeds');
const harmonyLabel = createTapeLabel('harmony', 'Harmonie', 'harmony', true);
labels.append(growthLabel.element, seedsLabel.element, harmonyLabel.element);
const goalLine = createGoalLine(jumpToGoal, () => (log.textContent = 'R:Forschung – Sprung kommt mit Phase 11, 4a.'));
head.append(polaroid.element, labels, goalLine.element);

// --- Reiterseite „Nischen“ -------------------------------------------------------------------
const page = el('section', 'preview-page niches-page');
page.setAttribute('aria-label', 'Reiter Nischen');
const body = el('div', 'page-body');
const pageHead = el('div', 'upgrade-page-head');
const title = el('h1', 'preview-title', 'Wer wohnt wo?');
const amountSwitch = createBuyAmountSwitch((next) => {
  amount = next;
  syncUrl();
  refresh(false);
});
pageHead.append(title, amountSwitch.element);
const treeUpgrades = createTreeUpgrades((partId) => buy('tree', partId));

interface Row {
  root: HTMLLIElement;
  title: HTMLElement;
  count: HTMLElement;
  badge: UpgradeBadgeEl;
  list: HTMLUListElement;
  hint: HTMLElement;
  slots: StickerSlot[];
  footer: NicheFooter;
}
const rows = new Map<string, Row>();
const treeSection = el('section', 'niches-section niches-tree');
treeSection.append(el('h3', 'niches-heading', 'Am Baum'));
const treeList = el('ul', 'nrow-list');
treeSection.append(treeList);
const habitatSection = el('section', 'niches-section niches-habitats');
habitatSection.append(el('h3', 'niches-heading', 'Lebensräume'));
const habitatList = el('ul', 'nrow-list');
habitatSection.append(habitatList);
body.append(pageHead, treeUpgrades.element, treeSection, habitatSection);
page.append(body);
book.append(head, page);

// --- Schalter der Vorschau ---------------------------------------------------------------------
const stateButtons = fixtureIds.map((id) => {
  const b = el('button', undefined, UPGRADE_FIXTURES[id].name);
  b.type = 'button';
  b.dataset.state = id;
  b.addEventListener('click', () => {
    fixtureId = id;
    input = structuredClone(UPGRADE_FIXTURES[id].input) as UpgradeFixtureInput;
    log.textContent = '';
    syncUrl();
    refresh(true);
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
const liveButton = el('button');
liveButton.type = 'button';
liveButton.dataset.live = 'toggle';
liveButton.addEventListener('click', () => {
  live = !live;
  syncUrl();
  render();
});
bar.append(...stateButtons, frameButton, liveButton);
main.append(bar, log, book);

function syncUrl(): void {
  const url = new URL(location.href);
  url.searchParams.set('state', fixtureId);
  url.searchParams.set('amount', String(amount));
  url.searchParams.set('frame', frame);
  if (live) url.searchParams.set('live', '1');
  else url.searchParams.delete('live');
  history.replaceState(null, '', url);
}

// --- Zustand → Ansicht -------------------------------------------------------------------------

/** Zustand neu ableiten; `newGoal`: Ziel neu wählen (Kauf, Zustandswechsel). */
function refresh(newGoal: boolean): void {
  state = fixtureUpgradeState(input, amount);
  if (newGoal) goal = state.goal;
  render();
}

function animalView(id: string, happiness: number): AnimalView {
  const sp = SPECIES_BY_ID.get(id);
  return {
    id,
    name: sp?.name ?? id,
    family: sp?.genus ?? 'soil',
    familyIcon: '',
    rarity: rarityKey(sp?.rarity ?? 0),
    happiness,
    mood: happiness >= 0.8 ? 'fühlt sich wohl' : 'sucht noch etwas',
  };
}

function buildRow(id: string): Row {
  const niche = NICHES.find((n) => n.id === id)!;
  const data = { icon: niche.icon, label: niche.name };
  const li = el('li', 'nrow');
  li.dataset.niche = id;
  const label = el('div', 'nrow-label');
  const t = el('span', 'nrow-title', `${data.icon} ${data.label}`);
  t.tabIndex = -1;
  const count = el('span', 'nrow-count');
  const badge = createUpgradeBadge();
  label.append(t, count, badge.element);
  const content = el('div', 'nrow-content');
  const list = el('ul', 'sticker-list');
  list.setAttribute('aria-label', `Plätze in ${data.label}`);
  const hint = el('p', 'nrow-hint');
  const hintText = el('span', 'nrow-hint-text');
  hint.append(hintText);
  content.append(list, hint);
  const footer = createNicheFooter(() => buy('niche', id));
  li.append(label, content, footer.element);
  return { root: li, title: t, count, badge, list, hint: hintText, slots: [], footer };
}

function render(): void {
  for (const b of stateButtons) b.setAttribute('aria-pressed', String(b.dataset.state === fixtureId));
  frameButton.textContent = frame === 'page' ? 'Breite: Album-Seite' : 'Breite: voll';
  frameButton.setAttribute('aria-pressed', String(frame === 'page'));
  liveButton.textContent = live ? 'Zeit läuft' : 'Zeit steht';
  liveButton.setAttribute('aria-pressed', String(live));

  polaroid.setStage(input.stageName);
  growthLabel.setValue(formatRate(input.growthPerSecond));
  seedsLabel.setValue(formatNumber(Math.floor(input.seeds)));
  seedsLabel.setSub(formatRate(input.seedsPerSecond));
  harmonyLabel.setValue(formatNumber(input.harmony));
  goalLine.update(goalLineView(goal, state.ctx, state.research));
  amountSwitch.update(amount);

  treeUpgrades.update(state.tree.map((p) => treePartView(p, state.ctx)), treeMilestoneHint(state.tree));

  const order = { tree: [] as HTMLElement[], habitats: [] as HTMLElement[] };
  for (const niche of state.niches) {
    let row = rows.get(niche.id);
    if (!row) {
      row = buildRow(niche.id);
      rows.set(niche.id, row);
    }
    const closed = niche.capacity <= 0;
    row.root.classList.toggle('is-locked', closed);
    setText(row.count, nicheSlotsLabel(niche.animals.length, niche.capacity));
    const footer = nicheFooterView(niche, state.ctx);
    row.badge.update(footer.badge);
    row.footer.update(footer);
    setText(row.hint, closed ? (niche.unlockHint ?? '') : '');
    row.hint.parentElement!.hidden = !closed;
    const needed = closed ? 0 : Math.max(niche.capacity, niche.animals.length);
    while (row.slots.length < needed) {
      const slot = createStickerSlot();
      row.slots.push(slot);
      row.list.append(slot.element);
    }
    row.slots.forEach((slot, i) => {
      slot.element.hidden = i >= needed;
      const animal = niche.animals[i];
      if (animal && i < needed) slot.setAnimal(animalView(animal.id, animal.happiness), i, false);
      else slot.setEmpty();
    });
    row.list.hidden = needed === 0;
    (HABITAT_NICHE_IDS.has(niche.id) ? order.habitats : order.tree).push(row.root);
  }
  for (const [id, row] of rows) if (!state.niches.some((n) => n.id === id)) row.root.remove();
  if (treeList.children.length !== order.tree.length || order.tree.some((r, i) => treeList.children[i] !== r)) treeList.replaceChildren(...order.tree);
  if (habitatList.children.length !== order.habitats.length || order.habitats.some((r, i) => habitatList.children[i] !== r)) habitatList.replaceChildren(...order.habitats);
  habitatSection.hidden = order.habitats.length === 0;
}

// --- Aktionen (Platzhalter) -----------------------------------------------------------------------

function buy(kind: 'niche' | 'tree', id: string): void {
  const target = kind === 'tree' ? state.tree.find((p) => p.id === id) : state.niches.find((n) => n.id === id);
  if (!target?.purchase || target.purchase.cost > input.seeds) return;
  const { count, cost } = target.purchase;
  const from = target.level;
  const to = from + count;
  input = { ...input, seeds: input.seeds - cost };
  let anchor: HTMLElement | null;
  if (kind === 'tree') {
    const part = id as TreePartId;
    input = { ...input, tree: { ...input.tree, [part]: { ...input.tree[part], level: to } } };
    anchor = treeUpgrades.row(id);
  } else {
    input = {
      ...input,
      niches: input.niches.map((n) => {
        if (n.id !== id) return n;
        // Platz-Meilenstein (25 „Gut bewohnt“): +1 Platz (Einkleben eines leeren Platzes).
        const slot = NICHE_MILESTONE_INPUTS.some((m) => m.summary === '+1 Platz' && m.level > from && m.level <= to) ? 1 : 0;
        return { ...n, level: to, capacity: n.capacity + slot };
      }),
    };
    anchor = rows.get(id)?.root ?? null;
  }
  refresh(true);
  if (kind === 'tree') treeUpgrades.flash(id);
  else rows.get(id)?.footer.flash();
  const rect = anchor?.getBoundingClientRect();
  if (rect) {
    floats.spawn(count === 1 ? '+1 Stufe' : `+${formatNumber(count)} Stufen`, rect.right - 60, rect.top);
    const milestones = kind === 'tree' ? TREE_PART_INPUTS.find((p) => p.id === id)!.milestones : NICHE_MILESTONE_INPUTS;
    const reached = milestones.filter((m) => m.level > from && m.level <= to && !m.badge).pop();
    const title = kind === 'niche' && reached ? MILESTONE_NAMES[reached.level] : undefined;
    if (reached) floats.spawn(title ? `${title}! ${reached.summary}` : `${reached.summary}!`, rect.left + rect.width / 2, rect.top + 12, 'note');
  }
  log.textContent = `Ausgebaut: ${count === 1 ? 'eine Stufe' : `${formatNumber(count)} Stufen`} für ${formatNumber(cost)} Samen.`;
}

function jumpToGoal(): void {
  if (!goal) return;
  const row = goal.kind === 'tree' ? treeUpgrades.row(goal.id) : (rows.get(goal.id)?.root ?? null);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: document.body.dataset.motion === 'reduce' ? 'auto' : 'smooth' });
  restartAnimation(row, 'upgrade-flash');
  row.querySelector<HTMLElement>('.nrow-title, .upgrade-part-title')?.focus({ preventScroll: true });
}

/** Einfaches Bild statt der Szene: Himmel, Boden, Stamm und Krone (einmal gezeichnet). */
function drawScene(c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const sky = ctx.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#cfe8f3');
  sky.addColorStop(1, '#eef6e8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#9cc47f';
  ctx.fillRect(0, c.height * 0.78, c.width, c.height);
  ctx.fillStyle = '#7a5a3c';
  ctx.fillRect(c.width / 2 - 9, c.height * 0.45, 18, c.height * 0.36);
  ctx.fillStyle = '#5f9a55';
  ctx.beginPath();
  ctx.arc(c.width / 2, c.height * 0.38, 58, 0, Math.PI * 2);
  ctx.fill();
}

setInterval(() => {
  if (!live) return;
  input = { ...input, seeds: input.seeds + input.seedsPerSecond };
  // Nur Samen ändern sich: Knöpfe und Countdown neu, das Ziel bleibt (Regel 5).
  refresh(false);
}, 1000);

refresh(true);
