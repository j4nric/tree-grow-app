/**
 * Pflege-Liste in der Seitenleiste (Schritt 2.7, DESIGN_V2.md 8): je Maßnahme nächster
 * Rang, Kosten, Wirkung, Vorschau, Blocker-Text und Kaufen-Knopf.
 *
 * - Aufklappbar wie die Lebensgemeinschaften; auf schmalen Bildschirmen anfangs zu, die
 *   Zusammenfassung nennt, wie viele Maßnahmen gerade kaufbar sind.
 * - Sortiert: kaufbar, dann „sparen“ (zu wenig Samen), dann gesperrt, dann voll ausgebaut.
 *   Die Reihenfolge bleibt stehen, solange der Mauszeiger in der Liste ist, der
 *   Tastaturfokus (`:focus-visible`) in der Liste liegt oder ein Kauf weniger als
 *   CARE_HOLD_MS her ist (Touch: `pointerleave` kommt dort schon vor `click`). Danach wird
 *   neu sortiert – ein Mausklick hält die Liste also nicht dauerhaft fest.
 * - Nach einem Kauf: kurzes Aufleuchten der Zeile, schwebende Bestätigung (über
 *   `onFeedback`) und dieselbe Meldung in einer Statuszeile für Screenreader.
 *
 * `update()` darf oft laufen: Das DOM wird nur neu gebaut, wenn sich die Ansicht ändert.
 */
import { sortCareViews } from './adapters';
import { REPEAT_GUARD_MS, isDeliberateConfirm, isKeyRepeat } from './confirm';
import { el, setText, srOnly } from './dom';
import { prefersReducedMotion, restartAnimation } from './feedback';
import { formatNumber } from './format';
import { formatSigned, formatSignedPercent } from './view-format';
import type { CareView } from './view-model';

export interface CarePanelCallbacks {
  /** Kauft den nächsten Rang; `true` bei Erfolg (dann folgt die Bestätigung). */
  onBuy(id: string): boolean | void;
  /** Optional: schwebende Bestätigung an Bildschirm-Koordinaten (clientX/Y). */
  onFeedback?(text: string, x: number, y: number): void;
}

export interface CarePanel {
  update(items: readonly CareView[]): void;
  readonly element: HTMLElement;
}

/**
 * Vorschau als kurze Zeile, Zahl vor dem Symbol: „+3 ⚖️ / +5 % 🌿“; leer, wenn sich
 * nichts ändert.
 */
export function carePreviewText(preview: CareView['preview']): string {
  if (!preview) return '';
  const parts: string[] = [];
  if (Math.abs(preview.harmonyDelta) >= 0.05) parts.push(`${formatSigned(preview.harmonyDelta)} ⚖️`);
  if (Math.abs(preview.growthDelta) >= 0.0005) parts.push(`${formatSignedPercent(preview.growthDelta)} 🌿`);
  if (Math.abs(preview.seedDelta) >= 0.0005) parts.push(`${formatSignedPercent(preview.seedDelta)} 🌰`);
  return parts.join(' / ');
}

/** Zusammenfassung im zugeklappten Kopf, z. B. „2 kaufbar“ oder „alles ausgebaut“. */
export function careSummaryText(items: readonly CareView[]): string {
  const buyable = items.filter((i) => i.group === 'buyable').length;
  if (buyable > 0) return `${formatNumber(buyable)} kaufbar`;
  if (items.length > 0 && items.every((i) => i.group === 'maxed')) return 'alles ausgebaut';
  return '';
}

/**
 * Reihenfolge der Zeilen: frisch sortiert – oder, solange die Liste „festgehalten“ ist,
 * die bisherige Reihenfolge (verschwundene Einträge raus, neue sortiert hinten an).
 */
export function careOrder(items: readonly CareView[], previous: readonly string[], frozen: boolean): string[] {
  const sorted = sortCareViews(items).map((i) => i.id);
  if (!frozen || previous.length === 0) return sorted;
  const present = new Set(sorted);
  const kept = previous.filter((id) => present.has(id));
  const known = new Set(kept);
  return [...kept, ...sorted.filter((id) => !known.has(id))];
}

/** So lange (ms) bleibt die Reihenfolge nach einem Kauf stehen – auch ohne Zeiger/Fokus. */
export const CARE_HOLD_MS = 1500;

/** Schmaler Bildschirm (wie die Mobil-Ansicht im CSS). */
function narrowScreen(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
}

const GROUP_LABELS: Record<CareView['group'], string> = {
  buyable: 'kaufbar',
  saving: 'zu wenig Samen',
  locked: 'gesperrt',
  maxed: 'voll ausgebaut',
};

export function createCarePanel(root: HTMLElement, callbacks: CarePanelCallbacks): CarePanel {
  const section = el('section', 'care');
  section.setAttribute('aria-label', 'Pflege');
  section.dataset.ref = 'care';
  const details = el('details', 'eco-harmony care-details');
  // Breit: offen; schmal (Handy): zu, damit die Seitenleiste kurz bleibt.
  details.open = !narrowScreen();
  const summary = el('summary', 'care-summary');
  const title = el('h2', 'care-title', 'Pflege');
  const count = el('span', 'care-count');
  count.dataset.ref = 'care-summary';
  summary.append(title, count);
  const list = el('ul', 'care-list');
  list.setAttribute('aria-label', 'Pflegemaßnahmen');
  // Statuszeile für Screenreader: Bestätigung nach dem Kauf (die schwebende ist verborgen).
  const status = srOnly();
  status.setAttribute('role', 'status');
  details.append(summary, list);
  section.append(details, status);
  section.hidden = true;
  root.append(section);

  /** Zeitpunkt des letzten Kaufs je Maßnahme (performance.now) – Sperre gegen Doppelkäufe. */
  const lastBuy = new Map<string, number>();
  interface Row {
    id: string;
    li: HTMLLIElement;
    head: HTMLElement;
    button: HTMLButtonElement | null;
    blocker: HTMLElement | null;
  }
  let rows: Row[] = [];
  let order: string[] = [];
  let shown = '';
  let last: readonly CareView[] = [];
  let pointerInside = false;
  /** Bis zu diesem Zeitpunkt (performance.now) bleibt die Reihenfolge nach einem Kauf stehen. */
  let holdUntil = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  /** Nach dem nächsten Neuaufbau aufleuchten lassen (gerade gekauft). */
  let flash: string | null = null;

  /** Fokus per Tastatur in der Liste? Ein per Maus fokussierter Knopf zählt nicht. */
  const keyboardFocusInside = () => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !section.contains(active)) return false;
    try {
      return active.matches(':focus-visible');
    } catch {
      return true; // ältere Browser ohne :focus-visible: wie bisher festhalten
    }
  };
  const frozen = () => pointerInside || performance.now() < holdUntil || keyboardFocusInside();

  function buildRow(item: CareView, groupStart: boolean): Row {
    const li = el('li', `care-item care-${item.group}${groupStart ? ' care-group-start' : ''}`);
    li.dataset.care = item.id;
    li.dataset.group = item.group;
    const head = el('p', 'care-head');
    // Ziel für den Fokus, wenn der Kaufen-Knopf nach dem letzten Rang verschwindet.
    head.tabIndex = -1;
    head.dataset.careTitle = item.id;
    const icon = el('span', 'care-icon', item.icon);
    icon.setAttribute('aria-hidden', 'true');
    const rank = el('small', 'care-rank', item.group === 'maxed' ? `✓ ${item.rank}` : item.rank);
    head.append(icon, el('span', 'care-name', item.name), rank);
    if (item.group !== 'maxed') head.append(srOnly(` (${GROUP_LABELS[item.group]})`));
    li.append(head);

    const body = el('div', 'care-body');
    if (item.next) body.append(el('p', 'care-next', item.next));
    // Vorschau nur, wo ein Kauf in Reichweite ist – gesperrte Zeilen bleiben kurz. Sie
    // steht in eigener Zeile über die ganze Breite (unter Wirkung und Knopf).
    const previewText = item.group === 'buyable' || item.group === 'saving' ? carePreviewText(item.preview) : '';
    let preview: HTMLElement | null = null;
    if (previewText) {
      preview = el('p', 'care-preview');
      preview.dataset.ref = 'care-preview';
      preview.append(srOnly('Vorschau: '), previewText);
    }
    let blocker: HTMLElement | null = null;
    if (item.blocker) {
      blocker = el('p', 'care-blocker');
      blocker.dataset.ref = 'care-blocker';
      body.append(blocker);
    }
    if (body.childElementCount > 0) li.append(body);

    let button: HTMLButtonElement | null = null;
    if (item.cost) {
      button = el('button', 'care-buy', `Kaufen (${item.cost})`);
      button.type = 'button';
      button.dataset.buyCare = item.id;
      // Nicht `disabled`: Der Knopf bleibt fokussierbar (Fokus geht nach dem Kauf nicht
      // verloren) und der Sperrgrund vorlesbar. Gesperrte Klicks ignoriert der Handler.
      if (!item.canBuy) button.setAttribute('aria-disabled', 'true');
      const canBuy = item.canBuy;
      button.addEventListener('keydown', (event) => {
        // Gehaltene Enter-Taste: Wiederholungen lösen keinen weiteren Kauf aus.
        if (isKeyRepeat(event)) event.preventDefault();
      });
      button.addEventListener('click', (event) => {
        if (!canBuy) return;
        const now = performance.now();
        // Doppelklick (detail > 1) und Klicks kurz nach einem Kauf kaufen keinen zweiten Rang.
        if (!isDeliberateConfirm(event, lastBuy.get(item.id) ?? -Infinity, now, REPEAT_GUARD_MS)) return;
        lastBuy.set(item.id, now);
        // Kurz festhalten, damit die Zeile nicht unter dem Finger wegspringt; danach neu sortieren.
        holdUntil = now + CARE_HOLD_MS;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(release, CARE_HOLD_MS + 20);
        flash = item.id;
        if (callbacks.onBuy(item.id) === true && item.boughtText) confirmBuy(item);
        flash = null;
      });
      li.append(button);
    }
    if (preview) li.append(preview);
    return { id: item.id, li, head, button, blocker };
  }

  function build(items: readonly CareView[]): void {
    const active = document.activeElement as HTMLElement | null;
    const focused = active?.dataset?.buyCare ?? active?.dataset?.careTitle;
    const byId = new Map(items.map((i) => [i.id, i]));
    let previousGroup: string | null = null;
    rows = order.map((id) => {
      const item = byId.get(id)!;
      // Trennlinie, wo eine neue Gruppe beginnt (nur, wenn davor schon etwas steht).
      const start = previousGroup !== null && previousGroup !== item.group;
      previousGroup = item.group;
      return buildRow(item, start);
    });
    list.replaceChildren(...rows.map((r) => r.li));
    // Fokus nach dem Neuaufbau auf demselben Knopf lassen (Tastatur); ist er weg (voll
    // ausgebaut), auf den Titel der Maßnahme.
    if (focused) {
      const row = rows.find((r) => r.id === focused);
      (row?.button ?? row?.head)?.focus({ preventScroll: true });
    }
    if (flash) {
      const row = rows.find((r) => r.id === flash);
      if (row && !prefersReducedMotion()) restartAnimation(row.li, 'care-flash');
    }
  }

  /**
   * Bestätigung nach einem Kauf: schwebender Text über dem Knopf (bzw. über der Zeile,
   * wenn er nach dem letzten Rang fehlt) – so verdeckt er den Namen nicht; dazu die
   * Statuszeile für Screenreader.
   */
  function confirmBuy(item: CareView): void {
    const text = `${item.icon} ${item.boughtText}`;
    setText(status, '');
    requestAnimationFrame(() => setText(status, item.boughtText ?? ''));
    const row = rows.find((r) => r.id === item.id);
    const anchor = row?.button ?? row?.li ?? section;
    const rect = anchor.getBoundingClientRect();
    const top = (row?.li ?? anchor).getBoundingClientRect().top;
    if (rect.width > 0) callbacks.onFeedback?.(text, rect.left + rect.width / 2, top - 6);
  }

  function apply(items: readonly CareView[], force: boolean): void {
    last = items;
    const nextOrder = careOrder(items, order, frozen());
    // Blocker-Texte wie „Noch 250 🌰“ ändern sich mit jedem Samen: Sie werden an Ort und
    // Stelle ersetzt. Neu gebaut wird nur, wenn sich mehr ändert (sonst ginge z. B. ein
    // Klick zwischen mousedown und mouseup verloren).
    const key = JSON.stringify([nextOrder, items.map((i) => ({ ...i, blocker: i.blocker !== null }))]);
    if (force || key !== shown) {
      shown = key;
      order = nextOrder;
      section.hidden = items.length === 0;
      setText(count, careSummaryText(items));
      build(items);
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const row of rows) {
      const item = byId.get(row.id);
      if (!item) continue;
      if (row.blocker && row.blocker.textContent !== item.blocker) row.blocker.textContent = item.blocker;
      if (row.button && !item.canBuy && item.blocker) {
        const label = `Kaufen (${item.cost}) – gesperrt: ${item.blocker}`;
        if (row.button.getAttribute('aria-label') !== label) row.button.setAttribute('aria-label', label);
      }
    }
  }

  /** Festhalten vorbei: neu sortieren, falls sich die Reihenfolge geändert hätte. */
  function release(): void {
    setTimeout(() => {
      if (frozen()) {
        // Noch in der Haltezeit nach einem Kauf: der Timer dort sortiert später.
        return;
      }
      const sorted = careOrder(last, order, false);
      if (sorted.join('|') !== order.join('|')) apply(last, false);
    }, 0);
  }
  list.addEventListener('pointerenter', () => (pointerInside = true));
  list.addEventListener('pointerleave', () => {
    pointerInside = false;
    release();
  });
  section.addEventListener('focusout', (event) => {
    if (!section.contains(event.relatedTarget as Node | null)) release();
  });

  return { update: (items) => apply(items, false), element: section };
}
