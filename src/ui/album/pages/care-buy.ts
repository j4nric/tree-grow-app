/**
 * Kaufen-Knopf der Pflege (R:Pflege und U:Pflegemaßnahme): gemeinsamer Schutz gegen
 * Doppelkäufe – Doppelklick, gehaltene Enter-Taste und Klicks kurz nach einem Kauf kaufen
 * keinen zweiten Rang, auch nicht über die jeweils andere Seite.
 */
import { REPEAT_GUARD_MS, isDeliberateConfirm, isKeyRepeat } from '../../confirm';

/** Zeitpunkt des letzten Kaufs je Maßnahme (performance.now). */
const lastBuy = new Map<string, number>();

export interface BuyButtonOptions {
  /** Maßnahme hinter dem Knopf (null: gerade keine). */
  id(): string | null;
  /** Gesperrte Knöpfe bleiben fokussierbar (aria-disabled) – Klicks zählen dann nicht. */
  canBuy(): boolean;
  /** Vor dem Kauf (z. B. Reihenfolge festhalten). */
  before?(id: string, now: number): void;
  /** Kauft; `true` bei Erfolg. */
  buy(id: string): boolean | void;
  /** Nach einem erfolgreichen Kauf (Bestätigung). */
  bought?(id: string): void;
}

export function wireBuyButton(button: HTMLButtonElement, options: BuyButtonOptions): void {
  button.addEventListener('keydown', (event) => {
    if (isKeyRepeat(event)) event.preventDefault();
  });
  button.addEventListener('click', (event) => {
    const id = options.id();
    if (!id || !options.canBuy()) return;
    const now = performance.now();
    if (!isDeliberateConfirm(event, lastBuy.get(id) ?? -Infinity, now, REPEAT_GUARD_MS)) return;
    lastBuy.set(id, now);
    options.before?.(id, now);
    if (options.buy(id) === true) options.bought?.(id);
  });
}

/** Text und Sperr-Hinweis des Knopfs setzen (nur bei Änderung). */
export function setBuyButton(button: HTMLButtonElement, cost: string | null, canBuy: boolean, blocker: string | null): void {
  const text = cost ? `Kaufen (${cost})` : '';
  if (button.textContent !== text) button.textContent = text;
  button.hidden = !cost;
  const disabled = cost !== null && !canBuy;
  if (disabled) {
    if (button.getAttribute('aria-disabled') !== 'true') button.setAttribute('aria-disabled', 'true');
  } else if (button.hasAttribute('aria-disabled')) {
    button.removeAttribute('aria-disabled');
  }
  const label = disabled && blocker ? `${text} – gesperrt: ${blocker}` : null;
  if (label === null) {
    if (button.hasAttribute('aria-label')) button.removeAttribute('aria-label');
  } else if (button.getAttribute('aria-label') !== label) {
    button.setAttribute('aria-label', label);
  }
}
