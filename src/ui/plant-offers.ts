/**
 * Pflanzen zur Wahl (docs/ALBUM_UI.md, A.6 #81 und D.2): Liste der Begleitpflanzen für den
 * Pflanzring – ausgelagert aus der früheren Pflanzenwahl (ohne `<dialog>`). U:Pflanze setzen
 * (`album/pages/plant-picker-page.ts`) hängt sie ein.
 *
 * Jede Zeile ist ein kleiner Zettel mit Pflanzen-Sticker (Gruppen-Emoji, G-17), Name und
 * Gruppe, Kennzahlen, Wirkungen, Vorschau, Lebensgemeinschaften und „Setzen (−x 🌰)“ bzw.
 * dem Sperrgrund. Reine Darstellung: Kosten, Vorschau und Sperrgründe kommen fertig aus dem
 * View-Model.
 *
 * Schutz vor Doppel-Eingaben: Nach „Setzen“ sind alle Knöpfe gesperrt, bis `show()` erneut
 * kommt; nach dem Aufschlagen werden Eingaben kurz ignoriert (Doppelklick auf „Pflanze setzen“).
 */
import { el } from './dom';
import { hyphenate } from './hyphenate';
import { cardSticker, communityHintList, renderCommunityHints, renderEffects, renderFacts, renderPreviewChips, tapeStrip } from './encounter-cards';
import type { PlantOfferView } from './view-model';

/** Eingaben so lange nach dem Aufschlagen ignorieren. */
const INPUT_GUARD_MS = 250;

export interface PlantOffers {
  readonly element: HTMLUListElement;
  /** Zeigt bzw. aktualisiert die Liste; baut nur bei geänderten Inhalten neu. Hebt die Sperre auf. */
  show(offers: readonly PlantOfferView[]): void;
  /** Kurze Eingabesperre (nach dem Aufschlagen). */
  guard(): void;
  /** Fokus auf die erste setzbare Pflanze; `false`, wenn es keine gibt. */
  focusFirst(): boolean;
  /** Liste leeren (beim Zurückblättern). */
  clear(): void;
}

interface RowRefs {
  offer: PlantOfferView;
  root: HTMLElement;
  button: HTMLButtonElement;
}

export function createPlantOffers(onPlant: (plantId: string) => void): PlantOffers {
  const list = el('ul', 'picker-list');
  list.setAttribute('aria-label', 'Pflanzen');

  let rows: RowRefs[] = [];
  let signature = '';
  let busy = false;
  let guardUntil = 0;

  const blocked = () => busy || performance.now() < guardUntil;

  function applyDisabled(): void {
    for (const row of rows) row.button.disabled = busy || Boolean(row.offer.card.disabledReason);
  }

  function buildRow(offer: PlantOfferView, index: number): RowRefs {
    const card = offer.card;
    const item = el('li', `picker-row family-${card.family}`);
    item.dataset.plant = card.id;
    item.style.setProperty('--card-tilt', `${index % 2 === 0 ? -0.5 : 0.6}deg`);

    const head = el('div', 'card-top picker-row-head');
    const names = el('div', 'card-names picker-row-names');
    const name = el('h3', 'card-name picker-row-name', hyphenate(card.name));
    name.id = `plant-picker-${card.id}`;
    names.append(name, el('p', 'card-band picker-row-group', card.familyLabel));
    head.append(cardSticker(card, 'plant', index), names);
    item.append(tapeStrip(), head);

    if (card.facts && card.facts.length > 0) item.append(renderFacts(card.facts));
    if (card.effects.length > 0) item.append(renderEffects(card, 'Bietet'));

    const preview = el('ul', 'card-preview');
    preview.setAttribute('aria-label', 'Vorschau');
    renderPreviewChips(preview, card.preview);
    const communities = communityHintList();
    renderCommunityHints(communities, card.preview);
    item.append(preview, communities);

    const button = el('button', 'card-choose picker-choose');
    button.type = 'button';
    button.textContent = card.disabledReason ?? `Setzen (−${offer.costLabel} 🌰)`;
    button.classList.toggle('blocked', Boolean(card.disabledReason));
    button.setAttribute(
      'aria-label',
      card.disabledReason ? `${card.name}: ${card.disabledReason}` : `${card.name} setzen für ${offer.costLabel} Samen`,
    );
    button.addEventListener('click', () => {
      if (card.disabledReason || blocked()) return;
      busy = true;
      applyDisabled();
      item.classList.add('chosen');
      onPlant(card.id);
    });
    item.append(button);
    return { offer, root: item, button };
  }

  return {
    element: list,
    show(offers) {
      busy = false;
      const next = JSON.stringify(offers);
      if (next !== signature) {
        const focusedId = rows.find((r) => r.button === document.activeElement)?.offer.card.id;
        signature = next;
        rows = offers.map(buildRow);
        list.replaceChildren(...rows.map((r) => r.root));
        if (focusedId) rows.find((r) => r.offer.card.id === focusedId && !r.offer.card.disabledReason)?.button.focus();
      }
      applyDisabled();
    },
    guard() {
      guardUntil = performance.now() + INPUT_GUARD_MS;
    },
    focusFirst() {
      const first = rows.find((r) => !r.button.disabled);
      first?.button.focus({ preventScroll: true });
      return Boolean(first);
    },
    clear() {
      busy = false;
      signature = '';
      rows = [];
      list.replaceChildren();
    },
  };
}
