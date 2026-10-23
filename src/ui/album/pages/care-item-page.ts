/**
 * Unterseite „Pflegemaßnahme“ (docs/ALBUM_UI.md, A.8 #97 und B.3), seit Spielstand v17 ein
 * Forschungsknoten (Notlösung bis Phase 10, 4a): vom Namen einer Zeile im Reiter Pflege aus
 * umgeblättert. Zeigt Stimmungstext, die Wirkung („öffnet …“, „schützt vor …“, Vorschau), die
 * Voraussetzungen mit Haken bzw. Kreuz, den Harmonie-Vorrat und den Erforschen-Knopf. Nach dem
 * Erforschen bleibt die Seite offen und zeigt den Stempel „erforscht“.
 *
 * Einmal gebaut; `opened(ref)` füllt sie, `update` zieht nur bei Änderungen nach.
 */
import { RESEARCH_BY_ID } from '../../../content/research';
import { evaluate, type Evaluation } from '../../../core/formulas';
import { isResearched } from '../../../core/tick';
import { harmonyWalletText, toCareItemView, type CareItemView } from '../../care-view';
import { el, setText, srOnly } from '../../dom';
import { prefersReducedMotion, restartAnimation } from '../../feedback';
import { hyphenate } from '../../hyphenate';
import { createBookmark } from '../bookmark';
import { createPage } from '../page';
import { initialNav, pageNumber, type PageRef } from '../nav';
import type { PageEnv, Subpage } from './registry';
import { setBuyButton, wireBuyButton } from './care-buy';
import { careTilt } from './care-page';
import './care-page.css';

const REFRESH_MS = 200;

const STATUS_TEXT: Record<CareItemView['item']['group'], string> = {
  buyable: 'Jetzt möglich',
  saving: 'Dafür sparen',
  locked: 'Noch nicht möglich',
  maxed: 'Erforscht',
};

const RANK_MARK: Record<'done' | 'next' | 'later', string> = { done: '✓', next: '➜', later: '·' };

export interface CareItemPage extends Subpage {
  /** ID der gezeigten Maßnahme (null vor dem ersten Öffnen). */
  readonly id: string | null;
}

export function createCareItemPage(env: PageEnv): CareItemPage {
  const deps = env.deps;
  const page = createPage({
    kind: 'care-item',
    title: 'Forschungsknoten',
    number: pageNumber({ ...initialNav('care'), stack: [{ kind: 'care-item', id: '' }] }),
    className: 'album-subpage care-item-page',
  });
  const bookmark = createBookmark(() => env.back());
  bookmark.setLabel('Pflege');
  page.element.prepend(bookmark.element);

  // Kopf: großes Symbol als Sticker, Rang-Etikett und Zustand.
  const head = el('div', 'care-item-head');
  const icon = el('span', 'care-item-icon');
  icon.setAttribute('aria-hidden', 'true');
  const headText = el('div', 'care-item-head-text');
  const rank = el('span', 'care-item-rank');
  rank.dataset.ref = 'care-item-rank';
  const statusLine = el('span', 'care-item-status');
  statusLine.dataset.ref = 'care-item-status';
  headText.append(rank, statusLine);
  head.append(icon, headText);

  const flavor = el('p', 'care-item-flavor');

  // Was der nächste Rang bewirkt
  const effect = el('section', 'care-item-section');
  const effectTitle = el('h3', 'care-section-title', 'Was der Knoten bewirkt');
  const pills = el('div', 'care-item-pills');
  const next = el('span', 'care-item-pill care-item-next');
  next.dataset.ref = 'care-item-next';
  const opens = el('span', 'care-item-pill care-item-opens');
  opens.dataset.ref = 'care-item-opens';
  pills.append(next, opens);
  const protects = el('p', 'care-item-protects');
  protects.dataset.ref = 'care-item-protects';
  const protectsDetail = el('p', 'care-item-protects-detail');
  const preview = el('p', 'care-item-preview');
  preview.dataset.ref = 'care-item-preview';
  const previewText = document.createTextNode('');
  preview.append(srOnly('Vorschau: '), previewText);
  effect.append(effectTitle, pills, protects, protectsDetail, preview);

  // Ränge
  const ranksSection = el('section', 'care-item-section');
  const ranks = el('ol', 'care-item-ranks');
  ranks.dataset.ref = 'care-item-ranks';
  ranksSection.append(el('h3', 'care-section-title', 'Ränge'), ranks);

  // Voraussetzungen
  const needsSection = el('section', 'care-item-section');
  const needs = el('ul', 'care-item-needs');
  needs.dataset.ref = 'care-item-needs';
  needsSection.append(el('h3', 'care-section-title', 'Voraussetzungen'), needs);

  // Kaufen bzw. Stempel „voll ausgebaut“
  const footer = el('div', 'care-item-buy-row');
  const buy = el('button', 'care-buy care-item-buy');
  buy.type = 'button';
  buy.dataset.ref = 'care-item-buy';
  const blocker = el('p', 'care-item-blocker');
  blocker.dataset.ref = 'care-item-blocker';
  const maxed = el('span', 'care-item-maxed', 'erforscht');
  maxed.dataset.ref = 'care-item-maxed';
  const status = srOnly();
  status.setAttribute('role', 'status');
  // Vorrat direkt am Knopf: Auf der Unterseite sind die Etiketten mobil nicht zu sehen (S6).
  const wallet = el('p', 'care-item-wallet');
  wallet.dataset.ref = 'care-item-wallet';
  footer.append(buy, blocker, maxed, wallet, status);

  page.body.append(head, flavor, effect, ranksSection, needsSection, footer);

  let id: string | null = null;
  let view: CareItemView | null = null;
  let shownEval: Readonly<Evaluation> | null = null;
  let shownKey = '';
  let checkedAt = -Infinity;
  let boughtText = '';
  let boughtIcon = '';

  wireBuyButton(buy, {
    id: () => id,
    canBuy: () => view?.item.canBuy ?? false,
    before() {
      // Text vor dem Kauf merken: danach zeigt die Ansicht schon den nächsten Rang.
      boughtText = view?.item.boughtText ?? '';
      boughtIcon = view?.item.icon ?? '';
    },
    buy: (careId) => deps.actions.buyCare(careId),
    bought() {
      const text = boughtText;
      const itemIcon = boughtIcon;
      refresh(performance.now(), true);
      if (!prefersReducedMotion()) restartAnimation(head, 'care-flash');
      if (!text) return;
      setText(status, '');
      requestAnimationFrame(() => setText(status, text));
      const anchor = buy.hidden ? maxed : buy;
      const rect = anchor.getBoundingClientRect();
      if (rect.width > 0) env.float(`${itemIcon} ${text}`, rect.left + rect.width / 2, rect.top - 6);
    },
  });

  /** Schlüssel: erforscht, Bezahlbarkeit bzw. Fehlbetrag – ändert sich der, wird neu gefüllt. */
  function itemKey(): string {
    const state = deps.state();
    if (!id) return '';
    const cost = RESEARCH_BY_ID.get(id)?.cost;
    const points = Number.isFinite(state.harmonyPoints) ? state.harmonyPoints : 0;
    const afford = cost === undefined || isResearched(state, id) ? '-' : cost <= points ? '1' : Math.ceil(cost - points);
    return `${state.stage}|${state.cycle.research.join(',')}|${afford}`;
  }

  function refresh(now: number, force = false): void {
    if (!id) return;
    if (!force && now - checkedAt < REFRESH_MS) return;
    checkedAt = now;
    const state = deps.state();
    // Der Vorrat ändert sich laufend – nur der Text, gedrosselt wie die Seite.
    setText(wallet, harmonyWalletText(state));
    const ev = evaluate(state);
    const key = itemKey();
    if (!force && ev === shownEval && key === shownKey) return;
    shownEval = ev;
    shownKey = key;
    view = toCareItemView(state, id, ev);
    fill();
  }

  function fill(): void {
    const measure = id ? RESEARCH_BY_ID.get(id) : undefined;
    if (!view) {
      // Nicht (mehr) in der Liste, z. B. nach dem Import eines älteren Stands.
      page.setTitle(measure?.name ?? 'Forschungsknoten');
      page.setMeta('');
      setText(statusLine, 'Gerade nicht verfügbar');
      for (const part of [flavor, effect, ranksSection, needsSection, footer]) part.hidden = true;
      return;
    }
    const item = view.item;
    page.setTitle(hyphenate(item.name));
    page.setMeta('');
    setText(icon, item.icon);
    icon.style.setProperty('--tilt', `${careTilt(item.id)}deg`);
    setText(rank, item.rank);
    setText(statusLine, item.group === 'buyable' || item.group === 'maxed' ? STATUS_TEXT[item.group] : (item.blocker ?? STATUS_TEXT[item.group]));
    page.element.dataset.group = item.group;

    flavor.hidden = !view.text;
    setText(flavor, view.text);

    // Wirkung nur, solange es einen nächsten Rang gibt; Schutz gilt immer.
    setText(next, item.next ?? '');
    next.hidden = !item.next;
    setText(opens, item.opens ?? '');
    opens.hidden = !item.opens;
    pills.hidden = !item.next && !item.opens;
    setText(protects, item.protects ?? '');
    protects.hidden = !item.protects;
    setText(protectsDetail, item.protectsDetail ?? '');
    protectsDetail.hidden = !item.protectsDetail;
    if (previewText.data !== view.preview) previewText.data = view.preview;
    preview.hidden = !view.preview || item.group === 'maxed';
    effect.hidden = pills.hidden && protects.hidden && preview.hidden;
    setText(effectTitle, 'Was der Knoten bewirkt');

    // Ränge und Voraussetzungen: wenige Zeilen – neu bauen, wenn sich etwas ändert.
    ranksSection.hidden = view.ranks.length === 0;
    ranks.replaceChildren(
      ...view.ranks.map((r) => {
        const li = el('li', `care-item-rank-line care-rank-${r.state}`);
        const mark = el('span', 'care-item-mark', RANK_MARK[r.state]);
        mark.setAttribute('aria-hidden', 'true');
        const label = r.state === 'done' ? 'gekauft' : r.state === 'next' ? 'als Nächstes' : 'später';
        li.append(mark, srOnly(`${label}: `), el('span', 'care-item-rank-name', `Rang ${r.rank}: ${r.summary}`), el('span', 'care-item-rank-cost', `${r.cost} · ${r.stage}`));
        return li;
      }),
    );
    needsSection.hidden = view.requirements.length === 0;
    needs.replaceChildren(
      ...view.requirements.map((r) => {
        const li = el('li', r.met ? 'care-need care-need-met' : 'care-need care-need-open');
        li.dataset.need = r.key;
        const mark = el('span', 'care-item-mark', r.met ? '✓' : '✗');
        mark.setAttribute('aria-hidden', 'true');
        li.append(mark, srOnly(r.met ? 'erfüllt: ' : 'fehlt: '), el('span', 'care-need-text', r.text));
        return li;
      }),
    );

    footer.hidden = false;
    setBuyButton(buy, item.cost, item.canBuy, item.blocker);
    setText(blocker, item.blocker ?? '');
    blocker.hidden = !item.blocker;
    maxed.hidden = item.group !== 'maxed';
    wallet.hidden = item.group === 'maxed';
  }

  return {
    page,
    bookmark,
    get id() {
      return id;
    },
    opened(ref: PageRef) {
      if (ref.kind !== 'care-item') return;
      id = ref.id;
      refresh(performance.now(), true);
    },
    update(now, force) {
      // Nach einer Änderung bzw. beim Zeigen nicht auf die Drosselung warten.
      if (force) checkedAt = -Infinity;
      refresh(now);
    },
  };
}
