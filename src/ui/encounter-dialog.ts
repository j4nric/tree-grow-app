/**
 * Kartenwahl-Dialog (Design v2, Abschnitt 11.1): eine Begegnung mit 1–3 Karten.
 *
 * Reine Darstellung: zeigt ein `EncounterView` an und meldet Entscheidungen über
 * Callbacks. Spielregeln (Kosten, Vorschau, Ersetzen) kommen fertig aus dem View-Model.
 *
 * Tastatur: Tab/Umschalt+Tab, Pfeiltasten wechseln zwischen den Karten, Enter/Leertaste
 * wählt die fokussierte Karte. Der Fokus bleibt im Dialog (modales <dialog>).
 */
import { el, srOnly } from './dom';
import { prefersReducedMotion } from './feedback';
import type { CardView, EncounterKind, EncounterView, PreviewView } from './view-model';
import {
  RARITY_LABELS,
  declineLabel,
  previewParts,
  queuedText,
  replaceHint,
  rerollLabel,
  toneSymbol,
} from './view-format';

export interface EncounterCallbacks {
  /** Karte gewählt; bei voller Nische mit der ID des Tiers, das ersetzt wird. */
  onChoose(cardIndex: number, replaceId?: string): void;
  onDecline(): void;
  onReroll(): void;
  /** Optional: Begegnung zurücklegen („Später“, auch per Escape). Fehlt er, bleibt der Dialog offen. */
  onDefer?(): void;
}

export interface EncounterDialog {
  /**
   * Zeigt (oder aktualisiert) die Begegnung. Darf wiederholt aufgerufen werden:
   * Die Karten werden nur neu aufgebaut, wenn sich ihre IDs ändern.
   */
  show(view: EncounterView, queued: number): void;
  hide(): void;
  readonly open: boolean;
}

const KIND_LABELS: Record<EncounterKind, string> = {
  animal: '🐾 Ein Tier zieht ein',
  plant: '🌱 Etwas keimt',
  event: '⛈️ Ein Ereignis',
  visitor: '🦢 Besuch auf der Durchreise',
};

interface CardRefs {
  root: HTMLElement;
  choose: HTMLButtonElement;
  previewList: HTMLElement;
  replaceText: HTMLElement | null;
  select: HTMLSelectElement | null;
}

export function createEncounterDialog(root: HTMLElement, callbacks: EncounterCallbacks): EncounterDialog {
  const dialog = el('dialog', 'encounter');
  dialog.setAttribute('aria-labelledby', 'encounter-title');
  dialog.setAttribute('aria-describedby', 'encounter-queue');

  const inner = el('div', 'encounter-inner');
  const header = el('header', 'encounter-header');
  const kind = el('p', 'encounter-kind');
  const title = el('h2', 'encounter-title');
  title.id = 'encounter-title';
  const subtitle = el('p', 'encounter-subtitle');
  const queue = el('p', 'encounter-queue');
  queue.id = 'encounter-queue';
  const queueText = el('span');
  const queuePips = el('span', 'queue-pips');
  queuePips.setAttribute('aria-hidden', 'true');
  queue.append(queuePips, queueText);
  header.append(kind, title, subtitle, queue);

  const cardsBox = el('div', 'encounter-cards');
  cardsBox.setAttribute('role', 'list');
  const swipeHint = el('p', 'encounter-swipe', '← Wischen für weitere Karten →');
  swipeHint.setAttribute('aria-hidden', 'true');

  const actions = el('div', 'encounter-actions');
  const reroll = el('button', 'encounter-button secondary');
  reroll.type = 'button';
  const decline = el('button', 'encounter-button secondary');
  decline.type = 'button';
  const later = el('button', 'encounter-button quiet', 'Später');
  later.type = 'button';
  later.hidden = !callbacks.onDefer;
  actions.append(reroll, decline, later);

  inner.append(header, cardsBox, swipeHint, actions);
  dialog.append(inner);
  root.append(dialog);

  let cards: CardRefs[] = [];
  let signature = '';
  let current: EncounterView | null = null;
  let returnFocus: HTMLElement | null = null;

  reroll.addEventListener('click', () => callbacks.onReroll());
  decline.addEventListener('click', () => callbacks.onDecline());
  later.addEventListener('click', () => callbacks.onDefer?.());

  // Escape: nur schließen, wenn „Später“ erlaubt ist – sonst bleibt die Wahl offen.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    callbacks.onDefer?.();
  });

  // Pfeiltasten springen zwischen den „Wählen“-Knöpfen der Karten.
  cardsBox.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    // Im Auswahlfeld (Ersetzen) behalten die Pfeiltasten ihre normale Bedeutung.
    if (event.target instanceof HTMLSelectElement) return;
    const buttons = cards.map((c) => c.choose);
    const index = cards.findIndex((c) => c.root.contains(document.activeElement));
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else {
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      next = index < 0 ? 0 : (index + step + buttons.length) % buttons.length;
    }
    event.preventDefault();
    focusCard(next);
  });

  function focusCard(index: number): void {
    const card = cards[index];
    if (!card) return;
    card.choose.focus({ preventScroll: true });
    card.root.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }

  function renderPreview(list: HTMLElement, preview: PreviewView): void {
    list.replaceChildren(
      ...previewParts(preview).map((part) => {
        const item = el('li', `preview-chip tone-${part.tone}`);
        const icon = el('span', 'preview-icon', part.icon);
        icon.setAttribute('aria-hidden', 'true');
        const value = el('span', 'preview-value', part.value);
        value.setAttribute('aria-hidden', 'true');
        item.append(icon, value, srOnly(part.text));
        return item;
      }),
    );
  }

  function selectedReplace(card: CardView, refs: CardRefs) {
    const options = card.replaceOptions ?? [];
    if (refs.select) return options.find((o) => o.id === refs.select!.value) ?? options[0];
    return options[0];
  }

  function buildCard(card: CardView, index: number): CardRefs {
    const rarity = card.rarity;
    const item = el(
      'article',
      `encounter-card family-${card.family}${rarity ? ` rarity-${rarity}` : ''}`,
    );
    item.setAttribute('role', 'listitem');
    item.style.setProperty('--deal-delay', `${index * 70}ms`);
    const nameId = `encounter-card-${index}-name`;

    const band = el('div', 'card-band');
    const family = el('span', 'card-family');
    const familyIcon = el('span', 'card-family-icon', card.familyIcon);
    familyIcon.setAttribute('aria-hidden', 'true');
    family.append(familyIcon, el('span', '', card.familyLabel));
    band.append(family);
    if (rarity) {
      const gem = el('span', 'card-rarity');
      const gemIcon = el('span', 'gem', '◆');
      gemIcon.setAttribute('aria-hidden', 'true');
      gem.append(gemIcon, el('span', '', RARITY_LABELS[rarity]));
      band.append(gem);
    }

    const name = el('h3', 'card-name', card.name);
    name.id = nameId;
    item.append(band, name);

    if (card.nicheLabel) {
      const niche = el('p', 'card-niche', `Nische: ${card.nicheLabel}`);
      item.append(niche);
    }

    let replaceText: HTMLElement | null = null;
    let select: HTMLSelectElement | null = null;
    if (card.nicheFull) {
      const box = el('div', 'card-replace');
      replaceText = el('p', 'card-replace-text');
      box.append(replaceText);
      const options = card.replaceOptions ?? [];
      if (options.length > 1) {
        const label = el('label', 'card-replace-label');
        label.append(el('span', '', 'Wen entlassen?'));
        select = el('select', 'card-replace-select');
        for (const option of options) {
          const opt = el('option', '', option.name);
          opt.value = option.id;
          select.append(opt);
        }
        label.append(select);
        box.append(label);
      }
      item.append(box);
    }

    if (card.conditions && card.conditions.length > 0) {
      const list = el('ul', 'card-conditions');
      list.setAttribute('aria-label', 'Bedingungen');
      for (const condition of card.conditions) {
        const li = el('li', condition.met ? 'met' : 'unmet');
        const mark = el('span', 'mark', condition.met ? '✓' : '✗');
        mark.setAttribute('aria-hidden', 'true');
        li.append(mark, el('span', '', condition.label), srOnly(condition.met ? ' (erfüllt)' : ' (fehlt)'));
        list.append(li);
      }
      item.append(list);
    }

    if (card.effects.length > 0) {
      const list = el('ul', 'card-effects');
      list.setAttribute('aria-label', 'Wirkungen');
      for (const effect of card.effects) {
        const li = el('li', `tone-${effect.tone}`);
        const mark = el('span', 'mark', toneSymbol(effect.tone));
        mark.setAttribute('aria-hidden', 'true');
        li.append(mark, el('span', '', effect.label));
        list.append(li);
      }
      item.append(list);
    }

    const previewList = el('ul', 'card-preview');
    previewList.setAttribute('aria-label', 'Vorschau');
    item.append(previewList);

    if (card.flavor) item.append(el('p', 'card-flavor', card.flavor));

    const choose = el('button', 'card-choose');
    choose.type = 'button';
    choose.setAttribute('aria-describedby', nameId);
    item.append(choose);

    const refs: CardRefs = { root: item, choose, previewList, replaceText, select };

    const refresh = () => {
      const replaced = card.nicheFull ? selectedReplace(card, refs) : undefined;
      if (replaceText) replaceText.textContent = replaceHint(card.nicheLabel ?? '', replaced?.name);
      renderPreview(previewList, replaced?.preview ?? card.preview);
      choose.textContent = card.disabledReason ?? 'Wählen';
      choose.disabled = Boolean(card.disabledReason);
      const swap = card.nicheFull && replaced ? ` (ersetzt ${replaced.name})` : '';
      choose.setAttribute('aria-label', `${card.name} wählen${swap}`);
    };
    refresh();
    select?.addEventListener('change', refresh);

    choose.addEventListener('click', () => {
      const replaced = card.nicheFull ? selectedReplace(card, refs) : undefined;
      item.classList.add('chosen');
      callbacks.onChoose(index, replaced?.id);
    });
    return refs;
  }

  function show(view: EncounterView, queued: number): void {
    current = view;
    kind.textContent = KIND_LABELS[view.kind];
    title.textContent = view.title;
    subtitle.textContent = view.subtitle ?? '';
    subtitle.hidden = !view.subtitle;

    queueText.textContent = queuedText(queued);
    queue.hidden = queued <= 0;
    queuePips.replaceChildren(...Array.from({ length: Math.min(queued, 3) }, () => el('span', 'pip')));

    const nextSignature = view.cards.map((c) => c.id).join('|');
    const rebuilt = nextSignature !== signature;
    if (rebuilt) {
      signature = nextSignature;
      cards = view.cards.map(buildCard);
      cardsBox.replaceChildren(...cards.map((c) => c.root));
      cardsBox.dataset.count = String(cards.length);
      cardsBox.scrollLeft = 0;
    }

    reroll.hidden = view.rerollCost === null;
    if (view.rerollCost !== null) {
      reroll.textContent = rerollLabel(view.rerollCost);
      reroll.disabled = !view.canReroll;
      reroll.title = view.canReroll ? '' : 'Nicht genug Samen';
    }
    decline.hidden = view.declineReward === null;
    if (view.declineReward !== null) decline.textContent = declineLabel(view.declineReward);

    if (!dialog.open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      dialog.classList.toggle('dealing', !prefersReducedMotion());
    }
    if (rebuilt) {
      const first = cards.findIndex((c) => !c.choose.disabled);
      if (first >= 0) cards[first]!.choose.focus({ preventScroll: true });
      else (reroll.hidden ? decline : reroll).focus();
    }
  }

  function hide(): void {
    if (!dialog.open) return;
    dialog.close();
    dialog.classList.remove('dealing');
    signature = '';
    current = null;
    returnFocus?.focus?.();
    returnFocus = null;
  }

  return {
    show,
    hide,
    get open() {
      return dialog.open && current !== null;
    },
  };
}
