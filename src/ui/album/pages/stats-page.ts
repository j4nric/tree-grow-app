/**
 * Unterseite „Statistik“ (docs/ALBUM_UI.md, A.7 #91 und B.4): Kennzahlen dieses Zyklus und
 * „Über alle Zyklen“ (Langzeit-Statistik, seit v8), alles aus dem Spielstand
 * (`toJournalStats`). Die Zeilen entstehen einmal je Schlüssel; danach werden nur Texte
 * getauscht (Samen und Spielzeit laufen mit, gedrosselt).
 */
import { evaluate } from '../../../core/formulas';
import { toJournalStats } from '../../adapters';
import { el, setText } from '../../dom';
import type { JournalStatView } from '../../view-model';
import { createBookmark } from '../bookmark';
import { initialNav, pageNumber } from '../nav';
import { createPage } from '../page';
import type { PageEnv, Subpage } from './registry';
import './goals.css';

const REFRESH_MS = 200;

export function createStatsPage(env: PageEnv): Subpage {
  const page = createPage({
    kind: 'stats',
    title: 'Statistik',
    number: pageNumber({ ...initialNav('goals'), stack: [{ kind: 'stats' }] }),
    className: 'album-subpage stats-page',
  });
  const bookmark = createBookmark(() => env.back());
  bookmark.setLabel('Ziele');
  page.element.prepend(bookmark.element);
  page.body.classList.add('goals-body');

  const cycleTitle = el('h3', 'goals-section-title', 'Dieser Zyklus');
  cycleTitle.id = 'stats-cycle-title';
  const cycleList = el('dl', 'stat-list');
  cycleList.dataset.ref = 'journal-stats';
  cycleList.setAttribute('aria-labelledby', cycleTitle.id);
  const totalTitle = el('h3', 'goals-section-title', 'Über alle Zyklen');
  totalTitle.id = 'stats-total-title';
  const totalList = el('dl', 'stat-list');
  totalList.dataset.ref = 'journal-stats-total';
  totalList.setAttribute('aria-labelledby', totalTitle.id);
  page.body.append(cycleTitle, cycleList, totalTitle, totalList);

  const rows = new Map<string, { value: HTMLElement; detail: HTMLElement }>();
  let last = -Infinity;

  function renderStats(stats: readonly JournalStatView[]): void {
    for (const s of stats) {
      let row = rows.get(s.key);
      if (!row) {
        const wrap = el('div', 'stat-row');
        wrap.dataset.stat = s.key;
        const dt = el('dt', 'stat-label', s.label);
        const dd = el('dd', 'stat-value');
        const value = el('span', 'stat-number');
        const detail = el('span', 'stat-detail');
        dd.append(value, detail);
        wrap.append(dt, dd);
        (s.section === 'total' ? totalList : cycleList).append(wrap);
        row = { value, detail };
        rows.set(s.key, row);
      }
      setText(row.value, s.value);
      setText(row.detail, s.detail ?? '');
      row.detail.hidden = !s.detail;
    }
  }

  function render(): void {
    const state = env.deps.state();
    renderStats(toJournalStats(state, evaluate(state)));
  }

  return {
    page,
    bookmark,
    opened() {
      last = performance.now();
      render();
    },
    update(now, force) {
      if (!force && now - last < REFRESH_MS) return;
      last = now;
      render();
    },
  };
}
