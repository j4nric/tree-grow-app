/**
 * Vorratsleiste (docs/ALBUM_UI.md, B.0 und G.2-14, G-21): Mobil klebt die Reiterleiste oben.
 * Sobald sie klebt – Etiketten und Stufenleiste sind dann aus dem Bild –, erscheint darüber
 * eine schmale Leiste mit Samen, Wachstum und Harmonie in Caveat. So sieht man den Vorrat
 * auch beim Kaufen weiter unten in der Pflege, in Arten und in der Landschaft.
 *
 * - Erkennung per IntersectionObserver an einer unsichtbaren Marke direkt über den Reitern
 *   (kein Messen pro Frame). Die Leiste selbst ist 0 px hoch und klebt; ihr Inhalt liegt
 *   darüber – das Erscheinen verschiebt nichts im Textfluss.
 * - Nur Zierde für Sehende (`aria-hidden`): Dieselben Werte stehen zugänglich in den Etiketten.
 * - Auf der Doppelseite (Desktop) unsichtbar – dort stehen die Etiketten immer daneben.
 */
import { el, setText } from '../dom';
import { formatNumber, formatRate } from '../format';
import './supply-bar.css';

export interface SupplyValues {
  seeds: number;
  growthPerSec: number;
  harmony: number;
}

export interface SupplyBar {
  /** Unsichtbare Marke (gehört direkt vor die Leiste). */
  readonly marker: HTMLElement;
  readonly element: HTMLElement;
  readonly shown: boolean;
  update(values: SupplyValues): void;
}

export function createSupplyBar(): SupplyBar {
  const marker = el('div', 'supply-marker');
  marker.setAttribute('aria-hidden', 'true');
  const element = el('div', 'supply-bar');
  element.dataset.ref = 'supply-bar';
  element.setAttribute('aria-hidden', 'true');
  const inner = el('div', 'supply-bar-inner');
  const item = (key: string, icon: string, ref: string) => {
    const box = el('span', `supply-item supply-${key}`);
    const value = el('span', 'supply-value');
    value.dataset.ref = ref;
    box.append(el('span', 'supply-icon', icon), value);
    inner.append(box);
    return value;
  };
  const seeds = item('seeds', '🌰', 'supply-seeds');
  const growth = item('growth', '🌿', 'supply-growth');
  const harmony = item('harmony', '⚖️', 'supply-harmony');
  element.append(inner);

  let shown = false;
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      // Nur „oben hinaus“ zählt (die Marke liegt über dem oberen Rand).
      const next = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      if (next === shown) return;
      shown = next;
      element.classList.toggle('shown', shown);
    }).observe(marker);
  }

  return {
    marker,
    element,
    get shown() {
      return shown;
    },
    update(values) {
      setText(seeds, formatNumber(Math.floor(values.seeds)));
      setText(growth, formatRate(values.growthPerSec));
      setText(harmony, formatNumber(Math.round(values.harmony)));
    },
  };
}
