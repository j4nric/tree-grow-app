/**
 * Aktive Boni in der Seitenleiste (Schritt 2.4): je Quelle eine Zeile. Zeit-Boni aus
 * Ereignissen und bewirtete Gäste zeigen die Restzeit und einen dezenten Balken, der mit
 * der Zeit schrumpft; Wirkungen bis zum Neuen Zyklus stehen darunter, ohne Balken.
 *
 * `update()` darf oft laufen: Das DOM wird nur neu gebaut, wenn sich Zeilen ändern
 * (neuer/abgelaufener Bonus); Restzeit und Balken werden an Ort und Stelle gesetzt.
 */
import { el, setText, setVar } from './dom';
import { hyphenate } from './hyphenate';
import type { ActiveBonusView } from './view-model';

export interface BonusPanel {
  update(bonuses: readonly ActiveBonusView[]): void;
  readonly element: HTMLElement;
}

interface Row {
  left: HTMLElement;
  bar: HTMLElement | null;
}

/** Balkenbreite in Prozent mit einer Nachkommastelle (CSS-Variable --left). */
export function barWidth(progress: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return `${Math.round(clamped * 1000) / 10}%`;
}

export function createBonusPanel(root: HTMLElement): BonusPanel {
  const section = el('section', 'bonuses');
  section.setAttribute('aria-label', 'Aktive Boni');
  section.dataset.ref = 'bonuses';
  const title = el('h2', 'eco-title', 'Aktive Boni');
  const list = el('ul', 'bonus-list');
  section.append(title, list);
  section.hidden = true;
  root.append(section);

  let shown = '';
  let rows = new Map<string, Row>();

  function row(b: ActiveBonusView): HTMLElement {
    const timed = b.timed;
    const li = el('li', timed ? 'bonus bonus-timed' : 'bonus bonus-cycle');
    li.dataset.bonus = b.id;
    const icon = el('span', 'bonus-icon', b.icon);
    icon.setAttribute('aria-hidden', 'true');
    const left = el('small', 'bonus-left', b.remaining);
    li.append(icon, el('span', 'bonus-name', hyphenate(b.name)), left, el('span', 'bonus-effect', b.effect));
    let bar: HTMLElement | null = null;
    if (timed && b.progress !== null) {
      // Rein optisch – die Restzeit steht als Text daneben.
      const track = el('span', 'bonus-bar');
      track.setAttribute('aria-hidden', 'true');
      bar = el('span', 'bonus-bar-fill');
      track.append(bar);
      li.append(track);
    }
    rows.set(b.id, { left, bar });
    return li;
  }

  function build(bonuses: readonly ActiveBonusView[]): void {
    rows = new Map();
    const items: HTMLElement[] = [];
    bonuses.forEach((b, i) => {
      // Vor der ersten Wirkung ohne Ablauf eine kleine Zwischenzeile („bis zum Neuen
      // Zyklus“) statt desselben Textes in jeder Zeile.
      if (!b.timed && (i === 0 || bonuses[i - 1]!.timed)) {
        items.push(el('li', 'bonus-group', b.remaining));
      }
      items.push(row(b));
    });
    list.replaceChildren(...items);
  }

  function update(bonuses: readonly ActiveBonusView[]): void {
    // Nur die Struktur zählt für den Neuaufbau, nicht Restzeit und Balken.
    // Ohne Ablauf steht `remaining` in der Zwischenzeile – dann zählt er mit.
    const key = JSON.stringify(bonuses.map((b) => [b.id, b.icon, b.name, b.effect, b.timed, b.progress === null, b.timed ? null : b.remaining]));
    if (key !== shown) {
      shown = key;
      section.hidden = bonuses.length === 0;
      build(bonuses);
    }
    for (const b of bonuses) {
      const r = rows.get(b.id);
      if (!r) continue;
      setText(r.left, b.remaining);
      if (r.bar && b.progress !== null) setVar(r.bar, '--left', barWidth(b.progress));
    }
  }

  return { update, element: section };
}
