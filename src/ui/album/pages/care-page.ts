/**
 * Reiter „Pflege“ – „Was tun wir für den Wald?“ (docs/ALBUM_UI.md, B.3 und A.8 #95–100).
 *
 * - **Gerade wirksam:** aktive Boni aus Ereignissen und Gästen mit Restzeit und
 *   schrumpfendem Washi-Balken; Wirkungen bis zum Neuen Zyklus darunter. Fehlt, wenn nichts
 *   wirkt.
 * - **Pflegemaßnahmen:** sortiert kaufbar → sparen → gesperrt → ausgebaut (careOrder). Die
 *   Reihenfolge bleibt stehen, solange Zeiger oder Tastaturfokus in der Liste sind oder ein
 *   Kauf weniger als CARE_HOLD_MS her ist. Jede Zeile: Symbol, Name (→ U:Pflegemaßnahme),
 *   Rang, Wirkung, „öffnet …“, Vorschau, Sperrgrund und „Kaufen (x)“.
 * - Kennzahl im Kopf („2 kaufbar“), Punkt am Reiter, wenn etwas kaufbar ist (`badge`).
 * - `reveal(id)` (von „Zur Pflege“): Zeile zeigen, Fokus auf den Namen, Aufleuchten.
 *
 * DOM einmal je Maßnahme bauen; `update` setzt nur Texte, Klassen und Reihenfolge.
 */
import { CARE } from '../../../content/care';
import { evaluate, type Evaluation } from '../../../core/formulas';
import type { GameState } from '../../../core/state';
import { nextCareRank } from '../../../core/tick';
import { activeBonusViews, toCareViews } from '../../adapters';
import { CARE_GROUP_LABELS, CARE_HOLD_MS, barWidth, careOrder, carePreviewText, careSummaryText, careTabDot } from '../../care-view';
import { el, setText, setVar, srOnly } from '../../dom';
import { prefersReducedMotion, restartAnimation } from '../../feedback';
import { hyphenate } from '../../hyphenate';
import type { ActiveBonusView, CareView } from '../../view-model';
import type { PageEnv, TabPage } from './registry';
import { setBuyButton, wireBuyButton } from './care-buy';
import { createTabPanel } from './tab-pages';
import './care-page.css';

/** Zahlen (Restzeit, „Noch X 🌰“) höchstens so oft neu – wie die übrigen Seiten. */
const REFRESH_MS = 200;

export interface CarePage extends TabPage {
  /** Zeile der Maßnahme zeigen, Fokus auf ihren Namen, kurz aufleuchten. false, wenn sie fehlt. */
  reveal(id: string): boolean;
}

/** Leichte, feste Schräglage je Maßnahme (−4° … +4°) für das Symbol-Sticker. */
export function careTilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 9) - 4;
}

/** Schlüssel, der sich ändert, sobald sich Bezahlbarkeit oder Fehlbetrag einer Maßnahme ändern. */
function affordKey(state: GameState): string {
  let key = `${state.stage}|`;
  for (const m of CARE) {
    const cost = nextCareRank(state, m.id)?.cost;
    key += (cost === undefined ? '-' : cost <= state.seeds ? '1' : Math.ceil(cost - state.seeds)) + ',';
  }
  return key;
}

const GROUP_SR: Record<CareView['group'], string> = {
  buyable: 'nächster Rang kaufbar',
  saving: 'zu wenig Samen für den nächsten Rang',
  locked: 'gesperrt',
  maxed: 'voll ausgebaut',
};

interface Row {
  id: string;
  li: HTMLLIElement;
  name: HTMLButtonElement;
  nameText: HTMLElement;
  groupSr: HTMLElement;
  rank: HTMLElement;
  next: HTMLElement;
  opens: HTMLElement;
  blocker: HTMLElement;
  preview: HTMLElement;
  previewText: Text;
  buy: HTMLButtonElement;
  view: CareView;
}

export function createCarePage(env: PageEnv): CarePage {
  const deps = env.deps;
  const page = createTabPanel('care');
  page.meta.dataset.ref = 'care-summary';

  // --- Gerade wirksam --------------------------------------------------------------------
  const active = el('section', 'care-active');
  active.dataset.ref = 'bonuses';
  active.setAttribute('aria-labelledby', 'care-active-title');
  const activeTitle = el('h3', 'care-section-title care-active-title', 'Gerade wirksam');
  activeTitle.id = 'care-active-title';
  const bonusList = el('ul', 'care-bonus-list');
  active.append(el('span', 'care-active-tape'), activeTitle, bonusList);
  active.hidden = true;
  active.firstElementChild!.setAttribute('aria-hidden', 'true');

  // --- Pflegemaßnahmen -------------------------------------------------------------------
  const section = el('section', 'care-measures');
  section.dataset.ref = 'care';
  section.setAttribute('aria-labelledby', 'care-measures-title');
  const listTitle = el('h3', 'care-section-title', 'Pflegemaßnahmen');
  listTitle.id = 'care-measures-title';
  const hint = el('p', 'care-hint', 'Tippe auf einen Namen, um umzublättern.');
  const empty = el('p', 'care-empty', 'Noch gibt es nichts zu pflegen – die ersten Maßnahmen kommen, wenn der Baum wächst.');
  const list = el('ul', 'care-list');
  list.setAttribute('aria-label', 'Pflegemaßnahmen');
  // Statuszeile für Screenreader: Bestätigung nach dem Kauf (die schwebende ist verborgen).
  const status = srOnly();
  status.setAttribute('role', 'status');
  section.append(listTitle, hint, empty, list, status);
  page.body.append(active, section);

  // --- Zustand -------------------------------------------------------------------------
  let views: CareView[] = [];
  let viewsEval: Readonly<Evaluation> | null = null;
  let viewsKey = '';
  let checkedAt = -Infinity;
  /** Zählt neue Ansichten; die Seite zeichnet nur, wenn er sich geändert hat. */
  let version = 0;
  let shownVersion = -1;
  const rows = new Map<string, Row>();
  let order: string[] = [];
  let pointerInside = false;
  let holdUntil = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let bonusAt = -Infinity;
  let boughtText: string | null = null;
  let boughtIcon = '';

  deps.preferences.onChange(() => {
    // Zahlenformat geändert: Ansichten neu.
    viewsKey = '';
    bonusKey = '';
    checkedAt = -Infinity;
    bonusAt = -Infinity;
  });

  /** Ansichten nachziehen, wenn sich Ökosystem, Stufe oder Bezahlbarkeit geändert haben. */
  function ensureViews(now: number, force = false): void {
    if (!force && now - checkedAt < REFRESH_MS) return;
    checkedAt = now;
    const state = deps.state();
    const ev = evaluate(state);
    const key = affordKey(state);
    if (!force && ev === viewsEval && key === viewsKey) return;
    viewsEval = ev;
    viewsKey = key;
    views = toCareViews(state, ev);
    version++;
  }

  // --- Zeilen --------------------------------------------------------------------------

  /** Fokus per Tastatur in der Liste? Ein per Maus fokussierter Knopf zählt nicht. */
  const keyboardFocusInside = () => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !list.contains(focused)) return false;
    try {
      return focused.matches(':focus-visible');
    } catch {
      return true;
    }
  };
  const frozen = () => pointerInside || performance.now() < holdUntil || keyboardFocusInside();

  function buildRow(view: CareView): Row {
    const li = el('li', 'care-row');
    li.dataset.care = view.id;
    const icon = el('span', 'care-icon', view.icon);
    icon.setAttribute('aria-hidden', 'true');
    icon.style.setProperty('--tilt', `${careTilt(view.id)}deg`);
    const head = el('div', 'care-head');
    const name = el('button', 'care-open');
    name.type = 'button';
    name.dataset.careTitle = view.id;
    const nameText = el('span', 'care-name');
    const arrow = el('span', 'care-open-arrow', '›');
    arrow.setAttribute('aria-hidden', 'true');
    const groupSr = srOnly();
    name.append(nameText, arrow, groupSr);
    name.addEventListener('click', () => env.open({ kind: 'care-item', id: view.id }));
    const rank = el('span', 'care-rank');
    head.append(name, rank);

    const body = el('div', 'care-body');
    const next = el('p', 'care-next');
    const opens = el('p', 'care-opens');
    opens.dataset.ref = 'care-opens';
    const blocker = el('p', 'care-blocker');
    blocker.dataset.ref = 'care-blocker';
    body.append(next, opens, blocker);

    const preview = el('p', 'care-preview');
    preview.dataset.ref = 'care-preview';
    const previewText = document.createTextNode('');
    preview.append(srOnly('Vorschau: '), previewText);

    const buy = el('button', 'care-buy');
    buy.type = 'button';
    buy.dataset.buyCare = view.id;
    const row: Row = { id: view.id, li, name, nameText, groupSr, rank, next, opens, blocker, preview, previewText, buy, view };
    wireBuyButton(buy, {
      id: () => row.id,
      canBuy: () => row.view.canBuy,
      before(_id, now) {
        // Text vor dem Kauf merken: danach zeigt die Zeile schon den nächsten Rang.
        boughtText = row.view.boughtText;
        boughtIcon = row.view.icon;
        // Kurz festhalten, damit die Zeile nicht unter dem Finger wegspringt.
        holdUntil = now + CARE_HOLD_MS;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(release, CARE_HOLD_MS + 20);
      },
      buy: (id) => deps.actions.buyCare(id),
      bought: () => confirmBuy(row, boughtText, boughtIcon),
    });
    li.append(icon, head, body, buy, preview);
    return row;
  }

  function fillRow(row: Row, view: CareView): void {
    row.view = view;
    const li = row.li;
    for (const group of ['buyable', 'saving', 'locked', 'maxed'] as const) li.classList.toggle(`care-${group}`, group === view.group);
    li.dataset.group = view.group;
    setText(row.nameText, hyphenate(view.name));
    setText(row.groupSr, view.group === 'maxed' ? '' : ` (${GROUP_SR[view.group]})`);
    setText(row.rank, view.group === 'maxed' ? '✓ voll ausgebaut' : view.rank);
    setText(row.next, view.next ?? '');
    row.next.hidden = !view.next;
    setText(row.opens, view.opens ?? '');
    row.opens.hidden = !view.opens;
    setText(row.blocker, view.blocker ?? '');
    row.blocker.hidden = !view.blocker;
    // Vorschau nur, wo ein Kauf in Reichweite ist – gesperrte Zeilen bleiben kurz.
    const preview = view.group === 'buyable' || view.group === 'saving' ? carePreviewText(view.preview) : '';
    if (row.previewText.data !== preview) row.previewText.data = preview;
    row.preview.hidden = !preview;
    setBuyButton(row.buy, view.cost, view.canBuy, view.blocker);
  }

  /** Zeilen an die Ansichten anpassen; Reihenfolge nur ändern, wenn nicht festgehalten. */
  function render(force = false): void {
    if (!force && shownVersion === version) return;
    shownVersion = version;
    const focused = document.activeElement;
    const byId = new Map(views.map((v) => [v.id, v]));
    for (const [id, row] of rows) {
      if (!byId.has(id)) {
        row.li.remove();
        rows.delete(id);
      }
    }
    for (const view of views) {
      let row = rows.get(view.id);
      if (!row) {
        row = buildRow(view);
        rows.set(view.id, row);
      }
      fillRow(row, view);
    }
    const nextOrder = careOrder(views, order, frozen());
    if (nextOrder.join('|') !== order.join('|') || list.childElementCount !== nextOrder.length) {
      order = nextOrder;
      // Nur verschieben, was nicht schon an seinem Platz steht (Fokus bleibt erhalten).
      let at: ChildNode | null = list.firstChild;
      for (const id of order) {
        const li = rows.get(id)!.li;
        if (li === at) at = at.nextSibling;
        else list.insertBefore(li, at);
      }
    }
    // Handschrift-Überschrift über der ersten Zeile jeder Gruppe.
    let previous: string | null = null;
    for (const id of order) {
      const row = rows.get(id)!;
      const group = row.view.group;
      if (group !== previous) row.li.dataset.groupLabel = CARE_GROUP_LABELS[group];
      else delete row.li.dataset.groupLabel;
      row.li.classList.toggle('care-group-start', group !== previous && previous !== null);
      previous = group;
    }
    page.setMeta(careSummaryText(views));
    empty.hidden = views.length > 0;
    hint.hidden = views.length === 0;
    // Kaufen-Knopf nach dem letzten Rang verschwunden: Fokus auf den Namen der Maßnahme.
    if (focused instanceof HTMLButtonElement && focused.dataset.buyCare && focused.hidden) {
      rows.get(focused.dataset.buyCare)?.name.focus({ preventScroll: true });
    }
  }

  /** Bestätigung: schwebender Text über dem Knopf, dazu die Statuszeile für Screenreader. */
  function confirmBuy(row: Row, text: string | null, icon: string): void {
    // Gleich neu zeichnen (nächster Rang, Fokus), dann aufleuchten.
    ensureViews(performance.now(), true);
    render(true);
    if (!prefersReducedMotion()) restartAnimation(row.li, 'care-flash');
    if (!text) return;
    setText(status, '');
    requestAnimationFrame(() => setText(status, text));
    const anchor = row.buy.hidden ? row.li : row.buy;
    const rect = anchor.getBoundingClientRect();
    const top = row.li.getBoundingClientRect().top;
    if (rect.width > 0) env.float(`${icon} ${text}`, rect.left + rect.width / 2, top - 6);
  }

  /** Festhalten vorbei: neu sortieren, falls sich die Reihenfolge geändert hätte. */
  function release(): void {
    setTimeout(() => {
      if (frozen()) return;
      if (careOrder(views, order, false).join('|') !== order.join('|')) render(true);
    }, 0);
  }
  list.addEventListener('pointerenter', () => (pointerInside = true));
  list.addEventListener('pointerleave', () => {
    pointerInside = false;
    release();
  });
  list.addEventListener('focusout', (event) => {
    if (!list.contains(event.relatedTarget as Node | null)) release();
  });

  // --- Gerade wirksam ------------------------------------------------------------------
  let bonusKey = '';
  const bonusRows = new Map<string, { left: HTMLElement; bar: HTMLElement | null }>();

  function bonusRow(b: ActiveBonusView): HTMLElement {
    const li = el('li', b.timed ? 'care-bonus care-bonus-timed' : 'care-bonus care-bonus-cycle');
    li.dataset.bonus = b.id;
    const icon = el('span', 'care-bonus-icon', b.icon);
    icon.setAttribute('aria-hidden', 'true');
    const left = el('span', 'care-bonus-left', b.remaining);
    li.append(icon, el('span', 'care-bonus-name', hyphenate(b.name)), left, el('span', 'care-bonus-effect', b.effect));
    let bar: HTMLElement | null = null;
    if (b.timed && b.progress !== null) {
      // Rein optisch – die Restzeit steht als Text daneben.
      const track = el('span', 'care-bonus-bar');
      track.setAttribute('aria-hidden', 'true');
      bar = el('span', 'care-bonus-fill');
      track.append(bar);
      li.append(track);
    }
    bonusRows.set(b.id, { left, bar });
    return li;
  }

  function updateBonuses(now: number): void {
    if (now - bonusAt < REFRESH_MS) return;
    bonusAt = now;
    const bonuses = activeBonusViews(deps.state());
    // Nur die Struktur zählt für den Neuaufbau, nicht Restzeit und Balken.
    const key = JSON.stringify(bonuses.map((b) => [b.id, b.icon, b.name, b.effect, b.timed, b.progress === null, b.timed ? null : b.remaining]));
    if (key !== bonusKey) {
      bonusKey = key;
      active.hidden = bonuses.length === 0;
      bonusRows.clear();
      const items: HTMLElement[] = [];
      bonuses.forEach((b, i) => {
        // Vor der ersten Wirkung ohne Ablauf eine Zwischenzeile („bis zum Neuen Zyklus“).
        if (!b.timed && (i === 0 || bonuses[i - 1]!.timed)) items.push(el('li', 'care-bonus-group', b.remaining));
        items.push(bonusRow(b));
      });
      bonusList.replaceChildren(...items);
    }
    for (const b of bonuses) {
      const r = bonusRows.get(b.id);
      if (!r) continue;
      setText(r.left, b.remaining);
      if (r.bar && b.progress !== null) setVar(r.bar, '--left', barWidth(b.progress));
    }
  }

  function reveal(id: string): boolean {
    ensureViews(performance.now(), true);
    render(true);
    const row = rows.get(id);
    if (!row) return false;
    row.li.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    row.name.focus({ preventScroll: true });
    if (!prefersReducedMotion()) restartAnimation(row.li, 'care-flash');
    return true;
  }

  return {
    page,
    update(now, force) {
      // Nach einer Änderung bzw. beim Zeigen nicht auf die Drosselung warten.
      if (force) checkedAt = bonusAt = -Infinity;
      ensureViews(now);
      render();
      updateBonuses(now);
    },
    badge(now) {
      ensureViews(now);
      return careTabDot(views);
    },
    reveal,
  };
}
