/**
 * Ausbau in R:Nischen und Zielzeile im Polaroid-Kopf (docs/DESIGN_V2.md 28.9, ALBUM_UI.md B.1).
 *
 * Bausteine, je einmal gebaut und danach nur über `update(view)` beschriftet (kein innerHTML):
 * - `createBuyAmountSwitch`  ×1 / ×10 / Max oben rechts im Reiter
 * - `createTreeUpgrades`     Abschnitt „🌳 Dein Baum“ (drei Baumteile, nächster Meilenstein)
 * - `createNicheFooter`      Fußzeile je Nische (Stufe, Meilenstein-Balken, Wirkung, Knopf)
 * - `createUpgradeBadge`     Abzeichen am Nischen-Etikett (Bronze/Silber/Gold)
 * - `createGoalLine`         Zielzeile mit Sprung, `aria-live` nur beim Zielwechsel
 *
 * Die Texte kommen fertig aus `../upgrade-view.ts`. Im Spiel in R:Nischen (`pages/niches-page.ts`,
 * seit Phase 11, 4b), dazu in der Vorschau `upgrade-preview.html`.
 */
import { el, setAttr, setText, setVar, srOnly } from '../dom';
import { restartAnimation } from '../feedback';
import {
  BUY_AMOUNTS,
  buyAmountAria,
  buyAmountLabel,
  type BuyAmount,
  type GoalLineView,
  type MilestoneProgress,
  type NicheFooterView,
  type TreePartView,
  type UpgradeBadgeView,
  type UpgradeButtonView,
} from '../upgrade-view';
import { openNote } from './note';
import './upgrade.css';

// ---------------------------------------------------------------------------------------
// Kaufmenge
// ---------------------------------------------------------------------------------------

export interface BuyAmountSwitch {
  readonly element: HTMLElement;
  update(amount: BuyAmount): void;
}

export function createBuyAmountSwitch(onChange: (amount: BuyAmount) => void): BuyAmountSwitch {
  const root = el('div', 'buy-amount');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Kaufmenge für alle Ausbau-Knöpfe');
  root.dataset.ref = 'buy-amount';
  const buttons = BUY_AMOUNTS.map((amount) => {
    const b = el('button', 'buy-amount-option', buyAmountLabel(amount));
    b.type = 'button';
    b.dataset.amount = String(amount);
    b.setAttribute('aria-label', `Kaufmenge: ${buyAmountAria(amount)}`);
    b.addEventListener('click', () => onChange(amount));
    return b;
  });
  root.append(...buttons);
  return {
    element: root,
    update(amount) {
      for (const b of buttons) setAttr(b, 'aria-pressed', String(b.dataset.amount === String(amount)));
    },
  };
}

// ---------------------------------------------------------------------------------------
// Gemeinsame Teile: Knopf und Balken
// ---------------------------------------------------------------------------------------

interface BuyButton {
  root: HTMLElement;
  button: HTMLButtonElement;
  update(view: UpgradeButtonView | null): void;
}

/** Knopf „Ausbauen · Preis“ mit Wartezeit darunter; zu teuer = blass und `aria-disabled`. */
function createBuyButton(onBuy: () => void): BuyButton {
  const root = el('div', 'upgrade-buy');
  const button = el('button', 'upgrade-button');
  button.type = 'button';
  button.dataset.ref = 'upgrade-buy';
  const label = el('span', 'upgrade-button-label');
  const wait = el('span', 'upgrade-button-wait');
  wait.setAttribute('aria-hidden', 'true');
  button.append(label, wait);
  root.append(button);
  // Doppelklick-Schutz wie bei der Forschung: ein Kauf je Frame.
  let locked = false;
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true' || locked) return;
    locked = true;
    requestAnimationFrame(() => (locked = false));
    onBuy();
  });
  return {
    root,
    button,
    update(view) {
      root.hidden = view === null;
      if (!view) return;
      setText(label, view.label);
      setText(wait, view.wait);
      wait.hidden = view.wait === '';
      setAttr(button, 'aria-disabled', String(!view.affordable));
      setAttr(button, 'aria-label', view.aria);
      button.classList.toggle('is-saving', !view.affordable);
    },
  };
}

interface ProgressBar {
  root: HTMLElement;
  update(progress: MilestoneProgress): void;
}

function createProgressBar(): ProgressBar {
  const root = el('span', 'upgrade-progress');
  const track = el('span', 'upgrade-progress-track');
  track.setAttribute('aria-hidden', 'true');
  const fill = el('span', 'upgrade-progress-fill');
  track.append(fill);
  const label = el('span', 'upgrade-progress-label');
  root.append(track, label);
  return {
    root,
    update(p) {
      setVar(fill, '--progress', String(Math.round(p.fraction * 1000) / 1000));
      setText(label, p.label);
      root.classList.toggle('is-done', p.next === null);
    },
  };
}

// ---------------------------------------------------------------------------------------
// Abzeichen am Etikett
// ---------------------------------------------------------------------------------------

export interface UpgradeBadgeEl {
  readonly element: HTMLElement;
  update(view: UpgradeBadgeView | null): void;
}

export function createUpgradeBadge(): UpgradeBadgeEl {
  const badge = el('span', 'upgrade-badge');
  badge.dataset.ref = 'upgrade-badge';
  badge.hidden = true;
  return {
    element: badge,
    update(view) {
      badge.hidden = view === null;
      setAttr(badge, 'data-tier', view?.tier ?? '');
      setText(badge, view?.text ?? '');
      setAttr(badge, 'title', view?.title ?? '');
    },
  };
}

// ---------------------------------------------------------------------------------------
// Fußzeile je Nische
// ---------------------------------------------------------------------------------------

export interface NicheFooter {
  readonly element: HTMLElement;
  /** Nach einem Kauf: Zeile aufleuchten lassen. */
  flash(): void;
  update(view: NicheFooterView): void;
}

export function createNicheFooter(onBuy: () => void): NicheFooter {
  const root = el('div', 'upgrade-footer');
  root.dataset.ref = 'niche-upgrade';
  const grid = el('div', 'upgrade-footer-grid');
  const levelBox = el('div', 'upgrade-level');
  const level = el('span', 'upgrade-level-text');
  const bar = createProgressBar();
  levelBox.append(level, bar.root);
  const effect = el('button', 'upgrade-effect note-trigger');
  effect.type = 'button';
  effect.dataset.ref = 'niche-upgrade-effect';
  const effectText = el('span', 'upgrade-effect-text');
  const effectSr = srOnly();
  effect.append(effectText, effectSr);
  const buy = createBuyButton(onBuy);
  grid.append(levelBox, effect, buy.root);
  root.append(grid);
  let current: NicheFooterView | null = null;
  effect.addEventListener('click', () => {
    if (current) openNote(effect, { title: current.effectTitle, lines: current.effectLines, ref: 'niche-upgrade-note' });
  });
  return {
    element: root,
    flash: () => restartAnimation(root, 'upgrade-flash'),
    update(view) {
      current = view;
      root.hidden = view.closed;
      if (view.closed) return;
      setText(level, view.levelText);
      bar.update(view.progress);
      setText(effectText, view.effectText);
      setText(effectSr, ` – Wirkung des Ausbaus, mehr zeigen`);
      buy.update(view.button);
    },
  };
}

// ---------------------------------------------------------------------------------------
// Abschnitt „🌳 Dein Baum“
// ---------------------------------------------------------------------------------------

interface PartRow {
  root: HTMLLIElement;
  title: HTMLElement;
  badge: UpgradeBadgeEl;
  level: HTMLElement;
  effect: HTMLElement;
  bar: ProgressBar;
  buy: BuyButton;
}

export interface TreeUpgrades {
  readonly element: HTMLElement;
  update(parts: readonly TreePartView[], hint: string): void;
  flash(partId: string): void;
  /** Zeile eines Baumteils (für Sprung und schwebenden Text). */
  row(partId: string): HTMLElement | null;
}

export function createTreeUpgrades(onBuy: (partId: string) => void): TreeUpgrades {
  const root = el('section', 'niches-section upgrade-tree');
  root.dataset.ref = 'tree-upgrades';
  const head = el('h3', 'niches-heading', '🌳 Dein Baum');
  head.id = 'upgrade-tree-heading';
  root.setAttribute('aria-labelledby', head.id);
  const list = el('ul', 'upgrade-parts');
  const hint = el('p', 'upgrade-tree-hint');
  hint.dataset.ref = 'tree-milestone-hint';
  root.append(head, list, hint);
  const rows = new Map<string, PartRow>();

  function build(view: TreePartView): PartRow {
    const li = el('li', 'upgrade-part');
    li.dataset.part = view.id;
    const name = el('div', 'upgrade-part-name');
    const title = el('span', 'upgrade-part-title');
    title.tabIndex = -1;
    const badge = createUpgradeBadge();
    name.append(title, badge.element);
    const level = el('span', 'upgrade-level-text');
    const effect = el('span', 'upgrade-part-effect');
    const bar = createProgressBar();
    const buy = createBuyButton(() => onBuy(view.id));
    const info = el('div', 'upgrade-part-info');
    const line = el('div', 'upgrade-part-line');
    line.append(level, effect);
    info.append(name, line, bar.root);
    li.append(info, buy.root);
    return { root: li, title, badge, level, effect, bar, buy };
  }

  return {
    element: root,
    update(parts, hintText) {
      for (const view of parts) {
        let row = rows.get(view.id);
        if (!row) {
          row = build(view);
          rows.set(view.id, row);
          list.append(row.root);
        }
        setText(row.title, view.title);
        setAttr(row.root, 'title', view.text);
        row.badge.update(view.badge);
        setText(row.level, view.levelText);
        setText(row.effect, view.effectText);
        row.bar.update(view.progress);
        row.buy.update(view.button);
      }
      setText(hint, hintText ? `▸ ${hintText}` : '');
      hint.hidden = hintText === '';
    },
    flash(partId) {
      const row = rows.get(partId);
      if (row) restartAnimation(row.root, 'upgrade-flash');
    },
    row: (partId) => rows.get(partId)?.root ?? null,
  };
}

// ---------------------------------------------------------------------------------------
// Zielzeile
// ---------------------------------------------------------------------------------------

export interface GoalLine {
  readonly element: HTMLElement;
  update(view: GoalLineView | null): void;
}

export function createGoalLine(onJump: () => void, onResearch: () => void): GoalLine {
  const root = el('div', 'goal-line');
  root.dataset.ref = 'goal-line';
  const main = el('button', 'goal-line-main');
  main.type = 'button';
  main.dataset.ref = 'goal-line-jump';
  const research = el('button', 'goal-line-research');
  research.type = 'button';
  research.dataset.ref = 'goal-line-research';
  // Ansage nur beim Zielwechsel – nicht bei jedem Countdown-Schritt (28.9).
  const live = srOnly();
  live.setAttribute('aria-live', 'polite');
  root.append(main, research, live);
  main.addEventListener('click', onJump);
  research.addEventListener('click', onResearch);
  let key: string | null = null;
  return {
    element: root,
    update(view) {
      root.hidden = view === null;
      if (!view) {
        key = null;
        return;
      }
      setText(main, view.text);
      main.classList.toggle('is-ready', view.ready);
      setText(research, view.research);
      research.hidden = view.research === '';
      setAttr(research, 'aria-label', view.researchAria);
      if (view.key !== key) {
        // Beim ersten Füllen nichts ansagen (kein Vorlesen beim Laden).
        if (key !== null) setText(live, view.announce);
        key = view.key;
      }
    },
  };
}
