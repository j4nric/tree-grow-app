/**
 * Reiter „Forschung“ (früher „Pflege“; docs/ALBUM_UI.md B.3, DESIGN_V2.md 27.12 und 28.9,
 * ROADMAP Phase 11, 4a). Die interne Kennung bleibt `care` (Navigation, Spielstand-unabhängig).
 *
 * - **Gerade wirksam:** aktive Boni aus Ereignissen und Gästen mit Restzeit und
 *   schrumpfendem Washi-Balken; Wirkungen bis zum Neuen Zyklus darunter. Fehlt, wenn nichts
 *   wirkt.
 * - **Plan:** Schalter „Plan des letzten Zyklus folgen“ (`meta.research.auto`) mit einer Zeile,
 *   was als Nächstes dran ist. Ohne Plan (erster Zyklus) nur ein kurzer Hinweis.
 * - **Forschungsbaum** (album/research-tree.ts) mit dem Zustand aus dem Spielstand
 *   (research-state.ts): Äste, Ebenen, Gabeln, Zeile „∞“ mit Rang-Stempel, Plan-Nummern.
 *   Erforschen mit Doppelklick-Schutz (care-buy.ts), Aufleuchten, schwebender Bestätigung und
 *   Statuszeile; der Baum hat feste Plätze, nichts sortiert um. Name → U:Forschungsknoten.
 * - Seitenkopf „⚖️ 1.234 · +110/min · 3 erforschbar“, Punkt am Reiter, wenn etwas
 *   erforschbar ist (`badge`).
 * - `reveal(id)` (von „Zur Forschung“): Ast aufklappen, Fokus auf den Namen, Aufleuchten.
 *
 * DOM einmal bauen; `update` setzt nur Texte, Klassen und Attribute (gedrosselt).
 */
import { RESEARCH_BY_ID } from '../../../content/research';
import { evaluate } from '../../../core/formulas';
import { activeBonusViews } from '../../adapters';
import { barWidth, harmonyWalletText } from '../../care-view';
import { el, setText, setVar, srOnly } from '../../dom';
import { prefersReducedMotion, restartAnimation } from '../../feedback';
import { hyphenate } from '../../hyphenate';
import { createResearchTree } from '../research-tree';
import { createResearchStateSource, researchPlanView } from '../../research-state';
import { researchHeader, type ResearchTreeState } from '../../research-view';
import type { ActiveBonusView } from '../../view-model';
import type { PageEnv, TabPage } from './registry';
import { wireBuyButton } from './care-buy';
import { createTabPanel } from './tab-pages';
import './care-page.css';

/** Zahlen (Restzeit, „Noch X ⚖️“) höchstens so oft neu – wie die übrigen Seiten. */
const REFRESH_MS = 200;

export interface CarePage extends TabPage {
  /** Knoten zeigen, Fokus auf seinen Namen, kurz aufleuchten. false, wenn es ihn nicht gibt. */
  reveal(id: string): boolean;
}

/** Leichte, feste Schräglage je Knoten (−4° … +4°) für das Symbol-Sticker (U:Forschungsknoten). */
export function careTilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 9) - 4;
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

  // --- Forschungsplan ------------------------------------------------------------------
  const plan = el('section', 'research-plan');
  plan.dataset.ref = 'research-plan';
  plan.setAttribute('aria-label', 'Forschungsplan');
  const planSwitch = el('label', 'research-plan-switch');
  const planInput = el('input');
  planInput.type = 'checkbox';
  planInput.setAttribute('role', 'switch');
  planInput.dataset.ref = 'research-auto';
  const planStatusId = 'research-plan-status';
  planInput.setAttribute('aria-describedby', planStatusId);
  planSwitch.append(planInput, el('span', 'research-plan-label', 'Plan des letzten Zyklus folgen'));
  const planStatus = el('p', 'research-plan-status');
  planStatus.id = planStatusId;
  planStatus.dataset.ref = 'research-plan-status';
  plan.append(planSwitch, planStatus);
  planInput.addEventListener('change', () => {
    deps.actions.setResearchAuto(planInput.checked);
    refresh(performance.now(), true);
  });

  // --- Forschungsbaum ------------------------------------------------------------------
  const section = el('section', 'care-measures');
  section.dataset.ref = 'care';
  section.setAttribute('aria-labelledby', 'care-measures-title');
  const listTitle = el('h3', 'care-section-title', 'Forschung');
  listTitle.id = 'care-measures-title';
  const hint = el('p', 'care-hint', 'Tippe auf einen Namen, um umzublättern.');
  // Statuszeile für Screenreader: Bestätigung nach dem Kauf (die schwebende ist verborgen).
  const status = srOnly();
  status.setAttribute('role', 'status');

  let shown: ResearchTreeState | null = null;
  let boughtText = '';
  let boughtIcon = '';
  let hadFocus = false;

  const tree = createResearchTree({
    // Im Album steht der Vorrat schon im Seitenkopf (und mobil in der Vorratsleiste).
    head: false,
    onResearch: () => undefined,
    onOpen: (id) => env.open({ kind: 'care-item', id }),
    bindAction(button, id) {
      wireBuyButton(button, {
        id: () => id,
        canBuy: () => shown?.nodes[id]?.status === 'available',
        before() {
          // Vor dem Kauf merken: Danach kann der Knopf schon verborgen sein (Fokus weg).
          hadFocus = document.activeElement === button;
          const node = RESEARCH_BY_ID.get(id);
          boughtText = node?.boughtText ?? '';
          boughtIcon = node?.icon ?? '';
        },
        buy: (researchId) => deps.actions.buyCare(researchId),
        bought: () => confirmBuy(id),
      });
    },
  });
  section.append(listTitle, hint, tree.root, status);
  page.body.append(active, plan, section);

  // --- Zustand -------------------------------------------------------------------------
  const source = createResearchStateSource();
  let checkedAt = -Infinity;
  let bonusAt = -Infinity;
  let metaText = '';

  deps.preferences.onChange(() => {
    // Zahlenformat geändert: alles neu.
    bonusKey = '';
    checkedAt = -Infinity;
    bonusAt = -Infinity;
  });

  let drawn: ResearchTreeState | null = null;

  /** Zustand neu (gedrosselt); `apply`: Baum, Kopf und Plan zeichnen, falls neu. */
  function refresh(now: number, force = false, apply = true): ResearchTreeState {
    if (force || !shown || now - checkedAt >= REFRESH_MS) {
      checkedAt = now;
      const state = deps.state();
      shown = source(state, evaluate(state));
    }
    if (apply && shown !== drawn) draw(shown);
    return shown;
  }

  function draw(next: ResearchTreeState): void {
    drawn = next;
    const state = deps.state();
    tree.update(next);
    const header = researchHeader(next);
    const text = [harmonyWalletText(state), header.count > 0 ? header.available : ''].filter(Boolean).join(' · ');
    if (text !== metaText) {
      metaText = text;
      page.setMeta(text);
    }
    const planView = researchPlanView(state, next.perMinute);
    planSwitch.hidden = !planView.hasPlan;
    if (planInput.checked !== planView.on) planInput.checked = planView.on;
    setText(planStatus, planView.status);
    plan.classList.toggle('is-on', planView.on && planView.hasPlan);
  }

  /** Bestätigung: Aufleuchten, schwebender Text über dem Knopf, Statuszeile für Screenreader. */
  function confirmBuy(id: string): void {
    refresh(performance.now(), true);
    const card = tree.card(id);
    const action = tree.action(id);
    if (card && !prefersReducedMotion()) restartAnimation(card, 'research-flash');
    // Knopf weg (einmaliger Knoten erforscht): Fokus auf den Namen statt auf body.
    if (action && hadFocus && action.hidden) tree.focusName(id);
    if (!boughtText) return;
    const text = boughtText;
    setText(status, '');
    requestAnimationFrame(() => setText(status, text));
    const anchor = action && !action.hidden ? action : card;
    const rect = anchor?.getBoundingClientRect();
    if (rect && rect.width > 0) env.float(`${boughtIcon} ${text}`, rect.left + rect.width / 2, rect.top - 6);
  }

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
    refresh(performance.now(), true);
    return tree.reveal(id);
  }

  return {
    page,
    update(now, force) {
      // Nach einer Änderung bzw. beim Zeigen nicht auf die Drosselung warten.
      if (force) bonusAt = -Infinity;
      refresh(now, force);
      updateBonuses(now);
    },
    badge(now) {
      // Nur den Zustand – gezeichnet wird, wenn der Reiter sichtbar ist (update).
      const s = refresh(now, false, false);
      return Object.values(s.nodes).some((n) => n.status === 'available');
    },
    reveal,
  };
}
