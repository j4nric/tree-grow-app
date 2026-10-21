/**
 * Kartenwahl-Dialog (Design v2, Abschnitt 11.1): eine Begegnung mit 1–3 Karten.
 *
 * Reine Darstellung: zeigt ein `EncounterView` an und meldet Entscheidungen über
 * Callbacks. Spielregeln (Kosten, Vorschau, Ersetzen) kommen fertig aus dem View-Model.
 *
 * Tastatur: Tab/Umschalt+Tab, Pfeiltasten wechseln zwischen den wählbaren Karten,
 * Enter/Leertaste wählt die fokussierte Karte. Der Fokus bleibt im Dialog (modales <dialog>).
 *
 * Schutz vor versehentlichen Doppel-Eingaben: Nach Wählen, Ablehnen oder Neu würfeln
 * sind alle Knöpfe gesperrt, bis `show()` erneut aufgerufen wird. Erscheint eine neue
 * Begegnung, werden Eingaben kurz ignoriert (gehaltenes Enter, Doppelklick).
 */
import { el, setText, srOnly } from './dom';
import { prefersReducedMotion } from './feedback';
import type { CardView, ConditionView, EncounterKind, EncounterView, FactView, PreviewView, ReplaceOptionView } from './view-model';
import {
  RARITY_LABELS,
  declineLabel,
  preferredReplaceOption,
  previewParts,
  queuedText,
  replaceHint,
  rerollLabel,
  swapHint,
  toneSymbol,
} from './view-format';

export interface EncounterCallbacks {
  /** Karte gewählt; bei voller Nische bzw. vollem Pflanzring mit der ID dessen, was ersetzt wird. */
  onChoose(cardIndex: number, replaceId?: string): void;
  onDecline(): void;
  onReroll(): void;
  /**
   * Optional: Begegnung zurücklegen („Später“-Knopf und Escape). Wird auch gemeldet,
   * wenn der Browser den Dialog selbst schließt (z. B. zweites Escape).
   */
  onDefer?(): void;
}

export interface EncounterDialog {
  /**
   * Zeigt oder aktualisiert die Begegnung; darf wiederholt aufgerufen werden.
   * Neue Karten-IDs → neue Begegnung (Austeilen, Fokus auf erste wählbare Karte,
   * kurze Eingabesperre). Gleiche IDs, aber geänderter Inhalt → Karten werden mit dem
   * neuen Inhalt neu aufgebaut; Fokus und Ersetzen-Auswahl bleiben erhalten.
   * Jeder Aufruf hebt die Sperre nach einer Entscheidung auf.
   */
  show(view: EncounterView, queued: number): void;
  hide(): void;
  /** Kurzer Hinweis im Dialog, z. B. wenn eine Aktion nicht geklappt hat. */
  notice(text: string): void;
  readonly open: boolean;
}

const KIND_LABELS: Record<EncounterKind, string> = {
  animal: '🐾 Ein Tier zieht ein',
  plant: '🌱 Etwas keimt',
  event: '⛈️ Ein Ereignis',
  visitor: '🦢 Besuch auf der Durchreise',
};

/** Legende der Vorschau-Symbole (dieselben wie in `previewParts`) und der Haken/Kreuze. */
export const PREVIEW_LEGEND: readonly { icon: string; text: string }[] = [
  { icon: '⚖️', text: 'Harmonie – mehr Harmonie lässt alles schneller wachsen' },
  { icon: '🌿', text: 'Wachstum pro Sekunde' },
  { icon: '🌰', text: 'Samen pro Sekunde' },
  { icon: '😊', text: 'erwartete Zufriedenheit des Tiers' },
  { icon: '☀️💧', text: 'Versorgung der Pflanzen mit Licht und Wasser' },
  { icon: '✓ ✗', text: 'Futter und Wünsche erfüllt oder nicht' },
];

/**
 * Merker (unabhängig vom Spielstand): Die Legende wurde schon einmal gezeigt. Danach
 * bleibt sie zugeklappt; ohne localStorage (privater Modus) einfach jedes Mal offen.
 */
const LEGEND_SEEN_KEY = 'tree-grow-legend-seen';

function legendSeen(): boolean {
  try {
    return localStorage.getItem(LEGEND_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Schmaler Bildschirm (wie die Mobil-Ansicht im CSS). */
function narrowScreen(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
}

function markLegendSeen(): void {
  try {
    localStorage.setItem(LEGEND_SEEN_KEY, '1');
  } catch {
    // Speichern nicht möglich – dann klappt die Legende beim nächsten Mal wieder auf.
  }
}

/** So lange werden Eingaben nach dem Erscheinen einer neuen Begegnung ignoriert. */
const INPUT_GUARD_MS = 300;

/** Zähler für eindeutige IDs, falls mehrere Dialoge existieren. */
let instanceCount = 0;

interface CardRefs {
  card: CardView;
  root: HTMLElement;
  choose: HTMLButtonElement;
  select: HTMLSelectElement | null;
  selectedReplace(): ReplaceOptionView | undefined;
}

/** Kennzahlen einer Karte (z. B. Pflanzen: Wachstum, Samen, Licht, Wasser) als kleines Raster. */
export function renderFacts(facts: readonly FactView[]): HTMLElement {
  const list = el('ul', 'card-facts');
  list.setAttribute('aria-label', 'Kennzahlen');
  for (const fact of facts) {
    const li = el('li', 'card-fact');
    const label = el('span', 'card-fact-label', fact.label);
    const value = el('span', 'card-fact-value');
    const icon = el('span', 'card-fact-icon', fact.icon);
    value.append(icon, el('span', '', fact.value));
    label.setAttribute('aria-hidden', 'true');
    value.setAttribute('aria-hidden', 'true');
    li.append(label, value, srOnly(fact.text));
    list.append(li);
  }
  return list;
}

/** Bedingungen mit Haken/Kreuz und ggf. kurzer Erklärung (z. B. bei knappem Futter). */
export function renderConditions(list: HTMLElement, conditions: readonly ConditionView[]): void {
  list.replaceChildren(
    ...conditions.map((condition) => {
      const li = el('li', condition.met ? 'met' : 'unmet');
      const mark = el('span', 'mark', condition.met ? '✓' : '✗');
      mark.setAttribute('aria-hidden', 'true');
      const text = el('span', 'condition-text', condition.label);
      li.append(mark, text, srOnly(condition.met ? ' (erfüllt)' : ' (fehlt)'));
      if (condition.hint) {
        // Sichtbar statt nur als Tooltip – auf Touch-Geräten gibt es kein Hover.
        text.append(el('span', 'condition-hint', condition.hint));
        li.title = condition.hint;
      }
      return li;
    }),
  );
}

/** Vorschau-Chips (Harmonie, Wachstum, Samen, …) in eine Liste schreiben. */
export function renderPreviewChips(list: HTMLElement, preview: PreviewView): void {
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

/**
 * Lebensgemeinschaften, die die Wahl vervollständigt oder auflöst, z. B.
 * ✨ „vervollständigt Humusküche (+8 Harmonie)“ (Symbol für Screenreader verborgen).
 * Leer → Liste versteckt.
 */
export function renderCommunityHints(list: HTMLElement, preview: PreviewView): void {
  const hints = preview.communities ?? [];
  list.hidden = hints.length === 0;
  list.replaceChildren(
    ...hints.map((hint) => {
      const item = el('li', `tone-${hint.tone}`);
      const icon = el('span', 'card-community-icon', hint.icon);
      icon.setAttribute('aria-hidden', 'true');
      item.append(icon, ` ${hint.label}`);
      return item;
    }),
  );
}

/** Liste für renderCommunityHints (einmal je Karte angelegt). */
export function communityHintList(): HTMLElement {
  const list = el('ul', 'card-communities');
  list.setAttribute('aria-label', 'Lebensgemeinschaften');
  list.dataset.ref = 'card-communities';
  list.hidden = true;
  return list;
}

export function createEncounterDialog(root: HTMLElement, callbacks: EncounterCallbacks): EncounterDialog {
  const prefix = `encounter-${++instanceCount}`;
  const dialog = el('dialog', 'encounter');
  dialog.setAttribute('aria-labelledby', `${prefix}-title`);
  dialog.setAttribute('aria-describedby', `${prefix}-queue`);

  const inner = el('div', 'encounter-inner');
  const header = el('header', 'encounter-header');
  const kind = el('p', 'encounter-kind');
  const title = el('h2', 'encounter-title');
  title.id = `${prefix}-title`;
  const subtitle = el('p', 'encounter-subtitle');
  const queue = el('p', 'encounter-queue');
  queue.id = `${prefix}-queue`;
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

  const noticeBox = el('p', 'encounter-notice');
  noticeBox.setAttribute('role', 'status');
  noticeBox.hidden = true;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  // Warum Neuwürfeln gerade nicht geht – sichtbar und für Screenreader am Knopf.
  const rerollHint = el('p', 'encounter-reroll-hint');
  rerollHint.id = `${prefix}-reroll-hint`;
  rerollHint.hidden = true;
  reroll.setAttribute('aria-describedby', rerollHint.id);

  // Aufklappbare Legende der Vorschau-Symbole – beim allerersten Mal offen.
  const legend = el('details', 'encounter-legend');
  const legendSummary = el('summary', 'encounter-legend-summary');
  const legendMark = el('span', 'legend-mark', '?');
  legendMark.setAttribute('aria-hidden', 'true');
  legendSummary.append(legendMark, el('span', '', 'Was bedeuten die Symbole?'));
  const legendList = el('ul', 'encounter-legend-list');
  for (const entry of PREVIEW_LEGEND) {
    const li = el('li');
    const icon = el('span', 'legend-icon', entry.icon);
    icon.setAttribute('aria-hidden', 'true');
    li.append(icon, el('span', '', entry.text));
    legendList.append(li);
  }
  legend.append(legendSummary, legendList);
  legend.addEventListener('toggle', () => {
    if (legend.open) markLegendSeen();
  });
  let legendChecked = false;

  inner.append(header, cardsBox, swipeHint, legend, noticeBox, actions, rerollHint);
  dialog.append(inner);
  root.append(dialog);

  let cards: CardRefs[] = [];
  /** Karten-IDs der angezeigten Begegnung. */
  let idSignature = '';
  /** Vollständiger Karteninhalt – erkennt Änderungen bei gleichen IDs. */
  let contentSignature = '';
  let current: EncounterView | null = null;
  let returnFocus: HTMLElement | null = null;
  let queuedShown = -1;
  /** Nach einer Entscheidung gesperrt, bis show() erneut kommt. */
  let busy = false;
  /** Bis zu diesem Zeitpunkt (performance.now) werden Eingaben ignoriert. */
  let guardUntil = 0;

  const inputBlocked = () => busy || performance.now() < guardUntil;

  /** Führt eine Entscheidung genau einmal aus und sperrt danach alle Knöpfe. */
  function decide(action: () => void): void {
    if (inputBlocked()) return;
    busy = true;
    applyDisabled();
    action();
  }

  reroll.addEventListener('click', () => decide(() => callbacks.onReroll()));
  decline.addEventListener('click', () => decide(() => callbacks.onDecline()));
  later.addEventListener('click', () => {
    if (inputBlocked()) return;
    callbacks.onDefer?.();
  });

  // Gehaltenes Enter/Leertaste (Auto-Repeat) darf keine Karte auslösen.
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
    },
    true,
  );

  // Escape: nur „Später“, wenn erlaubt – sonst bleibt die Wahl offen.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!inputBlocked()) callbacks.onDefer?.();
  });

  // Schließt der Browser den Dialog trotzdem (z. B. zweites Escape), Zustand aufräumen.
  // `close` kommt asynchron: Nach hide() ist `current` schon null; wurde inzwischen
  // erneut show() aufgerufen, ist der Dialog wieder offen – dann nichts tun.
  dialog.addEventListener('close', () => {
    if (current === null || dialog.open) return;
    const wasShowing = current !== null;
    resetState();
    if (wasShowing) callbacks.onDefer?.();
  });

  // Pfeiltasten springen zwischen den wählbaren Karten; gesperrte werden übersprungen.
  cardsBox.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    // Im Auswahlfeld (Ersetzen) behalten die Pfeiltasten ihre normale Bedeutung.
    if (event.target instanceof HTMLSelectElement) return;
    const enabled = cards.map((c, i) => (c.choose.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    event.preventDefault();
    const index = cards.findIndex((c) => c.root.contains(document.activeElement));
    let next: number;
    if (event.key === 'Home') next = enabled[0]!;
    else if (event.key === 'End') next = enabled[enabled.length - 1]!;
    else {
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      next = enabled[0]!;
      if (index >= 0) {
        for (let k = 1; k <= cards.length; k++) {
          const candidate = (index + step * k + cards.length * k) % cards.length;
          if (!cards[candidate]!.choose.disabled) {
            next = candidate;
            break;
          }
        }
      }
    }
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

  /** Setzt `disabled` aller Knöpfe aus Sperre, Kartenzustand und Samen. */
  function applyDisabled(): void {
    for (const refs of cards) {
      refs.choose.disabled = busy || Boolean(refs.card.disabledReason);
      if (refs.select) refs.select.disabled = busy;
    }
    reroll.disabled = busy || !current?.canReroll;
    decline.disabled = busy;
    later.disabled = busy;
  }

  function buildCard(card: CardView, index: number, kind: EncounterKind, keepReplaceId?: string): CardRefs {
    const rarity = card.rarity;
    const item = el('article', `encounter-card family-${card.family}${rarity ? ` rarity-${rarity}` : ''}`);
    item.setAttribute('role', 'listitem');
    item.dataset.card = card.id;
    if (kind === 'plant') item.dataset.plant = card.id;
    else item.dataset.species = card.id;
    item.setAttribute('aria-labelledby', `${prefix}-card-${index}-name`);
    item.style.setProperty('--deal-delay', `${index * 70}ms`);

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
    name.id = `${prefix}-card-${index}-name`;
    item.append(band, name);

    if (card.nicheLabel) item.append(el('p', 'card-niche', `Nische: ${card.nicheLabel}`));
    if (card.facts && card.facts.length > 0) item.append(renderFacts(card.facts));

    const options = card.replaceOptions ?? [];
    /** Tauschbare Tiere; gesperrte Optionen (z. B. Höhlenbewohner verlören ihren Platz) bleiben sichtbar. */
    const usable = options.filter((o) => !o.disabledReason);
    let replaceText: HTMLElement | null = null;
    let select: HTMLSelectElement | null = null;
    if (card.nicheFull) {
      const box = el('div', 'card-replace');
      replaceText = el('p', 'card-replace-text');
      box.append(replaceText);
      if (options.length > 1) {
        const label = el('label', 'card-replace-label');
        label.append(el('span', '', card.replacePrompt ?? 'Wen entlassen?'));
        select = el('select', 'card-replace-select');
        for (const option of options) {
          const opt = el('option', '', option.disabledReason ? `${option.name} – ${option.disabledReason}` : option.name);
          opt.value = option.id;
          opt.disabled = Boolean(option.disabledReason);
          select.append(opt);
        }
        // Vorauswahl: eine Option, die keine Lebensgemeinschaft auflöst (falls es eine gibt).
        const preferred = preferredReplaceOption(options);
        if (preferred) select.value = preferred.id;
        if (keepReplaceId && usable.some((o) => o.id === keepReplaceId)) select.value = keepReplaceId;
        label.append(select);
        box.append(label);
      } else {
        // Nur ein Tier in der Nische: Kann es nicht weichen, steht der Grund hier.
        for (const option of options.filter((o) => o.disabledReason)) {
          box.append(el('p', 'card-replace-note', `${option.name}: ${option.disabledReason}`));
        }
      }
      item.append(box);
    }

    // Bedingungen – bei voller Nische je nach gewähltem Tausch (siehe refresh unten).
    let conditionList: HTMLElement | null = null;
    if (card.conditions && card.conditions.length > 0) {
      conditionList = el('ul', 'card-conditions');
      conditionList.setAttribute('aria-label', 'Bedingungen');
      item.append(conditionList);
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
    const communityList = communityHintList();
    item.append(previewList, communityList);

    if (card.flavor) item.append(el('p', 'card-flavor', card.flavor));

    const choose = el('button', 'card-choose');
    choose.type = 'button';
    item.append(choose);

    const selectedReplace = () =>
      card.nicheFull ? (usable.find((o) => o.id === select?.value) ?? preferredReplaceOption(options)) : undefined;

    const refresh = () => {
      const replaced = selectedReplace();
      if (replaceText) {
        replaceText.textContent = card.fullText
          ? swapHint(card.fullText, replaced?.name)
          : replaceHint(card.nicheLabel ?? '', replaced?.name);
      }
      renderPreviewChips(previewList, replaced?.preview ?? card.preview);
      renderCommunityHints(communityList, replaced?.preview ?? card.preview);
      if (conditionList) renderConditions(conditionList, replaced?.conditions ?? card.conditions ?? []);
      choose.textContent = card.disabledReason ?? 'Wählen';
      const swap = replaced ? ` (ersetzt ${replaced.name})` : '';
      choose.setAttribute('aria-label', `${card.name} wählen${swap}`);
    };
    refresh();
    select?.addEventListener('change', refresh);

    choose.addEventListener('click', () => {
      if (card.disabledReason) return;
      decide(() => {
        item.classList.add('chosen');
        callbacks.onChoose(index, selectedReplace()?.id);
      });
    });
    return { card, root: item, choose, select, selectedReplace };
  }

  function show(view: EncounterView, queued: number): void {
    current = view;
    // Kam show() direkt nach einer Entscheidung, kurz sperren: Ein zweiter Klick des
    // Doppelklicks soll nicht die nächste (evtl. gleich aussehende) Begegnung treffen.
    if (busy) guardUntil = Math.max(guardUntil, performance.now() + INPUT_GUARD_MS);
    busy = false;
    setText(kind, KIND_LABELS[view.kind]);
    setText(title, view.title);
    setText(subtitle, view.subtitle ?? '');
    subtitle.hidden = !view.subtitle;

    setText(queueText, queuedText(queued));
    queue.hidden = queued <= 0;
    const pips = Math.max(0, Math.min(queued, 3));
    if (pips !== queuedShown) {
      queuedShown = pips;
      queuePips.replaceChildren(...Array.from({ length: pips }, () => el('span', 'pip')));
    }

    const nextIds = `${view.key ?? ''}#${view.cards.map((c) => c.id).join('|')}`;
    const nextContent = JSON.stringify(view.cards);
    const newEncounter = nextIds !== idSignature;
    const contentChanged = newEncounter || nextContent !== contentSignature;

    if (contentChanged) {
      // Bei gleicher Begegnung: Fokus und Ersetzen-Auswahl über den Neuaufbau retten.
      const focusedIndex = newEncounter ? -1 : cards.findIndex((c) => c.root.contains(document.activeElement));
      const kept = new Map(newEncounter ? [] : cards.map((c) => [c.card.id, c.select?.value]));
      idSignature = nextIds;
      contentSignature = nextContent;
      cards = view.cards.map((card, i) => buildCard(card, i, view.kind, kept.get(card.id)));

      // Austeil-Animation nur für neue Begegnungen, nicht beim Aktualisieren.
      dialog.classList.remove('dealing');
      if (newEncounter && !prefersReducedMotion()) {
        void dialog.offsetWidth;
        dialog.classList.add('dealing');
      }
      cardsBox.replaceChildren(...cards.map((c) => c.root));
      cardsBox.dataset.count = String(cards.length);
      if (newEncounter) {
        clearNotice();
        cardsBox.scrollLeft = 0;
        guardUntil = performance.now() + INPUT_GUARD_MS;
      }
      applyDisabled();
      if (focusedIndex >= 0 && cards[focusedIndex] && !cards[focusedIndex].choose.disabled) {
        cards[focusedIndex].choose.focus({ preventScroll: true });
      }
    }

    reroll.hidden = view.rerollCost === null;
    if (view.rerollCost === null) rerollHint.hidden = true;
    if (view.rerollCost !== null) {
      setText(reroll, rerollLabel(view.rerollCost));
      const reason = view.canReroll ? '' : (view.rerollDisabledReason ?? 'Nicht genug Samen');
      reroll.title = reason;
      setText(rerollHint, reason ? `Neu würfeln: ${reason}` : '');
      rerollHint.hidden = !reason;
    }
    decline.hidden = view.declineReward === null;
    if (view.declineReward !== null) setText(decline, declineLabel(view.declineReward));
    applyDisabled();

    if (!legendChecked) {
      // Einmal pro Seite prüfen: Erste Begegnung überhaupt → Legende aufgeklappt zeigen.
      legendChecked = true;
      // Auf schmalen Bildschirmen bleibt sie zu (deutliches „?“), damit Karten und
      // Aktionen ohne Scrollen sichtbar sind; der Merker wird erst gesetzt, wenn sie
      // wirklich einmal offen war.
      if (!legendSeen() && !narrowScreen()) {
        legend.open = true;
        markLegendSeen();
      }
    }

    if (!dialog.open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (newEncounter || !dialog.contains(document.activeElement)) {
      const first = cards.findIndex((c) => !c.choose.disabled);
      if (first >= 0) cards[first]!.choose.focus({ preventScroll: true });
      else [reroll, decline, later].find((b) => !b.hidden && !b.disabled)?.focus();
    }
  }

  function clearNotice(): void {
    clearTimeout(noticeTimer);
    noticeBox.hidden = true;
    noticeBox.textContent = '';
  }

  function notice(text: string): void {
    clearTimeout(noticeTimer);
    noticeBox.textContent = text;
    noticeBox.hidden = false;
    noticeTimer = setTimeout(clearNotice, 4000);
  }

  function resetState(): void {
    clearNotice();
    dialog.classList.remove('dealing');
    idSignature = '';
    contentSignature = '';
    current = null;
    busy = false;
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus();
  }

  function hide(): void {
    if (!dialog.open) return;
    dialog.close();
    resetState();
  }

  return {
    show,
    hide,
    notice,
    get open() {
      return dialog.open && current !== null;
    },
  };
}
