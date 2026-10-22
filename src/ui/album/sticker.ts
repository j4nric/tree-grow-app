/**
 * StickerSlot: runder Aufkleber für Tiere und Pflanzen (docs/ALBUM_UI.md, D.4 und A.4 #39–50).
 *
 * - Tiere zeigen die Renderer-Zeichnung (`renderSpeciesSticker`) auf einem kleinen eigenen
 *   `<canvas>`. Gezeichnet wird **nur**, wenn sich Art, Variante, Größe oder Pixeldichte
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
import { renderSpeciesSticker, type StickerVariant } from '../../render/sticker';
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

/** Matte Bilder in Leerlaufzeit (eine Aufgabe je Sticker, ein Stück je Rückruf). */
const idle = new IdleQueue();
let serial = 0;

/** Pixeldichte, mit der zuletzt gezeichnet wurde; ändert sie sich (Zoom, anderer Bildschirm), zeichnen alle neu. */
let dprEpoch = 0;
let lastDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    const dpr = window.devicePixelRatio || 1;
    if (dpr === lastDpr) return;
    lastDpr = dpr;
    dprEpoch++;
  });
}

/** Ein Tier-Bild auf eigenem kleinen Canvas – zeichnet nur bei Änderung. */
export interface StickerImage {
  readonly canvas: HTMLCanvasElement;
  /** Bild setzen (leere ID: leeren). */
  draw(id: string, variant: StickerVariant, family?: string): void;
}

export function createStickerImage(size: number, className = 'sticker-img'): StickerImage {
  const canvas = el('canvas', className);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = 1;
  canvas.height = 1;
  const key = `sticker-${++serial}`;
  let shown = '';
  return {
    canvas,
    draw(id, variant, family) {
      const wanted = `${id}|${variant}|${dprEpoch}`;
      if (wanted === shown) return;
      shown = wanted;
      idle.cancel(key);
      canvas.classList.remove('sticker-img-pending');
      if (!id) {
        canvas.width = 1;
        canvas.height = 1;
        return;
      }
      const paint = (v: StickerVariant) => {
        const image = renderSpeciesSticker(id, size, { dpr: lastDpr, variant: v, family: family as never });
        if (canvas.width !== image.width || canvas.height !== image.height) {
          canvas.width = image.width;
          canvas.height = image.height;
        }
        const c = canvas.getContext('2d');
        if (!c) return;
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.drawImage(image, 0, 0);
      };
      if (variant === 'color') {
        paint('color');
        return;
      }
      // Matt erst in Leerlaufzeit; solange farbig mit CSS-Dämpfung.
      paint('color');
      canvas.classList.add('sticker-img-pending');
      idle.schedule(key, () => {
        if (shown !== wanted) return;
        paint(variant);
        canvas.classList.remove('sticker-img-pending');
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
  face.append(image.canvas, emoji);
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
