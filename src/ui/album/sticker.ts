/**
 * StickerSlot: runder Aufkleber für Tiere und Pflanzen (docs/ALBUM_UI.md, D.4 und A.4 #39–50).
 *
 * - Tiere zeigen die Renderer-Zeichnung (`renderSpeciesStickerUrl`) als kleines `<img>`
 *   (kein Canvas: keine eigene Compositing-Ebene je Sticker). Gezeichnet wird **nur**, wenn sich Art, Variante, Größe oder Pixeldichte
 *   ändern – nie pro Frame. Matte Bilder (ruhende Arten) kosten das Entsättigen und laufen
 *   darum über die IdleQueue; bis dahin zeigt CSS das farbige Bild gedämpft.
 * - Zufriedenheit als Bogen im weißen Rand (`--arc`), Seltenheit über Edelstein und Randlinie,
 *   Gattung über die Grundfarbe, 🌙 und Bestand als Eckchen. Die Neigung ist fest je Art und
 *   Platz (`stickerTilt`).
 * - Freie Plätze sind gestrichelte Kreise. Pflanzen bekommen das Gruppen-Emoji (G-17).
 *
 * DOM einmal bauen; `setAnimal`/`setPlant`/`setEmpty` setzen nur Geändertes.
 */
import { IdleQueue } from '../../render/idle';
import { renderSpeciesStickerUrl, type StickerVariant } from '../../render/sticker';
import { el, setAttr, setText, setVar } from '../dom';
import { restartAnimation } from '../feedback';
import { hyphenate } from '../hyphenate';
import { RARITY_LABELS, formatPercent, happinessLevel } from '../view-format';
import type { AnimalView, PlantSlotView, Rarity } from '../view-model';
import { happinessArc, stickerTilt, stickerVariant } from './sticker-rules';
import './sticker.css';

/** Kantenlänge, in der das Bild gezeichnet wird (CSS skaliert auf 48 bzw. 54 px). */
export const STICKER_DRAW_SIZE = 54;
/** Großer Sticker im Kopf von U:Tier. */
export const STICKER_BIG_SIZE = 104;

/** Matte Bilder und Silhouetten in Leerlaufzeit (eine Aufgabe je Sticker). */
const idle = new IdleQueue();
let serial = 0;
/**
 * Zeitbudget je Leerlauf-Rückruf: Ein Sticker kostet unter 1 ms, darum zeichnet ein Rückruf
 * weitere wartende, bis das Budget verbraucht ist – sonst bräuchten 15 matte Sticker 15
 * Rückrufe (bei laufendem Game Loop und gedrosselter CPU mehrere Sekunden).
 */
export const IDLE_BUDGET_MS = 4;

/**
 * `schedule(key, task)` auf einer IdleQueue: Der Rückruf führt seine Aufgabe aus und danach
 * weitere wartende, solange das Zeitbudget reicht. Wirft eine Aufgabe, ist der Rückruf zu Ende
 * – der nächste arbeitet trotzdem wieder mit Budget (`draining` wird zurückgesetzt).
 * Exportiert für Tests (Uhr und Warteschlange austauschbar).
 */
export function createIdleScheduler(
  queue: IdleQueue,
  budgetMs = IDLE_BUDGET_MS,
  now: () => number = () => performance.now(),
): (key: string, task: () => void) => void {
  let draining = false;
  return (key, task) => {
    queue.schedule(key, () => {
      task();
      if (draining) return;
      draining = true;
      const until = now() + budgetMs;
      try {
        while (now() < until && queue.runNext()) {
          // weitere Sticker im selben Rückruf
        }
      } finally {
        draining = false;
      }
    });
  };
}

const scheduleIdle = createIdleScheduler(idle);

/** Pixeldichte, mit der zuletzt gezeichnet wurde; ändert sie sich (Zoom, anderer Bildschirm), zeichnen alle neu. */
let dprEpoch = 0;
let lastDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
function checkDpr(): void {
  const dpr = window.devicePixelRatio || 1;
  if (dpr === lastDpr) return;
  lastDpr = dpr;
  dprEpoch++;
  watchDpr();
}
/** Wechsel auf einen anderen Bildschirm meldet kein `resize` – darum auch per Media Query. */
function watchDpr(): void {
  if (typeof window.matchMedia !== 'function') return;
  window.matchMedia(`(resolution: ${lastDpr}dppx)`).addEventListener('change', checkDpr, { once: true });
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', checkDpr);
  watchDpr();
}

/**
 * Zähler der Pixeldichte-Wechsel: Seiten, die Bilder nur bei Bedarf zeichnen (Reiter Arten),
 * vergleichen ihn im `update` und zeichnen ihre sichtbaren Sticker dann neu.
 */
export function stickerDprEpoch(): number {
  return dprEpoch;
}

/**
 * Ein Tier-Bild als `<img>` – zeichnet nur bei Änderung.
 *
 * Bewusst kein `<canvas>` (R3, Leistung): Chromium macht jedes 2D-Canvas zu einer eigenen
 * Compositing-Ebene und dazu jeden darüberliegenden Bogen (`::before`) – über 70 Ebenen auf
 * Nischen, über 100 auf Arten. Das `<img>` zeigt dieselben Pixel als Data-URL aus dem
 * Sticker-Cache des Renderers (`renderSpeciesStickerUrl`) und malt mit der Seite.
 */
export interface StickerImage {
  readonly element: HTMLImageElement;
  /**
   * Bild setzen (leere ID: leeren). `muted` und `silhouette` kommen aus der IdleQueue. Bis
   * dahin zeigt `muted` das farbige Bild gedämpft (`preview`, Standard); mit `preview: false`
   * bleibt der Platz leer (viele Sticker auf einmal, Reiter Arten). Eine Silhouette zeigt nie
   * vorab das farbige Bild – das wäre ein Spoiler.
   */
  draw(id: string, variant: StickerVariant, family?: string, options?: { preview?: boolean }): void;
}

export function createStickerImage(size: number, className = 'sticker-img'): StickerImage {
  const img = el('img', className);
  img.setAttribute('aria-hidden', 'true');
  img.alt = '';
  img.draggable = false;
  img.decoding = 'sync';
  // Wie zuvor das Canvas: kein Wischen ab dem Bild (swipe.ts) – Kennzeichen statt Tag-Name.
  img.dataset.stickerImage = '';
  const key = `sticker-${++serial}`;
  let shown = '';
  const clear = () => {
    img.removeAttribute('src');
    img.dataset.empty = '';
  };
  clear();
  return {
    element: img,
    draw(id, variant, family, options) {
      const wanted = `${id}|${variant}|${dprEpoch}`;
      if (wanted === shown) return;
      shown = wanted;
      idle.cancel(key);
      img.classList.remove('sticker-img-pending');
      if (!id) {
        clear();
        return;
      }
      const paint = (v: StickerVariant) => {
        const url = renderSpeciesStickerUrl(id, size, { dpr: lastDpr, variant: v, family: family as never });
        if (img.getAttribute('src') !== url) img.src = url;
        if (img.dataset.empty !== undefined) delete img.dataset.empty;
      };
      if (variant === 'color') {
        paint('color');
        return;
      }
      // Matt erst in Leerlaufzeit; solange farbig mit CSS-Dämpfung (Silhouette: leer).
      if (variant === 'muted' && options?.preview !== false) paint('color');
      else clear();
      img.classList.add('sticker-img-pending');
      scheduleIdle(key, () => {
        if (shown !== wanted) return;
        paint(variant);
        img.classList.remove('sticker-img-pending');
      });
    },
  };
}

/** Ein Platz in einer Stickerreihe: Tier, Pflanze oder frei. */
export interface StickerSlot {
  /** Listenpunkt (trägt `data-species` bzw. `data-plant`). */
  readonly element: HTMLLIElement;
  /** Der Sticker selbst (Knopf bei Tieren). */
  readonly button: HTMLButtonElement;
  /** Art bzw. Pflanze auf dem Platz (sonst null). */
  readonly id: string | null;
  setAnimal(animal: AnimalView, index: number, animate: boolean): void;
  setPlant(plant: PlantSlotView, index: number, animate: boolean): void;
  setEmpty(): void;
}

/** Was auf einem Platz klebt. */
export type StickerKind = 'animal' | 'visitor' | 'plant';

export interface StickerSlotOptions {
  /** Tipp auf den Sticker: eingezogenes Tier, Gast oder Pflanze (der Knopf ist der Auslöser). */
  onTap?(id: string, kind: StickerKind, button: HTMLButtonElement): void;
  /** Beschriftung freier Plätze für Screenreader, z. B. „frei“. */
  emptyLabel?: string;
}

const RARITY_SET: ReadonlySet<Rarity> = new Set(['common', 'rare', 'special', 'legendary']);

export function createStickerSlot(options: StickerSlotOptions = {}): StickerSlot {
  const li = el('li', 'sticker-slot is-empty');
  const button = el('button', 'sticker');
  button.type = 'button';
  const face = el('span', 'sticker-face');
  face.setAttribute('aria-hidden', 'true');
  const image = createStickerImage(STICKER_DRAW_SIZE);
  const emoji = el('span', 'sticker-emoji');
  face.append(image.element, emoji);
  const gem = el('span', 'sticker-gem', '◆');
  gem.setAttribute('aria-hidden', 'true');
  const night = el('span', 'sticker-night', '🌙');
  night.setAttribute('aria-hidden', 'true');
  night.hidden = true;
  const stock = el('span', 'sticker-stock');
  stock.setAttribute('aria-hidden', 'true');
  stock.hidden = true;
  const sr = el('span', 'sr-only');
  button.append(face, gem, night, stock, sr);
  const name = el('span', 'sticker-name');
  name.setAttribute('aria-hidden', 'true');
  const empty = el('span', 'sticker-empty');
  const emptySr = el('span', 'sr-only', options.emptyLabel ?? 'frei');
  empty.append(emptySr);
  li.append(button, name, empty);
  button.hidden = true;
  name.hidden = true;

  let current: string | null = null;
  let visitor = false;
  let kind: 'animal' | 'plant' | null = null;

  button.addEventListener('click', () => {
    if (current && kind) options.onTap?.(current, kind === 'plant' ? 'plant' : visitor ? 'visitor' : 'animal', button);
  });

  function fill(id: string, nextKind: 'animal' | 'plant', index: number, animate: boolean): void {
    const changed = current !== id || kind !== nextKind;
    if (kind === null) {
      li.classList.remove('is-empty');
      button.hidden = false;
      name.hidden = false;
      empty.hidden = true;
    }
    if (changed) {
      setVar(button, '--tilt', `${stickerTilt(id, index)}deg`);
      if (animate) restartAnimation(button, 'sticker-arrive');
    }
    current = id;
    kind = nextKind;
  }

  return {
    element: li,
    button,
    get id() {
      return current;
    },
    setAnimal(animal, index, animate) {
      fill(animal.id, 'animal', index, animate);
      visitor = animal.visitor === true;
      if (li.dataset.species !== animal.id) li.dataset.species = animal.id;
      if (li.dataset.plant !== undefined) delete li.dataset.plant;
      const rarity = RARITY_SET.has(animal.rarity) ? animal.rarity : 'common';
      setAttr(button, 'data-family', animal.family);
      setAttr(button, 'data-rarity', rarity);
      button.classList.toggle('is-visitor', visitor);
      button.classList.remove('is-plant');
      image.draw(animal.id, stickerVariant(animal), animal.family);
      setText(emoji, '');
      const happiness = Number.isFinite(animal.happiness) ? Math.min(1, Math.max(0, animal.happiness)) : 0;
      setVar(button, '--arc', `${happinessArc(happiness)}deg`);
      setAttr(button, 'data-happy', happinessLevel(happiness));
      const shown = hyphenate(animal.name);
      setText(name, shown);
      const mood = `${formatPercent(happiness)} · ${animal.mood}`;
      setAttr(button, 'title', `${animal.name}: ${mood}`);
      const nightView = animal.night;
      if (night.hidden === Boolean(nightView)) night.hidden = !nightView;
      night.classList.toggle('active', nightView?.active === true);
      const stockView = animal.stock;
      if (stock.hidden === Boolean(stockView)) stock.hidden = !stockView;
      setAttr(stock, 'data-level', stockView?.level ?? '');
      const parts = [
        animal.name,
        RARITY_LABELS[rarity],
        visitor ? 'zu Gast' : '',
        mood,
        stockView ? `Bestand ${stockView.label}` : '',
        nightView ? `nachtaktiv${nightView.active ? ', Nachtbonus wirkt gerade' : ''}` : '',
      ];
      setText(sr, parts.filter(Boolean).join(', '));
    },
    setPlant(plant, index, animate) {
      fill(plant.id, 'plant', index, animate);
      if (li.dataset.plant !== plant.id) li.dataset.plant = plant.id;
      if (li.dataset.species !== undefined) delete li.dataset.species;
      setAttr(button, 'data-family', plant.group);
      setAttr(button, 'data-rarity', 'common');
      button.classList.add('is-plant');
      button.classList.remove('is-visitor');
      image.draw('', 'color');
      setText(emoji, plant.groupIcon);
      setVar(button, '--arc', '360deg');
      setAttr(button, 'data-happy', 'plant');
      setText(name, hyphenate(plant.name));
      setAttr(button, 'title', `${plant.name} · ${plant.groupLabel}`);
      if (!night.hidden) night.hidden = true;
      if (!stock.hidden) stock.hidden = true;
      setText(sr, `${plant.name}, ${plant.groupLabel}`);
    },
    setEmpty() {
      if (kind === null) return;
      kind = null;
      current = null;
      visitor = false;
      li.classList.add('is-empty');
      delete li.dataset.species;
      delete li.dataset.plant;
      button.hidden = true;
      name.hidden = true;
      empty.hidden = false;
      image.draw('', 'color');
      setText(sr, '');
      setText(name, '');
      setText(emoji, '');
      button.removeAttribute('title');
    },
  };
}
