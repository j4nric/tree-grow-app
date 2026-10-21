/**
 * Auswahl „Pflanze setzen“ (Design v2, Abschnitt 4 und 11.2): Samen gegen eine
 * Begleitpflanze im Pflanzring. Ruhiger modaler Dialog im Stil des Kartenwahl-Dialogs,
 * aber als schlanke Liste – es können über ein Dutzend Pflanzen sein.
 *
 * Reine Darstellung: zeigt ein `PlantPickerView` und meldet die Wahl über einen
 * Callback. Kosten, Vorschau und Sperrgründe kommen fertig aus dem View-Model.
 *
 * Schutz vor Doppel-Eingaben wie beim Kartenwahl-Dialog: Nach „Setzen“ sind alle Knöpfe
 * gesperrt, bis `show()` erneut kommt oder der Dialog schließt.
 */
import { el, setText } from './dom';
import { hyphenate } from './hyphenate';
import { communityHintList, renderCommunityHints, renderFacts, renderPreviewChips } from './encounter-dialog';
import type { PlantOfferView, PlantPickerView } from './view-model';
import { seedsLine, toneSymbol } from './view-format';

export interface PlantPickerCallbacks {
  /** Pflanze gewählt (die Aktion selbst führt main.ts aus). */
  onPlant(plantId: string): void;
  /** Dialog geschlossen (Knopf, Escape oder Browser). */
  onClose?(): void;
}

export interface PlantPicker {
  /** Zeigt oder aktualisiert die Auswahl; baut die Liste nur bei geänderten Inhalten neu. */
  show(view: PlantPickerView, seeds: number): void;
  /** Samen-Anzeige im Kopf – darf jeden Frame laufen (nur Text). */
  updateSeeds(seeds: number): void;
  hide(): void;
  notice(text: string): void;
  readonly open: boolean;
}

/** Eingaben so lange nach dem Öffnen ignorieren (Doppelklick auf „Pflanze setzen“). */
const INPUT_GUARD_MS = 250;

interface RowRefs {
  offer: PlantOfferView;
  root: HTMLElement;
  button: HTMLButtonElement;
}

export function createPlantPicker(root: HTMLElement, callbacks: PlantPickerCallbacks): PlantPicker {
  const dialog = el('dialog', 'encounter plant-picker');
  dialog.setAttribute('aria-labelledby', 'plant-picker-title');
  dialog.setAttribute('aria-describedby', 'plant-picker-sub');
  dialog.dataset.ref = 'plant-picker';

  const inner = el('div', 'encounter-inner');
  const header = el('header', 'encounter-header');
  const kind = el('p', 'encounter-kind', '🌱 Samen in die Erde');
  const title = el('h2', 'encounter-title');
  title.id = 'plant-picker-title';
  const subtitle = el('p', 'encounter-subtitle');
  subtitle.id = 'plant-picker-sub';
  const seedsText = el('p', 'picker-seeds');
  seedsText.dataset.ref = 'picker-seeds';
  header.append(kind, title, subtitle, seedsText);

  const list = el('ul', 'picker-list');
  list.setAttribute('aria-label', 'Pflanzen');

  const noticeBox = el('p', 'encounter-notice');
  noticeBox.setAttribute('role', 'status');
  noticeBox.hidden = true;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const actions = el('div', 'encounter-actions');
  const close = el('button', 'encounter-button secondary', 'Schließen');
  close.type = 'button';
  actions.append(close);

  // Hinweise stehen in der klebenden Leiste unten – dort sind sie auch nach dem Scrollen sichtbar.
  actions.prepend(noticeBox);
  inner.append(header, list, actions);
  dialog.append(inner);
  root.append(dialog);

  let rows: RowRefs[] = [];
  let signature = '';
  let cost = 0;
  let busy = false;
  let guardUntil = 0;
  let returnFocus: HTMLElement | null = null;
  let showing = false;

  const blocked = () => busy || performance.now() < guardUntil;

  function applyDisabled(): void {
    for (const row of rows) row.button.disabled = busy || Boolean(row.offer.card.disabledReason);
    close.disabled = false;
  }

  function buildRow(offer: PlantOfferView): RowRefs {
    const card = offer.card;
    const item = el('li', `picker-row family-${card.family}`);
    item.dataset.plant = card.id;

    const head = el('div', 'picker-row-head');
    const icon = el('span', 'picker-row-icon', card.familyIcon);
    icon.setAttribute('aria-hidden', 'true');
    const names = el('div', 'picker-row-names');
    const name = el('h3', 'picker-row-name', hyphenate(card.name));
    name.id = `plant-picker-${card.id}`;
    names.append(name, el('span', 'picker-row-group', card.familyLabel));
    head.append(icon, names);
    item.append(head);

    if (card.facts && card.facts.length > 0) item.append(renderFacts(card.facts));

    if (card.effects.length > 0) {
      const effects = el('ul', 'card-effects');
      effects.setAttribute('aria-label', 'Bietet');
      for (const effect of card.effects) {
        const li = el('li', `tone-${effect.tone}`);
        const mark = el('span', 'mark', toneSymbol(effect.tone));
        mark.setAttribute('aria-hidden', 'true');
        li.append(mark, el('span', '', effect.label));
        effects.append(li);
      }
      item.append(effects);
    }

    const preview = el('ul', 'card-preview');
    preview.setAttribute('aria-label', 'Vorschau');
    renderPreviewChips(preview, card.preview);
    const communities = communityHintList();
    renderCommunityHints(communities, card.preview);
    item.append(preview, communities);

    const button = el('button', 'card-choose picker-choose');
    button.type = 'button';
    button.textContent = card.disabledReason ?? `Setzen (−${offer.costLabel} 🌰)`;
    button.setAttribute(
      'aria-label',
      card.disabledReason
        ? `${card.name}: ${card.disabledReason}`
        : `${card.name} setzen für ${offer.costLabel} Samen`,
    );
    button.addEventListener('click', () => {
      if (card.disabledReason || blocked()) return;
      busy = true;
      applyDisabled();
      item.classList.add('chosen');
      callbacks.onPlant(card.id);
    });
    item.append(button);
    return { offer, root: item, button };
  }

  close.addEventListener('click', () => hide());

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    hide();
  });

  // Schließt der Browser den Dialog selbst, trotzdem aufräumen.
  dialog.addEventListener('close', () => {
    if (!showing || dialog.open) return;
    finish();
  });

  function show(view: PlantPickerView, seeds: number): void {
    busy = false;
    cost = view.cost;
    setText(title, view.title);
    setText(subtitle, view.subtitle);
    updateSeeds(seeds);

    const next = JSON.stringify(view.offers);
    const opening = !dialog.open;
    if (next !== signature) {
      const focusedId = rows.find((r) => r.button === document.activeElement)?.offer.card.id;
      signature = next;
      rows = view.offers.map(buildRow);
      list.replaceChildren(...rows.map((r) => r.root));
      if (focusedId) rows.find((r) => r.offer.card.id === focusedId && !r.offer.card.disabledReason)?.button.focus();
    }
    applyDisabled();

    if (opening) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      showing = true;
      clearNotice();
      dialog.showModal();
      dialog.scrollTop = 0;
      guardUntil = performance.now() + INPUT_GUARD_MS;
      const first = rows.find((r) => !r.button.disabled);
      (first?.button ?? close).focus({ preventScroll: true });
    }
  }

  function updateSeeds(seeds: number): void {
    setText(seedsText, seedsLine(seeds, cost));
    seedsText.classList.toggle('short', seeds < cost);
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

  function finish(): void {
    showing = false;
    busy = false;
    signature = '';
    rows = [];
    list.replaceChildren();
    clearNotice();
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected && !target.hidden) target.focus({ preventScroll: true });
    callbacks.onClose?.();
  }

  function hide(): void {
    if (!dialog.open) return;
    dialog.close();
    finish();
  }

  return {
    show,
    updateSeeds,
    hide,
    notice,
    get open() {
      return dialog.open;
    },
  };
}
