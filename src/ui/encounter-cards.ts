/**
 * Begegnungs-Karten (docs/ALBUM_UI.md, A.6 #68–79 und D.2): Kartenaufbau und Eingabeschutz
 * der früheren Kartenwahl – jetzt ohne `<dialog>`. U:Begegnung (`album/pages/encounter-page.ts`)
 * und die UI-Demo hängen das „Blatt“ ein.
 *
 * - **Tier- und Pflanzenkarten** sind Sticker-Karten im Notizzettel-Stil: Washi-Streifen,
 *   runder Sticker (Renderer-Zeichnung bzw. Gruppen-Emoji), Name in Caveat, Nische,
 *   Wildwechsel-Zeile, Kennzahlen, Tausch bei voller Nische, Vorschau, Lebensgemeinschaften
 *   und „Einkleben“ – danach die Einzelheiten (Bedingungen, Wirkungen, Naturtext). So liegt
 *   der Knopf auch bei langen Karten (Spätspiel, volle Nische) ohne Scrollen im Bild
 *   (Playtest Schritt 14, S1); die Karten stehen immer in einer Reihe (zu breit: wischen).
 * - **Ereignis- und Gast-Optionen** sind große Knöpfe mit Wirkungszeile; gesperrte Optionen
 *   per `aria-disabled` (fokussierbar, Grund vorlesbar).
 * - **Legende** der Symbole als Haftnotiz am „?“-Knopf; beim allerersten Mal öffnet sie sich
 *   von selbst – auch auf dem Handy (dort sähe man ⚖️ 🌿 🌰 😊 sonst nie erklärt).
 *
 * Reine Darstellung: zeigt ein `EncounterView` und meldet Entscheidungen über Callbacks.
 * Spielregeln (Kosten, Vorschau, Ersetzen) kommen fertig aus dem View-Model.
 *
 * Tastatur: Pfeiltasten, Pos1 und Ende wechseln zwischen den Karten; gehaltenes Enter löst
 * nichts aus. Schutz vor Doppel-Eingaben: Nach Wählen, Ablehnen oder Neu würfeln sind alle
 * Knöpfe gesperrt, bis `show()` erneut kommt; eine neue Begegnung sperrt Eingaben kurz.
 */
import { el, setAttr, setText, srOnly } from './dom';
import { prefersReducedMotion, restartAnimation } from './feedback';
import { hyphenate } from './hyphenate';
import { WILDWECHSEL_ICON } from './wildwechsel-view';
import type { CardView, ConditionView, EncounterKind, EncounterView, FactView, PreviewView, ReplaceOptionView } from './view-model';
import {
  NO_CHANGE_TEXT,
  RARITY_LABELS,
  declineLabel,
  legendEntries,
  preferredReplaceOption,
  hasPreviewChanges,
  previewChips,
  previewParts,
  queuedText,
  replaceHint,
  rerollLabel,
  swapHint,
  toneSymbol,
} from './view-format';
import { createNote, attachNote, type Note } from './album/note';
import { createStickerImage } from './album/sticker';
import { stickerTilt } from './album/sticker-rules';
import './album/sticker.css';
import './album/encounter-cards.css';

export interface EncounterCallbacks {
  /** Karte gewählt; bei voller Nische bzw. vollem Pflanzring mit der ID dessen, was ersetzt wird. */
  onChoose(cardIndex: number, replaceId?: string): void;
  onDecline(): void;
  onReroll(): void;
}

/** Knopftext auf Tier- und Pflanzenkarten (statt „Wählen“, docs/ALBUM_UI.md A.6 #69). */
export const CHOOSE_TEXT = 'Einkleben';

/** Frage über der Ersetzen-Auswahl bei voller Nische (früher „Wen entlassen?“, Playtest K6). */
export const REPLACE_PROMPT = 'Wer zieht weiter?';

/** Kantenlänge des Stickers auf einer Karte. */
const CARD_STICKER_SIZE = 64;

const KIND_LABELS: Record<EncounterKind, { icon: string; text: string }> = {
  animal: { icon: '🐾', text: 'Ein Tier zieht ein' },
  plant: { icon: '🌱', text: 'Etwas keimt' },
  event: { icon: '⛈️', text: 'Ein Ereignis' },
  visitor: { icon: '🦢', text: 'Besuch auf der Durchreise' },
};

/**
 * Merker (unabhängig vom Spielstand): Die Legende wurde schon einmal gezeigt. Danach
 * öffnet sie sich nicht mehr von selbst; ohne localStorage (privater Modus) jedes Mal.
 */
export const LEGEND_SEEN_KEY = 'tree-grow-legend-seen';

function legendSeen(): boolean {
  try {
    return localStorage.getItem(LEGEND_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markLegendSeen(): void {
  try {
    localStorage.setItem(LEGEND_SEEN_KEY, '1');
  } catch {
    // Speichern nicht möglich – dann öffnet sich die Legende beim nächsten Mal wieder.
  }
}

/** So lange werden Eingaben nach dem Erscheinen einer neuen Begegnung ignoriert. */
const INPUT_GUARD_MS = 300;

/** Zähler für eindeutige IDs, falls mehrere Blätter existieren. */
let instanceCount = 0;

// --- Bausteine (auch für die Pflanzenwahl) -------------------------------------------------

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

/** Bedingungen mit Haken/Kreuz (~ = nur teilweise, z. B. knappes Futter) und ggf. kurzer Erklärung. */
export function renderConditions(list: HTMLElement, conditions: readonly ConditionView[]): void {
  list.replaceChildren(
    ...conditions.map((condition) => {
      const state = condition.met ? (condition.partial ? 'partial' : 'met') : 'unmet';
      const li = el('li', state);
      const mark = el('span', 'mark', state === 'met' ? '✓' : state === 'partial' ? '~' : '✗');
      mark.setAttribute('aria-hidden', 'true');
      const text = el('span', 'condition-text', condition.label);
      li.append(mark, text, srOnly(state === 'met' ? ' (erfüllt)' : state === 'partial' ? ' (teilweise)' : ' (fehlt)'));
      if (condition.hint) {
        // Sichtbar statt nur als Tooltip – auf Touch-Geräten gibt es kein Hover.
        text.append(el('span', 'condition-hint', condition.hint));
        li.title = condition.hint;
      }
      return li;
    }),
  );
}

/**
 * Vorschau-Chips (Harmonie, Wachstum, Samen, …) in eine Liste schreiben. Ändert die Wahl
 * nichts, steht vorn ein neutraler Chip „keine Änderung“.
 */
export function renderPreviewChips(list: HTMLElement, preview: PreviewView): void {
  list.replaceChildren(
    ...previewChips(preview).map((part) => {
      if (part === 'none') {
        const item = el('li', 'preview-chip tone-neutral preview-none');
        const value = el('span', 'preview-value', 'keine Änderung');
        value.setAttribute('aria-hidden', 'true');
        item.append(value, srOnly(NO_CHANGE_TEXT));
        return item;
      }
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
 * ✨ „vervollständigt Humusküche (+8 Harmonie)“. Leer → Liste versteckt.
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

/** Wirkungen mit Ton-Zeichen (▲ / • / ▼). */
export function renderEffects(card: CardView, label: string): HTMLElement {
  const list = el('ul', 'card-effects');
  list.setAttribute('aria-label', label);
  for (const effect of card.effects) {
    const li = el('li', `tone-${effect.tone}`);
    const mark = el('span', 'mark', toneSymbol(effect.tone));
    mark.setAttribute('aria-hidden', 'true');
    li.append(mark, el('span', '', effect.label));
    list.append(li);
  }
  return list;
}

/**
 * Runder Sticker einer Karte: Tiere mit der Renderer-Zeichnung, Pflanzen mit dem
 * Gruppen-Emoji (G-17). Die Neigung ist fest je Art und Platz.
 */
export function cardSticker(card: CardView, kind: 'animal' | 'plant', index: number): HTMLElement {
  const sticker = el('span', 'sticker enc-sticker');
  sticker.setAttribute('aria-hidden', 'true');
  sticker.dataset.family = card.family;
  sticker.dataset.rarity = card.rarity ?? 'common';
  sticker.dataset.happy = 'plant';
  sticker.style.setProperty('--tilt', `${stickerTilt(card.id, index)}deg`);
  const face = el('span', 'sticker-face');
  if (kind === 'animal') {
    const image = createStickerImage(CARD_STICKER_SIZE);
    image.draw(card.id, 'color', card.family);
    face.append(image.element);
  } else {
    face.append(el('span', 'sticker-emoji', card.familyIcon));
  }
  sticker.append(face, el('span', 'sticker-gem', '◆'));
  return sticker;
}

/** Washi-Streifen oben auf einem Zettel (Zierde). */
export function tapeStrip(): HTMLElement {
  const tape = el('span', 'enc-tape');
  tape.setAttribute('aria-hidden', 'true');
  return tape;
}

// --- Blatt ------------------------------------------------------------------------------

interface CardRefs {
  card: CardView;
  /** Options-Karte: gesperrt per aria-disabled (fokussierbar, Grund vorlesbar) statt `disabled`. */
  soft: boolean;
  root: HTMLElement;
  choose: HTMLButtonElement;
  select: HTMLSelectElement | null;
}

export interface EncounterSheetOptions {
  /** Überschrift der Begegnung (z. B. die Seitenüberschrift); sonst eine eigene h2. */
  title?: HTMLElement;
}

export interface EncounterSheet {
  /** Kopf als Zettel: Art, Titel, Untertitel, Bild-Symbol, Eckdaten, Warteschlange. */
  readonly head: HTMLElement;
  /** Karten, Wisch-Hinweis, Knöpfe „Neu würfeln“ und „Ablehnen“. */
  readonly element: HTMLElement;
  /** „?“-Knopf mit der Legende als Haftnotiz. */
  readonly legend: Note;
  /**
   * Zeigt oder aktualisiert die Begegnung; darf wiederholt aufgerufen werden. Neue
   * Karten-IDs (bzw. `view.key`) → neue Begegnung (Austeilen, kurze Eingabesperre; Rückgabe
   * `true`). Gleiche IDs, geänderter Inhalt → Karten neu, Fokus und Tausch-Auswahl bleiben.
   * Jeder Aufruf hebt die Sperre nach einer Entscheidung auf.
   */
  show(view: EncounterView, queued: number): boolean;
  /** Fokus auf die erste wählbare Karte (sonst den ersten Knopf); `false`, wenn es keinen gibt. */
  focusFirst(): boolean;
  /** Legende beim allerersten Mal von selbst öffnen (erst, wenn das Blatt ruhig sichtbar ist). */
  revealLegendOnce(): void;
  /** Aufräumen beim Schließen: Notiz zu, Merker zurück. */
  clear(): void;
}

export function createEncounterSheet(callbacks: EncounterCallbacks, options: EncounterSheetOptions = {}): EncounterSheet {
  const prefix = `encounter-${++instanceCount}`;

  // --- Kopf als Zettel ---------------------------------------------------------------------
  const head = el('div', 'enc-head');
  const heroIcon = el('span', 'encounter-hero-icon');
  heroIcon.setAttribute('aria-hidden', 'true');
  heroIcon.hidden = true;
  const kind = el('p', 'encounter-kind');
  const title = options.title ?? el('h2', 'encounter-title');
  title.classList.add('encounter-title');
  const subtitle = el('p', 'encounter-subtitle');
  const factList = el('ul', 'encounter-facts');
  factList.setAttribute('aria-label', 'Eckdaten');
  factList.hidden = true;
  let factsShown = '';
  const queue = el('p', 'encounter-queue');
  queue.id = `${prefix}-queue`;
  queue.dataset.ref = 'encounter-queue';
  const queueText = el('span');
  const queuePips = el('span', 'queue-pips');
  queuePips.setAttribute('aria-hidden', 'true');
  queue.append(queuePips, queueText);
  // Wildwechsel (24.6): Am Handy liegt die Karte oft rechts außerhalb – der Kopf nennt sie
  // (Playtest Phase 7, K4), die Reihe rollt sie ins Bild.
  const routeHint = el('p', 'encounter-route-hint');
  routeHint.dataset.ref = 'encounter-route-hint';
  routeHint.hidden = true;
  const headText = el('div', 'encounter-head-text');
  headText.append(kind, title, subtitle, routeHint, factList, queue);

  // Legende der Symbole: „?“-Knopf mit Haftnotiz (A.6 #75).
  const legendButton = el('button', 'enc-legend-button');
  legendButton.type = 'button';
  legendButton.dataset.ref = 'encounter-legend-open';
  legendButton.setAttribute('aria-label', 'Was bedeuten die Symbole?');
  legendButton.title = 'Was bedeuten die Symbole?';
  legendButton.textContent = '?';
  const legend = createNote({ id: `${prefix}-legend`, title: 'Was bedeuten die Symbole?', ref: 'encounter-legend' });
  const legendList = el('ul', 'encounter-legend-list');
  legend.body.append(legendList);
  attachNote(legendButton, legend);
  legendButton.addEventListener('click', () => markLegendSeen());
  /** Schlüssel der gezeigten Legenden-Einträge – neu gebaut nur bei Änderung. */
  let legendShown = '';
  let legendChecked = false;
  let legendWanted = false;

  head.append(tapeStrip(), heroIcon, headText, legendButton);

  // --- Karten und Knöpfe -------------------------------------------------------------------
  const element = el('div', 'enc-sheet');
  const cardsBox = el('div', 'encounter-cards');
  cardsBox.setAttribute('role', 'list');
  // Waagerechtes Wischen gehört hier den Karten, nicht dem Zurückblättern (C.2).
  cardsBox.dataset.noSwipe = '';
  const swipeHint = el('p', 'encounter-swipe', '← Wischen für weitere Karten →');
  swipeHint.setAttribute('aria-hidden', 'true');

  const actions = el('div', 'encounter-actions');
  const reroll = el('button', 'encounter-button enc-reroll');
  reroll.type = 'button';
  reroll.dataset.ref = 'encounter-reroll';
  const decline = el('button', 'encounter-button enc-decline');
  decline.type = 'button';
  decline.dataset.ref = 'encounter-decline';
  actions.append(reroll, decline);
  // Warum Neuwürfeln gerade nicht geht – sichtbar und für Screenreader am Knopf.
  const rerollHint = el('p', 'encounter-reroll-hint');
  rerollHint.id = `${prefix}-reroll-hint`;
  rerollHint.hidden = true;
  reroll.setAttribute('aria-describedby', rerollHint.id);

  element.append(cardsBox, swipeHint, actions, rerollHint);

  let cards: CardRefs[] = [];
  /** Karten-IDs der angezeigten Begegnung. */
  let idSignature = '';
  /** Vollständiger Karteninhalt – erkennt Änderungen bei gleichen IDs. */
  let contentSignature = '';
  let current: EncounterView | null = null;
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

  // Gehaltenes Enter/Leertaste (Auto-Repeat) darf keine Karte auslösen.
  element.addEventListener(
    'keydown',
    (event) => {
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
    },
    true,
  );

  // Pfeiltasten springen zwischen den Karten; gesperrte Tierkarten werden übersprungen.
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

  /**
   * Liegt die Wildwechsel-Karte außerhalb der Reihe (schmale Ansicht), rollt die Reihe sie ins
   * Bild – sofort, ohne Gleiten (das Austeilen bewegt die Karten schon). Breit passt alles, dann
   * bleibt die Reihe am Anfang.
   */
  function revealRoutedCard(): void {
    const index = cards.findIndex((c) => c.card.route);
    if (index <= 0) return;
    requestAnimationFrame(() => {
      const root = cards[index]?.root;
      const first = cards[0]?.root;
      if (!root?.isConnected || !first || cardsBox.scrollWidth <= cardsBox.clientWidth) return;
      // offsetLeft misst ohne die Drehung des Austeilens.
      const start = root.offsetLeft - first.offsetLeft;
      if (start + root.offsetWidth <= cardsBox.clientWidth) return;
      cardsBox.scrollLeft = start;
    });
  }

  function focusCard(index: number): void {
    const card = cards[index];
    if (!card) return;
    card.choose.focus({ preventScroll: true });
    card.root.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }

  /** Setzt `disabled` aller Knöpfe aus Sperre, Kartenzustand und Samen. */
  function applyDisabled(): void {
    for (const refs of cards) {
      const blocked = Boolean(refs.card.disabledReason);
      refs.choose.disabled = busy || (blocked && !refs.soft);
      if (refs.soft) {
        if (blocked) refs.choose.setAttribute('aria-disabled', 'true');
        else refs.choose.removeAttribute('aria-disabled');
      }
      if (refs.select) refs.select.disabled = busy;
    }
    reroll.disabled = busy || !current?.canReroll;
    decline.disabled = busy;
  }

  /**
   * Ereignis-Option bzw. Wahl beim Gast: die ganze Karte ist ein großer Knopf mit dem Text
   * der Option und darunter der Wirkungszeile („+30 % 🌿 für 6 Min.“); Vorschau und
   * Lebensgemeinschaften stehen unter dem Knopf.
   */
  function buildOptionCard(card: CardView, index: number): CardRefs {
    const item = el('article', `encounter-card option-card family-${card.family}`);
    item.setAttribute('role', 'listitem');
    item.dataset.card = card.id;
    item.dataset.option = card.id;
    item.setAttribute('aria-labelledby', `${prefix}-card-${index}-name`);
    item.style.setProperty('--deal-delay', `${index * 70}ms`);
    item.style.setProperty('--card-tilt', `${index % 2 === 0 ? -0.6 : 0.7}deg`);

    const choose = el('button', 'card-choose option-choose');
    choose.type = 'button';
    const label = el('span', 'option-label', card.chooseLabel ?? card.name);
    label.id = `${prefix}-card-${index}-name`;
    const effects = el('span', 'option-effects');
    effects.id = `${prefix}-card-${index}-effects`;
    for (const effect of card.effects) {
      const line = el('span', `option-effect tone-${effect.tone}`);
      const mark = el('span', 'mark', toneSymbol(effect.tone));
      mark.setAttribute('aria-hidden', 'true');
      line.append(mark, el('span', '', effect.label));
      effects.append(line);
    }
    choose.append(label, effects);
    if (card.disabledReason) choose.append(el('span', 'option-reason', card.disabledReason));
    const base = card.chooseLabel ?? card.name;
    choose.setAttribute('aria-label', card.disabledReason ? `${base} – gesperrt: ${card.disabledReason}` : base);

    const previewList = el('ul', 'card-preview');
    previewList.setAttribute('aria-label', 'Vorschau');
    previewList.id = `${prefix}-card-${index}-preview`;
    // Ändert die Wahl an den Raten nichts (z. B. Samen sofort), bleibt die Vorschau weg.
    const changes = hasPreviewChanges(previewParts(card.preview));
    if (changes) renderPreviewChips(previewList, card.preview);
    previewList.hidden = !changes;
    const communityList = communityHintList();
    renderCommunityHints(communityList, card.preview);
    choose.setAttribute(
      'aria-describedby',
      [effects.id, previewList.id, card.note ? `${prefix}-card-${index}-note` : ''].filter(Boolean).join(' '),
    );
    item.append(choose, previewList, communityList);
    if (card.note) {
      const note = el('p', 'option-note', card.note);
      note.id = `${prefix}-card-${index}-note`;
      note.dataset.ref = 'card-note';
      item.append(note);
    }

    choose.addEventListener('click', () => {
      if (card.disabledReason) return;
      decide(() => {
        item.classList.add('chosen');
        callbacks.onChoose(index);
      });
    });
    return { card, root: item, choose, select: null, soft: true };
  }

  function buildCard(card: CardView, index: number, encounterKind: EncounterKind, keepReplaceId?: string): CardRefs {
    if (encounterKind === 'event' || encounterKind === 'visitor') return buildOptionCard(card, index);
    const rarity = card.rarity;
    const item = el('article', `encounter-card sticker-card family-${card.family}${rarity ? ` rarity-${rarity}` : ''}`);
    item.setAttribute('role', 'listitem');
    item.dataset.card = card.id;
    if (encounterKind === 'plant') item.dataset.plant = card.id;
    else item.dataset.species = card.id;
    item.setAttribute('aria-labelledby', `${prefix}-card-${index}-name`);
    item.style.setProperty('--deal-delay', `${index * 70}ms`);
    item.style.setProperty('--card-tilt', `${[-1.2, 0.9, -0.5][index % 3]}deg`);

    // Kopf: Sticker, Name, Gattung · Seltenheit, Nische
    const top = el('div', 'card-top');
    const names = el('div', 'card-names');
    const shown = hyphenate(card.name);
    const name = el('h3', 'card-name', shown);
    name.id = `${prefix}-card-${index}-name`;
    // Ziel von aria-labelledby: Screenreader bekommen den Namen ohne weiche Trennstellen.
    if (shown !== card.name) name.setAttribute('aria-label', card.name);
    const band = el('p', 'card-band');
    const familyIcon = el('span', 'card-family-icon', card.familyIcon);
    familyIcon.setAttribute('aria-hidden', 'true');
    band.append(familyIcon, el('span', 'card-family', card.familyLabel));
    if (rarity) {
      const gem = el('span', `card-rarity rarity-${rarity}`);
      gem.append(el('span', '', RARITY_LABELS[rarity]));
      band.append(gem);
    }
    names.append(name, band);
    // Bei voller Nische nennt der Tausch-Kasten die Nische schon – eine Zeile weniger (S1).
    if (card.nicheLabel && !card.nicheFull) names.append(el('p', 'card-niche', `Nische: ${card.nicheLabel}`));
    top.append(cardSticker(card, encounterKind === 'plant' ? 'plant' : 'animal', index), names);
    item.append(tapeStrip(), top);

    let routeId = '';
    if (card.route) {
      // Wildwechsel: Symbol nur als Zierde, für Screenreader „Wildwechsel:“ als Text davor.
      const route = el('p', 'card-route');
      route.dataset.ref = 'card-route';
      routeId = `${prefix}-card-${index}-route`;
      route.id = routeId;
      const deer = el('span', 'card-route-icon', WILDWECHSEL_ICON);
      deer.setAttribute('aria-hidden', 'true');
      route.append(deer, srOnly('Wildwechsel: '), el('span', '', card.route));
      item.classList.add('wildwechsel');
      item.append(route);
    }
    if (card.facts && card.facts.length > 0) item.append(renderFacts(card.facts));

    const replaceOptions = card.replaceOptions ?? [];
    /** Tauschbare Tiere; gesperrte Optionen (z. B. Höhlenbewohner verlören ihren Platz) bleiben sichtbar. */
    const usable = replaceOptions.filter((o) => !o.disabledReason);
    let replaceText: HTMLElement | null = null;
    let select: HTMLSelectElement | null = null;
    if (card.nicheFull) {
      const box = el('div', 'card-replace');
      if (replaceOptions.length > 1) {
        // Kompakt: „Nische voll“ und die Frage in einer Beschriftung, darunter die Auswahl –
        // wer ersetzt wird, zeigt die Auswahl selbst (und das aria-label von „Einkleben“).
        const label = el('label', 'card-replace-label');
        const full = el('span', 'card-replace-text', card.fullText ?? replaceHint(card.nicheLabel ?? '', undefined));
        label.append(full, '. ', el('span', 'card-replace-prompt', card.replacePrompt ?? REPLACE_PROMPT));
        select = el('select', 'card-replace-select');
        for (const option of replaceOptions) {
          const opt = el('option', '', option.disabledReason ? `${option.name} – ${option.disabledReason}` : option.name);
          opt.value = option.id;
          opt.disabled = Boolean(option.disabledReason);
          select.append(opt);
        }
        // Vorauswahl: eine Option, die keine Lebensgemeinschaft auflöst (falls es eine gibt).
        const preferred = preferredReplaceOption(replaceOptions);
        if (preferred) select.value = preferred.id;
        if (keepReplaceId && usable.some((o) => o.id === keepReplaceId)) select.value = keepReplaceId;
        label.append(select);
        box.append(label);
      } else {
        replaceText = el('p', 'card-replace-text');
        box.append(replaceText);
        // Nur ein Tier in der Nische: Kann es nicht weichen, steht der Grund hier.
        for (const option of replaceOptions.filter((o) => o.disabledReason)) {
          box.append(el('p', 'card-replace-note', `${option.name}: ${option.disabledReason}`));
        }
      }
      item.append(box);
    }

    // Erst das Wesentliche und der Knopf, dann die Einzelheiten (S1: Knopf ohne Scrollen).
    const previewList = el('ul', 'card-preview');
    previewList.setAttribute('aria-label', 'Vorschau');
    const communityList = communityHintList();
    const choose = el('button', 'card-choose');
    choose.type = 'button';
    item.append(previewList, communityList, choose);

    // Bedingungen – bei voller Nische je nach gewähltem Tausch.
    let conditionList: HTMLElement | null = null;
    if (card.conditions && card.conditions.length > 0) {
      conditionList = el('ul', 'card-conditions');
      conditionList.setAttribute('aria-label', 'Bedingungen');
      item.append(conditionList);
    }
    if (card.effects.length > 0) item.append(renderEffects(card, 'Wirkungen'));
    if (card.flavor) item.append(el('p', 'card-flavor', card.flavor));

    const selectedReplace = (): ReplaceOptionView | undefined =>
      card.nicheFull ? (usable.find((o) => o.id === select?.value) ?? preferredReplaceOption(replaceOptions)) : undefined;

    const refresh = () => {
      const replaced = selectedReplace();
      if (replaceText) {
        replaceText.textContent = card.fullText ? swapHint(card.fullText, replaced?.name) : replaceHint(card.nicheLabel ?? '', replaced?.name);
      }
      renderPreviewChips(previewList, replaced?.preview ?? card.preview);
      renderCommunityHints(communityList, replaced?.preview ?? card.preview);
      if (conditionList) renderConditions(conditionList, replaced?.conditions ?? card.conditions ?? []);
      choose.textContent = card.disabledReason ?? card.chooseLabel ?? CHOOSE_TEXT;
      choose.classList.toggle('blocked', Boolean(card.disabledReason));
      const swap = replaced ? ` (ersetzt ${replaced.name})` : '';
      // Der Sperrgrund gehört ins aria-label – der sichtbare Text allein reicht Screenreadern nicht.
      const base = card.chooseLabel ?? `${card.name} einkleben${swap}`;
      choose.setAttribute('aria-label', card.disabledReason ? `${base} – gesperrt: ${card.disabledReason}` : base);
    };
    refresh();
    if (routeId) choose.setAttribute('aria-describedby', routeId);
    select?.addEventListener('change', refresh);

    choose.addEventListener('click', () => {
      if (card.disabledReason) return;
      decide(() => {
        item.classList.add('chosen');
        callbacks.onChoose(index, selectedReplace()?.id);
      });
    });
    return { card, root: item, choose, select, soft: false };
  }

  /** Nur die Symbole erklären, die in dieser Begegnung vorkommen; sonst „?“ ausblenden. */
  function updateLegend(view: EncounterView): void {
    const entries = legendEntries(view);
    const key = entries.map((e) => e.key).join('|');
    legendButton.hidden = entries.length === 0;
    if (legendButton.hidden && legend.isOpen) legend.hide();
    if (key === legendShown) return;
    legendShown = key;
    legendList.replaceChildren(
      ...entries.map((entry) => {
        const li = el('li');
        li.dataset.legend = entry.key;
        const icon = el('span', 'legend-icon', entry.icon);
        icon.setAttribute('aria-hidden', 'true');
        li.append(icon, el('span', '', entry.text));
        return li;
      }),
    );
    if (legend.isOpen) legend.position();
  }

  function show(view: EncounterView, queued: number): boolean {
    current = view;
    // Kam show() direkt nach einer Entscheidung, kurz sperren: Ein zweiter Klick des
    // Doppelklicks soll nicht die nächste (evtl. gleich aussehende) Begegnung treffen.
    if (busy) guardUntil = Math.max(guardUntil, performance.now() + INPUT_GUARD_MS);
    busy = false;
    // Mit großem Bild-Symbol im Kopf entfällt das kleine Symbol vor „Ein Ereignis“.
    const kindLabel = KIND_LABELS[view.kind];
    setText(kind, view.icon ? kindLabel.text : `${kindLabel.icon} ${kindLabel.text}`);
    setText(title, view.title);
    setText(subtitle, view.subtitle ?? '');
    subtitle.hidden = !view.subtitle;
    const routed = view.cards.find((c) => c.route);
    setText(routeHint, routed ? `${WILDWECHSEL_ICON} Wildwechsel: ${routed.name} ${routed.route}` : '');
    routeHint.hidden = !routed;
    setText(heroIcon, view.icon ?? '');
    heroIcon.hidden = !view.icon;
    head.classList.toggle('has-hero', Boolean(view.icon));
    setAttr(head, 'data-kind', view.kind);
    const facts = view.facts ?? [];
    if (facts.join('|') !== factsShown) {
      factsShown = facts.join('|');
      factList.replaceChildren(...facts.map((fact) => el('li', '', fact)));
    }
    factList.hidden = facts.length === 0;

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
      cardsBox.replaceChildren(...cards.map((c) => c.root));
      cardsBox.dataset.count = String(cards.length);
      // Ereignis- und Gast-Optionen stehen untereinander (kein Wischen).
      cardsBox.dataset.kind = view.kind;
      element.dataset.kind = view.kind;
      // Austeilen nur für neue Begegnungen, nicht beim Aktualisieren.
      if (newEncounter) {
        if (!prefersReducedMotion()) restartAnimation(cardsBox, 'dealing');
        cardsBox.scrollLeft = 0;
        guardUntil = performance.now() + INPUT_GUARD_MS;
        revealRoutedCard();
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
    actions.hidden = reroll.hidden && decline.hidden;
    applyDisabled();

    updateLegend(view);
    // Erste Begegnung überhaupt → Legende öffnet sich von selbst (sobald das Blatt ruhig
    // liegt), auch auf dem Handy. Der Merker kommt erst, wenn sie wirklich offen war.
    if (!legendChecked && newEncounter && !legendButton.hidden) {
      legendChecked = true;
      legendWanted = !legendSeen();
    }
    return newEncounter;
  }

  function focusFirst(): boolean {
    const first = cards.find((c) => !c.choose.disabled && !c.card.disabledReason);
    const target = first?.choose ?? [reroll, decline].find((b) => !b.hidden && !b.disabled);
    target?.focus({ preventScroll: true });
    return Boolean(target);
  }

  function revealLegendOnce(): void {
    if (!legendWanted) return;
    legendWanted = false;
    if (legendButton.hidden || !legendButton.isConnected) return;
    markLegendSeen();
    // Der Fokus bleibt auf der Karte: Die Notiz liest sich nebenbei.
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    legend.show(legendButton);
    focused?.focus({ preventScroll: true });
  }

  function clear(): void {
    if (legend.isOpen) legend.hide();
    legendWanted = false;
    idSignature = '';
    contentSignature = '';
    current = null;
    busy = false;
  }

  return { head, element, legend, show, focusFirst, revealLegendOnce, clear };
}
