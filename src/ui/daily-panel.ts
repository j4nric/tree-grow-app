/**
 * Tagesziele in der Seitenleiste (DESIGN_V2.md 20.7): kompakte Karte unter dem
 * Naturtagebuch mit Serie, je Ziel Text, Balken und Belohnung. Belohnt wird automatisch
 * (Hinweis über main.ts) – es gibt keinen eigenen Knopf.
 *
 * `update()` darf oft laufen: Das DOM wird nur neu gebaut, wenn sich Tag oder Ziele
 * (Art, Text, erfüllt) ändern; Fortschritt, Balken und Belohnung werden an Ort und Stelle
 * gesetzt.
 */
import { barWidth } from './care-view';
import { el, setAttr, setText, setVar } from './dom';
import { hyphenate } from './hyphenate';
import type { DailyView } from './daily-view';

export interface DailyPanel {
  update(view: DailyView): void;
  readonly element: HTMLElement;
}

interface Row {
  item: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  progress: HTMLElement;
  reward: HTMLElement;
}

export function createDailyPanel(root: HTMLElement): DailyPanel {
  const section = el('section', 'daily');
  section.dataset.ref = 'daily';
  const title = el('h2', 'eco-title daily-title', 'Tagesziele');
  title.id = 'daily-title';
  section.setAttribute('aria-labelledby', title.id);
  const meta = el('p', 'daily-meta');
  const summary = el('span', 'daily-summary');
  const streak = el('span', 'daily-streak');
  streak.dataset.ref = 'daily-streak';
  meta.append(summary, streak);
  const list = el('ul', 'daily-list');
  list.setAttribute('aria-labelledby', title.id);
  section.append(title, meta, list);
  section.hidden = true;
  root.append(section);

  let shown = '';
  let rows: Row[] = [];

  function build(view: DailyView): void {
    rows = view.goals.map((g) => {
      const item = el('li', 'daily-goal');
      item.dataset.goal = g.key.split('|')[1] ?? '';
      item.classList.toggle('done', g.done);
      const icon = el('span', 'daily-icon', g.icon);
      icon.setAttribute('aria-hidden', 'true');
      const text = el('span', 'daily-text', hyphenate(g.text));
      text.id = `daily-text-${item.dataset.goal}`;
      const progress = el('small', 'daily-progress');
      const reward = el('small', 'daily-reward');
      const bar = el('span', 'daily-bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-labelledby', text.id);
      const fill = el('span', 'daily-bar-fill');
      bar.append(fill);
      item.append(icon, text, bar, progress, reward);
      return { item, bar, fill, progress, reward };
    });
    list.replaceChildren(...rows.map((r) => r.item));
  }

  function update(view: DailyView): void {
    // Struktur: Tag, Ziele (Art, Text, erfüllt). Fortschritt und Belohnung laufen in place.
    const key = JSON.stringify([view.day, view.goals.map((g) => [g.key, g.text, g.done, g.icon])]);
    if (key !== shown) {
      shown = key;
      section.hidden = view.goals.length === 0;
      build(view);
    }
    setText(summary, view.summary);
    setText(streak, view.streakText);
    view.goals.forEach((g, i) => {
      const r = rows[i];
      if (!r) return;
      setText(r.progress, g.progress);
      setText(r.reward, g.reward);
      setVar(r.fill, '--done', barWidth(g.share));
      setAttr(r.bar, 'aria-valuemax', String(g.max));
      setAttr(r.bar, 'aria-valuenow', String(g.now));
      setAttr(r.bar, 'aria-valuetext', g.done ? `${g.progress}, erfüllt` : g.progress);
    });
  }

  return { update, element: section };
}
