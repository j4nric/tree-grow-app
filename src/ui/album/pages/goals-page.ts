/**
 * Reiter „Ziele“ – „Was haben wir vor?“ (docs/ALBUM_UI.md, B.4 und A.9):
 * 1. Tagesziele mit Serie und je einem Balken (Belohnung kommt automatisch, main.ts),
 * 2. Kurzkarte „Neuer Zyklus“ (Gedächtnis, Gewinn bzw. Grund, „Vorbereiten ›“ → U:Neuer Zyklus),
 * 3. Link-Karte „Erfolge · 12/40 ›“ → U:Erfolge,
 * 4. Link-Karte „Statistik ›“ → U:Statistik.
 * Der Punkt am Reiter zeigt, wenn ein Neuer Zyklus möglich ist (G-13).
 *
 * DOM einmal bauen; `update` setzt nur Texte, Klassen und Variablen. Die Liste der
 * Tagesziele entsteht nur neu, wenn sich Tag oder Ziele (Art, Text, erfüllt) ändern.
 */
import { el, setAttr, setText, setVar } from '../../dom';
import { toDailyView, type DailyView } from '../../daily-view';
import { hyphenate } from '../../hyphenate';
import type { PageEnv, TabPage } from './registry';
import { createTabPanel } from './tab-pages';
import { achievementsLinkView, goalsPageMeta, goalsTabDot, shareWidth, statsLinkText, toCycleCardView } from './goals-view';
import './goals.css';

/** Zahlen (Fortschritt, Samen-Belohnung) höchstens so oft nachziehen. */
const REFRESH_MS = 200;

interface GoalRow {
  item: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  progress: HTMLElement;
  reward: HTMLElement;
}

export function createGoalsPage(env: PageEnv): TabPage {
  const deps = env.deps;
  const page = createTabPanel('goals');
  page.body.classList.add('goals-body');

  // --- 1. Tagesziele -------------------------------------------------------------------
  const daily = el('section', 'goals-card goals-daily');
  daily.dataset.ref = 'daily';
  const dailyHead = el('header', 'goals-daily-head');
  const dailyTitle = el('h3', 'goals-card-title', 'Tagesziele');
  dailyTitle.id = 'daily-title';
  daily.setAttribute('aria-labelledby', dailyTitle.id);
  const dailyMeta = el('p', 'goals-daily-meta');
  const summary = el('span', 'daily-summary');
  const streak = el('span', 'daily-streak');
  streak.dataset.ref = 'daily-streak';
  dailyMeta.append(summary, streak);
  dailyHead.append(dailyTitle, dailyMeta);
  const list = el('ul', 'goals-daily-list');
  list.setAttribute('aria-labelledby', dailyTitle.id);
  daily.append(dailyHead, list);
  daily.hidden = true;

  // --- 2. Kurzkarte Neuer Zyklus ---------------------------------------------------------
  const cycle = el('section', 'goals-card goals-cycle');
  cycle.dataset.ref = 'cycle-card';
  const cycleTitle = el('h3', 'goals-card-title', 'Neuer Zyklus');
  cycleTitle.id = 'goals-cycle-title';
  cycle.setAttribute('aria-labelledby', cycleTitle.id);
  const cycleSub = el('p', 'goals-cycle-sub');
  cycleSub.dataset.ref = 'cycle-card-sub';
  const cycleMemory = el('p', 'goals-cycle-memory');
  cycleMemory.dataset.ref = 'cycle-card-memory';
  const cycleLine = el('p', 'goals-cycle-line');
  cycleLine.dataset.ref = 'cycle-card-line';
  const cycleOpen = el('button', 'goals-more');
  cycleOpen.type = 'button';
  cycleOpen.dataset.ref = 'cycle-open';
  cycleOpen.addEventListener('click', () => env.open({ kind: 'cycle' }));
  const cycleStamp = el('span', 'goals-cycle-stamp', 'bereit!');
  cycleStamp.setAttribute('aria-hidden', 'true');
  cycle.append(cycleStamp, cycleTitle, cycleSub, cycleMemory, cycleLine, cycleOpen);

  // --- 3./4. Link-Karten Erfolge und Statistik ------------------------------------------
  const links = el('div', 'goals-links');
  const achievements = linkCard('achievements-open', '🏅', 'Erfolge', () => env.open({ kind: 'achievements' }));
  const achievementIcons = el('span', 'goals-link-stickers');
  achievementIcons.setAttribute('aria-hidden', 'true');
  achievements.body.append(achievementIcons);
  const stats = linkCard('stats-open', '📊', 'Statistik', () => env.open({ kind: 'stats' }));
  links.append(achievements.button, stats.button);

  page.body.append(daily, cycle, links);

  let rows: GoalRow[] = [];
  let dailyKey = '';
  let shownIcons = '';
  let last = -Infinity;

  function buildDaily(view: DailyView): void {
    rows = view.goals.map((g) => {
      const item = el('li', 'daily-goal');
      const kind = g.key.split('|')[1] ?? '';
      item.dataset.goal = kind;
      item.classList.toggle('done', g.done);
      const icon = el('span', 'goals-daily-icon', g.icon);
      icon.setAttribute('aria-hidden', 'true');
      const text = el('span', 'goals-daily-text', hyphenate(g.text));
      text.id = `daily-text-${kind}`;
      const bar = el('span', 'goals-bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-labelledby', text.id);
      const fill = el('span', 'goals-bar-fill');
      bar.append(fill);
      const progress = el('small', 'goals-daily-progress');
      const reward = el('small', 'goals-daily-reward');
      item.append(icon, text, bar, progress, reward);
      return { item, bar, fill, progress, reward };
    });
    list.replaceChildren(...rows.map((r) => r.item));
  }

  function updateDaily(view: DailyView): void {
    // Struktur: Tag, Ziele (Art, Text, erfüllt). Fortschritt und Belohnung laufen an Ort und Stelle.
    const key = JSON.stringify([view.day, view.goals.map((g) => [g.key, g.text, g.done, g.icon])]);
    if (key !== dailyKey) {
      dailyKey = key;
      daily.hidden = view.goals.length === 0;
      buildDaily(view);
    }
    setText(summary, view.summary);
    setText(streak, view.streakText);
    streak.hidden = view.streakText === '';
    view.goals.forEach((g, i) => {
      const r = rows[i];
      if (!r) return;
      setText(r.progress, g.progress);
      setText(r.reward, g.reward);
      setVar(r.fill, '--done', shareWidth(g.share));
      setAttr(r.bar, 'aria-valuemax', String(g.max));
      setAttr(r.bar, 'aria-valuenow', String(g.now));
      setAttr(r.bar, 'aria-valuetext', g.done ? `${g.progress}, erfüllt` : g.progress);
    });
  }

  function render(): void {
    const state = deps.state();
    const today = deps.today();
    const dailyView = today ? toDailyView(state, today) : null;
    if (dailyView) updateDaily(dailyView);
    else daily.hidden = true;
    page.setMeta(goalsPageMeta(dailyView, state.cycle.number));

    const card = toCycleCardView(state);
    cycle.classList.toggle('ready', card.ready);
    setText(cycleSub, `${card.title} · Hauptbaum ${card.tree}`);
    setText(cycleMemory, card.memory);
    setText(cycleLine, card.line);
    cycleLine.classList.toggle('blocked', !card.ready);
    setText(cycleOpen, card.button);
    setAttr(cycleOpen, 'aria-label', `Neuer Zyklus: ${card.button.replace(' ›', '')}`);

    const ach = achievementsLinkView(state);
    setText(achievements.meta, ach.count);
    const icons = ach.icons.join('');
    if (icons !== shownIcons) {
      shownIcons = icons;
      achievementIcons.replaceChildren(...ach.icons.map((icon, i) => {
        const sticker = el('span', 'goals-mini-sticker', icon);
        sticker.style.setProperty('--tilt', `${(i % 2 === 0 ? -1 : 1) * (3 + i)}deg`);
        return sticker;
      }));
    }
    setText(stats.meta, statsLinkText(state));
  }

  return {
    page,
    update(now, force) {
      if (!force && now - last < REFRESH_MS) return;
      last = now;
      render();
    },
    dot: () => goalsTabDot(deps.state()),
  };
}

/** Link-Karte: ganzer Knopf mit Symbol, Titel, Kennzahl und „›“. */
function linkCard(ref: string, icon: string, title: string, onOpen: () => void) {
  const button = el('button', 'goals-link');
  button.type = 'button';
  button.dataset.ref = ref;
  const sticker = el('span', 'goals-link-icon', icon);
  sticker.setAttribute('aria-hidden', 'true');
  const body = el('span', 'goals-link-body');
  const name = el('span', 'goals-link-title', title);
  const meta = el('span', 'goals-link-meta');
  body.append(name, meta);
  const arrow = el('span', 'goals-link-arrow', '›');
  arrow.setAttribute('aria-hidden', 'true');
  button.append(sticker, body, arrow);
  button.addEventListener('click', onOpen);
  return { button, body, meta };
}
